using System.Net;

namespace CheckinApp.Services;

/// <summary>
/// 「单机部署」模式开关。
///
/// 干什么：
///   把整套站点当成本机应用跑（双击启动器 → 浏览器打开 → 直接进工作台），
///   不再要求登录，也不需要域名/证书/反向代理。
///
/// 为什么单独抽一个静态类：
///   · 中间件要读它，走 DI 会很别扭；
///   · 只在启动时 Init 一次，之后只读，没有并发写的问题。
///
/// 安全边界（三重，缺一不可）：
///   1. 必须显式打开 —— 环境变量 CHECKIN_LOCAL=1 或配置 Local:Enabled=true；
///   2. 客户端必须是回环地址（127.0.0.1 / ::1）；
///   3. 请求 Host 必须是 localhost / 127.0.0.1。
///   线上即使有人误设了环境变量，Host 是 example.com，条件 3 不成立 → 不会免登录。
///   换句话说，这个「后门」在公网域名上永远打不开。
///
/// 历史：2026-10-22 PyLab 模块整块删除后，这里原本的「只留教学四项 / 只留 PyLab」
/// 两个收窄开关也一并去掉了 —— 它们唯一的用途是把侧栏换成 PyLab 的四个入口。
/// </summary>
public static class LocalMode
{
    /// <summary>是否处于单机模式。默认 false，线上不受影响。</summary>
    public static bool Enabled { get; private set; }

    /// <summary>自动登录用哪个账号（默认播种出来的管理员）。</summary>
    public static string AdminUsername { get; private set; } = "admin";

    public static void Init(IConfiguration cfg)
    {
        var flag = Environment.GetEnvironmentVariable("CHECKIN_LOCAL");
        Enabled = string.Equals(flag, "1", StringComparison.Ordinal)
               || string.Equals(flag, "true", StringComparison.OrdinalIgnoreCase)
               || cfg.GetValue<bool>("Local:Enabled");

        var u = cfg["Local:AdminUsername"];
        if (!string.IsNullOrWhiteSpace(u)) AdminUsername = u.Trim();
    }

    /// <summary>客户端 IP 是否为回环。</summary>
    public static bool IsLoopback(IPAddress? ip) =>
        ip is not null && (IPAddress.IsLoopback(ip));

    /// <summary>请求的 Host 是否是本机名（挡住反代转发进来的公网域名）。</summary>
    private static bool IsLocalHost(HostString host)
    {
        var h = host.Host;
        return h.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || h == "127.0.0.1"
            || h == "::1"
            || h == "[::1]";
    }

    /// <summary>本次请求是否应该自动放行为管理员。</summary>
    public static bool ShouldAutoLogin(HttpContext ctx) =>
        Enabled
        && IsLoopback(ctx.Connection.RemoteIpAddress)
        && IsLocalHost(ctx.Request.Host);
}
