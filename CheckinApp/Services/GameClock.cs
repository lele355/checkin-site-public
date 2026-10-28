using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 对局计时 —— 单步限时 + 每方总用时。
///
/// 【为什么没有后台定时器】
/// 服务器只有 1.7G 内存，为一个棋类游戏常驻一个 Timer 扫描全表不值当，
/// 而且进程一重启所有定时器就丢了。改成**懒结算**：谁读/写这一局就顺手算一次。
/// 两边本来就在 1.2 秒轮询，所以「超时」最多迟一拍被发现，体感上还是准的。
///
/// 计的是「该走棋的一方」的时间：你没轮到时不计时，也不扣你的总用时。
/// </summary>
public static class GameClock
{
    /// <summary>终局原因之一</summary>
    public const string TimeoutReason = "timeout";

    /// <summary>已经过去多久（毫秒）；没在计时就返回 0</summary>
    public static long ElapsedMs(GameRoom r, DateTime now) =>
        r.Status == "playing" && r.TurnStartedAt is not null
            ? (long)Math.Max(0, (now - r.TurnStartedAt.Value).TotalMilliseconds)
            : 0;

    /// <summary>
    /// 结算超时。判了就落库（finish + winner=对手 + reason=timeout）并返回 true，
    /// 此时传进来的 room 已过期，调用方要重新读。
    /// </summary>
    public static bool Enforce(AppDbContext db, GameRoom room, DateTime? at = null)
    {
        if (room.Status != "playing" || room.TurnStartedAt is null) return false;

        var now = at ?? DateTime.UtcNow;
        var elapsed = ElapsedMs(room, now);
        var loser = room.Turn;                                   // 该走不走的人输
        var used = loser == 1 ? room.HostUsedMs : room.GuestUsedMs;

        var moveOver = room.MoveTimeoutSec > 0 && elapsed > room.MoveTimeoutSec * 1000L;
        var totalOver = room.TotalTimeoutSec > 0 && used + elapsed > room.TotalTimeoutSec * 1000L;
        if (!moveOver && !totalOver) return false;

        var rev = room.Revision;
        var winner = GomokuRules.Other(loser);
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.Status, "finished")
                .SetProperty(x => x.Winner, winner)
                .SetProperty(x => x.ResultReason, TimeoutReason)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now)
                .SetProperty(x => x.FinishedAt, now));

        db.ChangeTracker.Clear();
        return rows > 0;
    }

    /// <summary>某一方的总用时剩余（毫秒）；null = 不限</summary>
    public static long? RemainMs(GameRoom r, int side, DateTime now)
    {
        if (side is not (1 or 2)) return null;
        if (r.TotalTimeoutSec <= 0) return null;
        var used = side == 1 ? r.HostUsedMs : r.GuestUsedMs;
        var running = r.Status == "playing" && r.Turn == side ? ElapsedMs(r, now) : 0;
        return Math.Max(0, r.TotalTimeoutSec * 1000L - used - running);
    }

    /// <summary>单步剩余（毫秒）；null = 不限</summary>
    public static long? MoveRemainMs(GameRoom r, DateTime now)
    {
        if (r.MoveTimeoutSec <= 0) return null;
        if (r.Status != "playing") return null;
        return Math.Max(0, r.MoveTimeoutSec * 1000L - ElapsedMs(r, now));
    }
}
