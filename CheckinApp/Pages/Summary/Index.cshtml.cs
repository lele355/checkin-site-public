using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Summary;

/// <summary>
/// 月度总结 —— 情侣大类（2026-11-02 站主规划）：mimo AI 生成，每日阶段 + 月末定稿，全部留存可查。
/// </summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CoupleSummaryService gen) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CoupleSummaryService _gen = gen;

    public record SView(int Id, string Month, int ScopeDays, bool IsFinal, string Content, string GeneratedAt);
    public List<SView> Items { get; private set; } = [];
    public string? Error { get; private set; }
    public string? Notice { get; private set; }

    public void OnGet()
    {
        Items = _db.CoupleMonthlySummaries
            .OrderByDescending(x => x.Month).ThenByDescending(x => x.IsFinal).ThenByDescending(x => x.GeneratedAt)
            .Take(60).ToList()
            .Select(x => new SView(x.Id, x.Month.ToString("yyyy年M月"), x.ScopeDays, x.IsFinal, x.Content,
                x.GeneratedAt.AddHours(8).ToString("yyyy-MM-dd HH:mm")))
            .ToList();
    }

    public async Task<IActionResult> OnPostGenerateAsync()
    {
        try
        {
            var row = await _gen.GenerateAsync(DateTime.Today.Day, isFinal: false);
            Notice = row is null ? "生成失败，稍后再试。" : "已生成一份截至今天的阶段总结。";
        }
        catch (Exception e)
        {
            Error = e.Message;
        }
        OnGet();
        return Page();
    }
}
