using System.Collections.Concurrent;

namespace CheckinApp.Services;

/// <summary>
/// 注册提交的「小时配额」（按客户端 IP 计）。
/// 为什么不用 [EnableRateLimiting]：那是全局中间件级策略，拒掉时只能丢一个 429 页面；
/// 而注册需要「还剩几次」「请 X 分钟后再试」这类人话提示，也要能精确只数提交次数（浏览页面不算），
/// 所以自己用一个滑动窗口计数，行为完全可预期。
///
/// 量级：只有几十个 IP 会进来，字典最多几百项，每分钟顺手清一次过期记录即可。
/// </summary>
public class RegisterThrottle(IConfiguration cfg)
{
    // 窗口从「1 小时」收到「1 分钟」：填错邀请码时用户要能马上重试，等一小时太劝退。
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
    private const int HardLimit = 20;   // 配置写错时的兜底上限，防止自己被刷爆

    private readonly ConcurrentDictionary<string, List<DateTime>> _hits = new();
    // 兼容旧键名：老配置里写 RegisterPerHour 也能用，但优先读新键 RegisterPerMinute
    private readonly int _perWindow = Math.Clamp(
        cfg.GetValue("Security:RegisterPerMinute", cfg.GetValue("Security:RegisterPerHour", 3)), 1, HardLimit);
    private DateTime _lastSweep = DateTime.UtcNow;

    public int PerMinute => _perWindow;

    /// <summary>记一次提交；返回 false = 超出配额（调用方给用户看提示，不入库）</summary>
    public bool TryAcquire(string ip)
    {
        var now = DateTime.UtcNow;
        Sweep(now);

        var list = _hits.GetOrAdd(ip, _ => []);
        lock (list)
        {
            list.RemoveAll(t => now - t > Window);
            if (list.Count >= _perWindow) return false;
            list.Add(now);
            return true;
        }
    }

    /// <summary>清掉超过窗口的 IP 记录，防止字典无限增长（游客 IP 会一直变）</summary>
    private void Sweep(DateTime now)
    {
        if (now - _lastSweep < TimeSpan.FromMinutes(1)) return;
        _lastSweep = now;
        foreach (var kv in _hits)
        {
            bool empty;
            lock (kv.Value)
            {
                kv.Value.RemoveAll(t => now - t > Window);
                empty = kv.Value.Count == 0;
            }
            if (empty) _hits.TryRemove(kv.Key, out _);
        }
    }
}
