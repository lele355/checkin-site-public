using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace CheckinApp.Api;

/// <summary>管理后台：用户 / 角色权限 / 邀请码。三块都要求 admin 权限码。</summary>
public static class AdminApi
{
    public record UserReq(string? Username, string? DisplayName, string? Email, int RoleId, bool IsActive, string? Password);
    public record ResetReq(string? NewPassword);
    public record RoleReq(string? Name, string? Description, string[]? Permissions);
    public record InviteReq(string? Note, int RoleId, int? ValidDays);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/admin");

        // ==================== 用户 ====================
        var us = g.MapGroup("/users").RequireAuthorization("perm:admin.users");

        us.MapGet("", (AppDbContext db, HttpContext ctx) =>
        {
            var meId = ApiKit.MeId(ctx);
            var items = db.Users.Include(u => u.Role).OrderBy(u => u.Id).ToList()
                .Select(u => new
                {
                    id = u.Id, username = u.Username, displayName = u.DisplayName, email = u.Email,
                    roleId = u.RoleId, roleName = u.Role?.Name ?? "-",
                    isActive = u.IsActive, mustChangePassword = u.MustChangePassword,
                    isSelf = u.Id == meId,
                    createdAt = ApiKit.Stamp(u.CreatedAt),
                    lastLoginAt = u.LastLoginAt is null ? "" : ApiKit.Stamp(u.LastLoginAt.Value),
                }).ToList();
            var roles = db.Roles.OrderBy(r => r.Id).Select(r => new { id = r.Id, name = r.Name }).ToList();
            return ApiKit.Ok(new { items, roles });
        });

        us.MapPost("", (UserReq req, AppDbContext db) =>
        {
            var username = ApiKit.Cut(req.Username, 32).ToLowerInvariant();
            if (username.Length < 3) throw new ApiBadRequest("账号至少 3 个字符");
            if (!username.All(c => char.IsLetterOrDigit(c) || c is '_' or '-' or '.'))
                throw new ApiBadRequest("账号只能用字母、数字、下划线、点、横线");
            if (db.Users.Any(u => u.Username == username)) throw new ApiBadRequest("这个账号已经存在了");

            var pwd = req.Password ?? "";
            if (pwd.Length < 8) throw new ApiBadRequest("密码至少 8 位");
            if (!db.Roles.Any(r => r.Id == req.RoleId)) throw new ApiBadRequest("角色不存在");

            var u = new User
            {
                Username = username,
                DisplayName = ApiKit.Cut(req.DisplayName, 20) is { Length: > 0 } n ? n : username,
                Email = ApiKit.Cut(req.Email, 100),
                PasswordHash = PasswordHasher.Hash(pwd),
                RoleId = req.RoleId,
                IsActive = req.IsActive,
                // 管理员设的初始密码必须首登改掉（避免「大家都知道密码」的长期隐患）
                MustChangePassword = true,
                CreatedAt = DateTime.UtcNow,
            };
            db.Users.Add(u);
            db.SaveChanges();
            return ApiKit.Ok(new { id = u.Id });
        });

        us.MapPut("/{id:int}", (int id, UserReq req, AppDbContext db, HttpContext ctx) =>
        {
            var meId = ApiKit.MeId(ctx);
            var u = db.Users.FirstOrDefault(x => x.Id == id) ?? throw new ApiBadRequest("用户不存在");
            if (!db.Roles.Any(r => r.Id == req.RoleId)) throw new ApiBadRequest("角色不存在");

            // 防自锁：不能把自己降权/停用到「没人管得了后台」的程度
            if (u.Id == meId)
            {
                if (!req.IsActive) throw new ApiBadRequest("不能停用自己的账号");
                var newRolePerms = db.RolePermissions.Where(rp => rp.RoleId == req.RoleId)
                    .Select(rp => rp.Permission!.Code).ToList();
                if (!newRolePerms.Contains("admin.users"))
                    throw new ApiBadRequest("不能把自己改成没有「用户管理」权限的角色（会把自己锁在外面）");
            }
            else
            {
                // 停用/降权最后一个管理员同样会锁死后台
                var wasAdmin = db.RolePermissions.Any(rp => rp.RoleId == u.RoleId && rp.Permission!.Code == "admin.users");
                var willAdmin = db.RolePermissions.Any(rp => rp.RoleId == req.RoleId && rp.Permission!.Code == "admin.users");
                if (wasAdmin && (!willAdmin || !req.IsActive))
                {
                    var others = db.Users.Where(x => x.Id != u.Id && x.IsActive)
                        .Any(x => db.RolePermissions.Any(rp => rp.RoleId == x.RoleId && rp.Permission!.Code == "admin.users"));
                    if (!others) throw new ApiBadRequest("这是最后一个有「用户管理」权限的活跃账号，改动后就没人管得了后台了");
                }
            }

            u.DisplayName = ApiKit.Cut(req.DisplayName, 20) is { Length: > 0 } nn ? nn : u.DisplayName;
            u.Email = ApiKit.Cut(req.Email, 100);
            u.RoleId = req.RoleId;
            u.IsActive = req.IsActive;
            db.SaveChanges();
            return ApiKit.Ok(new { id });
        });

        // 重置密码：不传就用随机密码，返回明文一次（管理员当场转告）
        us.MapPost("/{id:int}/reset", (int id, ResetReq req, AppDbContext db, ApiTokenService tokens) =>
        {
            var u = db.Users.FirstOrDefault(x => x.Id == id) ?? throw new ApiBadRequest("用户不存在");
            var pwd = (req.NewPassword ?? "").Trim();
            if (pwd.Length == 0) pwd = RandomPassword();
            if (pwd.Length < 8) throw new ApiBadRequest("密码至少 8 位");

            u.PasswordHash = PasswordHasher.Hash(pwd);
            u.MustChangePassword = true;
            db.SaveChanges();
            tokens.RevokeAll(u.Id);      // 旧设备上的登录态一起作废
            return ApiKit.Ok(new { password = pwd, username = u.Username });
        });

        us.MapDelete("/{id:int}", (int id, AppDbContext db, HttpContext ctx) =>
        {
            var meId = ApiKit.MeId(ctx);
            if (id == meId) return ApiKit.Err("不能删除自己的账号");
            var u = db.Users.FirstOrDefault(x => x.Id == id);
            if (u is null) return ApiKit.NotFound("用户不存在或已删除");

            var others = db.Users.Where(x => x.Id != id && x.IsActive)
                .Any(x => db.RolePermissions.Any(rp => rp.RoleId == x.RoleId && rp.Permission!.Code == "admin.users"));
            var wasAdmin = db.RolePermissions.Any(rp => rp.RoleId == u.RoleId && rp.Permission!.Code == "admin.users");
            if (wasAdmin && !others) return ApiKit.Err("这是最后一个有「用户管理」权限的账号，删了就没人管得了后台了");

            db.Users.Remove(u);     // 所有用户表都是 Cascade，数据一起清
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 角色 ====================
        var rs = g.MapGroup("/roles").RequireAuthorization("perm:admin.roles");

        rs.MapGet("", (AppDbContext db) =>
        {
            var roles = db.Roles.Include(r => r.RolePermissions).OrderBy(r => r.Id).ToList()
                .Select(r => new
                {
                    id = r.Id, name = r.Name, description = r.Description, isBuiltin = r.IsBuiltin,
                    userCount = db.Users.Count(u => u.RoleId == r.Id),
                    permissions = r.RolePermissions.Select(x => x.PermissionId).ToList(),
                    codes = db.RolePermissions.Where(x => x.RoleId == r.Id).Select(x => x.Permission!.Code).ToList(),
                }).ToList();

            var perms = db.Permissions.OrderBy(p => p.Id).ToList()
                .Select(p => new
                {
                    id = p.Id, code = p.Code, module = p.Module, description = p.Description,
                    moduleLabel = PermissionCatalog.ModuleLabels.GetValueOrDefault(p.Module, p.Module),
                }).ToList();

            return ApiKit.Ok(new { roles, permissions = perms });
        });

        rs.MapPost("", (RoleReq req, AppDbContext db) =>
        {
            var name = ApiKit.Cut(req.Name, 20);
            if (name.Length == 0) throw new ApiBadRequest("角色名不能为空");
            if (db.Roles.Any(r => r.Name == name)) throw new ApiBadRequest("同名角色已存在");

            var r = new Role { Name = name, Description = ApiKit.Cut(req.Description, 80), IsBuiltin = false };
            db.Roles.Add(r);
            db.SaveChanges();
            ApplyPerms(db, r.Id, req.Permissions);
            return ApiKit.Ok(new { id = r.Id });
        });

        rs.MapPut("/{id:int}", (int id, RoleReq req, AppDbContext db) =>
        {
            var r = db.Roles.FirstOrDefault(x => x.Id == id) ?? throw new ApiBadRequest("角色不存在");
            if (!r.IsBuiltin)
            {
                var name = ApiKit.Cut(req.Name, 20);
                if (name.Length == 0) throw new ApiBadRequest("角色名不能为空");
                if (db.Roles.Any(x => x.Id != id && x.Name == name)) throw new ApiBadRequest("同名角色已存在");
                r.Name = name;
            }
            r.Description = ApiKit.Cut(req.Description, 80);
            db.SaveChanges();
            ApplyPerms(db, r.Id, req.Permissions);
            return ApiKit.Ok(new { id });
        });

        rs.MapDelete("/{id:int}", (int id, AppDbContext db) =>
        {
            var r = db.Roles.FirstOrDefault(x => x.Id == id) ?? throw new ApiBadRequest("角色不存在");
            if (r.IsBuiltin) return ApiKit.Err("内置角色不能删除");
            if (db.Users.Any(u => u.RoleId == id)) return ApiKit.Err("还有用户在用这个角色，先给他们换角色");
            db.Roles.Remove(r);     // RolePermissions 随之级联
            db.SaveChanges();
            return ApiKit.Ok();
        });

        // ==================== 邀请码 ====================
        var iv = g.MapGroup("/invitations").RequireAuthorization("perm:admin.users");

        iv.MapGet("", (AppDbContext db) =>
        {
            var items = db.Invitations.Include(i => i.Role).Include(i => i.UsedBy)
                .OrderByDescending(i => i.Id).Take(100).ToList()
                .Select(i => new
                {
                    id = i.Id, code = i.Code, note = i.Note,
                    roleId = i.RoleId, roleName = i.Role?.Name ?? "-",
                    createdAt = ApiKit.Stamp(i.CreatedAt),
                    expiresAt = ApiKit.Stamp(i.ExpiresAt),
                    used = i.UsedAt is not null,
                    usedBy = i.UsedBy?.DisplayName ?? "",
                    usedAt = i.UsedAt is null ? "" : ApiKit.Stamp(i.UsedAt.Value),
                    revoked = i.Revoked,
                    expired = i.ExpiresAt <= DateTime.UtcNow,
                    usable = i.UsedAt is null && !i.Revoked && i.ExpiresAt > DateTime.UtcNow,
                }).ToList();
            var roles = db.Roles.OrderBy(r => r.Id).Select(r => new { id = r.Id, name = r.Name }).ToList();
            return ApiKit.Ok(new { items, roles, siteUrl = "https://example.com/Register" });
        });

        iv.MapPost("", (InviteReq req, AppDbContext db, HttpContext ctx) =>
        {
            if (!db.Roles.Any(r => r.Id == req.RoleId)) throw new ApiBadRequest("角色不存在");
            var days = Math.Clamp(req.ValidDays ?? 7, 1, 90);

            var code = NewCode(db);
            var row = new Invitation
            {
                Code = code,
                Note = ApiKit.Cut(req.Note, 40),
                CreatedByUserId = ApiKit.MeId(ctx),
                RoleId = req.RoleId,
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(days),
            };
            db.Invitations.Add(row);
            db.SaveChanges();
            return ApiKit.Ok(new { id = row.Id, code, expiresAt = ApiKit.Stamp(row.ExpiresAt) });
        });

        iv.MapPost("/{id:int}/revoke", (int id, AppDbContext db) =>
        {
            var row = db.Invitations.FirstOrDefault(x => x.Id == id) ?? throw new ApiBadRequest("邀请码不存在");
            if (row.UsedAt is not null) return ApiKit.Err("已经被用掉了，撤销也没用");
            row.Revoked = true;
            db.SaveChanges();
            return ApiKit.Ok();
        });
    }

    // ---------- 私有 ----------
    private static void ApplyPerms(AppDbContext db, int roleId, string[]? codes)
    {
        var existing = db.RolePermissions.Where(rp => rp.RoleId == roleId).ToList();
        db.RolePermissions.RemoveRange(existing);

        if (codes is { Length: > 0 })
        {
            var ids = db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToList();
            foreach (var pid in ids.Distinct())
                db.RolePermissions.Add(new RolePermission { RoleId = roleId, PermissionId = pid });
        }
        db.SaveChanges();
    }

    private static string NewCode(AppDbContext db)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 去掉易混的 I/O/0/1
        var rng = Random.Shared;
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var parts = new string[3];
            for (var p = 0; p < 3; p++)
                parts[p] = new string(Enumerable.Range(0, 4).Select(_ => alphabet[rng.Next(alphabet.Length)]).ToArray());
            var code = string.Join("-", parts);
            if (!db.Invitations.Any(i => i.Code == code)) return code;
        }
        throw new ApiBadRequest("生成邀请码失败，请重试");
    }

    private static string RandomPassword()
    {
        const string chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Range(0, 12).Select(_ => chars[Random.Shared.Next(chars.Length)]).ToArray());
    }
}
