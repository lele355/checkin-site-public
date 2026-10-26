using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CheckinApp.Services;

/// <summary>
/// function calling 的工具清单（AI 的「菜单」）+ tool_calls → 建议单转换。
///
/// 双通道策略：模型支持 function calling 时走 tool_calls（结构化、schema 强约束）；
/// 偶尔退化成纯文本时仍解析 ```actions 块（AiActionParser）做降级兜底。
/// 无论哪条通道，产出的建议单 JSON 同构，都进同一套确认卡 + 三道围栏。
/// </summary>
public static class AiTools
{
    /// <summary>5 个工具的 OpenAI function schema（字段名与 AiActionExecutor 读取的完全对齐）</summary>
    public static readonly object[] Catalog =
    [
        new
        {
            type = "function",
            function = new
            {
                name = "create_schedule",
                description = "新建一条日程（会议、约会、待办安排等）。用户提到任何要安排在某个时间的事都用它。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        title = new { type = "string", description = "日程标题，必填" },
                        start_at = new { type = "string", description = "开始时间，格式 yyyy-MM-dd HH:mm 或 yyyy-MM-dd，必填" },
                        end_at = new { type = "string", description = "结束时间，格式同上，可选" },
                        all_day = new { type = "boolean", description = "是否全天日程，可选，默认 false" },
                        description = new { type = "string", description = "备注说明，可选" },
                    },
                    required = new[] { "title", "start_at" },
                },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = "create_memo",
                description = "新建一条备忘/便签（随手记、想法、待办清单等文字记录）。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        title = new { type = "string", description = "备忘标题，必填" },
                        content = new { type = "string", description = "备忘正文，可选" },
                        pinned = new { type = "boolean", description = "是否置顶，可选，默认 false" },
                    },
                    required = new[] { "title" },
                },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = "create_expense",
                description = "记一笔账（收入或支出）。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        amount = new { type = "number", description = "金额（正数），必填" },
                        direction = new { type = "string", description = "收支方向：out=支出 / in=收入，必填", @enum = new[] { "out", "in" } },
                        category = new { type = "string", description = "分类：餐饮/交通/学习/娱乐/日用/其他，可选" },
                        occur_date = new { type = "string", description = "发生日期 yyyy-MM-dd，可选，默认今天" },
                        note = new { type = "string", description = "备注，可选" },
                    },
                    required = new[] { "amount", "direction" },
                },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = "checkin_habit",
                description = "给某个习惯打卡。habit_id 必须从数据摘要的习惯清单里选。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        habit_id = new { type = "integer", description = "习惯 id，必填，只能用数据摘要里列出的" },
                        date = new { type = "string", description = "打卡日期 yyyy-MM-dd，可选，默认今天" },
                        note = new { type = "string", description = "打卡备注，可选" },
                    },
                    required = new[] { "habit_id" },
                },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = "create_anniversary",
                description = "新增一个纪念日（生日、节日、重要日子）。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        title = new { type = "string", description = "纪念日名称，必填" },
                        date = new { type = "string", description = "日期 yyyy-MM-dd，必填" },
                        repeat_yearly = new { type = "boolean", description = "是否每年重复，可选，默认 true" },
                        note = new { type = "string", description = "备注，可选" },
                    },
                    required = new[] { "title", "date" },
                },
            },
        },
        new
        {
            type = "function",
            function = new
            {
                name = "create_courses",
                description = "把课程批量写进课程表。用户发来课表截图、贴课程清单、说「导入课程表」时用它，一门课一条放进 courses 数组。",
                parameters = new
                {
                    type = "object",
                    properties = new
                    {
                        semester_start = new { type = "string", description = "学期第 1 周的周一，yyyy-MM-dd，可选；给了就同时更新课程表的学期开始日" },
                        courses = new
                        {
                            type = "array",
                            description = "课程数组，一门课一条；同一门课在不同星期/不同节次要拆成多条",
                            items = new
                            {
                                type = "object",
                                properties = new
                                {
                                    name = new { type = "string", description = "课程名称，必填" },
                                    teacher = new { type = "string", description = "任课教师，可选" },
                                    location = new { type = "string", description = "上课地点，可选" },
                                    weekday = new { type = "integer", description = "星期几：1=周一 … 7=周日，必填" },
                                    start_period = new { type = "integer", description = "起始小节号，必填。课表上「第N大节」按 start=N×2-1 换算（第一大节→1，第二大节→3，第三大节→5，第四大节→7，第五大节→9，第六大节→11）" },
                                    end_period = new { type = "integer", description = "结束小节号（含），必填。常规大节是 start+1；第六大节 11,12,13 三小节则 end=13" },
                                    weeks = new { type = "string", description = "上课周次，原样保留课表写法：1-16 / 1-8,10-16 / 单周 / 双周 / 8，可选，默认 1-16" },
                                    category = new { type = "string", description = "课程类别：required=必修 / college=院级选修 / school=校级选修 / other=其它，看不出来就填 other", @enum = new[] { "required", "college", "school", "other" } },
                                },
                                required = new[] { "name", "weekday", "start_period", "end_period" },
                            },
                        },
                    },
                    required = new[] { "courses" },
                },
            },
        },
    ];

    /// <summary>
    /// 把模型的 tool_calls 转成与解析式同构的建议单 JSON。
    /// 白名单外的动作直接丢弃；剥掉 type/_done 防 AI 注入内部字段。
    /// 全部无效时返回 null（当纯文本回复处理）。
    /// </summary>
    public static string? ToActionsJson(IReadOnlyList<AiToolCall> calls)
    {
        var arr = new JsonArray();
        foreach (var call in calls)
        {
            // 围栏：不在菜单里的函数名一律不进建议单（executor 会再校验一次，这里先挡在门外）
            if (!AiActionExecutor.ActionLabels.ContainsKey(call.Name)) continue;

            JsonObject args;
            try
            {
                var node = JsonNode.Parse(string.IsNullOrWhiteSpace(call.ArgumentsJson) ? "{}" : call.ArgumentsJson);
                args = node as JsonObject ?? [];
            }
            catch { args = []; }   // 参数不是合法 JSON 时按空参处理，让执行器去报字段缺失

            var obj = new JsonObject { ["type"] = call.Name };
            foreach (var kv in args)
            {
                if (kv.Key is "_done" or "type") continue;   // 内部标记与类型字段不许 AI 注入
                obj[kv.Key] = kv.Value?.DeepClone();
            }
            arr.Add(obj);
        }
        return arr.Count > 0 ? arr.ToJsonString() : null;
    }
}

/// <summary>
/// AI 建议单（解析式）的解析与执行器。
///
/// 三道围栏（缺一不可）：
///  ① 动作白名单：只认菜单里的 5 种动作，其它（用户管理/权限/经期/情侣空间等禁区）一律拒绝；
///  ② UserId 围栏：所有写入的归属都来自登录态 CurrentUser，AI 给的 JSON 里没有任何属主字段能绕过；
///  ③ 确认后写库：解析出的建议只是「待确认卡片」，只有用户点「确认执行」的 POST 才落库。
/// </summary>
public static class AiActionParser
{
    // AI 按约定在回复末尾输出 ```actions ... ``` 代码块；容忍 ```json 兜底
    private static readonly Regex ActionsBlock =
        new(@"```(?:actions|json)\s*([\s\S]*?)```", RegexOptions.Compiled);

    /// <summary>把 AI 回复拆成「展示文本」+「建议单 JSON（存库待确认）」</summary>
    public static (string Display, string? ActionsJson) Split(string reply)
    {
        var m = ActionsBlock.Match(reply);
        if (!m.Success) return (reply.Trim(), null);

        var json = m.Groups[1].Value.Trim();
        // 必须能解析出数组才认，否则当普通文本展示（防 AI 幻觉格式）
        if (!LooksLikeActionArray(json)) return (reply.Trim(), null);

        var display = (reply[..m.Index] + reply[(m.Index + m.Length)..]).Trim();
        return (display, json);
    }

    /// <summary>剥离正文中的建议单块（存进对话历史时用，历史里不重复塞 JSON）</summary>
    public static string StripActions(string reply) => Split(reply).Display;

    private static bool LooksLikeActionArray(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Array) return root.GetArrayLength() > 0;
            return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("actions", out _);
        }
        catch { return false; }
    }

    /// <summary>取出动作数组（兼容 [ ... ] 与 {"actions":[ ... ]} 两种写法）</summary>
    public static List<JsonElement> GetActions(string actionsJson)
    {
        var list = new List<JsonElement>();
        try
        {
            using var doc = JsonDocument.Parse(actionsJson);
            var root = doc.RootElement;
            var arr = root.ValueKind == JsonValueKind.Array ? root
                    : root.TryGetProperty("actions", out var a) ? a : default;
            if (arr.ValueKind == JsonValueKind.Array)
                foreach (var el in arr.EnumerateArray()) list.Add(el.Clone());
        }
        catch { /* 坏 JSON 当空处理 */ }
        return list;
    }
}

/// <summary>单条建议的执行结果</summary>
public record AiActionResult(bool Ok, string Message);

/// <summary>
/// 确认卡执行器：把用户确认过的建议动作真正写进库。
/// 每次执行都重新校验白名单与字段（绝不信任前端传来的业务数据，前端只传「哪张卡」）。
/// </summary>
public class AiActionExecutor(AppDbContext db, CurrentUser me)
{
    /// <summary>动作白名单（菜单制）：不在这里的一律拒绝 —— 这就是「禁区」的硬围栏。</summary>
    private static readonly Dictionary<string, string> RequiredPerm = new()
    {
        ["create_schedule"]   = "schedule.use",
        ["create_memo"]       = "memo.use",
        ["create_expense"]    = "expense.use",
        ["checkin_habit"]     = "habits.use",
        ["create_anniversary"] = "anniversary.use",
        ["create_courses"]    = "courses.use",
    };

    /// <summary>动作 → 中文名（确认卡展示用）</summary>
    public static readonly Dictionary<string, string> ActionLabels = new()
    {
        ["create_schedule"]    = "新建日程",
        ["create_memo"]        = "新建备忘",
        ["create_expense"]     = "记一笔账",
        ["checkin_habit"]      = "习惯打卡",
        ["create_anniversary"] = "新增纪念日",
        ["create_courses"]     = "导入课程表",
    };

    public AiActionResult Execute(string actionsJson, int index)
    {
        if (me.UserId is not int uid) return new(false, "请先登录");

        var actions = AiActionParser.GetActions(actionsJson);
        if (index < 0 || index >= actions.Count) return new(false, "建议不存在或已失效");

        var act = actions[index];
        // 防重复执行：已确认过的建议不再落库（防双击/重放 POST）
        if (act.TryGetProperty("_done", out var done) && done.ValueKind == JsonValueKind.True)
            return new(false, "该建议已执行过，不要重复提交");

        var type = Str(act, "type", 40);
        if (!RequiredPerm.TryGetValue(type, out var perm)) return new(false, "不支持的操作类型（不在 AI 菜单内）");

        // 权限围栏：动作对应模块没权限就不许写
        if (!me.Has(perm)) return new(false, "你没有该模块的使用权限");

        return type switch
        {
            "create_schedule"    => CreateSchedule(uid, act),
            "create_memo"        => CreateMemo(uid, act),
            "create_expense"     => CreateExpense(uid, act),
            "checkin_habit"      => CheckinHabit(uid, act),
            "create_anniversary" => CreateAnniversary(uid, act),
            "create_courses"     => CreateCourses(uid, act),
            _ => new(false, "不支持的操作类型（不在 AI 菜单内）")
        };
    }

    // ---------- 5 个白名单动作：每个都先校验字段再落库，属主一律取登录态 ----------

    private AiActionResult CreateSchedule(int uid, JsonElement a)
    {
        var title = Str(a, "title", 100);
        if (title == "") return new(false, "日程缺少标题");

        if (!Date(a, "start_at", out var start)) return new(false, "日程开始时间格式不对");
        Date(a, "end_at", out var end);
        if (end != default && end < start) end = start;   // 有结束时间才纠偏，没给就留空

        db.Schedules.Add(new ScheduleItem
        {
            UserId = uid,
            Title = title,
            Description = Str(a, "description", 1000),
            StartAt = start,
            EndAt = end == default ? null : end,
            AllDay = Bool(a, "all_day"),
        });
        db.SaveChanges();
        return new(true, $"已创建日程「{title}」（{start:MM-dd HH:mm}）");
    }

    private AiActionResult CreateMemo(int uid, JsonElement a)
    {
        var title = Str(a, "title", 100);
        if (title == "") return new(false, "备忘缺少标题");

        db.Memos.Add(new MemoItem
        {
            UserId = uid,
            Title = title,
            Content = Str(a, "content", 4000),
            Pinned = Bool(a, "pinned"),
        });
        db.SaveChanges();
        return new(true, $"已创建备忘「{title}」");
    }

    private AiActionResult CreateExpense(int uid, JsonElement a)
    {
        if (!decimal.TryParse(Str(a, "amount", 20), NumberStyles.Number, CultureInfo.InvariantCulture, out var amount)
            || amount <= 0 || amount > 999999m)
            return new(false, "金额不对（应为 0.01 ~ 999999 的数字）");

        // 收支方向字段叫 direction（type 已被动作类型占用，不能混用）
        var type = Str(a, "direction", 4) switch { "in" => "in", "out" => "out", _ => "" };
        if (type == "") return new(false, "收支方向不对（out=支出 / in=收入）");

        var occur = Date(a, "occur_date", out var d) ? d : DateTime.Now.Date;

        db.Expenses.Add(new ExpenseItem
        {
            UserId = uid,
            Amount = amount,
            Type = type,
            Category = Str(a, "category", 20) is { Length: > 0 } c ? c : "其他",
            OccurDate = occur,
            Note = Str(a, "note", 200),
        });
        db.SaveChanges();
        return new(true, $"已记账：{(type == "out" ? "支出" : "收入")} ¥{amount:0.##}");
    }

    private AiActionResult CheckinHabit(int uid, JsonElement a)
    {
        if (!int.TryParse(Str(a, "habit_id", 10), out var habitId)) return new(false, "缺少习惯 id");

        // UserId 围栏：习惯必须是本人的，AI 给的 id 打到别人头上是不行的
        var habit = db.Habits.FirstOrDefault(h => h.Id == habitId && h.UserId == uid);
        if (habit is null) return new(false, "习惯不存在或不是你的");

        var day = Date(a, "date", out var d) ? d.Date : DateTime.Now.Date;
        if (db.HabitCheckins.Any(c => c.HabitId == habitId && c.UserId == uid && c.CheckinDate == day))
            return new(false, $"「{habit.Name}」这天已经打过卡了");

        db.HabitCheckins.Add(new HabitCheckin
        {
            HabitId = habitId,
            UserId = uid,
            CheckinDate = day,
            Note = Str(a, "note", 200),
        });
        db.SaveChanges();
        return new(true, $"已打卡「{habit.Name}」（{day:MM-dd}）");
    }

    private AiActionResult CreateAnniversary(int uid, JsonElement a)
    {
        var title = Str(a, "title", 100);
        if (title == "") return new(false, "纪念日缺少标题");
        if (!Date(a, "date", out var date)) return new(false, "纪念日日期格式不对");

        db.Anniversaries.Add(new AnniversaryItem
        {
            UserId = uid,
            Title = title,
            Date = date,
            RepeatYearly = Bool(a, "repeat_yearly", true),
            Note = Str(a, "note", 200),
        });
        db.SaveChanges();
        return new(true, $"已创建纪念日「{title}」（{date:yyyy-MM-dd}）");
    }

    /// <summary>
    /// 批量导入课程：一张课表截图 → 一个动作写多行，用户点一次确认就全部落库。
    /// 一门课在课表上占几个格子就拆几条；同格子里「1-16周 / 2-12周」这种重复段合并周次。
    /// 库里已有的（同课名 + 同星期 + 同节次）直接跳过，重复导入不会翻倍。
    /// </summary>
    private AiActionResult CreateCourses(int uid, JsonElement a)
    {
        if (a.ValueKind != JsonValueKind.Object
            || !a.TryGetProperty("courses", out var arr)
            || arr.ValueKind != JsonValueKind.Array)
            return new(false, "课程清单格式不对（缺少 courses 数组）");

        const int MaxCourses = 60;   // 一学期撑死几十条，超了基本是模型幻觉

        var existing = db.Courses
            .Where(c => c.UserId == uid)
            .Select(c => new { c.Name, c.Weekday, c.StartPeriod, c.EndPeriod })
            .ToList();

        var add = new List<Course>();
        int skipped = 0, duplicate = 0;

        foreach (var el in arr.EnumerateArray())
        {
            if (add.Count >= MaxCourses) break;

            var name = Str(el, "name", 60);
            if (name == "") { skipped++; continue; }

            // 节次一律按「小节」存（1 起），星期 1~7；越界的一律当解析失败，不猜
            if (!int.TryParse(Str(el, "weekday", 4), out var weekday) || weekday < 1 || weekday > 7) { skipped++; continue; }
            if (!int.TryParse(Str(el, "start_period", 4), out var sp) || sp < 1 || sp > 16) { skipped++; continue; }
            if (!int.TryParse(Str(el, "end_period", 4), out var ep) || ep < sp || ep > 16) { skipped++; continue; }

            var weeks = Str(el, "weeks", 40);
            if (weeks == "") weeks = "1-16";

            var catRaw = Str(el, "category", 12);
            var category = catRaw is "required" or "college" or "school" ? catRaw : "other";

            // 截图上同一格常写成两条（如体育 1-16周 与 2-12周）—— 合并成一条更贴近真实
            var sameSlot = add.FirstOrDefault(c => c.Name == name && c.Weekday == weekday
                                                   && c.StartPeriod == sp && c.EndPeriod == ep);
            if (sameSlot is not null)
            {
                if (!sameSlot.WeeksText.Contains(weeks)) sameSlot.WeeksText += "," + weeks;
                continue;
            }

            if (existing.Any(c => c.Name == name && c.Weekday == weekday
                                  && c.StartPeriod == sp && c.EndPeriod == ep))
            { duplicate++; continue; }

            add.Add(new Course
            {
                UserId = uid,
                Name = name,
                Teacher = Str(el, "teacher", 40),
                Location = Str(el, "location", 60),
                Weekday = weekday,
                StartPeriod = sp,
                EndPeriod = ep,
                WeeksText = weeks,
                Category = category,
                // 颜色先留空，等下面整批分配完再回填
            });
        }

        if (add.Count == 0)
        {
            if (duplicate > 0) return new(false, $"这 {duplicate} 条课表里都已经有了，没导入新的");
            return new(false, "没解析出可用课程（课程名 / 星期 / 节次得齐全）");
        }

        // ---------- 配色分配 ----------
        // 导入是一次性拿到整张课表，此时不给颜色，十门课里撞色两三对很常见。
        // 规则：① 课表里已有的同名课沿用既有色（本来蓝色的高数不会因为重导一次变紫）；
        //       ② 全新的课优先挑「这次还没用到的」颜色；③ 同名必修同色（硬约束）。
        var known = CoursePalette.ExistingByKey(db, uid);
        var fresh = CoursePalette.AssignFor(add.Select(c => c.Name)
                                               .Where(n => !known.ContainsKey(CoursePalette.NameKey(n))));
        foreach (var c in add)
        {
            var key = CoursePalette.NameKey(c.Name);
            if (known.TryGetValue(key, out var old)) c.Color = old;
            else if (fresh.TryGetValue(key, out var got)) c.Color = got;
            // 两边都没有（课名为空或全符号）→ 留空，读的时候按名字现算，不落库
        }

        db.Courses.AddRange(add);

        // 学期开始日顺手一起写：「本周是第几周」全靠它，不设的话课程表永远停在第 1 周
        var semNote = "";
        if (Date(a, "semester_start", out var ss))
        {
            var monday = ss.Date.AddDays(-(((int)ss.DayOfWeek + 6) % 7));   // 归一到周一
            var iso = monday.ToString("yyyy-MM-dd");
            var setting = db.AppSettings.FirstOrDefault(s => s.Key == "courses.semester-start");
            if (setting is null) db.AppSettings.Add(new AppSetting { Key = "courses.semester-start", Value = iso });
            else setting.Value = iso;
            semNote = $"，学期开始日设为 {iso}";
        }

        db.SaveChanges();

        var tail = (skipped > 0 ? $"，{skipped} 条字段不全跳过" : "")
                 + (duplicate > 0 ? $"，{duplicate} 条已存在跳过" : "");
        return new(true, $"已导入 {add.Count} 条课程{semNote}{tail}");
    }

    // ---------- 字段校验小工具：长度封顶 + 日期白名单，坏值直接拒 ----------

    private static string Str(JsonElement a, string name, int max)
    {
        if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(name, out var v)) return "";
        var s = v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString();
        s = s.Trim();
        return s.Length > max ? s[..max] : s;
    }

    private static bool Bool(JsonElement a, string name, bool def = false)
    {
        if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(name, out var v)) return def;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => def
        };
    }

    /// <summary>日期解析：yyyy-MM-dd HH:mm / yyyy-MM-dd 优先，兜底通用解析；限 2000~2100 年防脏值</summary>
    private static bool Date(JsonElement a, string name, out DateTime result)
    {
        result = default;
        if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(name, out var v)) return false;
        var s = (v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString())?.Trim() ?? "";
        if (s == "") return false;

        string[] fmts = ["yyyy-MM-dd HH:mm", "yyyy-MM-dd", "yyyy/M/d H:mm", "yyyy/M/d"];
        if (!DateTime.TryParseExact(s, fmts, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)
            && !DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out dt))
            return false;

        if (dt.Year < 2000 || dt.Year > 2100) return false;
        result = dt;
        return true;
    }
}
