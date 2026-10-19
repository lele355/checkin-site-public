using System.Text.Json;
using System.Text.Json.Serialization;
using CheckinApp.Data;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>一节课的起止时间（"HH:mm" 字符串，页面直接喂给 input[type=time]）</summary>
public record PeriodSlot(string Start, string End);

/// <summary>
/// 课程节数/时间配置 —— 存 AppSetting("courses.periods") 的 JSON：
/// [{"s":"08:00","e":"08:50"}, …]。节数 = 数组长度（1～16，可自定义）。
/// 没配置或配置坏了回落默认 12 小节（把教务 6 大节作息各拆两段：50 分钟 + 10 分钟课间）。
/// </summary>
public static class CoursesConfig
{
    public const string PeriodsKey = "courses.periods";
    public const int MinCount = 1;
    public const int MaxCount = 16;

    /// <summary>默认 12 小节：08:00 起，大节内 50 分钟一节、10 分钟课间（与教务作息完全对齐）</summary>
    public static readonly PeriodSlot[] Default =
    [
        new("08:00", "08:50"), new("09:00", "09:50"),
        new("10:10", "11:00"), new("11:10", "12:00"),
        new("12:10", "13:00"), new("13:10", "14:00"),
        new("14:10", "15:00"), new("15:10", "16:00"),
        new("16:10", "17:00"), new("17:10", "18:00"),
        new("19:00", "19:50"), new("20:00", "20:50"),
    ];

    private sealed class SlotDto
    {
        [JsonPropertyName("s")] public string S { get; set; } = "";
        [JsonPropertyName("e")] public string E { get; set; } = "";
    }

    /// <summary>读取节次配置；没存过/格式坏了都回落默认（宁可显示默认课表，不崩页面）</summary>
    public static List<PeriodSlot> Load(AppDbContext db)
    {
        var raw = db.AppSettings.FirstOrDefault(s => s.Key == PeriodsKey)?.Value;
        if (string.IsNullOrWhiteSpace(raw)) return [.. Default];
        try
        {
            var dtos = JsonSerializer.Deserialize<List<SlotDto>>(raw);
            var slots = (dtos ?? [])
                .Select(d => Normalize(d.S, d.E))
                .Where(s => s is not null)
                .Select(s => s!)
                .ToList();
            return slots.Count >= MinCount ? slots : [.. Default];
        }
        catch
        {
            return [.. Default];
        }
    }

    /// <summary>保存节次配置（JSON 存 AppSetting，覆盖式）</summary>
    public static void Save(AppDbContext db, IReadOnlyList<PeriodSlot> slots)
    {
        var json = JsonSerializer.Serialize(slots.Select(s => new SlotDto { S = s.Start, E = s.End }));
        var setting = db.AppSettings.FirstOrDefault(x => x.Key == PeriodsKey);
        if (setting is null)
            db.AppSettings.Add(new AppSetting { Key = PeriodsKey, Value = json });
        else
            setting.Value = json;
        db.SaveChanges();
    }

    /// <summary>时间归一化（"8:00"→"08:00"）；非法或 start≥end 返回 null</summary>
    public static PeriodSlot? Normalize(string? start, string? end)
    {
        if (TimeOnly.TryParse(start, out var s) && TimeOnly.TryParse(end, out var e) && s < e)
            return new PeriodSlot(s.ToString("HH:mm"), e.ToString("HH:mm"));
        return null;
    }
}
