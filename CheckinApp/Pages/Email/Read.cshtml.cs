using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Email;

/// <summary>
/// 邮件详情 —— 正文以纯文本呈现（HTML 已剥标签，天然免疫邮件里的 XSS）。
/// 打开即标已读；正文首次打开时从 IMAP 拉取并缓存进库。
/// </summary>
[Authorize(Policy = "perm:email.use")]
public class ReadModel(AppDbContext db, CurrentUser me, EmailSyncService sync) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly EmailSyncService _sync = sync;

    public EmailMessage? Msg { get; private set; }
    public string AccountLabel { get; private set; } = "";
    public string Body { get; private set; } = "";
    public string? FetchError { get; private set; }

    public async Task<IActionResult> OnGetAsync(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        // 越权 = 404（不泄露「这封信存在但不是你的」）
        Msg = await _db.EmailMessages.Include(m => m.Account)
            .FirstOrDefaultAsync(m => m.Id == id && m.UserId == uid);
        if (Msg is null) return NotFound();

        AccountLabel = Msg.Account?.DisplayName ?? "已删除的账号";

        if (!Msg.IsRead)
        {
            Msg.IsRead = true;
            await _db.SaveChangesAsync();
        }

        if (!string.IsNullOrEmpty(Msg.BodyText))
        {
            Body = Msg.BodyText;
            return Page();
        }

        var r = await _sync.FetchBodyAsync(id, uid);
        if (r.Ok) Body = r.Text;
        else
        {
            FetchError = r.Error;
            Body = "";   // 拉不到正文就只展示信头 + 摘要
        }
        return Page();
    }

    /// <summary>标回未读</summary>
    public async Task<IActionResult> OnPostUnreadAsync(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var m = await _db.EmailMessages.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid);
        if (m is null) return NotFound();
        m.IsRead = false;
        await _db.SaveChangesAsync();
        return RedirectToPage("/Email/Index");
    }
}
