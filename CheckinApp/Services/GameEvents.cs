using System.Text.Json;
using System.Text.Json.Serialization;

namespace CheckinApp.Services;

/// <summary>
/// 游戏事件信封（2.8.0 起写入）—— MovesJson 的元素格式。
///
/// 存量五子棋形状是 [{"x":7,"y":7,"s":1}] 无 t 键 → 读侧垫片（缺 t 即视为 move）+ 写侧只写新 + 快照双投影。
/// 零 DB 迁移、懒升级：房间被任意写操作触碰一次即转换完成。
/// </summary>
public sealed class GameEvent
{
    /// <summary>事件类型：setup / move / roll / pass / battle / resign</summary>
    [JsonPropertyName("t")]
    public string t { get; set; } = "move";

    /// <summary>发起方：1/2；0 = 系统（如军旗随机布阵）</summary>
    [JsonPropertyName("s")]
    public int s { get; set; }

    // 类型相关扁平字段（未用为 null）
    [JsonPropertyName("x")] public int? x { get; set; }
    [JsonPropertyName("y")] public int? y { get; set; }
    [JsonPropertyName("fx")] public int? fx { get; set; }
    [JsonPropertyName("fy")] public int? fy { get; set; }
    [JsonPropertyName("tx")] public int? tx { get; set; }
    [JsonPropertyName("ty")] public int? ty { get; set; }
    [JsonPropertyName("v")] public int? v { get; set; }
    [JsonPropertyName("p")] public int? p { get; set; }

    // 军旗战斗
    [JsonPropertyName("att")] public string? att { get; set; }
    [JsonPropertyName("def")] public string? def { get; set; }
    [JsonPropertyName("result")] public string? result { get; set; }

    // 军旗布阵
    [JsonPropertyName("pieces")] public List<SetupPiece>? pieces { get; set; }

    /// <summary>向前兼容：未知字段解析时保留</summary>
    [JsonExtensionData] public Dictionary<string, JsonElement>? extra { get; set; }
}

public sealed record SetupPiece(int x, int y, int side, string rank);

/// <summary>
/// 事件流的纯函数工具：双格式读（旧格式垫片）+ 只写新格式。
/// </summary>
public static class GameEvents
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// 解析 MovesJson 为事件列表。
    /// 旧格式（元素缺 t 键）→ 视为 {"t":"move", …原字段}（读侧垫片常驻）。
    /// </summary>
    public static List<GameEvent> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];

            var result = new List<GameEvent>();
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object) continue;

                // 读侧垫片：缺 t 键 → 旧格式（GomokuRules.Stone 扁平列表），视为 move
                if (!el.TryGetProperty("t", out _))
                {
                    var stone = el.Deserialize<GomokuRules.Stone>(JsonOpts);
                    if (stone is not null)
                    {
                        result.Add(new GameEvent { t = "move", s = stone.s, x = stone.x, y = stone.y });
                    }
                    continue;
                }

                var evt = el.Deserialize<GameEvent>(JsonOpts);
                if (evt is not null) result.Add(evt);
            }
            return result;
        }
        catch (JsonException) { return []; }
    }

    /// <summary>只写新格式（带 t 键的信封）</summary>
    public static string Store(List<GameEvent> evs) =>
        JsonSerializer.Serialize(evs, JsonOpts);

    /// <summary>追加事件并返回新列表</summary>
    public static List<GameEvent> Append(List<GameEvent> evs, GameEvent e)
    {
        evs.Add(e);
        return evs;
    }

    /// <summary>
    /// 兼容投影：把 move 事件转回旧格式 [{x,y,s}]，给五子棋客户端零改动使用。
    /// </summary>
    public static List<GomokuRules.Stone> ToLegacyMoves(IReadOnlyList<GameEvent> evs) =>
        evs.Where(e => e.t == "move" && e.x is not null && e.y is not null)
           .Select(e => new GomokuRules.Stone(e.x!.Value, e.y!.Value, e.s))
           .ToList();
}
