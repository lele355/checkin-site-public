using System.Text.Json;
using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CheckinApp.Services;

/// <summary>
/// 健康数据摄入：按 SyncCursor 从 bridge 增量拉观测，按天合并进 HealthDaily。
/// 同一份云端数据 bridge 已幂等去重，这里按「域 → 日汇总列」last-wins 合并 ——
/// 重复摄入同值覆盖，天然幂等。原始采样（逐秒心率）不进本站，留在 bridge。
/// </summary>
public class HealthSyncService(AppDbContext db, IHttpClientFactory httpFactory, IOptions<HealthOptions> opt)
{
    public record SyncOutcome(bool Ok, int DaysTouched, string Error);

    /// <summary>bridge 观测 data 里日期字段取不到时的兜底：按 ts 的日期部分。</summary>
    private static DateTime RowDate(string domain, JsonElement data, string ts)
    {
        if (data.ValueKind == JsonValueKind.Object)
        {
            // 日汇总域都带 "date":"YYYY-MM-DD"；weight/workouts 带 time/epoch_s
            foreach (var key in new[] { "date", "time", "start_time" })
            {
                if (data.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                {
                    if (DateTime.TryParse(v.GetString(), out var d)) return d.Date;
                }
            }
            if (data.TryGetProperty("epoch_s", out var e) && e.ValueKind == JsonValueKind.Number)
                return DateTimeOffset.FromUnixTimeSeconds(e.GetInt64()).ToOffset(TimeSpan.FromHours(8)).Date;
        }
        return DateTime.TryParse(ts, out var t) ? t.Date : DateTime.MinValue;
    }

    private static double Num(JsonElement data, params string[] keys)
    {
        foreach (var k in keys)
            if (data.ValueKind == JsonValueKind.Object && data.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number)
                return v.GetDouble();
        return 0;
    }

    /// <summary>把一条 bridge 观测合进当天的 HealthDaily 行（按域分发到列）。</summary>
    private static void Merge(HealthDaily day, string domain, JsonElement data)
    {
        switch (domain)
        {
            case "steps":
                day.Steps = (int)Num(data, "steps");
                day.DistanceM = Num(data, "distance_m");
                break;
            case "consumption":
                day.CaloriesTotal = Num(data, "total_kcal");
                day.CaloriesActive = Num(data, "active_kcal");
                break;
            case "activity_daily":
                day.ActivityCount = (int)Num(data, "activity_count");
                day.ActivityMinutes = (int)Num(data, "activity_min");
                break;
            case "heart_rate_daily":
                day.HrAvg = Num(data, "avg_bpm");
                day.HrMax = Num(data, "max_bpm");
                day.HrMin = Num(data, "min_bpm");
                day.HrResting = Num(data, "resting_bpm");
                break;
            case "spo2_daily":
                day.Spo2Avg = Num(data, "avg_spo2_pct");
                break;
            case "sleep":
                day.SleepMinutes = (int)Num(data, "asleep_min");
                day.SleepScore = Num(data, "sleep_score", "score");   // 目前仅 raw 有，0=无
                day.SleepDeepMin = (int)Num(data, "deep_min");
                day.SleepLightMin = (int)Num(data, "light_min");
                day.SleepRemMin = (int)Num(data, "rem_min");
                day.SleepAwakeMin = (int)Num(data, "awake_min");
                // 起止时刻：sessions 的最早 start / 最晚 end（存 UTC，显示转 +8）
                if (data.TryGetProperty("sessions", out var ss) && ss.ValueKind == JsonValueKind.Array)
                {
                    long? lo = null, hi = null;
                    foreach (var s in ss.EnumerateArray())
                    {
                        if (s.TryGetProperty("start_epoch_s", out var a) && a.ValueKind == JsonValueKind.Number)
                            lo = lo is null ? a.GetInt64() : Math.Min(lo.Value, a.GetInt64());
                        if (s.TryGetProperty("end_epoch_s", out var b2) && b2.ValueKind == JsonValueKind.Number)
                            hi = hi is null ? b2.GetInt64() : Math.Max(hi.Value, b2.GetInt64());
                    }
                    if (lo is not null) day.SleepStartAt = DateTimeOffset.FromUnixTimeSeconds(lo.Value).UtcDateTime;
                    if (hi is not null) day.SleepEndAt = DateTimeOffset.FromUnixTimeSeconds(hi.Value).UtcDateTime;
                }
                break;
            case "stress_daily":
                day.StressAvg = Num(data, "avg_stress_level");
                day.StressRelaxedMin = (int)Num(data, "relaxed_min");
                day.StressMildMin = (int)Num(data, "mild_min");
                day.StressModerateMin = (int)Num(data, "moderate_min");
                day.StressSevereMin = (int)Num(data, "severe_min");
                break;
            case "weight":
                // 一天可能多次称重：保留最新一条（bridge 按 collected_at 升序送）
                day.WeightKg = Num(data, "weight", "weight_kg");
                break;
            case "workouts":
                day.WorkoutCount += 1;   // 每条观测 = 一次训练
                break;
        }
    }

    public async Task<SyncOutcome> SyncAsync(int bindingId, int userId, CancellationToken ct = default)
    {
        var binding = await db.HealthBindings
            .FirstOrDefaultAsync(b => b.Id == bindingId && b.UserId == userId, ct);
        if (binding is null) return new SyncOutcome(false, 0, "绑定不存在");
        return await SyncCoreAsync(binding, forceLookback: false, ct);
    }

    /// <summary>核心同步。forceLookback=true 时无视游标回看 7 天（每日自愈用）。</summary>
    internal async Task<SyncOutcome> SyncCoreAsync(HealthBinding binding, bool forceLookback, CancellationToken ct)
    {
        try
        {
            var cursor = forceLookback ? "" : binding.SyncCursor;
            var url = $"{opt.Value.BridgeBaseUrl.TrimEnd('/')}/api/records" +
                      $"?binding_id={Uri.EscapeDataString(binding.BridgeBindingKey)}&limit=5000" +
                      (cursor.Length > 0 ? $"&collected_after={Uri.EscapeDataString(cursor)}" : "");
            var http = httpFactory.CreateClient("health-bridge");
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (opt.Value.BridgeToken.Length > 0)
                req.Headers.Authorization = new("Bearer", opt.Value.BridgeToken);
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
                return await FailAsync(binding, $"bridge HTTP {(int)resp.StatusCode}", ct);

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            var records = doc.RootElement.GetProperty("records");
            var touched = new Dictionary<DateTime, HealthDaily>();
            var touchedHours = new Dictionary<(DateTime, int), HealthHourly>();
            var maxCollected = binding.SyncCursor;

            foreach (var row in records.EnumerateArray())
            {
                var domain = row.GetProperty("domain").GetString() ?? "";
                var collected = row.GetProperty("collected_at").GetString() ?? "";
                if (string.CompareOrdinal(collected, maxCollected) > 0) maxCollected = collected;

                var data = row.GetProperty("data");
                var date = RowDate(domain, data, row.GetProperty("ts").GetString() ?? "");
                if (date == DateTime.MinValue) continue;

                // 逐点采样 → 小时聚合（增量点数加权，游标保证每点只送一次，结果精确）
                if (domain is "heart_rate" or "spo2")
                {
                    if (!data.TryGetProperty("epoch_s", out var ep) || ep.ValueKind != JsonValueKind.Number) continue;
                    var hour = DateTimeOffset.FromUnixTimeSeconds(ep.GetInt64()).ToOffset(TimeSpan.FromHours(8)).Hour;
                    var key = (date, hour);
                    if (!touchedHours.TryGetValue(key, out var h))
                    {
                        h = await db.HealthHourlies.FirstOrDefaultAsync(
                            x => x.BindingId == binding.Id && x.Date == date && x.Hour == hour, ct) ?? new HealthHourly
                        { UserId = binding.UserId, BindingId = binding.Id, Date = date, Hour = hour };
                        touchedHours[key] = h;
                    }
                    if (domain == "heart_rate")
                    {
                        var v = Num(data, "bpm");
                        if (v <= 0) continue;
                        h.HrAvg = h.HrPoints == 0 ? v : (h.HrAvg * h.HrPoints + v) / (h.HrPoints + 1);
                        h.HrMin = h.HrPoints == 0 ? v : Math.Min(h.HrMin, v);
                        h.HrMax = h.HrPoints == 0 ? v : Math.Max(h.HrMax, v);
                        h.HrPoints++;
                    }
                    else
                    {
                        var v = Num(data, "spo2_pct");
                        if (v <= 0) continue;
                        h.Spo2Avg = h.Spo2Points == 0 ? v : (h.Spo2Avg * h.Spo2Points + v) / (h.Spo2Points + 1);
                        h.Spo2Min = h.Spo2Points == 0 ? v : Math.Min(h.Spo2Min, v);
                        h.Spo2Max = h.Spo2Points == 0 ? v : Math.Max(h.Spo2Max, v);
                        h.Spo2Points++;
                    }
                    h.UpdatedAt = DateTime.UtcNow;
                    if (h.Id == 0) db.HealthHourlies.Add(h);
                    continue;
                }
                if (domain == "workout_detail") continue;   // 逐秒明细太大，留 bridge

                if (!touched.TryGetValue(date, out var day))
                {
                    day = await db.HealthDailies.FirstOrDefaultAsync(
                        d => d.BindingId == binding.Id && d.Date == date, ct);
                    if (day is null)
                    {
                        day = new HealthDaily { UserId = binding.UserId, BindingId = binding.Id, Date = date };
                        db.HealthDailies.Add(day);
                    }
                    touched[date] = day;
                }
                if (domain == "workouts") day.WorkoutCount = 0;   // 重放时先归零再累计，避免翻倍
                Merge(day, domain, data);

                // RawJson：按域合并当日原始 payload（新指标兜底）
                using var rawDoc = JsonDocument.Parse(day.RawJson.Length > 0 ? day.RawJson : "{}");
                var merged = new Dictionary<string, JsonElement>();
                foreach (var p in rawDoc.RootElement.EnumerateObject()) merged[p.Name] = p.Value.Clone();
                merged[domain] = data.Clone();
                day.RawJson = JsonSerializer.Serialize(merged);
                day.UpdatedAt = DateTime.UtcNow;
            }

            // workouts 重放归零后若本轮没收到 workouts 观测，计数保持旧值即可（上面只在收到时清）
            binding.SyncCursor = maxCollected;
            binding.LastSyncAt = DateTime.UtcNow;
            binding.LastSyncError = "";
            binding.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return new SyncOutcome(true, touched.Count, "");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return await FailAsync(binding, ex.Message, ct);
        }
    }

    private async Task<SyncOutcome> FailAsync(HealthBinding binding, string error, CancellationToken ct)
    {
        binding.LastSyncError = error.Length > 200 ? error[..200] : error;
        binding.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return new SyncOutcome(false, 0, error);
    }

    /// <summary>全部 active 绑定同步一轮（后台服务/手动同步入口用）。
    /// forceLookback：无视游标回看 bridge 窗口 —— 手动同步用它补历史（新字段/断档自愈）。</summary>
    public async Task<List<object>> SyncAllAsync(int? userId = null, bool forceLookback = false, CancellationToken ct = default)
    {
        var q = db.HealthBindings.Where(b => b.Status == "active");
        if (userId is int uid) q = q.Where(b => b.UserId == uid);
        var list = await q.ToListAsync(ct);
        var results = new List<object>();
        foreach (var b in list)
        {
            // 每日一次回看 7 天：错过 webhook/断档的自愈（bridge 窗口本来就是 7/30 天）
            var lookback = forceLookback || b.LastSyncAt is null || b.LastSyncAt < DateTime.UtcNow.AddHours(-20);
            var r = await SyncCoreAsync(b, forceLookback: lookback, ct);
            results.Add(new { id = b.Id, name = b.DisplayName, owner = b.OwnerName, r.Ok, added = r.DaysTouched, error = r.Error });
        }
        return results;
    }
}
