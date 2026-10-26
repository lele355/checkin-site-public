using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CheckinApp.Api;

/// <summary>AI 助手：对话历史、发送（含工具调用 / 建议单）、确认执行。与网页版共用同一套提示词与配额。</summary>
public static class AiApi
{
    public record SendReq(string? Text, string? Image);
    public record ExecReq(int MsgId, int ActIndex);

    private const int MaxImageBytes = 5 * 1024 * 1024;

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/ai").RequireAuthorization("perm:ai.use");

        // ---------- 历史 ----------
        g.MapGet("/messages", (AppDbContext db, HttpContext ctx, IOptions<AiOptions> opt) =>
        {
            var uid = ApiKit.MeId(ctx);
            return ApiKit.Ok(Pack(db, uid, opt.Value));
        });

        // ---------- 发送 ----------
        g.MapPost("/send", async (SendReq req, AppDbContext db, CurrentUser me, AiClient ai,
                                  IOptions<AiOptions> opt, CancellationToken ct,
                                  HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var o = opt.Value;
            var text = (req.Text ?? "").Trim();
            if (text.Length > 2000) text = text[..2000];

            byte[]? imageBytes = null;
            var imageMime = "";
            if (!string.IsNullOrWhiteSpace(req.Image))
            {
                var parsed = ParseImageDataUrl(req.Image);
                if (parsed is null) return ApiKit.Err("图片格式不支持（只收 JPEG / PNG / WebP / GIF）");
                if (parsed.Value.Data.Length > MaxImageBytes) return ApiKit.Err("图片太大了（上限 5MB）");
                imageBytes = parsed.Value.Data;
                imageMime = parsed.Value.Mime;
            }
            if (text.Length == 0 && imageBytes is null) return ApiKit.Err("先输入点什么，或者附一张图片吧");

            // 配额两道闸
            var today = DateTime.UtcNow.Date;
            var used = db.AiMessages.Count(m => m.UserId == uid && m.Role == "user" && m.CreatedAt >= today);
            if (used >= o.DailyRequestLimit)
                return ApiKit.Err($"今天的 AI 对话次数已用完（每日 {o.DailyRequestLimit} 条），明天再来吧", 429);

            var usedTokens = db.AiUsageDailies.AsNoTracking()
                .Where(x => x.UserId == uid && x.Day == today).Select(x => x.TotalTokens).FirstOrDefault();
            if (o.DailyTokenLimit > 0 && usedTokens >= o.DailyTokenLimit)
                return ApiKit.Err($"今天的 AI token 额度已用完，明天再来吧", 429);

            var sent = new AiMessage { UserId = uid, Role = "user", Content = text, ImageMime = imageMime, ImageData = imageBytes };
            db.AiMessages.Add(sent);
            db.SaveChanges();

            var history = db.AiMessages.AsNoTracking()
                .Where(m => m.UserId == uid)
                .OrderByDescending(m => m.Id).Take(20).OrderBy(m => m.Id)
                .Select(m => new AiMessage { Id = m.Id, Role = m.Role, Content = m.Content, ImageMime = m.ImageMime })
                .ToList();

            var messages = new List<AiChatMessage>
            {
                new("system", AiPrompt.System),
                new("system", AiPrompt.BuildDataSummary(db, uid)),
            };
            foreach (var m in history)
                messages.Add(BuildTurnMessage(m, m.Id == sent.Id, imageBytes, imageMime));

            var result = await ai.ChatAsync(messages, AiTools.Catalog, null, ct);
            if (result.Ok) AddUsage(db, uid, today, result.Usage);

            if (!result.Ok)
            {
                db.AiMessages.Add(new AiMessage { UserId = uid, Role = "assistant", Content = "⚠️ " + result.Error });
                db.SaveChanges();
                return ApiKit.Err(result.Error ?? "AI 暂时不可用", 502);
            }

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

            // 偷懒兜底：嘴上说有建议却没真发起工具调用
            if (actionsJson is null && display.Contains("建议"))
            {
                var retryMsgs = new List<AiChatMessage>
                {
                    new("system", AiPrompt.System),
                    new("system", AiPrompt.BuildDataSummary(db, uid)),
                    BuildTurnMessage(new AiMessage { Id = sent.Id, Role = "user", Content = text, ImageMime = imageMime }, true, imageBytes, imageMime),
                    new("user", "请直接发起工具调用，为上面这条请求生成建议。若这里其实只是聊天、没有要创建的事项，回复「无」。"),
                };
                var retry = await ai.ChatAsync(retryMsgs, AiTools.Catalog, "required", ct);
                if (retry.Ok) AddUsage(db, uid, today, retry.Usage);
                if (retry.Ok && retry.ToolCalls is { Count: > 0 }) actionsJson = AiTools.ToActionsJson(retry.ToolCalls);
                else if (retry.Ok) { (_, var a2) = AiActionParser.Split(retry.Content); actionsJson = a2; }
            }

            // 有结构化建议时正文只留一句结论（模型爱在正文复述明细，还容易写错）
            display = AiPrompt.CompactDisplay(display, actionsJson);

            db.AiMessages.Add(new AiMessage
            {
                UserId = uid, Role = "assistant", Content = display, ActionsJson = actionsJson ?? "",
            });
            db.SaveChanges();

            return ApiKit.Ok(Pack(db, uid, o));
        });

        // ---------- 确认执行某条建议 ----------
        g.MapPost("/execute", (ExecReq req, AppDbContext db, AiActionExecutor executor, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var msg = db.AiMessages.FirstOrDefault(m => m.Id == req.MsgId && m.UserId == uid && m.Role == "assistant");
            if (msg is null || string.IsNullOrEmpty(msg.ActionsJson)) return ApiKit.NotFound("建议不存在或已处理");

            var r = executor.Execute(msg.ActionsJson, req.ActIndex);
            if (!r.Ok) return ApiKit.Err(r.Message);

            try
            {
                var arr = JsonNode.Parse(msg.ActionsJson) as JsonArray
                       ?? (JsonNode.Parse(msg.ActionsJson) as JsonObject)?["actions"] as JsonArray;
                if (arr is not null && req.ActIndex >= 0 && req.ActIndex < arr.Count && arr[req.ActIndex] is JsonObject obj)
                {
                    obj["_done"] = true;
                    msg.ActionsJson = arr.ToJsonString();
                    db.SaveChanges();
                }
            }
            catch { /* 标记失败不影响已执行结果 */ }

            return ApiKit.Ok(new { message = r.Message });
        });

        // ---------- 忽略建议 ----------
        g.MapPost("/dismiss", (ExecReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var msg = db.AiMessages.FirstOrDefault(m => m.Id == req.MsgId && m.UserId == uid);
            if (msg is null) return ApiKit.NotFound("消息不存在");
            msg.ActionsJson = "";
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ---------- 清空历史 ----------
        g.MapPost("/clear", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var rows = db.AiMessages.Where(m => m.UserId == uid).ToList();
            db.AiMessages.RemoveRange(rows);
            db.SaveChanges();
            return ApiKit.Ok(new { removed = rows.Count });
        });

        // ---------- 历史消息里的图片 ----------
        g.MapGet("/image/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var m = db.AiMessages.AsNoTracking().FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (m?.ImageData is null || m.ImageData.Length == 0) return Results.NotFound();
            return Results.File(m.ImageData, string.IsNullOrEmpty(m.ImageMime) ? "image/jpeg" : m.ImageMime);
        });
    }

    // ---------- 私有 ----------
    private static object Pack(AppDbContext db, int uid, AiOptions o)
    {
        var today = DateTime.UtcNow.Date;
        var rows = db.AiMessages.Where(m => m.UserId == uid)
            .OrderByDescending(m => m.Id).Take(60).ToList();
        rows.Reverse();

        var items = rows.Select(m => new
        {
            id = m.Id,
            role = m.Role,
            content = m.Content,
            imageMime = m.ImageMime,
            hasImage = m.ImageMime.Length > 0,
            createdAt = ApiKit.StampUtc(m.CreatedAt),
            actions = Cards(m.ActionsJson),
        }).ToList();

        var usedTokens = db.AiUsageDailies.AsNoTracking()
            .Where(x => x.UserId == uid && x.Day == today).Select(x => x.TotalTokens).FirstOrDefault();
        var usedReq = db.AiMessages.Count(m => m.UserId == uid && m.Role == "user" && m.CreatedAt >= today);

        return new
        {
            items,
            quota = new
            {
                usedRequests = usedReq,
                dailyRequests = o.DailyRequestLimit,
                usedTokens,
                dailyTokens = o.DailyTokenLimit,
            },
        };
    }

    private static List<object> Cards(string actionsJson)
    {
        var list = new List<object>();
        if (string.IsNullOrWhiteSpace(actionsJson)) return list;
        var arr = AiActionParser.GetActions(actionsJson);
        for (var i = 0; i < arr.Count; i++)
        {
            var a = arr[i];
            var type = a.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
            var done = a.TryGetProperty("_done", out var d) && d.ValueKind == JsonValueKind.True;
            list.Add(new
            {
                index = i,
                type,
                label = AiActionExecutor.ActionLabels.GetValueOrDefault(type, type),
                summary = AiPrompt.Summarize(type, a),
                done,
            });
        }
        return list;
    }

    private static void AddUsage(AppDbContext db, int userId, DateTime day, AiTokenUsage? usage)
    {
        if (usage is null || usage.Total <= 0) return;

        // 同一请求里可能连着调两次（主调用 + 兜底重试）：先看 ChangeTracker 里已跟踪的行，
        // 否则第二次查库查不到第一次刚 Add 的行，会插出第二行撞 (UserId, Day) 唯一索引。
        var row = db.AiUsageDailies.Local.FirstOrDefault(x => x.UserId == userId && x.Day == day)
                  ?? db.AiUsageDailies.FirstOrDefault(x => x.UserId == userId && x.Day == day);
        if (row is null)
        {
            row = new AiUsageDaily { UserId = userId, Day = day };
            db.AiUsageDailies.Add(row);
        }
        row.PromptTokens += usage.Prompt;
        row.CompletionTokens += usage.Completion;
        row.TotalTokens += usage.Total;
        row.Requests += 1;
        db.SaveChanges();
    }

    private static AiChatMessage BuildTurnMessage(AiMessage m, bool isCurrent, byte[]? currentBytes, string currentMime)
    {
        if (m.Role == "assistant") return new AiChatMessage("assistant", m.Content);

        if (isCurrent && currentBytes is not null)
        {
            var url = $"data:{currentMime};base64,{Convert.ToBase64String(currentBytes)}";
            var parts = new List<object>
            {
                new { type = "image_url", image_url = new { url } },
                new { type = "text", text = string.IsNullOrEmpty(m.Content) ? "看看这张图" : m.Content },
            };
            return new AiChatMessage("user", parts);
        }

        var content = string.IsNullOrEmpty(m.Content) ? "" : m.Content;
        if (!string.IsNullOrEmpty(m.ImageMime)) content = (content.Length == 0 ? "" : content + " ") + "[图片]";
        return new AiChatMessage("user", content);
    }

    private static (byte[] Data, string Mime)? ParseImageDataUrl(string dataUrl)
    {
        var i = dataUrl.IndexOf("base64,", StringComparison.Ordinal);
        if (i < 0) return null;
        var head = dataUrl[..i];
        var mime = head.StartsWith("data:") ? head[5..].TrimEnd(';') : "";
        mime = mime.ToLowerInvariant();
        if (mime is not ("image/jpeg" or "image/png" or "image/webp" or "image/gif")) return null;
        try { return (Convert.FromBase64String(dataUrl[(i + 7)..]), mime); }
        catch { return null; }
    }
}
