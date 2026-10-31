using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 飞行棋规则 v2 —— 中国飞行棋（设计 §3）。
///
/// 52 格主环拓扑不变 + 颜色函数 color(i)=i mod 4（0=红 1=黄 2=蓝 3=绿，每色 13 格）。
/// 起点 start=13×(k−1)（红0/黄13/蓝26/绿39，起点格恰为本色格）；HomeEntry=start−2。
/// 虚线捷径：入口=start+16、落点=start+28（+12）；常量与渲染共用（§9.2）。
///
/// 一手 = roll → move{p} → 确定性链（跳4→飞12→再跳4，硬上限 3 跳，最大 20 格）。
/// 撞子全局（无安全格）：主环推进/跳4 途经逐格+落点撞；飞越撞入口+落点两格。
/// 终点反弹：t=h+roll，t==6 进中心，t&gt;6 回弹 h'=12−t（≥1 恒成立）。
/// 三连六：连续第 3 个 roll=6 → penalty 事件（第一手机返机场，未走动顺延第二手）→ 换人。
/// 跳/飞/撞由 Replay 用同一纯函数重放，不进事件流（事件只新增 penalty 一种）。
/// pos 编码：-1 机场 / 0-51 主环 / 52-57 本色终点航道（h=0..5）/ 58 中心。
/// </summary>
public static class LudoRules
{
    public const int TrackLen = 52;       // 主环长度
    public const int HomeLen = 6;         // 终点航道
    public const int PiecesPerSide = 4;
    public const int CenterPos = 58;      // 52+6 = 中心

    public static int ColorOfCell(int cell) => ((cell % 4) + 4) % 4;
    public static int SideColorIndex(int side) => ((side - 1) % 4 + 4) % 4;

    /// <summary>起点：start=13×(k−1)（本性化起点格，恰为本色格）</summary>
    public static int StartOf(int side) => 13 * (SideColorIndex(side));

    /// <summary>进终点前的主环格：start−2 mod 52（50/11/24/37）</summary>
    public static int HomeEntryOf(int side) => ((StartOf(side) - 2) % TrackLen + TrackLen) % TrackLen;

    /// <summary>虚线捷径入口/落点（+12）</summary>
    public static int ShortcutEntryOf(int side) => (StartOf(side) + 16) % TrackLen;
    public static int ShortcutLandOf(int side) => (StartOf(side) + 28) % TrackLen;

    public static bool InHomeTrack(int pos) => pos is >= 52 and <= 57;

    /// <summary>座位数（2/3/4）</summary>
    public static int SeatCount(GameRoom r) => LudoSeats.Count(r);

    /// <summary>初始化事件（每座 4 子在机场）</summary>
    public static List<GameEvent> InitialEvents(GameRoom r)
    {
        var evs = new List<GameEvent>();
        foreach (var seat in LudoSeats.Get(r))
            for (var p = 0; p < PiecesPerSide; p++)
                evs.Add(new GameEvent { t = "setup", s = seat.Side, p = p, v = -1 });
        return evs;
    }

    /// <summary>本座最近连续掷出 6 的次数（从事件流尾部往前数，遇别的座或非 6 即停）</summary>
    public static int ConsecutiveSixes(IReadOnlyList<GameEvent> evs, int side)
    {
        var count = 0;
        for (var i = evs.Count - 1; i >= 0; i--)
        {
            var e = evs[i];
            if (e.t == "move" || e.t == "pass") continue;
            if (e.t == "penalty") break;   // 罚单是链界（上一串连六到此为止）
            if (e.t == "roll")
            {
                if (e.s != side) break;
                if (e.v == 6) count++; else break;
            }
            else break;
        }
        return count;
    }

    /// <summary>本手是否额外回合：掷 6 即额外回合（三连六在第 3 次掷出时已罚+换人，走不到这）</summary>
    public static bool GrantsExtraTurn(IReadOnlyList<GameEvent> evs, int side)
    {
        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        return lastRoll is { v: 6 };
    }

    /// <summary>
    /// 三连六判定（roll 落库后调用）：连续第 3 个 6 → penalty 事件。
    /// 罚第一手 move 的机号（未走动顺延第二手；两手都没走 = p:-1 罚空转只换人）。
    /// </summary>
    public static GameEvent? PendingPenalty(IReadOnlyList<GameEvent> evs, int side)
    {
        if (ConsecutiveSixes(evs, side) < 3) return null;
        // 本连六链里的 move（从尾往前扫全部记录，最后留下的是链内最早一手 = 第一手的机号；
        // 第一手未走动则自然顺延第二手的；两手都没走 → p:-1 罚空转）
        int? firstMoved = null;
        var seenRolls = 0;
        for (var i = evs.Count - 1; i >= 0; i--)
        {
            var e = evs[i];
            if (e.t == "roll" && e.s == side)
            {
                seenRolls++;
                if (seenRolls >= 3) break;   // 再往前就是链外
                continue;
            }
            if (e.t == "penalty") break;
            if (e.t == "move" && e.s == side && e.p is int pi)
                firstMoved = pi;
        }
        return new GameEvent { t = "penalty", s = side, p = firstMoved ?? -1 };
    }

    /// <summary>校验骰子（roll 事件）：roll → (move|pass) 消费后才可再掷</summary>
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

    /// <summary>本 roll 下可走的机号（服务端算好，双端高亮直接消费）</summary>
    public static List<int> MovablePieces(IReadOnlyList<GameEvent> evs, GameRoom r, int side)
    {
        var result = new List<int>();
        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        if (lastRoll is null) return result;
        var roll = lastRoll.v ?? 0;
        var afterRoll = evs.SkipWhile(e => e != lastRoll).Skip(1).ToList();
        if (afterRoll.Any(e => (e.t == "move" || e.t == "pass") && e.s == side)) return result;

        var board = Replay(evs);
        for (var p = 0; p < PiecesPerSide; p++)
        {
            var pos = board[side, p];
            if (pos == -1) { if (roll == 6) result.Add(p); continue; }
            if (pos == CenterPos) continue;
            result.Add(p);   // 主环/航道：任何骰点都可走（越终反弹）
        }
        return result;
    }

    /// <summary>校验走子（需要先 roll；机号必须在 movable 内）</summary>
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
        var piecePos = board[side, pieceIdx];
        if (piecePos == -1 && rollValue != 6) throw new ApiBadRequest("必须掷 6 才能起飞");
        if (piecePos == CenterPos) throw new ApiBadRequest("这架飞机已到达终点");

        return new GameEvent { t = "move", s = side, p = pieceIdx, v = rollValue };
    }

    /// <summary>判定终局：某 active 座 4 机全部进中心即胜</summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var board = Replay(evs);
        foreach (var seat in LudoSeats.Active(r))
        {
            var allHome = true;
            for (var p = 0; p < PiecesPerSide; p++)
                if (board[seat.Side, p] != CenterPos) { allHome = false; break; }
            if (allHome) return (seat.Side, "finish", true);
        }
        return (0, "", false);
    }

    /// <summary>构建 per-game 快照（pieces 全座 4 机 + movable + needRoll）</summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var board = Replay(evs);
        var lastRoll = evs.LastOrDefault(e => e.t == "roll");

        var pieces = new List<object>();
        foreach (var seat in LudoSeats.Get(r))
            for (var p = 0; p < PiecesPerSide; p++)
                pieces.Add(new { side = seat.Side, p, pos = seat.Active ? board[seat.Side, p] : -1 });

        var needRoll = false;
        if (r.Turn == mySide && mySide != 0)
        {
            var lastMyRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == mySide);
            var consumed = lastMyRoll is null
                || evs.SkipWhile(e => e != lastMyRoll).Skip(1).Any(e => (e.t == "move" || e.t == "pass") && e.s == mySide);
            needRoll = consumed;
        }

        var movable = (r.Turn == mySide && mySide != 0 && !finished)
            ? MovablePieces(evs, r, mySide)
            : new List<int>();

        return new
        {
            pieces,
            lastRoll = lastRoll?.v,
            seatCount = LudoSeats.Count(r),
            needRoll,
            movable,
        };
    }

    // ---------------- 确定性行进（Replay 唯一真相） ----------------

    /// <summary>撞子：该主环格上的全部敌机撞回机场（全局无安全格）</summary>
    private static void CaptureAt(int[,] board, int side, int cell)
    {
        for (var s = 1; s <= 4; s++)
        {
            if (s == side) continue;
            for (var p = 0; p < PiecesPerSide; p++)
                if (board[s, p] == cell) board[s, p] = -1;
        }
    }

    /// <summary>
    /// 一手的确定性行进（含起飞/主环推进+撞子/入航道反弹/跳4→飞12→再跳4 链）。
    /// Replay 与服务端判定共用 —— 跳/飞/撞不进事件流。
    /// </summary>
    public static void ApplyMove(int[,] board, int side, int pieceIdx, int roll)
    {
        var cur = board[side, pieceIdx];
        if (cur == -1)
        {
            if (roll != 6) return;                    // 起飞必须掷 6（校验层已拦）
            var start = StartOf(side);
            board[side, pieceIdx] = start;
            CaptureAt(board, side, start);            // 落点撞子
            return;
        }
        if (cur == CenterPos) return;                 // 已归巢

        if (InHomeTrack(cur))
        {
            // 航道内：t=h+roll；t==6 进中心；t>6 反弹 h'=12−t
            var h = cur - 52;
            var t = h + roll;
            if (t == 6) { board[side, pieceIdx] = CenterPos; return; }
            board[side, pieceIdx] = t > 6 ? 52 + (12 - t) : 52 + t;
            return;
        }

        // 主环推进：逐格走（途经+落点撞子）
        var pos = cur;
        var homeEntry = HomeEntryOf(side);
        var enteredHome = false;
        var hPos = 0;
        for (var step = 0; step < roll; step++)
        {
            // 在 HomeEntry 上再走一格 = 转入终点航道
            if (pos == homeEntry)
            {
                enteredHome = true;
                hPos = step;   // 剩余步数从 0 计
                break;
            }
            pos = (pos + 1) % TrackLen;
            CaptureAt(board, side, pos);
        }
        if (enteredHome)
        {
            var remaining = roll - hPos;   // 含转入航道的这一步
            var t = remaining - 1;         // 航道第 1 格 = h 0
            // 与航道内同一套进中心/反弹公式（从主环转入最多 +6，t 恒 ≤ 5，此处为公式统一）
            if (t == 6) { board[side, pieceIdx] = CenterPos; return; }
            board[side, pieceIdx] = t > 6 ? 52 + (12 - t) : 52 + t;
            return;
        }

        // 确定性链（R-P0-1）：跳4 → 飞12 →（仅掷到入口时）再跳4；硬上限 3 跳、飞一生一次。
        // 规则依据（维基/萌娘/腾讯问问一致）：以骰子点数踏到虚线入口 → 飞 12 后可再跳 4（+16）；
        // 因「跳 +4」而落到入口 → 可飞 12 但飞后不再跳 4（仅 +12）；跳不能连跳，杜绝循环。
        var jumped = false;
        var flown = false;
        var land = pos;
        for (var hop = 0; hop < 3; hop++)
        {
            if (land == ShortcutEntryOf(side) && !flown)
            {
                // 飞 +12：撞入口格 + 落点格（虚线横穿中央区）
                CaptureAt(board, side, land);
                land = ShortcutLandOf(side);
                CaptureAt(board, side, land);
                flown = true;
                // R-P0-1：不重置 jumped —— 因跳而到入口时（jumped=true）飞后不再跳 4；
                // 掷到入口时（jumped=false）飞后落点为本色仍可跳 4 一次
                continue;
            }
            if (ColorOfCell(land) == SideColorIndex(side) && !jumped)
            {
                // 跳 +4：途经逐格 + 落点
                for (var k = 0; k < 4; k++)
                {
                    land = (land + 1) % TrackLen;
                    CaptureAt(board, side, land);
                }
                jumped = true;
                continue;
            }
            break;
        }
        board[side, pieceIdx] = land;
    }

    /// <summary>重建棋子位置。board[side,piece] = -1(机场)/0-51(主环)/52-57(航道)/58(中心)。
    /// 跳/飞/撞由本函数用 ApplyMove 确定性重放，不进事件流。</summary>
    public static int[,] Replay(IReadOnlyList<GameEvent> evs)
    {
        var board = new int[5, PiecesPerSide];
        for (var s = 0; s < 5; s++)
            for (var p = 0; p < PiecesPerSide; p++)
                board[s, p] = -1;

        foreach (var e in evs)
        {
            if (e.t == "move" && e.p is int pi && e.v is int steps && e.s is >= 1 and <= 4)
            {
                ApplyMove(board, e.s, pi, steps);
            }
            else if (e.t == "penalty" && e.s is >= 1 and <= 4 && e.p is int pp && pp >= 0)
            {
                board[e.s, pp] = -1;   // 罚回机场
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
            if (pos is >= 0 and not CenterPos) return true;   // 主环/航道：任何骰点可走（反弹）
        }
        return false;
    }

    /// <summary>
    /// AI 择优（T07 优先级）：归巢 &gt; 起飞 &gt; 跳4/飞12 链 &gt; 撞子 &gt; 普通前进；
    /// 三连六罚回风险下选损失最小机。
    /// 红线：HasAnyValidMove 为真时 Think 必返回着法（不返 null，禁止 null-pass）。
    /// </summary>
    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r)
    {
        var board = Replay(evs);
        var lastRoll = evs.LastOrDefault(e => e.t == "roll" && e.s == side);
        if (lastRoll is null) return null;
        var roll = lastRoll.v ?? 0;

        // 可走机集合（与 ValidateMove 同判）
        var candidates = new List<int>();
        for (var p = 0; p < PiecesPerSide; p++)
        {
            var pos = board[side, p];
            if (pos == -1 && roll == 6) candidates.Add(p);
            else if (pos is >= 0 and not CenterPos) candidates.Add(p);
        }
        if (candidates.Count == 0) return null;

        // 评分：模拟每 candidate 的落点（用 ApplyMove 的副本），按结果打分
        int best = candidates[0];
        double bestScore = double.MinValue;
        foreach (var p in candidates)
        {
            var clone = (int[,])board.Clone();
            var before = clone[side, p];
            ApplyMove(clone, side, p, roll);
            var after = clone[side, p];
            double score;
            if (before == -1) score = 900;                       // 起飞
            else if (after == CenterPos) score = 10000;          // 归巢
            else
            {
                score = after;                                    // 前进距离
                if (after > before && InHomeTrack(after)) score += 500;   // 入航道
                // 跳4/飞12/极值链：主环净推进超过骰点 = 链生效（跳/飞不进事件流，从落点反推）
                var onRing = before is >= 0 and < TrackLen && after is >= 0 and < TrackLen;
                var chained = after == ShortcutLandOf(side)
                    || (onRing && (after - before + TrackLen) % TrackLen > roll);
                if (chained) score += 600;
                // 撞子奖励：clone 里其它方少了主环子 = 被撞
                var bumped = 0;
                for (var s = 1; s <= 4; s++)
                {
                    if (s == side) continue;
                    for (var q = 0; q < PiecesPerSide; q++)
                        if (board[s, q] >= 0 && clone[s, q] == -1) bumped++;
                }
                score += bumped * 400;
                // 保守：大子（第一架已进深）不冒险 —— 简化为同分取先
            }
            if (score > bestScore) { bestScore = score; best = p; }
        }
        return JsonSerializer.SerializeToElement(new { p = best });
    }

    /// <summary>2 人时的对方（多方轮转请用 LudoSeats.NextActive）</summary>
    public static int Other(int side) => side == 1 ? 2 : 1;
    public static string SideName(int side) => side switch
    {
        1 => "红方", 2 => "黄方", 3 => "蓝方", 4 => "绿方", _ => "？",
    };
}
