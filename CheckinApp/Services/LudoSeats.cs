using System.Text.Json;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>飞行棋座位（SeatsJson 元素）</summary>
public sealed class LudoSeat
{
    public int Seat { get; set; }
    /// <summary>座位号 1..N（= 事件里的 side 号）</summary>
    public int Side { get; set; }
    /// <summary>red / yellow / blue / green</summary>
    public string Color { get; set; } = "";
    /// <summary>占座者 uid；null = AI 或空位</summary>
    public int? Uid { get; set; }
    /// <summary>占座者显示名（快照渲染用；AI="AI"，空位=""）</summary>
    public string Name { get; set; } = "";
    public bool IsAi { get; set; }
    public long UsedMs { get; set; }
    public DateTime? SeenAt { get; set; }
    /// <summary>false = 认输/超时出局（飞机回机库、跳过轮转）</summary>
    public bool Active { get; set; } = true;
}

/// <summary>
/// 飞行棋座位解析 / 存储 / 轮转 / 出局 —— 座位唯一真相（SeatsJson）。
///
/// 座位 → 颜色 → 起点固定映射（设计 §3.1：start = 13×(k−1)，起点格恰为本色格）：
///   seat0 红 side1 起点0 / seat1 黄 side2 起点13 / seat2 蓝 side3 起点26 / seat3 绿 side4 起点39。
/// 2 人 = seat0,1（红黄 0/13）；存量房随 §3.4 清空废弃，无迁移包袱。
/// 读到 SeatsJson==null 时按 Host/Guest 懒回填 2 座（复用「读垫片 + 写新」范式）。
/// </summary>
public static class LudoSeats
{
    public static readonly string[] Colors = ["red", "yellow", "blue", "green"];

    public static string ColorOf(int side) => Colors[((side - 1) % 4 + 4) % 4];
    // 起点/进终点前格：单一真相在 LudoRules（§9.2 常量表，引擎与绘制共用）
    public static int StartOf(int side) => LudoRules.StartOf(side);
    public static int HomeEntryOf(int side) => LudoRules.HomeEntryOf(side);

    private static readonly JsonSerializerOptions Opts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>读座位；SeatsJson==null/损坏时按 Host/Guest 懒回填 2 座</summary>
    public static List<LudoSeat> Get(GameRoom r)
    {
        if (!string.IsNullOrWhiteSpace(r.SeatsJson))
        {
            try
            {
                var list = JsonSerializer.Deserialize<List<LudoSeat>>(r.SeatsJson!, Opts);
                if (list is { Count: >= 2 }) return list;
            }
            catch { /* 落到回填 */ }
        }
        return Backfill2(r);
    }

    /// <summary>懒回填 2 座：seat0=host（HostSide），seat1=guest/AI</summary>
    private static List<LudoSeat> Backfill2(GameRoom r)
    {
        var hostSide = r.HostSide is 2 ? 2 : 1;
        var guestSide = hostSide == 1 ? 2 : 1;
        var seats = new List<LudoSeat>
        {
            new() { Seat = 0, Side = hostSide, Color = ColorOf(hostSide), Uid = r.HostUserId, Name = r.Host?.DisplayName ?? "", IsAi = false, UsedMs = r.HostUsedMs, SeenAt = r.HostSeenAt, Active = true },
        };
        if (r.AiLevel > 0)
            seats.Add(new() { Seat = 1, Side = guestSide, Color = ColorOf(guestSide), Uid = null, Name = "AI", IsAi = true, UsedMs = 0, SeenAt = null, Active = true });
        else if (r.GuestUserId is int gid)
            seats.Add(new() { Seat = 1, Side = guestSide, Color = ColorOf(guestSide), Uid = gid, Name = r.Guest?.DisplayName ?? "", IsAi = false, UsedMs = r.GuestUsedMs, SeenAt = r.GuestSeenAt, Active = true });
        else
            seats.Add(new() { Seat = 1, Side = guestSide, Color = ColorOf(guestSide), Uid = null, Name = "", IsAi = false, UsedMs = 0, SeenAt = null, Active = true });
        return seats;
    }

    public static string Store(List<LudoSeat> seats) => JsonSerializer.Serialize(seats, Opts);

    public static int Count(GameRoom r) => Get(r).Count;

    public static List<LudoSeat> Active(GameRoom r) => Get(r).Where(s => s.Active).ToList();

    public static LudoSeat? BySide(GameRoom r, int side) => Get(r).FirstOrDefault(s => s.Side == side);
    public static LudoSeat? ByUid(GameRoom r, int uid) => Get(r).FirstOrDefault(s => s.Uid == uid);
    public static bool IsAiSeat(GameRoom r, int side) => BySide(r, side)?.IsAi ?? false;

    /// <summary>下一 active 座（跳过认输/出局）；全出局则返回当前座</summary>
    public static int NextActive(GameRoom r, int curSide)
    {
        var ordered = Get(r).OrderBy(s => s.Seat).ToList();
        var idx = ordered.FindIndex(s => s.Side == curSide);
        if (idx < 0) idx = 0;
        for (var step = 1; step <= ordered.Count; step++)
        {
            var cand = ordered[(idx + step) % ordered.Count];
            if (cand.Active) return cand.Side;
        }
        return curSide;
    }

    /// <summary>某座已用毫秒。多座房（SeatsJson!=null）统一读座位（消除双源）；2 人回填房读 Host/Guest 列</summary>
    public static long UsedMsOf(GameRoom r, int side)
    {
        if (r.SeatsJson != null)
            return BySide(r, side)?.UsedMs ?? 0;
        // 2 人回填房：座位由 Host/Guest 列合成，读列与读座位等价
        if (side == 1) return r.HostUsedMs;
        if (side == 2) return r.GuestUsedMs;
        return BySide(r, side)?.UsedMs ?? 0;
    }

    /// <summary>标记某座出局（active=false）。返回新的座位列表。</summary>
    public static List<LudoSeat> MarkInactive(GameRoom r, int side)
    {
        var seats = Get(r);
        var s = seats.FirstOrDefault(x => x.Side == side);
        if (s is not null) s.Active = false;
        return seats;
    }

    /// <summary>只剩一个 active 座时返回其 side，否则 0</summary>
    public static int SoleActive(GameRoom r)
    {
        var active = Active(r);
        return active.Count == 1 ? active[0].Side : 0;
    }

    /// <summary>该方是否仍 active</summary>
    public static bool IsActive(GameRoom r, int side) => BySide(r, side)?.Active ?? false;
}
