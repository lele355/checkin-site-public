namespace CheckinApp.Services;

/// <summary>邮箱平台预设 —— 选平台自动填服务器地址，用户只用填邮箱和授权码。</summary>
public record EmailProviderPreset(string Key, string Label, string ImapHost, int ImapPort, string SmtpHost, int SmtpPort);

public static class EmailProviders
{
    public static readonly EmailProviderPreset[] All =
    [
        new("qq",      "QQ 邮箱",      "imap.qq.com",        993, "smtp.qq.com",        465),
        new("163",     "163 邮箱",     "imap.163.com",       993, "smtp.163.com",       465),
        new("126",     "126 邮箱",     "imap.126.com",       993, "smtp.126.com",       465),
        new("yeah",    "Yeah 邮箱",    "imap.yeah.net",      993, "smtp.yeah.net",      465),
        new("gmail",   "Gmail",        "imap.gmail.com",     993, "smtp.gmail.com",     465),
        new("outlook", "Outlook/Hotmail", "outlook.office365.com", 993, "smtp.office365.com", 587),
        new("139",     "139 邮箱",     "imap.10086.cn",      993, "smtp.10086.cn",      465),
        new("189",     "189 邮箱",     "imap.189.cn",        993, "smtp.189.cn",        465),
        new("custom",  "其它（自定义）", "",                  993, "",                   465),
    ];

    public static EmailProviderPreset? Find(string key) =>
        All.FirstOrDefault(p => p.Key.Equals(key, StringComparison.OrdinalIgnoreCase));

    public static string LabelOf(string key) => Find(key)?.Label ?? key;
}
