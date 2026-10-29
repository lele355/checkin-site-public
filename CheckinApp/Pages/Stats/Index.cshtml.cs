using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Stats;

/// <summary>统计 —— 打卡热力图（近 90 天）+ 习惯排行 + 记账月度柱状图 + 各模块计数。</summary>
[Authorize(Policy = "perm:stats.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    /// <summary>近 90 天每天的打卡次数（日期升序）</summary>
    public List<(DateTime Date, int Count)> Heat { get; set; } = [];
    /// <summary>习惯打卡总数排行</summary>
    public List<(string Name, string Icon, int Total)> TopHabits { get; set; } = [];
    /// <summary>近 6 个月支出（月升序）</summary>
    public List<(string Month, decimal Out)> MonthExpense { get; set; } = [];
    public decimal MaxMonthOut { get; set; }

    public int ScheduleCount { get; set; }
    public int MemoCount { get; set; }
    public int BoardCount { get; set; }
    public int CourseCount { get; set; }
    public int CheckinTotal { get; set; }

    public void OnGet()
    {
        if (_me.UserId is not int uid) return;
        var today = DateTime.Today;
        var from90 = today.AddDays(-89);

        // 热力图：近 90 天按天聚合
        var daily = _db.HabitCheckins
            .Where(c => c.UserId == uid && c.CheckinDate >= from90)
            .GroupBy(c => c.CheckinDate)
            .Select(g => new { Day = g.Key, Count = g.Count() })
            .ToList()
            .ToDictionary(x => x.Day.Date, x => x.Count);
        for (var d = from90; d <= today; d = d.AddDays(1))
            Heat.Add((d, daily.GetValueOrDefault(d)));

        CheckinTotal = _db.HabitCheckins.Count(c => c.UserId == uid);

        TopHabits = _db.Habits
            .Where(h => h.UserId == uid)
            .ToList()
            .Select(h => (h.Name, h.Icon, _db.HabitCheckins.Count(c => c.HabitId == h.Id)))
            .OrderByDescending(t => t.Item3)
            .Take(5)
            .ToList();

        // 近 6 个月支出
        var startMonth = new DateTime(today.Year, today.Month, 1).AddMonths(-5);
        var expenses = _db.Expenses
            .Where(x => x.UserId == uid && x.Type == "out" && x.OccurDate >= startMonth)
            .Select(x => new { x.OccurDate, x.Amount })
            .ToList();
        for (var m = 0; m < 6; m++)
        {
            var month = startMonth.AddMonths(m);
            var sum = expenses
                .Where(x => x.OccurDate >= month && x.OccurDate < month.AddMonths(1))
                .Sum(x => x.Amount);
            MonthExpense.Add((month.ToString("M月"), sum));
        }
        MaxMonthOut = MonthExpense.Count == 0 ? 0 : MonthExpense.Max(t => t.Out);

        ScheduleCount = _db.Schedules.Count(x => x.UserId == uid);
        MemoCount = _db.Memos.Count(x => x.UserId == uid);
        BoardCount = _db.BoardMessages.Count(x => x.UserId == uid);
        CourseCount = _db.Courses.Count(x => x.UserId == uid);
    }
}
