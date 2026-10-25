using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>一条待排程的提醒（服务端算好时刻，客户端只负责按时弹）</summary>
public record PlannedItem(string Key, string Kind, string DueAt, string Title, string Body, string Route);

/// <summary>
/// 本地通知的「提醒计划」生成器。
///
/// 为什么要在服务端算：App 本地没有数据库，断网时算不出「哪天几点该提醒」；
/// 这里一次性算出未来 N 天的具体时刻，客户端拿去排闹钟，之后即使断网也照响。
///
/// 免打扰在这里就处理掉（不在客户端）：
/// - 日程：落在免打扰时段直接不发（会开完了才提醒没有意义）
/// - 每日类：顺延到免打扰结束时刻（早报晚三小时仍然有价值）
/// </summary>
public static class NotifyPlanBuilder
{
    private const int MaxItems = 100;

    public static List<PlannedItem> Build(AppDbContext db, int uid, NotifySetting st, DateTime now, int days = 14)
    {
        var list = new List<PlannedItem>();
        if (!st.Enabled || days <= 0) return list;

        var today = now.Date;
        var horizon = today.AddDays(days);

        AddSchedules(db, uid, st, now, horizon, list);
        AddDaily(st, now, days, list);
        AddAnniversaries(db, uid, st, now, days, list);
        AddPeriod(db, uid, st, now, days, list);

        return list
            .GroupBy(x => x.Key).Select(g => g.First())   // 极端情况下防重
            .OrderBy(x => x.DueAt, StringComparer.Ordinal)
            .Take(MaxItems)
            .ToList();
    }

    // ---------------- 日程 ----------------
    private static void AddSchedules(AppDbContext db, int uid, NotifySetting st, DateTime now, DateTime horizon, List<PlannedItem> list)
    {
        if (!st.ScheduleEnabled) return;

        var leads = ParseLeads(st.ScheduleLeads);
        var rows = db.Schedules
            .Where(s => s.UserId == uid && s.StartAt > now.AddMinutes(-1) && s.StartAt < horizon)
            .OrderBy(s => s.StartAt)
            .Take(200)
            .ToList();

        foreach (var s in rows)
        {
            if (s.AllDay)
            {
                // 全天事件没有具体时刻，用用户设定的时刻在「当天」提醒
                var due = s.StartAt.Date.AddMinutes(Clamp(st.AllDayMinute));
                if (due <= now) continue;
                if (InDnd(st, MinuteOf(due))) continue;
                list.Add(new PlannedItem(
                    Key: $"schedule|{uid}|{s.StartAt:yyyyMMdd}|{s.Id}|allday",
                    Kind: "schedule", DueAt: Fmt(due),
                    Title: $"{s.Title}（全天）",
                    Body: "今天全天 · 点开看详细安排",
                    Route: "schedule"));
                continue;
            }

            foreach (var lead in leads)
            {
                var due = s.StartAt.AddMinutes(-lead);
                if (due <= now) continue;
                if (InDnd(st, MinuteOf(due))) continue;

                var body = lead <= 0 ? "现在开始" : $"{lead} 分钟后开始";
                if (!string.IsNullOrWhiteSpace(s.Description))
                    body += " · " + Clip(s.Description, 60);

                list.Add(new PlannedItem(
                    Key: $"schedule|{uid}|{s.StartAt:yyyyMMdd}|{s.Id}|{lead}",
                    Kind: "schedule", DueAt: Fmt(due),
                    Title: $"{s.StartAt:HH:mm} {s.Title}",
                    Body: body,
                    Route: "schedule"));
            }
        }
    }

    // ---------------- 每日早报 / 打卡 ----------------
    private static void AddDaily(NotifySetting st, DateTime now, int days, List<PlannedItem> list)
    {
        for (var i = 0; i < days; i++)
        {
            var day = now.Date.AddDays(i);

            if (st.DigestEnabled)
            {
                var due = day.AddMinutes(ShiftOutOfDnd(st, Clamp(st.DigestMinute)));
                if (due > now)
                    list.Add(new PlannedItem(
                        Key: $"digest|{st.UserId}|{day:yyyyMMdd}",
                        Kind: "digest", DueAt: Fmt(due),
                        Title: "早安，看看今天",
                        Body: "日程、打卡进度、最近的纪念日，点开一目了然",
                        Route: "workbench"));
            }

            if (st.HabitEnabled)
            {
                var due = day.AddMinutes(ShiftOutOfDnd(st, Clamp(st.HabitMinute)));
                if (due > now)
                    list.Add(new PlannedItem(
                        Key: $"habit|{st.UserId}|{day:yyyyMMdd}",
                        Kind: "habit", DueAt: Fmt(due),
                        Title: "今天的习惯还没打完",
                        Body: "点开打卡，别断了连续天数（全打完了就不会提醒）",
                        Route: "habits"));
            }
        }
    }

    // ---------------- 纪念日 ----------------
    private static void AddAnniversaries(AppDbContext db, int uid, NotifySetting st, DateTime now, int days, List<PlannedItem> list)
    {
        if (!st.AnnivEnabled) return;

        var annivs = db.Anniversaries.Where(a => a.UserId == uid).ToList();
        if (annivs.Count == 0) return;

        var minute = ShiftOutOfDnd(st, Clamp(st.AnnivMinute));

        for (var i = 0; i < days; i++)
        {
            var day = now.Date.AddDays(i);
            foreach (var a in annivs)
            {
                DateTime occ;
                if (a.RepeatYearly)
                    occ = new DateTime(day.Year, a.Date.Month,
                        Math.Min(a.Date.Day, DateTime.DaysInMonth(day.Year, a.Date.Month)));
                else
                    occ = a.Date.Date;

                if (occ.Date != day) continue;

                var due = day.AddMinutes(minute);
                if (due <= now) continue;

                list.Add(new PlannedItem(
                    Key: $"anniv|{uid}|{day:yyyyMMdd}|{a.Id}",
                    Kind: "anniv", DueAt: Fmt(due),
                    Title: a.Title,
                    Body: "就是今天 · 别忘了",
                    Route: "anniversary"));
            }
        }
    }

    // ---------------- 经期 ----------------
    private static void AddPeriod(AppDbContext db, int uid, NotifySetting st, DateTime now, int days, List<PlannedItem> list)
    {
        if (!st.PeriodEnabled) return;

        var next = PeriodPredictor.NextStart(db, uid);
        if (next is not DateTime n) return;

        var dueDay = n.Date.AddDays(-Math.Clamp(st.PeriodDaysBefore, 0, 7));
        var due = dueDay.AddMinutes(ShiftOutOfDnd(st, 540));   // 固定 09:00 提醒
        if (due <= now || due > now.Date.AddDays(days)) return;

        list.Add(new PlannedItem(
            Key: $"period|{uid}|{n:yyyyMMdd}",
            Kind: "period", DueAt: Fmt(due),
            Title: "经期可能快到了",
            Body: $"预计 {n:M月d日} · 提前 {st.PeriodDaysBefore} 天提醒",
            Route: "period"));
    }

    // ---------------- 工具 ----------------

    /// <summary>提前量只认 0/5/10/30；空 = 只在开始时提醒</summary>
    private static List<int> ParseLeads(string? csv)
    {
        var list = (csv ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => int.TryParse(x.Trim(), out var v) ? v : -1)
            .Where(v => v is 0 or 5 or 10 or 30)
            .Distinct()
            .OrderBy(v => v)
            .ToList();
        return list.Count == 0 ? [0] : list;
    }

    private static bool InDnd(NotifySetting st, int minute)
    {
        if (!st.DndEnabled || st.DndStartMinute == st.DndEndMinute) return false;
        return st.DndStartMinute < st.DndEndMinute
            ? minute >= st.DndStartMinute && minute < st.DndEndMinute      // 同日段，如 12:00-14:00
            : minute >= st.DndStartMinute || minute < st.DndEndMinute;      // 跨夜，如 22:00-08:00
    }

    /// <summary>落在免打扰里就顺延到结束时（用于每日类，日程不适用）</summary>
    private static int ShiftOutOfDnd(NotifySetting st, int minute) =>
        InDnd(st, minute) ? st.DndEndMinute : minute;

    private static int MinuteOf(DateTime d) => d.Hour * 60 + d.Minute;

    private static int Clamp(int minute) => Math.Clamp(minute, 0, 1439);

    private static string Fmt(DateTime d) => d.ToString("yyyy-MM-ddTHH:mm");

    private static string Clip(string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";
}
