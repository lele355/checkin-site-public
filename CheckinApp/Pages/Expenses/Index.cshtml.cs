using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

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
    /// <summary>搜索关键字（备注/分类，跨全部月份）</summary>
    public string Query { get; private set; } = "";
    public bool Searching => Query.Length > 0;

    public record MonthRow(DateTime Month, decimal TotalIn, decimal TotalOut, int Count);
    /// <summary>近 12 个月汇总（月度视图用，按月倒序）</summary>
    public List<MonthRow> MonthRows { get; set; } = [];

    /// <summary>
    /// 列表里的一行：普通一笔（GroupId = null）或一个条目（合并容器）。
    /// 条目本身没有分类/时间/金额 —— 这里的时间取「组内当月最新一笔」，只用于排序和副标题。
    /// </summary>
    public class ExpenseRow
    {
        public int? GroupId { get; init; }
        public string Name { get; init; } = "";
        public List<ExpenseItem> Items { get; init; } = [];
        public DateTime SortAt { get; init; }
        /// <summary>组内其它月份还挂着几笔（跨月时提示一句，别让人以为账丢了）</summary>
        public int OtherCount { get; init; }
        public bool IsGroup => GroupId is not null;
        public decimal TotalOut => Items.Where(x => x.Type == "out").Sum(x => x.Amount);
        public decimal TotalIn => Items.Where(x => x.Type == "in").Sum(x => x.Amount);
        public string LatestText => SiteClock.MinuteLabel(SortAt);
    }
    public List<ExpenseRow> Rows { get; set; } = [];

    public void OnGet(string? m, string? view, string? q)
    {
        Query = (q ?? "").Trim();
        if (Query.Length > 50) Query = Query[..50];
        // 搜索态固定明细视图：跨月结果放进「近 12 个月」的柱状里没有意义
        View = Query.Length > 0 ? "list" : (view == "month" ? "month" : "list");
        if (_me.UserId is not int uid) return;
        if (DateTime.TryParseExact(m, "yyyy-MM", null, System.Globalization.DateTimeStyles.None, out var parsed))
            Month = new DateTime(parsed.Year, parsed.Month, 1);

        if (Searching)
        {
            Items = _db.Expenses
                .Where(x => x.UserId == uid
                            && ((x.Note != null && x.Note.Contains(Query)) || x.Category.Contains(Query)))
                .OrderByDescending(x => x.OccurDate)
                .ThenByDescending(x => x.Id)
                .Take(200)
                .ToList();
            TotalOut = Items.Where(x => x.Type == "out").Sum(x => x.Amount);
            TotalIn = Items.Where(x => x.Type == "in").Sum(x => x.Amount);
            ByCategory = Items
                .Where(x => x.Type == "out")
                .GroupBy(x => x.Category)
                .Select(g => (g.Key, g.Sum(x => x.Amount)))
                .OrderByDescending(t => t.Item2)
                .ToList();
            // 搜索跨月、结果要一条条找：一律平铺（已分组的那笔也不折叠，省得展开）
            Rows = Items.Select(x => new ExpenseRow { Items = [x], SortAt = x.OccurDate }).ToList();
            return;
        }

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

        if (View == "list") BuildRows(uid);

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

    // ==================== 条目（合并容器）====================
    //
    // 语义与 App 接口完全一致：条目只是「名字 + 一组明细」，自身没有分类/时间/金额，
    // 列表里的金额永远是明细求和 → 统计、导出、月度汇总都不用认识条目。

    /// <summary>
    /// 把当月明细拼成列表行：未分组的各自一行，已分组的收进一个条目行。
    /// 条目没有自己的时间，排序键取「组内当月最新一笔」—— 它在时间序列里的位置就和
    /// 里面最新那笔一致，不会凭空跳到别的日期去。
    /// </summary>
    private void BuildRows(int uid)
    {
        var names = _db.ExpenseGroups.AsNoTracking()
            .Where(g => g.UserId == uid).ToDictionary(g => g.Id, g => g.Name);
        var totals = _db.Expenses.AsNoTracking()
            .Where(x => x.UserId == uid && x.GroupId != null)
            .GroupBy(x => x.GroupId!.Value)
            .Select(g => new { Id = g.Key, N = g.Count() })
            .ToDictionary(x => x.Id, x => x.N);

        var rows = new List<ExpenseRow>();
        foreach (var grp in Items.Where(x => x.GroupId is not null && names.ContainsKey(x.GroupId.Value))
                                 .GroupBy(x => x.GroupId!.Value))
        {
            var list = grp.OrderByDescending(x => x.OccurDate).ThenByDescending(x => x.Id).ToList();
            rows.Add(new ExpenseRow
            {
                GroupId = grp.Key,
                Name = names[grp.Key],
                Items = list,
                SortAt = list[0].OccurDate,
                OtherCount = Math.Max(0, totals.GetValueOrDefault(grp.Key, list.Count) - list.Count),
            });
        }
        // 组已不存在的孤儿明细（正常流程不该出现）退回「普通一笔」显示，绝不让账消失
        foreach (var x in Items.Where(x => x.GroupId is null || !names.ContainsKey(x.GroupId.Value)))
            rows.Add(new ExpenseRow { Items = [x], SortAt = x.OccurDate });

        Rows = rows.OrderByDescending(r => r.SortAt).ThenByDescending(r => r.Items[0].Id).ToList();
    }

    private IActionResult BackToList(string? m) =>
        string.IsNullOrWhiteSpace(m) ? RedirectToPage("/Expenses/Index") : RedirectToPage("/Expenses/Index", new { m });

    /// <summary>合并成条目：至少 2 笔、名字必填、不能抢别人已经归好的明细</summary>
    public IActionResult OnPostMerge(int[]? ids, string? name, string? m)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var nm = (name ?? "").Trim();
        if (nm.Length > 20) nm = nm[..20];
        var clean = (ids ?? []).Where(i => i > 0).Distinct().Take(100).ToArray();
        if (nm.Length == 0) { TempData["Err"] = "给这个条目起个名字吧。"; return BackToList(m); }
        if (clean.Length < 2) { TempData["Err"] = "至少选 2 笔才能合并成一个条目。"; return BackToList(m); }

        var rows = _db.Expenses.Where(x => x.UserId == uid && clean.Contains(x.Id)).ToList();
        if (rows.Count != clean.Length) { TempData["Err"] = "有账目不存在或不属于你。"; return BackToList(m); }
        if (rows.Any(x => x.GroupId is not null))
        { TempData["Err"] = "选中的账目里有的已经属于别的条目了，先把它移出来。"; return BackToList(m); }

        var now = DateTime.UtcNow;
        var grp = new ExpenseGroup { UserId = uid, Name = nm, CreatedAt = now, UpdatedAt = now };
        _db.ExpenseGroups.Add(grp);
        _db.SaveChanges();
        foreach (var r in rows) { r.GroupId = grp.Id; r.UpdatedAt = now; }
        _db.SaveChanges();
        TempData["Ok"] = $"已把 {rows.Count} 笔合并到「{nm}」。";
        return BackToList(m);
    }

    public IActionResult OnPostRename(int groupId, string? name, string? m)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var grp = _db.ExpenseGroups.FirstOrDefault(g => g.Id == groupId && g.UserId == uid);
        if (grp is null) { TempData["Err"] = "条目不存在或已删除。"; return BackToList(m); }
        var nm = (name ?? "").Trim();
        if (nm.Length > 20) nm = nm[..20];
        if (nm.Length == 0) { TempData["Err"] = "条目名不能为空。"; return BackToList(m); }
        grp.Name = nm;
        grp.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        TempData["Ok"] = "条目已改名。";
        return BackToList(m);
    }

    /// <summary>解散：明细全部保留，只是不再归在这个条目下</summary>
    public IActionResult OnPostDissolve(int groupId, string? m)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var grp = _db.ExpenseGroups.FirstOrDefault(g => g.Id == groupId && g.UserId == uid);
        if (grp is null) { TempData["Err"] = "条目不存在或已删除。"; return BackToList(m); }
        var n = 0;
        foreach (var r in _db.Expenses.Where(x => x.UserId == uid && x.GroupId == groupId))
        { r.GroupId = null; r.UpdatedAt = DateTime.UtcNow; n++; }
        _db.ExpenseGroups.Remove(grp);
        _db.SaveChanges();
        TempData["Ok"] = $"条目已解散，{n} 笔账都还在。";
        return BackToList(m);
    }
}
