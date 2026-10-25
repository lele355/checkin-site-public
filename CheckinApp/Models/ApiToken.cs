namespace CheckinApp.Models;

/// <summary>
/// App 接口令牌 —— 给「本地打包的 App 前端」用的长期凭证。
///
/// 为什么不复用登录 Cookie：App 的页面源是 <c>https://localhost</c>（Capacitor 本地资源），
/// 请求打到 <c>https://example.com</c> 属于跨站，SameSite=Lax 的认证 Cookie 根本不会带上；
/// 就算改成 SameSite=None 也要全程 https + Secure，还平白多一个 CSRF 面。
/// 所以 App 侧一律走 Authorization: Bearer，跟网站 Cookie 认证并行、互不干扰。
///
/// 库里只存 SHA-256 哈希（跟密码一个道理）：数据库泄露也拿不到可用的令牌。
/// </summary>
public class ApiToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>SHA-256(明文token) 的十六进制小写</summary>
    public required string TokenHash { get; set; }
    /// <summary>设备标识（登录时带上，便于将来「踢掉某台设备」）</summary>
    public string Device { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddDays(180);
    public DateTime? LastUsedAt { get; set; }
    /// <summary>主动登出 / 改密后作废</summary>
    public bool Revoked { get; set; }
}
