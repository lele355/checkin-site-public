using CheckinApp.Data;
using System.Text;
using System.Text.Json;

namespace CheckinApp.Services;

/// <summary>
/// AI 助手「人设与上下文」的唯一来源 —— 网页版 /Ai 和 App 的 /api/v1/ai 共用，
/// 保证两端问同样的话、拿到同样风格的回答。改提示词只改这里。
/// </summary>
public static class AiPrompt
{
    public const string System = """
        你是「日常管理」个人站的 AI 助手，帮用户管理日程、备忘、打卡、记账、纪念日等个人数据。
        回复用简体中文，简洁友好，口语化，别用 Markdown 表格。

        当用户想创建/记录数据时，优先通过工具调用（function calling）提出建议——
        提供的 5 个工具就是你的菜单，选对工具、按 schema 填参数即可（一次最多调 3 个，
        能拆就拆，不确定的信息先问清楚再建议）。
        备用方案（仅当无法发起工具调用时）：在回复末尾输出一个 ```actions 代码块，
        内容是 JSON 数组，每个元素一条建议，字段与工具参数一致再加 type 字段：
        [ { "type": "create_schedule", "title": "开会", "start_at": "2026-10-18 14:00", "end_at": "2026-10-18 15:00", "all_day": false, "description": "" } ]

        可用动作只有这 5 种（多一个都不行）：
        1. create_schedule — 新建日程：title(必填), start_at(yyyy-MM-dd HH:mm 或 yyyy-MM-dd), end_at?, all_day?, description?
        2. create_memo — 新建备忘：title(必填), content?, pinned?
        3. create_expense — 记账：amount(数字，必填), direction("out"支出/"in"收入，必填), category?(餐饮/交通/学习/娱乐/日用/其他), occur_date?(yyyy-MM-dd), note?
        4. checkin_habit — 习惯打卡：habit_id(整数，必填，从数据摘要的习惯清单里选), date?(yyyy-MM-dd), note?
        5. create_anniversary — 新增纪念日：title(必填), date(yyyy-MM-dd，必填), repeat_yearly?, note?

        铁律：
        - 只要用户在说一件要记录/安排的事，就必须发起工具调用（或输出 ```actions 块）——
          不提建议系统就无法写入，等于白说。
        - 建议只是草稿，用户点确认后才真正写入。所以措辞别说「已记好/已入账/已创建」，
          要说「已生成建议，点确认后写入」。
        - 绝不提供用户管理、权限、密码等管理操作 —— 不在菜单里就是不能做，用户要求时明确拒绝。
        - 日期时间拿不准就问，不要编造。用户没说的信息字段留空，不要瞎猜。
        - 纯聊天/提问时不要发起工具调用，也不要输出 actions 块。
        """;

    /// <summary>用户数据摘要：让 AI 知道今天几号、有哪些习惯可打卡（轻量注入，敏感模块不进摘要）</summary>
    public static string BuildDataSummary(AppDbContext db, int uid)
    {
        var now = DateTime.Now;
        var sb = new StringBuilder();
        sb.AppendLine($"【数据摘要】今天是 {now:yyyy-MM-dd} 星期{"一二三四五六日"[(int)now.DayOfWeek == 0 ? 6 : (int)now.DayOfWeek - 1]}。");

        var habits = db.Habits.Where(h => h.UserId == uid).OrderBy(h => h.Id).ToList();
        if (habits.Count > 0)
        {
            var today = now.Date;
            var doneToday = db.HabitCheckins
                .Where(c => c.UserId == uid && c.CheckinDate == today)
                .Select(c => c.HabitId)
                .ToHashSet();
            sb.AppendLine("习惯清单（habit_id: 名称，✓=今天已打卡）：");
            foreach (var h in habits)
                sb.AppendLine($"  {h.Id}: {h.Name}{(doneToday.Contains(h.Id) ? " ✓" : "")}");
        }

        var weekEnd = now.Date.AddDays(7);
        var soon = db.Schedules
            .Where(s => s.UserId == uid && s.StartAt >= now.Date && s.StartAt < weekEnd)
            .OrderBy(s => s.StartAt)
            .Take(5)
            .ToList();
        if (soon.Count > 0)
        {
            sb.AppendLine("未来 7 天已有日程（避免重复安排）：");
            foreach (var s in soon) sb.AppendLine($"  {s.StartAt:MM-dd HH:mm} {s.Title}");
        }

        return sb.ToString();
    }

    /// <summary>建议卡片摘要（给人看的中文，不是给 AI 的 JSON）</summary>
    public static string Summarize(string type, JsonElement a)
    {
        string S(string name)
            => a.TryGetProperty(name, out var v)
                ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString())
                : "";

        return type switch
        {
            "create_schedule" => $"{S("title")}　{S("start_at")}" +
                                 (S("end_at") != "" ? $" ~ {S("end_at")}" : ""),
            "create_memo" => $"{S("title")}" + (S("content") != "" ? $"：{S("content")}" : ""),
            "create_expense" => $"{(S("direction") == "in" ? "收入" : "支出")} ¥{S("amount")}　{S("category")}" +
                                (S("note") != "" ? $"（{S("note")}）" : ""),
            "checkin_habit" => $"习惯打卡：{S("habit_id")}" + (S("date") != "" ? $"　{S("date")}" : "（今天）"),
            "create_anniversary" => $"{S("title")}　{S("date")}" +
                                    (S("repeat_yearly") == "true" ? "（每年重复）" : ""),
            _ => ""
        };
    }
}
