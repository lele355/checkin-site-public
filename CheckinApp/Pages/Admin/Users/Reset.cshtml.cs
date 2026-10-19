using CheckinApp.Data;
using CheckinApp.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Admin.Users;

[Authorize(Policy = "perm:admin.users")]
public class ResetModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    public int Id { get; set; }
    public string Username { get; set; } = "";
    [BindProperty] public string Password { get; set; } = "";
    public string? Error { get; private set; }

    public async Task<IActionResult> OnGetAsync(int id)
    {
        Id = id;
        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();
        Username = user.Username;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(int id)
    {
        Id = id;
        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();
        Username = user.Username;

        if (Password.Length < 8 || !Password.Any(char.IsLetter) || !Password.Any(char.IsDigit))
        { Error = "新临时密码至少 8 位，且须同时含字母与数字。"; return Page(); }

        user.PasswordHash = PasswordHasher.Hash(Password);
        user.MustChangePassword = true;   // 重置后再次强制改
        await _db.SaveChangesAsync();

        TempData["Ok"] = $"已重置「{user.Username}」的密码。该用户下次登录会被要求改成自己的密码。";
        return RedirectToPage("/Admin/Users/Index");
    }
}
