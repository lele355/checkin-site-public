using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Period;

[Authorize(Policy = "perm:period.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public DateTime StartDate { get; set; } = DateTime.Today;
    [BindProperty] public DateTime? EndDate { get; set; }
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var r = _db.PeriodRecords.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (r is null) return NotFound();
        Id = r.Id; StartDate = r.StartDate; EndDate = r.EndDate; Note = r.Note;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var r = _db.PeriodRecords.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (r is null) return NotFound();

        if (EndDate is not null && EndDate.Value.Date < StartDate.Date)
        { Error = "结束日期不能早于开始日期。"; Id = id; return Page(); }

        r.StartDate = StartDate.Date;
        r.EndDate = EndDate?.Date;
        r.Note = Note?.Trim() ?? "";
        r.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage("/Period/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var r = _db.PeriodRecords.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (r is null) return NotFound();
        _db.PeriodRecords.Remove(r);
        _db.SaveChanges();
        return RedirectToPage("/Period/Index");
    }
}
