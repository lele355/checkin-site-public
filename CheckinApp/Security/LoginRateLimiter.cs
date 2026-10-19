using System.Collections.Concurrent;

namespace CheckinApp.Security;

/// <summary>登录限速器：同账号+同 IP 每分钟失败 5 次 → 锁 10 分钟（进程内存实现，重启清零，小站够用）。</summary>
public class LoginRateLimiter
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Lockout = TimeSpan.FromMinutes(10);

    private readonly ConcurrentDictionary<string, Entry> _attempts = new();
    private readonly object _lock = new();

    private record Entry(int Count, DateTime First, DateTime? LockedUntil);

    private static string Key(string username, string ip) => $"{username.ToLowerInvariant()}|{ip}";

    public bool IsLocked(string username, string ip)
    {
        if (_attempts.TryGetValue(Key(username, ip), out var e) && e.LockedUntil is { } until)
        {
            if (DateTime.UtcNow < until) return true;
            lock (_lock) { _attempts.TryRemove(Key(username, ip), out _); }
        }
        return false;
    }

    public void RecordFailure(string username, string ip)
    {
        lock (_lock)
        {
            var key = Key(username, ip);
            var now = DateTime.UtcNow;
            var e = _attempts.GetOrAdd(key, new Entry(0, now, null));

            if (now - e.First > Window) e = e with { Count = 0, First = now, LockedUntil = null };
            e = e with { Count = e.Count + 1 };

            if (e.Count >= MaxFailures) e = e with { LockedUntil = now.Add(Lockout) };
            _attempts[key] = e;
        }
    }

    public void Reset(string username, string ip)
        => _attempts.TryRemove(Key(username, ip), out _);

    /// <summary>还可尝试次数（锁定中返回 0）。用于登录页提示，不泄露账号存在性（计数与账号是否存在无关）。</summary>
    public int GetRemaining(string username, string ip)
    {
        if (IsLocked(username, ip)) return 0;
        if (_attempts.TryGetValue(Key(username, ip), out var e))
        {
            if (DateTime.UtcNow - e.First > Window) return MaxFailures;   // 窗口过期视为清零
            return Math.Max(0, MaxFailures - e.Count);
        }
        return MaxFailures;
    }

    /// <summary>锁定剩余分钟数（未锁定返回 null）。</summary>
    public int? GetLockMinutes(string username, string ip)
    {
        if (_attempts.TryGetValue(Key(username, ip), out var e) && e.LockedUntil is { } until)
        {
            if (DateTime.UtcNow < until) return (int)Math.Ceiling((until - DateTime.UtcNow).TotalMinutes);
        }
        return null;
    }
}
