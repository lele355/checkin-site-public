using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Api;

/// <summary>邮件：账号绑定 / 合并收件箱 / 读信（正文首次阅读时才拉取）/ 手动同步。</summary>
public static class EmailApi
{
    public record SyncScopeReq(int? SyncDays, int? SyncCount);
    public record MarkReadReq(int? AccountId, string? FromAddress);
    public record AccountReq(string? DisplayName, string? Address, string? Provider,
                             string? ImapHost, int? ImapPort, string? SmtpHost, int? SmtpPort, string? AuthCode,
                             // 同步范围（天 / 封）。留空或 0 = 跟全局默认
                             int? SyncDays = null, int? SyncCount = null);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/email").RequireAuthorization("perm:email.use");

        // ---------- 服务商预设（绑定页下拉用） ----------
        g.MapGet("/providers", () => ApiKit.Ok(new
        {
            items = EmailProviders.All.Select(p => new
            {
                key = p.Key, label = p.Label, imapHost = p.ImapHost, imapPort = p.ImapPort,
                smtpHost = p.SmtpHost, smtpPort = p.SmtpPort,
            }),
        }));

        // ---------- 账号列表（授权码永不回显） ----------
        g.MapGet("/accounts", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var items = db.EmailAccounts.Where(a => a.UserId == uid).OrderBy(a => a.Id).ToList()
                .Select(a => new
                {
                    id = a.Id, displayName = a.DisplayName, address = a.Address,
                    provider = a.Provider, providerLabel = EmailProviders.LabelOf(a.Provider),
                    imapHost = a.ImapHost, imapPort = a.ImapPort,
                    smtpHost = a.SmtpHost, smtpPort = a.SmtpPort,
                    hasAuthCode = a.AuthCodeEnc.Length > 0,
                    lastSyncAt = ApiKit.StampUtc(a.LastSyncAt ?? default),
                    lastSyncError = a.LastSyncError,
                    unread = db.EmailMessages.Count(m => m.AccountId == a.Id && !m.IsRead),
                    // 同步范围：0 = 跟全局默认（下面那两个 setting）
                    syncDays = a.SyncDays,
                    syncCount = a.SyncCount,
                }).ToList();

            int readInt(string key, int d)
            {
                var row = db.AppSettings.FirstOrDefault(x => x.Key == key);
                return row is not null && int.TryParse(row.Value, out var v) && v > 0 ? v : d;
            }
            return ApiKit.Ok(new
            {
                items,
                unreadTotal = db.EmailMessages.Count(m => m.UserId == uid && !m.IsRead),
                // 全局默认（账号没单独设时用它）
                defaultSyncDays = readInt("email.sync-days", 7),
                defaultSyncCount = readInt("email.sync-count", 40),
            });
        });

        // ---------- 全局默认同步范围（「最近 xx 天 / 最近 xx 封」） ----------
        g.MapGet("/settings", (AppDbContext db, HttpContext ctx) =>
        {
            int readInt(string key, int d)
            {
                var row = db.AppSettings.FirstOrDefault(x => x.Key == key);
                return row is not null && int.TryParse(row.Value, out var v) && v > 0 ? v : d;
            }
            return ApiKit.Ok(new { syncDays = readInt("email.sync-days", 7), syncCount = readInt("email.sync-count", 40) });
        });

        g.MapPost("/settings", (SyncScopeReq req, AppDbContext db, HttpContext ctx) =>
        {
            void write(string key, int val, int def)
            {
                var v = val > 0 ? val : def;
                var row = db.AppSettings.FirstOrDefault(x => x.Key == key);
                if (row is null) db.AppSettings.Add(new AppSetting { Key = key, Value = v.ToString() });
                else row.Value = v.ToString();
            }
            write("email.sync-days", req.SyncDays ?? 0, 7);
            write("email.sync-count", req.SyncCount ?? 0, 40);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ---------- 绑定 ----------
        g.MapPost("/accounts", (AccountReq req, AppDbContext db, EmailCrypto crypto, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var (display, address, provider, imapHost, imapPort, smtpHost, smtpPort, code) = Validate(req);
            if (db.EmailAccounts.Any(a => a.UserId == uid && a.Address == address))
                return ApiKit.Err("这个邮箱已经绑定过了");

            var ac = new EmailAccount
            {
                UserId = uid, DisplayName = display, Address = address, Provider = provider,
                ImapHost = imapHost, ImapPort = imapPort, SmtpHost = smtpHost, SmtpPort = smtpPort,
                AuthCodeEnc = crypto.Encrypt(code), CreatedAt = DateTime.UtcNow,
                SyncDays = Math.Clamp(req.SyncDays ?? 0, 0, 3650),
                SyncCount = Math.Clamp(req.SyncCount ?? 0, 0, 500),
            };
            db.EmailAccounts.Add(ac);
            db.SaveChanges();
            return ApiKit.Ok(new { id = ac.Id });
        });

        // ---------- 修改（授权码留空 = 不改） ----------
        g.MapPut("/accounts/{id:int}", (int id, AccountReq req, AppDbContext db, EmailCrypto crypto, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var ac = db.EmailAccounts.FirstOrDefault(a => a.Id == id && a.UserId == uid)
                     ?? throw new ApiBadRequest("邮箱账号不存在");
            var (display, address, provider, imapHost, imapPort, smtpHost, smtpPort, code) = Validate(req, ac.Id, uid);

            ac.DisplayName = display; ac.Address = address; ac.Provider = provider;
            ac.ImapHost = imapHost; ac.ImapPort = imapPort; ac.SmtpHost = smtpHost; ac.SmtpPort = smtpPort;
            // 同步范围：传 null 表示不改；0 = 退回「跟全局默认」
            if (req.SyncDays is int sd) ac.SyncDays = Math.Clamp(sd, 0, 3650);
            if (req.SyncCount is int sc) ac.SyncCount = Math.Clamp(sc, 0, 500);
            if (code.Length > 0) ac.AuthCodeEnc = crypto.Encrypt(code);
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        g.MapDelete("/accounts/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var ac = db.EmailAccounts.FirstOrDefault(a => a.Id == id && a.UserId == uid);
            if (ac is null) return ApiKit.NotFound("邮箱账号不存在");
            db.EmailAccounts.Remove(ac);   // 级联删缓存信件
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ---------- 合并收件箱 ----------
        g.MapGet("/messages", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var accountId = ApiKit.IntQ(ctx, "account", 0);
            var before = ApiKit.IntQ(ctx, "before", 0);
            var onlyUnread = ApiKit.StrQ(ctx, "unread") == "1";

            var q = db.EmailMessages.AsNoTracking().Where(m => m.UserId == uid);
            if (accountId > 0) q = q.Where(m => m.AccountId == accountId);
            if (before > 0) q = q.Where(m => m.Id < before);
            if (onlyUnread) q = q.Where(m => !m.IsRead);

            var labels = db.EmailAccounts.Where(a => a.UserId == uid)
                .ToDictionary(a => a.Id, a => a.DisplayName);

            var items = q.OrderByDescending(m => m.SentAt).Take(50).ToList()
                .Select(m => new
                {
                    id = m.Id, account = labels.GetValueOrDefault(m.AccountId, "已删除账号"),
                    fromName = m.FromName, fromAddress = m.FromAddress, subject = m.Subject,
                    snippet = m.Snippet, sentAt = ApiKit.StampUtc(m.SentAt),
                    isRead = m.IsRead, hasAttachment = m.HasAttachment, sizeBytes = m.SizeBytes,
                }).ToList();

            return ApiKit.Ok(new { items, hasMore = items.Count == 50 });
        });

        // ---------- 一键已读 ----------
        // 三个粒度：全部（不传参）/ 某账号（account=）/ 某发件人（from=，配合聚合列表用）
        g.MapPost("/messages/mark-all-read", (MarkReadReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var q = db.EmailMessages.Where(m => m.UserId == uid && !m.IsRead);
            if (req.AccountId is int aid && aid > 0) q = q.Where(m => m.AccountId == aid);
            if (!string.IsNullOrWhiteSpace(req.FromAddress))
                q = q.Where(m => m.FromAddress == req.FromAddress.Trim());
            var n = q.ExecuteUpdate(u => u.SetProperty(x => x.IsRead, true));
            return ApiKit.Ok(new { marked = n });
        });

        // ---------- 按发件人聚合（同一发件人的信并成一组） ----------
        // 列表模式是「按时间倒序的平铺」，信多的时候同一个发件人会散落各处；
        // 聚合模式把它们归到一行：发件人 / 未读数 / 最近一封标题与时间。
        g.MapGet("/messages/grouped", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var accountId = ApiKit.IntQ(ctx, "account", 0);
            var limit = Math.Clamp(ApiKit.IntQ(ctx, "limit", 50), 1, 200);

            var q = db.EmailMessages.AsNoTracking().Where(m => m.UserId == uid);
            if (accountId > 0) q = q.Where(m => m.AccountId == accountId);

            var groups = q.ToList()
                .GroupBy(m => string.IsNullOrWhiteSpace(m.FromAddress) ? (m.FromName ?? "").Trim() : m.FromAddress.Trim().ToLowerInvariant())
                .Select(g =>
                {
                    var rows = g.OrderByDescending(x => x.SentAt).ToList();
                    var last = rows[0];
                    return new
                    {
                        // 同组 key 可能是邮箱也可能只有名字，前端展示用 name+address
                        fromName = last.FromName, fromAddress = last.FromAddress,
                        unread = rows.Count(x => !x.IsRead),
                        total = rows.Count,
                        lastSubject = last.Subject,
                        lastSnippet = last.Snippet,
                        lastAt = ApiKit.StampUtc(last.SentAt),
                        // 这一组最新的那封（点进去读）
                        lastId = last.Id,
                        // 一键已读时给它
                        groupKey = string.IsNullOrWhiteSpace(last.FromAddress) ? "" : last.FromAddress.Trim(),
                    };
                })
                .OrderByDescending(x => x.lastAt)
                .Take(limit)
                .ToList();

            return ApiKit.Ok(new { items = groups, hasMore = groups.Count == limit });
        });

        // ---------- 读信（正文首次阅读时才去 IMAP 拉，之后走缓存） ----------
        g.MapGet("/messages/{id:int}", async (int id, AppDbContext db, EmailSyncService sync,
                                              HttpContext ctx, CancellationToken ct) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.EmailMessages.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (m is null) return ApiKit.NotFound("信件不存在");

            var body = m.BodyText;
            var err = "";
            if (string.IsNullOrEmpty(body))
            {
                var r = await sync.FetchBodyAsync(id, uid, ct);
                if (r.Ok) body = r.Text; else err = r.Error;
                m = db.EmailMessages.First(x => x.Id == id);
            }

            if (!m.IsRead) { m.IsRead = true; db.SaveChanges(); }

            return ApiKit.Ok(new
            {
                id = m.Id,
                fromName = m.FromName, fromAddress = m.FromAddress, toAddress = m.ToAddress,
                subject = m.Subject, sentAt = ApiKit.StampUtc(m.SentAt),
                hasAttachment = m.HasAttachment, body, bodyError = err,
            });
        });

        // ---------- 已读 / 未读 ----------
        g.MapPost("/messages/{id:int}/read", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.EmailMessages.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (m is null) return ApiKit.NotFound("信件不存在");
            m.IsRead = !m.IsRead;
            db.SaveChanges();
            return ApiKit.Ok(new { isRead = m.IsRead });
        });

        // ---------- 同步 ----------
        g.MapPost("/sync", async (AppDbContext db, EmailSyncService sync, HttpContext ctx, CancellationToken ct) =>
        {
            var uid = ApiKit.MeId(ctx);
            var accountId = ApiKit.IntQ(ctx, "account", 0);
            var q = db.EmailAccounts.Where(a => a.UserId == uid);
            if (accountId > 0) q = q.Where(a => a.Id == accountId);

            var notes = new List<object>();
            foreach (var ac in q.ToList())
            {
                var r = await sync.SyncAsync(ac.Id, uid, ct);
                notes.Add(new
                {
                    id = ac.Id, name = ac.DisplayName,
                    ok = r.Ok, added = r.NewCount, error = r.Error,
                });
            }
            return ApiKit.Ok(new { results = notes });
        });
    }

    private static (string Display, string Address, string Provider, string ImapHost, int ImapPort,
                    string SmtpHost, int SmtpPort, string Code) Validate(AccountReq req, int id = 0, int uid = 0)
    {
        var address = ApiKit.Cut(req.Address, 120).ToLowerInvariant();
        var at = address.IndexOf('@');
        if (at <= 0 || at == address.Length - 1 || !address[(at + 1)..].Contains('.'))
            throw new ApiBadRequest("邮箱地址格式不对");

        var provider = string.IsNullOrWhiteSpace(req.Provider) ? "custom" : req.Provider!;
        var preset = EmailProviders.Find(provider);

        var imapHost = ApiKit.Cut(req.ImapHost, 80);
        var imapPort = req.ImapPort ?? 0;
        var smtpHost = ApiKit.Cut(req.SmtpHost, 80);
        var smtpPort = req.SmtpPort ?? 0;
        if (preset is not null)
        {
            if (imapHost.Length == 0) imapHost = preset.ImapHost;
            if (imapPort <= 0) imapPort = preset.ImapPort;
            if (smtpHost.Length == 0) smtpHost = preset.SmtpHost;
            if (smtpPort <= 0) smtpPort = preset.SmtpPort;
        }
        if (imapHost.Length == 0) throw new ApiBadRequest("IMAP 服务器地址不能为空");
        if (imapPort is <= 0 or > 65535) imapPort = 993;
        if (smtpPort is < 0 or > 65535) smtpPort = 465;

        var code = (req.AuthCode ?? "").Trim();
        if (id == 0 && code.Length == 0) throw new ApiBadRequest("请填授权码（不是登录密码）");

        var display = ApiKit.Cut(req.DisplayName, 40);
        if (display.Length == 0) display = address;

        return (display, address, provider, imapHost, imapPort, smtpHost, smtpPort, code);
    }
}
