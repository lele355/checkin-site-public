using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;

namespace CheckinApp.Services;

/// <summary>启动播种：权限清单 → 内置角色 → 角色权限 → 管理员账号。幂等，重复运行安全。</summary>
public static class Seeder
{
    public static void Seed(AppDbContext db)
    {
        // 1) 权限（以代码为准，只增不减）
        var knownCodes = new HashSet<string>();
        foreach (var p in PermissionCatalog.All)
        {
            var perm = db.Permissions.FirstOrDefault(x => x.Code == p.Code);
            if (perm is null)
                db.Permissions.Add(new Permission { Code = p.Code, Module = p.Module, Description = p.Description });
            knownCodes.Add(p.Code);
        }
        db.SaveChanges();

        // 2) 内置角色
        var adminRole = db.Roles.FirstOrDefault(r => r.Name == "管理员");
        if (adminRole is null)
        {
            adminRole = new Role { Name = "管理员", Description = "拥有全部权限", IsBuiltin = true };
            db.Roles.Add(adminRole);
            db.SaveChanges();
        }
        var userRole = db.Roles.FirstOrDefault(r => r.Name == "普通用户");
        if (userRole is null)
        {
            userRole = new Role { Name = "普通用户", Description = "日常功能（日程/备忘等）", IsBuiltin = true };
            db.Roles.Add(userRole);
            db.SaveChanges();
        }
        // 「情侣」内置角色：普通默认包 + 情侣空间 + 经期助手（给伴侣账号用；防自锁同理不可删）
        var coupleRole = db.Roles.FirstOrDefault(r => r.Name == "情侣");
        if (coupleRole is null)
        {
            coupleRole = new Role { Name = "情侣", Description = "普通功能 + 情侣空间 + 经期助手", IsBuiltin = true };
            db.Roles.Add(coupleRole);
            db.SaveChanges();
        }

        // 3) 角色-权限关联
        var allPermIds = db.Permissions.Where(p => knownCodes.Contains(p.Code)).ToList();
        foreach (var pid in allPermIds.Select(p => p.Id))
        {
            if (!db.RolePermissions.Any(rp => rp.RoleId == adminRole.Id && rp.PermissionId == pid))
                db.RolePermissions.Add(new RolePermission { RoleId = adminRole.Id, PermissionId = pid });
        }
        foreach (var code in PermissionCatalog.UserRoleDefaults)
        {
            var perm = allPermIds.FirstOrDefault(p => p.Code == code);
            if (perm is not null && !db.RolePermissions.Any(rp => rp.RoleId == userRole.Id && rp.PermissionId == perm.Id))
                db.RolePermissions.Add(new RolePermission { RoleId = userRole.Id, PermissionId = perm.Id });
        }
        // 情侣角色 = 普通默认包 + 情侣空间 + 经期
        foreach (var code in PermissionCatalog.UserRoleDefaults.Concat(PermissionCatalog.CoupleRoleExtras))
        {
            var perm = allPermIds.FirstOrDefault(p => p.Code == code);
            if (perm is not null && !db.RolePermissions.Any(rp => rp.RoleId == coupleRole.Id && rp.PermissionId == perm.Id))
                db.RolePermissions.Add(new RolePermission { RoleId = coupleRole.Id, PermissionId = perm.Id });
        }
        db.SaveChanges();

        // 4) 管理员账号（无注册页 —— 全站唯一账号由播种产生，其余账号 M2 由管理员后台创建）
        if (!db.Users.Any(u => u.Username == SeedAdmin.Username))
        {
            db.Users.Add(new User
            {
                Username = SeedAdmin.Username,
                PasswordHash = PasswordHasher.Hash(SeedAdmin.Password),
                DisplayName = "管理员",
                RoleId = adminRole.Id,
                IsActive = true,
            });
            db.SaveChanges();
        }
    }
}

/// <summary>
/// 初始管理员账号：从环境变量取，仓库里不放真实账号口令。
/// 部署时请务必设置 CHECKIN_ADMIN_USER / CHECKIN_ADMIN_PW，否则会用下面的占位值（首次登录后请立刻改密）。
/// </summary>
internal static class SeedAdmin
{
    public static string Username => Environment.GetEnvironmentVariable("CHECKIN_ADMIN_USER") ?? "admin";
    public static string Password => Environment.GetEnvironmentVariable("CHECKIN_ADMIN_PW") ?? "ChangeMe!123456";
    public static string DisplayName => "管理员";
}
