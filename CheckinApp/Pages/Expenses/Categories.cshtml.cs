using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Expenses;

/// <summary>
/// 记账分类管理（网页端）。
///
/// 【为什么是服务端往返而不是 AJAX 实时增删】
/// 这是一个「一学期改一次」的低频设置页，多一次整页刷新换来的是一整段不需要维护的
/// 前端状态机：没有本地草稿、没有乐观更新、没有「保存失败但界面已经改了」的错位。
/// 每个操作走一次 POST → 立刻落库 → PRG 回显，刷新/返回都安全。
///
/// 【提示为什么走 query 而不是 TempData】
/// TempData 是一次性 Cookie：刷新、后退就没了。而这个页面天生要连着操作几次
/// （加一个、删一个、再恢复默认），提示留不住反而让人怀疑「刚才那下到底生效了没」。
/// 放 query 后不依赖任何会话状态，刷新与前进后退都能重现，排查时看地址栏就知道结果。
///
/// 与 App 的「管理分类」读写的是同一份数据（`User.ExpenseCategories`），
/// 校验规则也共用 <see cref="ExpenseCategoryCatalog"/>，两端不会各说各话。
/// </summary>
[Authorize(Policy = "perm:expense.use")]
public class CategoriesModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public List<string> Categories { get; private set; } = [];

    /// <summary>操作结果提示（从 query 读，见类注释）</summary>
    public string? Ok { get; private set; }
    public string? Err { get; private set; }

    [BindProperty] public string? NewName { get; set; }

    public IActionResult OnGet()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        Categories = _me.ExpenseCategories;
        var okRaw = Request.Query["ok"].ToString();
        var errRaw = Request.Query["err"].ToString();
        Ok = okRaw.Length > 0 ? okRaw : null;
        Err = errRaw.Length > 0 ? errRaw : null;
        return Page();
    }

    /// <summary>新增一个分类（重复 / 超长 / 超量都在这里挡住，并给出人话提示）</summary>
    public IActionResult OnPostAdd()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var list = _me.ExpenseCategories;
        var name = (NewName ?? "").Trim();

        if (name.Length == 0) return RedirectToPage(new { err = "分类名不能为空。" });
        if (name.Length > ExpenseCategoryCatalog.MaxLen)
            return RedirectToPage(new { err = $"分类名最多 {ExpenseCategoryCatalog.MaxLen} 个字。" });
        if (list.Count >= ExpenseCategoryCatalog.MaxCount)
            return RedirectToPage(new { err = $"最多 {ExpenseCategoryCatalog.MaxCount} 个分类，先删掉用不上的再加。" });
        if (list.Any(x => x.Equals(name, StringComparison.OrdinalIgnoreCase)))
            return RedirectToPage(new { err = $"「{name}」已经在列表里了。" });

        Save(uid, list.Append(name));
        return RedirectToPage(new { ok = $"已添加「{name}」，App 里刷新一下就能选到。" });
    }

    /// <summary>删掉一个分类。已有账目不受影响 —— 它们存的是分类名字符串，不是外键。</summary>
    public IActionResult OnPostDelete(string name)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var list = _me.ExpenseCategories;

        if (list.Count <= 1)
        {
            // 一个都不留的话，记一笔时分类下拉会是空的 —— 服务端会兜底成「其他」，
            // 但那是兜底，不是让用户自己走进来的死胡同。
            return RedirectToPage(new { err = "至少要留一个分类，不然记一笔时没得选。" });
        }
        if (!list.Contains(name)) return RedirectToPage();

        Save(uid, list.Where(x => x != name));
        return RedirectToPage(new { ok = $"已删除「{name}」。原来的账目还挂在它下面，不会丢。" });
    }

    /// <summary>恢复默认：把字段清空（空 = 从没自定义过 = 内置那 7 个）</summary>
    public IActionResult OnPostReset()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var user = _db.Users.FirstOrDefault(u => u.Id == uid);
        if (user is not null)
        {
            user.ExpenseCategories = "";
            _db.SaveChanges();
        }
        return RedirectToPage(new { ok = "已恢复成内置分类。" });
    }

    private void Save(int uid, IEnumerable<string> list)
    {
        var user = _db.Users.FirstOrDefault(u => u.Id == uid);
        if (user is null) return;
        user.ExpenseCategories = ExpenseCategoryCatalog.Store(list);
        _db.SaveChanges();
    }
}
