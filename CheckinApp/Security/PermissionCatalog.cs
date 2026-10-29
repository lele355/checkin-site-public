namespace CheckinApp.Security;

/// <summary>
/// 权限清单 —— 全站唯一权威来源。新模块入住流程第 1 步：在此登记权限码。
/// 格式：模块.动作。启动时由 Seeder 自动播种进数据库。
/// </summary>
public static class PermissionCatalog
{
    public readonly record struct Perm(string Code, string Module, string Description);

    public static readonly Perm[] All =
    [
        new("workbench.view", "workbench", "查看工作台"),
        new("schedule.use",    "schedule",  "使用日程管理（M3 启用）"),
        new("memo.use",        "memo",      "使用备忘便签（M4 启用）"),
        new("admin.users",     "admin",     "用户管理（建号/重置密码/启停）"),
        new("admin.roles",     "admin",     "角色管理（自定义角色与权限）"),
        // ---------- M5 生活模块群 ----------
        new("habits.use",      "habits",      "习惯打卡（习惯定义与每日打卡）"),
        new("courses.use",     "courses",     "课程表（周视图课程管理）"),
        new("anniversary.use", "anniversary", "纪念日（倒计时与每年重复）"),
        new("couples.view",    "couples",     "情侣空间（仅限指定两人，慎授权）"),
        new("board.use",       "board",       "留言板（小圈子公开留言）"),
        new("board.moderate",  "board",       "留言板管理（删除任意人的留言）"),
        new("expense.use",     "expense",     "记账本（收支流水）"),
        new("period.use",      "period",      "经期助手（仅本人数据，慎授权）"),
        new("export.use",      "export",      "数据导出（个人数据备份）"),
        new("reminders.use",   "reminders",   "提醒中心（近期事项聚合）"),
        new("stats.use",       "stats",       "统计年报（打卡/记账统计）"),
        // ---------- AI 助手 ----------
        new("ai.use",          "ai",         "AI 助手（聊天 + 建议单，写操作需确认）"),
        // ---------- M7 邮件 ----------
        new("email.use",       "email",      "邮件（多邮箱收件箱，授权码加密存储）"),
        // ---------- 通知 ----------
        new("notify.use",      "notify",     "通知提醒（本地提醒计划与开关设置）"),
        // ---------- 小游戏 ----------
        new("games.use",       "games",      "小游戏（联机对局，目前有五子棋）"),
    ];

    /// <summary>普通用户角色的默认权限包（管理员=全部）。
    /// 情侣空间 couples.view 与经期 period.use 敏感，不进默认包 —— 由「情侣」内置角色或管理员单独授予。</summary>
    public static readonly string[] UserRoleDefaults =
    [
        "workbench.view", "schedule.use", "memo.use",
        "habits.use", "courses.use", "anniversary.use", "board.use",
        "expense.use", "export.use", "reminders.use", "stats.use", "ai.use",
        "email.use", "notify.use", "games.use",
    ];

    /// <summary>「情侣」内置角色 = 普通默认包 + 情侣空间 + 经期助手（给伴侣账号用）</summary>
    public static readonly string[] CoupleRoleExtras = ["couples.view", "period.use"];

    /// <summary>模块中文名（权限分组勾选 UI 用）</summary>
    public static readonly Dictionary<string, string> ModuleLabels = new()
    {
        ["workbench"]   = "工作台",
        ["schedule"]    = "日程",
        ["memo"]        = "备忘",
        ["admin"]       = "管理后台",
        ["habits"]      = "习惯打卡",
        ["courses"]     = "课程表",
        ["anniversary"] = "纪念日",
        ["couples"]     = "情侣空间",
        ["board"]       = "留言板",
        ["expense"]     = "记账本",
        ["period"]      = "经期助手",
        ["export"]      = "数据导出",
        ["reminders"]   = "提醒中心",
        ["stats"]       = "统计年报",
        ["ai"]          = "AI 助手",
        ["email"]       = "邮件",
        ["notify"]      = "通知提醒",
        ["games"]       = "小游戏",
    };

    /// <summary>权限码 → 短中文名（工作台徽标等展示用，别把 code 原文甩给用户）</summary>
    public static readonly Dictionary<string, string> PermLabels = new()
    {
        ["workbench.view"]  = "工作台",
        ["schedule.use"]    = "日程",
        ["memo.use"]        = "备忘",
        ["admin.users"]     = "用户管理",
        ["admin.roles"]     = "角色管理",
        ["habits.use"]      = "打卡",
        ["courses.use"]     = "课程表",
        ["anniversary.use"] = "纪念日",
        ["couples.view"]    = "情侣空间",
        ["board.use"]       = "留言板",
        ["expense.use"]     = "记账",
        ["period.use"]      = "经期",
        ["export.use"]      = "导出",
        ["reminders.use"]   = "提醒",
        ["stats.use"]       = "统计",
        ["ai.use"]          = "AI 助手",
        ["email.use"]       = "邮件",
        ["notify.use"]      = "通知",
        ["games.use"]       = "小游戏",
    };
}
