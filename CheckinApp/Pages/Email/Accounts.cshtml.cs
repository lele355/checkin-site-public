using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Email;

/// <summary>邮箱账号管理 —— 绑定/编辑/删除 + 手动同步。授权码只存密文，界面永不回显。</summary>
[Authorize(Policy = "perm:email.use")]
public class AccountsModel(AppDbContext db, CurrentUser me, EmailSyncService sync) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly EmailSyncService _sync = sync;

    public List<EmailAccount> Accounts { get; private set; } = [];
    public string? Note { get; private set; }

    public void OnGet(string? note)
    {
        Note = note;
        if (_me.UserId is not int uid) return;
        Accounts = _db.EmailAccounts.Where(a => a.UserId == uid).OrderBy(a => a.Id).ToList();
    }

    /// <summary>手动同步（id 空 = 全部）</summary>
    public async Task<IActionResult> OnPostSyncAsync(int? id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var q = _db.EmailAccounts.Where(a => a.UserId == uid);
        if (id is int one) q = q.Where(a => a.Id == one);
        var notes = new List<string>();
        foreach (var ac in q.ToList())
        {
            var r = await _sync.SyncAsync(ac.Id, uid);
            notes.Add(r.Ok ? $"{ac.DisplayName}：新增 {r.NewCount} 封" : $"{ac.DisplayName}：{r.Error}");
        }
        if (notes.Count == 0) notes.Add("还没有绑定邮箱");
        var note = string.Join("；", notes);
        return RedirectToPage(new { note = note.Length > 200 ? note[..200] + "…" : note });
    }
}
