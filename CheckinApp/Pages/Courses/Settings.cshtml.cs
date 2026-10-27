using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Courses;

/// <summary>
/// 课表设置（二级页）。
///
/// 原先「学期起始日」「节次时间」「显示非本周课程」三个表单直接摊在课表页顶上，
/// 一进课程表先看到三行表单、再看到课表 —— 这些是一学期改一次的东西，
/// 不该占课表首屏。收进来之后课表页只剩「周次切换 + 课表 + 加号」。
/// </summary>
[Authorize(Policy = "perm:courses.use")]
public class SettingsModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    /// <summary>设置键：是否把「本周不上」的课程以虚化形式画出来</summary>
    public const string ShowOffWeekKey = "courses.show-offweek";

    public DateTime SemesterStart { get; private set; } = DateTime.Today;
    public bool SemesterConfigured { get; private set; }
    public string SemesterName { get; private set; } = "";
    public bool ShowOffWeek { get; private set; } = true;
    public int PeriodCount { get; private set; }
    public int CurrentWeek { get; private set; }
    public bool Saved { get; private set; }

    [BindProperty] public DateTime? SemesterStartInput { get; set; }

    public void OnGet(bool saved = false)
    {
        Saved = saved;
        Load();
    }

    private void Load()
    {
        var sem = SemesterService.Current(_db, _me.UserId ?? 0);
        SemesterName = sem.Name;
        SemesterConfigured = true;
        SemesterStart = sem.StartDate;
        SemesterStartInput = SemesterStart;

        var today = DateTime.Today;
        CurrentWeek = Math.Max(1, (int)((today - SemesterStart).TotalDays / 7) + 1);

        var offSetting = _db.AppSettings.FirstOrDefault(s => s.Key == ShowOffWeekKey);
        ShowOffWeek = offSetting is null || offSetting.Value != "0";

        PeriodCount = CoursesConfig.Load(_db).Count;
    }

    /// <summary>保存学期起始（自动对齐到所在周的周一）</summary>
    public IActionResult OnPostSemester()
    {
        if (_me.UserId is null) return RedirectToPage("/Login");
        if (SemesterStartInput is null) return RedirectToPage("/Courses/Settings");

        var uid = _me.UserId ?? 0;
        var sem = SemesterService.Current(_db, uid);
        SemesterService.Update(_db, uid, sem.Id, null, SemesterStartInput.Value);
        return RedirectToPage("/Courses/Settings", new { saved = true });
    }

    /// <summary>切换「显示非本周课程」</summary>
    /// <param name="show">1 = 显示，0 = 只看本周。用 int 而不是 bool：bool 模型绑定只认 true/false。</param>
    public IActionResult OnPostToggleOffWeek(int show = 0)
    {
        if (_me.UserId is null) return RedirectToPage("/Login");
        var setting = _db.AppSettings.FirstOrDefault(s => s.Key == ShowOffWeekKey);
        var val = show != 0 ? "1" : "0";
        if (setting is null)
            _db.AppSettings.Add(new AppSetting { Key = ShowOffWeekKey, Value = val });
        else
            setting.Value = val;
        _db.SaveChanges();
        return RedirectToPage("/Courses/Settings", new { saved = true });
    }

    /// <summary>取所在周的周一（周一是第 1 天）</summary>
    private static DateTime MondayOf(DateTime d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
