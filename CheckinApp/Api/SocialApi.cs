using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;

namespace CheckinApp.Api;

/// <summary>纪念日 / 留言板 / 情侣空间 / 经期 / 提醒 / 数据导出。</summary>
public static class SocialApi
{
    public record AnnivReq(string? Title, string? Date, bool RepeatYearly, string? Note);
    public record BoardReq(string? Content);
    public record CoupleReq(string? Title, string? StartDate);
    public record NoteReq(string? Content);
    public record PeriodReq(string? StartDate, string? EndDate, string? Note);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1");

        // ==================== 纪念日 ====================
        var an = g.MapGroup("/anniversaries").RequireAuthorization("perm:anniversary.use");

        an.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var today = DateTime.Today;
            var items = db.Anniversaries.Where(a => a.UserId == uid).ToList()
                .Select(a =>
                {
                    var (next, days) = NextOccur(a, today);
                    return new
                    {
                        id = a.Id, title = a.Title, date = ApiKit.D(a.Date),
                        repeatYearly = a.RepeatYearly, note = a.Note,
                        nextDate = ApiKit.D(next), daysLeft = days,
                        passedDays = (today - a.Date.Date).Days,
                    };
                })
                .OrderBy(x => x.daysLeft).ToList();
            return ApiKit.Ok(new { items, today = ApiKit.D(today) });
        });

        an.MapPost("", (AnnivReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var d = ApiKit.ParseDate(req.Date) ?? throw new ApiBadRequest("请选择日期");
            var a = new AnniversaryItem
            {
                UserId = uid, Title = ApiKit.Req(req.Title, "名称", 40),
                Date = d, RepeatYearly = req.RepeatYearly, Note = ApiKit.Cut(req.Note, 300),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.Anniversaries.Add(a);
            db.SaveChanges();
            return ApiKit.Ok(new { id = a.Id });
        });

        an.MapPut("/{id:int}", (int id, AnnivReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var a = db.Anniversaries.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                    ?? throw new ApiBadRequest("纪念日不存在或已删除");
            a.Title = ApiKit.Req(req.Title, "名称", 40);
            a.Date = ApiKit.ParseDate(req.Date) ?? a.Date;
            a.RepeatYearly = req.RepeatYearly;
            a.Note = ApiKit.Cut(req.Note, 300);
            a.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        an.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var a = db.Anniversaries.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (a is null) return ApiKit.NotFound("纪念日不存在或已删除");
            db.Anniversaries.Remove(a);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 留言板 ====================
        var bd = g.MapGroup("/board").RequireAuthorization("perm:board.use");

        bd.MapGet("", (AppDbContext db, CurrentUser me, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var before = ApiKit.IntQ(ctx, "before", 0);
            var canModerate = me.Has("board.moderate");
            var rows = db.BoardMessages.Include(b => b.User).AsQueryable();
            if (before > 0) rows = rows.Where(b => b.Id < before);
            var items = rows.OrderByDescending(b => b.Id).Take(50).ToList()
                .Select(b => new
                {
                    id = b.Id, content = b.Content,
                    author = b.User?.DisplayName ?? "?",
                    authorId = b.UserId, mine = b.UserId == uid,
                    canDelete = b.UserId == uid || canModerate,
                    createdAt = ApiKit.StampUtc(b.CreatedAt),
                }).ToList();
            return ApiKit.Ok(new { items, hasMore = items.Count == 50 });
        });

        bd.MapPost("", (BoardReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var content = ApiKit.Req(req.Content, "留言内容", 500);
            var m = new BoardMessage { UserId = uid, Content = content, CreatedAt = DateTime.UtcNow };
            db.BoardMessages.Add(m);
            db.SaveChanges();
            return ApiKit.Ok(new { id = m.Id });
        });

        // 删自己的；有 board.moderate（管理员）可删任意
        bd.MapDelete("/{id:int}", (int id, AppDbContext db, CurrentUser me, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.BoardMessages.FirstOrDefault(x => x.Id == id);
            if (m is null) return ApiKit.NotFound("留言不存在或已删除");
            if (m.UserId != uid && !me.Has("board.moderate")) return ApiKit.Forbidden("只能删自己的留言");
            db.BoardMessages.Remove(m);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 情侣空间 ====================
        var cp = g.MapGroup("/couples").RequireAuthorization("perm:couples.view");

        cp.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var s = db.CoupleSettings.FirstOrDefault();
            if (s is null)
            {
                s = new CoupleSetting { StartDate = DateTime.Today, Title = "我们在一起" };
                db.CoupleSettings.Add(s);
                db.SaveChanges();
            }

            var notes = db.LoveNotes.Include(n => n.FromUser).OrderByDescending(n => n.CreatedAt)
                .Take(50).ToList()
                .Select(n => new
                {
                    id = n.Id, content = n.Content,
                    from = n.FromUser?.DisplayName ?? "?",
                    fromId = n.FromUserId, mine = n.FromUserId == uid,
                    createdAt = ApiKit.StampUtc(n.CreatedAt),
                }).ToList();

            var today = DateTime.Today;
            object? nextAnniv = null;
            var best = int.MaxValue;
            var bestTitle = "";
            foreach (var a in db.Anniversaries.Where(x => x.UserId == uid && x.RepeatYearly).ToList())
            {
                var (_, days) = NextOccur(a, today);
                if (days < best) { best = days; bestTitle = a.Title; }
            }
            if (best != int.MaxValue) nextAnniv = new { title = bestTitle, days = best };

            return ApiKit.Ok(new
            {
                title = s.Title,
                startDate = ApiKit.D(s.StartDate),
                daysTogether = (today - s.StartDate.Date).Days + 1,
                notes,
                nextAnniv,
            });
        });

        cp.MapPut("/setting", (CoupleReq req, AppDbContext db) =>
        {
            var s = db.CoupleSettings.FirstOrDefault();
            if (s is null) { s = new CoupleSetting(); db.CoupleSettings.Add(s); }
            s.Title = ApiKit.Req(req.Title, "标题", 40);
            s.StartDate = ApiKit.ParseDate(req.StartDate) ?? s.StartDate;
            s.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { daysTogether = (DateTime.Today - s.StartDate.Date).Days + 1 });
        });

        cp.MapPost("/notes", (NoteReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var n = new LoveNote
            {
                FromUserId = uid,
                Content = ApiKit.Req(req.Content, "小纸条", 500),
                CreatedAt = DateTime.UtcNow,
            };
            db.LoveNotes.Add(n);
            db.SaveChanges();
            return ApiKit.Ok(new { id = n.Id });
        });

        cp.MapDelete("/notes/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var n = db.LoveNotes.FirstOrDefault(x => x.Id == id && x.FromUserId == uid);
            if (n is null) return ApiKit.NotFound("只能删自己写的小纸条");
            db.LoveNotes.Remove(n);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 经期 ====================
        var pd = g.MapGroup("/period").RequireAuthorization("perm:period.use");

        pd.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var rows = db.PeriodRecords.Where(x => x.UserId == uid)
                .OrderByDescending(x => x.StartDate).Take(24).ToList();

            var items = rows.Select(r => new
            {
                id = r.Id,
                startDate = ApiKit.D(r.StartDate),
                endDate = ApiKit.DN(r.EndDate),
                note = r.Note,
                length = r.EndDate is null ? (int?)null : (r.EndDate.Value.Date - r.StartDate.Date).Days + 1,
            }).ToList();

            // 预测：近 3 次周期的平均（与提醒中心同一套算法）
            object? predict = null;
            var starts = rows.Select(x => x.StartDate.Date).OrderBy(d => d).ToList();
            if (starts.Count >= 2)
            {
                var cycles = new List<int>();
                for (var i = starts.Count - 1; i > 0 && cycles.Count < 3; i--)
                    cycles.Add((starts[i] - starts[i - 1]).Days);
                var avg = (int)Math.Round(cycles.Average());
                var next = starts[^1].AddDays(avg);
                var lastLen = rows.FirstOrDefault(r => r.EndDate is not null) is { } lr
                    ? (lr.EndDate!.Value.Date - lr.StartDate.Date).Days + 1 : 5;
                predict = new
                {
                    nextDate = ApiKit.D(next),
                    daysLeft = (next - DateTime.Today).Days,
                    avgCycle = avg,
                    avgLength = lastLen,
                };
            }

            return ApiKit.Ok(new { items, predict, today = ApiKit.D(DateTime.Today) });
        });

        pd.MapPost("", (PeriodReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var start = ApiKit.ParseDate(req.StartDate) ?? throw new ApiBadRequest("请选择开始日期");
            var end = ApiKit.ParseDate(req.EndDate);
            if (end is not null && end < start) throw new ApiBadRequest("结束日期不能早于开始日期");
            var r = new PeriodRecord
            {
                UserId = uid, StartDate = start, EndDate = end, Note = ApiKit.Cut(req.Note, 200),
                CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            };
            db.PeriodRecords.Add(r);
            db.SaveChanges();
            return ApiKit.Ok(new { id = r.Id });
        });

        pd.MapPut("/{id:int}", (int id, PeriodReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var r = db.PeriodRecords.FirstOrDefault(x => x.Id == id && x.UserId == uid)
                    ?? throw new ApiBadRequest("记录不存在或已删除");
            var start = ApiKit.ParseDate(req.StartDate) ?? r.StartDate;
            var end = ApiKit.ParseDate(req.EndDate);
            if (end is not null && end < start) throw new ApiBadRequest("结束日期不能早于开始日期");
            r.StartDate = start; r.EndDate = end;
            r.Note = ApiKit.Cut(req.Note, 200);
            r.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        pd.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var r = db.PeriodRecords.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (r is null) return ApiKit.NotFound("记录不存在或已删除");
            db.PeriodRecords.Remove(r);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 提醒中心 ====================
        g.MapGet("/reminders", (AppDbContext db, CurrentUser me, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var digest = ReminderBuilder.Build(db, uid, me.PermissionCodes().ToHashSet());
            var items = digest.Items.Where(i => i.Kind != "置顶")
                .Select(i => new { kind = i.Kind, title = i.Title, when = i.When, url = i.Url }).ToList();
            return ApiKit.Ok(new
            {
                items,
                todayHabitDone = digest.TodayHabitDone,
                todayHabitTotal = digest.TodayHabitTotal,
            });
        }).RequireAuthorization("perm:reminders.use");

        // ==================== 导出（全量 JSON，App 侧存文件/分享） ====================
        g.MapGet("/export/all", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.First(u => u.Id == uid);

            var payload = new
            {
                exportedAt = ApiKit.Stamp(DateTime.Now),
                app = "日常管理",
                user = new { user.Username, user.DisplayName, user.Email },
                schedules = db.Schedules.Where(x => x.UserId == uid).OrderBy(x => x.StartAt).ToList()
                    .Select(x => new { x.Title, x.Description, startAt = ApiKit.T(x.StartAt), endAt = ApiKit.TN(x.EndAt), x.AllDay }),
                memos = db.Memos.Where(x => x.UserId == uid).ToList()
                    .Select(x => new { x.Title, x.Content, x.Pinned, createdAt = ApiKit.StampUtc(x.CreatedAt) }),
                habits = db.Habits.Where(x => x.UserId == uid).ToList()
                    .Select(h => new
                    {
                        h.Name, h.Icon,
                        checkins = db.HabitCheckins.Where(c => c.HabitId == h.Id)
                            .OrderBy(c => c.CheckinDate).Select(c => ApiKit.D(c.CheckinDate)).ToList(),
                    }),
                courses = db.Courses.Where(x => x.UserId == uid).ToList()
                    .Select(x => new { x.Name, x.Teacher, x.Location, x.Weekday, x.StartPeriod, x.EndPeriod, x.WeeksText, x.Category }),
                expenses = db.Expenses.Where(x => x.UserId == uid).OrderBy(x => x.OccurDate).ToList()
                    .Select(x => new { x.Amount, x.Type, x.Category, occurDate = ApiKit.D(x.OccurDate), x.Note }),
                anniversaries = db.Anniversaries.Where(x => x.UserId == uid).ToList()
                    .Select(x => new { x.Title, date = ApiKit.D(x.Date), x.RepeatYearly, x.Note }),
                period = db.PeriodRecords.Where(x => x.UserId == uid).ToList()
                    .Select(x => new { startDate = ApiKit.D(x.StartDate), endDate = ApiKit.DN(x.EndDate), x.Note }),
                board = db.BoardMessages.Where(x => x.UserId == uid).ToList()
                    .Select(x => new { x.Content, createdAt = ApiKit.StampUtc(x.CreatedAt) }),
            };

            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
            {
                WriteIndented = true,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            });
            return ApiKit.Ok(new
            {
                filename = $"日常管理-导出-{DateTime.Now:yyyyMMdd-HHmm}.json",
                content = json,
            });
        }).RequireAuthorization("perm:export.use");

        // 纯文本备份（CSV 版：只导账目，最常用）
        g.MapGet("/export/expenses.csv", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var sb = new StringBuilder();
            sb.AppendLine("日期,方向,分类,金额,备注");
            foreach (var x in db.Expenses.Where(x => x.UserId == uid).OrderBy(x => x.OccurDate))
                sb.AppendLine($"{ApiKit.D(x.OccurDate)},{(x.Type == "in" ? "收入" : "支出")},{Csv(x.Category)},{x.Amount},{Csv(x.Note)}");
            return ApiKit.Ok(new
            {
                filename = $"记账-{DateTime.Now:yyyyMMdd}.csv",
                content = "\uFEFF" + sb,      // BOM：Excel 打开不乱码
            });
        }).RequireAuthorization("perm:export.use");
    }

    // ---------- 私有 ----------
    /// <summary>下一次发生日 + 距今天数（每年重复的按月日滚动，否则用原日期）。</summary>
    private static (DateTime Next, int Days) NextOccur(AnniversaryItem a, DateTime today)
    {
        DateTime next;
        if (a.RepeatYearly)
        {
            next = new DateTime(today.Year, a.Date.Month, Math.Min(a.Date.Day, DateTime.DaysInMonth(today.Year, a.Date.Month)));
            if (next < today) next = next.AddYears(1);
        }
        else next = a.Date.Date;
        return (next, (next - today).Days);
    }

    private static string Csv(string? s)
    {
        var v = (s ?? "").Replace("\"", "\"\"");
        return v.Contains(',') || v.Contains('"') || v.Contains('\n') ? $"\"{v}\"" : v;
    }
}
