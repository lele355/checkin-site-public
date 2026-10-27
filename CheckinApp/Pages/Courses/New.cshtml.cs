using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Courses;

[Authorize(Policy = "perm:courses.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public string Name { get; set; } = "";
    [BindProperty] public string Teacher { get; set; } = "";
    [BindProperty] public string Location { get; set; } = "";
    [BindProperty] public int Weekday { get; set; } = 1;
    [BindProperty] public int StartPeriod { get; set; } = 1;
    [BindProperty] public int EndPeriod { get; set; } = 2;
    [BindProperty] public string WeeksText { get; set; } = "1-16";
    [BindProperty] public string Category { get; set; } = "other";
    /// <summary>色板键；空串 = 保存时按课程名自动分配（同名课自动同色）</summary>
    [BindProperty] public string Color { get; set; } = "";
    public string? Error { get; private set; }

    /// <summary>节次数（可自定义，下拉范围跟着配置走）</summary>
    public int PeriodCount { get; private set; } = CoursesConfig.Default.Length;

    private static readonly HashSet<string> AllowedCategories = ["required", "college", "school", "other"];

    public void OnGet()
    {
        PeriodCount = CoursesConfig.Load(_db).Count;
    }

    public async Task<IActionResult> OnPostAsync()
    {
        PeriodCount = CoursesConfig.Load(_db).Count;
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(Name))
        { Error = "课程名称不能为空。"; return Page(); }
        if (Weekday < 1 || Weekday > 7)
        { Error = "星期几要在 1-7 之间。"; return Page(); }
        if (StartPeriod < 1 || EndPeriod < StartPeriod || EndPeriod > PeriodCount)
        { Error = $"节次范围不合法（1-{PeriodCount}，且结束 ≥ 开始）。"; return Page(); }

        var name = Name.Trim();
        // 没选色：若这个课名本学期已经有色（用户改过的或默认的），沿用它 ——
        // 一门课加第二节（周三实验）不该跟周一那次颜色不一样。
        var color = CoursePalette.Normalize(Color);
        if (color.Length == 0)
        {
            var key = CoursePalette.NameKey(name);
            color = _db.Courses.Where(x => x.UserId == uid).Select(x => new { x.Name, x.Color }).ToList()
                .Where(x => CoursePalette.NameKey(x.Name) == key)
                .Select(x => CoursePalette.Normalize(x.Color) is { Length: > 0 } k ? k : CoursePalette.DefaultFor(x.Name))
                .FirstOrDefault() ?? "";
            // 仍为空 = 这门课是全新的，交给读的时候按名字现算默认色（不落库）
        }

        _db.Courses.Add(new Course
        {
            UserId = uid,
            Name = name,
            Teacher = Teacher?.Trim() ?? "",
            Location = Location?.Trim() ?? "",
            Weekday = Weekday,
            StartPeriod = StartPeriod,
            EndPeriod = EndPeriod,
            WeeksText = string.IsNullOrWhiteSpace(WeeksText) ? "1-16" : WeeksText.Trim(),
            Category = AllowedCategories.Contains(Category) ? Category : "other",
            Color = color,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Courses/Index");
    }
}
