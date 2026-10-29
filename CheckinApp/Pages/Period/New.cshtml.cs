using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Period;

/// <summary>
/// 「记录一次」表单片段（dialog.app-modal 装载；/New 链接被 modal.js 自动拦截）。
/// 从 Index 的常驻表单收进弹窗，主界面只留概览 + 历史。
/// </summary>
[Authorize(Policy = "perm:period.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public DateTime StartDate { get; set; } = DateTime.Today;
    [BindProperty] public DateTime? EndDate { get; set; }
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    public IActionResult OnGet()
    {
        if (_me.UserId is not int) return RedirectToPage("/Login");
        return Page();
    }

    public IActionResult OnPost()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        if (EndDate is not null && EndDate.Value.Date < StartDate.Date)
        {
            Error = "结束日期不能早于开始日期。";
            return Page();
        }

        _db.PeriodRecords.Add(new PeriodRecord
        {
            UserId = uid,
            StartDate = StartDate.Date,
            EndDate = EndDate?.Date,
            Note = Note?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        _db.SaveChanges();
        return RedirectToPage("/Period/Index");
    }
}
