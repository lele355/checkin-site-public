using CheckinApp.Data;
using Microsoft.Extensions.Options;

namespace CheckinApp.Services;

/// <summary>
/// 后台定时增量：每隔 N 分钟把全部 active 绑定从 bridge 拉一遍（默认 10 分钟）。
/// 单绑定失败只记 LastSyncError，循环本身绝不死。
/// </summary>
public class HealthSyncBackgroundService(IServiceScopeFactory factory, IOptions<HealthOptions> opt) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var interval = TimeSpan.FromMinutes(Math.Clamp(opt.Value.SyncIntervalMinutes, 2, 1440));
        try { await Task.Delay(TimeSpan.FromSeconds(45), ct); } catch (OperationCanceledException) { return; }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = factory.CreateScope();
                var sync = scope.ServiceProvider.GetRequiredService<HealthSyncService>();
                await sync.SyncAllAsync(ct: ct);
            }
            catch (OperationCanceledException) { break; }
            catch { /* 兜底：任何意外都不能让同步循环死掉 */ }

            try { await Task.Delay(interval, ct); } catch (OperationCanceledException) { break; }
        }
    }
}
