using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Pages.Admin.Users;

[Authorize(Policy = "perm:admin.users")]
public class EditModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    public int Id { get; set; }
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public int RoleId { get; set; }
    [BindProperty] public bool IsActive { get; set; }

    public string Username { get; set; } = "";
    public List<Role> Roles { get; set; } = [];
    public string? Error { get; private set; }
    public bool IsSelf { get; private set; }

    public async Task<IActionResult> OnGetAsync(int id)
    {
        Id = id;
        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();
        Username = user.Username;
        DisplayName = user.DisplayName;
        RoleId = user.RoleId;
        IsActive = user.IsActive;
        Roles = await _db.Roles.OrderBy(r => r.Name).ToListAsync();
        IsSelf = user.Id == SelfId();
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(int id)
    {
        Id = id;
        Roles = await _db.Roles.OrderBy(r => r.Name).ToListAsync();

        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();

        var selfId = SelfId();
        var isSelf = user.Id == selfId;
        IsSelf = isSelf;
        Username = user.Username;

        if (!_db.Roles.Any(r => r.Id == RoleId))
        { Error = "请选择有效角色。"; return Page(); }

        // 防自锁①：不能改自己的角色
        if (isSelf && user.RoleId != RoleId)
        { Error = "不能修改自己的角色，否则可能把自己关在管理后台门外。"; return Page(); }

        // 防自锁②：不能停用自己
        if (isSelf && !IsActive)
        { Error = "不能停用自己的账号。"; return Page(); }

        // 防自锁③：不能让全站失去最后一个有管理权限的账号
        var hadAdmin = await HasAdminPerm(user.RoleId);
        var willHaveAdmin = IsActive && await HasAdminPerm(RoleId);
        if (hadAdmin && !willHaveAdmin)
        {
            var otherAdmins = await _db.Users.CountAsync(u =>
                u.Id != user.Id && u.IsActive &&
                _db.RolePermissions.Any(rp => rp.RoleId == u.RoleId && rp.Permission!.Code == "admin.users"));
            if (otherAdmins == 0)
            { Error = "这是最后一个有管理权限的账号。停用它或改掉它的角色会让全站无人可管，已拒绝。"; return Page(); }
        }

        user.DisplayName = string.IsNullOrWhiteSpace(DisplayName) ? user.Username : DisplayName;
        user.RoleId = RoleId;
        user.IsActive = IsActive;
        await _db.SaveChangesAsync();

        TempData["Ok"] = $"已更新「{user.Username}」。";
        return RedirectToPage("/Admin/Users/Index");
    }

    private int SelfId() =>
        int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var v) ? v : 0;

    private Task<bool> HasAdminPerm(int roleId) =>
        _db.RolePermissions.AnyAsync(rp => rp.RoleId == roleId && rp.Permission!.Code == "admin.users");
}
