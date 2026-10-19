using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Habits;

[Authorize(Policy = "perm:habits.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public record HabitRow(Habit Habit, bool CheckedToday, int Streak, int Total, List<bool> Week);

    public List<HabitRow> Rows { get; set; } = [];
    public string View { get; private set; } = "list";   // list | grid

    public void OnGet(string? view)
    {
        View = view == "grid" ? "grid" : "list";
        if (_me.UserId is not int uid) return;
        var today = DateTime.Today;
        var habits = _db.Habits.Where(h => h.UserId == uid).OrderBy(h => h.Id).ToList();
        if (habits.Count == 0) return;

        // 一次性拉全量打卡日期，内存里算 streak —— 小站数据量足够小
        var checkins = _db.HabitCheckins
            .Where(c => c.UserId == uid)
            .Select(c => new { c.HabitId, c.CheckinDate })
            .ToList()
            .GroupBy(c => c.HabitId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.CheckinDate.Date).ToHashSet());

        // 近 7 天（含今天）点阵：today-6 … today
        var weekDays = Enumerable.Range(0, 7).Select(i => today.AddDays(-6 + i)).ToList();

        foreach (var h in habits)
        {
            var dates = checkins.GetValueOrDefault(h.Id) ?? [];
            var checkedToday = dates.Contains(today);
            Rows.Add(new HabitRow(h, checkedToday, CalcStreak(dates, today), dates.Count,
                weekDays.Select(d => dates.Contains(d)).ToList()));
        }
    }

    /// <summary>连续打卡天数：今天打了从今天往回数；今天没打从昨天往回数（断签判定宽容一天）。</summary>
    private static int CalcStreak(HashSet<DateTime> dates, DateTime today)
    {
        var day = dates.Contains(today) ? today : today.AddDays(-1);
        var streak = 0;
        while (dates.Contains(day))
        {
            streak++;
            day = day.AddDays(-1);
        }
        return streak;
    }

    public IActionResult OnPostCheckin(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var habit = _db.Habits.FirstOrDefault(h => h.Id == id && h.UserId == uid);
        if (habit is null) return NotFound();
        var today = DateTime.Today;
        if (!_db.HabitCheckins.Any(c => c.HabitId == id && c.CheckinDate == today))
        {
            _db.HabitCheckins.Add(new HabitCheckin
            {
                HabitId = id, UserId = uid, CheckinDate = today,
                Note = "", CreatedAt = DateTime.UtcNow
            });
            _db.SaveChanges();
        }
        // 免刷新（fetch）提交回统计 JSON，普通提交走 PRG
        if (Request.Headers["X-Requested-With"] == "fetch")
            return new JsonResult(StatJson(id, uid, today, true));
        return RedirectToPage();
    }

    public IActionResult OnPostUndo(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var today = DateTime.Today;
        var row = _db.HabitCheckins.FirstOrDefault(c => c.HabitId == id && c.UserId == uid && c.CheckinDate == today);
        if (row is not null)
        {
            _db.HabitCheckins.Remove(row);
            _db.SaveChanges();
        }
        if (Request.Headers["X-Requested-With"] == "fetch")
            return new JsonResult(StatJson(id, uid, today, false));
        return RedirectToPage();
    }

    /// <summary>免刷新提交的回包：连续天数 / 累计 / 近 7 天点阵（服务端算，前端只管画）。</summary>
    private object StatJson(int habitId, int uid, DateTime today, bool checkedToday)
    {
        var dates = _db.HabitCheckins
            .Where(c => c.HabitId == habitId && c.UserId == uid)
            .Select(c => c.CheckinDate)
            .ToList()
            .Select(d => d.Date)
            .ToHashSet();
        var week = Enumerable.Range(0, 7).Select(i => dates.Contains(today.AddDays(-6 + i))).ToArray();
        return new { ok = true, @checked = checkedToday, streak = CalcStreak(dates, today), total = dates.Count, week };
    }
}
