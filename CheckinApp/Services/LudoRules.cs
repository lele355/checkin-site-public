using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 飞行棋规则 —— 2~4 人（红/黄/蓝/绿），骰子服务端出，必须掷 6 起飞。
/// 事件流：roll（骰子）+ move（走子）+ pass（无着）。
/// 座位/颜色/起点/轮转/出局走 <see cref="LudoSeats"/>（座位唯一真相）。
/// 2 人 = 红黄 起点 0/26，与一期完全一致（存量零漂移）。
/// </summary>
public static class LudoRules
{
    public const int TrackLen = 52;       // 主跑道长度
    public const int HomeLen = 6;         // 终点跑道
    public const int PiecesPerSide = 4;

    /// <summary>掷 6 连续额外回合上限（防无限：连续掷 6 理论可无限，概率 1/6）</summary>
    public const int MaxExtraTurnsOnSix = 3;

    /// <summary>本座最近连续掷出 6 的次数（从事件流尾部往前数，遇别的座或非 6 即停）</summary>
    public static int ConsecutiveSixes(IReadOnlyList<GameEvent> evs, int side)
    {
        var count = 0;
        for (var i = evs.Count - 1; i >= 0; i--)
        {
            var e = evs[i];
            if (e.t == "move" || e.t == "pass") continue;   // 已消费标记，继续往前找 roll
            if (e.t == "roll")
            {
                if (e.s != side) break;                     // 轮到别的座 → 本座连 6 链结束
                if (e.v == 6) count++; else break;
            }
            else break;                                     // setup 等
        }
        return count;
    }

    /// <summary>本手（已消费的这次 roll）是否应给额外回合：掷 6 且连续 6 未超上限</summary>
    public static bool GrantsExtraTurn(IReadOnlyList<GameEvent> evs, int side)
    {
        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        if (lastRoll is null || lastRoll.v != 6) return false;
        return ConsecutiveSixes(evs, side) <= MaxExtraTurnsOnSix;
    }

    /// <summary>座位数（2/3/4）</summary>
    public static int SeatCount(GameRoom r) => LudoSeats.Count(r);

    /// <summary>初始化事件（每座 4 子在机库，未起飞）</summary>
    public static List<GameEvent> InitialEvents(GameRoom r)
    {
        var evs = new List<GameEvent>();
        foreach (var seat in LudoSeats.Get(r))
            for (var p = 0; p < PiecesPerSide; p++)
                evs.Add(new GameEvent { t = "setup", s = seat.Side, p = p, v = -1 }); // v=-1 表示在家
        return evs;
    }

    /// <summary>
    /// 校验骰子（roll 事件）。
    /// 状态机：roll → (move | pass) 之后才算本手结束，未消费时才拒重复 roll。
    /// </summary>
    public static GameEvent ValidateRoll(IReadOnlyList<GameEvent> evs, GameRoom r, int side)
    {
        if (side is not (>= 1 and <= 4)) throw new ApiBadRequest("你不在这一局里");
        if (r.Turn != side) throw new ApiBadRequest("还没轮到你");

        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        if (lastRoll != null)
        {
            var afterRoll = evs.SkipWhile(e => e != lastRoll).Skip(1).ToList();
            var consumed = afterRoll.Any(e => (e.t == "move" || e.t == "pass") && e.s == side);
            if (!consumed)
                throw new ApiBadRequest("已经掷过了，选一个棋子走");
        }

        var value = Random.Shared.Next(1, 7);
        return new GameEvent { t = "roll", s = side, v = value };
    }

    /// <summary>校验走子（需要先 roll）</summary>
    public static GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        if (side is not (>= 1 and <= 4)) throw new ApiBadRequest("你不在这一局里");
        if (r.Turn != side) throw new ApiBadRequest("还没轮到你");

        var pieceIdx = req.TryGetProperty("p", out var pp) ? pp.GetInt32() : -1;
        if (pieceIdx < 0 || pieceIdx >= PiecesPerSide) throw new ApiBadRequest("棋子编号不合法");

        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        if (lastRoll is null) throw new ApiBadRequest("先掷骰子");
        var rollValue = lastRoll.v ?? 0;

        var afterRoll = evs.SkipWhile(e => e != lastRoll).Skip(1).ToList();
        if (afterRoll.Any(e => e.t == "move" && e.s == side))
            throw new ApiBadRequest("这一轮已经走过了");

        var board = Replay(evs);
        var piecePos = board[side, pieceIdx]; // -1 = 在家, 0-51 = 主跑道, 52-57 = 终点跑道

        if (piecePos == -1)
        {
            if (rollValue != 6) throw new ApiBadRequest("必须掷 6 才能起飞");
        }
        else
        {
            var newPos = piecePos + rollValue;
            if (newPos >= TrackLen + HomeLen) throw new ApiBadRequest("超出终点");
            if (newPos > TrackLen - 1 && piecePos <= TrackLen - 1)
            {
                var homeSteps = newPos - TrackLen;
                if (homeSteps >= HomeLen) throw new ApiBadRequest("超出终点");
            }
        }

        return new GameEvent { t = "move", s = side, p = pieceIdx, v = rollValue };
    }

    /// <summary>判定终局：某 active 座 4 子全归巢即胜</summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var board = Replay(evs);
        foreach (var seat in LudoSeats.Active(r))
        {
            var side = seat.Side;
            var allHome = true;
            for (var p = 0; p < PiecesPerSide; p++)
                if (board[side, p] < TrackLen + HomeLen - 1) { allHome = false; break; }
            if (allHome) return (side, "finish", true);
        }
        return (0, "", false);
    }

    /// <summary>构建 per-game 快照（pieces 含全部座；每座 4 机位置）</summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var board = Replay(evs);
        var lastRoll = evs.LastOrDefault(e => e.t == "roll");

        var pieces = new List<object>();
        foreach (var seat in LudoSeats.Get(r))
            for (var p = 0; p < PiecesPerSide; p++)
                // 出局座（active=false）：飞机回机库（-1），不渲染残局冻结棋子（真相不变，只是不画）
                pieces.Add(new { side = seat.Side, p, pos = seat.Active ? board[seat.Side, p] : -1 });

        // 轮到我这座且（还没掷 / 已掷未走）
        var needRoll = false;
        if (r.Turn == mySide && mySide != 0)
        {
            var lastMyRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == mySide);
            var consumed = lastMyRoll is null
                || evs.SkipWhile(e => e != lastMyRoll).Skip(1).Any(e => (e.t == "move" || e.t == "pass") && e.s == mySide);
            needRoll = consumed;
        }

        return new
        {
            pieces,
            lastRoll = lastRoll?.v,
            seatCount = LudoSeats.Count(r),
            needRoll,
        };
    }

    /// <summary>重建棋子位置。board[side,piece] = -1(在家)/0-51(主跑道)/52-57(终点跑道)</summary>
    public static int[,] Replay(IReadOnlyList<GameEvent> evs)
    {
        var board = new int[5, PiecesPerSide]; // index 0 不用，1..4 = side
        for (var s = 0; s < 5; s++)
            for (var p = 0; p < PiecesPerSide; p++)
                board[s, p] = -1;

        foreach (var e in evs)
        {
            if (e.t == "move" && e.p is int pi && e.v is int steps && e.s is >= 1 and <= 4)
            {
                var cur = board[e.s, pi];
                if (cur == -1)
                    board[e.s, pi] = LudoSeats.StartOf(e.s); // 起飞到起点
                else
                    board[e.s, pi] = cur + steps;
            }
        }
        return board;
    }

    /// <summary>该方是否有任何合法走法（给定骰点）</summary>
    public static bool HasAnyValidMove(IReadOnlyList<GameEvent> evs, int side, int rollValue)
    {
        var board = Replay(evs);
        for (var p = 0; p < PiecesPerSide; p++)
        {
            var pos = board[side, p];
            if (pos == -1 && rollValue == 6) return true;
            if (pos >= 0)
            {
                var newPos = pos + rollValue;
                if (newPos < TrackLen + HomeLen) return true;
            }
        }
        return false;
    }

    /// <summary>AI 贪心：优先起飞，然后走最前面的子</summary>
    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r)
    {
        var board = Replay(evs);
        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        if (lastRoll is null) return null;
        var roll = lastRoll.v ?? 0;

        var bestPiece = -1;
        var bestPos = int.MaxValue;
        for (var p = 0; p < PiecesPerSide; p++)
        {
            var pos = board[side, p];
            if (pos == -1 && roll == 6) { bestPiece = p; break; }
            if (pos >= 0 && pos + roll < TrackLen + HomeLen && pos < bestPos)
            {
                bestPos = pos;
                bestPiece = p;
            }
        }
        return bestPiece < 0 ? null : JsonSerializer.SerializeToElement(new { p = bestPiece });
    }

    /// <summary>2 人时的对方（多方轮转请用 LudoSeats.NextActive）</summary>
    public static int Other(int side) => side == 1 ? 2 : 1;
    public static string SideName(int side) => side switch
    {
        1 => "红方", 2 => "黄方", 3 => "蓝方", 4 => "绿方", _ => "？",
    };
}
