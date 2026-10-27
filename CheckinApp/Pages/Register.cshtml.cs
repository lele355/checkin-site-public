using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages;

/// <summary>
/// 邀请制注册：本站不做开放注册，必须填对管理员发的邀请码才能提交。
/// 防线按「先便宜后昂贵」排：IP 配额 → 蜜罐 → 一次性令牌 → 填写时长 → 邀请码 → 格式校验 → 落库。
/// 邀请码校验通过 = 注册成功，账号立刻可登录（一码一人，用完即废）。
/// </summary>
[AllowAnonymous]
public class RegisterModel(
    AppDbContext db,
    RegistrationGuard guard,
    RegisterThrottle throttle,
    ILogger<RegisterModel> logger) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly RegistrationGuard _guard = guard;
    private readonly RegisterThrottle _throttle = throttle;
    private readonly ILogger<RegisterModel> _logger = logger;

    [BindProperty] public string Code { get; set; } = "";
    [BindProperty] public string Username { get; set; } = "";
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    [BindProperty] public string Password2 { get; set; } = "";

    /// <summary>
    /// 蜜罐字段：页面上用 CSS 挪出可视区，真人看不见也不会填；自动填表的脚本见到 input 就填。
    /// 名字故意起得像正常字段（Homepage = 个人主页），提高命中率。
    /// </summary>
    [BindProperty] public string Homepage { get; set; } = "";

    [BindProperty] public string FormToken { get; set; } = "";
    [BindProperty] public string FormStamp { get; set; } = "";

    public string? Error { get; private set; }
    public bool Done { get; private set; }
    public string DoneName { get; private set; } = "";

    public IActionResult OnGet()
    {
        if (User.Identity?.IsAuthenticated == true) return RedirectToPage("/Index");
        IssueForm();
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        // ① IP 小时配额：连刷 4 次以上直接挡掉（正常用户注册一次就成功了）
        if (!_throttle.TryAcquire(ip))
        {
            _logger.LogWarning("注册被限流 ip={Ip}", ip);
            IssueForm();
            Error = $"同一网络一分钟内最多提交 {_throttle.PerMinute} 次，请稍后再试。";
            return Page();
        }

        // ② 蜜罐：有值就是脚本。提示保持中性，不要告诉对方「你被识别为机器人」
        if (!string.IsNullOrWhiteSpace(Homepage))
        {
            _logger.LogWarning("注册拦截：蜜罐命中 ip={Ip}", ip);
            IssueForm();
            Error = "请求无效，请刷新页面后重试。";
            return Page();
        }

        // ③ 一次性令牌：挡住「不打开页面、直接 POST 接口」的脚本
        if (!_guard.ConsumeFormToken(FormToken))
        {
            IssueForm();
            Error = "表单已失效（可能已提交过），请重新填写。";
            return Page();
        }

        // ④ 填写时长：真人填 5 个字段不可能 3 秒内交卷；超过 2 小时视为旧表单
        if (!_guard.TimingOk(FormStamp, out var why))
        {
            IssueForm();
            Error = why;
            return Page();
        }

        // ⑤ 邀请码：没有有效邀请码，后面所有校验都免谈
        var normalized = RegistrationGuard.NormalizeCode(Code);
        if (!RegistrationGuard.LooksLikeCode(normalized))
        {
            IssueForm();
            Error = "邀请码格式不对：应为 12 位字母数字，形如 ANLE-8F3K-2Q7M（横杠可省略，全角半角都行）。";
            return Page();
        }

        var now = DateTime.UtcNow;
        var invite = await _db.Invitations
            .Include(i => i.Role)
            .FirstOrDefaultAsync(i => i.Code == normalized);

        if (invite is null || invite.UsedAt is not null || invite.Revoked || invite.ExpiresAt <= now)
        {
            IssueForm();
            Error = "邀请码无效、已被使用或已过期，请找管理员要一个新的。";
            return Page();
        }

        // ⑥ 用户名：2–20 位，只允许中英文/数字/下划线/短横（char.IsLetter 已覆盖汉字）
        var uname = (Username ?? "").Trim();
        if (!IsValidUsername(uname))
        {
            IssueForm();
            Error = "用户名需 2–20 位，只能包含中英文、数字、下划线或短横。";
            return Page();
        }
        if (await _db.Users.AnyAsync(u => u.Username == uname))
        {
            IssueForm();
            Error = "这个用户名已被占用，换一个试试。";
            return Page();
        }

        // ⑦ 密码：与后台建号同一套规则（8 位起，字母+数字）
        if (Password.Length < 8 || !Password.Any(char.IsLetter) || !Password.Any(char.IsDigit))
        {
            IssueForm();
            Error = "密码至少 8 位，且须同时包含字母与数字。";
            return Page();
        }
        if (Password != Password2)
        {
            IssueForm();
            Error = "两次输入的密码不一致。";
            return Page();
        }

        var user = new User
        {
            Username = uname,
            DisplayName = string.IsNullOrWhiteSpace(DisplayName) ? uname : DisplayName.Trim(),
            RoleId = invite.RoleId,
            PasswordHash = PasswordHasher.Hash(Password),
            IsActive = true,
            MustChangePassword = false,   // 自己设的密码，不必再改
            RegisterIp = ip,
        };

        try
        {
            _db.Users.Add(user);
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // 并发下两个请求同名 / 同码：唯一索引兜底，转成人话
            _db.Entry(user).State = EntityState.Detached;
            IssueForm();
            Error = "用户名刚被别人用了，换一个再试。";
            return Page();
        }

        invite.UsedAt = DateTime.UtcNow;
        invite.UsedByUserId = user.Id;
        await _db.SaveChangesAsync();

        _logger.LogInformation("注册提交：{User} role={Role} invite={Code} ip={Ip}",
            user.Username, invite.Role?.Name ?? invite.RoleId.ToString(), normalized, ip);

        Done = true;
        DoneName = user.DisplayName;
        return Page();
    }

    /// <summary>为当前这次渲染签发「一次性令牌 + 加密时间戳」（每次失败后都要重新签发）</summary>
    private void IssueForm()
    {
        FormToken = _guard.NewFormToken();
        FormStamp = _guard.NewFormStamp();
    }

    private static bool IsValidUsername(string s)
    {
        if (s.Length < 2 || s.Length > 20) return false;
        foreach (var ch in s)
        {
            if (char.IsLetterOrDigit(ch)) continue;
            if (ch is '_' or '-') continue;
            return false;
        }
        return true;
    }
}
