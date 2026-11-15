using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace CheckinApp.Pages.Export;

/// <summary>数据导出 —— 个人 JSON 备份；管理员可导全站（绝不导出密码哈希）。</summary>
[Authorize(Policy = "perm:export.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public bool IsAdmin { get; private set; }

    public void OnGet()
    {
        IsAdmin = _me.Has("admin.users");
    }

    // IgnoreCycles：EF 关系修复会把 User.Role.Users 接成环，序列化必须断环；
    // WhenWritingNull：导航属性没加载时是 null，不往 JSON 里灌噪音；
    // UnsafeRelaxedJsonEscaping：中文按原文输出（备份文件要人类可读，且不嵌入 HTML 无注入风险）。
    private static readonly JsonSerializerOptions JsonOpt = new()
    {
        WriteIndented = true,
        ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>导出当前用户自己的全部数据</summary>
    public IActionResult OnGetMine()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        // AsNoTracking：导出用纯只读快照，不接 EF 关系修复（否则已跟踪的 User 会带密码哈希溜进 JSON）
        var gnames = _db.ExpenseGroups.AsNoTracking().Where(g => g.UserId == uid)
            .ToDictionary(g => g.Id, g => g.Name);
        var data = new
        {
            exportedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            user = _me.DisplayName,
            schedules = _db.Schedules.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            memos = _db.Memos.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            habits = _db.Habits.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            habitCheckins = _db.HabitCheckins.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            courses = _db.Courses.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            anniversaries = _db.Anniversaries.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            expenses = _db.Expenses.AsNoTracking().Where(x => x.UserId == uid).ToList()
                .Select(x => new
                {
                    x.Id, x.UserId, x.Amount, x.Type, x.Category, x.Note,
                    // 发生时间只到分钟（与接口、App、CSV 同一档精度），其余时间戳保留原样
                    OccurDate = SiteClock.IsoMinute(x.OccurDate),
                    // 所属条目（合并容器）：空 = 未分组。备份里保留组名，换库后也能还原归属
                    ExpenseGroupName = x.GroupId is int gid ? gnames.GetValueOrDefault(gid, "") : "",
                    x.CreatedAt, x.UpdatedAt,
                }).ToList(),
            expenseGroups = _db.ExpenseGroups.AsNoTracking().Where(g => g.UserId == uid)
                .ToList().Select(g => new { g.Id, g.Name, g.CreatedAt }).ToList(),
            periodRecords = _db.PeriodRecords.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            myBoardMessages = _db.BoardMessages.AsNoTracking().Where(x => x.UserId == uid).ToList(),
            myLoveNotes = _db.LoveNotes.AsNoTracking().Where(x => x.FromUserId == uid).ToList(),
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(data, JsonOpt);
        return File(bytes, "application/json", $"我的数据备份-{DateTime.Now:yyyyMMdd}.json");
    }

    /// <summary>管理员：全站备份（含所有用户数据；密码哈希不导出）</summary>
    public IActionResult OnGetAll()
    {
        if (!_me.Has("admin.users")) return Forbid();

        // 全站备份跨所有用户：先把组名一次查成字典，避免每笔账回查一次
        var allGroupNames = _db.ExpenseGroups.AsNoTracking().ToDictionary(g => g.Id, g => g.Name);
        var data = new
        {
            exportedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            note = "全站备份（不含密码哈希）",
            users = _db.Users.AsNoTracking().Select(u => new
            {
                u.Id, u.Username, u.DisplayName, u.RoleId, u.IsActive, u.CreatedAt, u.LastLoginAt
            }).ToList(),
            roles = _db.Roles.AsNoTracking().Select(r => new { r.Id, r.Name, r.Description, r.IsBuiltin }).ToList(),
            schedules = _db.Schedules.AsNoTracking().ToList(),
            memos = _db.Memos.AsNoTracking().ToList(),
            habits = _db.Habits.AsNoTracking().ToList(),
            habitCheckins = _db.HabitCheckins.AsNoTracking().ToList(),
            courses = _db.Courses.AsNoTracking().ToList(),
            anniversaries = _db.Anniversaries.AsNoTracking().ToList(),
            coupleSettings = _db.CoupleSettings.AsNoTracking().ToList(),
            loveNotes = _db.LoveNotes.AsNoTracking().ToList(),
            boardMessages = _db.BoardMessages.AsNoTracking().ToList(),
            expenses = _db.Expenses.AsNoTracking().ToList()
                .Select(x => new
                {
                    x.Id, x.UserId, x.Amount, x.Type, x.Category, x.Note,
                    OccurDate = SiteClock.IsoMinute(x.OccurDate),
                    // 全站备份跨用户，组名按 GroupId 现查（组数量很少，逐个查可接受）
                    ExpenseGroupName = x.GroupId is int gid ? allGroupNames.GetValueOrDefault(gid, "") : "",
                    x.CreatedAt, x.UpdatedAt,
                }).ToList(),
            expenseGroups = _db.ExpenseGroups.AsNoTracking().ToList(),
            periodRecords = _db.PeriodRecords.AsNoTracking().ToList(),
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(data, JsonOpt);
        return File(bytes, "application/json", $"全站备份-{DateTime.Now:yyyyMMdd}.json");
    }
}
