using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Me;

/// <summary>
/// 编辑资料表单片段（dialog.app-modal 装载；提交仍走 /Me?handler=Profile，POST 逻辑不动）。
/// </summary>
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    // 与 MeModel.OnPostProfileAsync 的绑定字段同名，表单提交后由那边接管
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty] public string Signature { get; set; } = "";

    /// <summary>登录名（只读展示，不可改）。</summary>
    public string Username { get; private set; } = "";

    public async Task<IActionResult> OnGetAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var row = await _db.Users.FirstOrDefaultAsync(u => u.Id == uid);
        if (row is null) return RedirectToPage("/Login");

        Username = row.Username;
        DisplayName = row.DisplayName;
        Email = row.Email;
        Signature = row.Signature;
        return Page();
    }
}
