using CheckinApp.Data;
using CheckinApp.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Pages;

[AllowAnonymous]
public class LoginModel(AppDbContext db, LoginRateLimiter limiter) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly LoginRateLimiter _limiter = limiter;

    [BindProperty] public string Username { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    /// <summary>密码保存方式：autologin=下次自动进入跳过登录页；prefill=仅填充密码；none=不保存</summary>
    [BindProperty] public string RememberMode { get; set; } = "none";
    /// <summary>从「切换账号」过来时置 1：登录页把「本机账号」列表提前到最上面</summary>
    public bool PickMode { get; private set; }
    public string? Error { get; private set; }
    public int Remaining { get; private set; } = -1;      // 还可尝试次数；-1 = 不提示
    public int? LockMinutes { get; private set; }          // 锁定剩余分钟

    public IActionResult OnGet(int? pick = null)
    {
        // 已登录再来登录页 = 直接进工作台（登录进去后的默认落地页固定为主界面工作台）
        if (User.Identity?.IsAuthenticated == true) return RedirectToPage("/Index");
        PickMode = pick == 1;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        if (_limiter.IsLocked(Username, ip))
        {
            LockMinutes = _limiter.GetLockMinutes(Username, ip) ?? 10;
            Error = $"失败次数过多，账号已临时锁定，请约 {LockMinutes} 分钟后再试。";
            return Page();
        }

        var user = await _db.Users.Include(u => u.Role)
                                  .FirstOrDefaultAsync(u => u.Username == Username);

        // 统一错误文案，不泄露「账号存在与否」（剩余次数与账号是否存在无关，安全）
        if (user is null || !user.IsActive || !PasswordHasher.Verify(Password ?? "", user.PasswordHash))
        {
            _limiter.RecordFailure(Username, ip);
            Remaining = _limiter.GetRemaining(Username, ip);
            LockMinutes = _limiter.GetLockMinutes(Username, ip);
            if (LockMinutes is { } m) Error = $"失败次数过多，账号已临时锁定，请约 {m} 分钟后再试。";
            else if (Remaining > 0) Error = $"账号或密码不正确，还可尝试 {Remaining} 次（超出后将锁定 10 分钟）。";
            else Error = "账号或密码不正确。";
            return Page();
        }

        _limiter.Reset(Username, ip);
        user.LastLoginAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new("DisplayName", user.DisplayName),
        };
        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        // 密码保存方式（登录页单选）：
        //   autologin = 30 天持久登录（下次进站跳过登录页），绝对票不滑动续期
        //   prefill / none = 空闲 2 小时过期的滑动票（活跃续命；停手 2 小时被登出，
        //     防浏览器常驻后台/启动增强让会话长生不死，历史记录直达内部页）
        //     prefill 由前端预填密码，过期后点一下就能重登
        var autoLogin = string.Equals(RememberMode, "autologin", StringComparison.OrdinalIgnoreCase);
        var props = new AuthenticationProperties
        {
            IsPersistent = autoLogin,
            ExpiresUtc = autoLogin ? DateTimeOffset.UtcNow.AddDays(30) : null,
            // 自动进入 = 30 天绝对票，不允许滑动把过期时间往后推（否则会变成无限续期）；
            // 其余 = 走 options 的 2h 滑动过期，活跃续命、空闲 2 小时失效
            AllowRefresh = !autoLogin,
        };
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), props);

        // 登录进去后的默认落地页固定为主界面工作台（不再跟随深链接 ReturnUrl）
        return RedirectToPage("/Index");
    }
}
