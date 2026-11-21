using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CheckinApp.Api;

/// <summary>
/// 健康数据 API —— 绑定管理（QR 扫码）、日汇总查询、手动同步、bridge 机器通道。
/// 数据围栏：谁的账号谁看，账号内所有绑定均可见（一账号可绑多个小米号）。
/// </summary>
public static class HealthApi
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/health").RequireAuthorization("perm:health.use");

        // ---------- 绑定 ----------
        g.MapGet("/bindings", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var items = db.HealthBindings.Where(b => b.UserId == uid).OrderBy(b => b.Id).ToList()
                .Select(b => new
                {
                    id = b.Id, displayName = b.DisplayName, ownerName = b.OwnerName,
                    miUserId = b.MiUserId, status = b.Status,
                    lastSyncAt = ApiKit.TN(b.LastSyncAt), lastSyncError = b.LastSyncError,
                    createdAt = ApiKit.T(b.CreatedAt),
                });
            return ApiKit.Ok(new { items });
        });

        // QR 发起：建 pending 绑定 → bridge 生成二维码
        g.MapPost("/bindings/qr", async (AppDbContext db, HttpContext ctx, IHttpClientFactory httpFactory, IOptions<HealthOptions> opt) =>
        {
            var uid = ApiKit.MeId(ctx);
            var o = opt.Value;
            var http = httpFactory.CreateClient("health-bridge");
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{o.BridgeBaseUrl.TrimEnd('/')}/api/bindings/qr/start");
            if (o.BridgeToken.Length > 0) req.Headers.Authorization = new("Bearer", o.BridgeToken);
            using var resp = await http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
                return ApiKit.Err($"二维码服务暂不可用（bridge HTTP {(int)resp.StatusCode}）", 502);
            using var doc = System.Text.Json.JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var d = doc.RootElement;

            var binding = new HealthBinding
            {
                UserId = uid,
                BridgeBindingKey = d.GetProperty("binding_id").GetString() ?? "",
                DisplayName = "新的绑定",
                Status = "pending",
            };
            db.HealthBindings.Add(binding);
            await db.SaveChangesAsync();
            return ApiKit.Ok(new
            {
                id = binding.Id,
                bindingId = binding.BridgeBindingKey,
                qrPng = d.GetProperty("qr_png").GetString(),
                loginUrl = d.TryGetProperty("login_url", out var lu) ? lu.GetString() : "",
                expiresAt = d.TryGetProperty("expires_at", out var ea) ? ea.GetString() : "",
            });
        });

        // QR 状态轮询（App 2s 一次）：succeeded 时转 active 并触发首拉
        g.MapGet("/bindings/{id:int}/status", async (int id, AppDbContext db, HttpContext ctx, IHttpClientFactory httpFactory, IOptions<HealthOptions> opt) =>
        {
            var uid = ApiKit.MeId(ctx);
            var b = db.HealthBindings.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (b is null) return ApiKit.NotFound("绑定不存在");
            if (b.Status == "active") return ApiKit.Ok(new { status = "active", miUserId = b.MiUserId });

            var o = opt.Value;
            var http = httpFactory.CreateClient("health-bridge");
            var url = $"{o.BridgeBaseUrl.TrimEnd('/')}/api/bindings/qr/status?binding_id={Uri.EscapeDataString(b.BridgeBindingKey)}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (o.BridgeToken.Length > 0) req.Headers.Authorization = new("Bearer", o.BridgeToken);
            using var resp = await http.SendAsync(req);
            if (!resp.IsSuccessStatusCode) return ApiKit.Err("bridge 暂不可用", 502);
            using var doc = System.Text.Json.JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var st = doc.RootElement.GetProperty("status").GetString() ?? "unknown";
            var miUser = doc.RootElement.TryGetProperty("mi_user_id", out var m) ? m.GetString() ?? "" : "";

            if (st == "succeeded")
            {
                b.Status = "active";
                b.MiUserId = miUser;
                b.DisplayName = string.IsNullOrEmpty(b.DisplayName) || b.DisplayName == "新的绑定"
                    ? "小米手环" : b.DisplayName;
                b.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
                // 首拉放后台：bridge 首采也才刚起跑，阻塞在这只会让绿灯迟到
                _ = Task.Run(async () =>
                {
                    try
                    {
                        using var scope = app.Services.CreateScope();
                        var sp = scope.ServiceProvider;
                        var db2 = sp.GetRequiredService<AppDbContext>();
                        var b2 = db2.HealthBindings.FirstOrDefault(x => x.Id == id);   // 新上下文重载，别用请求里的实体
                        if (b2 is null) return;
                        var sync2 = new HealthSyncService(db2, sp.GetRequiredService<IHttpClientFactory>(), opt);
                        await sync2.SyncCoreAsync(b2, forceLookback: true, default);
                    }
                    catch { /* 后台首拉失败由定时同步兜底 */ }
                });
                return ApiKit.Ok(new { status = "active", miUserId = b.MiUserId });
            }
            if (st is "expired" or "failed")
            {
                b.Status = "expired";
                b.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
            return ApiKit.Ok(new { status = st, miUserId = miUser });
        });

        // 改名（DisplayName / OwnerName）
        g.MapPatch("/bindings/{id:int}", async (int id, RenameReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var b = db.HealthBindings.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (b is null) return ApiKit.NotFound("绑定不存在");
            if (req.DisplayName is not null)
            {
                var n = req.DisplayName.Trim();
                if (n.Length > 20) n = n[..20];
                if (n.Length > 0) b.DisplayName = n;
            }
            if (req.OwnerName is not null)
            {
                var n = req.OwnerName.Trim();
                if (n.Length > 12) n = n[..12];
                b.OwnerName = n;
            }
            b.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return ApiKit.Ok();
        });

        // 解绑：删行（级联清日汇总）+ 调 bridge 删 session/停采/清观测
        g.MapDelete("/bindings/{id:int}", async (int id, AppDbContext db, HttpContext ctx, IHttpClientFactory httpFactory, IOptions<HealthOptions> opt) =>
        {
            var uid = ApiKit.MeId(ctx);
            var b = db.HealthBindings.FirstOrDefault(x => x.Id == id && x.UserId == uid);
            if (b is null) return ApiKit.NotFound("绑定不存在");
            var key = b.BridgeBindingKey;
            db.HealthBindings.Remove(b);   // HealthDaily 级联删除
            await db.SaveChangesAsync();

            // bridge 侧清理转后台：阻塞在这（bridge 不可达要等满超时）会让解绑按钮转半天圈
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = app.Services.CreateScope();
                    var o2 = scope.ServiceProvider.GetRequiredService<IOptions<HealthOptions>>().Value;
                    var http2 = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>().CreateClient("health-bridge");
                    using var req2 = new HttpRequestMessage(HttpMethod.Delete,
                        $"{o2.BridgeBaseUrl.TrimEnd('/')}/api/bindings/{Uri.EscapeDataString(key)}");
                    if (o2.BridgeToken.Length > 0) req2.Headers.Authorization = new("Bearer", o2.BridgeToken);
                    await http2.SendAsync(req2);
                }
                catch { /* bridge 清理失败也无妨：本地已解绑，残留 session 下次绑定时人工清 */ }
            });
            return ApiKit.Ok();
        });

        // ---------- 日汇总 ----------
        g.MapGet("/daily", async (string? from, string? to, int? binding, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var f = DateTime.TryParse(from, out var fd) ? fd.Date : DateTime.Today.AddDays(-6);
            var t = DateTime.TryParse(to, out var td) ? td.Date : DateTime.Today;
            var q = db.HealthDailies.Where(d => d.UserId == uid && d.Date >= f && d.Date <= t);
            if (binding is int bid) q = q.Where(d => d.BindingId == bid);
            var rows = await q.OrderBy(d => d.Date).ThenBy(d => d.BindingId).ToListAsync();

            var names = await db.HealthBindings.Where(b => b.UserId == uid)
                .ToDictionaryAsync(b => b.Id, b => string.IsNullOrEmpty(b.OwnerName) ? b.DisplayName : b.OwnerName);
            // 手填体重同天优先（手填是用户真值）
            var manual = await db.HealthWeightLogs
                .Where(w => w.UserId == uid && w.Date >= f && w.Date <= t)
                .ToDictionaryAsync(w => w.Date, w => w.WeightKg);
            var items = rows.Select(d => new
            {
                date = ApiKit.D(d.Date), bindingId = d.BindingId,
                bindingName = names.GetValueOrDefault(d.BindingId, ""),
                steps = d.Steps, distanceM = Math.Round(d.DistanceM, 1),
                caloriesTotal = Math.Round(d.CaloriesTotal, 1), caloriesActive = Math.Round(d.CaloriesActive, 1),
                activityCount = d.ActivityCount, activityMinutes = d.ActivityMinutes,
                hrAvg = Math.Round(d.HrAvg, 1), hrMax = d.HrMax, hrMin = d.HrMin, hrResting = Math.Round(d.HrResting, 1),
                spo2Avg = Math.Round(d.Spo2Avg, 1), stressAvg = Math.Round(d.StressAvg, 1),
                sleepMinutes = d.SleepMinutes, sleepScore = Math.Round(d.SleepScore, 1),
                sleepStart = d.SleepStartAt is null ? null :
                    new DateTimeOffset(d.SleepStartAt.Value, TimeSpan.Zero).ToOffset(TimeSpan.FromHours(8)).ToString("HH:mm"),
                sleepEnd = d.SleepEndAt is null ? null :
                    new DateTimeOffset(d.SleepEndAt.Value, TimeSpan.Zero).ToOffset(TimeSpan.FromHours(8)).ToString("HH:mm"),
                sleepDeepMin = d.SleepDeepMin, sleepLightMin = d.SleepLightMin,
                sleepRemMin = d.SleepRemMin, sleepAwakeMin = d.SleepAwakeMin,
                stressRelaxedMin = d.StressRelaxedMin, stressMildMin = d.StressMildMin,
                stressModerateMin = d.StressModerateMin, stressSevereMin = d.StressSevereMin,
                weightKg = manual.TryGetValue(d.Date, out var mw) ? mw : d.WeightKg,
                weightManual = manual.ContainsKey(d.Date),
                workoutCount = d.WorkoutCount,
            });
            return ApiKit.Ok(new
            {
                items,
                totals = new
                {
                    steps = rows.Sum(d => d.Steps),
                    sleepMinutes = rows.Sum(d => d.SleepMinutes),
                    workouts = rows.Sum(d => d.WorkoutCount),
                },
            });
        });

        // ---------- 小时聚合（二级详情页：当日心率/血氧曲线） ----------
        g.MapGet("/hourly", async (string date, int? binding, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var d = DateTime.TryParse(date, out var dd) ? dd.Date : DateTime.Today;
            var q = db.HealthHourlies.Where(x => x.UserId == uid && x.Date == d);
            if (binding is int bid) q = q.Where(x => x.BindingId == bid);
            var items = await q.OrderBy(x => x.Hour).ThenBy(x => x.BindingId).ToListAsync();
            return ApiKit.Ok(new
            {
                items = items.Select(x => new
                {
                    hour = x.Hour, bindingId = x.BindingId,
                    hrMin = Math.Round(x.HrMin, 1), hrMax = Math.Round(x.HrMax, 1),
                    hrAvg = Math.Round(x.HrAvg, 1), hrPoints = x.HrPoints,
                    spo2Avg = Math.Round(x.Spo2Avg, 1), spo2Points = x.Spo2Points,
                }),
            });
        });

        // ---------- 体重（手填 + 设备合并序列；手填同天优先） ----------
        g.MapGet("/weight", async (string? from, string? to, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var f = DateTime.TryParse(from, out var fd) ? fd.Date : DateTime.Today.AddDays(-29);
            var t = DateTime.TryParse(to, out var td) ? td.Date : DateTime.Today;
            var manual = await db.HealthWeightLogs
                .Where(w => w.UserId == uid && w.Date >= f && w.Date <= t)
                .ToDictionaryAsync(w => w.Date, w => w.WeightKg);
            var device = await db.HealthDailies
                .Where(d => d.UserId == uid && d.Date >= f && d.Date <= t && d.WeightKg > 0)
                .GroupBy(d => d.Date)
                .Select(g => new { Date = g.Key, W = g.Max(x => x.WeightKg) })
                .ToDictionaryAsync(x => x.Date, x => x.W);
            var dates = manual.Keys.Union(device.Keys).OrderBy(x => x);
            return ApiKit.Ok(new
            {
                items = dates.Select(d => new
                {
                    date = ApiKit.D(d),
                    weightKg = manual.TryGetValue(d, out var mw) ? mw : device[d],
                    manual = manual.ContainsKey(d),
                }),
            });
        });

        g.MapPost("/weight", async (WeightReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            if (!DateTime.TryParse(req.Date, out var d)) return ApiKit.Err("日期格式不对");
            if (req.WeightKg is < 20 or > 400) return ApiKit.Err("体重范围 20~400 kg");
            var row = await db.HealthWeightLogs.FirstOrDefaultAsync(w => w.UserId == uid && w.Date == d.Date);
            if (row is null)
            {
                db.HealthWeightLogs.Add(new HealthWeightLog { UserId = uid, Date = d.Date, WeightKg = req.WeightKg });
            }
            else row.WeightKg = req.WeightKg;
            await db.SaveChangesAsync();
            return ApiKit.Ok();
        });

        // ---------- 同步 ----------
        g.MapPost("/sync", async (AppDbContext db, HttpContext ctx, HealthSyncService sync) =>
        {
            var uid = ApiKit.MeId(ctx);
            // 手动同步 = 强制回看：补新字段历史、断档自愈
            var results = await sync.SyncAllAsync(uid, forceLookback: true);
            return ApiKit.Ok(new { results });
        });

        // ---------- 机器通道：bridge webhook（无用户授权，共享密钥比对） ----------
        app.MapPost("/api/v1/health/bridge-notify", async (HttpContext ctx, HttpRequest req, IOptions<HealthOptions> opt, IServiceScopeFactory factory) =>
        {
            var token = req.Headers["X-Mi-Health-Token"].FirstOrDefault() ?? "";
            if (opt.Value.WebhookToken.Length == 0 || token != opt.Value.WebhookToken)
                return ApiKit.Err("bad token", 401);
            // 只做即时触发：丢一条通知无所谓，下轮定时补拉自愈
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = factory.CreateScope();
                    var sync = scope.ServiceProvider.GetRequiredService<HealthSyncService>();
                    await sync.SyncAllAsync();
                }
                catch { /* 异步触发失败不影响 webhook 响应 */ }
            });
            return ApiKit.Ok();
        }).AllowAnonymous();
    }

    public record RenameReq(string? DisplayName, string? OwnerName);
    public record WeightReq(string? Date, double WeightKg);
}
