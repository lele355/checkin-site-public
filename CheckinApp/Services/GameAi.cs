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
///
/// 飞行棋多座：当前 Turn 的 AI 座按「roll → move/pass」两阶段推进，每轮询推一步。
/// </summary>
public static class GameAi
{
    /// <summary>判断是否轮到 AI（用于 GameClock.Enforce 跳过 AI 超时）</summary>
    public static bool IsAiTurn(GameRoom r)
    {
        if (r.Status != "playing") return false;
        if (r.GameKey == "ludo")
        {
            var seat = LudoSeats.BySide(r, r.Turn);
            return seat is { IsAi: true, Active: true };
        }
        return r.AiLevel > 0 && r.GuestUserId is null && r.Turn != r.HostSide;
    }

    /// <summary>确保 AI 该走的棋已经走了。谁轮询谁触发。返回 true = 生成了事件（调用方要重读）。</summary>
    public static bool EnsureMove(AppDbContext db, GameRoom room)
    {
        if (room.Status != "playing") return false;
        if (room.GameKey == "ludo") return EnsureMoveLudo(db, room);

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

    /// <summary>飞行棋多座 AI：当前 Turn 的 AI 座按 roll → move/pass 两阶段推进，每轮询一步</summary>
    private static bool EnsureMoveLudo(AppDbContext db, GameRoom room)
    {
        var aiSide = room.Turn;
        var seat = LudoSeats.BySide(room, aiSide);
        if (seat is null || !seat.IsAi || !seat.Active) return false;

        if (room.TurnStartedAt is not null)
        {
            var elapsed = (DateTime.UtcNow - room.TurnStartedAt.Value).TotalMilliseconds;
            var thinkDelay = 400 + Random.Shared.Next(0, 600);
            if (elapsed < thinkDelay) return false;
        }

        var evs = GameEvents.Parse(room.MovesJson);
        var engine = GameEngines.Get("ludo");
        var rev = room.Revision;
        var now = DateTime.UtcNow;

        // 本座这一轮是否已掷未走（roll 后没有 move/pass）
        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == aiSide);
        var rolledThisTurn = lastRoll is not null
            && !evs.SkipWhile(e => e != lastRoll).Skip(1).Any(e => (e.t == "move" || e.t == "pass") && e.s == aiSide);

        if (!rolledThisTurn)
        {
            // 阶段 1：掷骰（Turn 不变，同座继续走；三连六 → 罚子 + 换人一并 CAS）
            var rollEvent = LudoRules.ValidateRoll(evs, room, aiSide);
            var newEvs = GameEvents.Append(evs, rollEvent);
            var penalty = LudoRules.PendingPenalty(newEvs, aiSide);
            if (penalty != null)
            {
                newEvs.Add(penalty);
                var (wP, rP, oP) = engine.Judge(newEvs, room);
                var rowsP = db.GameRooms
                    .Where(x => x.Id == room.Id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                        .SetProperty(x => x.Turn, oP ? room.Turn : LudoSeats.NextActive(room, aiSide))
                        .SetProperty(x => x.Status, oP ? "finished" : "playing")
                        .SetProperty(x => x.Winner, wP)
                        .SetProperty(x => x.ResultReason, rP)
                        .SetProperty(x => x.TurnStartedAt, oP ? room.TurnStartedAt : (DateTime?)now)
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now)
                        .SetProperty(x => x.FinishedAt, oP ? now : room.FinishedAt));
                db.ChangeTracker.Clear();
                return rowsP > 0;
            }
            var rowsR = db.GameRooms
                .Where(x => x.Id == room.Id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now));
            db.ChangeTracker.Clear();
            return rowsR > 0;
        }

        // 阶段 2：走子或 pass
        List<GameEvent> finalEvs;
        var didMove = false;
        var think = LudoRules.Think(evs, aiSide, room.AiLevel, room);
        if (think is not null)
        {
            try
            {
                var mv = engine.ValidateMove(evs, room, aiSide, think.Value);
                finalEvs = GameEvents.Append(evs, mv);
                didMove = true;
            }
            catch (ApiBadRequest)
            {
                finalEvs = GameEvents.Append(evs, new GameEvent { t = "pass", s = aiSide });
            }
        }
        else
        {
            finalEvs = GameEvents.Append(evs, new GameEvent { t = "pass", s = aiSide });
        }

        var (winner, reason, over) = engine.Judge(finalEvs, room);
        // 掷 6 且实际走了子 → 额外回合（三连六已在掷骰阶段罚换人，封顶逻辑已删）；pass 不享额外回合
        var keepTurn = !over && didMove && LudoRules.GrantsExtraTurn(finalEvs, aiSide);
        var nextTurn = over ? room.Turn : (keepTurn ? aiSide : LudoSeats.NextActive(room, aiSide));

        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, GameEvents.Store(finalEvs))
                .SetProperty(x => x.Turn, nextTurn)
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
