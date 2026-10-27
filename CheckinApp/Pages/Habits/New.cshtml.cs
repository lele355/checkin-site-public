using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Habits;

[Authorize(Policy = "perm:habits.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public string Name { get; set; } = "";
    [BindProperty] public string Icon { get; set; } = "🌱";
    public string? Error { get; private set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(Name))
        { Error = "习惯名称不能为空。"; return Page(); }

        _db.Habits.Add(new Habit
        {
            UserId = uid,
            Name = Name.Trim(),
            Icon = string.IsNullOrWhiteSpace(Icon) ? "🌱" : Icon.Trim(),
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Habits/Index");
    }
}
