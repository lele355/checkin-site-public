using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Schedule;

[Authorize(Policy = "perm:schedule.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public string Title { get; set; } = "";
    [BindProperty] public string Description { get; set; } = "";
    [BindProperty] public DateTime StartAt { get; set; }
    [BindProperty] public DateTime? EndAt { get; set; }
    [BindProperty] public bool AllDay { get; set; }
    public string? Error { get; private set; }

    public void OnGet(DateTime? date)
    {
        // 日历视图点日期格进来：预填当天 9:00；否则默认下一个整点
        StartAt = date != null
            ? date.Value.Date.AddHours(9)
            : DateTime.Today.AddHours(DateTime.Now.Hour < 23 ? 1 : 0);
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(Title))
        { Error = "标题不能为空。"; return Page(); }
        if (EndAt.HasValue && EndAt < StartAt)
        { Error = "结束时间不能早于开始时间。"; return Page(); }

        _db.Schedules.Add(new ScheduleItem
        {
            UserId = uid,
            Title = Title.Trim(),
            Description = Description?.Trim() ?? "",
            StartAt = StartAt,
            EndAt = AllDay ? null : EndAt,
            AllDay = AllDay
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Schedule/Index");
    }
}
