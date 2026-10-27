using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Courses;

/// <summary>
/// 节次时间设置 —— 自定义课程节数（1～16）和每节起止时间。
/// 存 AppSetting("courses.periods") JSON，课表网格/大节视图/节次下拉都从这里读。
/// </summary>
[Authorize(Policy = "perm:courses.use")]
public class PeriodsModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    public class SlotInput
    {
        [BindProperty] public string Start { get; set; } = "";
        [BindProperty] public string End { get; set; } = "";
    }

    // Razor 里用 Periods[i].Start 命名输入框，模型绑定进这个列表
    [BindProperty] public List<SlotInput> Periods { get; set; } = [];

    public string? Error { get; private set; }
    public bool Saved { get; private set; }

    public IActionResult OnGet(bool saved = false)
    {
        Saved = saved;
        Periods = CoursesConfig.Load(_db)
            .Select(s => new SlotInput { Start = s.Start, End = s.End })
            .ToList();
        return Page();
    }

    /// <summary>保存节次配置</summary>
    public IActionResult OnPost()
    {
        if (Periods.Count < CoursesConfig.MinCount || Periods.Count > CoursesConfig.MaxCount)
        {
            Error = $"节数要在 {CoursesConfig.MinCount}～{CoursesConfig.MaxCount} 之间。";
            return Page();
        }

        var slots = new List<PeriodSlot>();
        for (var i = 0; i < Periods.Count; i++)
        {
            var slot = CoursesConfig.Normalize(Periods[i].Start, Periods[i].End);
            if (slot is null)
            {
                Error = $"第 {i + 1} 节的时间不合法（要填 HH:mm，且结束晚于开始）。";
                return Page();
            }
            slots.Add(slot);
        }

        CoursesConfig.Save(_db, slots);
        return RedirectToPage("/Courses/Periods", new { saved = true });
    }

    /// <summary>恢复默认 12 小节作息</summary>
    public IActionResult OnPostReset()
    {
        CoursesConfig.Save(_db, [.. CoursesConfig.Default]);
        return RedirectToPage("/Courses/Periods", new { saved = true });
    }
}
