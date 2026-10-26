using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 课程配色。
///
/// 【为什么改成按课程而不是按类别】
/// 以前颜色 = 必修/选修/其它 四档，一学期的课表里通常有六七门必修，全是一个紫色，
/// 看着像一大片色块，反而是「哪门课」看不见。改成按课程分配：同一门课一个颜色。
///
/// 【同名课程同色】
/// 一门课一周上三次（周一理论、周三实验）是常态，它们本来该是一个颜色。
/// 所以默认色由 <see cref="NameKey"/> 归一化后的课程名做哈希算出——
/// 不落库也是稳定的，两台设备、重装 App 之后都一样。
///
/// 【何时才落库】
/// 用户手动改色才写 <see cref="Course.Color"/>。默认色不写库的好处：
/// 改色板顺序或调色不迁移数据，已有课程自动跟着变。
/// </summary>
public static class CoursePalette
{
    /// <summary>
    /// 色板键。CSS 侧 .cs-&lt;key&gt; 提供 --cc（前景）/ --cc-bg（底）两个变量，
    /// 顺序即「相邻自动分配时的错开顺序」：把对比强的颜色排在相邻位置。
    /// </summary>
    public static readonly string[] Keys =
    [
        "violet", "blue", "teal", "amber", "rose", "green", "indigo", "orange",
    ];

    /// <summary>色板键 → 中文名（编辑页给个可读的名字，色块本身才是主体）</summary>
    public static readonly (string Key, string Label)[] All =
    [
        ("violet", "紫"), ("blue", "蓝"), ("teal", "青"), ("amber", "琥珀"),
        ("rose", "玫红"), ("green", "绿"), ("indigo", "靛蓝"), ("orange", "橙"),
    ];

    public static bool IsValid(string? key) =>
        !string.IsNullOrWhiteSpace(key) && Keys.Contains(key.Trim().ToLowerInvariant());

    /// <summary>规范化：脏值一律当「没设」，交给默认色</summary>
    public static string Normalize(string? key) =>
        IsValid(key) ? key!.Trim().ToLowerInvariant() : "";

    /// <summary>
    /// 课程名的归一键：忽略大小写、空白、全角半角和常见分隔符的差异，
    /// 「高等数学(上)」「高等数学（上）」「高等数学 上」应当同色。
    /// </summary>
    public static string NameKey(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var sb = new System.Text.StringBuilder(name.Length);
        foreach (var ch in name)
        {
            // 全角括号/顿号/空格等统一成半角，再丢掉所有非字母数字汉字
            var c = ch switch
            {
                '（' => '(', '）' => ')', '　' => ' ',
                '，' => ',', '、' => ',', '：' => ':',
                _ => ch,
            };
            if (char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    /// <summary>
    /// 课程名 → 默认色。用 FNV-1a 而不是 string.GetHashCode：
    /// 后者在 .NET 里带随机种子，重启进程就变，课表颜色会跟着跳。
    /// </summary>
    public static string DefaultFor(string? name)
    {
        var key = NameKey(name);
        if (key.Length == 0) return Keys[0];

        uint h = 2166136261;
        foreach (var ch in key)
        {
            h ^= ch;
            h *= 16777619;
        }
        return Keys[h % (uint)Keys.Length];
    }

    /// <summary>落库值优先，没设过就按名字算</summary>
    public static string Of(Course c) =>
        Normalize(c.Color) is { Length: > 0 } k ? k : DefaultFor(c.Name);

    /// <summary>
    /// 给一批新课程分配颜色，并保证「这批里尽量不撞色」。
    ///
    /// 用于截图导入：AI 一次返回整张课表，如果只按名字哈希，
    /// 十门课里撞色两三对很常见。这里的做法是——同名必同色（硬约束），
    /// 不同名优先挑这批里还没用到的颜色；色板用完了再退回哈希值。
    /// </summary>
    public static Dictionary<string, string> AssignFor(IEnumerable<string> names)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var used = new HashSet<string>();

        foreach (var name in names)
        {
            var key = NameKey(name);
            if (key.Length == 0 || result.ContainsKey(key)) continue;

            var pick = DefaultFor(name);
            if (used.Contains(pick))
            {
                // 撞了：按哈希起点往后找第一个没被占的槽
                var start = Array.IndexOf(Keys, pick);
                for (var i = 1; i < Keys.Length; i++)
                {
                    var cand = Keys[(start + i) % Keys.Length];
                    if (!used.Contains(cand)) { pick = cand; break; }
                }
            }
            result[key] = pick;
            used.Add(pick);
        }
        return result;
    }

    /// <summary>
    /// 把「用户现有课程里已经用过的颜色」按同名映射出来，导入时沿用 ——
    /// 已经有「高等数学」是蓝色，再导入一次它也还是蓝色，不该突然变紫。
    /// </summary>
    public static Dictionary<string, string> ExistingByKey(AppDbContext db, int userId)
    {
        var rows = db.Courses.Where(c => c.UserId == userId)
            .Select(c => new { c.Name, c.Color })
            .ToList();

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            var key = NameKey(r.Name);
            if (key.Length == 0) continue;
            // 显式设过色的优先（用户改过就照用户的）
            var col = Normalize(r.Color);
            if (col.Length > 0) map[key] = col;
            else if (!map.ContainsKey(key)) map[key] = DefaultFor(r.Name);
        }
        return map;
    }
}