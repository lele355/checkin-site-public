using System.Collections.Concurrent;
using CheckinApp.Api;
using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 单机游戏记分 + 排行榜 —— 纯函数/服务，不进 GameRooms。
///
/// 防作弊三件套（弱防，自用小站档）：
///   ① 必须登录 + 权限（鉴权在路由层，这里只认 uid）
///   ② 幂等 max：BestScore = max(旧值, 新值)，分数只增不减，低分永远盖不掉高分
///   ③ 分数上限 GameInfo.MaxScore（超大值 400 拒绝）+ 内存滑动窗口限速（超限 429）
/// 强防（上报事件流重算）P2 不做。
/// </summary>
public static class GameScores
{
    /// <summary>排行榜取前 N 名</summary>
    public const int LeaderboardSize = 10;

    // 内存滑动窗口：uid → 时间戳队列（限速 5 次 / 10s）
    private static readonly ConcurrentDictionary<int, Queue<long>> RateWindows = new();
    private const int RateLimitCount = 5;
    private const int RateLimitWindowMs = 10_000;

    /// <summary>限速检查：滑动窗口内超过 5 次返回 true（超限）</summary>
    public static bool RateLimited(int uid)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var q = RateWindows.GetOrAdd(uid, _ => new Queue<long>());
        lock (q)
        {
            // 清掉窗口外的旧时间戳
            while (q.Count > 0 && now - q.Peek() > RateLimitWindowMs) q.Dequeue();
            if (q.Count >= RateLimitCount) return true;
            q.Enqueue(now);
            return false;
        }
    }

    /// <summary>
    /// 记分（幂等 max + 上限）。返回 {bestScore, rank}。
    /// 调用方先做 RateLimited 检查。
    /// </summary>
    public static (int BestScore, int Rank) Submit(AppDbContext db, int uid, string gameKey, int score)
    {
        var info = GameCatalog.Find(gameKey) ?? throw new ApiBadRequest("没有这个游戏");
        if (!info.Solo) throw new ApiBadRequest("这不是单机游戏");
        if (score < 0 || score > info.MaxScore)
            throw new ApiBadRequest($"分数超限（0～{info.MaxScore}）");

        var now = DateTime.UtcNow;
        var row = db.GameScores.FirstOrDefault(x => x.UserId == uid && x.GameKey == info.Key);
        if (row is null)
        {
            row = new GameScore { UserId = uid, GameKey = info.Key, BestScore = score, UpdatedAt = now };
            db.GameScores.Add(row);
        }
        else if (score > row.BestScore)
        {
            row.BestScore = score;       // 幂等 max：只增不减
            row.UpdatedAt = now;
        }
        db.SaveChanges();

        var rank = db.GameScores.Count(x => x.GameKey == info.Key && x.BestScore > row.BestScore) + 1;
        return (row.BestScore, rank);
    }

    /// <summary>排行榜：前 N 名 + 我的最高分/名次（不在前 N 也回显）</summary>
    public static object Leaderboard(AppDbContext db, string gameKey, int uid)
    {
        var info = GameCatalog.Find(gameKey) ?? throw new ApiBadRequest("没有这个游戏");
        if (!info.Solo) throw new ApiBadRequest("这不是单机游戏");

        var rows = db.GameScores
            .Where(x => x.GameKey == info.Key)
            .Include(x => x.User)
            .OrderByDescending(x => x.BestScore)
            .ThenBy(x => x.UpdatedAt)
            .Take(LeaderboardSize)
            .ToList();

        // 名次（并列同名次）：构造 items
        var items = new List<object>();
        var prevScore = -1;
        var prevRank = 0;
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i].BestScore == prevScore ? prevRank : i + 1;
            items.Add(new
            {
                rank = r,
                name = rows[i].User?.DisplayName ?? "",
                bestScore = rows[i].BestScore,
                updatedAt = ApiKit.StampUtc(rows[i].UpdatedAt),
            });
            prevScore = rows[i].BestScore;
            prevRank = r;
        }

        // 我的最高分 + 名次
        var mine = db.GameScores.FirstOrDefault(x => x.UserId == uid && x.GameKey == info.Key);
        int? myBest = mine?.BestScore;
        int myRank = 0;
        if (mine is not null)
            myRank = db.GameScores.Count(x => x.GameKey == info.Key && x.BestScore > mine.BestScore) + 1;

        return new
        {
            items,
            mine = new { bestScore = myBest ?? 0, rank = myRank },
        };
    }
}
