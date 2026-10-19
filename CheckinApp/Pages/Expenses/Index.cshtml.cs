using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Expenses;

[Authorize(Policy = "perm:expense.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public DateTime Month { get; set; } = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    public List<ExpenseItem> Items { get; set; } = [];
    public decimal TotalOut { get; set; }
    public decimal TotalIn { get; set; }
    /// <summary>支出按分类小计（降序）</summary>
    public List<(string Category, decimal Sum)> ByCategory { get; set; } = [];
    public string View { get; private set; } = "list";   // list | month

    public record MonthRow(DateTime Month, decimal TotalIn, decimal TotalOut, int Count);
    /// <summary>近 12 个月汇总（月度视图用，按月倒序）</summary>
    public List<MonthRow> MonthRows { get; set; } = [];

    public void OnGet(string? m, string? view)
    {
        View = view == "month" ? "month" : "list";
        if (_me.UserId is not int uid) return;
        if (DateTime.TryParseExact(m, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var parsed))
            Month = new DateTime(parsed.Year, parsed.Month, 1);

        var next = Month.AddMonths(1);
        Items = _db.Expenses
            .Where(x => x.UserId == uid && x.OccurDate >= Month && x.OccurDate < next)
            .OrderByDescending(x => x.OccurDate)
            .ThenByDescending(x => x.Id)
            .ToList();

        TotalOut = Items.Where(x => x.Type == "out").Sum(x => x.Amount);
        TotalIn = Items.Where(x => x.Type == "in").Sum(x => x.Amount);
        ByCategory = Items
            .Where(x => x.Type == "out")
            .GroupBy(x => x.Category)
            .Select(g => (g.Key, g.Sum(x => x.Amount)))
            .OrderByDescending(t => t.Item2)
            .ToList();

        if (View == "month")
        {
            // 近 12 个月（含本月）汇总：一次查出再内存分组
            var start = new DateTime(Month.Year, Month.Month, 1).AddMonths(-11);
            var rows = _db.Expenses
                .Where(x => x.UserId == uid && x.OccurDate >= start && x.OccurDate < next)
                .Select(x => new { x.OccurDate, x.Type, x.Amount })
                .ToList()
                .GroupBy(x => new { x.OccurDate.Year, x.OccurDate.Month })
                .Select(g => new MonthRow(
                    new DateTime(g.Key.Year, g.Key.Month, 1),
                    g.Where(x => x.Type == "in").Sum(x => x.Amount),
                    g.Where(x => x.Type == "out").Sum(x => x.Amount),
                    g.Count()))
                .ToDictionary(r => r.Month);

            // 没账目的月份也补上空行，12 行整齐
            for (var i = 0; i < 12; i++)
            {
                var mo = start.AddMonths(i);
                MonthRows.Add(rows.TryGetValue(mo, out var r) ? r : new MonthRow(mo, 0, 0, 0));
            }
            MonthRows.Reverse();   // 最近的月份在最上面
        }
    }
}
