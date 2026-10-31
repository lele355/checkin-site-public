using System.Text.Json;
using CheckinApp.Api;
using CheckinApp.Models;

namespace CheckinApp.Services;

/// <summary>
/// 翻棋（翻翻棋）规则 —— 规则唯一依据 docs/research/2026-10-30-fanqi-rules.md（13 源零分歧）。
///
/// 【布阵】全部 50 枚（每色 25）混洗背面朝上随机放进 50 个非行营格（大本营等同普通格，S7）；
///         行营 10 格不放子；开棋方系统随机（建房时掷）。
/// 【翻棋阶段】阵营未定，双方轮流只许翻子；某玩家翻出的颜色与其上一次翻出的颜色相同
///         → 该玩家执该色，对方执另一色（腾讯官方 S3「连续两次翻出同色」）。
/// 【行棋】每回合二选一：翻一枚暗子 / 移动一枚己方已翻开的可移动子。暗子不可动、不可被攻击。
/// 【战斗】与明棋同一张结算表（小攻大合法、攻方亡；同级/炸弹相撞双亡；工兵排雷；炸弹炸雷双亡）。
/// 【军旗】不可动；对方 3 雷未清时进入军旗格是非法走法；清完后任何己方棋子进入军旗格立即获胜。
/// 【胜负】扛旗 / 歼灭可动子（对方只剩地雷、军旗）/ 轮到方无任何合法操作（无暗子可翻且无可动子）。
/// 【和棋】连续 60 手无吃子、无翻子判和（winner=3, reason="draw"）。
///
/// 事件流（进 MovesJson 可重放）：
///   setup  s=棋子颜色(1/2) x,y v=rankValue p=pieceId   —— 50 枚混洗暗放
///   flip   s=玩家 x,y                                   —— 翻开暗子（阵营状态机驱动）
///   move   s=玩家 fx,fy,tx,ty                           —— 移动己方已翻开的子
///   battle s=玩家 att/def/result/fx,fy/tx,ty p,v        —— 战斗（含夺旗），同明棋事件形状
/// 棋盘拓扑复用 ArmyChessBoard.Adj（铁路/公路双轨），不另建图。
/// </summary>
public static class FanqiRules
{
    // ---------------- 常量 ----------------

    /// <summary>和棋线：连续多少手无吃子无翻子判和</summary>
    public const int QuietDraw = 60;

    // ---------------- 初始布阵 ----------------

    /// <summary>50 枚混洗暗放：每色 25 枚（配比同明棋），随机填满 50 个非行营格。</summary>
    public static List<GameEvent> InitialEvents(GameRoom r)
    {
        var rng = Random.Shared;
        var cells = new List<(int x, int y)>();
        for (var y = 0; y < ArmyChessRules.BoardH; y++)
            for (var x = 0; x < ArmyChessRules.BoardW; x++)
                if (ArmyChessRules.CellType(x, y) != ArmyChessRules.Camp) cells.Add((x, y));

        // 50 子混洗（颜色 1/2 各 25，配比同明棋 PieceSpec）
        var pieces = new List<(int color, int value)>();
        foreach (var (rank, count) in ArmyChessRules.SpecCounts())
            for (var i = 0; i < count; i++)
            {
                pieces.Add((1, ArmyChessRules.RankValue(rank)));
                pieces.Add((2, ArmyChessRules.RankValue(rank)));
            }
        for (var i = pieces.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (pieces[i], pieces[j]) = (pieces[j], pieces[i]);
        }

        // 50 子随机摆进 50 格（格子表也洗一遍，双重随机）
        for (var i = cells.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (cells[i], cells[j]) = (cells[j], cells[i]);
        }

        var evs = new List<GameEvent>();
        for (var i = 0; i < pieces.Count; i++)
            evs.Add(new GameEvent
            {
                t = "setup",
                s = pieces[i].color,
                x = cells[i].x,
                y = cells[i].y,
                v = pieces[i].value,
                p = i,
            });
        return evs;
    }

    // ---------------- 重放（唯一真相） ----------------

    /// <summary>重放结果：盘面 + 揭示集合 + 阵营状态机 + 和棋计数 + 最后行动方</summary>
    public sealed class FanqiState
    {
        /// <summary>盘面 [x,y] = 颜色*100+rankValue（0=空）</summary>
        public int[,] Board = new int[ArmyChessRules.BoardW, ArmyChessRules.BoardH];
        public Dictionary<(int x, int y), int> IdMap = new();
        /// <summary>已翻开的棋子 ID（暗子一切信息不下发）</summary>
        public HashSet<int> Revealed = new();
        /// <summary>玩家 → 执色（0=未定）</summary>
        public int ColorOf1, ColorOf2;
        /// <summary>阵营状态机：各玩家上一次翻出的颜色（0=还没翻过）</summary>
        public int LastFlipColor1, LastFlipColor2;
        /// <summary>连续无吃子、无翻子的手数</summary>
        public int Quiet;
        /// <summary>最后一个动作（flip/move/battle）的玩家</summary>
        public int LastActor;

        public int ColorOf(int player) => player == 1 ? ColorOf1 : ColorOf2;
        public bool Settled => ColorOf1 != 0 && ColorOf2 != 0;

        /// <summary>玩家 → 执色；色 → 玩家（未定返回 0）</summary>
        public int PlayerOf(int color)
        {
            if (ColorOf1 == color) return 1;
            if (ColorOf2 == color) return 2;
            return 0;
        }
    }

    /// <summary>确定性重放全部事件（flip 不改变位置只改揭示/阵营，battle 同明棋结算）</summary>
    public static FanqiState Replay(IReadOnlyList<GameEvent> evs)
    {
        var st = new FanqiState();
        foreach (var e in evs)
        {
            if (e.t == "setup" && e.x is int sx && e.y is int sy && e.v is int sv)
            {
                st.Board[sx, sy] = e.s * 100 + sv;
                if (e.p is int pid) st.IdMap[(sx, sy)] = pid;
            }
            else if (e.t == "flip" && e.x is int fx2 && e.y is int fy2)
            {
                ApplyFlip(st, e.s, fx2, fy2);
            }
            else if (e.t == "move" && e.fx is int mx && e.fy is int my && e.tx is int tx && e.ty is int ty)
            {
                MovePiece(st, mx, my, tx, ty);
                st.Quiet++;
                st.LastActor = e.s;
            }
            else if (e.t == "battle" && e.fx is int bx && e.fy is int by && e.tx is int btx && e.ty is int bty)
            {
                ApplyBattle(st, bx, by, btx, bty, e.result ?? "");
                st.Quiet = 0;
                st.LastActor = e.s;
            }
        }
        return st;
    }

    private static void MovePiece(FanqiState st, int fx, int fy, int tx, int ty)
    {
        var piece = st.Board[fx, fy];
        if (piece == 0) return;
        st.Board[fx, fy] = 0;
        st.Board[tx, ty] = piece;
        if (st.IdMap.TryGetValue((fx, fy), out var pid))
        {
            st.IdMap.Remove((fx, fy));
            st.IdMap[(tx, ty)] = pid;
        }
    }

    /// <summary>翻开一子：进揭示集合 + 阵营状态机（连续两翻同色 → 定阵营）</summary>
    private static void ApplyFlip(FanqiState st, int player, int x, int y)
    {
        var piece = st.Board[x, y];
        if (piece == 0) return;
        if (st.IdMap.TryGetValue((x, y), out var pid)) st.Revealed.Add(pid);
        st.Quiet = 0;   // 翻子重置和棋计数
        st.LastActor = player;

        var color = ArmyChessRules.PieceSide(piece);
        if (st.ColorOf(player) != 0) return;   // 阵营已定，翻子只是翻子

        var last = player == 1 ? st.LastFlipColor1 : st.LastFlipColor2;
        if (last == 0)
        {
            if (player == 1) st.LastFlipColor1 = color; else st.LastFlipColor2 = color;
            return;
        }
        if (last == color)
        {
            // 连续两翻同色 → 该玩家执该色，对方执另一色
            if (player == 1) { st.ColorOf1 = color; st.ColorOf2 = color == 1 ? 2 : 1; }
            else { st.ColorOf2 = color; st.ColorOf1 = color == 1 ? 2 : 1; }
            return;
        }
        if (player == 1) st.LastFlipColor1 = color; else st.LastFlipColor2 = color;
    }

    /// <summary>战斗结算落盘（同明棋四种结果）</summary>
    private static void ApplyBattle(FanqiState st, int fx, int fy, int tx, int ty, string result)
    {
        var attacker = st.Board[fx, fy];
        if (attacker == 0) return;
        switch (result)
        {
            case "attacker_wins":
            case "flag_captured":
                MovePiece(st, fx, fy, tx, ty);
                break;
            case "defender_wins":
                st.Board[fx, fy] = 0;
                st.IdMap.Remove((fx, fy));
                break;
            case "both_die":
                st.Board[fx, fy] = 0;
                st.Board[tx, ty] = 0;
                st.IdMap.Remove((fx, fy));
                st.IdMap.Remove((tx, ty));
                break;
        }
    }

    // ---------------- 行棋查询（拓扑复用 ArmyChessBoard.Adj） ----------------

    /// <summary>该色是否还有地雷存活（扛旗前置）</summary>
    public static bool MinesAlive(FanqiState st, int color)
    {
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var p = st.Board[x, y];
                if (p != 0 && ArmyChessRules.PieceSide(p) == color && ArmyChessRules.PieceRank(p) == ArmyChessRules.RANK_MINE)
                    return true;
            }
        return false;
    }

    /// <summary>己方（执 myColor）已翻开可动子从 fromNode 出发的全部合法落点（图查询与明棋同源）</summary>
    public static List<int> Reachable(FanqiState st, int fromNode, int myColor)
    {
        var result = new List<int>();
        if (fromNode < 0 || fromNode >= ArmyChessBoard.N) return result;
        var (x, y) = ArmyChessBoard.Coord(fromNode);
        var piece = st.Board[x, y];
        if (piece == 0) return result;
        if (ArmyChessRules.PieceSide(piece) != myColor) return result;
        if (!st.IdMap.TryGetValue((x, y), out var pid) || !st.Revealed.Contains(pid)) return result;
        var rank = ArmyChessRules.PieceRank(piece);
        if (rank is ArmyChessRules.RANK_FLAG or ArmyChessRules.RANK_MINE) return result;

        var enemyColor = myColor == 1 ? 2 : 1;
        var flagGuarded = MinesAlive(st, enemyColor);

        bool CanLand(int node)
        {
            var (tx, ty) = ArmyChessBoard.Coord(node);
            var target = st.Board[tx, ty];
            if (target == 0) return true;
            if (ArmyChessRules.PieceSide(target) == myColor) return false;
            if (!st.IdMap.TryGetValue((tx, ty), out var tid) || !st.Revealed.Contains(tid)) return false;   // 暗子不可被攻击
            if (ArmyChessRules.CellType(tx, ty) == ArmyChessRules.Camp) return false;                        // 行营安全岛
            if (ArmyChessRules.PieceRank(target) == ArmyChessRules.RANK_FLAG && flagGuarded) return false;  // 三雷前置
            return true;
        }

        return ArmyChessBoard.ReachableCore(st.Board, fromNode, rank == ArmyChessRules.RANK_ENGINEER, CanLand);
    }

    /// <summary>该玩家是否有任何合法操作（翻一枚暗子 或 走一子）</summary>
    public static bool HasAnyAction(FanqiState st, int player)
    {
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var p = st.Board[x, y];
                if (p == 0) continue;
                if (st.IdMap.TryGetValue((x, y), out var pid) && st.Revealed.Contains(pid)) continue;
                return true;   // 有暗子可翻
            }
        var myColor = st.ColorOf(player);
        if (myColor == 0) return false;   // 无暗子且阵营未定（理论不达）
        for (var node = 0; node < ArmyChessBoard.N; node++)
            if (Reachable(st, node, myColor).Count > 0) return true;
        return false;
    }

    // ---------------- 校验（与 ValidateMove 同级严格） ----------------

    /// <summary>
    /// 校验一个动作：{x,y} = 翻子；{fx,fy,tx,ty} = 走子。
    /// 走子遇敌生成 battle 事件（与明棋同形状）；夺旗也是 battle（result=flag_captured）。
    /// </summary>
    public static GameEvent ValidateMove(IReadOnlyList<GameEvent> evs, GameRoom r, int side, JsonElement req)
    {
        if (side is not (1 or 2)) throw new ApiBadRequest("你不在这一局里");
        if (r.Turn != side) throw new ApiBadRequest("还没轮到你");

        var st = Replay(evs);
        var isMove = req.TryGetProperty("fx", out _) || req.TryGetProperty("tx", out _);

        if (!isMove)
        {
            // ---- 翻子 ----
            var x = req.TryGetProperty("x", out var xe) ? xe.GetInt32() : -1;
            var y = req.TryGetProperty("y", out var ye) ? ye.GetInt32() : -1;
            if (x < 0 || x >= ArmyChessRules.BoardW || y < 0 || y >= ArmyChessRules.BoardH)
                throw new ApiBadRequest("位置不合法");
            if (st.Board[x, y] == 0) throw new ApiBadRequest("这里没有棋子");
            if (st.IdMap.TryGetValue((x, y), out var pid) && st.Revealed.Contains(pid))
                throw new ApiBadRequest("这枚棋子已经翻开了");
            return new GameEvent { t = "flip", s = side, x = x, y = y };
        }

        // ---- 走子 ----
        if (!st.Settled) throw new ApiBadRequest("阵营还没确定，只能翻子");

        var fx2 = req.TryGetProperty("fx", out var fxe) ? fxe.GetInt32() : -1;
        var fy2 = req.TryGetProperty("fy", out var fye) ? fye.GetInt32() : -1;
        var tx2 = req.TryGetProperty("tx", out var txe) ? txe.GetInt32() : -1;
        var ty2 = req.TryGetProperty("ty", out var tye) ? tye.GetInt32() : -1;

        if (fx2 < 0 || fx2 >= ArmyChessRules.BoardW || fy2 < 0 || fy2 >= ArmyChessRules.BoardH)
            throw new ApiBadRequest("起点不合法");
        if (tx2 < 0 || tx2 >= ArmyChessRules.BoardW || ty2 < 0 || ty2 >= ArmyChessRules.BoardH)
            throw new ApiBadRequest("终点不合法");
        if (fx2 == tx2 && fy2 == ty2) throw new ApiBadRequest("不能原地不动");

        var piece = st.Board[fx2, fy2];
        if (piece == 0) throw new ApiBadRequest("起点没有棋子");
        // 先判暗子再判颜色：错误文案差异不能泄露暗子归属（反泄露红线）
        if (!st.IdMap.TryGetValue((fx2, fy2), out var fp) || !st.Revealed.Contains(fp))
            throw new ApiBadRequest("暗子不能移动");
        var myColor = st.ColorOf(side);
        if (ArmyChessRules.PieceSide(piece) != myColor) throw new ApiBadRequest("这不是你的棋子");
        var rank = ArmyChessRules.PieceRank(piece);
        if (rank == ArmyChessRules.RANK_FLAG) throw new ApiBadRequest("军旗不能动");
        if (rank == ArmyChessRules.RANK_MINE) throw new ApiBadRequest("地雷不能动");

        var target = st.Board[tx2, ty2];
        if (target != 0)
        {
            if (!st.IdMap.TryGetValue((tx2, ty2), out var tp) || !st.Revealed.Contains(tp))
                throw new ApiBadRequest("不能攻击暗子");
            if (ArmyChessRules.PieceSide(target) == myColor) throw new ApiBadRequest("不能吃自己的棋子");
            if (ArmyChessRules.CellType(tx2, ty2) == ArmyChessRules.Camp)
                throw new ApiBadRequest("行营里的棋子不能被吃");
            if (ArmyChessRules.PieceRank(target) == ArmyChessRules.RANK_FLAG && MinesAlive(st, ArmyChessRules.PieceSide(target)))
                throw new ApiBadRequest("对方地雷未清，不能扛军旗");
        }

        var fromNode = ArmyChessBoard.Node(fx2, fy2);
        var toNode = ArmyChessBoard.Node(tx2, ty2);
        if (!Reachable(st, fromNode, myColor).Contains(toNode)) throw new ApiBadRequest("走法不合法");

        // 遇敌：生成 battle 事件（结算表同明棋；夺旗 = 进入军旗格，验证层已放行）
        if (target != 0)
        {
            var (battle, _, _, _) = ArmyChessRules.ResolveBattle(evs, r, side, fx2, fy2, tx2, ty2);
            return battle ?? new GameEvent { t = "move", s = side, fx = fx2, fy = fy2, tx = tx2, ty = ty2 };
        }
        return new GameEvent { t = "move", s = side, fx = fx2, fy = fy2, tx = tx2, ty = ty2 };
    }

    // ---------------- 胜负判定 ----------------

    /// <summary>
    /// 判定终局（每次动作后调用，r.Turn = 刚行动的一方）：
    /// 1 夺旗：某色军旗不在盘上 → 执该色的玩家胜（flag_captured）
    /// 2 歼灭可动子：某色全部存活子为地雷/军旗 → 对方胜（annihilate）
    /// 3 无合法着法：轮到下一家时无任何合法操作 → 下一家负（blocked）
    /// 4 连续 QuietDraw 手无吃子、无翻子 → 和（draw，winner=3）
    /// </summary>
    public static (int winner, string reason, bool over) Judge(IReadOnlyList<GameEvent> evs, GameRoom r)
    {
        var st = Replay(evs);

        // 1 夺旗
        var flag1 = HasFlag(st, 1);
        var flag2 = HasFlag(st, 2);
        if (!flag1 || !flag2)
        {
            var winnerColor = flag1 ? 1 : 2;
            return (st.PlayerOf(winnerColor), "flag_captured", true);
        }

        // 2 歼灭可动子（对方只剩地雷、军旗）
        var mobile1 = HasMobile(st, 1);
        var mobile2 = HasMobile(st, 2);
        if (!mobile1 || !mobile2)
        {
            var winnerColor = mobile1 ? 1 : 2;
            return (st.PlayerOf(winnerColor), "annihilate", true);
        }

        // 3 轮到下一家无任何合法操作（无暗子可翻且无可动子可走）
        var next = r.Turn == 1 ? 2 : 1;
        if (!HasAnyAction(st, next)) return (r.Turn, "blocked", true);

        // 4 和棋线
        if (st.Quiet >= QuietDraw) return (3, "draw", true);

        return (0, "", false);
    }

    private static bool HasFlag(FanqiState st, int color)
    {
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var p = st.Board[x, y];
                if (p != 0 && ArmyChessRules.PieceSide(p) == color && ArmyChessRules.PieceRank(p) == ArmyChessRules.RANK_FLAG)
                    return true;
            }
        return false;
    }

    /// <summary>该色是否还有可动类型（非地雷/军旗）的存活子</summary>
    private static bool HasMobile(FanqiState st, int color)
    {
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var p = st.Board[x, y];
                if (p == 0 || ArmyChessRules.PieceSide(p) != color) continue;
                var rank = ArmyChessRules.PieceRank(p);
                if (rank is not (ArmyChessRules.RANK_MINE or ArmyChessRules.RANK_FLAG)) return true;
            }
        return false;
    }

    // ---------------- 快照 ----------------

    /// <summary>
    /// per-game 快照。暗子只给 {x,y,hidden:true} —— 无 side 无 rank（反泄露红线）；
    /// 已翻开子给全量（颜色与军衔是明面信息）。battleLog 带 att/def（参战双方均已翻开，无泄露）。
    /// </summary>
    public static object BuildState(IReadOnlyList<GameEvent> evs, GameRoom r, int mySide, bool finished)
    {
        var st = Replay(evs);

        var squares = new List<object>();
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var ct = ArmyChessRules.CellType(x, y);
                if (ct != ArmyChessRules.Normal)
                    squares.Add(new { x, y, kind = ct == ArmyChessRules.Camp ? "camp" : "den" });
            }

        var pieces = new List<object>();
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var piece = st.Board[x, y];
                if (piece == 0) continue;
                var revealed = st.IdMap.TryGetValue((x, y), out var pid) && st.Revealed.Contains(pid);
                if (revealed || finished)
                {
                    var side = ArmyChessRules.PieceSide(piece);
                    var rank = ArmyChessRules.PieceRank(piece);
                    pieces.Add(new { x, y, side, rank, hidden = false });
                }
                else
                {
                    pieces.Add(new { x, y, hidden = true });
                }
            }

        var battleLog = evs.Where(e => e.t == "battle")
            .Select(e => new { att = e.att, def = e.def, result = e.result ?? "", fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty }).ToList();

        // events：setup 绝不下发（含全部暗子身份）；flip/move/battle 是公开事件
        var eventsOut = finished
            ? evs.Select(e => new { t = e.t, s = e.s, x = e.x, y = e.y, fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty, att = e.att, def = e.def, result = e.result ?? "" }).ToList()
            : evs.Where(e => e.t is "flip" or "move" or "battle")
                .Select(e => new { t = e.t, s = e.s, x = e.x, y = e.y, fx = e.fx, fy = e.fy, tx = e.tx, ty = e.ty, att = e.att, def = e.def, result = e.result ?? "" }).ToList();

        var last = evs.LastOrDefault(e => e.t is "move" or "battle" or "flip");
        var myColor = mySide is 1 or 2 ? st.ColorOf(mySide) : 0;

        // 可走提示（Batch D）：己方已翻开棋子的合法落点（暗子不可动，正式校验器逐格试）
        // 可走提示按需化（QA §3-P1）：不再随快照全量 Build；单子提示走 GET /rooms/{id}/hints
        return new
        {
            boardW = ArmyChessRules.BoardW,
            boardH = ArmyChessRules.BoardH,
            mode = "fanqi",
            squares,
            pieces,
            battleLog,
            events = eventsOut,
            lastMove = last is null
                ? null
                : last.t == "flip"
                    // BUG-3 兼容哨兵：翻子无起点 → fx=tx, fy=ty（旧 App 非空 Int 反序列化不炸，
                    // 双端均视 fx==tx&&fy==ty 为无滑动动画；勿改回 null = 旧 App 契约破坏）
                    ? new { fx = last.x, fy = last.y, tx = last.x, ty = last.y }
                    : new { fx = last.fx, fy = last.fy, tx = last.tx, ty = last.ty },
            myColor,
            oppColor = myColor == 0 ? 0 : (myColor == 1 ? 2 : 1),
            settled = st.Settled,
            darkLeft = CountDark(st),
            quiet = st.Quiet,
        };
    }

    private static int CountDark(FanqiState st)
    {
        var n = 0;
        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var p = st.Board[x, y];
                if (p == 0) continue;
                if (!(st.IdMap.TryGetValue((x, y), out var pid) && st.Revealed.Contains(pid))) n++;
            }
        return n;
    }

    // ---------------- AI ----------------

    /// <summary>该玩家全部合法操作（可直接喂 ValidateMove 的请求体）：翻子 {x,y} + 走子 {fx,fy,tx,ty}</summary>
    public static List<JsonElement> AllActions(IReadOnlyList<GameEvent> evs, GameRoom r, int side)
    {
        var st = Replay(evs);
        var list = new List<JsonElement>();

        for (var x = 0; x < ArmyChessRules.BoardW; x++)
            for (var y = 0; y < ArmyChessRules.BoardH; y++)
            {
                var p = st.Board[x, y];
                if (p == 0) continue;
                if (st.IdMap.TryGetValue((x, y), out var pid) && st.Revealed.Contains(pid)) continue;
                list.Add(JsonSerializer.SerializeToElement(new { x, y }));
            }

        if (!st.Settled) return list;   // 阵营未定：只能翻

        var myColor = st.ColorOf(side);
        for (var node = 0; node < ArmyChessBoard.N; node++)
        {
            var (x, y) = ArmyChessBoard.Coord(node);
            foreach (var to in Reachable(st, node, myColor))
            {
                var (tx, ty) = ArmyChessBoard.Coord(to);
                list.Add(JsonSerializer.SerializeToElement(new { fx = x, fy = y, tx, ty }));
            }
        }
        return list;
    }

    /// <summary>
    /// 翻棋启发式：能夺旗 → 夺旗；有利吃子 → 最大战果；有暗子 → 翻子；否则最安全着。
    /// 红线：有合法操作必返回一条（绝不 null 过棋）。
    /// </summary>
    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, GameRoom r, int side, int level)
    {
        var st = Replay(evs);
        var actions = AllActions(evs, r, side);
        if (actions.Count == 0) return null;

        var myColor = st.ColorOf(side);
        JsonElement? best = null;
        double bestScore = double.MinValue;

        foreach (var a in actions)
        {
            double score;
            if (a.TryGetProperty("fx", out _))
            {
                var fx = a.GetProperty("fx").GetInt32();
                var fy = a.GetProperty("fy").GetInt32();
                var tx = a.GetProperty("tx").GetInt32();
                var ty = a.GetProperty("ty").GetInt32();
                var attacker = st.Board[fx, fy];
                var target = st.Board[tx, ty];
                if (target == 0)
                {
                    score = 20;   // 前进（普通走子）
                    // 行营 = 安全岛，稍优先
                    if (ArmyChessRules.CellType(tx, ty) == ArmyChessRules.Camp) score += 15;
                }
                else
                {
                    var defRank = ArmyChessRules.PieceRank(target);
                    if (defRank == ArmyChessRules.RANK_FLAG) score = 100000;   // 夺旗
                    else
                    {
                        var attValue = ArmyChessRules.RankValue(ArmyChessRules.PieceRank(attacker));
                        var defValue = ArmyChessRules.RankValue(defRank);
                        // 战果差：双亡按「兑子」计（炸弹换大子划算）
                        score = 500 + (defValue - attValue) * 10;
                    }
                }
            }
            else
            {
                // 翻子：有暗子就翻（信息即战力）；给基准分
                score = 60;
            }

            if (score > bestScore) { bestScore = score; best = a; }
        }

        return best ?? actions[0];   // 红线兜底
    }
}
