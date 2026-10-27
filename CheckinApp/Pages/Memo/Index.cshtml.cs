using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Pages.Memo;

[Authorize(Policy = "perm:memo.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public List<MemoItem> Memos { get; set; } = [];
    public string View { get; private set; } = "grid";   // grid | list

    public void OnGet(string? view)
    {
        View = view == "list" ? "list" : "grid";
        if (_me.UserId is not int uid) return;
        Memos = _db.Memos
            .Where(m => m.UserId == uid)
            .OrderByDescending(m => m.Pinned)
            .ThenByDescending(m => m.UpdatedAt)
            .ToList();
    }

    /// <summary>快捷置顶/取消置顶（列表卡片右上角图钉按钮，不进编辑页）。PRG 回原视图。</summary>
    public IActionResult OnPostTogglePin(int id, string? view)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var memo = _db.Memos.FirstOrDefault(m => m.Id == id && m.UserId == uid);
        if (memo is null) return NotFound();               // 越权/不存在一律 404，不泄露存在性
        memo.Pinned = !memo.Pinned;
        _db.SaveChanges();
        // 免刷新（fetch）提交回 JSON，前端就地翻图钉 + FLIP 滑动动画；普通提交走 PRG
        if (Request.Headers["X-Requested-With"] == "fetch")
            return new JsonResult(new { ok = true, pinned = memo.Pinned });
        return RedirectToPage(new { view = view == "list" ? "list" : "grid" });
    }
}
