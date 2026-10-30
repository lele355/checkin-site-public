using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 军旗明棋布阵状态机（设计 §2.2）：
/// waiting → setup（120s 起表）→（双方 deploy）→ playing；超时懒结算自动随机。
/// setup 事件进 MovesJson = 唯一真相（红线 20）；并发全部走 Revision CAS。
/// 无后台 Timer，与 GameClock / GameAi 同哲学（谁读谁触发）。
/// </summary>
public static class ArmyChessSetup
{
    public const int SetupSeconds = 120;

    // ---------------- deploy 受理 ----------------

    /// <summary>
    /// 受理一方布阵：random=true 服务端随机（满足约束），否则 pieces×25 权威校验。
    /// 双方齐 → CAS 翻 playing（Turn=1，TurnStartedAt=now）；否则只落该方事件。
    /// </summary>
    public static void Deploy(AppDbContext db, int roomId, int side, JsonElement req)
    {
        if (side is not (1 or 2)) throw new ApiBadRequest("你不在这一局里");
        var wantRandom = req.TryGetProperty("random", out var rndEl) && rndEl.ValueKind == JsonValueKind.True;

        List<GameEvent>? mine = null;
        if (wantRandom)
        {
            mine = null;   // CAS 成功后再生成（baseId 依赖当时已有事件数）
        }
        else
        {
            if (!req.TryGetProperty("pieces", out var arr) || arr.ValueKind != JsonValueKind.Array)
                throw new ApiBadRequest("布阵数据不完整");
            mine = ParsePieces(side, arr);
        }

        for (var attempt = 0; attempt < 4; attempt++)
        {
            var room = db.GameRooms.AsNoTracking().First(x => x.Id == roomId);
            if (room.Status != "setup")
                throw new ApiBadRequest("当前不在布阵阶段");

            var evs = GameEvents.Parse(room.MovesJson);
            if (evs.Any(e => e.t == "setup" && e.s == side))
                throw new ApiBadRequest("你已经布阵了");

            var baseId = evs.Count(e => e.t == "setup");
            var myEvents = mine ?? ArmyChessRules.RandomSideSetup(side, baseId);
            var newEvs = new List<GameEvent>(evs);
            newEvs.AddRange(myEvents);

            var other = side == 1 ? 2 : 1;
            var bothDone = newEvs.Any(e => e.t == "setup" && e.s == 1) && newEvs.Any(e => e.t == "setup" && e.s == 2);
            var rev = room.Revision;
            var now = DateTime.UtcNow;
            var json = GameEvents.Store(newEvs);

            int rows;
            if (bothDone)
            {
                rows = db.GameRooms
                    .Where(x => x.Id == roomId && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.MovesJson, json)
                        .SetProperty(x => x.Status, "playing")
                        .SetProperty(x => x.Turn, 1)
                        .SetProperty(x => x.TurnStartedAt, (DateTime?)now)
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now));
            }
            else
            {
                rows = db.GameRooms
                    .Where(x => x.Id == roomId && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.MovesJson, json)
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now));
            }
            if (rows > 0) { db.ChangeTracker.Clear(); return; }   // 成功（清跟踪缓存，后续 Load 读到新状态）
            db.ChangeTracker.Clear();   // CAS 失败：别人刚提交，重读重试
        }
        throw new ApiBadRequest("布阵提交冲突，请重试");
    }

    /// <summary>解析并权威校验自摆阵 25 枚（§2.2 校验清单）</summary>
    private static List<GameEvent> ParsePieces(int side, JsonElement arr)
    {
        if (arr.GetArrayLength() != ArmyChessBoard.PiecesPerSide)
            throw new ApiBadRequest("布阵必须是 25 枚棋子");

        var spec = ArmyChessRules.SpecCounts();
        var counts = new Dictionary<string, int>();
        var seen = new HashSet<(int x, int y)>();
        var rankValue = new Dictionary<string, int>();
        foreach (var (rank, value, _) in SpecValuePairs()) rankValue[rank] = value;

        var evs = new List<GameEvent>();
        var pid = 0;
        foreach (var p in arr.EnumerateArray())
        {
            var x = p.TryGetProperty("x", out var xe) ? xe.GetInt32() : -1;
            var y = p.TryGetProperty("y", out var ye) ? ye.GetInt32() : -1;
            var rank = p.TryGetProperty("rank", out var re) ? re.GetString() : null;

            if (x < 0 || x >= ArmyChessRules.BoardW || y < 0 || y >= ArmyChessRules.BoardH)
                throw new ApiBadRequest("布阵位置不合法");
            if (rank is null || !rankValue.ContainsKey(rank))
                throw new ApiBadRequest("布阵包含未知棋子");
            if (!ArmyChessBoard.InOwnHalf(side, y))
                throw new ApiBadRequest("棋子必须布在自己半场");
            if (ArmyChessRules.CellType(x, y) == ArmyChessRules.Camp)
                throw new ApiBadRequest("行营不能布子");
            if (rank == ArmyChessRules.RANK_FLAG && !ArmyChessBoard.IsOwnDen(side, x, y))
                throw new ApiBadRequest("军旗必须在大本营");
            if (rank == ArmyChessRules.RANK_BOMB && ArmyChessBoard.IsFrontRow(side, y))
                throw new ApiBadRequest("炸弹不能布在前线排");
            if (rank == ArmyChessRules.RANK_MINE && !ArmyChessBoard.IsBackTwoRows(side, y))
                throw new ApiBadRequest("地雷只能布在最后两排");
            if (!seen.Add((x, y)))
                throw new ApiBadRequest("一格不能布两枚棋子");

            counts[rank] = counts.GetValueOrDefault(rank) + 1;
            evs.Add(new GameEvent { t = "setup", s = side, x = x, y = y, v = rankValue[rank], p = pid++ });
        }

        foreach (var (rank, count) in spec)
        {
            if (counts.GetValueOrDefault(rank) != count)
                throw new ApiBadRequest("棋子配比不正确");
        }
        return evs;
    }

    private static IEnumerable<(string rank, int value, int count)> SpecValuePairs() =>
    [
        (ArmyChessRules.RANK_COMMANDER, 10, 1), (ArmyChessRules.RANK_ARMY, 9, 1),
        (ArmyChessRules.RANK_DIVISION, 8, 2), (ArmyChessRules.RANK_BRIGADE, 7, 2),
        (ArmyChessRules.RANK_REGIMENT, 6, 2), (ArmyChessRules.RANK_BATTALION, 5, 2),
        (ArmyChessRules.RANK_COMPANY, 4, 3), (ArmyChessRules.RANK_PLATOON, 3, 3),
        (ArmyChessRules.RANK_ENGINEER, 2, 3), (ArmyChessRules.RANK_MINE, 11, 3),
        (ArmyChessRules.RANK_BOMB, 13, 2), (ArmyChessRules.RANK_FLAG, 12, 1),
    ];

    // ---------------- 120s 懒结算超时 ----------------

    /// <summary>
    /// setup 超时懒结算（挂 GET 轮询路径）：超 120s 未 deploy 的座服务端随机布阵 → 翻 playing。
    /// 返回 true 表示状态被推进，调用方需重读房间。
    /// </summary>
    public static bool Enforce(AppDbContext db, GameRoom room)
    {
        if (room.GameKey != "armychess" || room.Status != "setup") return false;
        if (room.TurnStartedAt is null) return false;
        var elapsed = (DateTime.UtcNow - room.TurnStartedAt.Value).TotalSeconds;
        if (elapsed <= SetupSeconds) return false;

        var evs = GameEvents.Parse(room.MovesJson);
        var newEvs = new List<GameEvent>(evs);
        var baseId = newEvs.Count(e => e.t == "setup");
        foreach (var side in new[] { 1, 2 })
        {
            if (newEvs.Any(e => e.t == "setup" && e.s == side)) continue;
            var gen = ArmyChessRules.RandomSideSetup(side, baseId);
            baseId += gen.Count;
            newEvs.AddRange(gen);
        }

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev && x.Status == "setup")
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                .SetProperty(x => x.Status, "playing")
                .SetProperty(x => x.Turn, 1)
                .SetProperty(x => x.TurnStartedAt, (DateTime?)now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now));
        db.ChangeTracker.Clear();
        return rows > 0;
    }

    /// <summary>AI 座即时随机布阵（进入 setup 时调用；布阵期对方看不到 AI 的 rank，无泄露面）</summary>
    public static void DeployAiSideIfNeeded(AppDbContext db, GameRoom room)
    {
        if (room.GameKey != "armychess" || room.Status != "setup") return;
        if (room.AiLevel <= 0 || room.GuestUserId is not null) return;
        var aiSide = room.HostSide == 1 ? 2 : 1;
        var evs = GameEvents.Parse(room.MovesJson);
        if (evs.Any(e => e.t == "setup" && e.s == aiSide)) return;

        var baseId = evs.Count(e => e.t == "setup");
        var gen = ArmyChessRules.RandomSideSetup(aiSide, baseId);
        var newEvs = new List<GameEvent>(evs);
        newEvs.AddRange(gen);

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev && x.Status == "setup")
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now));
        db.ChangeTracker.Clear();
        if (rows == 0) return;   // CAS 失败：下轮轮询重试
    }

    /// <summary>进入布阵阶段（join/AI 填充后调用）：CAS 翻 setup + 起表</summary>
    public static void EnterSetup(AppDbContext db, GameRoom room)
    {
        if (room.GameKey != "armychess" || room.Mode != "open") return;
        if (room.Status != "waiting") return;
        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev && x.Status == "waiting")
            .ExecuteUpdate(s => s
                .SetProperty(x => x.Status, "setup")
                .SetProperty(x => x.TurnStartedAt, (DateTime?)now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now));
        db.ChangeTracker.Clear();
        if (rows == 0) return;
        DeployAiSideIfNeeded(db, db.GameRooms.AsNoTracking().First(x => x.Id == room.Id));
    }
}
