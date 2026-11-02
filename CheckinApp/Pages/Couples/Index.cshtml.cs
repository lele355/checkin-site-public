using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Couples;

/// <summary>情侣空间 —— 情侣大类聚合主页（2026-11-02 站主规划）：在一起天数 + 小纸条 + 双方经期速览 + 大类快捷入口。</summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CurrentUser me, CoupleScope couple) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly CoupleScope _couple = couple;

    public CoupleSetting Setting { get; set; } = new() { StartDate = DateTime.Today };
    public int DaysTogether { get; set; }
    public List<LoveNote> Notes { get; set; } = [];

    [BindProperty] public string SettingTitle { get; set; } = "";
    [BindProperty] public DateTime SettingStartDate { get; set; } = DateTime.Today;
    [BindProperty] public string NoteContent { get; set; } = "";
    public string? Error { get; private set; }

    /// <summary>最近一个「每年重复」纪念日的倒计时（可空）</summary>
    public (string Title, int DaysLeft)? NextAnniversary { get; set; }

    // 经期速览（情侣互见：双方各一行）
    public record PeriodPeek(string Name, DateTime? Next, int DaysLeft, bool Enough);
    public List<PeriodPeek> PeriodPeeks { get; private set; } = [];

    // 今日心情（2026-11-02 站主定：原小纸条位置放这个）
    public record MoodPeek(string Name, int Uid, int? Mood, bool Round);
    public List<MoodPeek> TodayMoods { get; private set; } = [];

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

        // 经期速览（双方各算各的预测）
        var uids = _couple.MemberUids();
        var names = _db.Users.Where(u => uids.Contains(u.Id)).ToDictionary(u => u.Id, u => u.DisplayName);
        foreach (var u in uids.OrderBy(x => x == uid ? 0 : 1))
        {
            var starts = _db.PeriodRecords.Where(x => x.UserId == u)
                .Select(x => x.StartDate.Date).OrderBy(d => d).ToList();
            if (starts.Count >= 2)
            {
                var cycles = new List<int>();
                for (var i = starts.Count - 1; i > 0 && cycles.Count < 3; i--)
                    cycles.Add((starts[i] - starts[i - 1]).Days);
                var next = starts[^1].AddDays((int)Math.Round(cycles.Average()));
                PeriodPeeks.Add(new PeriodPeek(names.GetValueOrDefault(u, "?"), next, (next - DateTime.Today).Days, true));
            }
            else
            {
                PeriodPeeks.Add(new PeriodPeek(names.GetValueOrDefault(u, "?"), null, 0, false));
            }
        }

        // 今日心情（贴纸速览 + 快捷记录）
        var todayMoods = _db.MoodLogs.Where(x => uids.Contains(x.UserId) && x.Date == today)
            .ToDictionary(x => x.UserId, x => x.Mood);
        var first = true;
        foreach (var u in uids)
        {
            TodayMoods.Add(new MoodPeek(names.GetValueOrDefault(u, "?"), u,
                todayMoods.TryGetValue(u, out var m) ? m : null, first));
            first = false;
        }
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
