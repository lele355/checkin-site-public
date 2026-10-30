using System.Text.Json;
using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Api;

/// <summary>
/// 小游戏（目前只有五子棋）—— 网页端与 App 共用同一套接口。
///
/// 【路由是两级的】入口第一屏拿游戏列表，点进某个游戏才有房间：
///   GET  /games                              游戏列表（GameCatalog）
///   GET  /games/settings                     游戏总设置（显示偏好，不进房间）
///   GET  /games/{gameKey}/settings           这个游戏的规则默认（建房时快照进房间）
///   GET  /games/{gameKey}/rooms              大厅
///   POST /games/{gameKey}/rooms              建房
///   GET  /games/{gameKey}/rooms/{id}         房间状态（轮询）
///   POST /games/{gameKey}/rooms/{id}/…       join / move / resign / rematch / leave
///   POST /games/join                         凭房间码加入（房间码自带游戏信息）
/// 加第二种游戏只要在 <see cref="GameCatalog"/> 登记一条 + 补规则实现，
/// 路由骨架不用动。
///
/// 联机方式刻意选了**短轮询**而不是 WebSocket / SignalR：
/// 回合制棋类对延迟不敏感（1.2 秒刷新完全够用），而轮询在两端实现都很轻
/// （网页一个 setInterval、App 一个 while+delay），也不用为 Cookie / Bearer
/// 两条认证通道各写一套长连接。要真做即时对战再上 SignalR 也不冲突 —— 状态都在这一行房间里。
///
/// 并发防双落：所有改写都带 <c>Revision</c> 条件更新（ExecuteUpdate + Where），
/// 抢到的那一手成功，另一手影响 0 行 → 返回「对手刚走过一步」。
///
/// 规则（盘面大小 / 禁手 / 限时）在**建房时**从房主的默认设置快照进房间，
/// 之后双方共享同一套，中途改设置不影响已开打的局。
///
/// 计时与房间回收都是**懒结算**（没有后台 Timer，服务器内存很紧）：
/// 超时由 <see cref="GameClock.Enforce"/> 在谁读这一局时顺手判，
/// 闲置 5 分钟的房间由 <see cref="GameSweeper.Sweep"/> 在谁读大厅时顺手清。
/// </summary>
public static class GamesApi
{
    public const string GameKey = "gomoku";
    public const int LobbyKeep = 30;

    // ---------- 请求体 ----------
    /// <summary>
    /// 建房：side = 我执哪一方（1 黑先手 / 2 白后手）；
    /// opponent = "friend"（等人）或 "ai"（AI 对局，立即开始）；
    /// 后面是「这一局」的覆盖值，不传就用房主的默认设置。
    /// </summary>
    public record CreateReq(
        int Side = 1,
        string? Opponent = null,
        int? AiLevel = null,
        int? Size = null,
        bool? Forbidden = null,
        int? MoveTimeoutSec = null,
        int? TotalTimeoutSec = null,
        List<SeatSpec>? Seats = null,
        string? Mode = null);   // 军旗：open=明棋（自摆阵）/ dark=暗棋（缺省，现状兼容）/ fanqi=翻棋（T04b）

    /// <summary>飞行棋座位规格：seat0 恒为房主（真人），其余每座 isAi 决定朋友/AI</summary>
    public record SeatSpec(bool IsAi = false);

    /// <summary>凭房间码加入</summary>
    public record JoinReq(string? Code);
    /// <summary>走子请求体：per-game 字段由引擎解析</summary>
    public record RematchReq(int? Side);
    /// <summary>单机记分请求体</summary>
    public record ScoreReq(int Score);

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/games").RequireAuthorization("perm:games.use");

        // ==================== 游戏列表（入口第一屏） ====================
        // 加第二种游戏只要在 GameCatalog.All 里登记一条，这里一个字都不用改。
        g.MapGet("", () => ApiKit.Ok(new
        {
            games = GameCatalog.All.Select(x => new
            {
                key = x.Key, name = x.Name, sub = x.Sub,
                minPlayers = x.MinPlayers, maxPlayers = x.MaxPlayers,
                available = x.Available, hasAi = x.HasAi, solo = x.Solo,
                maxScore = x.MaxScore,
            }).ToList(),
        }));

        // ==================== 游戏总设置（显示偏好） ====================
        // 只管「我这台设备怎么显示」：落子确认 / 坐标 / 最后一手标记 / 震动。
        // 不进房间、不上服务端判定，所以改它不影响任何人，也不用快照。
        g.MapGet("/settings", (AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.FirstOrDefault(x => x.Id == uid);
            return ApiKit.Ok(GameSettingsCatalog.ToDisplay(GameSettingsCatalog.Load(user?.GameSettings)));
        });

        g.MapPut("/settings", (GameSettingsCatalog.DisplaySettings req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.FirstOrDefault(x => x.Id == uid)
                       ?? throw new ApiBadRequest("账号不存在");
            var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings), req);
            user.GameSettings = GameSettingsCatalog.Store(merged);
            db.SaveChanges();
            return ApiKit.Ok(GameSettingsCatalog.ToDisplay(merged));
        });

        // ==================== 单游戏杂项设置（规则默认） ====================
        // 这一组是「建房时用什么规则」的默认值：盘面大小 / 禁手 / 单步与总时限。
        // 只影响**自己新建**的房间（建房那一刻快照进 GameRoom），已开打的局不变。
        var gs = g.MapGroup("/{gameKey}");

        gs.MapGet("/settings", (string gameKey, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.FirstOrDefault(x => x.Id == uid);
            return ApiKit.Ok(new
            {
                rules = GameSettingsCatalog.ToRules(GameSettingsCatalog.Load(user?.GameSettings)),
                sizeOptions = GomokuRules.AllowedSizes,
                moveTimeoutOptions = GameSettingsCatalog.MoveTimeoutOptions,
                totalTimeoutOptions = GameSettingsCatalog.TotalTimeoutOptions,
            });
        });

        gs.MapPut("/settings", (string gameKey, GameSettingsCatalog.RuleDefaults req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.FirstOrDefault(x => x.Id == uid)
                       ?? throw new ApiBadRequest("账号不存在");
            var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings), req);
            user.GameSettings = GameSettingsCatalog.Store(merged);
            db.SaveChanges();
            return ApiKit.Ok(GameSettingsCatalog.ToRules(merged));
        });

        // ==================== 教程 ====================
        gs.MapGet("/tutorial", (string gameKey) =>
        {
            GameCatalog.Require(gameKey);
            var sections = GameTutorials.Get(gameKey)
                           ?? throw new ApiBadRequest("还没有这个游戏的教程");
            return ApiKit.Ok(sections.Select(s => new { title = s.Title, paras = s.Paras }).ToList());
        });

        // ==================== 单机记分 + 排行榜 ====================
        // 单机游戏不进 GameRooms：纯前端玩法 + 记分接口。防作弊三件套见 GameScores。
        gs.MapPost("/score", (string gameKey, ScoreReq req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            if (GameScores.RateLimited(uid)) throw new ApiBadRequest("提交太频繁，稍后再试");
            var (best, rank) = GameScores.Submit(db, uid, key, req.Score);
            return ApiKit.Ok(new { bestScore = best, rank });
        });

        gs.MapGet("/leaderboard", (string gameKey, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            return ApiKit.Ok(GameScores.Leaderboard(db, key, uid));
        });

        // ==================== 大厅（这一局游戏的房间列表） ====================
        gs.MapGet("/rooms", (string gameKey, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);

            // 顺手扫掉闲置 5 分钟的房间：大厅是废弃房间唯一会被看见的地方，
            // 在这儿清最省事，也不用挂后台 Timer。
            GameSweeper.Sweep(db);

            var cutoff = DateTime.UtcNow.AddHours(-24);      // 别人挂着的空房只留 24 小时
            var keepDone = DateTime.UtcNow.AddDays(-3);      // 我打完的局只留 3 天，免得大厅越攒越长

            var rooms = db.GameRooms
                .Include(x => x.Host).Include(x => x.Guest)
                .Where(x => x.GameKey == key
                            && (((x.HostUserId == uid || x.GuestUserId == uid) && x.Status != "finished")
                                || ((x.HostUserId == uid || x.GuestUserId == uid) && x.UpdatedAt > keepDone)
                                || (x.Status == "waiting" && x.GuestUserId == null && x.CreatedAt > cutoff)))
                .OrderByDescending(x => x.UpdatedAt)
                .Take(LobbyKeep)
                .ToList();

            // 飞行棋多座：seat2/3 用户靠 SeatsJson 内存过滤补进大厅（SQL 只兜 seat0/1）
            if (key == "ludo")
            {
                var extra = db.GameRooms
                    .Include(x => x.Host).Include(x => x.Guest)
                    .Where(x => x.GameKey == "ludo" && x.SeatsJson != null
                                && (x.Status != "finished" || x.UpdatedAt > keepDone)
                                && x.UpdatedAt > cutoff)
                    .OrderByDescending(x => x.UpdatedAt).Take(200).ToList()
                    .Where(x => LudoSeats.Get(x).Any(s2 => s2.Uid == uid) && rooms.All(r2 => r2.Id != x.Id))
                    .ToList();
                if (extra.Count > 0)
                {
                    rooms.AddRange(extra);
                    rooms = rooms.OrderByDescending(x => x.UpdatedAt).Take(LobbyKeep).ToList();
                }
            }

            var items = rooms.Select(r =>
            {
                var evs = GameEvents.Parse(r.MovesJson);
                var mySide = GameViews.MySide(r, uid);
                var oppSeen = r.HostUserId == uid ? r.GuestSeenAt : r.HostSeenAt;
                var isLudo = r.GameKey == "ludo";
                var seatList = isLudo ? LudoSeats.Get(r) : null;
                var isAi = isLudo
                    ? (seatList!.Any(s2 => s2.IsAi) && seatList!.All(s2 => s2.Uid is null || s2.Seat == 0))
                    : r.AiLevel > 0 && r.GuestUserId is null;
                return new
                {
                    id = r.Id,
                    code = r.Code,
                    status = r.Status,
                    hostId = r.HostUserId,
                    hostName = r.Host?.DisplayName ?? "",
                    guestId = r.GuestUserId ?? 0,
                    guestName = isAi ? "AI" : r.Guest?.DisplayName ?? "",
                    hostSide = r.HostSide,
                    size = r.Size,
                    forbidden = r.Forbidden,
                    seatCount = seatList?.Count ?? 0,
                    seatedCount = seatList?.Count(s2 => s2.Uid is not null || s2.IsAi) ?? 0,
                    moveCount = evs.Count(e => e.t == "move"),
                    winner = r.Winner,
                    mySide,
                    mine = mySide != 0,
                    myTurn = r.Status == "playing" && mySide != 0 && r.Turn == mySide,
                    opponentOnline = isAi || (oppSeen is not null && (DateTime.UtcNow - oppSeen.Value).TotalSeconds < 20),
                    updatedAt = ApiKit.StampUtc(r.UpdatedAt),
                };
            }).ToList();

            var mine = GameSettingsCatalog.Load(
                db.Users.FirstOrDefault(x => x.Id == uid)?.GameSettings);

            return ApiKit.Ok(new
            {
                items,
                game = new { key, },
                display = GameSettingsCatalog.ToDisplay(mine),
                rules = GameSettingsCatalog.ToRules(mine),
                sizeOptions = GomokuRules.AllowedSizes,
                moveTimeoutOptions = GameSettingsCatalog.MoveTimeoutOptions,
                totalTimeoutOptions = GameSettingsCatalog.TotalTimeoutOptions,
            });
        });

        // ==================== 建房 ====================
        gs.MapPost("/rooms", (string gameKey, CreateReq req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var side = req.Side == 2 ? 2 : 1;

            // 建新房前顺手清一次闲置房间，免得大厅被自己的旧房填满
            GameSweeper.Sweep(db);

            // 默认规则来自房主的设置，建房时可以用请求里的值覆盖这一局
            var user = db.Users.FirstOrDefault(x => x.Id == uid)
                       ?? throw new ApiBadRequest("账号不存在");
            var s = GameSettingsCatalog.Load(user.GameSettings);
            if (req.Size is int rs) s.Size = rs;
            if (req.Forbidden is bool rf) s.Forbidden = rf;
            if (req.MoveTimeoutSec is int rm) s.MoveTimeoutSec = rm;
            if (req.TotalTimeoutSec is int rt) s.TotalTimeoutSec = rt;
            s = GameSettingsCatalog.Normalize(s);

            // AI 局：立即 playing；限时照设（对 AI 豁免由 GameClock 的 GameAi.IsAiTurn 短路兜底）
            var isAi = string.Equals(req.Opponent, "ai", StringComparison.OrdinalIgnoreCase);
            var aiLevel = isAi ? Math.Clamp(req.AiLevel ?? 2, 1, 5) : 0;

            // 飞行棋多座（3~4 人）：req.Seats 显式给出每座规格；seat0 恒为房主
            var isLudoMulti = key == "ludo" && req.Seats is { Count: >= 3 and <= 4 };
            List<LudoSeat>? ludoSeats = null;
            if (isLudoMulti)
            {
                ludoSeats = new List<LudoSeat>();
                for (var i = 0; i < req.Seats!.Count; i++)
                {
                    var sd = i + 1;
                    if (i == 0)
                        ludoSeats.Add(new LudoSeat { Seat = 0, Side = 1, Color = LudoSeats.ColorOf(1), Uid = uid, Name = user.DisplayName, IsAi = false, Active = true });
                    else if (req.Seats[i].IsAi)
                        ludoSeats.Add(new LudoSeat { Seat = i, Side = sd, Color = LudoSeats.ColorOf(sd), Uid = null, Name = "AI", IsAi = true, Active = true });
                    else
                        ludoSeats.Add(new LudoSeat { Seat = i, Side = sd, Color = LudoSeats.ColorOf(sd), Uid = null, Name = "", IsAi = false, Active = true });
                }
            }
            // 是否还有空着的真人座（决定开局还是等）
            var hasEmptyHumanSeat = isLudoMulti && ludoSeats!.Any(x => x.Uid is null && !x.IsAi);
            var playNow = isLudoMulti ? !hasEmptyHumanSeat : isAi;
            // 军旗三模式：open=明棋（布阵状态机）/ dark=暗棋（随机秘密布阵，现状兼容）/ fanqi=翻棋（T04b）
            // mode 缺省 = dark（现状兼容）；建房 UI 默认明棋并显式带上 mode
            var armyMode = key == "armychess"
                ? (req.Mode?.Trim().ToLowerInvariant() switch
                {
                    "" or null => "dark",
                    "open" => "open",
                    "dark" => "dark",
                    "fanqi" => "fanqi",
                    _ => throw new ApiBadRequest("没有这种军旗模式"),
                })
                : null;
            var armyOpen = armyMode == "open";
            // 2 人飞行棋多座投影：GuestUserId = seat1 的 uid（AI 则 null）
            int? guestIdProjection = null;
            if (isLudoMulti)
            {
                var seat1 = ludoSeats!.FirstOrDefault(x => x.Seat == 1);
                guestIdProjection = seat1 is { IsAi: false } ? seat1.Uid : null;
            }

            // 一个人同时只留一个「等待中」的房间：否则大厅里会堆一屏自己的空房
            var stale = db.GameRooms
                .Where(x => x.HostUserId == uid && x.Status == "waiting" && x.GuestUserId == null)
                .ToList();
            if (stale.Count > 0) db.GameRooms.RemoveRange(stale);

            var room = new GameRoom
            {
                Code = NewCode(db),
                GameKey = key,
                HostUserId = uid,
                HostSide = isLudoMulti ? 1 : side,
                GuestUserId = isLudoMulti ? guestIdProjection : null,
                SeatsJson = isLudoMulti ? LudoSeats.Store(ludoSeats!) : null,
                Status = armyOpen ? "waiting" : (playNow ? "playing" : "waiting"),   // 军旗明棋统一由 EnterSetup 翻 setup（含 AI 即时布阵）
                // 翻棋开棋方系统随机（规则文档一、3：开棋方由系统随机选取）；其余 Turn=1
                Turn = armyMode == "fanqi" ? Random.Shared.Next(1, 3) : 1,
                AiLevel = (isLudoMulti && ludoSeats!.Any(x => x.IsAi)) ? 2 : aiLevel,
                Size = s.Size,
                Forbidden = s.Forbidden,
                MoveTimeoutSec = s.MoveTimeoutSec,
                TotalTimeoutSec = s.TotalTimeoutSec,
                TurnStartedAt = playNow ? DateTime.UtcNow : null,
                Mode = armyMode,
                HostSeenAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            db.GameRooms.Add(room);
            db.SaveChanges();

            // 初始化事件（黑白棋 setup / 飞行棋座位 setup）
            var engine = GameEngines.Get(key);
            var initEvs = engine.InitialEvents(room);
            if (initEvs.Count > 0)
            {
                room.MovesJson = GameEvents.Store(initEvs);
                db.SaveChanges();
            }

            // 军旗明棋 + AI 对手：进入布阵阶段并即时随机布 AI 那一侧
            if (armyOpen && playNow)
                ArmyChessSetup.EnterSetup(db, db.GameRooms.AsNoTracking().First(x => x.Id == room.Id));

            return ApiKit.Ok(new
            {
                id = room.Id,
                code = room.Code,
                hostSide = room.HostSide,
                size = room.Size,
                forbidden = room.Forbidden,
                moveTimeoutSec = room.MoveTimeoutSec,
                totalTimeoutSec = room.TotalTimeoutSec,
                isAi = isLudoMulti ? ludoSeats!.Any(x => x.IsAi) : isAi,
                aiLevel = room.AiLevel,
            });
        });

        // ==================== 凭码加入 ====================
        g.MapPost("/join", (JoinReq req, AppDbContext db, HttpContext ctx) =>
        {
            var uid = ApiKit.MeId(ctx);
            var code = (req.Code ?? "").Trim().ToUpperInvariant();
            if (code.Length == 0) throw new ApiBadRequest("请输入房间码");
            var room = db.GameRooms.FirstOrDefault(x => x.Code == code)
                       ?? throw new ApiBadRequest("没有这个房间，房间码可能输错了");
            Join_Internal(db, room, uid);
            return ApiKit.Ok(new { id = room.Id });
        });

        // ==================== 房间状态（轮询） ====================
        gs.MapGet("/rooms/{id:int}", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);

            // 超时懒结算 + AI 懒生成 + 黑白棋无着自动 pass + 军旗布阵超时（谁读谁触发）
            if (GameClock.Enforce(db, room)) room = Load(db, id, key);
            if (GameAi.EnsureMove(db, room)) room = Load(db, id, key);
            if (GameAi.EnsureAutoPass(db, room)) room = Load(db, id, key);
            if (ArmyChessSetup.Enforce(db, room)) room = Load(db, id, key);

            Touch(db, room, uid);
            return ApiKit.Ok(GameViews.Snap(room, uid));
        });

        // ==================== 加入 ====================
        gs.MapPost("/rooms/{id:int}/join", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            Join_Internal(db, room, uid);
            return ApiKit.Ok(new { id });
        });

        // ==================== deploy（军旗明棋布阵） ====================
        gs.MapPost("/rooms/{id:int}/deploy", (string gameKey, int id, JsonElement req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            ArmyChessSetup.Deploy(db, id, mySide, req);
            return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
        });

        // ==================== pass（黑白棋等） ====================
        gs.MapPost("/rooms/{id:int}/pass", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            if (room.Status != "playing") throw new ApiBadRequest("这一局现在不能 pass");
            if (room.Turn != mySide) throw new ApiBadRequest("还没轮到你");
            // 翻棋没有 pass（规则：无合法着法即判负，不许跳过）
            if (room.GameKey == "armychess" && string.Equals(room.Mode, "fanqi", StringComparison.OrdinalIgnoreCase))
                throw new ApiBadRequest("翻棋不能 pass");

            // 有合法着时不许 pass
            var engine = GameEngines.Get(key);
            var evs = GameEvents.Parse(room.MovesJson);
            var state = engine.BuildState(evs, room, mySide, false);
            // 简单检查：如果引擎说有合法着就拒绝 pass（黑白棋）
            if (key == "reversi")
            {
                var board = ReversiRules.Replay(evs);
                if (ReversiRules.HasLegalMove(board, mySide))
                    throw new ApiBadRequest("还有合法着，不能 pass");
            }

            evs.Add(new GameEvent { t = "pass", s = mySide });
            var (winner, reason, over) = engine.Judge(evs, room);
            var rev = room.Revision;
            var now = DateTime.UtcNow;
            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, GameEvents.Store(evs))
                    .SetProperty(x => x.Turn, over ? room.Turn : engine.NextTurn(mySide, room))
                    .SetProperty(x => x.Status, over ? "finished" : "playing")
                    .SetProperty(x => x.Winner, winner)
                    .SetProperty(x => x.ResultReason, reason)
                    .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));
            if (rows == 0) throw new ApiBadRequest("状态刚变过");
            db.ChangeTracker.Clear();
            return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
        });

        // ==================== 骰子（飞行棋等） ====================
        gs.MapPost("/rooms/{id:int}/roll", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            if (room.Status != "playing") throw new ApiBadRequest("这一局现在不能掷骰子");
            if (room.Turn != mySide) throw new ApiBadRequest("还没轮到你");

            var engine = GameEngines.Get(key);
            var evs = GameEvents.Parse(room.MovesJson);
            var rollEvent = engine.ValidateRoll(evs, room, mySide)
                           ?? throw new ApiBadRequest("这个游戏不需要骰子");

            var newEvs = GameEvents.Append(evs, rollEvent);
            var rev = room.Revision;
            var now = DateTime.UtcNow;

            // 飞行棋三连六（F7）：连续第 3 个 6 → 罚第一手机回机场 + 换人（不享额外回合）
            if (key == "ludo")
            {
                var penalty = LudoRules.PendingPenalty(newEvs, mySide);
                if (penalty != null)
                {
                    newEvs.Add(penalty);
                    var (wP, rP, oP) = engine.Judge(newEvs, room);
                    var rowsP = db.GameRooms
                        .Where(x => x.Id == id && x.Revision == rev)
                        .ExecuteUpdate(s => s
                            .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                            .SetProperty(x => x.Turn, oP ? room.Turn : engine.NextTurn(mySide, room))
                            .SetProperty(x => x.Status, oP ? "finished" : "playing")
                            .SetProperty(x => x.Winner, wP)
                            .SetProperty(x => x.ResultReason, rP)
                            .SetProperty(x => x.TurnStartedAt, oP ? room.TurnStartedAt : (DateTime?)now)
                            .SetProperty(x => x.Revision, rev + 1)
                            .SetProperty(x => x.UpdatedAt, now)
                            .SetProperty(x => x.FinishedAt, oP ? now : room.FinishedAt));
                    if (rowsP == 0) throw new ApiBadRequest("状态刚变过");
                    db.ChangeTracker.Clear();
                    return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
                }
            }

            // 飞行棋：roll 后若无合法着，自动换手（保留骰点，不许重掷）
            if (key == "ludo" && rollEvent.v is int rv && !LudoRules.HasAnyValidMove(newEvs, mySide, rv))
            {
                newEvs.Add(new GameEvent { t = "pass", s = mySide });
                var (w2, r2, o2) = engine.Judge(newEvs, room);
                // 掷 6 但无合法着 → 自动 pass 直接换手（不享额外回合：本手没走成，避免同座反复空掷；
                // 「掷 6 额外回合」只在实际走子后生效，见 move 路径 GrantsExtraTurn）
                var rows2 = db.GameRooms
                    .Where(x => x.Id == id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                        .SetProperty(x => x.Turn, o2 ? room.Turn : engine.NextTurn(mySide, room))
                        .SetProperty(x => x.Status, o2 ? "finished" : "playing")
                        .SetProperty(x => x.Winner, w2)
                        .SetProperty(x => x.ResultReason, r2)
                        .SetProperty(x => x.TurnStartedAt, o2 ? room.TurnStartedAt : (DateTime?)now)
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now)
                        .SetProperty(x => x.FinishedAt, o2 ? now : room.FinishedAt));
                if (rows2 == 0) throw new ApiBadRequest("状态刚变过");
                db.ChangeTracker.Clear();
                return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
            }

            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now));
            if (rows == 0) throw new ApiBadRequest("状态刚变过，刷新一下");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
        });

        // ==================== 落子（事件体，per-game 字段由引擎解析） ====================
        gs.MapPost("/rooms/{id:int}/move", (string gameKey, int id, JsonElement req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            if (room.Status == "waiting") throw new ApiBadRequest(
                key == "ludo" && LudoSeats.Count(room) > 2 ? "还有座位没人，等一下" : "对手还没进来，等一下");
            if (room.Status == "finished") throw new ApiBadRequest("这一局已经结束了");

            if (GameClock.Enforce(db, room)) throw new ApiBadRequest("这一局已经超时结束了");

            if (room.Turn != mySide) throw new ApiBadRequest("还没轮到你");

            var engine = GameEngines.Get(key);
            var evs = GameEvents.Parse(room.MovesJson);
            var newEvent = engine.ValidateMove(evs, room, mySide, req);
            var newEvs = GameEvents.Append(evs, newEvent);
            var (winner, reason, over) = engine.Judge(newEvs, room);

            var rev = room.Revision;
            var now = DateTime.UtcNow;

            // 结算这一手用掉的时间（只算该走的一方，对手的时间不动）
            var elapsedMs = room.TurnStartedAt is null
                ? 0L
                : (long)Math.Max(0, (now - room.TurnStartedAt.Value).TotalMilliseconds);
            var hostUsed = room.HostUsedMs + (mySide == 1 ? elapsedMs : 0);
            var guestUsed = room.GuestUsedMs + (mySide == 2 ? elapsedMs : 0);

            // 掷 6 额外回合（不换座；三连六已在 roll 路由罚换人，封顶逻辑已删——设计 §3.2 F7）
            var keepTurn = key == "ludo" && LudoRules.GrantsExtraTurn(newEvs, mySide);
            var nextTurn = over ? room.Turn : (keepTurn ? mySide : engine.NextTurn(mySide, room));

            // 飞行棋多座：更新该座 usedMs + seenAt，落 SeatsJson（2 人房 SeatsJson==null 不写，保持零漂移）
            string? newSeatsJson = room.SeatsJson;
            if (key == "ludo" && room.SeatsJson != null)
            {
                var seats = LudoSeats.Get(room);
                var seat = seats.FirstOrDefault(s => s.Side == mySide);
                if (seat is not null)
                {
                    seat.UsedMs += elapsedMs;
                    seat.SeenAt = now;
                    newSeatsJson = LudoSeats.Store(seats);
                }
            }

            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, GameEvents.Store(newEvs))
                    .SetProperty(x => x.Turn, nextTurn)
                    .SetProperty(x => x.Status, over ? "finished" : "playing")
                    .SetProperty(x => x.Winner, winner)
                    .SetProperty(x => x.ResultReason, reason)
                    .SetProperty(x => x.HostUsedMs, hostUsed)
                    .SetProperty(x => x.GuestUsedMs, guestUsed)
                    .SetProperty(x => x.SeatsJson, newSeatsJson)
                    .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));

            if (rows == 0) throw new ApiBadRequest("对手刚走过一步，刷新一下再来");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
        });

        // ==================== 认输 ====================
        gs.MapPost("/rooms/{id:int}/resign", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            if (room.Status != "playing") throw new ApiBadRequest("这一局现在没法认输");

            var engine = GameEngines.Get(key);
            var rev = room.Revision;
            var now = DateTime.UtcNow;

            // 飞行棋多人（N>2）：认输 = 该座出局、其余继续；只剩 1 active 该座胜
            if (key == "ludo" && LudoSeats.Count(room) > 2)
            {
                var seats = LudoSeats.MarkInactive(room, mySide);
                var seatsJson = LudoSeats.Store(seats);
                var activeSides = seats.Where(s => s.Active).Select(s => s.Side).ToList();
                var over = activeSides.Count <= 1;
                var soleActive = over ? (activeSides.Count == 1 ? activeSides[0] : 0) : 0;
                var nextTurn = over ? room.Turn : LudoSeats.NextActive(room, mySide);
                var rowsM = db.GameRooms
                    .Where(x => x.Id == id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.SeatsJson, seatsJson)
                        .SetProperty(x => x.Status, over ? "finished" : "playing")
                        .SetProperty(x => x.Winner, soleActive)
                        .SetProperty(x => x.ResultReason, over ? "resign" : "")
                        .SetProperty(x => x.Turn, nextTurn)
                        .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now)
                        .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));
                if (rowsM == 0) throw new ApiBadRequest("状态刚变过，刷新一下");
                db.ChangeTracker.Clear();
                return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
            }

            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.Status, "finished")
                    .SetProperty(x => x.Winner, engine.NextTurn(mySide, room))
                    .SetProperty(x => x.ResultReason, "resign")
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, now));
            if (rows == 0) throw new ApiBadRequest("状态刚变过，刷新一下");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
        });

        // ==================== 再来一局 ====================
        gs.MapPost("/rooms/{id:int}/rematch", (string gameKey, int id, RematchReq req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");

            var engine = GameEngines.Get(key);
            // 默认交换先手（输的先走更公平）；也可以指定「我继续执黑/执白」
            var newHostSide = req.Side is 1 or 2
                ? (room.HostUserId == uid ? req.Side.Value : engine.Other(req.Side.Value))
                : engine.Other(room.HostSide);

            var rev = room.Revision;
            var now = DateTime.UtcNow;
            var playing = room.GuestUserId is not null || room.AiLevel > 0;

            // 飞行棋多座：重置座位（全员 active、清零 usedMs），保留座位构成
            var isLudoMulti = key == "ludo" && room.SeatsJson != null;
            string? newSeatsJson = room.SeatsJson;
            if (isLudoMulti)
            {
                newHostSide = 1;
                var seats = LudoSeats.Get(room);
                foreach (var st in seats) { st.Active = true; st.UsedMs = 0; }
                newSeatsJson = LudoSeats.Store(seats);
                playing = !seats.Any(x => x.Seat > 0 && x.Uid is null && !x.IsAi);
            }

            // 重置事件（黑白棋要重新 setup）
            var initEvs = engine.InitialEvents(room);
            var initJson = GameEvents.Store(initEvs);

            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, initJson)
                    .SetProperty(x => x.Turn, 1)
                    .SetProperty(x => x.Status, playing ? "playing" : "waiting")
                    .SetProperty(x => x.Winner, 0)
                    .SetProperty(x => x.ResultReason, "")
                    .SetProperty(x => x.HostSide, newHostSide)
                    .SetProperty(x => x.SeatsJson, newSeatsJson)
                    .SetProperty(x => x.HostUsedMs, 0L)
                    .SetProperty(x => x.GuestUsedMs, 0L)
                    .SetProperty(x => x.TurnStartedAt, playing ? (DateTime?)now : null)
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, (DateTime?)null));
            if (rows == 0) throw new ApiBadRequest("状态刚变过，刷新一下");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(GameViews.Snap(Load(db, id, key), uid));
        });

        // ==================== 退出 ====================
        gs.MapPost("/rooms/{id:int}/leave", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = GameViews.MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");

            var engine = GameEngines.Get(key);
            // 等待中的房主退出 = 房间作废；对局中退出 = 认输；终局后房主退出 = 收拾掉这盘
            if (room.Status == "waiting" && room.HostUserId == uid)
            {
                db.GameRooms.Remove(room);
                db.SaveChanges();
                return ApiKit.Ok(new { removed = true });
            }
            if (room.Status == "playing")
            {
                var rev = room.Revision;
                var now = DateTime.UtcNow;

                // 飞行棋多人（N>2）：退出 = 该座出局、其余继续
                if (key == "ludo" && LudoSeats.Count(room) > 2)
                {
                    var seats = LudoSeats.MarkInactive(room, mySide);
                    var seatsJson = LudoSeats.Store(seats);
                    var activeSides = seats.Where(s => s.Active).Select(s => s.Side).ToList();
                    var over = activeSides.Count <= 1;
                    var soleActive = over ? (activeSides.Count == 1 ? activeSides[0] : 0) : 0;
                    var nextTurn = over ? room.Turn : LudoSeats.NextActive(room, mySide);
                    db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                        .ExecuteUpdate(s => s
                            .SetProperty(x => x.SeatsJson, seatsJson)
                            .SetProperty(x => x.Status, over ? "finished" : "playing")
                            .SetProperty(x => x.Winner, soleActive)
                            .SetProperty(x => x.ResultReason, over ? "resign" : "")
                            .SetProperty(x => x.Turn, nextTurn)
                            .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                            .SetProperty(x => x.Revision, rev + 1)
                            .SetProperty(x => x.UpdatedAt, now)
                            .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));
                    return ApiKit.Ok(new { resigned = true });
                }

                db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.Status, "finished")
                        .SetProperty(x => x.Winner, engine.NextTurn(mySide, room))
                        .SetProperty(x => x.ResultReason, "resign")
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now)
                        .SetProperty(x => x.FinishedAt, now));
                return ApiKit.Ok(new { resigned = true });
            }
            if (room.Status == "finished" && room.HostUserId == uid)
            {
                db.GameRooms.Remove(room);
                db.SaveChanges();
                return ApiKit.Ok(new { removed = true });
            }

            // 飞行棋多座：等待中非房主退出 → 释放该座（uid=null），房间继续等待，别人可加入
            if (key == "ludo" && room.SeatsJson != null && room.Status == "waiting" && mySide != 0 && room.HostUserId != uid)
            {
                var seats = LudoSeats.Get(room);
                var seat = seats.FirstOrDefault(s => s.Side == mySide);
                if (seat is not null && !seat.IsAi)
                {
                    seat.Uid = null;
                    seat.Name = "";
                    seat.SeenAt = null;
                    var rev = room.Revision;
                    var now = DateTime.UtcNow;
                    var seat1 = seats.FirstOrDefault(s => s.Seat == 1);
                    var guestId = seat1 is { IsAi: false } ? seat1.Uid : null;
                    db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                        .ExecuteUpdate(s => s
                            .SetProperty(x => x.SeatsJson, LudoSeats.Store(seats))
                            .SetProperty(x => x.GuestUserId, guestId)
                            .SetProperty(x => x.Revision, rev + 1)
                            .SetProperty(x => x.UpdatedAt, now));
                }
                return ApiKit.Ok(new { removed = false });
            }

            return ApiKit.Ok(new { removed = false });
        });
    }

    // ==================== 内部工具 ====================

    /// <summary>取房间；给了 gameKey 就顺带验一下归属</summary>
    private static GameRoom Load(AppDbContext db, int id, string? gameKey = null)
    {
        var room = db.GameRooms.Include(x => x.Host).Include(x => x.Guest).FirstOrDefault(x => x.Id == id)
                   ?? throw new ApiBadRequest("这一局不存在或已被解散");
        if (gameKey is not null
            && !string.Equals(room.GameKey, gameKey, StringComparison.OrdinalIgnoreCase))
            throw new ApiBadRequest("房间不属于这个游戏");
        return room;
    }

    /// <summary>
    /// 刷新「我还在看这盘」的时间戳。故意 5 秒才写一次 ——
    /// 轮询是 1.2 秒一次，每次都写库会让 SQLite 的写锁一直热着，
    /// 真落子时反而更容易撞「database is locked」。
    /// 不改 Revision：在线状态变化不该让对手的棋盘也重绘。
    /// </summary>
    private static void Touch(AppDbContext db, GameRoom room, int uid)
    {
        var now = DateTime.UtcNow;

        // 飞行棋多座：全座位按 uid 刷 seenAt（seat2/3 也能保活，players[].online 才准）
        if (room.GameKey == "ludo" && room.SeatsJson != null)
        {
            var seats = LudoSeats.Get(room);
            var seat = seats.FirstOrDefault(s => s.Uid == uid);
            if (seat is null) return;
            if (seat.SeenAt is not null && (now - seat.SeenAt.Value).TotalSeconds < 5) return;
            seat.SeenAt = now;
            var rev = room.Revision;
            db.GameRooms.Where(x => x.Id == room.Id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.SeatsJson, LudoSeats.Store(seats))
                    .SetProperty(x => x.UpdatedAt, now));
            db.ChangeTracker.Clear();
            return;
        }

        var isHost = room.HostUserId == uid;
        if (!isHost && room.GuestUserId != uid) return;

        var last = isHost ? room.HostSeenAt : room.GuestSeenAt;
        if (last is not null && (now - last.Value).TotalSeconds < 5) return;

        if (isHost) room.HostSeenAt = now; else room.GuestSeenAt = now;
        db.SaveChanges();
    }

    private static void Join_Internal(AppDbContext db, GameRoom room, int uid)
    {
        var mySide = GameViews.MySide(room, uid);
        if (mySide != 0) return;                                  // 已经在局中，幂等

        // 飞行棋多座：填下一个空真人座（SeatsJson 非空即多人房）
        if (room.GameKey == "ludo" && room.SeatsJson != null)
        {
            var seats = LudoSeats.Get(room);
            var empty = seats.FirstOrDefault(s => s.Uid is null && !s.IsAi && s.Active);
            if (empty is null) throw new ApiBadRequest("这一局没有空位了");

            var now0 = DateTime.UtcNow;
            empty.Uid = uid;
            empty.Name = db.Users.FirstOrDefault(x => x.Id == uid)?.DisplayName ?? "";
            empty.SeenAt = now0;
            var seatsJson = LudoSeats.Store(seats);
            var stillEmpty = seats.Any(s => s.Uid is null && !s.IsAi && s.Active);
            var seat1 = seats.FirstOrDefault(s => s.Seat == 1);
            var guestId = seat1 is { IsAi: false } ? seat1.Uid : null;
            var rev0 = room.Revision;

            var rows0 = db.GameRooms
                .Where(x => x.Id == room.Id && x.Revision == rev0)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.SeatsJson, seatsJson)
                    .SetProperty(x => x.GuestUserId, guestId)
                    .SetProperty(x => x.Status, stillEmpty ? "waiting" : "playing")
                    .SetProperty(x => x.TurnStartedAt, stillEmpty ? room.TurnStartedAt : (DateTime?)now0)
                    .SetProperty(x => x.Revision, rev0 + 1)
                    .SetProperty(x => x.UpdatedAt, now0));
            if (rows0 == 0) throw new ApiBadRequest("慢了一步，这盘刚被别人进去了");
            return;
        }

        if (room.Status != "waiting" || room.GuestUserId is not null)
            throw new ApiBadRequest("这一局已经有人了，让房主再开一盘");

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var armyOpenSetup = room.GameKey == "armychess" && room.Mode == "open";   // 明棋：加入 → 布阵阶段
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev && x.GuestUserId == null)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.GuestUserId, uid)
                .SetProperty(x => x.Status, armyOpenSetup ? "setup" : "playing")
                .SetProperty(x => x.TurnStartedAt, (DateTime?)now)   // 开局/布阵都从这一刻起表
                .SetProperty(x => x.GuestSeenAt, now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now));
        if (rows == 0) throw new ApiBadRequest("慢了一步，这盘刚被别人进去了");
    }

    /// <summary>6 位房间码：去掉了 0/O/1/I 这些口头报码时容易听错/看错的字符</summary>
    private static string NewCode(AppDbContext db)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var rnd = Random.Shared;
        for (var attempt = 0; attempt < 12; attempt++)
        {
            var code = new char[6];
            for (var i = 0; i < code.Length; i++) code[i] = alphabet[rnd.Next(alphabet.Length)];
            var s = new string(code);
            if (!db.GameRooms.Any(x => x.Code == s)) return s;
        }
        // 概率上几乎不可能走到这儿（32^6 ≈ 10 亿）；真撞满就退化成时间戳尾号
        return $"G{DateTime.UtcNow:HHmmss}";
    }
}
