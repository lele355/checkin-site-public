using CheckinApp.Services;

namespace CheckinApp.Security;

/// <summary>
/// 首登/重置后强制改密码：MustChangePassword=true 时，除白名单路径外全部重定向到 /ChangePassword。
/// 实时查库（SQLite 本地小库，开销可忽略）—— 管理员重置别人密码后，对方刷新即生效，无需重登。
/// </summary>
public class MustChangePasswordMiddleware(RequestDelegate next)
{
    private static readonly string[] WhitelistPrefixes =
        ["/login", "/changepassword", "/logout", "/preferences", "/css/", "/js/", "/lib/", "/favicon"];

    public async Task InvokeAsync(HttpContext ctx, IServiceScopeFactory scopeFactory)
    {
        var path = (ctx.Request.Path.Value ?? "").ToLowerInvariant();

        if (ctx.User.Identity?.IsAuthenticated == true
            && !WhitelistPrefixes.Any(p => path.StartsWith(p)))
        {
            using var scope = scopeFactory.CreateScope();
            var me = scope.ServiceProvider.GetRequiredService<CurrentUser>();
            if (me.MustChangePassword)
            {
                ctx.Response.Redirect("/ChangePassword");
                return;
            }
        }

        await next(ctx);
    }
}
