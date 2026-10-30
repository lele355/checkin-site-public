using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 快照唯一出口 —— 公共信封 + per-game state 组装。
/// 军旗视角过滤在这层（新红线 #24：禁止全量下发再前端遮盖）。
/// </summary>
public static class GameViews
{
    /// <summary>组装一局的全量快照（公共信封 + per-game state）</summary>
    public static object Snap(GameRoom r, int uid)
    {
        var engine = GameEngines.Get(r.GameKey);
        var evs = GameEvents.Parse(r.MovesJson);
        var mySide = MySide(r, uid);
        var isLudo = r.GameKey == "ludo";
        var iAmHost = r.HostUserId == uid;
        var oppSeen = iAmHost ? r.GuestSeenAt : r.HostSeenAt;
        var oppName = iAmHost ? r.Guest?.DisplayName ?? "" : r.Host?.DisplayName ?? "";
        var myName = iAmHost ? r.Host?.DisplayName ?? "" : r.Guest?.DisplayName ?? "";
        var isAi = r.AiLevel > 0 && r.GuestUserId is null;

        var now = DateTime.UtcNow;
        var finished = r.Status == "finished";

        // per-game state
        var state = engine.BuildState(evs, r, mySide, finished);

        // 兼容投影：move 事件的旧格式 [{x,y,s}]（五子棋客户端零改动，下版删）
        var legacyMoves = GameEvents.ToLegacyMoves(evs);
        var lastMove = legacyMoves.Count == 0 ? null : legacyMoves[^1];

        // 飞行棋多人：players[]（每座 side/color/name/isAi/isMe/active/usedMs/online）
        object? players = null;
        if (isLudo)
        {
            var seats = LudoSeats.Get(r);
            players = seats.Select(seat => new
            {
                seat = seat.Seat,
                side = seat.Side,
                color = seat.Color,
                name = seat.IsAi ? "AI" : seat.Name,
                isAi = seat.IsAi,
                isMe = seat.Uid == uid,
                active = seat.Active,
                usedMs = LudoSeats.UsedMsOf(r, seat.Side),
                online = seat.IsAi || (seat.SeenAt is not null && (now - seat.SeenAt.Value).TotalSeconds < 20),
            }).ToList();
        }

        return new
        {
            id = r.Id,
            code = r.Code,
            gameKey = r.GameKey,
            status = r.Status,
            hostSide = r.HostSide,
            hostId = r.HostUserId,
            hostName = r.Host?.DisplayName ?? "",
            guestId = r.GuestUserId ?? 0,
            guestName = isAi ? "AI" : r.Guest?.DisplayName ?? "",
            isAi,
            aiLevel = r.AiLevel,
            turn = r.Turn,
            winner = r.Winner,
            resultReason = r.ResultReason,
            revision = r.Revision,
            moveTimeoutSec = r.MoveTimeoutSec,
            totalTimeoutSec = r.TotalTimeoutSec,
            moveRemainMs = GameClock.MoveRemainMs(r, now),
            myRemainMs = GameClock.RemainMs(r, mySide, now),
            oppRemainMs = isLudo && LudoSeats.Count(r) > 2
                ? (long?)null
                : GameClock.RemainMs(r, mySide == 0 ? 0 : engine.Other(mySide), now),
            hostUsedMs = r.HostUsedMs,
            guestUsedMs = r.GuestUsedMs,
            // 兼容投影（旧客户端读这几个字段）
            moves = legacyMoves.Select(m => new { x = m.x, y = m.y, s = m.s }).ToList(),
            moveCount = legacyMoves.Count,
            lastMove = lastMove is null ? null : new { x = lastMove.x, y = lastMove.y, s = lastMove.s },
            mySide,
            myName,
            opponentName = isAi ? "AI" : oppName,
            opponentOnline = isAi || (oppSeen is not null && (now - oppSeen.Value).TotalSeconds < 20),
            myTurn = r.Status == "playing" && mySide != 0 && r.Turn == mySide,
            canJoin = r.Status == "waiting" && mySide == 0 && (isLudo || (r.GuestUserId is null && r.AiLevel == 0)),
            players,
            state,
            createdAt = ApiKit.StampUtc(r.CreatedAt),
            updatedAt = ApiKit.StampUtc(r.UpdatedAt),
        };
    }

    /// <summary>我在这一局执哪一方（飞行棋按座位 uid 映射；其余 host/guest）</summary>
    public static int MySide(GameRoom r, int uid)
    {
        if (r.GameKey == "ludo")
            return LudoSeats.ByUid(r, uid)?.Side ?? 0;
        return r.HostUserId == uid ? r.HostSide
            : r.GuestUserId == uid ? GameEngines.Get(r.GameKey).Other(r.HostSide)
            : 0;
    }
}
