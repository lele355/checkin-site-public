using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Poop;

/// <summary>
/// 排便记录 —— 情侣大类（2026-11-02 站主规划）：点一下记一次，双方互见。
/// </summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CurrentUser me, CoupleScope couple) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly CoupleScope _couple = couple;

    public List<(int Uid, string Name)> Members { get; private set; } = [];
    public List<(PoopLog R, string Owner)> Rows { get; private set; } = [];
    public int MyCount { get; private set; }
    public int PartnerCount { get; private set; }
    public string MonthLabel { get; private set; } = "";

    [BindProperty] public int SaveOwner { get; set; }

    public void OnGet(string? month)
    {
        if (_me.UserId is not int uid) return;
        var from = DateTime.Today.AddDays(1 - DateTime.Today.Day);
        if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParse(month + "-01", out var m)) from = m.Date;
        MonthLabel = from.ToString("yyyy年M月");
        var to = from.AddMonths(1);

        var uids = _couple.MemberUids();
        var names = _db.Users.Where(u => uids.Contains(u.Id)).ToDictionary(u => u.Id, u => u.DisplayName);
        Members = uids.OrderBy(x => x == uid ? 0 : 1).Select(u => (u, names.GetValueOrDefault(u, "?"))).ToList();

        Rows = _db.PoopLogs.Where(x => uids.Contains(x.UserId) && x.At >= from && x.At < to)
            .OrderByDescending(x => x.At)
            .ToList()
            .Select(r => (r, names.GetValueOrDefault(r.UserId, "?")))
            .ToList();
        MyCount = Rows.Count(x => x.R.UserId == uid);
        var pu = uids.FirstOrDefault(x => x != uid);
        PartnerCount = Rows.Count(x => x.R.UserId == pu);
    }

    public IActionResult OnPostTap()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var owner = SaveOwner == 0 ? uid : SaveOwner;
        if (!_couple.IsMember(owner)) return RedirectToPage();
        _db.PoopLogs.Add(new PoopLog { UserId = owner, At = DateTime.UtcNow, CreatedAt = DateTime.UtcNow });
        _db.SaveChanges();
        return RedirectToPage();
    }

    public IActionResult OnPostDelete(int id)
    {
        var uids = _couple.MemberUids();
        var r = _db.PoopLogs.FirstOrDefault(x => x.Id == id && uids.Contains(x.UserId));
        if (r is not null) { _db.PoopLogs.Remove(r); _db.SaveChanges(); }
        return RedirectToPage();
    }
}
