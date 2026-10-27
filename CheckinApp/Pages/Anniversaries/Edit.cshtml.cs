using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Anniversaries;

[Authorize(Policy = "perm:anniversary.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public string Title { get; set; } = "";
    [BindProperty] public DateTime Date { get; set; } = DateTime.Today;
    [BindProperty] public bool RepeatYearly { get; set; } = true;
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var a = _db.Anniversaries.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (a is null) return NotFound();
        Id = a.Id; Title = a.Title; Date = a.Date; RepeatYearly = a.RepeatYearly; Note = a.Note;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var a = _db.Anniversaries.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (a is null) return NotFound();

        if (string.IsNullOrWhiteSpace(Title))
        { Error = "标题不能为空。"; Id = id; return Page(); }

        a.Title = Title.Trim();
        a.Date = Date.Date;
        a.RepeatYearly = RepeatYearly;
        a.Note = Note?.Trim() ?? "";
        a.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage("/Anniversaries/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var a = _db.Anniversaries.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (a is null) return NotFound();
        _db.Anniversaries.Remove(a);
        _db.SaveChanges();
        return RedirectToPage("/Anniversaries/Index");
    }
}
