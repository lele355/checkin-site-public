namespace CheckinApp.Models;

/// <summary>
/// 通知设置 —— 每人一行，App 与网站共用。
///
/// 时刻一律存「一天中的第几分钟」（0–1439），不存 DateTime：
/// 与全站「本地墙钟、不做时区换算」的约定一致，跨天/时区变更也不会算错。
/// </summary>
public class NotifySetting
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }

    /// <summary>总开关：关掉之后不再生成任何提醒计划</summary>
    public bool Enabled { get; set; } = true;

    // ---------- 免打扰 ----------
    public bool DndEnabled { get; set; }
    /// <summary>默认 22:00（1320 分钟）</summary>
    public int DndStartMinute { get; set; } = 1320;
    /// <summary>默认 08:00（480 分钟）；起止相等视为关闭</summary>
    public int DndEndMinute { get; set; } = 480;

    // ---------- 日程 ----------
    public bool ScheduleEnabled { get; set; } = true;
    /// <summary>提前量 CSV，只能取 5/10/30；空 = 只在开始时提醒</summary>
    public string ScheduleLeads { get; set; } = "10";
    /// <summary>全天日程在几点提醒</summary>
    public int AllDayMinute { get; set; } = 480;

    // ---------- 每天 ----------
    public bool DigestEnabled { get; set; } = true;
    public int DigestMinute { get; set; } = 480;

    public bool HabitEnabled { get; set; } = true;
    public int HabitMinute { get; set; } = 1260;

    // ---------- 特别的日子 ----------
    public bool AnnivEnabled { get; set; } = true;
    public int AnnivMinute { get; set; } = 540;

    public bool PeriodEnabled { get; set; } = true;
    public int PeriodDaysBefore { get; set; } = 2;

    // ---------- 其它 ----------
    /// <summary>首页显示未读提示（不弹系统通知）</summary>
    public bool UnreadHint { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
