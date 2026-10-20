using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CheckinApp.Pages.Ai;

/// <summary>
/// AI 助手聊天页。
/// 每次发问打包：系统提示 + 用户数据摘要 + 最近 20 条历史 → MiMo（mimo-v2.6-flash）。
/// AI 提出的写操作只存「待确认建议单」，用户点确认才经三道围栏落库。
/// </summary>
[Authorize(Policy = "perm:ai.use")]
public class IndexModel(AppDbContext db, CurrentUser me, AiClient ai, AiActionExecutor executor, IOptions<AiOptions> opt) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly AiClient _ai = ai;
    private readonly AiActionExecutor _executor = executor;
    private readonly AiOptions _opt = opt.Value;

    public record ActionCard(int Index, string Type, string Label, string Summary);
    public record ChatItem(AiMessage Msg, List<ActionCard> Cards);

    public List<ChatItem> History { get; set; } = [];
    public string? Notice { get; set; }
    public bool NoticeIsError { get; set; }
    /// <summary>今天已消耗的 token（提问 + 回答合计）</summary>
    public long TodayTokens { get; set; }
    /// <summary>每日 token 上限（appsettings 的 Ai.DailyTokenLimit，默认 100 万）</summary>
    public long TokenLimit => _opt.DailyTokenLimit;

    private void Load()
    {
        if (_me.UserId is not int uid) return;

        var today = DateTime.UtcNow.Date;
        TodayTokens = _db.AiUsageDailies.AsNoTracking()
            .Where(x => x.UserId == uid && x.Day == today)
            .Select(x => x.TotalTokens)
            .FirstOrDefault();

        // 投影不带 ImageData：60 条历史若含图，全量加载会给每次翻页背上几十 MB 字节
        var msgs = _db.AiMessages.AsNoTracking()
            .Where(m => m.UserId == uid)
            .OrderByDescending(m => m.Id)
            .Take(60)
            .OrderBy(m => m.Id)
            .Select(m => new AiMessage
            {
                Id = m.Id, UserId = m.UserId, Role = m.Role, Content = m.Content,
                ActionsJson = m.ActionsJson, ImageMime = m.ImageMime, CreatedAt = m.CreatedAt,
            })
            .ToList();

        foreach (var m in msgs)
        {
            var cards = new List<ActionCard>();
            if (m.Role == "assistant" && !string.IsNullOrEmpty(m.ActionsJson))
            {
                var actions = AiActionParser.GetActions(m.ActionsJson);
                for (var i = 0; i < actions.Count; i++)
                {
                    var a = actions[i];
                    if (a.TryGetProperty("_done", out var done) && done.ValueKind == JsonValueKind.True) continue;
                    var type = a.TryGetProperty("type", out var t) ? t.ToString() : "";
                    cards.Add(new ActionCard(i, type,
                        AiActionExecutor.ActionLabels.GetValueOrDefault(type, "操作"),
                        Summarize(type, a)));
                }
                // 全部执行完就清掉建议单，历史里不留尾巴（AsNoTracking 实体不能 SaveChanges，用 ExecuteUpdate）
                if (cards.Count == 0 && actions.Count > 0)
                {
                    _db.AiMessages.Where(x => x.Id == m.Id)
                        .ExecuteUpdate(s => s.SetProperty(x => x.ActionsJson, ""));
                    m.ActionsJson = "";
                }
            }
            History.Add(new ChatItem(m, cards));
        }
    }

    public void OnGet()
    {
        Load();
        if (TempData["AiNotice"] is string n) { Notice = n; NoticeIsError = false; }
        if (TempData["AiError"] is string e) { Notice = e; NoticeIsError = true; }
    }

    /// <summary>发消息：打包上下文 → AI 回复 → 存历史（建议单拆出来待确认）</summary>
    public async Task<IActionResult> OnPostSendAsync(string? text, string? image, CancellationToken ct)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        text = (text ?? "").Trim();
        if (text.Length > 2000) text = text[..2000];

        // 图片：前端已压缩成 data URL；服务端只做 MIME 白名单 + 5MB 硬顶（单次打包，随消息存一次）
        byte[]? imageBytes = null;
        var imageMime = "";
        if (!string.IsNullOrWhiteSpace(image))
        {
            var parsed = ParseImageDataUrl(image);
            if (parsed is null)
            {
                TempData["AiError"] = "图片格式不支持（只收 JPEG / PNG / WebP / GIF）。";
                return RedirectToPage();
            }
            if (parsed.Value.Data.Length > MaxImageBytes)
            {
                TempData["AiError"] = "图片太大了（上限 5MB），换张小点的试试。";
                return RedirectToPage();
            }
            imageBytes = parsed.Value.Data;
            imageMime = parsed.Value.Mime;
        }

        if (text == "" && imageBytes is null)
        {
            TempData["AiError"] = "先输入点什么，或者附一张图片吧。";
            return RedirectToPage();
        }

        // 日配额两道闸：①每天最多 N 条（防刷） ②每天 token 总量（防「长对话 + 大图」把钱烧光）
        var today = DateTime.UtcNow.Date;
        var used = _db.AiMessages.Count(m => m.UserId == uid && m.Role == "user" && m.CreatedAt >= today);
        if (used >= _opt.DailyRequestLimit)
        {
            TempData["AiError"] = $"今天的 AI 对话次数已用完（每日 {_opt.DailyRequestLimit} 条），明天再来吧。";
            return RedirectToPage();
        }

        var usedTokens = _db.AiUsageDailies.AsNoTracking()
            .Where(x => x.UserId == uid && x.Day == today)
            .Select(x => x.TotalTokens)
            .FirstOrDefault();
        if (_opt.DailyTokenLimit > 0 && usedTokens >= _opt.DailyTokenLimit)
        {
            TempData["AiError"] = $"今天的 AI token 额度已用完（每日 {_opt.DailyTokenLimit:N0}，已用 {usedTokens:N0}），明天再来吧。";
            return RedirectToPage();
        }

        var sent = new AiMessage { UserId = uid, Role = "user", Content = text, ImageMime = imageMime, ImageData = imageBytes };
        _db.AiMessages.Add(sent);
        _db.SaveChanges();

        // 上下文打包：系统提示 + 数据摘要 + 最近历史（含刚发的这条）。
        // 历史投影不带 ImageData：图片只随当轮发送，历史轮用 [图片] 文字标记即可，省内存也省图 token
        var history = _db.AiMessages.AsNoTracking()
            .Where(m => m.UserId == uid)
            .OrderByDescending(m => m.Id)
            .Take(20)
            .OrderBy(m => m.Id)
            .Select(m => new AiMessage { Id = m.Id, Role = m.Role, Content = m.Content, ImageMime = m.ImageMime })
            .ToList();

        var messages = new List<AiChatMessage>
        {
            new("system", SystemPrompt),
            new("system", BuildDataSummary(uid)),
        };
        foreach (var m in history)
            messages.Add(BuildTurnMessage(m, m.Id == sent.Id, imageBytes, imageMime));

        var result = await _ai.ChatAsync(messages, AiTools.Catalog, null, ct);
        if (result.Ok) AddUsage(uid, today, result.Usage);   // 主调用记账

        if (!result.Ok)
        {
            _db.AiMessages.Add(new AiMessage { UserId = uid, Role = "assistant", Content = "⚠️ " + result.Error });
            _db.SaveChanges();
            TempData["AiError"] = result.Error;
            return RedirectToPage();
        }

        // 双通道取建议单：tool_calls（结构化）优先，退化成纯文本时解析 ```actions 块兜底
        string display;
        string? actionsJson;
        if (result.ToolCalls is { Count: > 0 })
        {
            actionsJson = AiTools.ToActionsJson(result.ToolCalls);
            display = result.Content.Trim();
            if (display == "" && actionsJson != "") display = "已生成建议，点确认后写入：";
        }
        else
        {
            (display, actionsJson) = AiActionParser.Split(result.Content);
        }

        // 偷懒兜底：嘴上说「已生成建议」却没给 tool_calls 也没给 actions 块（flash 偶发毛病）
        // → 用干净上下文 + tool_choice:required 强制它把工具调用真正发出来；还不行就当纯文本展示
        if (actionsJson is null && display.Contains("建议"))
        {
            var retryMsgs = new List<AiChatMessage>
            {
                new("system", SystemPrompt),
                new("system", BuildDataSummary(uid)),
                BuildTurnMessage(new AiMessage { Id = sent.Id, Role = "user", Content = text, ImageMime = imageMime }, true, imageBytes, imageMime),
                new("user", "请直接发起工具调用，为上面这条请求生成建议。若这里其实只是聊天、没有要创建的事项，回复「无」。"),
            };
            var retry = await _ai.ChatAsync(retryMsgs, AiTools.Catalog, "required", ct);
            if (retry.Ok) AddUsage(uid, today, retry.Usage);   // 兜底重试也真实花了钱，一起记账
            if (retry.Ok && retry.ToolCalls is { Count: > 0 })
            {
                actionsJson = AiTools.ToActionsJson(retry.ToolCalls);
            }
            else if (retry.Ok)
            {
                (_, var a2) = AiActionParser.Split(retry.Content);
                actionsJson = a2;
            }
        }

        _db.AiMessages.Add(new AiMessage
        {
            UserId = uid,
            Role = "assistant",
            Content = display,
            ActionsJson = actionsJson ?? "",
        });
        _db.SaveChanges();
        return RedirectToPage();
    }

    /// <summary>
    /// 把一次调用的 token 用量累加到「用户 + 今天」这一行（没有就建）。
    /// 只累加不覆盖：一天里多次对话相加，跨天由 Day 字段自然分开。
    /// 注意：一次请求里可能连着调两次（主调用 + 工具调用兜底重试），第一次 Add 的行此时还没
    /// SaveChanges，第二次再查库是查不到的 —— 会插出第二行撞 (UserId, Day) 唯一索引，整页 500。
    /// 所以先看 ChangeTracker 里已跟踪的行，并用字段记住，保证同一请求只建一行。
    /// </summary>
    private void AddUsage(int userId, DateTime day, AiTokenUsage? usage)
    {
        if (usage is null || usage.Total <= 0) return;

        var row = _usageRow
                  ?? _db.AiUsageDailies.Local.FirstOrDefault(x => x.UserId == userId && x.Day == day)
                  ?? _db.AiUsageDailies.FirstOrDefault(x => x.UserId == userId && x.Day == day);

        if (row is null)
        {
            row = new AiUsageDaily { UserId = userId, Day = day };
            _db.AiUsageDailies.Add(row);
        }
        _usageRow = row;

        row.PromptTokens += usage.Prompt;
        row.CompletionTokens += usage.Completion;
        row.TotalTokens += usage.Total;
        row.Requests += 1;
    }

    /// <summary>本次请求里复用的用量行（见 AddUsage 的注释）</summary>
    private AiUsageDaily? _usageRow;

    /// <summary>确认执行：这是唯一能落库的入口 —— 白名单 + UserId 围栏 + 确认三道闸都在这与执行器里</summary>
    public IActionResult OnPostExecute(int msgId, int actIndex)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        // UserId 围栏：只能动自己名下的建议单
        var msg = _db.AiMessages.FirstOrDefault(m => m.Id == msgId && m.UserId == uid && m.Role == "assistant");
        if (msg is null || string.IsNullOrEmpty(msg.ActionsJson))
        {
            TempData["AiError"] = "建议不存在或已处理。";
            return RedirectToPage();
        }

        var r = _executor.Execute(msg.ActionsJson, actIndex);
        if (r.Ok)
        {
            // 标记该条已完成（不删数组防索引错位，渲染时过滤 _done）
            try
            {
                var arr = JsonNode.Parse(msg.ActionsJson) as JsonArray
                       ?? (JsonNode.Parse(msg.ActionsJson) as JsonObject)?["actions"] as JsonArray;
                if (arr is not null && actIndex >= 0 && actIndex < arr.Count && arr[actIndex] is JsonObject obj)
                {
                    obj["_done"] = true;
                    msg.ActionsJson = arr.ToJsonString();
                    _db.SaveChanges();
                }
            }
            catch { /* 标记失败不影响已执行结果 */ }
            TempData["AiNotice"] = r.Message;
        }
        else
        {
            TempData["AiError"] = r.Message;
        }
        return RedirectToPage();
    }

    /// <summary>忽略建议：清掉这条消息的建议单，不写库</summary>
    public IActionResult OnPostDismiss(int msgId)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var msg = _db.AiMessages.FirstOrDefault(m => m.Id == msgId && m.UserId == uid);
        if (msg is not null && msg.ActionsJson != "")
        {
            msg.ActionsJson = "";
            _db.SaveChanges();
        }
        return RedirectToPage();
    }

    /// <summary>清空对话历史（只清自己的）</summary>
    public IActionResult OnPostClear()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        _db.AiMessages.Where(m => m.UserId == uid).ExecuteDelete();
        TempData["AiNotice"] = "对话历史已清空。";
        return RedirectToPage();
    }

    // ---------- 图片输入（单次打包：存一次、只随当轮请求发送） ----------

    /// <summary>服务端图片硬顶（前端压缩后一般 100-400KB，这里防绕过）</summary>
    private const int MaxImageBytes = 5 * 1024 * 1024;

    /// <summary>取消息图片字节。UserId 围栏：只能看自己消息的图，别人的一律 404。</summary>
    public IActionResult OnGetImage(int id)
    {
        if (_me.UserId is not int uid) return NotFound();
        var img = _db.AiMessages.AsNoTracking()
            .Where(m => m.Id == id && m.UserId == uid && m.ImageMime != "" && m.ImageData != null)
            .Select(m => new { m.ImageData, m.ImageMime })
            .FirstOrDefault();
        if (img?.ImageData is null) return NotFound();
        Response.Headers.CacheControl = "private, max-age=604800";   // 私缓一周：图入库后不再变
        return File(img.ImageData, img.ImageMime);
    }

    /// <summary>解析前端 data URL（data:image/xxx;base64,...）；格式不支持返回 null</summary>
    private static (byte[] Data, string Mime)? ParseImageDataUrl(string dataUrl)
    {
        if (!dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return null;
        var comma = dataUrl.IndexOf(',');
        if (comma < 0) return null;
        var meta = dataUrl[5..comma];
        if (!meta.EndsWith(";base64", StringComparison.OrdinalIgnoreCase)) return null;
        var mime = meta[..^7].Trim().ToLowerInvariant();
        if (mime == "image/jpg") mime = "image/jpeg";
        if (mime is not ("image/jpeg" or "image/png" or "image/webp" or "image/gif")) return null;
        try
        {
            var bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]);
            return bytes.Length == 0 ? null : (bytes, mime);
        }
        catch (FormatException) { return null; }
    }

    /// <summary>
    /// 组装一条对话消息：当轮有图 → 内容块数组（image_url + text）；
    /// 历史轮有图 → 只发 [图片] 文字标记（单次打包，不重复烧图 token）。
    /// </summary>
    private static AiChatMessage BuildTurnMessage(AiMessage m, bool isCurrent, byte[]? currentBytes, string currentMime)
    {
        if (isCurrent && currentBytes is { Length: > 0 } && currentMime != "")
        {
            var parts = new List<object>
            {
                new
                {
                    type = "image_url",
                    image_url = new { url = $"data:{currentMime};base64,{Convert.ToBase64String(currentBytes)}" },
                },
                new
                {
                    type = "text",
                    text = string.IsNullOrWhiteSpace(m.Content) ? "看看这张图片，并结合我们的对话回答。" : m.Content,
                },
            };
            return new AiChatMessage(m.Role, parts);
        }
        if (m.ImageMime != "")
        {
            return new AiChatMessage(m.Role,
                string.IsNullOrWhiteSpace(m.Content) ? "[图片]" : "[图片] " + m.Content);
        }
        return new AiChatMessage(m.Role, m.Content);
    }

    // ---------- 建议卡片摘要（给人看的中文，不是给 AI 的 JSON） ----------

    private static string Summarize(string type, System.Text.Json.JsonElement a)
    {
        string S(string name)
            => a.TryGetProperty(name, out var v)
                ? (v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() ?? "" : v.ToString())
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

    // ---------- 系统提示与数据摘要 ----------

    private const string SystemPrompt = """
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
    private string BuildDataSummary(int uid)
    {
        var now = DateTime.Now;
        var sb = new StringBuilder();
        sb.AppendLine($"【数据摘要】今天是 {now:yyyy-MM-dd} 星期{"一二三四五六日"[(int)now.DayOfWeek == 0 ? 6 : (int)now.DayOfWeek - 1]}。");

        var habits = _db.Habits.Where(h => h.UserId == uid).OrderBy(h => h.Id).ToList();
        if (habits.Count > 0)
        {
            var today = now.Date;
            var doneToday = _db.HabitCheckins
                .Where(c => c.UserId == uid && c.CheckinDate == today)
                .Select(c => c.HabitId)
                .ToHashSet();
            sb.AppendLine("习惯清单（habit_id: 名称，✓=今天已打卡）：");
            foreach (var h in habits)
                sb.AppendLine($"  {h.Id}: {h.Name}{(doneToday.Contains(h.Id) ? " ✓" : "")}");
        }

        var weekEnd = now.Date.AddDays(7);
        var soon = _db.Schedules
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
}
