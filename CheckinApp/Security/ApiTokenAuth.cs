using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace CheckinApp.Security;

/// <summary>
/// App 令牌的签发 / 校验 / 吊销。
/// 明文只在下发那一刻存在（前端存进 Capacitor Preferences），库里永远只有哈希。
/// </summary>
public class ApiTokenService(AppDbContext db)
{
    private const string Prefix = "ck1_";

    /// <summary>签发一枚新令牌（同一设备重复登录不清理旧的，方便多端并存；过期由 ExpiresAt 兜）。</summary>
    public (string Token, ApiToken Row) Issue(int userId, string device, int days = 180)
    {
        var raw = Prefix + WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var row = new ApiToken
        {
            UserId = userId,
            TokenHash = Hash(raw),
            Device = Cut(device, 80),
            ExpiresAt = DateTime.UtcNow.AddDays(days),
        };
        db.ApiTokens.Add(row);
        db.SaveChanges();
        return (raw, row);
    }

    /// <summary>校验明文令牌；有效则返回对应行（顺带刷新 LastUsedAt，最多 1 分钟写一次库）。</summary>
    public ApiToken? Validate(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || !raw.StartsWith(Prefix, StringComparison.Ordinal)) return null;
        var hash = Hash(raw);
        var row = db.ApiTokens.Include(t => t.User).FirstOrDefault(t => t.TokenHash == hash);
        if (row is null || row.Revoked) return null;
        if (row.ExpiresAt <= DateTime.UtcNow) return null;
        if (row.User is null || !row.User.IsActive) return null;

        if (row.LastUsedAt is null || (DateTime.UtcNow - row.LastUsedAt.Value).TotalMinutes >= 1)
        {
            row.LastUsedAt = DateTime.UtcNow;
            db.SaveChanges();
        }
        return row;
    }

    /// <summary>按明文吊销（登出用）。</summary>
    public void Revoke(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return;
        var hash = Hash(raw);
        var row = db.ApiTokens.FirstOrDefault(t => t.TokenHash == hash);
        if (row is null) return;
        row.Revoked = true;
        db.SaveChanges();
    }

    /// <summary>改密 / 停用后，把该用户除当前这枚外的令牌全清掉。</summary>
    public void RevokeAll(int userId, int exceptId = 0)
    {
        foreach (var t in db.ApiTokens.Where(t => t.UserId == userId && !t.Revoked && t.Id != exceptId))
            t.Revoked = true;
        db.SaveChanges();
    }

    private static string Hash(string raw) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

    private static string Cut(string s, int n) => s.Length <= n ? s : s[..n];
}

/// <summary>
/// Bearer 令牌中间件：只对 /api 开头的请求生效，且仅在 Cookie 认证没认出人时才尝试。
/// 放在 UseAuthentication 之后、UseAuthorization 之前 —— 授权读的是 ctx.User。
/// </summary>
public class ApiTokenMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, ApiTokenService tokens)
    {
        if (ctx.Request.Path.StartsWithSegments("/api") && ctx.User.Identity?.IsAuthenticated != true)
        {
            var header = ctx.Request.Headers.Authorization.ToString();
            if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var raw = header[7..].Trim();
                var row = tokens.Validate(raw);
                if (row is not null)
                {
                    var claims = new List<Claim>
                    {
                        new(ClaimTypes.NameIdentifier, row.UserId.ToString()),
                        new(ClaimTypes.Name, row.User!.Username),
                        new("token_id", row.Id.ToString()),
                    };
                    var identity = new ClaimsIdentity(claims, "ApiToken");
                    ctx.User = new ClaimsPrincipal(identity);
                }
            }
        }
        await next(ctx);
    }
}

/// <summary>当前请求携带的令牌明文（只用于登出时吊销自己这枚，不进日志）。</summary>
public static class ApiTokenAccessor
{
    public static string? RawToken(HttpContext ctx)
    {
        var h = ctx.Request.Headers.Authorization.ToString();
        return h.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? h[7..].Trim() : null;
    }
}
