using System.Text.Json;

namespace CheckinApp.Services;

/// <summary>
/// 记帐分类目录 —— 内置默认 + 用户自定义，全站（网页 / App / 导出 / AI）共用这一份规则。
///
/// 【为什么存全量列表而不是「新增了哪些」】
/// 侧栏 NavHidden 那种「只存改动了什么」的做法带来的是「以后新增模块自动出现」，
/// 那是我们想要的；但分类相反 —— 用户明确删掉「医疗」，下次登录它又自己回来，
/// 是很糟的体验。所以 `User.ExpenseCategories` 存的是**用户看到的完整列表**，
/// 空字符串 = 从没改过 = 用 [Defaults]。
///
/// 【为什么默认值不写进数据库】
/// 存量用户几十个，为了加一个字段跑一次「给每行填默认值」的迁移没必要，
/// 而且以后想调整默认分类（比如加「宠物」）只要改这里，老用户没自定义过就会跟着变。
/// </summary>
public static class ExpenseCategoryCatalog
{
    /// <summary>内置默认分类（顺序即展示顺序）</summary>
    public static readonly string[] Defaults = ["餐饮", "交通", "学习", "娱乐", "日用", "医疗", "其他"];

    /// <summary>「其他」是兜底项：服务端在分类为空时会回落到它，所以不允许被删干净</summary>
    public const string Fallback = "其他";

    /// <summary>最多几个分类 —— chip 要排进编辑面板，太多就变成一屏标签墙了</summary>
    public const int MaxCount = 24;

    /// <summary>单个分类名最长几个字（中文按字符算）</summary>
    public const int MaxLen = 8;

    /// <summary>
    /// 解析存库的 JSON。空 / 坏 JSON / 全是脏值 → 回落 [Defaults]，
    /// 绝不让用户的记账页因为一个坏字段打不开。
    /// </summary>
    public static List<string> Load(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [.. Defaults];
        try
        {
            var raw = JsonSerializer.Deserialize<List<string?>>(json);
            var list = Normalize(raw);
            return list.Count > 0 ? list : [.. Defaults];
        }
        catch (JsonException) { return [.. Defaults]; }
    }

    /// <summary>
    /// 清洗用户提交的分类：去空白、去控制字符、去重（忽略大小写）、限长、限量。
    /// 返回的列表一定非空 —— 传空进来就给默认值，因为编辑面板至少要有一个可选项。
    /// </summary>
    public static List<string> Normalize(IEnumerable<string?>? items)
    {
        var outList = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var it in items ?? Array.Empty<string?>())
        {
            var name = (it ?? "").Trim();
            if (name.Length == 0) continue;
            // 分类名会进 select / chip / 统计图例，换行与竖线会把布局撑坏
            name = name.Replace("\r", "").Replace("\n", "").Replace("|", "").Replace("<", "").Replace(">", "");
            if (name.Length > MaxLen) name = name[..MaxLen];
            if (name.Length == 0) continue;
            if (!seen.Add(name)) continue;
            outList.Add(name);
            if (outList.Count >= MaxCount) break;
        }
        return outList.Count > 0 ? outList : [.. Defaults];
    }

    /// <summary>序列化成存库字符串（已 Normalize）</summary>
    public static string Store(IEnumerable<string?>? items) =>
        JsonSerializer.Serialize(Normalize(items));
}
