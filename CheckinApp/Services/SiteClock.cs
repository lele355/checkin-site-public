using System.Globalization;

namespace CheckinApp.Services;

/// <summary>
/// 全站统一时钟 —— 「今天是哪天 / 现在几点」的唯一来源。
///
/// 【为什么需要它】
/// 这台服务器跑在云上，容器默认是 UTC。业务里到处是
/// <c>DateTime.Now</c> / <c>DateTime.Today</c>，一旦进程时区是 UTC，
/// 北京时间早上 8 点之前，服务器认为还是「昨天」：
///   打卡会记到昨天、日程的「今天」分组整组错位、
///   纪念日倒计时多一天、经期预测偏移一天。
/// 而且 <c>ToString("dddd")</c> 的输出跟着线程文化走，
/// 容器里没有 zh-CN 时中文星期会变成 Sunday。
///
/// 【做法】
/// <see cref="Init"/> 在应用启动最早期调用一次：
///   ① 把进程时区钉到 Asia/Shanghai（.NET 的 DateTime.Now 随后就返回北京时间）
///   ② 把默认文化钉到 zh-CN（中文星期、中文日期格式一次到位）
/// 因为改的是进程级默认值，业务代码里原有的 DateTime.Now 全部自动变正确，
/// 不需要去 164 个调用点逐个替换 —— 那种改法改漏一处就是一个隐蔽 bug。
///
/// 【新代码写什么】
/// 需要「现在/今天」时优先用 SiteClock.Now / SiteClock.Today，
/// 语义比裸 DateTime.Now 明确，也方便以后改成按用户时区算。
/// 写数据库的时间戳继续用 <c>DateTime.UtcNow</c>（存 UTC，显示时转本地）。
/// </summary>
public static class SiteClock
{
    /// <summary>业务时区。当前用户都在国内，钉死东八区。</summary>
    public static readonly TimeZoneInfo Zone = FindZone();

    /// <summary>启动即调用（Program.cs 最前面）。可重复调用，幂等。</summary>
    public static void Init()
    {
        // ① 进程时区：Linux 读 TZ 环境变量；Windows 上 .NET 6+ 同样认这个变量
        try
        {
            Environment.SetEnvironmentVariable("TZ", "Asia/Shanghai");
            TimeZoneInfo.ClearCachedData();          // 清掉可能已缓存的 UTC → 重新解析
        }
        catch
        {
            // 个别受限容器禁用环境变量写入；此时退化为注册表/系统时区，不致命
        }

        // ② 默认文化：中文星期 / 中文日期格式
        try
        {
            var cn = new CultureInfo("zh-CN");
            CultureInfo.DefaultThreadCurrentCulture = cn;
            CultureInfo.DefaultThreadCurrentUICulture = cn;
            CultureInfo.CurrentCulture = cn;
            CultureInfo.CurrentUICulture = cn;
        }
        catch
        {
            // 极小概率缺少 ICU 数据；此时日期仍能用 yyyy-MM-dd 这类纯数字格式
        }
    }

    private static TimeZoneInfo FindZone()
    {
        // IANA 名优先（Linux），失败退 Windows 名，再退系统本地时区
        foreach (var id in new[] { "Asia/Shanghai", "China Standard Time", "Asia/Chongqing" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch { /* 换下一个 */ }
        }
        return TimeZoneInfo.Local;
    }

    /// <summary>此刻（业务时区的墙钟时间）</summary>
    public static DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone);

    /// <summary>今天（零点，业务时区）</summary>
    public static DateTime Today => Now.Date;

    /// <summary>UTC 时间戳 → 业务时区墙钟时间</summary>
    public static DateTime ToLocal(DateTime utc) =>
        utc.Kind == DateTimeKind.Local ? utc
        : TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone);

    /// <summary>「2026-10-26」—— 给 input[type=date] 的默认值用</summary>
    public static string IsoToday => Today.ToString("yyyy-MM-dd");

    /// <summary>「周一」—— 不依赖线程文化，避免容器里输出 Sunday</summary>
    public static string WeekdayCn(DateTime d) => d.DayOfWeek switch
    {
        DayOfWeek.Monday => "周一",
        DayOfWeek.Tuesday => "周二",
        DayOfWeek.Wednesday => "周三",
        DayOfWeek.Thursday => "周四",
        DayOfWeek.Friday => "周五",
        DayOfWeek.Saturday => "周六",
        _ => "周日",
    };

    /// <summary>「10月26日 周一」</summary>
    public static string MonthDayWeek(DateTime d) => $"{d:M月d日} {WeekdayCn(d)}";
}
