using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Anniversaries;

[Authorize(Policy = "perm:anniversary.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public record AnnivRow(AnniversaryItem Item, int DaysLeft, bool IsPast);

    /// <summary>未到的（按天数升序）</summary>
    public List<AnnivRow> Upcoming { get; set; } = [];
    /// <summary>已过且不重复的（按日期倒序）</summary>
    public List<AnnivRow> Past { get; set; } = [];
    public string View { get; private set; } = "list";   // list | cards

    public void OnGet(string? view)
    {
        View = view == "cards" ? "cards" : "list";
        if (_me.UserId is not int uid) return;
        var today = DateTime.Today;
        foreach (var a in _db.Anniversaries.Where(x => x.UserId == uid).ToList())
        {
            if (a.RepeatYearly)
            {
                // 每年重复：算下一个「今年的月日」，过了就翻到明年
                var next = SafeDate(today.Year, a.Date.Month, a.Date.Day);
                if (next < today) next = SafeDate(today.Year + 1, a.Date.Month, a.Date.Day);
                Upcoming.Add(new AnnivRow(a, (next - today).Days, false));
            }
            else
            {
                var days = (a.Date.Date - today).Days;
                if (days >= 0) Upcoming.Add(new AnnivRow(a, days, false));
                else Past.Add(new AnnivRow(a, days, true));
            }
        }
        Upcoming.Sort((x, y) => x.DaysLeft.CompareTo(y.DaysLeft));
        Past.Sort((x, y) => y.Item.Date.CompareTo(x.Item.Date));
    }

    /// <summary>防 2 月 29 日炸：不存在的日子退到当月最后一天</summary>
    private static DateTime SafeDate(int year, int month, int day)
    {
        var dim = DateTime.DaysInMonth(year, month);
        return new DateTime(year, month, Math.Min(day, dim));
    }
}
