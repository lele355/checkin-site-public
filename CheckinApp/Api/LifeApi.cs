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
    /// <summary>记账条目（合并容器）：Name 改名/建组用，Ids 要归入或移出的明细 Id</summary>
    public record ExpenseGroupReq(string? Name, List<int>? Ids);
    /// <summary>记账自定义分类（全量列表；服务端会 Normalize 去重限长限量）</summary>
    public record CategoryReq(List<string>? Categories);
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
            var today = SiteClock.Today;
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
            var today = SiteClock.Today;
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
            var today = SiteClock.Today;
            var row = db.HabitCheckins.FirstOrDefault(c => c.HabitId == id && c.UserId == uid && c.CheckinDate == today);
            if (row is not null) { db.HabitCheckins.Remove(row); db.SaveChanges(); }
            return ApiKit.Ok(Stat(db, id, uid, today, false));
        });

        // ==================== 记账 ====================
        var ex = g.MapGroup("/expenses").RequireAuthorization("perm:expense.use");

        // ---------- 分类（自定义分类，2026-10-28 加） ----------
        // 挂在 /expenses 下面而不是 /me/prefs：分类是记账的领域数据，
        // 权限也跟记账一致，独立成端点后 App 不必为了改分类去动整份偏好。
        ex.MapGet("/categories", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var raw = db.Users.Where(u => u.Id == uid).Select(u => u.ExpenseCategories).FirstOrDefault();
            return ApiKit.Ok(new
            {
                categories = ExpenseCategoryCatalog.Load(raw),
                defaults = ExpenseCategoryCatalog.Defaults,
                maxCount = ExpenseCategoryCatalog.MaxCount,
                maxLen = ExpenseCategoryCatalog.MaxLen,
            });
        });

        ex.MapPut("/categories", (CategoryReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.FirstOrDefault(u => u.Id == uid)
                       ?? throw new ApiBadRequest("账号不存在");
            var list = ExpenseCategoryCatalog.Normalize(req.Categories);
            user.ExpenseCategories = ExpenseCategoryCatalog.Store(list);
            db.SaveChanges();
            return ApiKit.Ok(new { categories = list });
        });

        ex.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var q = (ApiKit.StrQ(ctx, "q") ?? "").Trim();
            var searching = q.Length > 0;
            if (q.Length > 50) q = q[..50];

            var monthRaw = ApiKit.StrQ(ctx, "month");
            var month = DateTime.TryParseExact(monthRaw, "yyyy-MM", CultureInfo.InvariantCulture,
                            DateTimeStyles.None, out var parsed)
                ? new DateTime(parsed.Year, parsed.Month, 1)
                : new DateTime(SiteClock.Today.Year, SiteClock.Today.Month, 1);
            var next = month.AddMonths(1);

            // 搜索：跨全部月份按备注/分类/条目名模糊匹配（不受当前月份限制）；不搜索就按月取
            var hitGroupIds = searching
                ? db.ExpenseGroups.AsNoTracking()
                    .Where(gr => gr.UserId == uid && gr.Name.Contains(q))
                    .Select(gr => gr.Id).ToList()
                : [];
            var rows = searching
                ? db.Expenses
                    .Where(x => x.UserId == uid
                                && ((x.Note != null && x.Note.Contains(q)) || x.Category.Contains(q)
                                    || (x.GroupId != null && hitGroupIds.Contains(x.GroupId.Value))))
                    .OrderByDescending(x => x.OccurDate).ThenByDescending(x => x.Id)
                    .Take(200)
                    .ToList()
                : db.Expenses.Where(x => x.UserId == uid && x.OccurDate >= month && x.OccurDate < next)
                    .OrderByDescending(x => x.OccurDate).ThenByDescending(x => x.Id).ToList();

            // 条目（合并容器）名称：只有当月明细涉及的组才查，一次查完不做 N+1
            var gids = rows.Where(x => x.GroupId is not null).Select(x => x.GroupId!.Value).Distinct().ToList();
            var groupNames = gids.Count == 0
                ? new Dictionary<int, string>()
                : db.ExpenseGroups.AsNoTracking()
                    .Where(gr => gr.UserId == uid && gids.Contains(gr.Id))
                    .ToDictionary(gr => gr.Id, gr => gr.Name);
            // 组内总笔数（跨月时要告诉前端「其它月份还有 N 笔」）
            var groupTotals = gids.Count == 0
                ? new Dictionary<int, int>()
                : db.Expenses.AsNoTracking()
                    .Where(x => x.UserId == uid && x.GroupId != null && gids.Contains(x.GroupId.Value))
                    .GroupBy(x => x.GroupId!.Value)
                    .Select(gr => new { Id = gr.Key, N = gr.Count() })
                    .ToDictionary(x => x.Id, x => x.N);

            var items = rows.Select(x => new
            {
                id = x.Id, amount = x.Amount, type = x.Type, category = x.Category,
                // 精确到分钟：yyyy-MM-ddTHH:mm（不带日期以外的零秒，App 的 Dates.parse 直接吃得下）
                occurDate = ApiKit.T(x.OccurDate), note = x.Note,
                // 条目信息：老 App 会忽略这两个字段（Api.kt 里 ignoreUnknownKeys）
                groupId = x.GroupId,
                groupName = x.GroupId is int gid && groupNames.TryGetValue(gid, out var gn) ? gn : "",
            }).ToList();

            // 条目视图（按「当月视角」分组）：搜索跨月、结果要一条条找，一律平铺不给分组
            var groupView = new List<(string SortKey, object Payload)>();
            if (!searching)
            {
                foreach (var grp in rows.Where(x => x.GroupId is not null).GroupBy(x => x.GroupId!.Value))
                {
                    if (!groupNames.TryGetValue(grp.Key, out var gname)) continue;
                    var list = grp.OrderByDescending(x => x.OccurDate).ThenByDescending(x => x.Id).ToList();
                    var total = groupTotals.GetValueOrDefault(grp.Key, list.Count);
                    var payload = new
                    {
                        id = grp.Key,
                        name = gname,
                        count = list.Count,
                        // 组内其它月份的笔数：展开时可以提示一句，别让人以为账丢了
                        otherCount = Math.Max(0, total - list.Count),
                        totalIn = list.Where(x => x.Type == "in").Sum(x => x.Amount),
                        totalOut = list.Where(x => x.Type == "out").Sum(x => x.Amount),
                        // 组自身没有时间，用「当月最新一笔」作为它在列表里的位置
                        occurDate = ApiKit.T(list[0].OccurDate),
                        items = list.Select(x => new
                        {
                            id = x.Id, amount = x.Amount, type = x.Type, category = x.Category,
                            occurDate = ApiKit.T(x.OccurDate), note = x.Note,
                        }).ToList(),
                    };
                    groupView.Add((ApiKit.T(list[0].OccurDate) + "|" + grp.Key.ToString("D9"), (object)payload));
                }
                groupView.Sort((a, b) => string.CompareOrdinal(b.SortKey, a.SortKey));
            }

            var byCategory = rows.Where(x => x.Type == "out").GroupBy(x => x.Category)
                .Select(gr => new { name = gr.Key, amount = gr.Sum(x => x.Amount) })
                .OrderByDescending(x => x.amount).ToList();

            // 近 12 个月（含本月）—— 搜索态不查，省一次全表扫
            var months = new List<object>();
            if (!searching)
            {
                var start = month.AddMonths(-11);
                var all = db.Expenses.Where(x => x.UserId == uid && x.OccurDate >= start && x.OccurDate < next)
                    .Select(x => new { x.OccurDate, x.Type, x.Amount }).ToList()
                    .GroupBy(x => new { x.OccurDate.Year, x.OccurDate.Month })
                    .ToDictionary(gr => new DateTime(gr.Key.Year, gr.Key.Month, 1),
                        gr => new { In = gr.Where(x => x.Type == "in").Sum(x => x.Amount),
                                    Out = gr.Where(x => x.Type == "out").Sum(x => x.Amount),
                                    Count = gr.Count() });

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
            }

            return ApiKit.Ok(new
            {
                month = month.ToString("yyyy-MM"),
                q,
                searching,
                items,
                // 条目视图（新 App 用）：每项是一个「合并容器 + 它当月那几笔」。
                // 老 App 不认这个字段，照旧平铺 items —— 明细永远全量下发，金额不会丢也不会重复。
                groups = groupView.Select(x => x.Payload).ToList(),
                // 顺手带上分类：记账页一打开就要渲染分类选择器，
                // 再让 App 多打一个 /expenses/categories 是白等一个来回。
                categories = ExpenseCategoryCatalog.Load(
                    db.Users.Where(u => u.Id == uid).Select(u => u.ExpenseCategories).FirstOrDefault()),
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
            // 发生时间精确到分钟；没传就按「此刻」（手机点记一笔基本是当场记，别再落到 00:00）
            var occur = SiteClock.ToMinute(ApiKit.ParseDT(req.OccurDate) ?? SiteClock.Now);

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
            if (ApiKit.ParseDT(req.OccurDate) is { } occurIn)
                item.OccurDate = SiteClock.ToMinute(occurIn);
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
            var gid = item.GroupId;
            db.Expenses.Remove(item);
            db.SaveChanges();
            // 组里最后一笔被删掉 → 组自动解散（否则列表里会留一个点不开的空条目）
            DropGroupIfEmpty(db, uid, gid);
            return ApiKit.Ok();
        });

        // ==================== 记账条目（合并容器） ====================
        //
        // 语义：条目只是一个「名字 + 一组明细」。它自己没有分类、没有时间、没有金额，
        // 列表里的金额一律是明细求和，所以统计/导出/AI 全都不需要认识它。
        // 明细与条目是「一个明细最多属于一个条目」，不支持嵌套。

        ex.MapPost("/groups", (ExpenseGroupReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var name = CleanGroupName(req.Name);
            if (name.Length == 0) throw new ApiBadRequest("条目名不能为空");
            var ids = CleanIds(req.Ids);
            if (ids.Length < 2) throw new ApiBadRequest("至少选 2 笔账才能合并成一个条目");

            var rows = db.Expenses.Where(x => x.UserId == uid && ids.Contains(x.Id)).ToList();
            if (rows.Count != ids.Length) throw new ApiBadRequest("有账目不存在或不属于你");
            if (rows.Any(x => x.GroupId is not null))
                throw new ApiBadRequest("有账目已经属于别的条目了，先把它移出来再合并");

            var now = DateTime.UtcNow;
            var grp = new ExpenseGroup { UserId = uid, Name = name, CreatedAt = now, UpdatedAt = now };
            db.ExpenseGroups.Add(grp);
            db.SaveChanges();
            foreach (var r in rows) { r.GroupId = grp.Id; r.UpdatedAt = now; }
            db.SaveChanges();
            return ApiKit.Ok(new { id = grp.Id, name, count = rows.Count });
        });

        // 条目详情：全量明细（不限当月）—— 管理弹层要能列出并移出任意一笔
        ex.MapGet("/groups/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var grp = db.ExpenseGroups.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                      ?? throw new ApiBadRequest("条目不存在或已删除");
            var rows = db.Expenses.Where(x => x.UserId == uid && x.GroupId == id)
                .OrderByDescending(x => x.OccurDate).ThenByDescending(x => x.Id).ToList();
            return ApiKit.Ok(new
            {
                id = grp.Id,
                name = grp.Name,
                count = rows.Count,
                totalIn = rows.Where(x => x.Type == "in").Sum(x => x.Amount),
                totalOut = rows.Where(x => x.Type == "out").Sum(x => x.Amount),
                items = rows.Select(x => new
                {
                    id = x.Id, amount = x.Amount, type = x.Type, category = x.Category,
                    occurDate = ApiKit.T(x.OccurDate), note = x.Note,
                }).ToList(),
            });
        });

        ex.MapPut("/groups/{id:int}", (int id, ExpenseGroupReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var grp = db.ExpenseGroups.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                      ?? throw new ApiBadRequest("条目不存在或已删除");
            var name = CleanGroupName(req.Name);
            if (name.Length == 0) throw new ApiBadRequest("条目名不能为空");
            grp.Name = name;
            grp.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id, name });
        });

        // 追加明细进已有条目（合并之后又买了一笔，不用重新合并一次）
        ex.MapPost("/groups/{id:int}/items", (int id, ExpenseGroupReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var grp = db.ExpenseGroups.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                      ?? throw new ApiBadRequest("条目不存在或已删除");
            var ids = CleanIds(req.Ids);
            if (ids.Length == 0) throw new ApiBadRequest("没有要加入的账目");

            var rows = db.Expenses.Where(x => x.UserId == uid && ids.Contains(x.Id)).ToList();
            if (rows.Count != ids.Length) throw new ApiBadRequest("有账目不存在或不属于你");
            if (rows.Any(x => x.GroupId is not null && x.GroupId != id))
                throw new ApiBadRequest("有账目已经属于别的条目了");

            var now = DateTime.UtcNow;
            foreach (var r in rows) { r.GroupId = grp.Id; r.UpdatedAt = now; }
            grp.UpdatedAt = now;
            db.SaveChanges();
            var total = db.Expenses.Count(x => x.UserId == uid && x.GroupId == grp.Id);
            return ApiKit.Ok(new { id = grp.Id, count = total });
        });

        // 把明细移出条目（明细本身不删，退回成普通的一笔）
        ex.MapPost("/groups/{id:int}/items/remove", (int id, ExpenseGroupReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var grp = db.ExpenseGroups.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                      ?? throw new ApiBadRequest("条目不存在或已删除");
            var ids = CleanIds(req.Ids);
            if (ids.Length == 0) throw new ApiBadRequest("没有要移出的账目");

            var rows = db.Expenses.Where(x => x.UserId == uid && x.GroupId == id && ids.Contains(x.Id)).ToList();
            if (rows.Count == 0) throw new ApiBadRequest("这些账目不在该条目里");
            var now = DateTime.UtcNow;
            foreach (var r in rows) { r.GroupId = null; r.UpdatedAt = now; }
            grp.UpdatedAt = now;
            db.SaveChanges();
            DropGroupIfEmpty(db, uid, id);
            return ApiKit.Ok(new { moved = rows.Count });
        });

        // 解散条目：明细全部保留，只是解除归属
        ex.MapDelete("/groups/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var grp = db.ExpenseGroups.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (grp is null) return ApiKit.NotFound("条目不存在或已删除");
            foreach (var r in db.Expenses.Where(x => x.UserId == uid && x.GroupId == id))
            { r.GroupId = null; r.UpdatedAt = DateTime.UtcNow; }
            db.ExpenseGroups.Remove(grp);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 课程表 ====================
        var co = g.MapGroup("/courses").RequireAuthorization("perm:courses.use");

        co.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = SiteClock.Today;
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
            return ApiKit.Ok(new { id = sem.Id, currentWeek = Math.Max(1, (int)((SiteClock.Today - sem.StartDate).TotalDays / 7) + 1) });
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
        co.MapPut("/settings", (CourseSettingsReq req, AppDbContext db, HttpContext ctx) =>
        {
            if (req.SemesterStart is not null)
            {
                var d = ApiKit.ParseDate(req.SemesterStart) ?? throw new ApiBadRequest("学期起始日期格式不对");
                // 改当前学期的起始日，而不是只写老的 AppSetting("courses.semester-start")。
                // 只写老键会让 Semesters.StartDate 与 AppSetting 分叉，工作台/课表/接口
                // 各按各的算周次，表现就是「网页和 App 显示的课不一样」。
                // SemesterService.Update 内部会把老键同步回去（导出、旧页面还在读它）。
                var uid = ApiKit.MeId(ctx);
                var sem = SemesterService.Current(db, uid);
                SemesterService.Update(db, uid, sem.Id, null, d);
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
            var today = SiteClock.Today;
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

    // ---------- 记账条目（合并）----------

    /// <summary>条目名：去空白、限 20 字（空串交给调用方报错，不在这里兜默认名）</summary>
    private static string CleanGroupName(string? name) => ApiKit.Cut(name, 20);

    /// <summary>一次合并的明细 Id：去重、限 100 笔（防止误传全表 Id 造成大事务）</summary>
    private static int[] CleanIds(List<int>? ids) =>
        (ids ?? []).Where(i => i > 0).Distinct().Take(100).ToArray();

    /// <summary>组内一笔不剩就把组删掉 —— 空条目在列表里是个点不开的死角</summary>
    private static void DropGroupIfEmpty(AppDbContext db, int uid, int? groupId)
    {
        if (groupId is not int gid) return;
        if (db.Expenses.Any(x => x.UserId == uid && x.GroupId == gid)) return;
        var grp = db.ExpenseGroups.FirstOrDefault(x => x.Id == gid && x.UserId == uid);
        if (grp is null) return;
        db.ExpenseGroups.Remove(grp);
        db.SaveChanges();
    }
}
