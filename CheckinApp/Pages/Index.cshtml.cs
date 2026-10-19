using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages;

[Authorize(Policy = "perm:workbench.view")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public List<ScheduleItem> Upcoming { get; set; } = [];
    public List<MemoItem> PinnedMemos { get; set; } = [];

    // M5 聚合区
    public List<(Habit Habit, bool Checked)> TodayHabits { get; set; } = [];
    public (string Title, int DaysLeft)? NextAnniv { get; set; }
    public int ReminderCount { get; set; }

    // ---- 2026-10-18 工作台卡片扩充（每张卡片按权限出数据） ----
    /// <summary>今日课程（已按教学周次过滤）+ 作息时段文字</summary>
    public List<(Course Course, string Hours)> TodayCourses { get; set; } = [];
    public int CurrentWeek { get; set; }
    public bool SemesterConfigured { get; set; }

    /// <summary>邮件：未读数 + 最近 3 封</summary>
    public List<EmailMessage> RecentMails { get; set; } = [];
    public int UnreadMails { get; set; }
    public bool HasMailAccounts { get; set; }

    /// <summary>留言板最新 3 条</summary>
    public List<BoardMessage> RecentBoard { get; set; } = [];

    /// <summary>本月记账合计</summary>
    public decimal MonthIn { get; set; }
    public decimal MonthOut { get; set; }
    public int MonthEntries { get; set; }

    /// <summary>情侣空间：在一起天数 + 最近一张小纸条</summary>
    public (string Title, int Days)? Couple { get; set; }
    public LoveNote? LastNote { get; set; }

    /// <summary>经期：最近一次记录</summary>
    public (DateTime StartDate, DateTime? EndDate)? LastPeriod { get; set; }

    /// <summary>工作台卡片布局 JSON（Users.DashboardLayout，空 = 默认）</summary>
    public string DashboardJson { get; set; } = "";

    /// <summary>账号里现存的测试数据条数（0 = 没有）</summary>
    public int SampleRows { get; set; }
    /// <summary>是否显示「测试数据」提示条：有数据 且 用户从没点过删除</summary>
    public bool ShowSampleBanner { get; set; }

    public void OnGet()
    {
        if (_me.UserId is not int uid) return;
        var horizon = DateTime.Today.AddDays(7);
        var today = DateTime.Today;

        var meRow = _db.Users.Where(u => u.Id == uid)
            .Select(u => new { u.DashboardLayout, u.SamplePromptDismissed }).FirstOrDefault();
        DashboardJson = meRow?.DashboardLayout ?? "";

        // 测试数据提示：有【测试】记录且没被处理过才出（点过一次删除就永久消失）
        SampleRows = SampleData.Count(_db, uid);
        ShowSampleBanner = !(meRow?.SamplePromptDismissed ?? false) && SampleRows > 0;

        Upcoming = _db.Schedules
            .Where(s => s.UserId == uid && s.StartAt >= today && s.StartAt <= horizon)
            .OrderBy(s => s.StartAt)
            .Take(5)
            .ToList();

        PinnedMemos = _db.Memos
            .Where(m => m.UserId == uid && m.Pinned)
            .OrderByDescending(m => m.UpdatedAt)
            .Take(3)
            .ToList();

        // 今日打卡快捷区
        if (_me.Has("habits.use"))
        {
            var habits = _db.Habits.Where(h => h.UserId == uid).Take(5).ToList();
            var doneIds = _db.HabitCheckins
                .Where(c => c.UserId == uid && c.CheckinDate == today)
                .Select(c => c.HabitId)
                .ToHashSet();
            foreach (var h in habits)
                TodayHabits.Add((h, doneIds.Contains(h.Id)));
        }

        // 今日课程（与课程表同一套学期/周次算法；今天是周几就取周几的课）
        if (_me.Has("courses.use"))
        {
            var setting = _db.AppSettings.FirstOrDefault(s => s.Key == "courses.semester-start");
            SemesterConfigured = setting is not null && DateTime.TryParse(setting.Value, out _);
            var raw = SemesterConfigured && DateTime.TryParse(setting!.Value, out var parsed) ? parsed : today;
            var semStart = MondayOf(raw);
            CurrentWeek = Math.Max(1, (int)((today - semStart).TotalDays / 7) + 1);
            var weekday = ((int)today.DayOfWeek + 6) % 7 + 1;     // 1=周一 … 7=周日
            var periods = CoursesConfig.Load(_db);                // 节次时间（可自定义）
            TodayCourses = _db.Courses
                .Where(c => c.UserId == uid && c.Weekday == weekday)
                .ToList()
                .Where(c => Weeks.Includes(c.WeeksText, CurrentWeek))
                .OrderBy(c => c.StartPeriod)
                .Take(6)
                .Select(c => (c, HoursOf(c.StartPeriod, periods)))
                .ToList();
        }

        // 最近的纪念日倒计时
        if (_me.Has("anniversary.use"))
        {
            var best = (Title: "", DaysLeft: int.MaxValue);
            foreach (var a in _db.Anniversaries.Where(x => x.UserId == uid).ToList())
            {
                DateTime next;
                if (a.RepeatYearly)
                {
                    next = new DateTime(today.Year, a.Date.Month, Math.Min(a.Date.Day, DateTime.DaysInMonth(today.Year, a.Date.Month)));
                    if (next < today) next = next.AddYears(1);
                }
                else next = a.Date.Date;
                var days = (next - today).Days;
                if (days >= 0 && days < best.DaysLeft) best = (a.Title, days);
            }
            if (best.DaysLeft != int.MaxValue) NextAnniv = best;
        }

        // 邮件：未读数 + 最近 3 封（页面只读缓存，同步是独立通道）
        if (_me.Has("email.use"))
        {
            HasMailAccounts = _db.EmailAccounts.Any(a => a.UserId == uid);
            UnreadMails = _db.EmailMessages.Count(m => m.UserId == uid && !m.IsRead);
            RecentMails = _db.EmailMessages
                .Where(m => m.UserId == uid)
                .OrderByDescending(m => m.SentAt)
                .Take(3)
                .ToList();
        }

        // 留言板最新 3 条（小圈子公开留言）
        if (_me.Has("board.use"))
        {
            RecentBoard = _db.BoardMessages
                .Include(b => b.User)
                .OrderByDescending(b => b.Id)
                .Take(3)
                .ToList();
        }

        // 本月记账合计
        if (_me.Has("expense.use"))
        {
            var monthStart = new DateTime(today.Year, today.Month, 1);
            var monthEnd = monthStart.AddMonths(1);
            var rows = _db.Expenses
                .Where(e => e.UserId == uid && e.OccurDate >= monthStart && e.OccurDate < monthEnd)
                .Select(e => new { e.Type, e.Amount })
                .ToList();
            MonthIn = rows.Where(r => r.Type == "in").Sum(r => r.Amount);
            MonthOut = rows.Where(r => r.Type == "out").Sum(r => r.Amount);
            MonthEntries = rows.Count;
        }

        // 情侣空间：在一起天数（与 /Couples 同一公式）+ 最近一张小纸条
        if (_me.Has("couples.view"))
        {
            var s = _db.CoupleSettings.FirstOrDefault();
            if (s is not null)
                Couple = (s.Title, (today - s.StartDate.Date).Days + 1);
            LastNote = _db.LoveNotes.Include(n => n.FromUser)
                .OrderByDescending(n => n.Id).FirstOrDefault();
        }

        // 经期：最近一次记录（严格本人数据）
        if (_me.Has("period.use"))
        {
            var p = _db.PeriodRecords.Where(x => x.UserId == uid)
                .OrderByDescending(x => x.StartDate).FirstOrDefault();
            if (p is not null) LastPeriod = (p.StartDate, p.EndDate);
        }

        // 提醒计数（近 3 天日程 + 7 天内纪念日 + 今日未打卡习惯）
        if (_me.Has("reminders.use"))
        {
            var soon = today.AddDays(3);
            ReminderCount += _db.Schedules.Count(x => x.UserId == uid && x.StartAt >= today && x.StartAt < soon.AddDays(1));
            if (NextAnniv is not null && NextAnniv.Value.DaysLeft <= 7) ReminderCount++;
            ReminderCount += TodayHabits.Count(t => !t.Checked);
        }
    }

    /// <summary>
    /// 首页「一键删除测试数据」：清掉带【测试】前缀的行，并置位 SamplePromptDismissed ——
    /// 之后这张提示卡永久不再出现（哪怕用户又在个人主页生成了一份，也不会再打扰）。
    /// </summary>
    public IActionResult OnPostClearSample()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        var removed = SampleData.Remove(_db, uid);
        var user = _db.Users.FirstOrDefault(u => u.Id == uid);
        if (user is not null)
        {
            user.SamplePromptDismissed = true;
            _db.SaveChanges();
        }

        TempData["Ok"] = removed > 0
            ? $"已删除 {removed} 条测试数据，你的真实数据一条没动。"
            : "没有找到测试数据。";
        return RedirectToPage();
    }

    /// <summary>工作台快捷打卡（同 Habits 页逻辑，打完回工作台）</summary>
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
        // 免刷新（fetch）提交回 JSON，按钮就地变「已打卡」；普通提交走 PRG
        if (Request.Headers["X-Requested-With"] == "fetch")
            return new JsonResult(new { ok = true, @checked = true });
        return RedirectToPage();
    }

    /// <summary>开始节次 → 该节起止时间（照可自定义的节次配置）</summary>
    private static string HoursOf(int startPeriod, List<PeriodSlot> periods)
    {
        if (periods.Count == 0) return "";
        var p = Math.Clamp(startPeriod, 1, periods.Count) - 1;
        return $"{periods[p].Start}～{periods[p].End}";
    }

    /// <summary>取所在周的周一（与课程表同款）</summary>
    private static DateTime MondayOf(DateTime d) =>
        d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
