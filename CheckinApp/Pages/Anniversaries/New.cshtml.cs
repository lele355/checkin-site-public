using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Anniversaries;

[Authorize(Policy = "perm:anniversary.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public string Title { get; set; } = "";
    [BindProperty] public DateTime Date { get; set; } = DateTime.Today;
    [BindProperty] public bool RepeatYearly { get; set; } = true;
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(Title))
        { Error = "标题不能为空。"; return Page(); }

        var now = DateTime.UtcNow;
        _db.Anniversaries.Add(new AnniversaryItem
        {
            UserId = uid,
            Title = Title.Trim(),
            Date = Date.Date,
            RepeatYearly = RepeatYearly,
            Note = Note?.Trim() ?? "",
            CreatedAt = now,
            UpdatedAt = now
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Anniversaries/Index");
    }
}
