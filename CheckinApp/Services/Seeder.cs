using System.Security.Cryptography;
using System.Text;
using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;

namespace CheckinApp.Services;

/// <summary>启动播种：权限清单 → 内置角色 → 角色权限 → 管理员账号。幂等，重复运行安全。</summary>
public static class Seeder
{
    /// <summary>初始管理员用户名。密码不在代码里，见 <see cref="Seed"/> 的 adminPassword 参数。</summary>
    public const string AdminUsername = "admin";

    /// <param name="adminPassword">
    /// 初始管理员密码，来自配置 <c>Seed:AdminPassword</c>（写进 appsettings.Local.json 或环境变量
    /// <c>Seed__AdminPassword</c>，两者都不进仓库）。为空时随机生成一份并落盘到
    /// <c>data/initial-admin-password.txt</c>，只在库还没有管理员时生效。
    /// </param>
    public static void Seed(AppDbContext db, string? adminPassword = null)
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
        if (!db.Users.Any(u => u.Username == AdminUsername))
        {
            if (string.IsNullOrWhiteSpace(adminPassword))
            {
                adminPassword = GeneratePassword();
                WriteInitialPasswordNote(adminPassword);
            }

            db.Users.Add(new User
            {
                Username = AdminUsername,
                PasswordHash = PasswordHasher.Hash(adminPassword),
                DisplayName = "管理员",
                RoleId = adminRole.Id,
                IsActive = true,
            });
            db.SaveChanges();
        }
    }

    /// <summary>凭据未配置时生成一次性随机密码：读起来不费劲，仍足够长（16 位，约 79 bit）。</summary>
    private static string GeneratePassword()
    {
        // 去掉了 0/O/1/l/I 这类看着一样的字符，印出来手抄不会错
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        var bytes = RandomNumberGenerator.GetBytes(16);
        var sb = new StringBuilder(16);
        foreach (var b in bytes) sb.Append(alphabet[b % alphabet.Length]);
        return sb.ToString();
    }

    private static void WriteInitialPasswordNote(string password)
    {
        try
        {
            Directory.CreateDirectory("data");
            var path = Path.Combine("data", "initial-admin-password.txt");
            // 原始字符串用 $$ 前缀：插值写 {{}}，这样正文里的 JSON 大括号可以原样出现
            File.WriteAllText(path,
                $$"""
                 初始管理员密码（首次启动自动生成）
                 用户名：{{AdminUsername}}
                 密码：  {{password}}

                 用这个账号登录后请立刻在「我的 → 修改密码」里改掉，然后删除本文件。
                 想自己指定初始密码，就在 appsettings.Local.json 里写：
                   "Seed": { "AdminPassword": "你的密码" }
                 或设置环境变量 Seed__AdminPassword。
                 """);
        }
        catch
        {
            // 写不了盘也不能让启动失败，密码仍可在当天日志之外通过重置流程找回
        }
    }
}

/// <summary>
/// 初始管理员的展示名。账号名见 Seeder.AdminUsername，口令走配置 Seed:AdminPassword，
/// 两者都不在源码里写死。
/// </summary>
internal static class SeedAdmin
{
    public static string DisplayName => "管理员";
}
