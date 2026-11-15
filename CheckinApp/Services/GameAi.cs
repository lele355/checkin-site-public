using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// AI 懒生成走子 —— 与 GameClock 同哲学：无后台 Timer，谁轮询谁触发。
///
/// 幂等三保险：
/// 1. 思考延迟（0.4~1.0s 随机）→ 人类落子后 TurnStartedAt 刚刷新，天然节流
/// 2. Revision CAS → 生成走子后 ExecuteUpdate WHERE Revision==rev，rows==0 说明别的请求已生成
/// 3. 轮到人才生成 → room.Turn != aiSide 一律不生成
/// </summary>
public static class GameAi
{
    /// <summary>判断是否轮到 AI（用于 GameClock.Enforce 跳过 AI 超时）</summary>
    public static bool IsAiTurn(GameRoom r)
    {
        if (r.Status != "playing") return false;
        return r.AiLevel > 0 && r.GuestUserId is null && r.Turn != r.HostSide;
    }

    /// <summary>确保 AI 该走的棋已经走了。谁轮询谁触发。返回 true = 生成了事件（调用方要重读）。</summary>
    public static bool EnsureMove(AppDbContext db, GameRoom room)
    {
        if (room.Status != "playing") return false;

        if (room.AiLevel <= 0 || room.GuestUserId is not null) return false;

        var aiSide = GameEngines.Get(room.GameKey).Other(room.HostSide);
        if (room.Turn != aiSide) return false;

        if (room.TurnStartedAt is not null)
        {
            var elapsed = (DateTime.UtcNow - room.TurnStartedAt.Value).TotalMilliseconds;
            var thinkDelay = 500 + Random.Shared.Next(0, 1000);
            if (elapsed < thinkDelay) return false;
        }

        var evs = GameEvents.Parse(room.MovesJson);
        var engine = GameEngines.Get(room.GameKey);
        var legal = engine.AllMoves(evs, room, aiSide);

        if (legal is not null)
        {
            // 引擎能枚举合法着：空列表 = 真无合法着 → 自动 pass（黑白棋 WOF 规则 2：无子可下轮次作废）
            if (legal.Count == 0) return AppendPass(db, room, aiSide);

            // 优先 Think（棋力）；被引擎拒就依序退回合法着列表 —— 绝不重试同一手
            var candidates = new List<JsonElement>();
            var think = engine.Think(evs, aiSide, room.AiLevel, room);
            if (think is not null) candidates.Add(think.Value);
            candidates.AddRange(legal);
            foreach (var c in candidates)
            {
                GameEvent ev;
                try { ev = engine.ValidateMove(evs, room, aiSide, c); }
                catch (ApiBadRequest) { continue; }
                return AppendMove(db, room, engine, evs, ev, aiSide);
            }
            return false; // 全部被拒（理论不达）
        }

        // 引擎未实现枚举（五子棋/军旗等）：Think 给不出着就不盲目 pass（区分「无合法着」vs「没实现 AI」）
        var aiMove = engine.Think(evs, aiSide, room.AiLevel, room);
        if (aiMove is null) return false;

        GameEvent newEvent;
        try { newEvent = engine.ValidateMove(evs, room, aiSide, aiMove.Value); }
        catch (ApiBadRequest) { return false; }

        return AppendMove(db, room, engine, evs, newEvent, aiSide);
    }

    /// <summary>AI 落子 + 判定 + CAS 写库（两分支共用）</summary>
    private static bool AppendMove(AppDbContext db, GameRoom room, IGameEngine engine,
        List<GameEvent> evs, GameEvent newEvent, int aiSide)
    {
        var newEvs = GameEvents.Append(evs, newEvent);
        var (winner, reason, over) = engine.Judge(newEvs, room);

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                .SetProperty(x => x.Turn, over ? room.Turn : engine.NextTurn(aiSide, room))
                .SetProperty(x => x.Status, over ? "finished" : "playing")
                .SetProperty(x => x.Winner, winner)
                .SetProperty(x => x.ResultReason, reason)
                .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now)
                .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));

        db.ChangeTracker.Clear();
        return rows > 0;
    }


    /// <summary>
    /// 黑白棋：当前行棋方无合法着则自动 pass（人类/AI 通用，谁读谁触发）。
    /// AI 分支已含同判定；这里兜住人类回合，避免死锁到超时。
    /// </summary>
    public static bool EnsureAutoPass(AppDbContext db, GameRoom room)
    {
        if (room.Status != "playing" || room.GameKey != "reversi") return false;
        var engine = GameEngines.Get("reversi");
        var evs = GameEvents.Parse(room.MovesJson);
        var legal = engine.AllMoves(evs, room, room.Turn);
        if (legal is null || legal.Count > 0) return false;
        return AppendPass(db, room, room.Turn);
    }

    private static bool AppendPass(AppDbContext db, GameRoom room, int side)
    {
        var evs = GameEvents.Parse(room.MovesJson);
        evs.Add(new GameEvent { t = "pass", s = side });

        var engine = GameEngines.Get(room.GameKey);
        var (winner, reason, over) = engine.Judge(evs, room);

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, GameEvents.Store(evs))
                .SetProperty(x => x.Turn, over ? room.Turn : engine.NextTurn(side, room))
                .SetProperty(x => x.Status, over ? "finished" : "playing")
                .SetProperty(x => x.Winner, winner)
                .SetProperty(x => x.ResultReason, reason)
                .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now)
                .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));

        db.ChangeTracker.Clear();
        return rows > 0;
    }
}
