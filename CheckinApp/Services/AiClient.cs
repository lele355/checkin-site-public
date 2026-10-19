using Microsoft.Extensions.Options;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CheckinApp.Services;

/// <summary>
/// AI 服务配置（appsettings 的 Ai 节）。
/// API Key 只放在 appsettings.Local.json（gitignored）或环境变量 MIMO_API_KEY / AI_API_KEY 里，绝不进 git。
/// 双平台互备：MiMo 填 https://api.xiaomimimo.com/v1 + mimo-v2.6-flash；
/// 换 DeepSeek 则填 https://api.deepseek.com/v1 + deepseek-chat，其余代码零改动。
/// </summary>
public class AiOptions
{
    public string BaseUrl { get; set; } = "https://api.xiaomimimo.com/v1";
    public string Model { get; set; } = "mimo-v2.6-flash";
    public string ApiKey { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 30;
    public int MaxCompletionTokens { get; set; } = 4096;
    /// <summary>每用户每天可发的对话条数上限（防滥用兜底）</summary>
    public int DailyRequestLimit { get; set; } = 60;
    /// <summary>
    /// 每用户每天的 token 总用量上限（提问 + 回答都算）。超过后当天不能再发消息。
    /// 默认 1 亿（按用户 2026-10-19 的要求）；想收紧直接改 appsettings 的 Ai.DailyTokenLimit。
    /// </summary>
    public long DailyTokenLimit { get; set; } = 100_000_000;
}

// 注意：API 要求小写 role/content，不加 JsonPropertyName 会序列化成 PascalCase 被打回 400
// Content 用 object：纯文本传 string，带图片传内容块数组 [{type:"image_url",...},{type:"text",...}]
// （MiMo 全模态支持 base64 data URL，详见 docs/AI图片输入可行性报告.md）
public record AiChatMessage(
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("content")] object Content);

/// <summary>AI 通过 function calling 发起的一次工具调用（ArgumentsJson 是函数参数的 JSON 文本）。</summary>
public record AiToolCall(string Id, string Name, string ArgumentsJson);

/// <summary>一次调用的 token 用量。Estimated=true 表示接口没返回 usage，是本地按字符数估的。</summary>
public record AiTokenUsage(long Prompt, long Completion, long Total, bool Estimated = false);

/// <summary>AI 调用结果：Ok=false 时 Error 是给用户看的中文原因。</summary>
public record AiResult(bool Ok, string Content, string? Error,
                       IReadOnlyList<AiToolCall>? ToolCalls = null,
                       AiTokenUsage? Usage = null);

/// <summary>
/// OpenAI 兼容聊天客户端（小米 MiMo / DeepSeek 通用）。
/// 只做一件事：把 messages 发过去，把回复拿回来。
/// 429 限流自动退避重试 2 次；错误码按官方文档映射成中文提示。
/// </summary>
public class AiClient(IHttpClientFactory httpFactory, IOptions<AiOptions> opt, ILogger<AiClient> log)
{
    private readonly AiOptions _opt = opt.Value;

    private string ResolveKey()
    {
        if (!string.IsNullOrWhiteSpace(_opt.ApiKey)) return _opt.ApiKey;
        // 环境变量兜底：服务器部署时不想落盘密钥就用这个
        return Environment.GetEnvironmentVariable("MIMO_API_KEY")
            ?? Environment.GetEnvironmentVariable("AI_API_KEY")
            ?? "";
    }

    /// <summary>
    /// 发消息拿回复。tools 非空时带上工具清单（function calling），
    /// 模型可以选择直接发起工具调用（返回 ToolCalls）或纯文本回复。
    /// toolChoice 传 "required" 可强制模型必须发起工具调用（兜底重试用）。
    /// </summary>
    public async Task<AiResult> ChatAsync(IReadOnlyList<AiChatMessage> messages, object? tools = null, string? toolChoice = null, CancellationToken ct = default)
    {
        var key = ResolveKey();
        if (key == "") return new AiResult(false, "", "AI 功能未配置 API Key（appsettings.Local.json 或环境变量 MIMO_API_KEY）");

        var payload = new Dictionary<string, object?>
        {
            ["model"] = _opt.Model,
            ["messages"] = messages,
            ["max_completion_tokens"] = _opt.MaxCompletionTokens,
            ["thinking"] = new { type = "disabled" },   // flash 档关思考模式：更快更省
        };
        if (tools is not null) payload["tools"] = tools;
        if (toolChoice is not null) payload["tool_choice"] = toolChoice;
        var body = JsonSerializer.Serialize(payload);

        // 429 限流退避重试：最多 3 次尝试
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                using var http = httpFactory.CreateClient("ai");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"{_opt.BaseUrl.TrimEnd('/')}/chat/completions");
                req.Headers.TryAddWithoutValidation("api-key", key);              // MiMo 官方头
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key); // OpenAI 兼容头
                req.Content = new StringContent(body, Encoding.UTF8, "application/json");

                using var resp = await http.SendAsync(req, ct);
                var text = await resp.Content.ReadAsStringAsync(ct);

                if (resp.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(text);
                    var msg = doc.RootElement
                        .GetProperty("choices")[0]
                        .GetProperty("message");

                    // content 在纯 tool_calls 回复里可能是 null 或缺字段
                    var content = msg.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String
                        ? c.GetString() ?? "" : "";

                    // 解析 tool_calls：[{id, type, function:{name, arguments}}]，arguments 是 JSON 文本
                    List<AiToolCall>? calls = null;
                    if (msg.TryGetProperty("tool_calls", out var tc) && tc.ValueKind == JsonValueKind.Array)
                    {
                        calls = [];
                        foreach (var call in tc.EnumerateArray())
                        {
                            if (!call.TryGetProperty("function", out var fn)) continue;
                            var name = fn.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                            if (name == "") continue;
                            var id = call.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
                            var args = fn.TryGetProperty("arguments", out var a) ? a.GetString() ?? "" : "";
                            calls.Add(new AiToolCall(id, name, args));
                        }
                        if (calls.Count == 0) calls = null;
                    }
                    var usage = ReadUsage(doc.RootElement, body.Length, content);
                    return new AiResult(true, content, null, calls, usage);
                }

                var status = (int)resp.StatusCode;
                if (status == 429 && attempt < 3)
                {
                    await Task.Delay(1000 * attempt, ct);   // 1s → 2s 退避
                    continue;
                }

                log.LogWarning("AI 调用失败 HTTP {Status}: {Body}", status, text);
                return new AiResult(false, "", MapError(status));
            }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested)
            {
                return new AiResult(false, "", "AI 服务响应超时，稍后再试");
            }
            catch (Exception ex)
            {
                log.LogError(ex, "AI 调用异常");
                return new AiResult(false, "", "AI 服务暂时不可用，稍后再试");
            }
        }

        return new AiResult(false, "", "AI 服务繁忙，稍后再试");
    }

    /// <summary>
    /// 读接口返回的 usage（OpenAI 兼容字段 prompt_tokens / completion_tokens / total_tokens）。
    /// 有的网关不返回 usage，此时按字符数估算：中文约 1 字 1 token，英文约 4 字符 1 token，
    /// 统一用「/2」「/3」折中并刻意偏高 —— 配额宁可早一点拦，也不要静默算成 0。
    /// </summary>
    private static AiTokenUsage ReadUsage(JsonElement root, int requestChars, string completion)
    {
        if (root.TryGetProperty("usage", out var u) && u.ValueKind == JsonValueKind.Object)
        {
            long p = u.TryGetProperty("prompt_tokens", out var pe) && pe.TryGetInt64(out var pv) ? pv : 0;
            long c = u.TryGetProperty("completion_tokens", out var ce) && ce.TryGetInt64(out var cv) ? cv : 0;
            long t = u.TryGetProperty("total_tokens", out var te) && te.TryGetInt64(out var tv) ? tv : p + c;
            if (t > 0) return new AiTokenUsage(p, c, t);
        }

        var estIn = Math.Max(1, requestChars / 3);
        var estOut = Math.Max(1, completion.Length / 2);
        return new AiTokenUsage(estIn, estOut, estIn + estOut, true);
    }

    /// <summary>官方错误码 → 中文提示（别把原始 JSON 甩给用户）</summary>
    private static string MapError(int status) => status switch
    {
        400 => "AI 请求格式有误，请换个说法试试",
        401 => "AI API Key 无效或已过期",
        402 => "AI 服务额度用完了",
        403 => "AI 服务拒绝访问",
        404 => "AI 模型不存在",
        421 => "内容被安全策略拦截，换个说法试试",
        429 => "AI 服务繁忙（请求超限），稍后再试",
        500 or 503 => "AI 服务暂时不可用，稍后再试",
        _ => $"AI 服务出错了（HTTP {status}）"
    };
}
