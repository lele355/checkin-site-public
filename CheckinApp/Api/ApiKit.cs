using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;

namespace CheckinApp.Api;

/// <summary>
/// App 接口（/api/v1）的公共小工具：统一响应包、日期格式、参数解析、越权围栏。
/// 约定：所有时间一律以「无时区的本地时间字符串」下发（yyyy-MM-dd / yyyy-MM-ddTHH:mm），
/// 前端 new Date('2026-10-23T09:00') 会按本地时区解析 —— 与用户输入语义完全一致，不踩 UTC 偏移。
/// </summary>
internal static class ApiKit
{
    // ---------- 响应 ----------
    public static IResult Ok(object? data = null) => Results.Json(new { ok = true, data });

    public static IResult Err(string message, int status = 400)
        => Results.Json(new { ok = false, error = message }, statusCode: status);

    public static IResult Unauthorized(string message = "请先登录")
        => Results.Json(new { ok = false, error = message }, statusCode: 401);

    public static IResult Forbidden(string message = "没有权限")
        => Results.Json(new { ok = false, error = message }, statusCode: 403);

    public static IResult NotFound(string message = "不存在或已被删除")
        => Results.Json(new { ok = false, error = message }, statusCode: 404);

    // ---------- 时间 ----------
    public static string D(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static string? DN(DateTime? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static string T(DateTime d) => d.ToString("yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture);
    public static string? TN(DateTime? d) => d?.ToString("yyyy-MM-ddTHH:mm", CultureInfo.InvariantCulture);
    public static string Stamp(DateTime d) => d.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);

    /// <summary>"2026-10-23" / "2026-10-23T09:30" / ISO 带 Z 都能吃。
    /// 带 Z 的按 UTC 转本地；不带时区的当本地墙钟时间（与用户输入的语义一致）。</summary>
    public static DateTime? ParseDT(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var d))
            return d.Kind == DateTimeKind.Utc ? d.ToLocalTime() : d;
        return DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, out var dto) ? dto.LocalDateTime : null;
    }

    public static DateTime ParseDTOr(string? s, DateTime fallback) => ParseDT(s) ?? fallback;

    /// <summary>只取日期部分（打卡、日期的日期语义）。</summary>
    public static DateTime? ParseDate(string? s) => ParseDT(s) is { } d ? d.Date : null;

    // ---------- 参数 ----------
    public static int MeId(HttpContext ctx)
    {
        var raw = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(raw, out var id) ? id : 0;
    }

    public static int IntQ(HttpContext ctx, string name, int fallback)
        => int.TryParse(ctx.Request.Query[name], out var v) ? v : fallback;

    public static string StrQ(HttpContext ctx, string name, string fallback = "")
        => ctx.Request.Query[name].ToString() is { Length: > 0 } s ? s : fallback;

    // ---------- 文本清洗 ----------
    public static string Cut(string? s, int max) => (s ?? "").Trim() is var t && t.Length > max ? t[..max] : (s ?? "").Trim();

    public static string Req(string? s, string field, int max = 200)
    {
        var t = Cut(s, max);
        if (t.Length == 0) throw new ApiBadRequest($"{field}不能为空");
        return t;
    }

    // ---------- 工作台布局 JSON ----------
    public static object? ParseLayout(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<JsonElement>(json); }
        catch (JsonException) { return null; }
    }
}

/// <summary>业务校验失败 —— 由 ApiExceptionMiddleware 统一翻成 400 + 中文提示。</summary>
public class ApiBadRequest(string message) : Exception(message);

/// <summary>把 ApiBadRequest 变成 JSON 400，别让前端收到一大坨开发者异常页。</summary>
public class ApiExceptionMiddleware(RequestDelegate next, ILogger<ApiExceptionMiddleware> log)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        try
        {
            await next(ctx);
        }
        catch (ApiBadRequest ex)
        {
            if (ctx.Response.HasStarted) throw;
            ctx.Response.Clear();
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsJsonAsync(new { ok = false, error = ex.Message });
        }
        catch (Exception ex) when (ctx.Request.Path.StartsWithSegments("/api"))
        {
            log.LogError(ex, "API {Path} 出错", ctx.Request.Path);
            if (ctx.Response.HasStarted) throw;
            ctx.Response.Clear();
            ctx.Response.StatusCode = 500;
            await ctx.Response.WriteAsJsonAsync(new { ok = false, error = "服务器开小差了，稍后再试" });
        }
    }
}

/// <summary>把用户 / 导航 / 权限打成一份「App 启动包」，登录和 /me、改偏好后共用。</summary>
internal static class ApiDtos
{
    public static object Me(AppDbContext db, int userId)
    {
        var u = db.Users.Include(x => x.Role).First(x => x.Id == userId);

        var perms = db.RolePermissions
            .Where(rp => rp.RoleId == u.RoleId)
            .Select(rp => rp.Permission!.Code)
            .ToList();

        var hidden = ParseHidden(u.NavHidden);
        var all = CheckinApp.Security.NavCatalog.Items
            .Where(n => n.Enabled && perms.Contains(n.Permission))
            .ToList();

        return new
        {
            id = u.Id,
            username = u.Username,
            displayName = u.DisplayName,
            email = u.Email,
            signature = u.Signature,
            roleName = u.Role?.Name ?? "-",
            theme = Allowed(u.Theme, ThemeSet, "editorial"),
            accent = Allowed(u.Accent, AccentSet, ""),
            tone = Allowed(u.Tone, ToneSet, ""),
            mustChangePassword = u.MustChangePassword,
            createdAt = ApiKit.Stamp(u.CreatedAt),
            lastLoginAt = u.LastLoginAt is null ? "" : ApiKit.Stamp(u.LastLoginAt.Value),
            permissions = perms,
            // 权限码的短中文名（顺序与 permissions 一致）——App「我的」页要直接展示，不想在客户端再维护一份映射
            permissionLabels = perms.Select(c => CheckinApp.Security.PermissionCatalog.PermLabels.GetValueOrDefault(c, c)).ToList(),
            // 「我的数据」八宫格：一次查完，省得 App 再发 8 个请求
            counts = new
            {
                schedules = db.Schedules.Count(x => x.UserId == u.Id),
                memos = db.Memos.Count(x => x.UserId == u.Id),
                checkins = db.HabitCheckins.Count(x => x.UserId == u.Id),
                courses = db.Courses.Count(x => x.UserId == u.Id),
                anniversaries = db.Anniversaries.Count(x => x.UserId == u.Id),
                expenses = db.Expenses.Count(x => x.UserId == u.Id),
                board = db.BoardMessages.Count(x => x.UserId == u.Id),
                emailAccounts = db.EmailAccounts.Count(x => x.UserId == u.Id),
            },
            navHidden = hidden.ToArray(),
            dashboardLayout = ApiKit.ParseLayout(u.DashboardLayout),
            // 导航只用 code 作路由键；url 仅供「在浏览器里打开网页版这一页」
            nav = all.Where(n => !hidden.Contains(n.Code))
                     .Select(n => new { code = n.Code, label = n.Label, icon = n.Icon, group = n.Group, url = n.Url }),
            navAll = all.Select(n => new { code = n.Code, label = n.Label, icon = n.Icon, group = n.Group }),
        };
    }

    internal static readonly HashSet<string> ThemeSet = ["editorial", "neumorphism", "natural", "macos", "clay"];
    internal static readonly HashSet<string> AccentSet =
        ["", "violet", "coral", "mint", "lemon", "blue", "rose", "green", "pink", "lilac"];
    internal static readonly HashSet<string> ToneSet =
        ["", "mist", "rose", "wheat", "blue", "mint", "clay", "leaf", "midnight", "plum", "forest", "lilac", "lemon",
         "sage", "sand", "stone", "coffee", "slate", "sky", "blush"];

    private static string Allowed(string? v, HashSet<string> set, string fallback)
        => !string.IsNullOrEmpty(v) && set.Contains(v) ? v : fallback;

    public static HashSet<string> ParseHidden(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            var list = JsonSerializer.Deserialize<List<string>>(json);
            return list is null ? [] : list.ToHashSet();
        }
        catch (JsonException) { return []; }
    }
}
