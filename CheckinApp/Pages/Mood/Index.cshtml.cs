using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Mood;

/// <summary>
/// 心情记录 —— 情侣大类（2026-11-02 站主规划）：双方每日一个心情，日历双行表情视图（示意图样式）。
/// 双方互见可记。表情 1..6 = 开心/平淡/难过/生气/困/害羞。
/// </summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CurrentUser me, CoupleScope couple) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly CoupleScope _couple = couple;

    public static readonly string[] Emojis = ["😊", "😐", "😔", "😡", "😴", "🥰"];
    public static readonly string[] Names = ["生气", "难过", "困", "平淡", "害羞", "开心"];

    public DateTime MonthStart { get; private set; }
    public List<(int Uid, string Name)> Members { get; private set; } = [];
    /// <summary>日历数据：(uid, day) → mood</summary>
    public Dictionary<(int Uid, int Day), int> MoodMap { get; private set; } = [];
    /// <summary>当天备注：(uid, day) → note</summary>
    public Dictionary<(int Uid, int Day), string> Notes { get; private set; } = [];
    public Dictionary<int, int> MyDist { get; private set; } = new();
    public Dictionary<int, int> PartnerDist { get; private set; } = new();
    /// <summary>本人 uid（日历里只有自己那行可点记录，2026-11-02 站主定）</summary>
    public int MyUid { get; private set; }

    [BindProperty] public string SaveDate { get; set; } = "";
    [BindProperty] public int SaveMood { get; set; }
    [BindProperty] public string SaveNote { get; set; } = "";
    [BindProperty] public int SaveOwner { get; set; }
    public string? Error { get; private set; }

    public void OnGet(string? month)
    {
        MonthStart = DateTime.Today.AddDays(1 - DateTime.Today.Day);
        if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParse(month + "-01", out var m))
            MonthStart = m.Date;
        Load();
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        MyUid = uid;
        var uids = _couple.MemberUids();
        var names = _db.Users.Where(u => uids.Contains(u.Id)).ToDictionary(u => u.Id, u => u.DisplayName);
        Members = uids.OrderBy(x => x == uid ? 0 : 1).Select(u => (u, names.GetValueOrDefault(u, "?"))).ToList();

        var to = MonthStart.AddMonths(1);
        var rows = _db.MoodLogs.Where(x => uids.Contains(x.UserId) && x.Date >= MonthStart && x.Date < to).ToList();
        foreach (var r in rows)
        {
            MoodMap[(r.UserId, r.Date.Day)] = r.Mood;
            if (!string.IsNullOrWhiteSpace(r.Note)) Notes[(r.UserId, r.Date.Day)] = r.Note;
        }
        MyDist = Enumerable.Range(1, 6).ToDictionary(m => m, m => rows.Count(r => r.UserId == uid && r.Mood == m));
        var pu = uids.FirstOrDefault(x => x != uid);
        PartnerDist = Enumerable.Range(1, 6).ToDictionary(m => m, m => rows.Count(r => r.UserId == pu && r.Mood == m));
    }

    public IActionResult OnGetSave() => RedirectToPage(new { month = MonthStart.ToString("yyyy-MM") });

    public IActionResult OnPostSave()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (SaveMood is < 1 or > 6) return RedirectToPage();
        if (!DateTime.TryParse(SaveDate, out var date)) date = DateTime.Today;
        if (date.Date > DateTime.Today) { Error = "不能给未来记心情。"; Load(); return Page(); }   // 日期边界（2026-11-02 站主定）
        // 只能记自己的心情（2026-11-02 站主定：不能设置对方的心情）
        var row = _db.MoodLogs.FirstOrDefault(x => x.UserId == uid && x.Date == date.Date);
        if (row is null) { row = new MoodLog { UserId = uid, Date = date.Date }; _db.MoodLogs.Add(row); }
        row.Mood = SaveMood;
        row.Note = SaveNote?.Trim() ?? "";
        row.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage(new { month = date.ToString("yyyy-MM") });
    }

    public IActionResult OnPostDelete()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (!DateTime.TryParse(SaveDate, out var date)) return RedirectToPage();
        // 只能删自己的（2026-11-02 站主定）
        var row = _db.MoodLogs.FirstOrDefault(x => x.UserId == uid && x.Date == date.Date);
        if (row is not null) { _db.MoodLogs.Remove(row); _db.SaveChanges(); }
        return RedirectToPage(new { month = date.ToString("yyyy-MM") });
    }
}
