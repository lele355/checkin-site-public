using CheckinApp.Data;
using CheckinApp.Security;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace CheckinApp.Api;

/// <summary>登录 / 登出 / 我的资料 / 改密 / 偏好。App 侧全部走 Bearer，与网站 Cookie 互不影响。</summary>
public static class AuthApi
{
    public record LoginReq(string? Username, string? Password, string? Device);

    public record RegisterReq(string? Code, string? Username, string? DisplayName, string? Password);

    public record PrefsReq(
        string? Theme, string? Accent, string? Tone,
        string[]? NavHidden, string? DashboardLayout,
        string? DisplayName, string? Email, string? Signature);

    public record PasswordReq(string? OldPassword, string? NewPassword);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1");

        // ---------- 登录（换取 Bearer） ----------
        g.MapPost("/auth/login", (LoginReq req, HttpContext ctx, AppDbContext db,
                                  ApiTokenService tokens, LoginRateLimiter limiter) =>
        {
            var username = (req.Username ?? "").Trim();
            var password = req.Password ?? "";
            var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "?";

            if (username.Length == 0 || password.Length == 0)
                return ApiKit.Err("请输入账号和密码");

            if (limiter.IsLocked(username, ip))
            {
                var mins = limiter.GetLockMinutes(username, ip) ?? 10;
                return ApiKit.Err($"尝试次数过多，请 {mins} 分钟后再试", 429);
            }

            var user = db.Users.FirstOrDefault(u => u.Username == username);
            if (user is null || !user.IsActive || !PasswordHasher.Verify(password, user.PasswordHash))
            {
                limiter.RecordFailure(username, ip);
                var left = limiter.GetRemaining(username, ip);
                return ApiKit.Err(left > 0 ? $"账号或密码不对，还可尝试 {left} 次" : "尝试次数过多，请稍后再试", 401);
            }

            limiter.Reset(username, ip);
            user.LastLoginAt = DateTime.UtcNow;
            db.SaveChanges();

            var (token, row) = tokens.Issue(user.Id, req.Device ?? "app");
            return ApiKit.Ok(new
            {
                token,
                expiresAt = ApiKit.StampUtc(row.ExpiresAt),
                user = ApiDtos.Me(db, user.Id),
            });
        }).AllowAnonymous();

        // ---------- 注册（App 内自助注册，与网页 Register 同一套规则） ----------
        // 与网页版差异：不做「一次性表单令牌 / 填写时长」那两道 —— 那是防网页脚本批量提交的，
        // App 是装在手机上的应用，这两道在原生界面里没意义。保留 IP 限流 + 邀请码 + 格式校验。
        g.MapPost("/auth/register", async (RegisterReq req, HttpContext ctx, AppDbContext db,
            CheckinApp.Services.RegisterThrottle throttle) =>
        {
            var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

            if (!throttle.TryAcquire(ip))
                return ApiKit.Err($"提交太频繁，一分钟内最多 {throttle.PerMinute} 次，请稍后再试");

            // 邀请码只留字母数字：横杠加不加、全角半角都一样
            var code = CheckinApp.Services.RegistrationGuard.NormalizeCode(req.Code);
            if (!CheckinApp.Services.RegistrationGuard.LooksLikeCode(code))
                return ApiKit.Err("邀请码格式不对：应为 12 位字母数字，形如 ANLE-8F3K-2Q7M（横杠可省略）");

            var now = DateTime.UtcNow;
            var invite = await db.Invitations.Include(i => i.Role)
                .FirstOrDefaultAsync(i => i.Code == code);
            if (invite is null || invite.UsedAt is not null || invite.Revoked || invite.ExpiresAt <= now)
                return ApiKit.Err("邀请码无效、已被使用或已过期，请找管理员要一个新的");

            var uname = (req.Username ?? "").Trim();
            if (!IsValidUsername(uname))
                return ApiKit.Err("用户名需 2–20 位，只能包含中英文、数字、下划线或短横");
            if (await db.Users.AnyAsync(u => u.Username == uname))
                return ApiKit.Err("这个用户名已被占用，换一个试试");

            var pwd = req.Password ?? "";
            if (pwd.Length < 8 || !pwd.Any(char.IsLetter) || !pwd.Any(char.IsDigit))
                return ApiKit.Err("密码至少 8 位，且须同时包含字母与数字");

            var user = new CheckinApp.Models.User
            {
                Username = uname,
                DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? uname : req.DisplayName!.Trim(),
                RoleId = invite.RoleId,
                PasswordHash = CheckinApp.Security.PasswordHasher.Hash(pwd),
                IsActive = true,
                MustChangePassword = false,
                RegisterIp = ip,
            };

            try
            {
                db.Users.Add(user);
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                db.Entry(user).State = EntityState.Detached;
                return ApiKit.Err("用户名刚被别人用了，换一个再试");
            }

            invite.UsedAt = now;
            invite.UsedByUserId = user.Id;
            await db.SaveChangesAsync();

            return ApiKit.Ok(new { id = user.Id, username = user.Username, displayName = user.DisplayName });
        }).AllowAnonymous();

        // ---------- 登出（吊销当前令牌） ----------
        g.MapPost("/auth/logout", (HttpContext ctx, ApiTokenService tokens) =>
        {
            var raw = ApiTokenAccessor.RawToken(ctx);
            if (raw is not null) tokens.Revoke(raw);
            return ApiKit.Ok();
        });

        // ---------- 启动包：用户 + 权限 + 导航 + 主题 ----------
        // App 每次冷启动只调这一个接口，就把「侧栏显示什么、谁能看什么、用什么主题」全拿到。
        g.MapGet("/me", (HttpContext ctx, AppDbContext db) =>
            ApiKit.Ok(ApiDtos.Me(db, ApiKit.MeId(ctx))));

        // ---------- 改密码 ----------
        g.MapPost("/me/password", (PasswordReq req, HttpContext ctx, AppDbContext db,
                                   ApiTokenService tokens) =>
        {
            var id = ApiKit.MeId(ctx);
            var u = db.Users.First(x => x.Id == id);
            var oldPwd = req.OldPassword ?? "";
            var newPwd = req.NewPassword ?? "";

            if (!PasswordHasher.Verify(oldPwd, u.PasswordHash))
                return ApiKit.Err("当前密码不对");

            if (newPwd.Length < 8) return ApiKit.Err("新密码至少 8 位");
            if (newPwd.Length > 64) return ApiKit.Err("新密码最长 64 位");
            if (newPwd == oldPwd) return ApiKit.Err("新密码不能和旧密码一样");

            u.PasswordHash = PasswordHasher.Hash(newPwd);
            u.MustChangePassword = false;
            db.SaveChanges();

            // 改密后其它设备上的令牌一律作废，只留当前这台
            var currentId = 0;
            var raw = ApiTokenAccessor.RawToken(ctx);
            if (raw is not null)
            {
                var t = tokens.Validate(raw);
                currentId = t?.Id ?? 0;
            }
            tokens.RevokeAll(id, currentId);

            return ApiKit.Ok(new { user = ApiDtos.Me(db, id) });
        });

        // ---------- 保存偏好（主题 / 侧栏隐藏 / 工作台布局 / 个人资料） ----------
        g.MapPut("/me/prefs", (PrefsReq req, HttpContext ctx, AppDbContext db) =>
        {
            var id = ApiKit.MeId(ctx);
            var u = db.Users.First(x => x.Id == id);

            // 主题三件套有白名单，脏值一律忽略（别把库写成前端随便传的字符串）
            if (req.Theme is not null && ApiDtos.ThemeSet.Contains(req.Theme)) u.Theme = req.Theme;
            if (req.Accent is not null && ApiDtos.AccentSet.Contains(req.Accent)) u.Accent = req.Accent;
            if (req.Tone is not null && ApiDtos.ToneSet.Contains(req.Tone)) u.Tone = req.Tone;

            // 侧栏隐藏：只接受已知导航 code，避免存垃圾
            if (req.NavHidden is not null)
            {
                var known = CheckinApp.Security.NavCatalog.Items.Select(n => n.Code).ToHashSet();
                var clean = req.NavHidden.Where(known.Contains).Distinct().ToList();
                u.NavHidden = clean.Count == 0 ? "" : JsonSerializer.Serialize(clean);
            }

            // 工作台布局：只做大小 + JSON 合法性校验（卡片 id 的完整白名单在网页端维护）
            if (req.DashboardLayout is not null)
            {
                if (req.DashboardLayout.Length > 2000) return ApiKit.Err("布局数据过大");
                if (req.DashboardLayout.Length > 0)
                {
                    try { using var _ = JsonDocument.Parse(req.DashboardLayout); }
                    catch (JsonException) { return ApiKit.Err("布局格式不对"); }
                }
                u.DashboardLayout = req.DashboardLayout;
            }

            // 个人资料
            if (req.DisplayName is not null)
            {
                var n = ApiKit.Cut(req.DisplayName, 20);
                if (n.Length == 0) return ApiKit.Err("昵称不能为空");
                u.DisplayName = n;
            }
            if (req.Email is not null)
            {
                var e = ApiKit.Cut(req.Email, 100);
                if (e.Length > 0 && (!e.Contains('@') || e.StartsWith('@') || e.EndsWith('@')))
                    return ApiKit.Err("邮箱格式不对");
                u.Email = e;
            }
            if (req.Signature is not null) u.Signature = ApiKit.Cut(req.Signature, 60);

            db.SaveChanges();
            return ApiKit.Ok(new { user = ApiDtos.Me(db, id) });
        });

        // ---------- 完整更新日志（App 内「设置 → 更新日志」） ----------
        // 数据来自 appsettings.json 的 App:Changelog（每版一条），不用改代码，
        // 以后发版只要往那个数组里补一条即可。
        g.MapGet("/app/changelog", (IConfiguration cfg) =>
        {
            var items = cfg.GetSection("App:Changelog").GetChildren()
                .Select(c => new
                {
                    version = c["version"] ?? "",
                    versionCode = int.TryParse(c["versionCode"], out var vc) ? vc : 0,
                    date = c["date"] ?? "",
                    notes = c["notes"] ?? "",
                })
                .Where(x => x.version.Length > 0)
                .ToList();
            return ApiKit.Ok(new { items });
        }).AllowAnonymous();   // 更新日志公开可读（未登录也能看，和 /app/version 一致）

        // ---------- 版本信息（App 内「检查更新」用） ----------
        g.MapGet("/app/version", (IConfiguration cfg) =>
        {
            var v = cfg.GetSection("App");
            return ApiKit.Ok(new
            {
                version = v["ClientVersion"] ?? "2.0.0",
                versionCode = int.TryParse(v["ClientVersionCode"], out var c) ? c : 2,
                url = v["ClientApk"] ?? "/download/app-release.apk",
                notes = v["ClientNotes"] ?? "",
                // 两个备案号都随接口下发：法规要求「关于/设置」页显著位置标注，
                // 但号一旦要更正（补正、换号）就得重新发版，所以不写死在 APK 里。
                // 空串 = 服务端没配，App 端回落到内置的兜底常量。
                beiAn = v["AppBeiAn"] ?? "",
                // 公安联网备案是独立的一套号（每个网站/App 各一个），
                // 不能拿网站的 `陕公网安备…01655号` 顶上 —— 那是网站的备案。
                policeBeiAn = v["AppPoliceBeiAn"] ?? "",
            });
        }).AllowAnonymous();
    }

    /// <summary>用户名规则：2–20 位，只允许中英文/数字/下划线/短横（与网页注册一致）</summary>
    private static bool IsValidUsername(string s)
    {
        if (s.Length < 2 || s.Length > 20) return false;
        foreach (var ch in s)
        {
            if (!char.IsLetterOrDigit(ch) && ch != '_' && ch != '-') return false;
        }
        return true;
    }
}
