using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Habits;

[Authorize(Policy = "perm:habits.use")]
public class EditModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public int Id { get; set; }
    [BindProperty] public string Name { get; set; } = "";
    [BindProperty] public string Icon { get; set; } = "🌱";
    public string? Error { get; private set; }

    public IActionResult OnGet(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var h = _db.Habits.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (h is null) return NotFound();
        Id = h.Id; Name = h.Name; Icon = h.Icon;
        return Page();
    }

    public IActionResult OnPost(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var h = _db.Habits.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (h is null) return NotFound();

        if (string.IsNullOrWhiteSpace(Name))
        { Error = "习惯名称不能为空。"; Id = id; return Page(); }

        h.Name = Name.Trim();
        h.Icon = string.IsNullOrWhiteSpace(Icon) ? "🌱" : Icon.Trim();
        _db.SaveChanges();
        return RedirectToPage("/Habits/Index");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var h = _db.Habits.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (h is null) return NotFound();
        // 打卡记录随习惯级联删除（外键 Cascade）
        _db.Habits.Remove(h);
        _db.SaveChanges();
        return RedirectToPage("/Habits/Index");
    }
}
