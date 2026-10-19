using CheckinApp.Data;
using CheckinApp.Security;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

/// <summary>首登/被重置后强制改密码。改完清掉 MustChangePassword 标志，放行进入站点。</summary>
public class ChangePasswordModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public string OldPassword { get; set; } = "";
    [BindProperty] public string NewPassword { get; set; } = "";
    [BindProperty] public string ConfirmPassword { get; set; } = "";

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        var user = await _db.Users.FindAsync(uid);
        if (user is null) return RedirectToPage("/Login");

        if (!PasswordHasher.Verify(OldPassword, user.PasswordHash))
        {
            ModelState.AddModelError(string.Empty, "临时密码不正确，请向管理员确认。");
            return Page();
        }
        if (NewPassword.Length < 8 || !NewPassword.Any(char.IsLetter) || !NewPassword.Any(char.IsDigit))
        {
            ModelState.AddModelError(string.Empty, "新密码至少 8 位，且须同时包含字母和数字。");
            return Page();
        }
        if (NewPassword == OldPassword)
        {
            ModelState.AddModelError(string.Empty, "新密码不能与临时密码相同。");
            return Page();
        }
        if (NewPassword != ConfirmPassword)
        {
            ModelState.AddModelError(string.Empty, "两次输入的新密码不一致。");
            return Page();
        }

        user.PasswordHash = PasswordHasher.Hash(NewPassword);
        user.MustChangePassword = false;
        await _db.SaveChangesAsync();

        return RedirectToPage("/Index");
    }
}
