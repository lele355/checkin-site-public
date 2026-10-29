using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Reminders;

/// <summary>
/// 提醒 —— 把散在各模块的近期事项聚合成一张清单（站内提醒，不依赖外部推送服务），
/// 另可选「每日邮件提醒」：到点把同一份摘要发到邮箱（复用已绑定邮箱的 SMTP）。
/// </summary>
[Authorize(Policy = "perm:reminders.use")]
public class IndexModel(AppDbContext db, CurrentUser me, DailyReminderMailer mailer) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly DailyReminderMailer _mailer = mailer;

    public List<ReminderItem> Items { get; set; } = [];
    public int TodayHabitDone { get; set; }
    public int TodayHabitTotal { get; set; }

    // ---------- 每日邮件提醒 ----------
    public bool CanMail => _me.Has("email.use");
    public List<EmailAccount> MailAccounts { get; private set; } = [];

    [BindProperty] public bool MailEnabled { get; set; }
    [BindProperty] public int MailHour { get; set; } = 8;
    [BindProperty] public string MailToAddress { get; set; } = "";
    [BindProperty] public int? MailAccountId { get; set; }

    public DateTime? MailLastSent { get; private set; }
    public string MailLastError { get; private set; } = "";
    public MailReminderSetting? MailSetting { get; private set; }

    public void OnGet()
    {
        if (_me.UserId is not int uid) return;

        var digest = ReminderBuilder.Build(_db, uid, _me.PermissionCodes().ToHashSet());
        Items = digest.Items.Where(i => i.Kind != "置顶").ToList();   // 站内清单不重复展示置顶备忘（页面有独立模块）
        TodayHabitDone = digest.TodayHabitDone;
        TodayHabitTotal = digest.TodayHabitTotal;

        LoadMail(uid);
    }

    private void LoadMail(int uid)
    {
        if (!CanMail) return;

        MailAccounts = _db.EmailAccounts.Where(a => a.UserId == uid).OrderBy(a => a.Id).ToList();
        MailSetting = _db.MailReminderSettings.FirstOrDefault(s => s.UserId == uid);
        if (MailSetting is not null)
        {
            MailEnabled = MailSetting.Enabled;
            MailHour = MailSetting.Hour;
            MailToAddress = MailSetting.ToAddress;
            MailAccountId = MailSetting.AccountId ?? MailAccounts.FirstOrDefault()?.Id;
            MailLastSent = MailSetting.LastSentDate;
            MailLastError = MailSetting.LastError;
        }
        else
        {
            MailHour = 8;
            MailAccountId = MailAccounts.FirstOrDefault()?.Id;
        }
    }

    /// <summary>保存每日邮件提醒设置（不发送）。</summary>
    public IActionResult OnPostMail()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (!CanMail)
        {
            TempData["Err"] = "当前角色没有邮件权限，无法使用邮件提醒。";
            return RedirectToPage();
        }

        var err = Validate(uid, out var account);
        if (err is not null)
        {
            TempData["Err"] = err;
            return RedirectToPage();
        }

        var s = _db.MailReminderSettings.FirstOrDefault(x => x.UserId == uid);
        if (s is null)
        {
            s = new MailReminderSetting { UserId = uid };
            _db.MailReminderSettings.Add(s);
        }
        s.Enabled = MailEnabled;
        s.Hour = Math.Clamp(MailHour, 0, 23);
        s.ToAddress = (MailToAddress ?? "").Trim();
        s.AccountId = account!.Id;
        s.UpdatedAt = DateTime.UtcNow;
        if (!MailEnabled) s.LastError = "";
        _db.SaveChanges();

        TempData["Ok"] = MailEnabled
            ? $"已开启：每天 {s.Hour:00}:00 把提醒摘要发到 {EffectiveTo(s, account)}。"
            : "已关闭每日邮件提醒。";
        return RedirectToPage();
    }

    /// <summary>立刻发一封「今天这封」给当前设置，用于验证授权码/SMTP 是否通。</summary>
    public async Task<IActionResult> OnPostSendTestAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (!CanMail)
        {
            TempData["Err"] = "当前角色没有邮件权限，无法发送。";
            return RedirectToPage();
        }

        var err = Validate(uid, out var account);
        if (err is not null)
        {
            TempData["Err"] = err;
            return RedirectToPage();
        }

        var to = (MailToAddress ?? "").Trim();
        if (to.Length == 0) to = account!.Address;
        var (ok, error) = await _mailer.SendAsync(uid, account!.Id, to);
        TempData[ok ? "Ok" : "Err"] = ok
            ? $"测试邮件已发出，请查收（可能在垃圾邮件里）。收件人：{to}"
            : "测试发送失败：" + error;
        return RedirectToPage();
    }

    /// <summary>预览这封邮件长什么样（JSON，页面用 &lt;pre&gt; 展示纯文本版）。</summary>
    public IActionResult OnGetPreview()
    {
        if (_me.UserId is not int uid) return new UnauthorizedResult();
        if (!CanMail) return new BadRequestResult();
        var mail = _mailer.Build(uid);
        return new JsonResult(new { ok = true, subject = mail.Subject, text = mail.Text });
    }

    /// <summary>校验：有账号、账号是自己的、收件地址格式对。返回 null = 通过。</summary>
    private string? Validate(int uid, out EmailAccount? account)
    {
        account = null;
        if (MailAccountId is not int aid)
            return "还没有可用的发信邮箱：请先到「邮件」页绑定一个邮箱账号（发信要用它的 SMTP 授权码）。";

        account = _db.EmailAccounts.FirstOrDefault(a => a.Id == aid && a.UserId == uid);
        if (account is null) return "选中的发信邮箱不存在或不属于你，请重新选择。";
        if (string.IsNullOrWhiteSpace(account.SmtpHost)) return "这个邮箱账号还没配 SMTP 服务器，请到「邮件 → 账号管理」补上。";

        var to = (MailToAddress ?? "").Trim();
        if (to.Length > 0)
        {
            var at = to.IndexOf('@');
            if (to.Length > 120 || at <= 0 || at == to.Length - 1 || to.Any(char.IsWhiteSpace) || !to[(at + 1)..].Contains('.'))
                return "收件邮箱格式不对，示例：you@example.com（留空则发到发信账号自己）。";
        }
        return null;
    }

    private static string EffectiveTo(MailReminderSetting s, EmailAccount? account)
        => string.IsNullOrWhiteSpace(s.ToAddress) ? account?.Address ?? "-" : s.ToAddress.Trim();
}
