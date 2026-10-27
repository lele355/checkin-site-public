using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Pages.Admin.Users;

[Authorize(Policy = "perm:admin.users")]
public class IndexModel(AppDbContext db, ILogger<IndexModel> logger) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly ILogger<IndexModel> _logger = logger;

    public record UserRow(int Id, string Username, string DisplayName, string RoleName, bool IsActive, DateTime CreatedAt, bool IsSelf);

    public List<UserRow> Users { get; set; } = [];

    /// <summary>删除被拒时的提示（自己 / 最后一个管理员 / 找不到）</summary>
    public string? Error { get; private set; }

    public void OnGet() => Load();

    /// <summary>
    /// 删除用户。页面上点「删除」后会先让管理员等 5 秒再能点确认（防手滑），
    /// 但真正的裁决都在这里：不能删自己、不能删掉最后一个有管理权限的账号。
    /// 该用户名下的日程/备忘/打卡/账目等由数据库级联删除（外键都是 Cascade），不可恢复。
    /// </summary>
    public async Task<IActionResult> OnPostDeleteAsync(int id)
    {
        var user = await _db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Id == id);
        if (user is null)
        {
            Load();
            Error = "这个账号已经不存在了（可能刚被删过）。";
            return Page();
        }

        var selfId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var v) ? v : 0;

        // 防自锁①：不能删自己
        if (user.Id == selfId)
        {
            Load();
            Error = "不能删除自己的账号。";
            return Page();
        }

        // 防自锁②：不能删掉最后一个有管理权限的账号（否则全站无人可管）
        if (await HasAdminPerm(user.RoleId))
        {
            var otherAdmins = await _db.Users.CountAsync(u =>
                u.Id != user.Id && u.IsActive &&
                _db.RolePermissions.Any(rp => rp.RoleId == u.RoleId && rp.Permission!.Code == "admin.users"));
            if (otherAdmins == 0)
            {
                Load();
                Error = "「" + user.Username + "」是最后一个有管理权限的账号，删掉就没人能管这个站了，已拒绝。";
                return Page();
            }
        }

        var name = user.Username;
        _db.Users.Remove(user);
        await _db.SaveChangesAsync();

        _logger.LogWarning("用户被删除 id={Id} username={Name} by={SelfId}", id, name, selfId);
        TempData["Ok"] = $"已删除「{name}」及其全部数据。";
        return RedirectToPage("/Admin/Users/Index");
    }

    private void Load()
    {
        var selfId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var v) ? v : 0;
        Users = _db.Users.Include(u => u.Role)
            .OrderBy(u => u.Username)
            .Select(u => new UserRow(u.Id, u.Username, u.DisplayName, u.Role!.Name, u.IsActive, u.CreatedAt, u.Id == selfId))
            .ToList();
    }

    private Task<bool> HasAdminPerm(int roleId) =>
        _db.RolePermissions.AnyAsync(rp => rp.RoleId == roleId && rp.Permission!.Code == "admin.users");
}
