using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Memo;

[Authorize(Policy = "perm:memo.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public string Title { get; set; } = "";
    [BindProperty] public string Body { get; set; } = "";
    [BindProperty] public bool Pinned { get; set; }
    public string? Error { get; private set; }

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var m = _db.Memos.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (m is null) return NotFound();
        Id = m.Id; Title = m.Title; Body = m.Content; Pinned = m.Pinned;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var m = _db.Memos.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (m is null) return NotFound();

        if (string.IsNullOrWhiteSpace(Title))
        { Error = "标题不能为空。"; Id = id; return Page(); }

        m.Title = Title.Trim();
        m.Content = Body?.Trim() ?? "";
        m.Pinned = Pinned;
        m.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage("/Memo/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var m = _db.Memos.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (m is null) return NotFound();
        _db.Memos.Remove(m);
        _db.SaveChanges();
        return RedirectToPage("/Memo/Index");
    }
}
