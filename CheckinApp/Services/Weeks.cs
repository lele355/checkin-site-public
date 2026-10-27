using System.Text.RegularExpressions;

namespace CheckinApp.Services;

/// <summary>
/// 课程周次文本解析 —— 把 "1-16" / "1-8,10-16" / "单周" / "双周" / "1,3,5"
/// 这类描述翻译成「第 N 周有没有课」。容错：忽略「第/周/空格/全角逗号」，
/// 非法片段直接跳过（宁可少显示不崩页面）。
/// </summary>
public static class Weeks
{
    /// <summary>第 week 周是否包含在 weeksText 里。空文本 = 全部周次。</summary>
    public static bool Includes(string? weeksText, int week)
    {
        if (week < 1) return false;
        var text = Clean(weeksText);
        if (text.Length == 0) return true;          // 没填 = 每周都有

        foreach (var raw in text.Split(',', '，', '、'))
        {
            var t = raw.Trim().TrimStart('第').TrimEnd('周').Trim();   // 每段单独容错 "第/周"
            if (t.Length == 0) continue;
            if (t is "单周" or "单") { if (week % 2 == 1) return true; continue; }
            if (t is "双周" or "双") { if (week % 2 == 0) return true; continue; }

            var m = Regex.Match(t, @"^(\d+)\s*[-~～—]\s*(\d+)$");   // 区间 1-8
            if (m.Success)
            {
                var a = int.Parse(m.Groups[1].Value);
                var b = int.Parse(m.Groups[2].Value);
                if (week >= Math.Min(a, b) && week <= Math.Max(a, b)) return true;
                continue;
            }
            if (int.TryParse(t, out var single) && week == single) return true;  // 单周 3
        }
        return false;
    }

    /// <summary>展示用："第1-8周" / "单周" / "双周"。空文本回落 "第1-16周"。</summary>
    public static string Display(string? weeksText)
    {
        var text = Clean(weeksText);
        if (text.Length == 0) return "第1-16周";
        if (text is "单周" or "双周" or "单" or "双") return text is "单" ? "单周" : text is "双" ? "双周" : text;
        return $"第{text}周";
    }

    private static string Clean(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        return s.Trim().TrimStart('第').TrimEnd('周').Trim();
    }
}
