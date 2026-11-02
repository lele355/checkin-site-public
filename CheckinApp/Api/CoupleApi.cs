using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;

namespace CheckinApp.Api;

/// <summary>
/// 情侣大类 API（2026-11-02 站主规划）—— 心情 / 排便 / 月度统计。
/// 全部 couples.view 门控 + CoupleScope 双方互见（可看可记）。
/// 提问（批③）与 AI 月度总结（批④）也挂在本组。
/// </summary>
public static class CoupleApi
{
    public record MoodReq(string? Date, int Mood, string? Note, int? UserId = null);
    public record PoopReq(string? At, string? Note, int? UserId = null);
    public record AskReq(string Content, int? ToUserId = null);
    public record AnswerReq(string Content);

    public static void MapCoupleApi(this IEndpointRouteBuilder g)
    {
        var c = g.MapGroup("/couple").RequireAuthorization("perm:couples.view");

        // ==================== 心情（每人每日一行 upsert，双方互见） ====================
        c.MapGet("/moods", (string? month, AppDbContext db, [FromServices] CoupleScope couple) =>
        {
            var uids = couple.MemberUids();
            var (from, to) = MonthRange(month);
            var rows = db.MoodLogs.Where(x => uids.Contains(x.UserId) && x.Date >= from && x.Date < to)
                .OrderBy(x => x.Date).ToList();
            var names = db.Users.Where(u => uids.Contains(u.Id))
                .ToDictionary(u => u.Id, u => u.DisplayName);
            var items = rows.Select(r => new
            {
                userId = r.UserId,
                owner = names.GetValueOrDefault(r.UserId, "?"),
                date = ApiKit.D(r.Date),
                mood = r.Mood,
                note = r.Note,
            }).ToList();
            return ApiKit.Ok(new { items, moods = MoodNames });
        });

        c.MapPut("/mood", (MoodReq req, AppDbContext db, [FromServices] CoupleScope couple, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            if (req.Mood is < 1 or > 6) throw new ApiBadRequest("心情档位不对");
            var date = ApiKit.ParseDate(req.Date) ?? DateTime.Today;
            var owner = req.UserId ?? uid;
            if (!couple.IsMember(owner)) throw new ApiBadRequest("只能为自己或对方记录");
            var row = db.MoodLogs.FirstOrDefault(x => x.UserId == owner && x.Date == date);
            if (row is null)
            {
                row = new MoodLog { UserId = owner, Date = date };
                db.MoodLogs.Add(row);
            }
            row.Mood = req.Mood;
            row.Note = ApiKit.Cut(req.Note, 200);
            row.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 排便（点一下记一次，双方互见） ====================
        c.MapGet("/poops", (string? month, AppDbContext db, [FromServices] CoupleScope couple) =>
        {
            var uids = couple.MemberUids();
            var (from, to) = MonthRange(month);
            var rows = db.PoopLogs.Where(x => uids.Contains(x.UserId) && x.At >= from && x.At < to)
                .OrderByDescending(x => x.At).Take(200).ToList();
            var names = db.Users.Where(u => uids.Contains(u.Id))
                .ToDictionary(u => u.Id, u => u.DisplayName);
            var items = rows.Select(r => new
            {
                id = r.Id,
                userId = r.UserId,
                owner = names.GetValueOrDefault(r.UserId, "?"),
                at = r.At.AddHours(8).ToString("yyyy-MM-dd HH:mm"),   // 显示北京时间（SiteClock 口径）
                note = r.Note,
            }).ToList();
            return ApiKit.Ok(new { items });
        });

        c.MapPost("/poop", (PoopReq req, AppDbContext db, [FromServices] CoupleScope couple, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var owner = req.UserId ?? uid;
            if (!couple.IsMember(owner)) throw new ApiBadRequest("只能为自己或对方记录");
            var at = string.IsNullOrWhiteSpace(req.At) ? DateTime.UtcNow : ApiKit.ParseDate(req.At) ?? DateTime.UtcNow;
            var r = new PoopLog
            {
                UserId = owner,
                At = at,
                Note = ApiKit.Cut(req.Note, 200),
                CreatedAt = DateTime.UtcNow,
            };
            db.PoopLogs.Add(r);
            db.SaveChanges();
            return ApiKit.Ok(new { id = r.Id });
        });

        c.MapDelete("/poop/{id:int}", (int id, AppDbContext db, [FromServices] CoupleScope couple) =>
        {
            var uids = couple.MemberUids();
            var r = db.PoopLogs.FirstOrDefault(x => x.Id == id && uids.Contains(x.UserId));
            if (r is null) return ApiKit.NotFound("记录不存在或已删除");
            db.PoopLogs.Remove(r);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 互相提问（互问互答；未答/已答筛选 + 分页 + 月归档控条数） ====================
        c.MapGet("/questions", (string? status, string? month, int page, AppDbContext db, [FromServices] CoupleScope couple, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var uids = couple.MemberUids();
            var q = db.CoupleQuestions.Where(x => uids.Contains(x.FromUserId) && uids.Contains(x.ToUserId));
            if (status == "unanswered") q = q.Where(x => x.Answer == null);
            else if (status == "answered") q = q.Where(x => x.Answer != null);
            if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParse(month + "-01", out var m))
                q = q.Where(x => x.CreatedAt >= m && x.CreatedAt < m.AddMonths(1));
            var total = q.Count();
            var pageSize = 20;
            var pages = Math.Max(1, (total + pageSize - 1) / pageSize);
            var pg = Math.Clamp(page <= 0 ? 1 : page, 1, pages);
            var names = db.Users.Where(u => uids.Contains(u.Id)).ToDictionary(u => u.Id, u => u.DisplayName);
            var items = q.OrderByDescending(x => x.CreatedAt)
                .Skip((pg - 1) * pageSize).Take(pageSize).ToList()
                .Select(x => new
                {
                    id = x.Id,
                    from = names.GetValueOrDefault(x.FromUserId, "?"),
                    fromId = x.FromUserId,
                    to = names.GetValueOrDefault(x.ToUserId, "?"),
                    toId = x.ToUserId,
                    content = x.Content,
                    answer = x.Answer,
                    askedAt = x.CreatedAt.AddHours(8).ToString("yyyy-MM-dd HH:mm"),
                    answeredAt = x.AnsweredAt?.AddHours(8).ToString("yyyy-MM-dd HH:mm"),
                    mineToAnswer = x.ToUserId == uid && x.Answer == null,
                }).ToList();
            var unanswered = db.CoupleQuestions.Count(x => uids.Contains(x.FromUserId) && uids.Contains(x.ToUserId) && x.Answer == null);
            return ApiKit.Ok(new { items, total, page = pg, pages, unanswered });
        });

        c.MapPost("/question", (AskReq req, AppDbContext db, [FromServices] CoupleScope couple, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            if (string.IsNullOrWhiteSpace(req.Content)) throw new ApiBadRequest("问题不能为空");
            var to = req.ToUserId ?? couple.PartnerUid() ?? throw new ApiBadRequest("还没有对方");
            if (to == uid) throw new ApiBadRequest("不能问自己");
            if (!couple.IsMember(to)) throw new ApiBadRequest("只能问对方");
            var r = new CoupleQuestion
            {
                FromUserId = uid,
                ToUserId = to,
                Content = ApiKit.Cut(req.Content, 500),
                CreatedAt = DateTime.UtcNow,
            };
            db.CoupleQuestions.Add(r);
            db.SaveChanges();
            return ApiKit.Ok(new { id = r.Id });
        });

        c.MapPost("/question/{id:int}/answer", (int id, AnswerReq req, AppDbContext db, [FromServices] CoupleScope couple, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            if (string.IsNullOrWhiteSpace(req.Content)) throw new ApiBadRequest("回答不能为空");
            var r = db.CoupleQuestions.FirstOrDefault(x => x.Id == id)
                    ?? throw new ApiBadRequest("问题不存在或已删除");
            // 只有被问的人能回答
            if (r.ToUserId != uid) throw new ApiBadRequest("只有被问的人能回答");
            r.Answer = ApiKit.Cut(req.Content, 500);
            r.AnsweredAt = DateTime.UtcNow;
            db.SaveChanges();
            return ApiKit.Ok();
        });

        c.MapDelete("/question/{id:int}", (int id, AppDbContext db, [FromServices] CoupleScope couple) =>
        {
            var uids = couple.MemberUids();
            var r = db.CoupleQuestions.FirstOrDefault(x => x.Id == id && uids.Contains(x.FromUserId));
            if (r is null) return ApiKit.NotFound("问题不存在或已删除");
            db.CoupleQuestions.Remove(r);
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 月度总结（mimo 生成；每日阶段 + 月末定稿；留存可查） ====================
        c.MapGet("/summaries", (AppDbContext db, [FromServices] CoupleScope couple) =>
        {
            var rows = db.CoupleMonthlySummaries.OrderByDescending(x => x.Month).ThenByDescending(x => x.IsFinal).ThenByDescending(x => x.GeneratedAt)
                .Take(60).ToList()
                .Select(x => new
                {
                    id = x.Id,
                    month = x.Month.ToString("yyyy-MM"),
                    scopeDays = x.ScopeDays,
                    isFinal = x.IsFinal,
                    content = x.Content,
                    generatedAt = x.GeneratedAt.AddHours(8).ToString("yyyy-MM-dd HH:mm"),
                }).ToList();
            return ApiKit.Ok(new { items = rows });
        });

        c.MapPost("/summary", async (AppDbContext db, [FromServices] CoupleScope couple, [FromServices] CoupleSummaryService gen, HttpContext ctx) =>
        {
            var r = await gen.GenerateAsync(DateTime.Today.Day, isFinal: false);
            return r is null ? ApiKit.Err("生成失败，稍后再试") : ApiKit.Ok(new { id = r.Id });
        });

        // ==================== 月度统计（心情分布 + 排便次数；批④ AI 总结另供） ====================
        c.MapGet("/stats", (string? month, AppDbContext db, [FromServices] CoupleScope couple) =>
        {
            var uids = couple.MemberUids();
            var (from, to) = MonthRange(month);
            var names = db.Users.Where(u => uids.Contains(u.Id))
                .ToDictionary(u => u.Id, u => u.DisplayName);
            var moods = db.MoodLogs.Where(x => uids.Contains(x.UserId) && x.Date >= from && x.Date < to).ToList();
            var poops = db.PoopLogs.Where(x => uids.Contains(x.UserId) && x.At >= from && x.At < to).ToList();
            var perUser = uids.Select(u => new
            {
                userId = u,
                owner = names.GetValueOrDefault(u, "?"),
                moodDays = moods.Count(x => x.UserId == u),
                moodDist = Enumerable.Range(1, 6)
                    .Select(m => new { mood = m, count = moods.Count(x => x.UserId == u && x.Mood == m) })
                    .ToList(),
                poopCount = poops.Count(x => x.UserId == u),
            }).ToList();
            return ApiKit.Ok(new { month = from.ToString("yyyy-MM"), perUser, moods = MoodNames });
        });
    }

    /// <summary>心情档名（1..6）</summary>
    public static readonly string[] MoodNames = ["开心", "平淡", "难过", "生气", "困", "害羞"];

    private static (DateTime, DateTime) MonthRange(string? month)
    {
        var from = DateTime.Today.AddDays(1 - DateTime.Today.Day);   // 本月 1 日
        if (!string.IsNullOrWhiteSpace(month) &&
            DateTime.TryParse(month + "-01", out var m))
            from = m.Date;
        return (from, from.AddMonths(1));
    }
}
