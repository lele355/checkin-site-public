using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Admin.Roles;

[Authorize(Policy = "perm:admin.roles")]
public class IndexModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    public record RoleRow(int Id, string Name, string Description, bool IsBuiltin, int PermCount, int UserCount);

    public List<RoleRow> Roles { get; set; } = [];

    public void OnGet()
    {
        // 先把角色 + 关联拉到内存（小站数据量极小），再在客户端投影 + Count
        // 直接在 SQL 投影里用导航属性 Count 会触发 EF 翻译失败
        var roles = _db.Roles.Include(r => r.RolePermissions).Include(r => r.Users).ToList();
        Roles = roles
            .Select(r => new RoleRow(
                r.Id, r.Name, r.Description, r.IsBuiltin,
                r.RolePermissions.Count,
                r.Users.Count))
            .OrderBy(r => r.IsBuiltin ? 0 : 1).ThenBy(r => r.Name)
            .ToList();
    }

    public async Task<IActionResult> OnPostDeleteAsync(int id)
    {
        var role = await _db.Roles.Include(r => r.Users).FirstOrDefaultAsync(r => r.Id == id);
        if (role is null) return NotFound();

        if (role.IsBuiltin)
        { TempData["Err"] = "内置角色不可删除（它是系统骨架）。"; return RedirectToPage(); }
        if (role.Users.Count > 0)
        { TempData["Err"] = $"该角色下还有 {role.Users.Count} 个用户，请先把他们改到别的角色再删。"; return RedirectToPage(); }

        var perms = _db.RolePermissions.Where(rp => rp.RoleId == id);
        _db.RolePermissions.RemoveRange(perms);
        _db.Roles.Remove(role);
        await _db.SaveChangesAsync();
        TempData["Ok"] = $"已删除角色「{role.Name}」。";
        return RedirectToPage();
    }
}
