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
public class NewModel(AppDbContext db, CurrentUser me, CoupleScope couple) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly CoupleScope _couple = couple;

    [BindProperty] public DateTime StartDate { get; set; } = DateTime.Today;
    [BindProperty] public DateTime? EndDate { get; set; }
    [BindProperty] public string Note { get; set; } = "";
    /// <summary>归属人（情侣互见：可给对方记）</summary>
    [BindProperty] public int OwnerUid { get; set; }
    public List<(int Uid, string Name)> Members { get; private set; } = [];
    public string? Error { get; private set; }

    private void LoadMembers()
    {
        if (_me.UserId is not int uid) return;
        var uids = _couple.MemberUids();
        var names = _db.Users.Where(u => uids.Contains(u.Id))
            .ToDictionary(u => u.Id, u => u.DisplayName);
        Members = uids.Select(u => (u, names.GetValueOrDefault(u, "?"))).ToList();
        if (OwnerUid == 0) OwnerUid = uid;
    }

    public IActionResult OnGet()
    {
        if (_me.UserId is not int) return RedirectToPage("/Login");
        LoadMembers();
        return Page();
    }

    public IActionResult OnPost()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        if (EndDate is not null && EndDate.Value.Date < StartDate.Date)
        {
            Error = "结束日期不能早于开始日期。";
            LoadMembers();
            return Page();
        }
        if (OwnerUid == 0) OwnerUid = uid;
        if (!_couple.IsMember(OwnerUid))
        {
            Error = "只能为自己或对方记录。";
            LoadMembers();
            return Page();
        }

        _db.PeriodRecords.Add(new PeriodRecord
        {
            UserId = OwnerUid,
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
