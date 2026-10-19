using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Admin.Users;

[Authorize(Policy = "perm:admin.users")]
public class NewModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    [BindProperty] public string Username { get; set; } = "";
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public int RoleId { get; set; }
    [BindProperty] public string Password { get; set; } = "";
    /// <summary>建号时顺手播种「每个模块 3 条」测试数据（默认勾上，方便新用户一进来就有东西看）</summary>
    [BindProperty] public bool SeedSample { get; set; } = true;

    public List<Role> Roles { get; set; } = [];
    public string? Error { get; private set; }

    public void OnGet()
    {
        Roles = _db.Roles.OrderBy(r => r.Name).ToList();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        Roles = _db.Roles.OrderBy(r => r.Name).ToList();

        if (string.IsNullOrWhiteSpace(Username))
        { Error = "用户名不能为空。"; return Page(); }
        if (_db.Users.Any(u => u.Username == Username))
        { Error = "用户名已存在。"; return Page(); }
        if (Password.Length < 8 || !Password.Any(char.IsLetter) || !Password.Any(char.IsDigit))
        { Error = "临时密码至少 8 位，且须同时含字母与数字。"; return Page(); }
        if (!_db.Roles.Any(r => r.Id == RoleId))
        { Error = "请选择有效角色。"; return Page(); }

        var user = new User
        {
            Username = Username,
            DisplayName = string.IsNullOrWhiteSpace(DisplayName) ? Username : DisplayName,
            RoleId = RoleId,
            PasswordHash = PasswordHasher.Hash(Password),
            IsActive = true,
            MustChangePassword = true   // 用户首登强制改
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // 播种测试数据：新账号第一次进工作台就有 3 条/模块的样例，全部带「【测试】」前缀，
        // 用户在自己的个人主页（/Me）里可一键清除，也可以一键再生成。
        var seeded = 0;
        if (SeedSample)
        {
            var includePeriod = SampleData.RoleHas(_db, RoleId, "period.use");
            seeded = SampleData.Seed(_db, user.Id, includePeriod);
        }

        TempData["Ok"] = seeded > 0
            ? $"已建号「{Username}」，并生成 {seeded} 条测试数据（带「{SampleData.Mark}」前缀，用户可在个人主页一键清除）。"
            : $"已建号「{Username}」，该用户首次登录时会被要求改成自己的密码。";
        return RedirectToPage("/Admin/Users/Index");
    }
}
