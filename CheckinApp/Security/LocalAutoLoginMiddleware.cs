using System.Security.Claims;
using CheckinApp.Data;
using CheckinApp.Services;

namespace CheckinApp.Security;

/// <summary>
/// 单机模式的自动登录。
///
/// 位置很关键：必须夹在 UseAuthentication() 之后、UseAuthorization() 之前。
///   · 之前：Cookie 认证刚跑完，我们能确定「确实没登录」再补身份；
///   · 之后：授权马上读 ctx.User，补进去的身份立刻生效。
///
/// 做法是直接给 ctx.User 赋值，不签 Cookie、不写数据库：
///   · 不签 Cookie —— 关掉浏览器不会被「记住」，下次开还是干净地重新注入；
///   · 不写数据库 —— 不产生 LastLoginAt 之类的噪音，也不碰任何业务表。
///
/// 只在 LocalMode.ShouldAutoLogin 放行时动手（开关 + 回环 IP + 本机 Host 三重判断），
/// 所以线上把这段代码放进来也没有任何行为变化。
/// </summary>
public sealed class LocalAutoLoginMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, AppDbContext db)
    {
        // 已经登录（比如之前手动登过）就不覆盖，尊重真实身份
        if (LocalMode.ShouldAutoLogin(ctx) && ctx.User?.Identity?.IsAuthenticated != true)
        {
            var user = db.Users.FirstOrDefault(u => u.Username == LocalMode.AdminUsername);
            if (user is { IsActive: true })
            {
                // Claims 与 Login.cshtml.cs 签发的一致，CurrentUser 只认这三项
                var claims = new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                    new Claim(ClaimTypes.Name, user.Username),
                    new Claim("DisplayName", user.DisplayName),
                };
                ctx.User = new ClaimsPrincipal(
                    new ClaimsIdentity(claims, "LocalAutoLogin"));
            }
        }

        await next(ctx);
    }
}
