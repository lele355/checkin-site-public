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
    /// <param name="HasAi">是否支持 AI 对手</param>
    /// <param name="Solo">是否单机游戏（点进去直达单机画面，跳过建房/大厅/对局）</param>
    /// <param name="MaxScore">单机记分上限（弱防作弊；0 = 非单机）</param>
    public sealed record GameInfo(string Key, string Name, string Sub, int MinPlayers, int MaxPlayers, bool Available, bool HasAi = false, bool Solo = false, int MaxScore = 0);

    public static readonly GameInfo[] All =
    [
        new("gomoku", "五子棋", "双人联机 · 先五连者胜", 2, 2, true),
        new("reversi", "黑白棋", "双人对战 · 终局子多者胜", 2, 2, true, true),
        new("jungle", "斗兽棋", "双人对战 · 入对方兽穴胜", 2, 2, true, true),
        new("xiangqi", "象棋", "双人对战 · 将死对方胜", 2, 2, true, true),
        new("ludo", "飞行棋", "双人对战 · 骰子起飞", 2, 2, true, true),
        new("armychess", "军旗", "双人对战 · 暗子对战", 2, 2, true),
        new("fish", "大鱼吃小鱼", "单机 · 吃小鱼变大", 1, 1, true, Solo: true, MaxScore: 1_000_000),
        new("melon", "合成大西瓜", "单机 · 合成冲击大西瓜", 1, 1, true, Solo: true, MaxScore: 1_000_000),
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
