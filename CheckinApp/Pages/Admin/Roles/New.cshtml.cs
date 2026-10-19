using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Admin.Roles;

[Authorize(Policy = "perm:admin.roles")]
public class NewModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    [BindProperty] public string Name { get; set; } = "";
    [BindProperty] public string Description { get; set; } = "";
    public string? Error { get; private set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (string.IsNullOrWhiteSpace(Name))
        { Error = "角色名不能为空。"; return Page(); }
        if (_db.Roles.Any(r => r.Name == Name))
        { Error = "角色名已存在。"; return Page(); }

        _db.Roles.Add(new Role { Name = Name, Description = Description, IsBuiltin = false });
        await _db.SaveChangesAsync();
        TempData["Ok"] = $"已创建角色「{Name}」，接下来去编辑它的权限。";
        return RedirectToPage("/Admin/Roles/Index");
    }
}
