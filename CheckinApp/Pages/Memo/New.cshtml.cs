using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Memo;

[Authorize(Policy = "perm:memo.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public string Title { get; set; } = "";
    [BindProperty] public string Body { get; set; } = "";
    [BindProperty] public bool Pinned { get; set; }
    public string? Error { get; private set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(Title))
        { Error = "标题不能为空。"; return Page(); }

        var now = DateTime.UtcNow;
        _db.Memos.Add(new MemoItem
        {
            UserId = uid,
            Title = Title.Trim(),
            Content = Body?.Trim() ?? "",
            Pinned = Pinned,
            CreatedAt = now,
            UpdatedAt = now
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Memo/Index");
    }
}
