using System.Text.Json;
using CheckinApp.Models;

namespace CheckinApp.Services.Ai;

/// <summary>
/// 象棋 AI —— 极小极大 + α-β，深度 2~3 层。
/// 评估：子力价值 + 位置 + 将军加成。
/// </summary>
public static class XiangqiAi
{
    private const int NodeBudget = 120_000;
    private static int _nodes;

    private static readonly int[] TypeValue = [0, 10000, 200, 200, 400, 900, 450, 100]; // type → value

    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r)
    {
        var depth = level switch { 1 => 2, 2 => 3, _ => 3 };
        var board = XiangqiRules.Replay(evs);
        var moves = AllMoves(board, side);
        if (moves.Count == 0) return null;

        _nodes = 0;
        var best = moves[0];
        var bestScore = int.MinValue;

        foreach (var m in moves)
        {
            var next = CloneBoard(board);
            var piece = next[m.fx, m.fy];
            next[m.fx, m.fy] = 0;
            next[m.tx, m.ty] = piece;

            var score = -Search(next, XiangqiRules.Other(side), depth - 1, int.MinValue + 1, int.MaxValue - 1, side);
            if (score > bestScore) { bestScore = score; best = m; }
            if (_nodes >= NodeBudget) break;
        }

        return JsonSerializer.SerializeToElement(new { fx = best.fx, fy = best.fy, tx = best.tx, ty = best.ty });
    }

    private static int Search(int[,] board, int side, int depth, int alpha, int beta, int mySide)
    {
        _nodes++;
        if (_nodes >= NodeBudget || depth <= 0) return Evaluate(board, mySide);

        var moves = AllMoves(board, side);
        if (moves.Count == 0)
            return XiangqiRules.IsGeneralAttacked(board, side) ? -90000 : 0; // 将死或困毙

        var bestScore = int.MinValue;
        foreach (var m in moves)
        {
            var next = CloneBoard(board);
            var piece = next[m.fx, m.fy];
            next[m.fx, m.fy] = 0;
            next[m.tx, m.ty] = piece;

            var score = -Search(next, XiangqiRules.Other(side), depth - 1, -beta, -alpha, mySide);
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
        for (var x = 0; x < XiangqiRules.BoardW; x++)
        {
            for (var y = 0; y < XiangqiRules.BoardH; y++)
            {
                var piece = board[x, y];
                if (piece == 0) continue;
                var side = XiangqiRules.PieceSide(piece);
                var type = XiangqiRules.PieceType(piece);
                var val = TypeValue[type];
                // 过河兵加值
                if (type == XiangqiRules.Pawn && ((side == 1 && y <= 4) || (side == 2 && y >= 5)))
                    val += 50;
                score += side == mySide ? val : -val;
            }
        }
        // 将军加成
        if (XiangqiRules.IsGeneralAttacked(board, XiangqiRules.Other(mySide))) score += 80;
        return score;
    }

    private readonly record struct Move(int fx, int fy, int tx, int ty);

    private static List<Move> AllMoves(int[,] board, int side)
    {
        var moves = new List<Move>();
        for (var fx = 0; fx < XiangqiRules.BoardW; fx++)
        {
            for (var fy = 0; fy < XiangqiRules.BoardH; fy++)
            {
                if (board[fx, fy] == 0 || XiangqiRules.PieceSide(board[fx, fy]) != side) continue;
                var type = XiangqiRules.PieceType(board[fx, fy]);
                for (var tx = 0; tx < XiangqiRules.BoardW; tx++)
                {
                    for (var ty = 0; ty < XiangqiRules.BoardH; ty++)
                    {
                        if (fx == tx && fy == ty) continue;
                        if (board[tx, ty] != 0 && XiangqiRules.PieceSide(board[tx, ty]) == side) continue;
                        // 简单走法过滤（完整校验在 ValidateMove）
                        if (!QuickCheck(board, fx, fy, tx, ty, side, type)) continue;
                        moves.Add(new Move(fx, fy, tx, ty));
                    }
                }
            }
        }
        return moves;
    }

    private static bool QuickCheck(int[,] board, int fx, int fy, int tx, int ty, int side, int type)
    {
        var dx = Math.Abs(tx - fx);
        var dy = Math.Abs(ty - fy);
        return type switch
        {
            XiangqiRules.General => dx + dy == 1 && tx >= 3 && tx <= 5 && (side == 1 ? ty >= 7 : ty <= 2),
            XiangqiRules.Advisor => dx == 1 && dy == 1 && tx >= 3 && tx <= 5 && (side == 1 ? ty >= 7 : ty <= 2),
            XiangqiRules.Elephant => dx == 2 && dy == 2 && (side == 1 ? ty >= 5 : ty <= 4) && board[(fx + tx) / 2, (fy + ty) / 2] == 0,
            XiangqiRules.Horse => (dx == 2 && dy == 1 || dx == 1 && dy == 2) && board[dx == 2 ? (fx + tx) / 2 : fx, dy == 2 ? (fy + ty) / 2 : fy] == 0,
            XiangqiRules.Rook => (fx == tx || fy == ty) && PathClear(board, fx, fy, tx, ty),
            XiangqiRules.Cannon => (fx == tx || fy == ty) && CannonCheck(board, fx, fy, tx, ty),
            XiangqiRules.Pawn => dx + dy == 1 && (side == 1 ? ty <= fy && (fy <= 4 || dx == 0) : ty >= fy && (fy >= 5 || dx == 0)),
            _ => false,
        };
    }

    private static bool PathClear(int[,] board, int fx, int fy, int tx, int ty)
    {
        var dx = Math.Sign(tx - fx);
        var dy = Math.Sign(ty - fy);
        var cx = fx + dx; var cy = fy + dy;
        while (cx != tx || cy != ty) { if (board[cx, cy] != 0) return false; cx += dx; cy += dy; }
        return true;
    }

    private static bool CannonCheck(int[,] board, int fx, int fy, int tx, int ty)
    {
        var dx = Math.Sign(tx - fx);
        var dy = Math.Sign(ty - fy);
        var cx = fx + dx; var cy = fy + dy;
        var count = 0;
        while (cx != tx || cy != ty) { if (board[cx, cy] != 0) count++; cx += dx; cy += dy; }
        return board[tx, ty] != 0 ? count == 1 : count == 0;
    }

    private static int[,] CloneBoard(int[,] board)
    {
        var c = new int[XiangqiRules.BoardW, XiangqiRules.BoardH];
        Array.Copy(board, c, board.Length);
        return c;
    }
}
