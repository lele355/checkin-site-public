using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Me;

/// <summary>
/// 修改密码表单片段（dialog.app-modal 装载；提交仍走 /Me?handler=Password，POST 逻辑不动）。
/// </summary>
public class PasswordModel(CurrentUser me) : PageModel
{
    private readonly CurrentUser _me = me;

    // 与 MeModel.OnPostPasswordAsync 的绑定字段同名，表单提交后由那边接管
    [BindProperty] public string OldPassword { get; set; } = "";
    [BindProperty] public string NewPassword { get; set; } = "";
    [BindProperty] public string ConfirmPassword { get; set; } = "";

    public IActionResult OnGet()
    {
        if (_me.UserId is not int) return RedirectToPage("/Login");
        return Page();
    }
}
