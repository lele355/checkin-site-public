using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 黑白棋规则 —— 可变盘面（6/8/10/12）、落子翻子（8 方向夹击）、pass、胜负（子多者胜/平子和）。
///
/// 盘面大小来自 GameRoom.Size（建房时从房主规则默认快照，默认 8）；
/// 初始四子放中心 2×2（任意偶数 n 通用）。
/// 纯函数静态类：显式传事件流/房间，无 IO、无副作用。
/// 每次事件追加后由 GameEngines 调 Judge 判定终局。
/// </summary>
public static class ReversiRules
{
    /// <summary>兼容旧调用：默认盘面（默认值兜底，不代表本局实际大小 —— 用 BoardSizeOf(r)）</summary>
    public const int BoardSize = 8;

    /// <summary>盘面可选档位（偶数）</summary>
    public static readonly int[] SizeOptions = [6, 8, 10, 12];

    /// <summary>合法盘面大小：白名单内原样；其它一律回 8（含五子棋档 13/15/19 泄漏）</summary>
    public static int ClampSize(int size) => SizeOptions.Contains(size) ? size : 8;

    /// <summary>本局盘面大小（房间快照为准；非 6/8/10/12 回落 8）</summary>
    public static int BoardSizeOf(GameRoom r) => SizeOptions.Contains(r.Size) ? r.Size : 8;

    /// <summary>新游戏开始时的初始事件（黑白棋无布阵，开局空盘+四子）</summary>
    public static List<GameEvent> InitialEvents(GameRoom r) =>
    [
        new GameEvent { t = "setup", s = 0 },
    ];

    /// <summary>
    /// 校验落子是否合法：落在空格、能翻对方子。
    /// 不合法 → throw ApiBadRequest(人话原因)；合法 → 返回要追加的 move 事件。
    /// </summary>
    public static GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        if (side is not (1 or 2)) throw new ApiBadRequest("你不在这一局里");

        var n = BoardSizeOf(r);
        var x = req.TryGetProperty("x", out var xp) ? xp.GetInt32() : -1;
        var y = req.TryGetProperty("y", out var yp) ? yp.GetInt32() : -1;

        if (x < 0 || x >= n || y < 0 || y >= n)
            throw new ApiBadRequest("落子位置不合法");

        var board = Replay(evs, n);
        if (board[x, y] != 0) throw new ApiBadRequest("这个位置已经有子了");

        // before=true：落子前计算翻子（跳过空格检查）
        if (GetFlips(board, x, y, side, before: true).Count == 0)
            throw new ApiBadRequest("这里不能翻子，换个位置");

        return new GameEvent { t = "move", s = side, x = x, y = y };
    }

    /// <summary>
    /// 判定终局：双方都无着可走时终局。
    /// winner: 1/2 = 胜方，3 = 和棋，0 = 未终局。
    /// </summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var n = BoardSizeOf(r);
        var board = Replay(evs, n);
        var black = CountStones(board, 1);
        var white = CountStones(board, 2);

        // 双方都无着可走 → 终局
        var blackCanPlay = HasLegalMove(board, 1);
        var whiteCanPlay = HasLegalMove(board, 2);
        if (blackCanPlay || whiteCanPlay) return (0, "", false);

        // 终局：子多者胜
        if (black > white) return (1, "count", true);
        if (white > black) return (2, "count", true);
        return (3, "draw", true);
    }

    /// <summary>
    /// 重建盘面状态。返回 n×n 数组：0=空, 1=黑, 2=白。
    /// 初始四子放中心 2×2：左上=白、右下=白、右上=黑、左下=黑（标准布局，任意偶数 n 通用）。
    /// </summary>
    public static int[,] Replay(IReadOnlyList<GameEvent> evs, int size = BoardSize)
    {
        var n = ClampSize(size);
        var board = new int[n, n];
        // 标准初始布局（中心 2×2）
        var c = n / 2;
        board[c - 1, c - 1] = 2; board[c, c] = 2;
        board[c, c - 1] = 1; board[c - 1, c] = 1;

        foreach (var e in evs)
        {
            if (e.t != "move" || e.x is not int mx || e.y is not int my) continue;
            if (mx < 0 || mx >= n || my < 0 || my >= n) continue;
            if (board[mx, my] != 0) continue;

            board[mx, my] = e.s;
            var flips = GetFlips(board, mx, my, e.s, before: true);
            foreach (var (fx, fy) in flips) board[fx, fy] = e.s;
        }
        return board;
    }

    /// <summary>
    /// 获取 (x,y) 落子后能翻的对方子列表。
    /// before=true 表示落子前调用（先算翻子再落子）；before=false 表示已落子后算。
    /// </summary>
    public static List<(int x, int y)> GetFlips(int[,] board, int x, int y, int side, bool before = false)
    {
        var n = board.GetLength(0);
        var flips = new List<(int x, int y)>();
        if (!before && board[x, y] == 0) return flips;

        int[][] dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        foreach (var d in dirs)
        {
            var line = new List<(int x, int y)>();
            var cx = x + d[0];
            var cy = y + d[1];
            while (cx >= 0 && cx < n && cy >= 0 && cy < n && board[cx, cy] != 0 && board[cx, cy] != side)
            {
                line.Add((cx, cy));
                cx += d[0];
                cy += d[1];
            }
            // 线的另一端必须是己方子，才能翻
            if (line.Count > 0 && cx >= 0 && cx < n && cy >= 0 && cy < n && board[cx, cy] == side)
            {
                flips.AddRange(line);
            }
        }
        return flips;
    }

    /// <summary>该方是否有合法着</summary>
    public static bool HasLegalMove(int[,] board, int side)
    {
        var n = board.GetLength(0);
        for (var x = 0; x < n; x++)
            for (var y = 0; y < n; y++)
                if (board[x, y] == 0 && GetFlips(board, x, y, side, before: true).Count > 0)
                    return true;
        return false;
    }

    /// <summary>该 side 的全部合法着（事件流版）—— AI 兜底用：空列表 = 真无合法着（自动 pass）</summary>
    public static List<(int fx, int fy, int tx, int ty)> AllMoves(IReadOnlyList<GameEvent> evs, GameRoom r, int side)
    {
        var n = BoardSizeOf(r);
        return LegalMoves(Replay(evs, n), side).Select(m => (m.x, m.y, m.x, m.y)).ToList();
    }

    /// <summary>获取该方所有合法着</summary>
    public static List<(int x, int y)> LegalMoves(int[,] board, int side)
    {
        var n = board.GetLength(0);
        var moves = new List<(int x, int y)>();
        for (var x = 0; x < n; x++)
            for (var y = 0; y < n; y++)
                if (board[x, y] == 0 && GetFlips(board, x, y, side, before: true).Count > 0)
                    moves.Add((x, y));
        return moves;
    }

    /// <summary>统计某方的子数</summary>
    public static int CountStones(int[,] board, int side)
    {
        var n = board.GetLength(0);
        var count = 0;
        for (var x = 0; x < n; x++)
            for (var y = 0; y < n; y++)
                if (board[x, y] == side) count++;
        return count;
    }

    /// <summary>构建 per-game 快照 state</summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var n = BoardSizeOf(r);
        var board = Replay(evs, n);
        var lastMove = evs.LastOrDefault(e => e.t == "move");
        var passCount = evs.Count(e => e.t == "pass");

        return new
        {
            size = n,
            events = evs.Select(e => new { t = e.t, s = e.s, x = e.x, y = e.y }).ToList(),
            lastMove = lastMove is null ? null : new { x = lastMove.x, y = lastMove.y, s = lastMove.s },
            passCount,
            black = CountStones(board, 1),
            white = CountStones(board, 2),
        };
    }

    /// <summary>另一方（1 ↔ 2）</summary>
    public static int Other(int side) => side == 1 ? 2 : 1;

    /// <summary>方名</summary>
    public static string SideName(int side) => side == 1 ? "黑棋" : "白棋";
}
