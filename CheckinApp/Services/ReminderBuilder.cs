using CheckinApp.Data;
using Microsoft.EntityFrameworkCore;
using System.Text;

namespace CheckinApp.Services;

/// <summary>一条提醒（站点页与每日邮件共用同一份结构与文案）。</summary>
public record ReminderItem(string Kind, string Title, string When, string Url);

/// <summary>提醒摘要：清单 + 今日打卡进度。</summary>
public class ReminderDigest
{
    public List<ReminderItem> Items { get; init; } = [];
    public int TodayHabitDone { get; init; }
    public int TodayHabitTotal { get; init; }
}

/// <summary>
/// 提醒摘要构建器 —— 提醒中心页面和每日邮件都走这里，保证「页面看到的」和「邮件收到的一样」。
/// 不用 CurrentUser（后台服务没有 HttpContext），权限以权限码集合传入。
/// </summary>
public static class ReminderBuilder
{
    public static ReminderDigest Build(AppDbContext db, int userId, IReadOnlySet<string> perms, DateTime? todayIn = null)
    {
        var today = (todayIn ?? DateTime.Today).Date;
        var soon = today.AddDays(3);
        var items = new List<ReminderItem>();
        var done = 0;
        var total = 0;

        // 1) 未来 3 天的日程
        foreach (var s in db.Schedules
            .Where(x => x.UserId == userId && x.StartAt >= today && x.StartAt < soon.AddDays(1))
            .OrderBy(x => x.StartAt)
            .Take(10))
        {
            var when = s.AllDay ? s.StartAt.ToString("M月d日 全天") : s.StartAt.ToString("M月d日 HH:mm");
            items.Add(new ReminderItem("日程", s.Title, when, "/Schedule"));
        }

        // 2) 7 天内的纪念日（含每年重复）
        foreach (var a in db.Anniversaries.Where(x => x.UserId == userId).ToList())
        {
            DateTime next;
            if (a.RepeatYearly)
            {
                next = new DateTime(today.Year, a.Date.Month, Math.Min(a.Date.Day, DateTime.DaysInMonth(today.Year, a.Date.Month)));
                if (next < today) next = next.AddYears(1);
            }
            else next = a.Date.Date;

            var days = (next - today).Days;
            if (days >= 0 && days <= 7)
                items.Add(new ReminderItem("纪念日", a.Title, days == 0 ? "就是今天" : $"还有 {days} 天", "/Anniversaries"));
        }

        // 3) 今日习惯打卡进度
        var habits = db.Habits.Where(x => x.UserId == userId).ToList();
        total = habits.Count;
        if (habits.Count > 0)
        {
            var doneIds = db.HabitCheckins
                .Where(c => c.UserId == userId && c.CheckinDate == today)
                .Select(c => c.HabitId)
                .ToHashSet();
            done = habits.Count(h => doneIds.Contains(h.Id));
            if (done < total)
                items.Add(new ReminderItem("打卡", $"今日习惯还有 {total - done} 个没打", "今天", "/Habits"));
        }

        // 4) 经期预测提醒（有记录才有）
        if (perms.Contains("period.use"))
        {
            var starts = db.PeriodRecords
                .Where(x => x.UserId == userId)
                .Select(x => x.StartDate)
                .OrderBy(d => d)
                .ToList();
            if (starts.Count >= 2)
            {
                var cycles = new List<int>();
                for (var i = starts.Count - 1; i > 0 && cycles.Count < 3; i--)
                    cycles.Add((starts[i].Date - starts[i - 1].Date).Days);
                var next = starts.Last().Date.AddDays((int)Math.Round(cycles.Average()));
                var days = (next - today).Days;
                if (days >= 0 && days <= 3)
                    items.Add(new ReminderItem("经期", "预计经期临近", days == 0 ? "预计今天" : $"预计还有 {days} 天", "/Period"));
            }
        }

        // 5) 置顶备忘（只在邮件里体现，页面已有独立模块）
        foreach (var m in db.Memos.Where(x => x.UserId == userId && x.Pinned).OrderByDescending(x => x.UpdatedAt).Take(3))
            items.Add(new ReminderItem("置顶", m.Title, "备忘", "/Memo"));

        return new ReminderDigest { Items = items, TodayHabitDone = done, TodayHabitTotal = total };
    }

    /// <summary>把摘要渲染成邮件（纯文本 + 简易 HTML，邮件客户端不保证支持 CSS，尽量用内联样式）。</summary>
    public static (string Subject, string Text, string Html) Render(ReminderDigest d, string displayName, string publicUrl, DateTime today)
    {
        var dateCn = today.ToString("M月d日");
        var subject = d.Items.Count == 0
            ? $"日常管理 · {dateCn} 今天没什么要紧事"
            : $"日常管理 · {dateCn} 提醒（{d.Items.Count} 条）";

        var text = new StringBuilder();
        text.AppendLine($"{displayName}，这是 {dateCn} 的提醒：");
        text.AppendLine();
        if (d.Items.Count == 0)
        {
            text.AppendLine("· 近期没有需要提醒的事，安心忙别的吧。");
        }
        else
        {
            foreach (var it in d.Items)
                text.AppendLine($"· [{it.Kind}] {it.Title} —— {it.When}");
        }
        if (d.TodayHabitTotal > 0)
        {
            text.AppendLine();
            text.AppendLine($"今日打卡：{d.TodayHabitDone}/{d.TodayHabitTotal} 已完成");
        }
        text.AppendLine();
        text.AppendLine($"打开网站：{publicUrl}");

        var h = new StringBuilder();
        h.Append("<!doctype html><html><body style=\"margin:0;padding:24px;background:#F7F6F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#1C1C1C;\">");
        h.Append("<div style=\"max-width:520px;margin:0 auto;background:#fff;border:1px solid #E6E2DA;border-radius:14px;padding:22px 22px 18px;\">");
        h.Append($"<div style=\"font-size:13px;letter-spacing:.12em;color:#8A857C;text-transform:uppercase;\">日常管理 · {dateCn}</div>");
        h.Append($"<h1 style=\"margin:6px 0 14px;font-size:20px;font-weight:600;\">{System.Net.WebUtility.HtmlEncode(displayName)}，今天有 {d.Items.Count} 条提醒</h1>");
        if (d.Items.Count == 0)
        {
            h.Append("<p style=\"margin:0;color:#5B564E;line-height:1.7;\">近期没有需要提醒的事，安心忙别的吧 ✨</p>");
        }
        else
        {
            h.Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:collapse;\">");
            foreach (var it in d.Items)
            {
                h.Append("<tr>");
                h.Append($"<td style=\"padding:9px 0;border-top:1px solid #EFECE5;white-space:nowrap;vertical-align:top;\"><span style=\"display:inline-block;font-size:11px;font-weight:600;color:#0F6E56;background:#E7F2EE;padding:2px 8px;border-radius:99px;\">{System.Net.WebUtility.HtmlEncode(it.Kind)}</span></td>");
                h.Append($"<td style=\"padding:9px 10px;border-top:1px solid #EFECE5;line-height:1.6;vertical-align:top;\">{System.Net.WebUtility.HtmlEncode(it.Title)}</td>");
                h.Append($"<td style=\"padding:9px 0;border-top:1px solid #EFECE5;white-space:nowrap;text-align:right;color:#8A857C;font-size:13px;vertical-align:top;\">{System.Net.WebUtility.HtmlEncode(it.When)}</td>");
                h.Append("</tr>");
            }
            h.Append("</table>");
        }
        if (d.TodayHabitTotal > 0)
        {
            var pct = d.TodayHabitTotal == 0 ? 0 : d.TodayHabitDone * 100 / d.TodayHabitTotal;
            h.Append($"<p style=\"margin:16px 0 6px;font-size:13px;color:#5B564E;\">今日打卡 {d.TodayHabitDone}/{d.TodayHabitTotal}</p>");
            h.Append($"<div style=\"height:6px;border-radius:99px;background:#EFECE5;overflow:hidden;\"><div style=\"height:6px;width:{pct}%;background:#0F6E56;\"></div></div>");
        }
        h.Append($"<p style=\"margin:20px 0 0;\"><a href=\"{System.Net.WebUtility.HtmlEncode(publicUrl)}\" style=\"display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;\">打开日常管理</a></p>");
        h.Append("<p style=\"margin:14px 0 0;font-size:12px;color:#A8A29A;line-height:1.6;\">这封邮件由「日常管理」按你的设置每天自动发送；想关掉请在站内「提醒」页关闭每日邮件提醒。</p>");
        h.Append("</div></body></html>");

        return (subject, text.ToString(), h.ToString());
    }
}
