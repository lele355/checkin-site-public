using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Courses;

[Authorize(Policy = "perm:courses.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public string Name { get; set; } = "";
    [BindProperty] public string Teacher { get; set; } = "";
    [BindProperty] public string Location { get; set; } = "";
    [BindProperty] public int Weekday { get; set; } = 1;
    [BindProperty] public int StartPeriod { get; set; } = 1;
    [BindProperty] public int EndPeriod { get; set; } = 2;
    [BindProperty] public string WeeksText { get; set; } = "1-16";
    [BindProperty] public string Category { get; set; } = "other";
    public string? Error { get; private set; }

    /// <summary>节次数（可自定义，下拉范围跟着配置走）</summary>
    public int PeriodCount { get; private set; } = CoursesConfig.Default.Length;

    private static readonly HashSet<string> AllowedCategories = ["required", "college", "school", "other"];

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var c = _db.Courses.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (c is null) return NotFound();
        Id = c.Id; Name = c.Name; Teacher = c.Teacher; Location = c.Location;
        Weekday = c.Weekday; StartPeriod = c.StartPeriod; EndPeriod = c.EndPeriod;
        WeeksText = c.WeeksText; Category = c.Category;
        PeriodCount = CoursesConfig.Load(_db).Count;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        PeriodCount = CoursesConfig.Load(_db).Count;
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var c = _db.Courses.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (c is null) return NotFound();

        if (string.IsNullOrWhiteSpace(Name))
        { Error = "课程名称不能为空。"; Id = id; return Page(); }
        if (Weekday < 1 || Weekday > 7)
        { Error = "星期几要在 1-7 之间。"; Id = id; return Page(); }
        if (StartPeriod < 1 || EndPeriod < StartPeriod || EndPeriod > PeriodCount)
        { Error = $"节次范围不合法（1-{PeriodCount}，且结束 ≥ 开始）。"; Id = id; return Page(); }

        c.Name = Name.Trim();
        c.Teacher = Teacher?.Trim() ?? "";
        c.Location = Location?.Trim() ?? "";
        c.Weekday = Weekday;
        c.StartPeriod = StartPeriod;
        c.EndPeriod = EndPeriod;
        c.WeeksText = string.IsNullOrWhiteSpace(WeeksText) ? "1-16" : WeeksText.Trim();
        c.Category = AllowedCategories.Contains(Category) ? Category : "other";
        c.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage("/Courses/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var c = _db.Courses.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (c is null) return NotFound();
        _db.Courses.Remove(c);
        _db.SaveChanges();
        return RedirectToPage("/Courses/Index");
    }
}
