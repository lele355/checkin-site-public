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
    [BindProperty] public DateTime OccurDate { get; set; } = DateTime.Today;
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    public readonly string[] Categories = ["餐饮", "交通", "学习", "娱乐", "日用", "医疗", "其他"];

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
            OccurDate = OccurDate.Date,
            Note = Note?.Trim() ?? "",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Expenses/Index");
    }
}
