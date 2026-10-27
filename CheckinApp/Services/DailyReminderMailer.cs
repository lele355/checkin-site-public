using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 每日提醒邮件的「组装 + 发送」—— 后台定时任务和页面上的「发送测试」走同一条路径，
/// 保证测试收到的就是以后每天会收到的那封。
/// </summary>
public class DailyReminderMailer(AppDbContext db, MailSender sender, IConfiguration cfg)
{
    private readonly AppDbContext _db = db;
    private readonly MailSender _sender = sender;

    /// <summary>邮件里的跳转根地址（配置 App:PublicUrl 优先，本地开发回落 localhost）</summary>
    public string PublicUrl
    {
        get
        {
            var u = cfg["App:PublicUrl"];
            if (!string.IsNullOrWhiteSpace(u)) return u.TrimEnd('/');
            return "http://localhost:5188";
        }
    }

    /// <summary>按当前数据生成这封邮件（不发送）。</summary>
    public (string Subject, string Text, string Html) Build(int userId)
    {
        var user = _db.Users.Include(u => u.Role).FirstOrDefault(u => u.Id == userId);
        var name = user?.DisplayName ?? "你";

        // 后台没有 HttpContext：权限码直接从角色-权限桥表取
        var perms = user is null
            ? new HashSet<string>()
            : _db.RolePermissions.Where(rp => rp.RoleId == user.RoleId)
                                 .Select(rp => rp.Permission!.Code)
                                 .ToHashSet();

        var digest = ReminderBuilder.Build(_db, userId, perms);
        return ReminderBuilder.Render(digest, name, PublicUrl, DateTime.Today);
    }

    /// <summary>发一封到指定邮箱。accountId 必须是该用户自己的账号（越权直接拒）。</summary>
    public async Task<(bool Ok, string Error)> SendAsync(int userId, int accountId, string toAddress, CancellationToken ct = default)
    {
        var ac = await _db.EmailAccounts.FirstOrDefaultAsync(a => a.Id == accountId && a.UserId == userId, ct);
        if (ac is null) return (false, "找不到可用的发信邮箱，请先在「邮件」里绑定一个账号。");

        var mail = Build(userId);
        return await _sender.SendAsync(ac, toAddress, mail.Subject, mail.Text, mail.Html, ct);
    }
}
