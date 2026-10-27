using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Pages.Schedule;

[Authorize(Policy = "perm:schedule.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public record GroupedItem(string Group, ScheduleItem Item);
    public List<GroupedItem> Items { get; set; } = [];

    public string View { get; private set; } = "list";           // list | calendar
    public string CalendarJson { get; private set; } = "[]";     // 日历视图数据

    public void OnGet(string? view)
    {
        if (_me.UserId is not int uid) return;
        View = view == "calendar" ? "calendar" : "list";

        var today = DateTime.Today;
        var horizon = today.AddDays(-7);   // 已过的也保留最近 7 天，便于回看
        var raw = _db.Schedules
            .Where(s => s.UserId == uid && s.StartAt >= horizon)
            .OrderBy(s => s.StartAt)
            .ToList();

        Items = raw.Select(s => new GroupedItem(GroupOf(s.StartAt, today), s)).ToList();

        if (View == "calendar")
        {
            // 日历需要全量日程（不限 7 天），按紧凑格式输出 JSON
            var all = _db.Schedules
                .Where(s => s.UserId == uid)
                .OrderBy(s => s.StartAt)
                .Select(s => new
                {
                    id = s.Id,
                    title = s.Title,
                    start = s.StartAt.ToString("yyyy-MM-ddTHH:mm:ss"),
                    end = s.EndAt == null ? "" : s.EndAt.Value.ToString("yyyy-MM-ddTHH:mm:ss"),
                    allDay = s.AllDay
                })
                .ToList();
            CalendarJson = System.Text.Json.JsonSerializer.Serialize(all);
        }
    }

    private static string GroupOf(DateTime start, DateTime today)
    {
        if (start.Date < today) return "已过";
        if (start.Date == today) return "今天";
        if (start.Date == today.AddDays(1)) return "明天";
        if (start.Date <= today.AddDays(7)) return "一周内";
        return "更远";
    }
}
