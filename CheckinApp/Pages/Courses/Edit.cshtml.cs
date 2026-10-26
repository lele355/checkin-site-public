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
    /// <summary>色板键；空串 = 跟着课名自动分配（默认），选了才落库</summary>
    [BindProperty] public string Color { get; set; } = "";
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
        Color = CoursePalette.Normalize(c.Color);   // 脏值当「自动」，别让下拉框选中一个不存在的项
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

        var newName = Name.Trim();
        var newColor = CoursePalette.Normalize(Color);
        var oldKey = CoursePalette.NameKey(c.Name);
        var newKey = CoursePalette.NameKey(newName);

        // 同名必同色是硬约束（课表里一门课一周上三次，颜色不一样就白搭了），
        // 所以改色/改名都要照顾同一门课的其它节：
        //   ① 改名 + 选了具体色 → 新名字下所有同名课一起改成这个色；
        //   ② 改名 + 仍是「自动」→ 旧名字那些节挂着的显式色要清掉，
        //      否则它们按旧名算默认色、新的按新名算，同一门课分裂成两种颜色；
        //   ③ 没改名只改色 → 同一门课的其它节跟着改。
        var sibs = _db.Courses.Where(x => x.UserId == uid && x.Id != c.Id).ToList();
        if (newColor.Length > 0)
        {
            // 选了具体色：同一门课的其它节一起改成这个色
            // （改了名就把范围换成新名字，改名后的同类课才是一伙的）
            var scope = newKey.Length > 0 && newKey != oldKey ? newKey : oldKey;
            foreach (var sib in sibs)
                if (CoursePalette.NameKey(sib.Name) == scope) sib.Color = newColor;
        }
        else
        {
            // 改回「自动」：同一门课其它节挂着的显式色也必须清掉。
            // 只清自己这一个是不够的 —— 其余节还留着旧色，同一门课会分裂成两种颜色。
            // 范围按「改完之后的名字」算：改名了旧名那几条也得跟着回到自动。
            foreach (var sib in sibs)
            {
                var k = CoursePalette.NameKey(sib.Name);
                if (k.Length > 0 && (k == newKey || k == oldKey)) sib.Color = "";
            }
        }

        c.Name = newName;
        c.Teacher = Teacher?.Trim() ?? "";
        c.Location = Location?.Trim() ?? "";
        c.Weekday = Weekday;
        c.StartPeriod = StartPeriod;
        c.EndPeriod = EndPeriod;
        c.WeeksText = string.IsNullOrWhiteSpace(WeeksText) ? "1-16" : WeeksText.Trim();
        c.Category = AllowedCategories.Contains(Category) ? Category : "other";
        c.Color = newColor;
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
