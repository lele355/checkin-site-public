using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Text.Json;

namespace CheckinApp.Pages;

/// <summary>
/// 外观偏好写回（前端 theme.js 用 fetch 调用）+ 工作台布局写回（dashboard.js）。
/// 白名单校验：只接受已知的主题 / 强调色 / 卡片 id，防止任意值被写进 data-* 属性或布局。
/// </summary>
public class PreferencesModel(AppDbContext db, CurrentUser me) : PageModel
{
    private static readonly string[] AllowedThemes =
        ["editorial", "neumorphism", "natural", "macos", "clay"];

    private static readonly string[] AllowedAccents =
        ["", "violet", "coral", "mint", "lemon", "blue", "rose", "green", "pink", "lilac"];

    private static readonly string[] AllowedTones =
        ["", "mist", "rose", "wheat", "blue", "mint", "clay", "leaf", "midnight", "plum", "forest", "lilac", "lemon",
                       "sage", "sand", "stone", "coffee", "slate", "sky", "blush"];

    /// <summary>工作台卡片 id 白名单（工作台新卡片入住时在此登记）</summary>
    public static readonly string[] DashboardCards =
        ["hello", "reminders", "habits", "courses", "schedule", "memo", "anniversary",
         "email", "board", "expense", "couples", "period", "build", "admin"];

    public IActionResult OnGet() => new StatusCodeResult(204);

    public IActionResult OnPost(string theme, string accent, string? tone)
    {
        if (!AllowedThemes.Contains(theme)) return new BadRequestResult();
        accent ??= "";
        if (!AllowedAccents.Contains(accent)) accent = "";
        tone ??= "";
        if (!AllowedTones.Contains(tone)) tone = "";

        if (me.UserId is not int uid) return new UnauthorizedResult();
        var user = db.Users.FirstOrDefault(u => u.Id == uid);
        if (user is null) return new UnauthorizedResult();

        user.Theme = theme;
        user.Accent = accent;
        user.Tone = tone;
        db.SaveChanges();
        return new OkResult();
    }

    /// <summary>
    /// 工作台布局写回（?handler=Dashboard）：layout = {"pinned":[..],"order":[..],"hidden":[..]}。
    /// 卡片 id 白名单过滤 + 去重；pinned/order 互斥（置顶区在前）。脏数据一律丢弃不报错。
    /// </summary>
    public IActionResult OnPostDashboard(string? layout)
    {
        if (me.UserId is not int uid) return new UnauthorizedResult();
        var user = db.Users.FirstOrDefault(u => u.Id == uid);
        if (user is null) return new UnauthorizedResult();

        var (pinned, order, hidden) = ParseLayout(layout);
        user.DashboardLayout = SerializeLayout(pinned, order, hidden);
        db.SaveChanges();
        return new OkResult();
    }

    private static (List<string> Pinned, List<string> Order, List<string> Hidden) ParseLayout(string? json)
    {
        var pinned = new List<string>();
        var order = new List<string>();
        var hidden = new List<string>();
        if (string.IsNullOrWhiteSpace(json) || json.Length > 4000) return (pinned, order, hidden);
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            Fill(root, "pinned", pinned);
            Fill(root, "order", order);
            Fill(root, "hidden", hidden);
        }
        catch { /* 非法 JSON = 回默认布局 */ }
        // 置顶区在前：order 里不再重复出现 pinned 的卡片
        order.RemoveAll(id => pinned.Contains(id));
        return (pinned, order, hidden);

        static void Fill(JsonElement root, string name, List<string> list)
        {
            if (!root.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array) return;
            foreach (var it in arr.EnumerateArray())
            {
                if (it.ValueKind != JsonValueKind.String) continue;
                var id = it.GetString() ?? "";
                if (!DashboardCards.Contains(id) || list.Contains(id)) continue;
                list.Add(id);
                if (list.Count >= DashboardCards.Length) break;
            }
        }
    }

    private static string SerializeLayout(List<string> pinned, List<string> order, List<string> hidden)
    {
        if (pinned.Count == 0 && order.Count == 0 && hidden.Count == 0) return "";   // 全默认 = 清空
        return JsonSerializer.Serialize(new Dictionary<string, List<string>>
        {
            ["pinned"] = pinned, ["order"] = order, ["hidden"] = hidden
        });
    }

    /// <summary>
    /// 侧栏自定义（?handler=Nav）：表单勾选「要显示的模块」→ 反推要隐藏的 code 存进 Users.NavHidden。
    /// 只认当前用户有权限看到的导航项，乱填的 code 一律丢弃；保存后回到来源页。
    /// </summary>
    public IActionResult OnPostNav(string? returnUrl, string[]? visible)
    {
        if (me.UserId is not int uid) return new UnauthorizedResult();
        var user = db.Users.FirstOrDefault(u => u.Id == uid);
        if (user is null) return new UnauthorizedResult();

        var allowed = me.AllNavItems().Select(n => n.Code).ToHashSet();
        var shown = (visible ?? []).Where(allowed.Contains).ToHashSet();
        var hidden = allowed.Where(c => !shown.Contains(c)).OrderBy(c => c).ToList();

        user.NavHidden = hidden.Count == 0 ? "" : JsonSerializer.Serialize(hidden);
        db.SaveChanges();

        // 只允许跳回站内路径，防止被当成开放重定向
        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl)) return Redirect(returnUrl);
        return RedirectToPage("/Index");
    }
}
