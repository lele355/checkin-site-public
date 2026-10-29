using CheckinApp.Data;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 房间闲置回收 —— 没有任何人在看的房间满 5 分钟就删掉。
///
/// 【判据】「有人在看」以 <c>HostSeenAt</c> / <c>GuestSeenAt</c> 为准：
/// 两端在房间里时会以 1.2 秒轮询、5 秒一次 Touch 刷新它。所以
/// - 等待中的房：房主关掉页面后没人再碰它 → 5 分钟后销毁；
/// - 对局中的房：双方都走了 → 5 分钟后销毁；
/// - 只要还有一个人留在棋盘上（哪怕他在长考），房间就留着 ——
///   长考时他一直在轮询，SeenAt 是新的，不会被误杀。
///
/// 【为什么不开后台 Timer】和 <see cref="GameClock"/> 同一个理由：服务器就 1.7G 内存、
/// 一个 24 小时挂着的 Timer 不划算。谁来读大厅就顺手清一次（懒结算），
/// 大厅本来就是废弃房间唯一会被看见的地方。
/// </summary>
public static class GameSweeper
{
    /// <summary>闲置多少分钟算没人要了</summary>
    public const int IdleMinutes = 5;

    /// <summary>扫掉闲置房间，返回删掉的条数</summary>
    public static int Sweep(AppDbContext db)
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-IdleMinutes);

        // 双方的「最近看过」都早于 cutoff 才算闲置。
        // 没有对手的房只看房主；GuestSeenAt 为 null 也视为没来过。
        var dead = db.GameRooms
            .Where(x => x.Status != "finished"
                        && (x.HostSeenAt == null || x.HostSeenAt < cutoff)
                        && (x.GuestUserId == null
                            ? true
                            : x.GuestSeenAt == null || x.GuestSeenAt < cutoff))
            .ToList();

        if (dead.Count == 0) return 0;
        db.GameRooms.RemoveRange(dead);
        db.SaveChanges();
        return dead.Count;
    }
}
