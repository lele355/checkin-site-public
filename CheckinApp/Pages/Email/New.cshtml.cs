using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Email;

/// <summary>绑定新邮箱 —— 选平台自动填服务器，用户只填邮箱地址 + 授权码。</summary>
[Authorize(Policy = "perm:email.use")]
public class NewModel(AppDbContext db, CurrentUser me, EmailCrypto crypto) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly EmailCrypto _crypto = crypto;

    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public string Address { get; set; } = "";
    [BindProperty] public string Provider { get; set; } = "qq";
    [BindProperty] public string AuthCode { get; set; } = "";
    [BindProperty] public string ImapHost { get; set; } = "";
    [BindProperty] public int ImapPort { get; set; } = 993;
    [BindProperty] public string SmtpHost { get; set; } = "";
    [BindProperty] public int SmtpPort { get; set; } = 465;
    public string? Error { get; private set; }

    public EmailProviderPreset[] Presets => EmailProviders.All;

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        if (string.IsNullOrWhiteSpace(DisplayName)) { Error = "请填显示名称（比如「QQ 主邮箱」）。"; return Page(); }
        if (string.IsNullOrWhiteSpace(Address) || !Address.Contains('@')) { Error = "邮箱地址格式不对。"; return Page(); }
        if (string.IsNullOrWhiteSpace(AuthCode)) { Error = "请填授权码（不是登录密码！去邮箱设置里开启 IMAP 并生成授权码）。"; return Page(); }

        // 用户没手填服务器就用平台预设兜底
        var preset = EmailProviders.Find(Provider);
        if (string.IsNullOrWhiteSpace(ImapHost) && preset is not null && preset.ImapHost.Length > 0)
        {
            ImapHost = preset.ImapHost;
            ImapPort = preset.ImapPort;
            SmtpHost = preset.SmtpHost;
            SmtpPort = preset.SmtpPort;
        }
        if (string.IsNullOrWhiteSpace(ImapHost)) { Error = "平台预设没带服务器地址，请手动填 IMAP 服务器。"; return Page(); }

        _db.EmailAccounts.Add(new EmailAccount
        {
            UserId = uid,
            DisplayName = DisplayName.Trim(),
            Address = Address.Trim(),
            Provider = EmailProviders.Find(Provider) is null ? "custom" : Provider,
            ImapHost = ImapHost.Trim(),
            ImapPort = ImapPort > 0 ? ImapPort : 993,
            SmtpHost = SmtpHost?.Trim() ?? "",
            SmtpPort = SmtpPort > 0 ? SmtpPort : 465,
            AuthCodeEnc = _crypto.Encrypt(AuthCode.Trim()),
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();
        return RedirectToPage("/Email/Accounts", new { note = "账号已绑定，点「同步」拉取第一封信试试。" });
    }
}
