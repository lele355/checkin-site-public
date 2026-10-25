using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;

namespace CheckinApp.Api;

/// <summary>本地通知：提醒计划 + 通知设置。App 拿计划去排闹钟，不用任何第三方推送。</summary>
public static class NotifyApi
{
    public record DndReq(bool Enabled, int StartMinute, int EndMinute);
    public record ScheduleReq(bool Enabled, int[]? Leads, int AllDayMinute);
    public record OneReq(bool Enabled, int Minute);
    public record PeriodReq(bool Enabled, int DaysBefore);

    public record SettingsReq(
        bool Enabled, DndReq? Dnd, ScheduleReq? Schedule,
        OneReq? Digest, OneReq? Habit, OneReq? Anniversary,
        PeriodReq? Period, bool UnreadHint);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/notify").RequireAuthorization("perm:notify.use");

        // ---------- 提醒计划 ----------
        // 客户端按这个排闹钟；days 最多 30 天（排太多没必要，客户端也有 100 条上限）
        g.MapGet("/plan", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var st = LoadOrNew(db, uid);
            var days = Math.Clamp(ApiKit.IntQ(ctx, "days", 14), 1, 30);
            var now = DateTime.Now;

            var items = NotifyPlanBuilder.Build(db, uid, st, now, days);
            return ApiKit.Ok(new
            {
                // 客户端用它对一下手机时间是否准（差太多提醒会偏）
                serverTime = ApiKit.Stamp(now),
                items = items.Select(i => new
                {
                    key = i.Key, kind = i.Kind, dueAt = i.DueAt,
                    title = i.Title, body = i.Body, route = i.Route,
                }),
            });
        });

        // ---------- 读设置（没有行就返回默认值，不写库） ----------
        g.MapGet("/settings", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            return ApiKit.Ok(Dto(LoadOrNew(db, uid)));
        });

        // ---------- 保存设置（全量覆盖） ----------
        g.MapPut("/settings", (SettingsReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var st = db.NotifySettings.FirstOrDefault(s => s.UserId == uid);
            if (st is null)
            {
                st = new NotifySetting { UserId = uid };
                db.NotifySettings.Add(st);
            }

            st.Enabled = req.Enabled;

            if (req.Dnd is { } dnd)
            {
                var start = Math.Clamp(dnd.StartMinute, 0, 1439);
                var end = Math.Clamp(dnd.EndMinute, 0, 1439);
                st.DndStartMinute = start;
                st.DndEndMinute = end;
                // 起止相同 = 没有免打扰区间，直接视为关闭
                st.DndEnabled = dnd.Enabled && start != end;
            }

            if (req.Schedule is { } sc)
            {
                st.ScheduleEnabled = sc.Enabled;
                var leads = (sc.Leads ?? []).Where(v => v is 0 or 5 or 10 or 30).Distinct().OrderBy(v => v).ToList();
                st.ScheduleLeads = string.Join(",", leads);
                st.AllDayMinute = Math.Clamp(sc.AllDayMinute, 0, 1439);
            }

            if (req.Digest is { } dg) { st.DigestEnabled = dg.Enabled; st.DigestMinute = Math.Clamp(dg.Minute, 0, 1439); }
            if (req.Habit is { } hb) { st.HabitEnabled = hb.Enabled; st.HabitMinute = Math.Clamp(hb.Minute, 0, 1439); }
            if (req.Anniversary is { } an) { st.AnnivEnabled = an.Enabled; st.AnnivMinute = Math.Clamp(an.Minute, 0, 1439); }
            if (req.Period is { } pd) { st.PeriodEnabled = pd.Enabled; st.PeriodDaysBefore = Math.Clamp(pd.DaysBefore, 0, 7); }

            st.UnreadHint = req.UnreadHint;
            st.UpdatedAt = DateTime.UtcNow;
            db.SaveChanges();

            return ApiKit.Ok(Dto(st));
        });
    }

    // ---------------- 内部 ----------------

    /// <summary>取设置；没有就返回一份默认值对象（不落库 —— 读接口不该有副作用）</summary>
    private static NotifySetting LoadOrNew(AppDbContext db, int uid)
    {
        var st = db.NotifySettings.FirstOrDefault(s => s.UserId == uid);
        if (st is not null) return st;
        return new NotifySetting { UserId = uid };
    }

    private static object Dto(NotifySetting st) => new
    {
        enabled = st.Enabled,
        dnd = new { enabled = st.DndEnabled, startMinute = st.DndStartMinute, endMinute = st.DndEndMinute },
        schedule = new
        {
            enabled = st.ScheduleEnabled,
            leads = (st.ScheduleLeads ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => int.TryParse(x.Trim(), out var v) ? v : -1)
                .Where(v => v is 0 or 5 or 10 or 30)
                .Distinct().OrderBy(v => v).ToArray(),
            allDayMinute = st.AllDayMinute,
        },
        digest = new { enabled = st.DigestEnabled, minute = st.DigestMinute },
        habit = new { enabled = st.HabitEnabled, minute = st.HabitMinute },
        anniversary = new { enabled = st.AnnivEnabled, minute = st.AnnivMinute },
        period = new { enabled = st.PeriodEnabled, daysBefore = st.PeriodDaysBefore },
        unreadHint = st.UnreadHint,
    };
}
