using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Admin.Roles;

[Authorize(Policy = "perm:admin.roles")]
public class EditModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public bool IsBuiltin { get; set; }
    public HashSet<string> CurrentPerms { get; set; } = [];

    [BindProperty] public string? NameIn { get; set; }
    [BindProperty] public string? DescriptionIn { get; set; }
    [BindProperty] public string[]? Permissions { get; set; }
    public string? Error { get; private set; }

    public async Task<IActionResult> OnGetAsync(int id)
    {
        Id = id;
        var role = await _db.Roles.Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
            .FirstOrDefaultAsync(r => r.Id == id);
        if (role is null) return NotFound();
        Name = role.Name;
        Description = role.Description;
        IsBuiltin = role.IsBuiltin;
        CurrentPerms = role.RolePermissions.Select(rp => rp.Permission!.Code).ToHashSet();
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(int id)
    {
        Id = id;
        var role = await _db.Roles.Include(r => r.RolePermissions).FirstOrDefaultAsync(r => r.Id == id);
        if (role is null) return NotFound();
        IsBuiltin = role.IsBuiltin;

        // 内置角色名不可改（Seeder 依赖），非内置可改
        if (!role.IsBuiltin)
        {
            if (string.IsNullOrWhiteSpace(NameIn))
            { Error = "角色名不能为空。"; return await ReloadAsync(role); }
            if (await _db.Roles.AnyAsync(r => r.Id != id && r.Name == NameIn))
            { Error = "角色名已存在。"; return await ReloadAsync(role); }
            role.Name = NameIn!;
        }
        role.Description = DescriptionIn ?? "";

        var selected = (Permissions ?? Array.Empty<string>()).ToHashSet();
        var known = PermissionCatalog.All.Select(p => p.Code).ToHashSet();

        // 同步权限：删旧的，加选中的（只认白名单里的码）
        _db.RolePermissions.RemoveRange(role.RolePermissions);
        var perms = await _db.Permissions.ToListAsync();
        foreach (var p in perms.Where(p => selected.Contains(p.Code) && known.Contains(p.Code)))
            _db.RolePermissions.Add(new RolePermission { RoleId = id, PermissionId = p.Id });

        // 防全站无主：至少要有一个角色保留「用户管理」权限
        var otherHasAdmin = await _db.RolePermissions.AnyAsync(rp => rp.RoleId != id && rp.Permission!.Code == "admin.users");
        if (!otherHasAdmin && !selected.Contains("admin.users"))
        {
            // 不 SaveChanges，变更随请求结束丢弃
            Error = "至少要有一个角色保留「用户管理（admin.users）」权限，否则全站无人能进后台。已拒绝。";
            return await ReloadAsync(role);
        }

        await _db.SaveChangesAsync();
        TempData["Ok"] = $"已更新角色「{role.Name}」的权限，即时生效。";
        return RedirectToPage("/Admin/Roles/Index");
    }

    private async Task<IActionResult> ReloadAsync(Role role)
    {
        Name = role.Name; Description = role.Description;
        CurrentPerms = (Permissions ?? Array.Empty<string>()).ToHashSet();
        return Page();
    }
}
