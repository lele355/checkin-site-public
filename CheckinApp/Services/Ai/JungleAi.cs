using System.Text.Json;
using CheckinApp.Models;

namespace CheckinApp.Services.Ai;

/// <summary>
/// 斗兽棋 AI —— 极小极大 + α-β 剪枝，深度 4~6 层。
/// 评估：子力价值 + 兽穴距离 + 特殊格控制。
/// </summary>
public static class JungleAi
{
    private const int NodeBudget = 150_000;
    private static int _nodes;

    private static readonly int[] RankValue = [0, 100, 200, 300, 400, 500, 600, 700, 800]; // rank → value

    /// <summary>思考一步棋，返回走子请求体 {fx,fy,tx,ty} 或 null</summary>
    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r)
    {
        var depth = level switch
        {
            1 => 3,
            2 => 4,
            3 => 5,
            _ => 6,
        };

        var board = JungleRules.Replay(evs);
        var moves = AllMoves(board, side);
        if (moves.Count == 0) return null;

        _nodes = 0;
        var best = moves[0];
        var bestScore = int.MinValue;

        foreach (var m in moves)
        {
            var next = CloneBoard(board);
            var piece = next[m.fromX, m.fromY];
            next[m.fromX, m.fromY] = 0;
            next[m.toX, m.toY] = piece;

            var score = -Search(next, JungleRules.Other(side), depth - 1, int.MinValue + 1, int.MaxValue - 1, side);
            if (score > bestScore)
            {
                bestScore = score;
                best = m;
            }
            if (_nodes >= NodeBudget) break;
        }

        return JsonSerializer.SerializeToElement(new { fx = best.fromX, fy = best.fromY, tx = best.toX, ty = best.toY });
    }

    private static int Search(int[,] board, int side, int depth, int alpha, int beta, int mySide)
    {
        _nodes++;

        // 兽穴终局：有兽进入对方兽穴即胜。
        // negamax 语义：终局分一律从「当前节点行棋方 side」的视角给，由父节点取反 ——
        // 不能用固定 mySide 判定，否则根节点 -Search 会把「一步进穴」取反成最差着。
        var denWin = DenWinner(board);
        if (denWin != 0) return denWin == side ? 1_000_000 : -1_000_000;

        if (_nodes >= NodeBudget || depth <= 0) return Evaluate(board, mySide);

        var moves = AllMoves(board, side);
        if (moves.Count == 0)
            return -50000; // 困毙：当前行棋方无子可动 = 该方输（同样按 side 视角）

        var bestScore = int.MinValue;
        foreach (var m in moves)
        {
            var next = CloneBoard(board);
            var piece = next[m.fromX, m.fromY];
            next[m.fromX, m.fromY] = 0;
            next[m.toX, m.toY] = piece;

            var score = -Search(next, JungleRules.Other(side), depth - 1, -beta, -alpha, mySide);
            if (score > bestScore) bestScore = score;
            if (bestScore > alpha) alpha = bestScore;
            if (alpha >= beta) break;
            if (_nodes >= NodeBudget) break;
        }
        return bestScore;
    }

    private static int Evaluate(int[,] board, int mySide)
    {
        var score = 0;
        var oppSide = JungleRules.Other(mySide);

        for (var x = 0; x < JungleRules.BoardW; x++)
        {
            for (var y = 0; y < JungleRules.BoardH; y++)
            {
                var piece = board[x, y];
                if (piece == 0) continue;
                var side = JungleRules.PieceSide(piece);
                var rank = JungleRules.PieceRank(piece);
                var val = RankValue[rank];

                // 距离对方兽穴越近越好
                var targetDenY = side == 1 ? 0 : 8;
                var dist = Math.Abs(y - targetDenY) + Math.Abs(x - 3);
                val += (12 - dist) * 5;

                // 陷阱里的己方兽减分（易被吃）—— 只算「敌方陷阱」（己方陷阱不削弱己方）
                if (JungleRules.CellType(x, y) == JungleRules.Trap && (y <= 1 ? 2 : 1) != side)
                    val -= 200;

                score += side == mySide ? val : -val;
            }
        }
        return score;
    }

    private readonly record struct Move(int fromX, int fromY, int toX, int toY);

    /// <summary>有兽进入对方兽穴则返回该方，否则 0</summary>
    private static int DenWinner(int[,] board)
    {
        for (var x = 0; x < JungleRules.BoardW; x++)
        for (var y = 0; y < JungleRules.BoardH; y++)
        {
            if (JungleRules.CellType(x, y) != JungleRules.Den) continue;
            var p = board[x, y];
            if (p == 0) continue;
            var side = JungleRules.PieceSide(p);
            // side1 己穴在 y=8，side2 己穴在 y=0；进的是对方的穴才算胜
            if ((side == 1 && y == 0) || (side == 2 && y == 8)) return side;
        }
        return 0;
    }

    private static List<Move> AllMoves(int[,] board, int side)
    {
        // 与引擎 ValidateMove 同一套判定（大小链/鼠象/水陆/陷阱/跳河），保证生成的着 100% 合法
        return JungleRules.AllMoves(board, side)
            .Select(m => new Move(m.fx, m.fy, m.tx, m.ty))
            .ToList();
    }

    private static int[,] CloneBoard(int[,] board)
    {
        var clone = new int[JungleRules.BoardW, JungleRules.BoardH];
        Array.Copy(board, clone, board.Length);
        return clone;
    }
}
