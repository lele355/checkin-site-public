using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Api;

/// <summary>工作台聚合 + 日程 + 备忘 —— App 打开后最常用的三块。</summary>
public static class CoreApi
{
    private static readonly string[] WeekLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

    public record ScheduleReq(string? Title, string? Description, string? StartAt, string? EndAt, bool AllDay);
    public record MemoReq(string? Title, string? Content, bool Pinned);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1");

        // ==================== 工作台 ====================
        g.MapGet("/dashboard", (AppDbContext db, CurrentUser me, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = DateTime.Today;
            var horizon = today.AddDays(7);
            var has = (string p) => me.Has(p);

            var meRow = db.Users.Where(u => u.Id == uid)
                .Select(u => new { u.DashboardLayout, u.SamplePromptDismissed }).First();

            var upcoming = db.Schedules
                .Where(s => s.UserId == uid && s.StartAt >= today && s.StartAt <= horizon)
                .OrderBy(s => s.StartAt).Take(5).ToList()
                .Select(s => new
                {
                    id = s.Id, title = s.Title, description = s.Description,
                    startAt = ApiKit.T(s.StartAt), endAt = ApiKit.TN(s.EndAt), allDay = s.AllDay,
                }).ToList();

            var pinned = db.Memos
                .Where(m => m.UserId == uid && m.Pinned)
                .OrderByDescending(m => m.UpdatedAt).Take(3).ToList()
                .Select(m => new { id = m.Id, title = m.Title, content = m.Content, pinned = m.Pinned, updatedAt = ApiKit.Stamp(m.UpdatedAt) })
                .ToList();

            // ---- 打卡 ----
            var habits = new List<object>();
            var habitsChecked = 0;
            if (has("habits.use"))
            {
                var hs = db.Habits.Where(h => h.UserId == uid).Take(5).ToList();
                // 「累计 N 天 · 连续 M 天」是工作台每行的固定文案，一次把打卡日期拉全，内存里算
                var datesByHabit = db.HabitCheckins.Where(c => c.UserId == uid)
                    .Select(c => new { c.HabitId, c.CheckinDate }).ToList()
                    .GroupBy(x => x.HabitId)
                    .ToDictionary(g2 => g2.Key, g2 => g2.Select(x => x.CheckinDate.Date).ToHashSet());

                habitsChecked = hs.Count(h => (datesByHabit.GetValueOrDefault(h.Id) ?? []).Contains(today));
                habits.AddRange(hs.Select(h =>
                {
                    var dates = datesByHabit.GetValueOrDefault(h.Id) ?? [];
                    return (object)new
                    {
                        id = h.Id, name = h.Name, icon = h.Icon,
                        @checked = dates.Contains(today),
                        total = dates.Count,
                        streak = Streak(dates, today),
                    };
                }));
            }

            // ---- 课程 ----
            var todayCourses = new List<object>();
            var currentWeek = 0;
            var semesterConfigured = false;
            if (has("courses.use"))
            {
                var setting = db.AppSettings.FirstOrDefault(s => s.Key == "courses.semester-start");
                semesterConfigured = setting is not null && DateTime.TryParse(setting.Value, out _);
                var raw = semesterConfigured && DateTime.TryParse(setting!.Value, out var parsed) ? parsed : today;
                var semStart = MondayOf(raw);
                currentWeek = Math.Max(1, (int)((today - semStart).TotalDays / 7) + 1);
                var weekday = ((int)today.DayOfWeek + 6) % 7 + 1;
                var periods = CoursesConfig.Load(db);
                foreach (var c in db.Courses.Where(c => c.UserId == uid && c.Weekday == weekday)
                             .ToList().Where(c => Weeks.Includes(c.WeeksText, currentWeek))
                             .OrderBy(c => c.StartPeriod).Take(6))
                {
                    todayCourses.Add(new
                    {
                        id = c.Id, name = c.Name, teacher = c.Teacher, location = c.Location,
                        startPeriod = c.StartPeriod, endPeriod = c.EndPeriod, category = c.Category,
                        hours = HoursOf(c.StartPeriod, periods),
                        weeksLabel = Weeks.Display(c.WeeksText),
                    });
                }
            }

            // ---- 纪念日 ----
            object? nextAnniv = null;
            int? nextAnnivDays = null;
            if (has("anniversary.use"))
            {
                var bestDays = int.MaxValue;
                string bestTitle = "";
                foreach (var a in db.Anniversaries.Where(x => x.UserId == uid).ToList())
                {
                    DateTime next;
                    if (a.RepeatYearly)
                    {
                        next = new DateTime(today.Year, a.Date.Month, Math.Min(a.Date.Day, DateTime.DaysInMonth(today.Year, a.Date.Month)));
                        if (next < today) next = next.AddYears(1);
                    }
                    else next = a.Date.Date;
                    var days = (next - today).Days;
                    if (days >= 0 && days < bestDays) { bestDays = days; bestTitle = a.Title; }
                }
                if (bestDays != int.MaxValue) { nextAnniv = new { title = bestTitle, days = bestDays }; nextAnnivDays = bestDays; }
            }

            // ---- 邮件 ----
            object? mails = null;
            if (has("email.use"))
            {
                var hasAccounts = db.EmailAccounts.Any(a => a.UserId == uid);
                var unread = db.EmailMessages.Count(m => m.UserId == uid && !m.IsRead);
                var recent = db.EmailMessages.Where(m => m.UserId == uid)
                    .OrderByDescending(m => m.SentAt).Take(3).ToList()
                    .Select(m => new
                    {
                        id = m.Id, from = m.FromName.Length > 0 ? m.FromName : m.FromAddress,
                        subject = m.Subject, sentAt = ApiKit.Stamp(m.SentAt), isRead = m.IsRead, hasAttachment = m.HasAttachment,
                    }).ToList();
                mails = new { hasAccounts, unread, recent };
            }

            // ---- 留言板 ----
            var board = new List<object>();
            if (has("board.use"))
            {
                board.AddRange(db.BoardMessages.Include(b => b.User)
                    .OrderByDescending(b => b.Id).Take(3).ToList()
                    .Select(b => (object)new
                    {
                        id = b.Id, content = b.Content,
                        author = b.User?.DisplayName ?? "?",
                        createdAt = ApiKit.Stamp(b.CreatedAt),
                    }));
            }

            // ---- 记账 ----
            object? expense = null;
            if (has("expense.use"))
            {
                var mStart = new DateTime(today.Year, today.Month, 1);
                var mEnd = mStart.AddMonths(1);
                var rows = db.Expenses.Where(e => e.UserId == uid && e.OccurDate >= mStart && e.OccurDate < mEnd)
                    .Select(e => new { e.Type, e.Amount }).ToList();
                expense = new
                {
                    monthIn = rows.Where(r => r.Type == "in").Sum(r => r.Amount),
                    monthOut = rows.Where(r => r.Type == "out").Sum(r => r.Amount),
                    entries = rows.Count,
                    month = mStart.ToString("yyyy-MM"),
                };
            }

            // ---- 情侣 ----
            object? couple = null;
            if (has("couples.view"))
            {
                var cs = db.CoupleSettings.FirstOrDefault();
                var lastNote = db.LoveNotes.Include(n => n.FromUser).OrderByDescending(n => n.Id).FirstOrDefault();
                if (cs is not null || lastNote is not null)
                {
                    couple = new
                    {
                        title = cs?.Title ?? "",
                        days = cs is null ? 0 : (today - cs.StartDate.Date).Days + 1,
                        startDate = cs is null ? null : ApiKit.D(cs.StartDate),
                        lastNote = lastNote is null ? null : new
                        {
                            id = lastNote.Id, content = lastNote.Content,
                            from = lastNote.FromUser?.DisplayName ?? "?",
                            createdAt = ApiKit.Stamp(lastNote.CreatedAt),
                        },
                    };
                }
            }

            // ---- 经期 ----
            object? period = null;
            if (has("period.use"))
            {
                var p = db.PeriodRecords.Where(x => x.UserId == uid).OrderByDescending(x => x.StartDate).FirstOrDefault();
                if (p is not null)
                    period = new { startDate = ApiKit.D(p.StartDate), endDate = ApiKit.DN(p.EndDate), note = p.Note };
            }

            // ---- 提醒计数 ----
            var reminderCount = 0;
            if (has("reminders.use"))
            {
                var soon = today.AddDays(3);
                reminderCount += db.Schedules.Count(x => x.UserId == uid && x.StartAt >= today && x.StartAt < soon.AddDays(1));
                if (nextAnnivDays is { } nd && nd <= 7) reminderCount++;
                if (has("habits.use"))
                    reminderCount += db.Habits.Count(h => h.UserId == uid) - habitsChecked;
            }

            var sampleRows = SampleData.Count(db, uid);

            return ApiKit.Ok(new
            {
                today = ApiKit.D(today),
                weekday = WeekLabels[((int)today.DayOfWeek + 6) % 7],
                greeting = Greeting(DateTime.Now),
                upcoming,
                pinnedMemos = pinned,
                habits,
                nextAnniv,
                reminderCount,
                todayCourses,
                currentWeek,
                semesterConfigured,
                mails,
                board,
                expense,
                couple,
                period,
                sampleRows,
                showSampleBanner = !meRow.SamplePromptDismissed && sampleRows > 0,
                dashboardLayout = ApiKit.ParseLayout(meRow.DashboardLayout),
            });
        }).RequireAuthorization("perm:workbench.view");

        // 工作台一键清测试数据
        g.MapPost("/dashboard/clear-sample", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var removed = SampleData.Remove(db, uid);
            var u = db.Users.First(x => x.Id == uid);
            u.SamplePromptDismissed = true;
            db.SaveChanges();
            return ApiKit.Ok(new { removed });
        }).RequireAuthorization("perm:workbench.view");

        // 工作台快捷打卡
        g.MapPost("/dashboard/checkin/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var habit = db.Habits.FirstOrDefault(h => h.Id == id && h.UserId == uid);
            if (habit is null) return ApiKit.NotFound("习惯不存在");
            var today = DateTime.Today;
            if (!db.HabitCheckins.Any(c => c.HabitId == id && c.UserId == uid && c.CheckinDate == today))
            {
                db.HabitCheckins.Add(new HabitCheckin { HabitId = id, UserId = uid, CheckinDate = today, CreatedAt = DateTime.UtcNow });
                db.SaveChanges();
            }
            return ApiKit.Ok(new { @checked = true });
        }).RequireAuthorization("perm:habits.use");

        // ==================== 日程 ====================
        var sc = g.MapGroup("/schedules").RequireAuthorization("perm:schedule.use");

        sc.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var from = ApiKit.ParseDT(ApiKit.StrQ(ctx, "from")) ?? DateTime.Today.AddMonths(-1);
            var to = ApiKit.ParseDT(ApiKit.StrQ(ctx, "to")) ?? DateTime.Today.AddMonths(2);
            var items = db.Schedules
                .Where(s => s.UserId == uid && s.StartAt >= from && s.StartAt <= to)
                .OrderBy(s => s.StartAt).Take(500).ToList()
                .Select(s => new
                {
                    id = s.Id, title = s.Title, description = s.Description,
                    startAt = ApiKit.T(s.StartAt), endAt = ApiKit.TN(s.EndAt), allDay = s.AllDay,
                    updatedAt = ApiKit.Stamp(s.UpdatedAt),
                }).ToList();
            return ApiKit.Ok(new { items, from = ApiKit.D(from), to = ApiKit.D(to) });
        });

        sc.MapPost("", (ScheduleReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var start = ApiKit.ParseDT(req.StartAt) ?? throw new ApiBadRequest("请选择开始时间");
            var end = ApiKit.ParseDT(req.EndAt);
            if (end is not null && end < start) throw new ApiBadRequest("结束时间不能早于开始时间");

            var item = new ScheduleItem
            {
                UserId = uid,
                Title = ApiKit.Req(req.Title, "标题", 100),
                Description = ApiKit.Cut(req.Description, 2000),
                StartAt = start, EndAt = end, AllDay = req.AllDay,
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.Schedules.Add(item);
            db.SaveChanges();
            return ApiKit.Ok(new { id = item.Id });
        });

        sc.MapPut("/{id:int}", (int id, ScheduleReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var item = db.Schedules.FirstOrDefault(s => s.Id == id && s.UserId == uid)
                       ?? throw new ApiBadRequest("日程不存在或已删除");
            var start = ApiKit.ParseDT(req.StartAt) ?? throw new ApiBadRequest("请选择开始时间");
            var end = ApiKit.ParseDT(req.EndAt);
            if (end is not null && end < start) throw new ApiBadRequest("结束时间不能早于开始时间");

            item.Title = ApiKit.Req(req.Title, "标题", 100);
            item.Description = ApiKit.Cut(req.Description, 2000);
            item.StartAt = start; item.EndAt = end; item.AllDay = req.AllDay;
            item.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        sc.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var item = db.Schedules.FirstOrDefault(s => s.Id == id && s.UserId == uid);
            if (item is null) return ApiKit.NotFound("日程不存在或已删除");
            db.Schedules.Remove(item);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 备忘 ====================
        var mc = g.MapGroup("/memos").RequireAuthorization("perm:memo.use");

        mc.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var q = ApiKit.StrQ(ctx, "q").Trim();
            var rows = db.Memos.Where(m => m.UserId == uid);
            if (q.Length > 0)
                rows = rows.Where(m => m.Title.Contains(q) || m.Content.Contains(q));
            var items = rows.OrderByDescending(m => m.Pinned).ThenByDescending(m => m.UpdatedAt)
                .Take(300).ToList()
                .Select(m => new
                {
                    id = m.Id, title = m.Title, content = m.Content, pinned = m.Pinned,
                    createdAt = ApiKit.Stamp(m.CreatedAt), updatedAt = ApiKit.Stamp(m.UpdatedAt),
                }).ToList();
            return ApiKit.Ok(new { items });
        });

        mc.MapPost("", (MemoReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = new MemoItem
            {
                UserId = uid,
                Title = ApiKit.Req(req.Title, "标题", 100),
                Content = ApiKit.Cut(req.Content, 5000),
                Pinned = req.Pinned,
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.Memos.Add(m);
            db.SaveChanges();
            return ApiKit.Ok(new { id = m.Id });
        });

        mc.MapPut("/{id:int}", (int id, MemoReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.Memos.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                    ?? throw new ApiBadRequest("便签不存在或已删除");
            m.Title = ApiKit.Req(req.Title, "标题", 100);
            m.Content = ApiKit.Cut(req.Content, 5000);
            m.Pinned = req.Pinned;
            m.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        mc.MapPost("/{id:int}/pin", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.Memos.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                    ?? throw new ApiBadRequest("便签不存在或已删除");
            m.Pinned = !m.Pinned;
            m.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { pinned = m.Pinned });
        });

        mc.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.Memos.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (m is null) return ApiKit.NotFound("便签不存在或已删除");
            db.Memos.Remove(m);
            db.SaveChanges();
            return ApiKit.Ok();
        });
    }

    private static string Greeting(DateTime d) => d.Hour switch
    {
        < 6 => "夜深了",
        < 11 => "早上好",
        < 14 => "中午好",
        < 18 => "下午好",
        _ => "晚上好",
    };

    private static string HoursOf(int startPeriod, List<PeriodSlot> periods)
    {
        if (periods.Count == 0) return "";
        var p = Math.Clamp(startPeriod, 1, periods.Count) - 1;
        return $"{periods[p].Start}～{periods[p].End}";
    }

    private static DateTime MondayOf(DateTime d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    /// <summary>连续天数（今天没打就从昨天回数，宽容一天 —— 与打卡页同一口径）</summary>
    private static int Streak(HashSet<DateTime> dates, DateTime today)
    {
        var day = dates.Contains(today) ? today : today.AddDays(-1);
        var n = 0;
        while (dates.Contains(day)) { n++; day = day.AddDays(-1); }
        return n;
    }
}
