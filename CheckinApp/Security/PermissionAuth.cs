using CheckinApp.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Security;

/// <summary>授权需求：持有指定权限码。策略名格式 perm:模块.动作。</summary>
public class PermissionRequirement(string code) : IAuthorizationRequirement
{
    public string Code { get; } = code;
}

/// <summary>策略提供器：把 "perm:xxx" 动态翻译成策略，页面用 [Authorize(Policy="perm:admin.users")] 即可。</summary>
public class PermissionPolicyProvider : IAuthorizationPolicyProvider
{
    private const string Prefix = "perm:";
    private readonly AuthorizationOptions _options;

    public PermissionPolicyProvider(Microsoft.Extensions.Options.IOptions<AuthorizationOptions> options)
        => _options = options.Value;

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (policyName.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
        {
            var policy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .AddRequirements(new PermissionRequirement(policyName[Prefix.Length..]))
                .Build();
            return Task.FromResult<AuthorizationPolicy?>(policy);
        }
        return Task.FromResult<AuthorizationPolicy?>(null);
    }

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync()
        => Task.FromResult(_options.DefaultPolicy);

    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync()
        => Task.FromResult<AuthorizationPolicy?>(_options.FallbackPolicy);
}

/// <summary>
/// 权限裁决器：实时查库（SQLite 小站开销可忽略），角色权限改动即时生效，不依赖 Cookie 里的陈旧快照。
/// </summary>
public class PermissionAuthorizationHandler(AppDbContext db) : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var idRaw = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId)) return;

        var has = await db.Users
            .Where(u => u.Id == userId && u.IsActive)
            .SelectMany(u => u.Role!.RolePermissions)
            .Select(rp => rp.Permission!.Code)
            .AnyAsync(c => c == requirement.Code);

        if (has) context.Succeed(requirement);
    }
}
