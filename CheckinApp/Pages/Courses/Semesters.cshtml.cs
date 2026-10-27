using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Courses;

/// <summary>
/// 学期管理：列表 / 切换 / 新建 / 改名与改起始日 / 删除。
///
/// 放在单独一页而不是塞进课表顶部：这是低频但有破坏性的操作（删除会连带删课程），
/// 摊在课表上容易误触。
/// </summary>
[Authorize(Policy = "perm:courses.use")]
public class SemestersModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public record Row(int Id, string Name, DateTime StartDate, int CourseCount, bool IsCurrent);

    public List<Row> Rows { get; private set; } = [];
    public string? Error { get; private set; }

    public void OnGet() => Load();

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        // 顺手把「一门学期都没有」的账号补一个，列表才不会空着让人以为坏了
        SemesterService.Current(_db, uid);

        var counts = _db.Courses.Where(c => c.UserId == uid && c.SemesterId != null)
            .GroupBy(c => c.SemesterId!.Value)
            .Select(g => new { Id = g.Key, N = g.Count() })
            .ToDictionary(x => x.Id, x => x.N);

        Rows = SemesterService.List(_db, uid)
            .Select(s => new Row(s.Id, s.Name, s.StartDate, counts.GetValueOrDefault(s.Id), s.IsCurrent))
            .ToList();
    }

    public IActionResult OnPostCreate(string? name, DateTime? start)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (start is null) { Error = "请选择起始日"; Load(); return Page(); }
        SemesterService.Create(_db, uid, name, start.Value);
        return RedirectToPage("/Courses/Semesters");
    }

    public IActionResult OnPostSwitch(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (SemesterService.SwitchTo(_db, uid, id) is null) Error = "学期不存在";
        return RedirectToPage("/Courses/Semesters");
    }

    public IActionResult OnPostRename(int id, string? name, DateTime? start)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (SemesterService.Update(_db, uid, id, name, start) is null) Error = "学期不存在";
        Load();
        if (Error is not null) return Page();
        return RedirectToPage("/Courses/Semesters");
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var (ok, error, _) = SemesterService.Delete(_db, uid, id);
        if (!ok) { Error = error; Load(); return Page(); }
        return RedirectToPage("/Courses/Semesters");
    }
}
