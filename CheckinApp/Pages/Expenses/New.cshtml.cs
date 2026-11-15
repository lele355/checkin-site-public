using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Expenses;

[Authorize(Policy = "perm:expense.use")]
public class NewModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    [BindProperty] public decimal Amount { get; set; }
    [BindProperty] public string Type { get; set; } = "out";
    [BindProperty] public string Category { get; set; } = "其他";
    /// <summary>发生时间（精确到分钟）；默认「此刻」——记账多数是当场记，别让人每次改时间</summary>
    [BindProperty] public DateTime OccurDate { get; set; } = SiteClock.Now;
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    /// <summary>分类下拉项 = 用户在 App「管理分类」里配的那份列表（没配过就是内置 7 个）</summary>
    public List<string> Categories => _me.ExpenseCategories;

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (Amount <= 0)
        { Error = "金额必须大于 0（方向用收入/支出来区分）。"; return Page(); }
        if (Type != "out" && Type != "in")
        { Error = "类型只能是支出或收入。"; return Page(); }

        _db.Expenses.Add(new ExpenseItem
        {
            UserId = uid,
            Amount = decimal.Round(Amount, 2),
            Type = Type,
            Category = string.IsNullOrWhiteSpace(Category) ? "其他" : Category.Trim(),
            OccurDate = SiteClock.ToMinute(OccurDate),
            Note = Note?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Expenses/Index");
    }
}
