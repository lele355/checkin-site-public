using CheckinApp.Data;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 每日邮件提醒的后台定时器：每分钟醒一次，把「当前整点 + 今天还没发过」的用户挑出来发信。
/// 用「整点匹配 + LastSentDate 去重」而不是精确到分钟，避免错过一分钟就整天不发。
/// 任何异常都吞掉，绝不让循环死（与 EmailSyncBackgroundService 同一套兜底策略）。
/// </summary>
public class DailyMailBackgroundService(IServiceScopeFactory factory, ILogger<DailyMailBackgroundService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // 启动时错开 45 秒，别和邮件同步、迁移抢着跑
        try { await Task.Delay(TimeSpan.FromSeconds(45), ct); } catch (OperationCanceledException) { return; }

        while (!ct.IsCancellationRequested)
        {
            try { await TickAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "每日邮件提醒轮询失败（已忽略，下一分钟重试）"); }

            try { await Task.Delay(TimeSpan.FromSeconds(60), ct); } catch (OperationCanceledException) { break; }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        using var scope = factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var mailer = scope.ServiceProvider.GetRequiredService<DailyReminderMailer>();

        var now = DateTime.Now;
        var hour = now.Hour;
        var today = now.Date;

        var due = await db.MailReminderSettings
            .Where(s => s.Enabled && s.Hour == hour && (s.LastSentDate == null || s.LastSentDate < today))
            .ToListAsync(ct);
        if (due.Count == 0) return;

        foreach (var s in due)
        {
            if (ct.IsCancellationRequested) break;
            if (s.AccountId is not int accountId)
            {
                s.LastError = "还没有选择发信邮箱";
                s.UpdatedAt = DateTime.UtcNow;
                continue;
            }

            var (ok, err) = await mailer.SendAsync(s.UserId, accountId, s.ToAddress, ct);
            s.LastError = ok ? "" : err;
            s.UpdatedAt = DateTime.UtcNow;
            // 成功才推进日期；失败保持原状，下一个整点还会重试（同一小时内每分钟一次）
            if (ok) s.LastSentDate = today;
            else logger.LogInformation("每日提醒发送失败 userId={uid}: {err}", s.UserId, err);

            await db.SaveChangesAsync(ct);
        }
    }
}
