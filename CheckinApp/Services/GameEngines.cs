using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 游戏引擎分发 —— gameKey → 规则引擎的唯一 switch 点。
/// 组合规则引擎（*Rules）+ AI（*Ai），供 GamesApi 调用。
/// </summary>
public static class GameEngines
{
    /// <summary>取指定游戏的规则接口</summary>
    public static IGameEngine Get(string gameKey) => gameKey.ToLowerInvariant() switch
    {
        "gomoku" => GomokuEngine.Instance,
        "reversi" => ReversiEngine.Instance,
        "jungle" => JungleEngine.Instance,
        "xiangqi" => XiangqiEngine.Instance,
        "ludo" => LudoEngine.Instance,
        "armychess" => ArmyChessEngine.Instance,
        _ => throw new ApiBadRequest("没有这个游戏的规则引擎"),
    };
}

/// <summary>游戏规则引擎统一接口</summary>
public interface IGameEngine
{
    string GameKey { get; }
    List<GameEvent> InitialEvents(GameRoom r);
    GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req);
    (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r);
    object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished);
    int Other(int side);
    string SideName(int side);
    /// <summary>下一手该谁走：默认两人互换；飞行棋按座位轮转（跳过出局座）</summary>
    int NextTurn(int side, GameRoom r) => Other(side);
    /// <summary>
    /// 该 side 的全部合法着（可直接喂 ValidateMove 的请求体）。
    /// null = 引擎未实现枚举；空列表 = 真无合法着（AI 应自动 pass）。
    /// </summary>
    IReadOnlyList<JsonElement>? AllMoves(IReadOnlyList<GameEvent> evs, GameRoom r, int side) => null;
    /// <summary>AI 思考（可为 null 表示不支持 AI）</summary>
    JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r);
    /// <summary>骰子（飞行棋用；其它游戏返回 null）</summary>
    GameEvent? ValidateRoll(IReadOnlyList<GameEvent> evs, GameRoom r, int side) => null;
}

/// <summary>五子棋引擎适配器</summary>
internal sealed class GomokuEngine : IGameEngine
{
    public static readonly GomokuEngine Instance = new();
    public string GameKey => "gomoku";

    public List<GameEvent> InitialEvents(GameRoom r) => [];

    public GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        var x = req.TryGetProperty("x", out var xp) ? xp.GetInt32() : -1;
        var y = req.TryGetProperty("y", out var yp) ? yp.GetInt32() : -1;
        var size = GomokuRules.ClampSize(r.Size);

        if (!GomokuRules.InBoard(x, y, size)) throw new ApiBadRequest("落子位置不合法");
        var moves = GameEvents.ToLegacyMoves(evs);
        if (GomokuRules.Occupied(moves, x, y)) throw new ApiBadRequest("这个位置已经有子了");
        return new GameEvent { t = "move", s = side, x = x, y = y };
    }

    public (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var moves = GameEvents.ToLegacyMoves(evs);
        if (moves.Count == 0) return (0, "", false);

        var last = moves[^1];
        var size = GomokuRules.ClampSize(r.Size);
        var runs = GomokuRules.LineRuns(moves, last.x, last.y, last.s, size);
        var five = runs.Any(run => run == GomokuRules.WinLen);      // 恰好成五
        var overline = runs.Any(run => run > GomokuRules.WinLen);   // 长连

        bool win; bool foul = false; var foulReason = "";
        if (r.Forbidden && last.s == 1)
        {
            // 标准规则黑方：成五优先（同手又长连也算黑胜）；无成五的长连/三三/四四 = 禁手判负
            win = five;
            if (!win)
            {
                if (overline) { foul = true; foulReason = "overline"; }
                else
                {
                    var f = GomokuRules.ForbiddenFoul(moves, last.x, last.y, size);
                    if (f != null) { foul = true; foulReason = f; }
                }
            }
        }
        else
        {
            // 自由规则：禁手全关，五连与长连都算赢（保持现状）
            win = five || overline;
        }

        var draw = !win && !foul && GomokuRules.IsDraw(moves, size);
        var over = win || foul || draw;
        var winner = win ? last.s : foul ? 2 : draw ? 3 : 0;
        var reason = win ? "five" : foul ? foulReason : draw ? "draw" : "";
        return (winner, reason, over);
    }

    public object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var moves = GameEvents.ToLegacyMoves(evs);
        var last = moves.Count == 0 ? null : moves[^1];
        return new
        {
            size = GomokuRules.ClampSize(r.Size),
            forbidden = r.Forbidden,
            moves = moves.Select(m => new { x = m.x, y = m.y, s = m.s }).ToList(),
            events = evs.Select(e => new { t = e.t, s = e.s, x = e.x, y = e.y }).ToList(),
            lastMove = last is null ? null : new { x = last.x, y = last.y, s = last.s },
        };
    }

    public int Other(int side) => GomokuRules.Other(side);
    public string SideName(int side) => GomokuRules.SideName(side);

    /// <summary>
    /// 五子棋启发式 AI：候选点打分（己方连型 + 0.9×对方连型），会下、会挡、会赢。
    /// 连型分：成五 ∞ &gt; 活四 &gt; 冲四 &gt; 活三 &gt; 眠三 &gt; 活二 …；标准规则下黑方避开禁手点。
    /// </summary>
    public JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r)
    {
        var size = GomokuRules.ClampSize(r.Size);
        var moves = GameEvents.ToLegacyMoves(evs);
        if (moves.Count >= GomokuRules.MaxMoves(size)) return null;   // 满盘，无着可走

        var cands = CandidateMoves(moves, size);
        if (cands.Count == 0) return JsonSerializer.SerializeToElement(new { x = size / 2, y = size / 2 });

        var opp = GomokuRules.Other(side);
        (int x, int y) best = cands[0];
        double bestScore = double.MinValue;
        foreach (var (cx, cy) in cands)
        {
            var score = PointScore(moves, cx, cy, side, size)
                      + PointScore(moves, cx, cy, opp, size) * 0.9;
            // 标准规则黑方：禁手点不落（除非这手直接成五 —— 成五优先，禁手不判）
            if (r.Forbidden && side == 1 && score < 900_000)
            {
                var trial = moves.Append(new GomokuRules.Stone(cx, cy, side)).ToList();
                if (GomokuRules.ForbiddenFoul(trial, cx, cy, size) != null) continue;
            }
            if (score > bestScore) { bestScore = score; best = (cx, cy); }
        }
        return JsonSerializer.SerializeToElement(new { x = best.x, y = best.y });
    }

    /// <summary>候选点：已有子周围 2 格内的空点</summary>
    private static List<(int x, int y)> CandidateMoves(List<GomokuRules.Stone> moves, int size)
    {
        if (moves.Count == 0) return [(size / 2, size / 2)];
        var set = new HashSet<(int, int)>();
        foreach (var m in moves)
        {
            for (var dx = -2; dx <= 2; dx++)
            for (var dy = -2; dy <= 2; dy++)
            {
                var x = m.x + dx;
                var y = m.y + dy;
                if (!GomokuRules.InBoard(x, y, size) || GomokuRules.Occupied(moves, x, y)) continue;
                set.Add((x, y));
            }
        }
        return set.ToList();
    }

    /// <summary>假设 side 在 (x,y) 落子，四个方向的连型分之和</summary>
    private static double PointScore(List<GomokuRules.Stone> moves, int x, int y, int side, int size)
    {
        int[] dx = [1, 0, 1, 1];
        int[] dy = [0, 1, 1, -1];
        double total = 0;
        for (var d = 0; d < 4; d++)
        {
            var cnt = 1;
            var open = 0;
            var i = 1;
            while (HasStone(moves, x + dx[d] * i, y + dy[d] * i, side, size)) { cnt++; i++; }
            if (GomokuRules.InBoard(x + dx[d] * i, y + dy[d] * i, size)
                && !GomokuRules.Occupied(moves, x + dx[d] * i, y + dy[d] * i)) open++;
            i = 1;
            while (HasStone(moves, x - dx[d] * i, y - dy[d] * i, side, size)) { cnt++; i++; }
            if (GomokuRules.InBoard(x - dx[d] * i, y - dy[d] * i, size)
                && !GomokuRules.Occupied(moves, x - dx[d] * i, y - dy[d] * i)) open++;

            total += (cnt, open) switch
            {
                ( >= 5, _) => 1_000_000,
                (4, 2) => 100_000,
                (4, 1) => 20_000,
                (3, 2) => 10_000,
                (3, 1) => 1_000,
                (2, 2) => 500,
                (2, 1) => 100,
                (1, 2) => 50,
                _ => 10,
            };
        }
        return total;
    }

    private static bool HasStone(List<GomokuRules.Stone> moves, int x, int y, int side, int size)
        => GomokuRules.InBoard(x, y, size) && moves.Any(m => m.x == x && m.y == y && m.s == side);
}

/// <summary>黑白棋引擎适配器</summary>
internal sealed class ReversiEngine : IGameEngine
{
    public static readonly ReversiEngine Instance = new();
    public string GameKey => "reversi";

    public List<GameEvent> InitialEvents(GameRoom r) => ReversiRules.InitialEvents(r);

    public GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req) =>
        ReversiRules.ValidateMove(evs, r, side, req);

    public (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r) =>
        ReversiRules.Judge(evs, r);

    public object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished) =>
        ReversiRules.BuildState(evs, r, mySide, finished);

    public int Other(int side) => ReversiRules.Other(side);
    public string SideName(int side) => ReversiRules.SideName(side);

    public IReadOnlyList<JsonElement>? AllMoves(IReadOnlyList<GameEvent> evs, GameRoom r, int side) =>
        ReversiRules.AllMoves(evs, side)
            .Select(m => JsonSerializer.SerializeToElement(new { x = m.fx, y = m.fy }))
            .ToList();

    public JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r) =>
        Ai.ReversiAi.Think(evs, side, level, r);
}

/// <summary>斗兽棋引擎适配器</summary>
internal sealed class JungleEngine : IGameEngine
{
    public static readonly JungleEngine Instance = new();
    public string GameKey => "jungle";

    public List<GameEvent> InitialEvents(GameRoom r) => JungleRules.InitialEvents(r);
    public GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req) =>
        JungleRules.ValidateMove(evs, r, side, req);
    public (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r) =>
        JungleRules.Judge(evs, r);
    public object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished) =>
        JungleRules.BuildState(evs, r, mySide, finished);
    public int Other(int side) => side == 1 ? 2 : 1;
    public string SideName(int side) => JungleRules.SideName(side);
    public IReadOnlyList<JsonElement>? AllMoves(IReadOnlyList<GameEvent> evs, GameRoom r, int side) =>
        JungleRules.AllMoves(evs, side)
            .Select(m => JsonSerializer.SerializeToElement(new { fx = m.fx, fy = m.fy, tx = m.tx, ty = m.ty }))
            .ToList();
    public JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r) =>
        Ai.JungleAi.Think(evs, side, level, r);
}

/// <summary>象棋引擎适配器</summary>
internal sealed class XiangqiEngine : IGameEngine
{
    public static readonly XiangqiEngine Instance = new();
    public string GameKey => "xiangqi";

    public List<GameEvent> InitialEvents(GameRoom r) => XiangqiRules.InitialEvents(r);
    public GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req) =>
        XiangqiRules.ValidateMove(evs, r, side, req);
    public (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r) =>
        XiangqiRules.Judge(evs, r);
    public object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished) =>
        XiangqiRules.BuildState(evs, r, mySide, finished);
    public int Other(int side) => side == 1 ? 2 : 1;
    public string SideName(int side) => XiangqiRules.SideName(side);
    public IReadOnlyList<JsonElement>? AllMoves(IReadOnlyList<GameEvent> evs, GameRoom r, int side) =>
        XiangqiRules.AllMoves(evs, side)
            .Select(m => JsonSerializer.SerializeToElement(new { fx = m.fx, fy = m.fy, tx = m.tx, ty = m.ty }))
            .ToList();
    public JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r) =>
        Ai.XiangqiAi.Think(evs, side, level, r);
}

/// <summary>飞行棋引擎适配器</summary>
internal sealed class LudoEngine : IGameEngine
{
    public static readonly LudoEngine Instance = new();
    public string GameKey => "ludo";

    public List<GameEvent> InitialEvents(GameRoom r) => LudoRules.InitialEvents(r);
    public GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req) =>
        LudoRules.ValidateMove(evs, r, side, req);
    public (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r) =>
        LudoRules.Judge(evs, r);
    public object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished) =>
        LudoRules.BuildState(evs, r, mySide, finished);
    public int Other(int side) => LudoRules.Other(side);
    public string SideName(int side) => LudoRules.SideName(side);
    public int NextTurn(int side, GameRoom r) => LudoSeats.NextActive(r, side);
    public JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r) =>
        Ai.LudoAi.Think(evs, side, level, r);

    public GameEvent? ValidateRoll(IReadOnlyList<GameEvent> evs, GameRoom r, int side) =>
        LudoRules.ValidateRoll(evs, r, side);
}

/// <summary>军旗引擎适配器（含战斗判定）</summary>
internal sealed class ArmyChessEngine : IGameEngine
{
    public static readonly ArmyChessEngine Instance = new();
    public string GameKey => "armychess";

    public List<GameEvent> InitialEvents(GameRoom r) => ArmyChessRules.InitialEvents(r);

    public GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        // 军旗走子含战斗判定：先校验走子，再解析战斗
        var moveEvent = ArmyChessRules.ValidateMove(evs, r, side, req);

        // 如果目标格有棋子，生成 battle 事件
        var board = ArmyChessRules.Replay(evs);
        var toX = moveEvent.tx!.Value;
        var toY = moveEvent.ty!.Value;
        if (board[toX, toY] != 0)
        {
            var (battle, winner, reason, over) = ArmyChessRules.ResolveBattle(evs, r, side,
                moveEvent.fx!.Value, moveEvent.fy!.Value, toX, toY);
            return battle ?? moveEvent;
        }
        return moveEvent;
    }

    public (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r) =>
        ArmyChessRules.Judge(evs, r);

    public object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished) =>
        ArmyChessRules.BuildState(evs, r, mySide, finished);

    public int Other(int side) => side == 1 ? 2 : 1;
    public string SideName(int side) => ArmyChessRules.SideName(side);

    // 军旗不做 AI（隐藏信息 AI 要么很弱要么作弊）
    public JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r) => null;
}
