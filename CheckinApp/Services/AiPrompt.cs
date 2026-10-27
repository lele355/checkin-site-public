using CheckinApp.Data;
using Microsoft.EntityFrameworkCore;
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
        你是「日常管理」个人站的 AI 助手，帮用户管日程、备忘、打卡、记账、纪念日、课程表这些个人数据。
        回复用简体中文，简洁友好，口语化，别用 Markdown 表格。

        【你能直接看图】
        用户可以直接发图片（课表截图、账单截图、日程截图、纸质便签照片等）。
        看到图先把内容读成结构化信息，再选工具；读不清或者拿不准就先问一句，别猜。
        注意：图片只在用户发的那一轮有效，历史消息里只剩一个「[图片]」占位，
        所以图里的信息要在这一轮就处理掉，别指望下一轮还能看见。

        【课表截图 → create_courses】
        课表一般是「星期几 × 第几大节」的网格，按这几条转：
        - 一门课占几个格子就是几条；同一门课在星期不同或节次不同必须拆成多条
        - 「第 N 大节」换算成小节：start_period = N×2-1，end_period = N×2。
          例：第一大节 → 1~2，第二大节 → 3~4，第三大节 → 5~6，第四大节 → 7~8，
          第五大节 → 9~10；第六大节若标的是 11,12,13 三小节，则 start=11、end=13
        - 格子里的四行通常依次是：课程名 / 教师 / 周次([节次]) / 地点。
          周次原样搬进 weeks，不要自己换算：「1-8周」→ "1-8"、「8周」→ "8"、
          「单周」「双周」照抄、逗号分隔的区间如「1-8,10-16」也照抄
        - 同一格里出现「1-16周」和「2-12周」两条的，当作一条，weeks 写 "1-16,2-12"
        - 地点和教师从图里读，没有就留空，绝不编
        - category 从课程名看不出类型时一律填 other
        - semester_start 只在图里【明确写了学期第一周的日期】时才填；图上只有「2026-2027-1」
          这种学年学期编号时，一律不要填（不要拿今天倒推！），改成在回复末尾问一句
          「学期第一周的周一大概是哪天？」，让用户自己在课程表页填
        - 回复正文只用一两句话（例如「识别出 19 门课，已生成导入建议，点确认后写入」），
          **绝对不要在正文里逐条罗列课程明细** —— 明细由建议卡展示，正文复述既容易写错
          （星期/节次对不上），又白烧 token。所有信息只准放一次：放工具参数里。

        【工具就是你的全部手段】
        6 个工具，一次最多调 3 个（整张课表算 1 个）：
        1. create_schedule — 新建日程：title(必填), start_at(yyyy-MM-dd HH:mm 或 yyyy-MM-dd), end_at?, all_day?, description?
        2. create_memo — 新建备忘：title(必填), content?, pinned?
        3. create_expense — 记账：amount(数字，必填), direction("out"支出/"in"收入，必填), category?(餐饮/交通/学习/娱乐/日用/其他), occur_date?(yyyy-MM-dd), note?
        4. checkin_habit — 习惯打卡：habit_id(整数，必填，从数据摘要的习惯清单里选), date?(yyyy-MM-dd), note?
        5. create_anniversary — 新增纪念日：title(必填), date(yyyy-MM-dd，必填), repeat_yearly?, note?
        6. create_courses — 批量导入课程表：courses(数组，必填，每项含 name/weekday/start_period/end_period 必填，teacher/location/weeks/category 可选), semester_start?(yyyy-MM-dd)

        备用方案（仅当无法发起工具调用时）：在回复末尾输出一个 ```actions 代码块，
        内容是 JSON 数组，每个元素一条建议，字段与工具参数一致再加 type 字段：
        [ { "type": "create_schedule", "title": "开会", "start_at": "2026-10-18 14:00", "end_at": "2026-10-18 15:00", "all_day": false, "description": "" } ]

        【查数据看数据摘要，别调工具】
        每轮都会给你一份数据摘要：今天几号、习惯清单、未来 7 天日程、课程表、本月收支、近期纪念日。
        用户问「我周三有什么课」「这个月花了多少」「还有几天到纪念日」这类问题时，
        直接从摘要里读出来回答，不要发起工具调用。

        铁律：
        - 只要用户在说一件要记录/安排的事，就必须发起工具调用（或输出 ```actions 块）——
          不提建议系统就无法写入，等于白说。
        - 建议只是草稿，用户点确认后才真正写入。所以措辞别说「已记好/已入账/已创建」，
          要说「已生成建议，点确认后写入」。导入课表时可以说「已生成 N 条课程的导入建议，点确认后写入」。
        - 修改和删除不在菜单里：用户要改课程、删日程、调账目，直接告诉他去对应页面操作。
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

        // 课程表：全量列出。AI 答「周三有什么课」「这门课在哪上」全靠这段，
        // 有了它就不用为查询类问题再开一套只读工具（省一轮往返、也省 token）
        var courses = db.Courses.AsNoTracking()
            .Where(c => c.UserId == uid)
            .OrderBy(c => c.Weekday).ThenBy(c => c.StartPeriod)
            .Take(40)
            .ToList();
        if (courses.Count > 0)
        {
            sb.AppendLine("课程表（星期 节次 课程（教师）地点 [周次]；节次是小节号，1~2=第一大节）：");
            foreach (var c in courses)
            {
                var line = $"  {WeekName(c.Weekday)} 第{c.StartPeriod}-{c.EndPeriod}节 {c.Name}";
                if (c.Teacher != "") line += $"（{c.Teacher}）";
                if (c.Location != "") line += " " + c.Location;
                line += $" [{c.WeeksText}周]";
                sb.AppendLine(line);
            }
        }

        // 本月收支：只给汇总，明细太占 token；用户要明细会再追问
        var monthStart = new DateTime(now.Year, now.Month, 1);
        var sums = db.Expenses.AsNoTracking()
            .Where(e => e.UserId == uid && e.OccurDate >= monthStart)
            .GroupBy(e => e.Type)
            .Select(g => new { Type = g.Key, Sum = g.Sum(x => x.Amount) })
            .ToList();
        if (sums.Count > 0)
        {
            var outp = sums.FirstOrDefault(x => x.Type == "out")?.Sum ?? 0m;
            var inp = sums.FirstOrDefault(x => x.Type == "in")?.Sum ?? 0m;
            sb.AppendLine($"本月记账（{now:MM} 月）：支出 ¥{outp:0.##}，收入 ¥{inp:0.##}，结余 ¥{inp - outp:0.##}");
        }

        // 近期纪念日：只给原日期和是否每年重复，倒计时让 AI 自己按今天算
        var annis = db.Anniversaries.AsNoTracking()
            .Where(a => a.UserId == uid)
            .OrderBy(a => a.Date)
            .Take(8)
            .ToList();
        if (annis.Count > 0)
        {
            sb.AppendLine("纪念日（原定日期）：");
            foreach (var a in annis)
                sb.AppendLine($"  {a.Date:yyyy-MM-dd} {a.Title}{(a.RepeatYearly ? "（每年重复）" : "")}");
        }

        return sb.ToString();
    }

    private static string WeekName(int weekday) => weekday switch
    {
        1 => "周一", 2 => "周二", 3 => "周三", 4 => "周四",
        5 => "周五", 6 => "周六", 7 => "周日", _ => "周?",
    };

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
            "create_courses" => SummarizeCourses(a),
            _ => ""
        };
    }

    /// <summary>课程导入的卡片摘要：「N 条：课名A、课名B 等」+ 顺带设学期开始日时补一句</summary>
    private static string SummarizeCourses(JsonElement a)
    {
        if (!a.TryGetProperty("courses", out var arr) || arr.ValueKind != JsonValueKind.Array)
            return "课程表导入";

        var total = arr.GetArrayLength();
        var names = new List<string>();
        foreach (var el in arr.EnumerateArray())
        {
            if (names.Count >= 3) break;
            if (el.ValueKind == JsonValueKind.Object
                && el.TryGetProperty("name", out var n)
                && n.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(n.GetString()))
                names.Add(n.GetString()!);
        }

        var head = names.Count > 0 ? "：" + string.Join("、", names) + (total > names.Count ? " 等" : "") : "";
        var sem = a.TryGetProperty("semester_start", out var ss) && ss.ValueKind == JsonValueKind.String
            ? $"（学期开始 {ss.GetString()}）" : "";
        return $"{total} 条{head}{sem}";
    }

    /// <summary>
    /// 有结构化建议单时，把正文压成一句结论（外加保留它问的问题）。
    ///
    /// 为什么要在代码里兜而不是只靠提示词：flash 模型在「导入课表」这类多条目场景里，
    /// 特别爱在正文把每门课的星期/节次再复述一遍 —— 而且是错的（实测把周一说成周二、
    /// 19 条说成 25 条），既误导用户又白烧 token。明细本来就由建议卡展示，
    /// 所以正文超过 140 字就整段替换，只把它真正需要问用户的问句留下来。
    /// </summary>
    public static string CompactDisplay(string display, string? actionsJson)
    {
        if (actionsJson is null) return display;

        // 课程导入：条数一律按建议单里的实际内容算 —— 实测模型正文会报错数（说 21 条、实际 19 条）
        var acts = AiActionParser.GetActions(actionsJson);
        foreach (var act in acts)
        {
            if (act.ValueKind != JsonValueKind.Object) continue;
            if (!act.TryGetProperty("type", out var t) || t.GetString() != "create_courses") continue;
            if (!act.TryGetProperty("courses", out var arr) || arr.ValueKind != JsonValueKind.Array) continue;
            return $"识别出 {arr.GetArrayLength()} 门课，已生成导入建议，点确认后写入。" + LastQuestion(display);
        }

        if (display.Length <= 140) return display;
        var q = LastQuestion(display);
        return q == "" ? "已生成建议，点确认后写入：" : "已生成建议，点确认后写入。" + q;
    }

    /// <summary>从正文里捞出它真正要问用户的那句（例如「学期第一周的周一是哪天？」），其余整段丢弃</summary>
    private static string LastQuestion(string display)
    {
        var question = "";
        foreach (var seg in display.Split(['。', '！', '!', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var s = seg.Trim();
            if (s.Contains('?') || s.Contains('？')) question = s.TrimEnd('？', '?', ' ') + "？";
        }
        return question;
    }
}
