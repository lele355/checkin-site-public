namespace CheckinApp.Security;

/// <summary>导航项：侧栏/底部栏的渲染来源。新模块入住第 3 步：在 Items 加一行并翻 Enabled。</summary>
public record NavItem(string Code, string Label, string Icon, string Url, string Permission, string Group, bool Enabled);

public static class NavCatalog
{
    public const string GroupMain = "常用";
    public const string GroupLife = "生活";
    public const string GroupTool = "工具";
    public const string GroupAdmin = "管理";

    public static readonly List<NavItem> Items =
    [
        new("workbench",   "工作台", "home",     "/",            "workbench.view", GroupMain, true),
        new("schedule",    "日程",   "calendar", "/Schedule",    "schedule.use",   GroupMain, true),
        new("memo",        "备忘",   "note",     "/Memo",        "memo.use",       GroupMain, true),
        new("email",       "邮件",   "mail",     "/Email",       "email.use",      GroupMain, true),
        new("ai",          "AI 助手","spark",   "/Ai",          "ai.use",         GroupMain, true),
        new("habits",      "打卡",   "check",    "/Habits",      "habits.use",     GroupLife, true),
        new("courses",     "课程表", "grid",     "/Courses",     "courses.use",    GroupLife, true),
        new("anniversary", "纪念日", "heart",    "/Anniversaries","anniversary.use",GroupLife, true),
        new("couples",     "情侣空间","couple",  "/Couples",     "couples.view",   GroupLife, true),
        new("board",       "留言板", "chat",     "/Board",       "board.use",      GroupLife, true),
        new("expense",     "记账",   "wallet",   "/Expenses",    "expense.use",    GroupLife, true),
        new("period",      "经期",   "drop",     "/Period",      "period.use",     GroupLife, true),
        new("reminders",   "提醒",   "bell",     "/Reminders",   "reminders.use",  GroupTool, true),
        new("stats",       "统计",   "chart",    "/Stats",       "stats.use",      GroupTool, true),
        new("export",      "导出",   "download", "/Export",      "export.use",     GroupTool, true),
        new("admin-users", "用户管理", "users",  "/Admin/Users", "admin.users",    GroupAdmin, true),
        new("admin-invites","邀请码", "ticket", "/Admin/Invitations", "admin.users", GroupAdmin, true),
        new("admin-roles", "角色管理", "role",   "/Admin/Roles", "admin.roles",    GroupAdmin, true),
    ];

    /// <summary>
    /// 侧栏高亮判定：只比路径。
    /// （2026-10-22 PyLab 删除后恢复了「不比查询串」的朴素规则 —— 带参页面
    ///   比如 /Expenses?month=2026-10 也能正常亮起来，不会因为 query 不同就灭掉。）
    /// </summary>
    public static bool IsActive(NavItem item, string path, string? query)
    {
        var url = item.Url;
        var q = url.IndexOf('?');
        var urlPath = q < 0 ? url : url[..q];
        return string.Equals(urlPath, path, StringComparison.OrdinalIgnoreCase);
    }
}
