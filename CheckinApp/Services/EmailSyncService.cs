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

            var uids = new List<UniqueId>();
            for (var u = Math.Max(maxUid + 1, 1); next > 0 && u < next; u++) uids.Add(new UniqueId((uint)u));
            if (uids.Count > 40) uids = uids.Skip(uids.Count - 40).ToList();   // 一次最多 40 封，防首次绑定被洪水冲垮

            var added = 0;
            if (uids.Count > 0)
            {
                var summaries = await inbox.FetchAsync(uids,
                    MessageSummaryItems.Flags | MessageSummaryItems.Envelope |
                    MessageSummaryItems.InternalDate | MessageSummaryItems.Size |
                    MessageSummaryItems.BodyStructure | MessageSummaryItems.PreviewText, ct);
                foreach (var s in summaries)
                {
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
                        Snippet = await TrySnippetAsync(inbox, s, ct),
                        SentAt = env?.Date?.UtcDateTime ?? s.InternalDate?.UtcDateTime ?? DateTime.UtcNow,
                        IsRead = s.Flags?.HasFlag(MessageFlags.Seen) ?? false,
                        HasAttachment = HasAttachment(s.Body),
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

    /// <summary>摘要：先用服务器 PREVIEW（支持才给），没有就拉正文小段。失败就空摘要，不碍事。</summary>
    private static async Task<string> TrySnippetAsync(IMailFolder inbox, IMessageSummary s, CancellationToken ct)
    {
        try
        {
            var text = s.PreviewText ?? "";
            if (string.IsNullOrWhiteSpace(text) && s.TextBody is { } tpart
                && await inbox.GetBodyPartAsync(s.UniqueId, tpart, ct) is TextPart tp)
                text = tp.Text ?? "";
            if (string.IsNullOrWhiteSpace(text) && s.HtmlBody is { } hpart
                && await inbox.GetBodyPartAsync(s.UniqueId, hpart, ct) is TextPart hp)
                text = hp.Text ?? "";
            text = ToPlainText(text).Replace('\r', ' ').Replace('\n', ' ').Trim();
            return text.Length > 120 ? text[..120] : text;
        }
        catch { return ""; }
    }

    private static bool HasAttachment(BodyPart? part)
    {
        if (part is null) return false;
        if (part is BodyPartMultipart mp) return mp.BodyParts.Any(HasAttachment);
        if (part is BodyPartBasic basic) return basic.IsAttachment || !string.IsNullOrEmpty(basic.FileName);
        return false;
    }

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

    private static string Friendly(Exception ex) => ex switch
    {
        SocketException or TimeoutException or IOException =>
            "网络不通或服务器无响应（Gmail 等海外邮箱从国内服务器常常连不上）",
        ServiceNotConnectedException => "IMAP 连接中断",
        _ => ex.Message,
    };
}
