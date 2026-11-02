using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.LoveNotes;

/// <summary>
/// 小纸条 —— 情侣大类独立页（2026-11-02 站主定：从情侣空间摘出放侧栏）。
/// 双方互见，只能删自己的。
/// </summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public List<LoveNote> Notes { get; private set; } = [];

    [BindProperty] public string NoteContent { get; set; } = "";
    public string? Error { get; private set; }

    public void OnGet()
    {
        Notes = _db.LoveNotes.Include(n => n.FromUser)
            .OrderByDescending(n => n.CreatedAt)
            .Take(100)
            .ToList();
    }

    public IActionResult OnPost()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(NoteContent))
        { Error = "小纸条不能是空的。"; OnGet(); return Page(); }
        _db.LoveNotes.Add(new LoveNote
        {
            FromUserId = uid,
            Content = NoteContent.Trim(),
            CreatedAt = DateTime.UtcNow,
        });
        _db.SaveChanges();
        return RedirectToPage();
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var n = _db.LoveNotes.FirstOrDefault(x => x.Id == id && x.FromUserId == uid);
        if (n is null) return NotFound();
        _db.LoveNotes.Remove(n);
        _db.SaveChanges();
        return RedirectToPage();
    }
}
