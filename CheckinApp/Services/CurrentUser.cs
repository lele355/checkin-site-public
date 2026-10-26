using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace CheckinApp.Services;

/// <summary>
/// 当前用户上下文（同步实现 —— SQLite 本地小库，同步查询开销可忽略；布局页可直接用）。
/// 权限实时查库：M2 改角色权限后立即生效，无需重登。
/// </summary>
public class CurrentUser(IHttpContextAccessor accessor, AppDbContext db)
{
    private int? _userId;
    private User? _user;
    private List<string>? _permCache;

    public int? UserId => _userId ??= int.TryParse(
        accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier), out var v) ? v : null;

    public bool IsAuthenticated => UserId is not null;

    /// <summary>登录名（Claims 里的 Name）。本机账号簿要用它来认人，不能拿 DisplayName 代替——
    /// 昵称可改、可重复，登录名才是稳定的那一把钥匙。</summary>
    public string Username => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.Name) ?? "";

    public string DisplayName
    {
        get
        {
            EnsureUser();
            return _user?.DisplayName ?? "访客";
        }
    }

    public string RoleName
    {
        get
        {
            EnsureUser();
            return _user?.Role?.Name ?? "-";
        }
    }

    /// <summary>外观偏好（服务端兜底；本机 localStorage 优先）。白名单校验，脏值一律回落默认。</summary>
    private static readonly HashSet<string> AllowedThemes =
        ["editorial", "neumorphism", "natural", "macos", "clay"];
    private static readonly HashSet<string> AllowedAccents =
        ["", "violet", "coral", "mint", "lemon", "blue", "rose", "green", "pink", "lilac"];
    private static readonly HashSet<string> AllowedTones =
        ["", "mist", "rose", "wheat", "blue", "mint", "clay", "leaf", "midnight", "plum", "forest", "lilac", "lemon",
                       "sage", "sand", "stone", "coffee", "slate", "sky", "blush"];

    public string Theme
    {
        get
        {
            EnsureUser();
            var t = _user?.Theme ?? "editorial";
            return AllowedThemes.Contains(t) ? t : "editorial";
        }
    }

    public string Accent
    {
        get
        {
            EnsureUser();
            var a = _user?.Accent ?? "";
            return AllowedAccents.Contains(a) ? a : "";
        }
    }

    /// <summary>底色系（data-tone）：空 = 该主题默认底色</summary>
    public string Tone
    {
        get
        {
            EnsureUser();
            var tn = _user?.Tone ?? "";
            return AllowedTones.Contains(tn) ? tn : "";
        }
    }

    /// <summary>首登/重置后强制改密码标志（实时查库）</summary>
    public bool MustChangePassword
    {
        get
        {
            EnsureUser();
            return _user?.MustChangePassword ?? false;
        }
    }

    public List<string> PermissionCodes()
    {
        if (_permCache is not null) return _permCache;
        if (!IsAuthenticated) return _permCache = [];
        EnsureUser();
        return _permCache = db.RolePermissions
            .Where(rp => rp.RoleId == _user!.RoleId)
            .Select(rp => rp.Permission!.Code)
            .ToList();
    }

    public bool Has(string permCode) => PermissionCodes().Contains(permCode);

    /// <summary>当前用户有权限看到的全部导航（不看「隐藏」偏好）</summary>
    public List<NavItem> AllNavItems()
    {
        var perms = new HashSet<string>(PermissionCodes());
        return NavCatalog.Items.Where(n => n.Enabled && perms.Contains(n.Permission)).ToList();
    }

    /// <summary>当前用户可见导航：启用中 + 有权限 + 没被自己收起来（无权限/已隐藏的项连 HTML 都不输出）</summary>
    public List<NavItem> NavItems()
    {
        var all = AllNavItems();
        var hidden = HiddenNavCodes;
        return hidden.Count == 0 ? all : all.Where(n => !hidden.Contains(n.Code)).ToList();
    }

    /// <summary>用户自己隐藏掉的导航项 code 集合（Users.NavHidden 存 JSON 数组；脏数据当没隐藏）</summary>
    public HashSet<string> HiddenNavCodes
    {
        get
        {
            EnsureUser();
            if (_user is null || string.IsNullOrWhiteSpace(_user.NavHidden)) return [];
            try
            {
                var list = JsonSerializer.Deserialize<List<string>>(_user.NavHidden);
                return list is null ? [] : list.ToHashSet();
            }
            catch (JsonException) { return []; }   // 手改坏的 JSON 不让整页 500
        }
    }

    private void EnsureUser()
    {
        if (_user is not null || !IsAuthenticated) return;
        _user = db.Users.Include(u => u.Role).FirstOrDefault(u => u.Id == UserId);
    }
}
