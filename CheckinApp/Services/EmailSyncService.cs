using CheckinApp.Data;
using CheckinApp.Models;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MimeKit;
using System.Net.Sockets;

namespace CheckinApp.Services;

public record SyncOutcome(bool Ok, int NewCount, string Error);
public record BodyOutcome(bool Ok, string Text, string Error);

/// <summary>
/// 邮件同步服务 —— IMAP 拉信（MailKit）。核心设计：拉取与展示解耦，
/// 页面只读 SQLite 缓存，IMAP 是独立通道（同步失败页面照常能读已缓存的信）。
/// 第一期只收信（INBOX）；发信/文件夹/已读双向同步放第二期。
/// </summary>
public class EmailSyncService(AppDbContext db, EmailCrypto crypto)
{
    // 全局串行：2核2G 小机别同时开一堆 IMAP 连接；同步本身很快（只拉信头）
    private static readonly SemaphoreSlim Gate = new(1, 1);

    /// <summary>同步一个账号：拉 INBOX 新信头入库。错误记账号 LastSyncError，绝不抛给页面。</summary>
    public async Task<SyncOutcome> SyncAsync(int accountId, int userId, CancellationToken ct = default)
    {
        await Gate.WaitAsync(ct);
        EmailAccount? ac = null;
        try
        {
            ac = await db.EmailAccounts.FirstOrDefaultAsync(a => a.Id == accountId && a.UserId == userId, ct);
            if (ac is null) return new(false, 0, "账号不存在");
            if (string.IsNullOrEmpty(ac.AuthCodeEnc)) return await FailAsync(ac, "还没填授权码，请先在账号管理里编辑补上");
            string authCode;
            try { authCode = crypto.Decrypt(ac.AuthCodeEnc); }
            catch { return await FailAsync(ac, "授权码解密失败（加密密钥变更过），请重新填写授权码"); }

            using var client = new ImapClient();
            client.Timeout = 15000;
            await client.ConnectAsync(ac.ImapHost, ac.ImapPort, SecureSocketOptions.SslOnConnect, ct);
            // ⚠️ 网易（163 / 126 / yeah）强制要求 IMAP ID 命令：登录前先自报客户端，
            // 否则直接拒绝：「Unsafe Login. Please contact kefu@188.com」。
            // QQ / Gmail 不强制，但发了也无害，所以全平台统一发。
            try
            {
                await client.IdentifyAsync(new ImapImplementation
                {
                    Name = "CheckinApp",
                    Version = "1.0",
                    Vendor = "anlele",
                    SupportUrl = "https://example.com",
                }, ct);
            }
            catch
            {
                // 不支持 ID 扩展的服务器会抛 NotSupported —— 忽略，继续登录
            }
            await client.AuthenticateAsync(ac.Address, authCode, ct);
            var inbox = client.Inbox;
            await inbox.OpenAsync(FolderAccess.ReadOnly, ct);

            // UIDVALIDITY = 服务器邮箱指纹：变了说明服务器重建过邮箱，本地缓存作废重拉
            var uidv = (long)inbox.UidValidity;
            if (ac.UidValidity != 0 && uidv != 0 && ac.UidValidity != uidv)
            {
                db.EmailMessages.RemoveRange(db.EmailMessages.Where(m => m.AccountId == ac.Id));
                await db.SaveChangesAsync(ct);
            }
            ac.UidValidity = uidv;

            var maxUid = await db.EmailMessages.Where(m => m.AccountId == ac.Id)
                .Select(m => (long?)m.Uid).MaxAsync(ct) ?? 0;
            var next = (long)(inbox.UidNext?.Id ?? 0u);

            // 同步范围：每账号可覆盖（SyncDays / SyncCount），没填就用全局默认
            var (syncDays, syncCount) = ResolveScope(db, ac);
            // ⚠️ 直接从「最新的 syncCount 个 UID」开始，不要先把几千个 UID 全建出来再截断
            var uids = new List<UniqueId>();
            var firstUid = Math.Max(Math.Max(maxUid + 1, 1), (long)next - syncCount);
            for (var u = firstUid; u < next; u++) uids.Add(new UniqueId((uint)u));
            var cutoff = DateTime.UtcNow.AddDays(-syncDays);

            var added = 0;
            // ⚠️ 分批 Fetch（每批 10 封）：一次拉 40 封会在内存里同时堆 40 个 summary，
            // 遇上超大邮件就是 OutOfMemoryException（2G 小机器）。分批后峰值降 3/4，边拉边入库。
            const int batchSize = 10;
            for (var bi = 0; bi < uids.Count; bi += batchSize)
            {
                var batch = uids.Skip(bi).Take(batchSize).ToList();
                // ⚠️ 不拉 BodyStructure：复杂邮件（多层 MIME、内嵌图片）的结构本身就能吃几十 MB。
                // 附件判断改用 Size 粗略估计（下面 HasAttachment）。
                // ⚠️ 绝不要 MessageSummaryItems.PreviewText：有的服务器（网易企业邮箱）
                // 会返回很长的预览甚至整封正文，MimeKit 解析响应时就整段进内存，
                // 事后截断来不及 —— 这正是 edu 邮箱 OOM 而 QQ 没事的原因。
                // 摘要改用 Subject（Envelope 自带，很轻）。
                var summaries = await inbox.FetchAsync(uids,
                    MessageSummaryItems.Flags | MessageSummaryItems.Envelope |
                    MessageSummaryItems.InternalDate | MessageSummaryItems.Size, ct);
                foreach (var s in summaries)
                {
                    // 超出时间范围的旧信不落库（取到才过滤：UID 范围本身不知道日期）
                    if (s.Date.DateTime < cutoff) continue;
                    var env = s.Envelope;
                    var from = env?.From?.FirstOrDefault() as MailboxAddress;
                    var to = env?.To?.FirstOrDefault() as MailboxAddress;
                    db.EmailMessages.Add(new EmailMessage
                    {
                        AccountId = ac.Id,
                        UserId = ac.UserId,
                        Folder = "INBOX",
                        Uid = s.UniqueId.Id,
                        MessageId = env?.MessageId ?? "",
                        FromName = from?.Name ?? "",
                        FromAddress = from?.Address ?? "",
                        ToAddress = to?.Address ?? "",
                        Subject = string.IsNullOrWhiteSpace(env?.Subject) ? "(无主题)" : env!.Subject!,
                        // 摘要就用主题（省一次网络往返 + 省内存）；正文点开信时再拉
                        Snippet = "",
                        SentAt = env?.Date?.UtcDateTime ?? s.InternalDate?.UtcDateTime ?? DateTime.UtcNow,
                        IsRead = s.Flags?.HasFlag(MessageFlags.Seen) ?? false,
                        HasAttachment = HasAttachment(s.Size ?? 0),
                        SizeBytes = s.Size ?? 0,
                        FetchedAt = DateTime.UtcNow,
                    });
                    added++;
                }
                await db.SaveChangesAsync(ct);
            }

            ac.LastSyncAt = DateTime.UtcNow;
            ac.LastSyncError = "";
            await db.SaveChangesAsync(ct);
            await client.DisconnectAsync(true, ct);
            return new(true, added, "");
        }
        catch (AuthenticationException)
        {
            return ac is null ? new(false, 0, "账号不存在") : await FailAsync(ac, "授权码不正确，或邮箱没开 IMAP 服务（去邮箱设置里开启并生成授权码）");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new(false, 0, "同步已取消");
        }
        catch (Exception ex)
        {
            return ac is null ? new(false, 0, "账号不存在") : await FailAsync(ac, "连接失败：" + Friendly(ex));
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>拉正文（首次阅读时调用）：整封信下来取纯文本，缓存进 BodyText。</summary>
    public async Task<BodyOutcome> FetchBodyAsync(int messageId, int userId, CancellationToken ct = default)
    {
        await Gate.WaitAsync(ct);
        EmailAccount? ac = null;
        try
        {
            var msg = await db.EmailMessages.Include(m => m.Account)
                .FirstOrDefaultAsync(m => m.Id == messageId && m.UserId == userId, ct);
            if (msg?.Account is null) return new(false, "", "邮件不存在");
            if (!string.IsNullOrEmpty(msg.BodyText)) return new(true, msg.BodyText, "");
            ac = msg.Account;
            if (string.IsNullOrEmpty(ac.AuthCodeEnc)) return new(false, "", "还没填授权码，无法拉取正文");

            string authCode;
            try { authCode = crypto.Decrypt(ac.AuthCodeEnc); }
            catch { return new(false, "", "授权码解密失败，请重新填写授权码"); }

            using var client = new ImapClient();
            client.Timeout = 15000;
            await client.ConnectAsync(ac.ImapHost, ac.ImapPort, SecureSocketOptions.SslOnConnect, ct);
            await client.AuthenticateAsync(ac.Address, authCode, ct);
            await client.Inbox.OpenAsync(FolderAccess.ReadOnly, ct);

            var mime = await client.Inbox.GetMessageAsync(new UniqueId((uint)msg.Uid), ct);
            var body = mime.TextBody ?? "";
            if (string.IsNullOrWhiteSpace(body) && !string.IsNullOrEmpty(mime.HtmlBody))
                body = ToPlainText(mime.HtmlBody);
            body = body.Trim();
            if (body.Length > 100_000) body = body[..100_000] + "\n\n…（正文过长，已截断）";

            msg.BodyText = body;
            if (string.IsNullOrEmpty(msg.Snippet))
            {
                var snip = body.Replace('\r', ' ').Replace('\n', ' ').Trim();
                msg.Snippet = snip.Length > 120 ? snip[..120] : snip;
            }
            await db.SaveChangesAsync(ct);
            await client.DisconnectAsync(true, ct);
            return new(true, body, "");
        }
        catch (AuthenticationException)
        {
            return new(false, "", "授权码不正确，或邮箱没开 IMAP 服务");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new(false, "", "拉取已取消");
        }
        catch (Exception ex)
        {
            return new(false, "", "连接失败：" + Friendly(ex));
        }
        finally
        {
            Gate.Release();
        }
    }

    // ---------------- 内部小工具 ----------------

    private async Task<SyncOutcome> FailAsync(EmailAccount ac, string error)
    {
        ac.LastSyncError = error;
        await db.SaveChangesAsync();
        return new(false, 0, error);
    }

    /// <summary>正文摘要拉取的大小上限：超过这个就不拉了（预览留空）。</summary>
    private const long SnippetBodyLimit = 32 * 1024L;

    private static async Task<string> TrySnippetAsync(IMailFolder inbox, IMessageSummary s, CancellationToken ct)
    {
        try
        {
            // ① 服务器给的 PREVIEW 扩展是免费的，优先用
            var text = s.PreviewText ?? "";
            if (string.IsNullOrWhiteSpace(text))
            {
                // ② 没有 PREVIEW 才拉正文 —— 这一步是同步里最贵的：
                //    每封邮件要多 1~2 次 IMAP 往返，几 MB 的 HTML 邮件还会让 GC 短时暴涨。
                //    所以超过 SnippetBodyLimit 的正文**不拉**，摘要留空即可（用户点开信还有全文）。
                if (s.TextBody is { } tpart && BodySize(tpart) <= SnippetBodyLimit
                    && await inbox.GetBodyPartAsync(s.UniqueId, tpart, ct) is TextPart tp)
                    text = tp.Text ?? "";
                if (string.IsNullOrWhiteSpace(text) && s.HtmlBody is { } hpart && BodySize(hpart) <= SnippetBodyLimit
                    && await inbox.GetBodyPartAsync(s.UniqueId, hpart, ct) is TextPart hp)
                    text = hp.Text ?? "";
            }
            text = ToPlainText(text).Replace('\r', ' ').Replace('\n', ' ').Trim();
            return text.Length > 120 ? text[..120] : text;
        }
        catch { return ""; }
    }

    /// <summary>正文块声明的大小（服务器给的估计值）。拿不到就返回 0（当小处理）。</summary>
    private static long BodySize(BodyPart part) =>
        part is BodyPartBasic b ? b.Octets : 0L;

    /// <summary>
    /// 有没有附件：为了省内存不拉 BodyStructure，只能按邮件大小粗估
    /// （> 100KB 的通常带附件或大图）。精确判断要在读信时才做。
    /// </summary>
    private static bool HasAttachment(long sizeBytes) => sizeBytes > 100 * 1024;

    /// <summary>HTML → 纯文本：去标签解实体。正文只以纯文本呈现，天然免疫邮件里的 XSS。</summary>
    public static string ToPlainText(string html)
    {
        if (string.IsNullOrEmpty(html)) return "";
        var t = System.Text.RegularExpressions.Regex.Replace(html, @"<(script|style)[\s\S]*?</\1>", " ", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        t = System.Text.RegularExpressions.Regex.Replace(t, @"<br\s*/?>|</p>|</div>|</tr>|</h[1-6]>", "\n", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        t = System.Text.RegularExpressions.Regex.Replace(t, @"<[^>]+>", " ");
        t = System.Net.WebUtility.HtmlDecode(t);
        t = System.Text.RegularExpressions.Regex.Replace(t, @"[ \t　]+", " ");
        t = System.Text.RegularExpressions.Regex.Replace(t, @"\n{3,}", "\n\n");
        return t.Trim();
    }


    /// <summary>
    /// 同步范围解析：账号自己的设置优先（SyncDays / SyncCount &gt; 0），没设就用全局默认；
    /// 全局默认也没改过就用内置值（7 天 / 40 封）。
    /// </summary>
    public static (int Days, int Count) ResolveScope(AppDbContext db, EmailAccount ac)
    {
        // 默认 20 封：2G 小机器上宁可少拉、勤同步，也不要一次拉太多导致 OOM
        const int fallbackDays = 7, fallbackCount = 20;
        var days = ac.SyncDays > 0 ? ac.SyncDays : ReadInt(db, "email.sync-days", fallbackDays);
        var count = ac.SyncCount > 0 ? ac.SyncCount : ReadInt(db, "email.sync-count", fallbackCount);
        return (days, count);
    }

    private static int ReadInt(AppDbContext db, string key, int d)
    {
        var row = db.AppSettings.FirstOrDefault(x => x.Key == key);
        return row is not null && int.TryParse(row.Value, out var v) && v > 0 ? v : d;
    }

    private static string Friendly(Exception ex) => ex switch
    {
        SocketException or TimeoutException or IOException =>
            "网络不通或服务器无响应（Gmail 等海外邮箱从国内服务器常常连不上）",
        ServiceNotConnectedException => "IMAP 连接中断",
        _ => ex.Message,
    };
}
