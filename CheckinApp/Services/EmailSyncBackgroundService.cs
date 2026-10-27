using CheckinApp.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CheckinApp.Services;

/// <summary>
/// 后台定时同步：每隔 N 分钟把所有绑定账号拉一遍新信（默认 10 分钟）。
/// 同步失败只记在账号的 LastSyncError 上，循环本身绝不死。
/// </summary>
public class EmailSyncBackgroundService(IServiceScopeFactory factory, IOptions<EmailOptions> opt) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var interval = TimeSpan.FromMinutes(Math.Clamp(opt.Value.SyncIntervalMinutes, 2, 1440));
        try { await Task.Delay(TimeSpan.FromSeconds(30), ct); } catch (OperationCanceledException) { return; }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = factory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sync = scope.ServiceProvider.GetRequiredService<EmailSyncService>();
                var accounts = await db.EmailAccounts
                    .Select(a => new { a.Id, a.UserId })
                    .ToListAsync(ct);
                foreach (var a in accounts)
                {
                    if (ct.IsCancellationRequested) break;
                    await sync.SyncAsync(a.Id, a.UserId, ct);
                }
            }
            catch (OperationCanceledException) { break; }
            catch { /* 兜底：任何意外都不能让同步循环死掉 */ }

            try { await Task.Delay(interval, ct); } catch (OperationCanceledException) { break; }
        }
    }
}
