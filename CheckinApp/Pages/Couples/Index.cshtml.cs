using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Couples;

/// <summary>情侣空间 —— 仅 couples.view 权限可见（默认只有「情侣」角色与管理员）。</summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public CoupleSetting Setting { get; set; } = new() { StartDate = DateTime.Today };
    public int DaysTogether { get; set; }
    public List<LoveNote> Notes { get; set; } = [];

    [BindProperty] public string SettingTitle { get; set; } = "";
    [BindProperty] public DateTime SettingStartDate { get; set; } = DateTime.Today;
    [BindProperty] public string NoteContent { get; set; } = "";
    public string? Error { get; private set; }

    /// <summary>最近一个「每年重复」纪念日的倒计时（可空）</summary>
    public (string Title, int DaysLeft)? NextAnniversary { get; set; }

    public void OnGet()
    {
        Load();
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;

        // 单行配置：不存在就建默认行
        Setting = _db.CoupleSettings.FirstOrDefault() ?? new CoupleSetting { StartDate = DateTime.Today };
        if (Setting.Id == 0)
        {
            _db.CoupleSettings.Add(Setting);
            _db.SaveChanges();
        }
        SettingTitle = Setting.Title;
        SettingStartDate = Setting.StartDate;
        DaysTogether = (DateTime.Today - Setting.StartDate.Date).Days + 1;

        Notes = _db.LoveNotes.Include(n => n.FromUser)
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .ToList();

        // 最近的每年重复纪念日
        var today = DateTime.Today;
        var best = (Title: "", DaysLeft: int.MaxValue);
        foreach (var a in _db.Anniversaries.Where(x => x.UserId == uid && x.RepeatYearly).ToList())
        {
            var next = new DateTime(today.Year, a.Date.Month, Math.Min(a.Date.Day, DateTime.DaysInMonth(today.Year, a.Date.Month)));
            if (next < today) next = next.AddYears(1);
            var days = (next - today).Days;
            if (days < best.DaysLeft) best = (a.Title, days);
        }
        if (best.DaysLeft != int.MaxValue) NextAnniversary = best;
    }

    public IActionResult OnPostSaveSetting()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(SettingTitle))
        { Error = "标题不能为空。"; Load(); return Page(); }

        var s = _db.CoupleSettings.FirstOrDefault();
        if (s is null)
        {
            s = new CoupleSetting();
            _db.CoupleSettings.Add(s);
        }
        s.Title = SettingTitle.Trim();
        s.StartDate = SettingStartDate.Date;
        s.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage();
    }

    public IActionResult OnPostNote()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(NoteContent))
        { Error = "小纸条不能是空的。"; Load(); return Page(); }

        _db.LoveNotes.Add(new LoveNote
        {
            FromUserId = uid,
            Content = NoteContent.Trim(),
            CreatedAt = DateTime.UtcNow
        });
        _db.SaveChanges();
        return RedirectToPage();
    }

    public IActionResult OnPostDeleteNote(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        // 只能删自己的小纸条
        var n = _db.LoveNotes.FirstOrDefault(x => x.Id == id && x.FromUserId == uid);
        if (n is null) return NotFound();
        _db.LoveNotes.Remove(n);
        _db.SaveChanges();
        return RedirectToPage();
    }
}
