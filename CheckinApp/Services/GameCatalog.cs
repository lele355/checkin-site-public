using CheckinApp.Api;

namespace CheckinApp.Services;

/// <summary>
/// 小游戏目录 —— 站内有哪些小游戏的唯一权威来源。
///
/// 【为什么要有这一层】2.5.0 只有五子棋，路由和页面都按「就一个游戏」写死，
/// 再加一个就得回头改一堆地方。有了目录，前端拿到的就是一张游戏卡片列表，
/// 加第二种游戏 = 在 <see cref="All"/> 里登记一条 + 补该游戏的规则实现，
/// 入口/列表/设置的骨架不用动。
/// </summary>
public static class GameCatalog
{
    /// <param name="Sub">卡片上的一行副标题（名词性描述，不是使用说明）</param>
    public sealed record GameInfo(string Key, string Name, string Sub, int MinPlayers, int MaxPlayers, bool Available);

    public static readonly GameInfo[] All =
    [
        new("gomoku", "五子棋", "双人联机 · 先五连者胜", 2, 2, true),
        // 新游戏登记在这里，前端自动多出一张卡
    ];

    public static GameInfo? Find(string key) =>
        All.FirstOrDefault(g => string.Equals(g.Key, key, StringComparison.OrdinalIgnoreCase));

    /// <summary>取合法的 gameKey（归一成小写）；不认识就报错，别让错的 key 落进房间表</summary>
    public static string Require(string key)
    {
        var g = Find(key) ?? throw new ApiBadRequest("没有这个游戏");
        if (!g.Available) throw new ApiBadRequest("这个游戏还没开放");
        return g.Key;
    }
}
