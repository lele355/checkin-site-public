using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Expenses;

[Authorize(Policy = "perm:expense.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public decimal Amount { get; set; }
    [BindProperty] public string Type { get; set; } = "out";
    [BindProperty] public string Category { get; set; } = "其他";
    [BindProperty] public DateTime OccurDate { get; set; } = DateTime.Today;
    [BindProperty] public string Note { get; set; } = "";
    public string? Error { get; private set; }

    /// <summary>
    /// 分类下拉项 = 用户在 App 里配的分类（没配过就是内置 7 个），
    /// 外加「这一笔原本用的分类」—— 分类被删掉之后老账还在，不补进去的话
    /// 打开编辑页会静默把分类改成列表第一项，等于把历史数据改坏了。
    /// </summary>
    public List<string> Categories
    {
        get
        {
            var list = _me.ExpenseCategories;
            if (!string.IsNullOrWhiteSpace(Category) && !list.Contains(Category)) list.Add(Category);
            return list;
        }
    }

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var x = _db.Expenses.FirstOrDefault(e => e.Id == id && e.UserId == uid);
        if (x is null) return NotFound();
        Id = x.Id; Amount = x.Amount; Type = x.Type; Category = x.Category;
        OccurDate = x.OccurDate; Note = x.Note;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var x = _db.Expenses.FirstOrDefault(e => e.Id == id && e.UserId == uid);
        if (x is null) return NotFound();

        if (Amount <= 0)
        { Error = "金额必须大于 0（方向用收入/支出来区分）。"; Id = id; return Page(); }
        if (Type != "out" && Type != "in")
        { Error = "类型只能是支出或收入。"; Id = id; return Page(); }

        x.Amount = decimal.Round(Amount, 2);
        x.Type = Type;
        x.Category = string.IsNullOrWhiteSpace(Category) ? "其他" : Category.Trim();
        x.OccurDate = OccurDate.Date;
        x.Note = Note?.Trim() ?? "";
        x.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return RedirectToPage("/Expenses/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var x = _db.Expenses.FirstOrDefault(e => e.Id == id && e.UserId == uid);
        if (x is null) return NotFound();
        _db.Expenses.Remove(x);
        _db.SaveChanges();
        return RedirectToPage("/Expenses/Index");
    }
}
