using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Period;

/// <summary>经期助手 —— 数据严格按 UserId 隔离，仅本人可见。</summary>
[Authorize(Policy = "perm:period.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public List<PeriodRecord> Records { get; set; } = [];

    // 预测
    public double AvgCycle { get; set; } = 28;
    public double AvgDuration { get; set; } = 5;
    public DateTime? NextPredicted { get; set; }
    public int DaysToNext { get; set; }
    public bool HasEnoughData { get; set; }

    // 内联新增
    [BindProperty] public DateTime NewStartDate { get; set; } = DateTime.Today;
    [BindProperty] public DateTime? NewEndDate { get; set; }
    [BindProperty] public string NewNote { get; set; } = "";
    public string? Error { get; private set; }

    public void OnGet() => Load();

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        Records = _db.PeriodRecords
            .Where(x => x.UserId == uid)
            .OrderByDescending(x => x.StartDate)
            .ToList();

        if (Records.Count == 0) return;

        // 平均周期：相邻两次开始日期的间隔（取最近 3 个间隔）
        var starts = Records.Select(r => r.StartDate.Date).OrderBy(d => d).ToList();
        if (starts.Count >= 2)
        {
            var cycles = new List<int>();
            for (var i = starts.Count - 1; i > 0 && cycles.Count < 3; i--)
                cycles.Add((starts[i] - starts[i - 1]).Days);
            AvgCycle = Math.Round(cycles.Average(), 1);
            HasEnoughData = true;
        }

        // 平均经期天数：有结束日期的记录
        var durations = Records
            .Where(r => r.EndDate is not null)
            .Select(r => (r.EndDate!.Value.Date - r.StartDate.Date).Days + 1)
            .Where(d => d > 0 && d <= 15)
            .Take(3)
            .ToList();
        if (durations.Count > 0) AvgDuration = Math.Round(durations.Average(), 1);

        // 预测下次
        NextPredicted = starts.Last().AddDays((int)Math.Round(AvgCycle));
        DaysToNext = (NextPredicted.Value - DateTime.Today).Days;
    }

    public IActionResult OnPostAdd()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (NewEndDate is not null && NewEndDate.Value.Date < NewStartDate.Date)
        { Error = "结束日期不能早于开始日期。"; Load(); return Page(); }

        _db.PeriodRecords.Add(new PeriodRecord
        {
            UserId = uid,
            StartDate = NewStartDate.Date,
            EndDate = NewEndDate?.Date,
            Note = NewNote?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        _db.SaveChanges();
        return RedirectToPage();
    }
}
