using CheckinApp.Data;

namespace CheckinApp.Services;

/// <summary>
/// 经期预测 —— 提醒中心页面、每日邮件、本地通知计划三处共用一份算法，
/// 避免「页面说还有 3 天、通知说还有 2 天」这种对不上的情况。
///
/// 算法：取最近 3 个周期的平均值，从最后一次开始日往后推。
/// </summary>
public static class PeriodPredictor
{
    /// <summary>预测下一次开始日；记录少于 2 条时返回 null（算不出周期）</summary>
    public static DateTime? NextStart(AppDbContext db, int userId)
    {
        var starts = db.PeriodRecords
            .Where(x => x.UserId == userId)
            .Select(x => x.StartDate)
            .OrderBy(d => d)
            .ToList();

        if (starts.Count < 2) return null;

        var cycles = new List<int>();
        for (var i = starts.Count - 1; i > 0 && cycles.Count < 3; i--)
            cycles.Add((starts[i].Date - starts[i - 1].Date).Days);

        if (cycles.Count == 0) return null;
        var avg = (int)Math.Round(cycles.Average());
        if (avg is <= 0 or > 120) return null;      // 脏数据保护

        return starts[^1].Date.AddDays(avg);
    }
}
