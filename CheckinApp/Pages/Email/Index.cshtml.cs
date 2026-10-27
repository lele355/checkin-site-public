using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Email;

/// <summary>
/// 合并收件箱 —— 所有绑定账号的信混排在一个列表（按发件时间倒序）。
/// 页面只读 SQLite 缓存；IMAP 同步是独立通道（点「同步」或后台定时）。
/// </summary>
[Authorize(Policy = "perm:email.use")]
public class IndexModel(AppDbContext db, CurrentUser me, EmailSyncService sync) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly EmailSyncService _sync = sync;

    public record MsgRow(EmailMessage Msg, string AccountLabel);

    public List<MsgRow> Messages { get; private set; } = [];
    public List<EmailAccount> Accounts { get; private set; } = [];
    public int UnreadTotal { get; private set; }
    public string? Note { get; private set; }

    public void OnGet(string? note)
    {
        Note = note;
        if (_me.UserId is not int uid) return;

        Accounts = _db.EmailAccounts.Where(a => a.UserId == uid).OrderBy(a => a.Id).ToList();
        var labels = Accounts.ToDictionary(a => a.Id, a => a.DisplayName);
        UnreadTotal = _db.EmailMessages.Count(m => m.UserId == uid && !m.IsRead);

        Messages = _db.EmailMessages.AsNoTracking()
            .Where(m => m.UserId == uid)
            .OrderByDescending(m => m.SentAt)
            .Take(200)
            .ToList()
            .Select(m => new MsgRow(m, labels.TryGetValue(m.AccountId, out var n) ? n : "已删除账号"))
            .ToList();
    }

    /// <summary>手动同步（全部账号，或带 id 只同步一个）</summary>
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
