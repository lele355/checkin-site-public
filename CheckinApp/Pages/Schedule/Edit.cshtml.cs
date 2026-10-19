using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Schedule;

[Authorize(Policy = "perm:schedule.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public string Title { get; set; } = "";
    [BindProperty] public string Description { get; set; } = "";
    [BindProperty] public DateTime StartAt { get; set; }
    [BindProperty] public DateTime? EndAt { get; set; }
    [BindProperty] public bool AllDay { get; set; }
    public string? Error { get; private set; }

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var s = _db.Schedules.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (s is null) return NotFound();   // 别人的或不存在，统一 404 不泄露
        Id = s.Id; Title = s.Title; Description = s.Description;
        StartAt = s.StartAt; EndAt = s.EndAt; AllDay = s.AllDay;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var s = _db.Schedules.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (s is null) return NotFound();

        if (string.IsNullOrWhiteSpace(Title))
        { Error = "标题不能为空。"; Id = id; return Page(); }
        if (EndAt.HasValue && EndAt < StartAt)
        { Error = "结束时间不能早于开始时间。"; Id = id; return Page(); }

        s.Title = Title.Trim();
        s.Description = Description?.Trim() ?? "";
        s.StartAt = StartAt;
        s.EndAt = AllDay ? null : EndAt;
        s.AllDay = AllDay;
        s.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage("/Schedule/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var s = _db.Schedules.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (s is null) return NotFound();
        _db.Schedules.Remove(s);
        _db.SaveChanges();
        return RedirectToPage("/Schedule/Index");
    }
}
