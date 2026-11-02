using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 情侣月度总结（2026-11-02 站主规划）—— mimo AI 生成。
/// 每日生成「当月截至今日」阶段总结（IsFinal=false）；每月最后一天定稿（IsFinal=true）。
/// 全部留存可查阅（CoupleMonthlySummary）。输入：当月心情分布/排便/提问/经期概要。
/// </summary>
public class CoupleSummaryService(AppDbContext db, AiClient ai, CoupleScope couple)
{
    private readonly AppDbContext _db = db;
    private readonly AiClient _ai = ai;
    private readonly CoupleScope _couple = couple;

    /// <summary>生成当月总结（scopeDays=截至日；isFinal=月末定稿）并存库。</summary>
    public async Task<CoupleMonthlySummary?> GenerateAsync(int scopeDays, bool isFinal, CancellationToken ct = default)
    {
        var today = DateTime.Today;
        var monthStart = new DateTime(today.Year, today.Month, 1);
        var uids = _couple.MemberUids();
        if (uids.Count == 0) return null;
        var names = _db.Users.Where(u => uids.Contains(u.Id)).ToDictionary(u => u.Id, u => u.DisplayName);

        // 收集当月数据摘要
        var moods = _db.MoodLogs.Where(x => uids.Contains(x.UserId) && x.Date >= monthStart && x.Date <= today).ToList();
        var poops = _db.PoopLogs.Where(x => uids.Contains(x.UserId) && x.At >= monthStart && x.At < today.AddDays(1)).ToList();
        var qs = _db.CoupleQuestions.Where(x => uids.Contains(x.FromUserId) && x.CreatedAt >= monthStart).ToList();
        var moodNames = new[] { "生气", "难过", "困", "平淡", "害羞", "开心" };

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"这是情侣本月（{monthStart:yyyy年M月}，截至今日共 {scopeDays} 天）的记录摘要，请写一份温馨可爱的中文月度总结（250 字以内，轻松活泼，可带少量 emoji）：");
        foreach (var u in uids)
        {
            var who = names.GetValueOrDefault(u, "?");
            var mine = moods.Where(x => x.UserId == u).ToList();
            var dist = string.Join("、", Enumerable.Range(1, 6)
                .Select(m => mine.Count(x => x.Mood == m) is var c && c > 0 ? $"{moodNames[m - 1]}{c}天" : null)
                .Where(s => s is not null));
            sb.AppendLine($"【{who}】心情记录 {mine.Count} 天：{(dist.Length > 0 ? dist : "无")}；排便 {poops.Count(x => x.UserId == u)} 次。");
        }
        sb.AppendLine($"互相提问 {qs.Count} 条（已答 {qs.Count(x => x.Answer != null)} 条）。");
        if (isFinal) sb.AppendLine("这是当月定稿总结，请作一个温暖的收尾。");

        var messages = new List<AiChatMessage>
        {
            new("system", "你是情侣空间的月度总结助手，为一对情侣写记录总结。只输出总结正文。"),
            new("user", sb.ToString()),
        };
        var r = await _ai.ChatAsync(messages, ct: ct);
        if (!r.Ok || string.IsNullOrWhiteSpace(r.Content)) return null;

        var row = new CoupleMonthlySummary
        {
            Month = monthStart,
            ScopeDays = scopeDays,
            IsFinal = isFinal,
            Content = r.Content.Trim(),
            GeneratedAt = DateTime.UtcNow,
        };
        _db.CoupleMonthlySummaries.Add(row);
        _db.SaveChanges();
        return row;
    }
}

/// <summary>
/// 每日定时：生成「截至今日」阶段总结；每月最后一天额外定稿。
/// 挂在应用启动后每日 23:30（北京时间）跑一次；错过的当天启动时补跑。
/// </summary>
public class CoupleSummaryHostedService(
    IServiceProvider sp, ILogger<CoupleSummaryHostedService> log) : IHostedService, IDisposable
{
    private readonly IServiceProvider _sp = sp;
    private readonly ILogger<CoupleSummaryHostedService> _log = log;
    private Timer? _timer;

    public Task StartAsync(CancellationToken ct)
    {
        // 启动 2 分钟后先补跑一次（幂等：同一天已生成过就跳过），之后每小时检查一次
        _timer = new Timer(_ => { _ = TickSafe(); }, null, TimeSpan.FromMinutes(2), TimeSpan.FromHours(1));
        return Task.CompletedTask;
    }

    private async Task TickSafe()
    {
        try
        {
            var now = DateTime.UtcNow.AddHours(8);   // 北京时间
            using var scope = _sp.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var gen = scope.ServiceProvider.GetRequiredService<CoupleSummaryService>();

            var today = now.Date;
            var monthStart = new DateTime(today.Year, today.Month, 1);

            // 情侣域 AI 对话 3 天清理（站主规划：无需长期留存，留存三天）
            var cutoff = DateTime.UtcNow.AddDays(-3);
            var stale = db.AiMessages.Where(x => x.CoupleChat && x.CreatedAt < cutoff);
            if (stale.Any()) { db.AiMessages.RemoveRange(stale); db.SaveChanges(); }

            // 今天生成过（任意类型）就跳过 —— 幂等
            var doneToday = db.CoupleMonthlySummaries.Any(x => x.GeneratedAt >= DateTime.UtcNow.Date);
            if (doneToday) return;

            var isFinal = today.AddDays(1).Month != today.Month;   // 今天是本月最后一天
            var scopeDays = (today - monthStart).Days + 1;
            var row = await gen.GenerateAsync(scopeDays, isFinal);
            if (row is not null)
                _log.LogInformation("情侣月度总结已生成：{Month} scope={Days} final={Final}", row.Month.ToString("yyyy-MM"), row.ScopeDays, row.IsFinal);
        }
        catch (Exception e)
        {
            _log.LogWarning(e, "情侣月度总结生成失败");
        }
    }

    public Task StopAsync(CancellationToken ct)
    {
        _timer?.Change(Timeout.Infinite, 0);
        return Task.CompletedTask;
    }

    public void Dispose() => _timer?.Dispose();
}
