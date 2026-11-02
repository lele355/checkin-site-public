using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Period;

/// <summary>经期助手 —— 情侣大类：双方可看可记（2026-11-02 站主规划），预测按归属人分算。</summary>
[Authorize(Policy = "perm:period.use")]
public class IndexModel(AppDbContext db, CurrentUser me, CoupleScope couple) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly CoupleScope _couple = couple;

    /// <summary>全部记录（双方，带归属）</summary>
    public List<PeriodRecord> Records { get; set; } = [];
    public Dictionary<int, string> Names { get; set; } = new();
    public int MyUid { get; set; }
    public int PartnerUid { get; set; }

    // 预测（我的 / 对方的，各算各的）
    public double AvgCycle { get; set; } = 28;
    public double AvgDuration { get; set; } = 5;
    public DateTime? NextPredicted { get; set; }
    public int DaysToNext { get; set; }
    public bool HasEnoughData { get; set; }
    public DateTime? PartnerNext { get; set; }
    public int PartnerDaysToNext { get; set; }
    public bool PartnerHasData { get; set; }

    public void OnGet() => Load();

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        MyUid = uid;
        var uids = _couple.MemberUids();
        PartnerUid = uids.FirstOrDefault(x => x != uid);
        Names = _db.Users.Where(u => uids.Contains(u.Id))
            .ToDictionary(u => u.Id, u => u.DisplayName);

        Records = _db.PeriodRecords
            .Where(x => uids.Contains(x.UserId))
            .OrderByDescending(x => x.StartDate)
            .ToList();

        var mine = Records.Where(r => r.UserId == uid).ToList();
        var partner = Records.Where(r => r.UserId == PartnerUid).ToList();

        (AvgCycle, AvgDuration, NextPredicted, DaysToNext, HasEnoughData) = Predict(mine);
        var (pc, pd, pn, pdn, ph) = Predict(partner);
        PartnerNext = pn;
        PartnerDaysToNext = pdn;
        PartnerHasData = ph;
    }

    private static (double, double, DateTime?, int, bool) Predict(List<PeriodRecord> records)
    {
        double avgCycle = 28, avgDur = 5;
        DateTime? next = null;
        int days = 0;
        bool enough = false;
        if (records.Count == 0) return (avgCycle, avgDur, next, days, enough);

        var starts = records.Select(r => r.StartDate.Date).OrderBy(d => d).ToList();
        if (starts.Count >= 2)
        {
            var cycles = new List<int>();
            for (var i = starts.Count - 1; i > 0 && cycles.Count < 3; i--)
                cycles.Add((starts[i] - starts[i - 1]).Days);
            avgCycle = Math.Round(cycles.Average(), 1);
            enough = true;
        }
        var durations = records
            .Where(r => r.EndDate is not null)
            .Select(r => (r.EndDate!.Value.Date - r.StartDate.Date).Days + 1)
            .Where(d => d > 0 && d <= 15)
            .Take(3)
            .ToList();
        if (durations.Count > 0) avgDur = Math.Round(durations.Average(), 1);

        next = starts.Last().AddDays((int)Math.Round(avgCycle));
        days = (next.Value - DateTime.Today).Days;
        return (avgCycle, avgDur, next, days, enough);
    }
}
