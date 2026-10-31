using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 可走提示（Batch D）：「选中棋子 → 可走位置提示点」的下发数据。
/// 逐子逐格调用各游戏的**正式校验器**（规则绝对同源，不复制规则逻辑）；
/// 只在我方回合、未终局时下发，只含己方可动棋子，不泄露对方信息。
/// 形态：{"x,y": [[tx,ty], …], …}（落点含可吃目标，由前端按落点是否有子分红点/绿点）。
/// </summary>
public static class GameHints
{
    /// <summary>
    /// 构建提示表。myPieces = 己方候选起点（坐标），validate = 各游戏公开校验器
    /// （签名一致：ValidateMove(evs, r, side, req) → 事件或抛 ApiBadRequest）。
    /// 语义不变：提示数据全部来自正式校验器（GameHints 按需化只改分发形态，不改数据源）。
    /// </summary>
    public static object? Build(
        IReadOnlyList<GameEvent> evs,
        GameRoom r,
        int mySide,
        bool finished,
        Func<IReadOnlyList<GameEvent>, GameRoom, int, JsonElement, GameEvent> validate,
        int w,
        int h,
        IEnumerable<(int x, int y)> myPieces)
    {
        if (mySide is not (1 or 2) || finished || r.Turn != mySide) return null;

        var map = new Dictionary<string, List<int[]>>();
        foreach (var (fx, fy) in myPieces)
        {
            var targets = ForPiece(evs, r, mySide, finished, validate, w, h, fx, fy);
            if (targets is { Count: > 0 }) map[$"{fx},{fy}"] = targets;
        }
        return map.Count == 0 ? null : map;
    }

    /// <summary>
    /// 单子按需计算（GameHints 按需化 / QA 报告 §3-P1）：只算选中那一个起点的合法落点，
    /// 成本 ≈ 全量/子数。仍由正式校验器把关（规则绝对同源）。
    /// </summary>
    public static List<int[]>? ForPiece(
        IReadOnlyList<GameEvent> evs,
        GameRoom r,
        int mySide,
        bool finished,
        Func<IReadOnlyList<GameEvent>, GameRoom, int, JsonElement, GameEvent> validate,
        int w,
        int h,
        int fx,
        int fy)
    {
        if (mySide is not (1 or 2) || finished || r.Turn != mySide) return null;

        List<int[]>? targets = null;
        for (var tx = 0; tx < w; tx++)
        {
            for (var ty = 0; ty < h; ty++)
            {
                if (tx == fx && ty == fy) continue;
                try
                {
                    validate(evs, r, mySide, JsonSerializer.SerializeToElement(new { fx, fy, tx, ty }));
                    targets ??= new List<int[]>();
                    targets.Add(new[] { tx, ty });
                }
                catch (ApiBadRequest)
                {
                    // 非法着不进提示（暗子/军旗/行营/蹩腿/自吃…全部由正式校验器把关）
                }
            }
        }
        return targets;
    }
}
