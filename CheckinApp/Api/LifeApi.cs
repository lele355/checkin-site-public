using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace CheckinApp.Api;

/// <summary>打卡 / 记账 / 课程表 / 统计 —— 四个数据密度最高的模块。</summary>
public static class LifeApi
{
    public record HabitReq(string? Name, string? Icon);
    public record ExpenseReq(decimal Amount, string? Type, string? Category, string? OccurDate, string? Note);
    public record CourseReq(string? Name, string? Teacher, string? Location, int Weekday,
                            int StartPeriod, int EndPeriod, string? WeeksText, string? Category,
                            string? Color);
    public record PeriodsReq(List<string>? Start, List<string>? End);
    /// <summary>学期新建 / 改名用。StartDate 可空 = 这次不改起始日（只改名时就靠它）</summary>
    public record SemesterReq(string? Name, string? StartDate);
    public record CourseSettingsReq(string? SemesterStart, List<PeriodPair>? Periods);
    public record PeriodPair(string? S, string? E);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1");

        // ==================== 打卡 ====================
        var hb = g.MapGroup("/habits").RequireAuthorization("perm:habits.use");

        hb.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = DateTime.Today;
            var habits = db.Habits.Where(h => h.UserId == uid).OrderBy(h => h.Id).ToList();

            var checkins = db.HabitCheckins.Where(c => c.UserId == uid)
                .Select(c => new { c.HabitId, c.CheckinDate }).ToList()
                .GroupBy(c => c.HabitId)
                .ToDictionary(g2 => g2.Key, g2 => g2.Select(x => x.CheckinDate.Date).ToHashSet());

            var weekDays = Enumerable.Range(0, 7).Select(i => today.AddDays(-6 + i)).ToList();
            var items = habits.Select(h =>
            {
                var dates = checkins.GetValueOrDefault(h.Id) ?? [];
                return new
                {
                    id = h.Id, name = h.Name, icon = h.Icon,
                    checkedToday = dates.Contains(today),
                    streak = Streak(dates, today),
                    total = dates.Count,
                    week = weekDays.Select(d => dates.Contains(d)).ToList(),
                };
            }).ToList();

            return ApiKit.Ok(new { items, today = ApiKit.D(today) });
        });

        hb.MapPost("", (HabitReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var h = new Habit
            {
                UserId = uid,
                Name = ApiKit.Req(req.Name, "习惯名", 30),
                Icon = string.IsNullOrWhiteSpace(req.Icon) ? "🌱" : ApiKit.Cut(req.Icon, 8),
                CreatedAt = DateTime.UtcNow,
            };
            db.Habits.Add(h);
            db.SaveChanges();
            return ApiKit.Ok(new { id = h.Id });
        });

        hb.MapPut("/{id:int}", (int id, HabitReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var h = db.Habits.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                    ?? throw new ApiBadRequest("习惯不存在或已删除");
            h.Name = ApiKit.Req(req.Name, "习惯名", 30);
            h.Icon = string.IsNullOrWhiteSpace(req.Icon) ? h.Icon : ApiKit.Cut(req.Icon, 8);
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        hb.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var h = db.Habits.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (h is null) return ApiKit.NotFound("习惯不存在或已删除");
            db.Habits.Remove(h);      // 级联删打卡记录
            db.SaveChanges();
            return ApiKit.Ok();
        });

        hb.MapPost("/{id:int}/checkin", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var h = db.Habits.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (h is null) return ApiKit.NotFound("习惯不存在或已删除");
            var today = DateTime.Today;
            if (!db.HabitCheckins.Any(c => c.HabitId == id && c.UserId == uid && c.CheckinDate == today))
            {
                db.HabitCheckins.Add(new HabitCheckin { HabitId = id, UserId = uid, CheckinDate = today, CreatedAt = DateTime.UtcNow });
                db.SaveChanges();
            }
            return ApiKit.Ok(Stat(db, id, uid, today, true));
        });

        hb.MapDelete("/{id:int}/checkin", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = DateTime.Today;
            var row = db.HabitCheckins.FirstOrDefault(c => c.HabitId == id && c.UserId == uid && c.CheckinDate == today);
            if (row is not null) { db.HabitCheckins.Remove(row); db.SaveChanges(); }
            return ApiKit.Ok(Stat(db, id, uid, today, false));
        });

        // ==================== 记账 ====================
        var ex = g.MapGroup("/expenses").RequireAuthorization("perm:expense.use");

        ex.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var monthRaw = ApiKit.StrQ(ctx, "month");
            var month = DateTime.TryParseExact(monthRaw, "yyyy-MM", CultureInfo.InvariantCulture,
                            DateTimeStyles.None, out var parsed)
                ? new DateTime(parsed.Year, parsed.Month, 1)
                : new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
            var next = month.AddMonths(1);

            var rows = db.Expenses.Where(x => x.UserId == uid && x.OccurDate >= month && x.OccurDate < next)
                .OrderByDescending(x => x.OccurDate).ThenByDescending(x => x.Id).ToList();

            var items = rows.Select(x => new
            {
                id = x.Id, amount = x.Amount, type = x.Type, category = x.Category,
                occurDate = ApiKit.D(x.OccurDate), note = x.Note,
            }).ToList();

            var byCategory = rows.Where(x => x.Type == "out").GroupBy(x => x.Category)
                .Select(gr => new { name = gr.Key, amount = gr.Sum(x => x.Amount) })
                .OrderByDescending(x => x.amount).ToList();

            // 近 12 个月（含本月）
            var start = month.AddMonths(-11);
            var all = db.Expenses.Where(x => x.UserId == uid && x.OccurDate >= start && x.OccurDate < next)
                .Select(x => new { x.OccurDate, x.Type, x.Amount }).ToList()
                .GroupBy(x => new { x.OccurDate.Year, x.OccurDate.Month })
                .ToDictionary(gr => new DateTime(gr.Key.Year, gr.Key.Month, 1),
                    gr => new { In = gr.Where(x => x.Type == "in").Sum(x => x.Amount),
                                Out = gr.Where(x => x.Type == "out").Sum(x => x.Amount),
                                Count = gr.Count() });

            var months = new List<object>();
            for (var i = 11; i >= 0; i--)
            {
                var mo = month.AddMonths(-i);
                var r = all.GetValueOrDefault(mo);
                months.Add(new
                {
                    month = mo.ToString("yyyy-MM"),
                    label = $"{mo.Month}月",
                    @in = r?.In ?? 0,
                    @out = r?.Out ?? 0,
                    count = r?.Count ?? 0,
                });
            }

            return ApiKit.Ok(new
            {
                month = month.ToString("yyyy-MM"),
                items,
                summary = new
                {
                    totalOut = rows.Where(x => x.Type == "out").Sum(x => x.Amount),
                    totalIn = rows.Where(x => x.Type == "in").Sum(x => x.Amount),
                    count = rows.Count,
                    byCategory,
                },
                months,
            });
        });

        ex.MapPost("", (ExpenseReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            if (req.Amount <= 0) throw new ApiBadRequest("金额要大于 0");
            if (req.Amount > 9_999_999) throw new ApiBadRequest("金额太大了吧");
            var type = req.Type == "in" ? "in" : "out";
            var occur = ApiKit.ParseDT(req.OccurDate)?.Date ?? DateTime.Today;

            var item = new ExpenseItem
            {
                UserId = uid, Amount = decimal.Round(req.Amount, 2), Type = type,
                Category = string.IsNullOrWhiteSpace(req.Category) ? "其他" : ApiKit.Cut(req.Category, 20),
                OccurDate = occur, Note = ApiKit.Cut(req.Note, 200),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.Expenses.Add(item);
            db.SaveChanges();
            return ApiKit.Ok(new { id = item.Id });
        });

        ex.MapPut("/{id:int}", (int id, ExpenseReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var item = db.Expenses.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                       ?? throw new ApiBadRequest("账目不存在或已删除");
            if (req.Amount <= 0) throw new ApiBadRequest("金额要大于 0");
            item.Amount = decimal.Round(req.Amount, 2);
            item.Type = req.Type == "in" ? "in" : "out";
            item.Category = string.IsNullOrWhiteSpace(req.Category) ? "其他" : ApiKit.Cut(req.Category, 20);
            item.OccurDate = ApiKit.ParseDT(req.OccurDate)?.Date ?? item.OccurDate;
            item.Note = ApiKit.Cut(req.Note, 200);
            item.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        ex.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var item = db.Expenses.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (item is null) return ApiKit.NotFound("账目不存在或已删除");
            db.Expenses.Remove(item);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 课程表 ====================
        var co = g.MapGroup("/courses").RequireAuthorization("perm:courses.use");

        co.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = DateTime.Today;
            // 学期现在是一张表：起始日和名字都从「当前学期」拿，课也只取这一学期的
            var sem = SemesterService.Current(db, uid);
            var semStart = sem.StartDate;
            var week = Math.Max(1, (int)((today - semStart).TotalDays / 7) + 1);

            var periods = CoursesConfig.Load(db);
            var items = db.Courses.Where(c => c.UserId == uid && c.SemesterId == sem.Id)
                .OrderBy(c => c.Weekday).ThenBy(c => c.StartPeriod)
                .ToList().Select(c => new
                {
                    id = c.Id, name = c.Name, teacher = c.Teacher, location = c.Location,
                    weekday = c.Weekday, startPeriod = c.StartPeriod, endPeriod = c.EndPeriod,
                    weeksText = c.WeeksText, weeksLabel = Weeks.Display(c.WeeksText), category = c.Category,
                    // 已算好的颜色（用户设过的优先，否则按课名默认）—— App 直接拿去上色，
                    // 不用在客户端再实现一遍 NameKey 归一化与哈希，两端才不会各算各的
                    color = CoursePalette.Of(c),
                }).ToList();

            return ApiKit.Ok(new
            {
                items,
                periods = periods.Select(p => new { start = p.Start, end = p.End }).ToList(),
                semesterStart = ApiKit.D(semStart),
                semesterConfigured = true,
                // 当前学期（App 顶部要显示名字，学期弹层也要知道自己是谁）
                semesterId = sem.Id,
                semesterName = sem.Name,
                currentWeek = week,
                todayWeekday = ((int)today.DayOfWeek + 6) % 7 + 1,
            });
        });

        // ---------- 学期管理 ----------
        co.MapGet("/semesters", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var cur = SemesterService.Current(db, uid);
            var counts = db.Courses.Where(c => c.UserId == uid && c.SemesterId != null)
                .GroupBy(c => c.SemesterId!.Value)
                .Select(g => new { Id = g.Key, N = g.Count() })
                .ToDictionary(x => x.Id, x => x.N);
            var items = SemesterService.List(db, uid).Select(s => new
            {
                id = s.Id, name = s.Name, startDate = ApiKit.D(s.StartDate),
                courseCount = counts.GetValueOrDefault(s.Id), isCurrent = s.Id == cur.Id,
            }).ToList();
            return ApiKit.Ok(new { items, currentId = cur.Id });
        });

        co.MapPost("/semesters", (SemesterReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            if (req.StartDate is null) throw new ApiBadRequest("请选择起始日");
            var start = ApiKit.ParseDT(req.StartDate) ?? throw new ApiBadRequest("起始日格式不对");
            var sem = SemesterService.Create(db, uid, ApiKit.Cut(req.Name, 20), start);
            return ApiKit.Ok(new { id = sem.Id, name = sem.Name, startDate = ApiKit.D(sem.StartDate) });
        });

        co.MapPut("/semesters/{id:int}", (int id, SemesterReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var start = req.StartDate is null ? (DateTime?)null : ApiKit.ParseDT(req.StartDate);
            var sem = SemesterService.Update(db, uid, id, ApiKit.Cut(req.Name, 20), start)
                      ?? throw new ApiBadRequest("学期不存在或已删除");
            return ApiKit.Ok(new { id = sem.Id, name = sem.Name, startDate = ApiKit.D(sem.StartDate) });
        });

        co.MapPost("/semesters/{id:int}/switch", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var sem = SemesterService.SwitchTo(db, uid, id) ?? throw new ApiBadRequest("学期不存在或已删除");
            return ApiKit.Ok(new { id = sem.Id, currentWeek = Math.Max(1, (int)((DateTime.Today - sem.StartDate).TotalDays / 7) + 1) });
        });

        co.MapDelete("/semesters/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var (ok, error, deleted) = SemesterService.Delete(db, uid, id);
            if (!ok) throw new ApiBadRequest(error ?? "删除失败");
            return ApiKit.Ok(new { deletedCourses = deleted });
        });

        co.MapPost("", (CourseReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var (s, e) = NormalizePeriods(db, req.StartPeriod, req.EndPeriod);
            var sem = SemesterService.Current(db, uid);
            var c = new Course
            {
                UserId = uid,
                SemesterId = sem.Id,
                Name = ApiKit.Req(req.Name, "课程名", 50),
                Teacher = ApiKit.Cut(req.Teacher, 30),
                Location = ApiKit.Cut(req.Location, 40),
                Weekday = Math.Clamp(req.Weekday, 1, 7),
                StartPeriod = s, EndPeriod = e,
                WeeksText = string.IsNullOrWhiteSpace(req.WeeksText) ? "1-16" : ApiKit.Cut(req.WeeksText, 40),
                Category = req.Category is "required" or "college" or "school" or "other" ? req.Category : "other",
                Color = CoursePalette.Normalize(req.Color),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.Courses.Add(c);
            db.SaveChanges();
            return ApiKit.Ok(new { id = c.Id });
        });

        co.MapPut("/{id:int}", (int id, CourseReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var c = db.Courses.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                    ?? throw new ApiBadRequest("课程不存在或已删除");
            var (s, e) = NormalizePeriods(db, req.StartPeriod, req.EndPeriod);
            c.Name = ApiKit.Req(req.Name, "课程名", 50);
            c.Teacher = ApiKit.Cut(req.Teacher, 30);
            c.Location = ApiKit.Cut(req.Location, 40);
            c.Weekday = Math.Clamp(req.Weekday, 1, 7);
            c.StartPeriod = s; c.EndPeriod = e;
            c.WeeksText = string.IsNullOrWhiteSpace(req.WeeksText) ? "1-16" : ApiKit.Cut(req.WeeksText, 40);
            c.Category = req.Category is "required" or "college" or "school" or "other" ? req.Category : "other";
            // App 传空串 = 改回「自动」（跟着课名算），空串是合法意图，不能当没传
            c.Color = CoursePalette.Normalize(req.Color);
            c.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        co.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var c = db.Courses.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (c is null) return ApiKit.NotFound("课程不存在或已删除");
            db.Courses.Remove(c);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // 学期起始 + 节次时间配置
        co.MapPut("/settings", (CourseSettingsReq req, AppDbContext db) =>
        {
            if (req.SemesterStart is not null)
            {
                var d = ApiKit.ParseDate(req.SemesterStart) ?? throw new ApiBadRequest("学期起始日期格式不对");
                var key = "courses.semester-start";
                var row = db.AppSettings.FirstOrDefault(x => x.Key == key);
                if (row is null) db.AppSettings.Add(new AppSetting { Key = key, Value = ApiKit.D(d) });
                else row.Value = ApiKit.D(d);
            }

            if (req.Periods is not null)
            {
                var slots = new List<PeriodSlot>();
                foreach (var p in req.Periods)
                {
                    var n = CoursesConfig.Normalize(p.S, p.E);
                    if (n is null) throw new ApiBadRequest("节次时间不合法（结束要晚于开始）");
                    slots.Add(n);
                }
                if (slots.Count is < CoursesConfig.MinCount or > CoursesConfig.MaxCount)
                    throw new ApiBadRequest($"节数需在 {CoursesConfig.MinCount}～{CoursesConfig.MaxCount} 之间");
                CoursesConfig.Save(db, slots);
            }

            db.SaveChanges();
            return ApiKit.Ok(new { periods = CoursesConfig.Load(db).Select(p => new { start = p.Start, end = p.End }) });
        });

        // ==================== 统计 ====================
        g.MapGet("/stats", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = DateTime.Today;
            var from90 = today.AddDays(-89);

            var daily = db.HabitCheckins.Where(c => c.UserId == uid && c.CheckinDate >= from90)
                .GroupBy(c => c.CheckinDate)
                .Select(gr => new { Day = gr.Key, Count = gr.Count() })
                .ToList().ToDictionary(x => x.Day.Date, x => x.Count);

            var heat = new List<object>();
            for (var d = from90; d <= today; d = d.AddDays(1))
                heat.Add(new { date = ApiKit.D(d), count = daily.GetValueOrDefault(d) });

            var topHabits = db.Habits.Where(h => h.UserId == uid).ToList()
                .Select(h => new { name = h.Name, icon = h.Icon, total = db.HabitCheckins.Count(c => c.HabitId == h.Id) })
                .OrderByDescending(x => x.total).Take(5).ToList();

            var startMonth = new DateTime(today.Year, today.Month, 1).AddMonths(-5);
            var expenses = db.Expenses.Where(x => x.UserId == uid && x.Type == "out" && x.OccurDate >= startMonth)
                .Select(x => new { x.OccurDate, x.Amount }).ToList();

            var months = new List<object>();
            decimal maxOut = 0;
            for (var m = 0; m < 6; m++)
            {
                var mo = startMonth.AddMonths(m);
                var sum = expenses.Where(x => x.OccurDate >= mo && x.OccurDate < mo.AddMonths(1)).Sum(x => x.Amount);
                if (sum > maxOut) maxOut = sum;
                months.Add(new { label = $"{mo.Month}月", amount = sum });
            }

            return ApiKit.Ok(new
            {
                heat,
                topHabits,
                months,
                maxMonthOut = maxOut,
                counts = new
                {
                    schedules = db.Schedules.Count(x => x.UserId == uid),
                    memos = db.Memos.Count(x => x.UserId == uid),
                    board = db.BoardMessages.Count(x => x.UserId == uid),
                    courses = db.Courses.Count(x => x.UserId == uid),
                    checkins = db.HabitCheckins.Count(c => c.UserId == uid),
                },
            });
        }).RequireAuthorization("perm:stats.use");
    }

    // ---------- 私有 ----------
    private static object Stat(AppDbContext db, int habitId, int uid, DateTime today, bool checkedToday)
    {
        var dates = db.HabitCheckins.Where(c => c.HabitId == habitId && c.UserId == uid)
            .Select(c => c.CheckinDate).ToList().Select(d => d.Date).ToHashSet();
        var week = Enumerable.Range(0, 7).Select(i => dates.Contains(today.AddDays(-6 + i))).ToList();
        return new { @checked = checkedToday, streak = Streak(dates, today), total = dates.Count, week };
    }

    /// <summary>连续打卡天数：今天打了从今天往回数；今天没打从昨天往回数（断签宽容一天）。</summary>
    private static int Streak(HashSet<DateTime> dates, DateTime today)
    {
        var day = dates.Contains(today) ? today : today.AddDays(-1);
        var n = 0;
        while (dates.Contains(day)) { n++; day = day.AddDays(-1); }
        return n;
    }

    private static (int Start, int End) NormalizePeriods(AppDbContext db, int start, int end)
    {
        var count = CoursesConfig.Load(db).Count;
        var s = Math.Clamp(start, 1, count);
        var e = Math.Clamp(end, s, count);
        return (s, e);
    }

    private static DateTime MondayOf(DateTime d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
