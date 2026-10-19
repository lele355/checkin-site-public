using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Email;

/// <summary>编辑邮箱账号 —— 授权码留空 = 不修改；删除账号连同缓存信件一起走（级联）。</summary>
[Authorize(Policy = "perm:email.use")]
public class EditModel(AppDbContext db, CurrentUser me, EmailCrypto crypto) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly EmailCrypto _crypto = crypto;

    public int Id { get; private set; }

    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public string Address { get; set; } = "";
    [BindProperty] public string Provider { get; set; } = "custom";
    [BindProperty] public string AuthCode { get; set; } = "";
    [BindProperty] public string ImapHost { get; set; } = "";
    [BindProperty] public int ImapPort { get; set; } = 993;
    [BindProperty] public string SmtpHost { get; set; } = "";
    [BindProperty] public int SmtpPort { get; set; } = 465;
    public string? Error { get; private set; }
    public bool HasAuthCode { get; private set; }

    public EmailProviderPreset[] Presets => EmailProviders.All;

    public async Task<IActionResult> OnGetAsync(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var ac = await _db.EmailAccounts.FirstOrDefaultAsync(a => a.Id == id && a.UserId == uid);
        if (ac is null) return NotFound();   // 越权 = 404

        Id = ac.Id;
        DisplayName = ac.DisplayName;
        Address = ac.Address;
        Provider = ac.Provider;
        ImapHost = ac.ImapHost;
        ImapPort = ac.ImapPort;
        SmtpHost = ac.SmtpHost;
        SmtpPort = ac.SmtpPort;
        HasAuthCode = !string.IsNullOrEmpty(ac.AuthCodeEnc);
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var ac = await _db.EmailAccounts.FirstOrDefaultAsync(a => a.Id == id && a.UserId == uid);
        if (ac is null) return NotFound();

        Id = ac.Id;
        HasAuthCode = !string.IsNullOrEmpty(ac.AuthCodeEnc);

        if (string.IsNullOrWhiteSpace(DisplayName)) { Error = "请填显示名称。"; return Page(); }
        if (string.IsNullOrWhiteSpace(Address) || !Address.Contains('@')) { Error = "邮箱地址格式不对。"; return Page(); }
        if (string.IsNullOrWhiteSpace(ImapHost)) { Error = "IMAP 服务器不能为空。"; return Page(); }

        ac.DisplayName = DisplayName.Trim();
        ac.Address = Address.Trim();
        ac.Provider = EmailProviders.Find(Provider) is null ? "custom" : Provider;
        ac.ImapHost = ImapHost.Trim();
        ac.ImapPort = ImapPort > 0 ? ImapPort : 993;
        ac.SmtpHost = SmtpHost?.Trim() ?? "";
        ac.SmtpPort = SmtpPort > 0 ? SmtpPort : 465;
        // 授权码留空 = 不动旧的；填了 = 换新（重新加密）
        if (!string.IsNullOrWhiteSpace(AuthCode))
        {
            ac.AuthCodeEnc = _crypto.Encrypt(AuthCode.Trim());
            ac.LastSyncError = "";   // 换了授权码，之前的鉴权错误一笔勾销
        }
        await _db.SaveChangesAsync();
        return RedirectToPage("/Email/Accounts", new { note = "账号已更新。" });
    }

    public async Task<IActionResult> OnPostDeleteAsync(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var ac = await _db.EmailAccounts.FirstOrDefaultAsync(a => a.Id == id && a.UserId == uid);
        if (ac is null) return NotFound();
        _db.EmailAccounts.Remove(ac);   // 缓存信件跟着级联删除
        await _db.SaveChangesAsync();
        return RedirectToPage("/Email/Accounts", new { note = "账号已删除。" });
    }
}
