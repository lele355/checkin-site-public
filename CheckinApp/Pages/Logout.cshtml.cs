using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

public class LogoutModel : PageModel
{
    public IActionResult OnGet() => RedirectToPage("/Index");

    /// <param name="switch">1 = 换号而不是退出：走同一条注销路径，只是登录页额外把焦点放在账号框上</param>
    public async Task<IActionResult> OnPostAsync(string? switchTo)
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        // 「切换账号」与「退出」做的事完全一样（清掉本机登录态回登录页），
        // 区别只在意图：切换希望用户落到登录页后立刻在「本机账号」里挑一个。
        // 用查询参数而不是两个 action，避免多写一条几乎相同的表单。
        if (switchTo == "1") return RedirectToPage("/Login", new { pick = 1 });
        return RedirectToPage("/Login");
    }
}