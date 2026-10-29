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
    /// 后面四个是「这一局」的覆盖值，不传就用房主的默认设置。
    /// </summary>
    public record CreateReq(
        int Side = 1,
        int? Size = null,
        bool? Forbidden = null,
        int? MoveTimeoutSec = null,
        int? TotalTimeoutSec = null);

    /// <summary>凭房间码加入</summary>
    public record JoinReq(string? Code);
    public record MoveReq(int X, int Y);
    /// <summary>再来一局：side 空 = 交换先手（默认）</summary>
    public record RematchReq(int? Side);

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
                minPlayers = x.MinPlayers, maxPlayers = x.MaxPlayers, available = x.Available,
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
            if (key != GameKey) throw new ApiBadRequest("这个游戏还没开放设置");
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
            if (key != GameKey) throw new ApiBadRequest("这个游戏还没开放设置");
            var uid = ApiKit.MeId(ctx);
            var user = db.Users.FirstOrDefault(x => x.Id == uid)
                       ?? throw new ApiBadRequest("账号不存在");
            var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings), req);
            user.GameSettings = GameSettingsCatalog.Store(merged);
            db.SaveChanges();
            return ApiKit.Ok(GameSettingsCatalog.ToRules(merged));
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

            var items = rooms.Select(r =>
            {
                var moves = GomokuRules.Parse(r.MovesJson);
                var mySide = MySide(r, uid);
                var oppSeen = r.HostUserId == uid ? r.GuestSeenAt : r.HostSeenAt;
                return new
                {
                    id = r.Id,
                    code = r.Code,
                    status = r.Status,
                    hostId = r.HostUserId,
                    hostName = r.Host?.DisplayName ?? "",
                    guestId = r.GuestUserId ?? 0,
                    guestName = r.Guest?.DisplayName ?? "",
                    hostSide = r.HostSide,
                    size = r.Size,
                    forbidden = r.Forbidden,
                    moveCount = moves.Count,
                    winner = r.Winner,
                    mySide,
                    mine = mySide != 0,
                    myTurn = r.Status == "playing" && mySide != 0 && r.Turn == mySide,
                    opponentOnline = oppSeen is not null
                                     && (DateTime.UtcNow - oppSeen.Value).TotalSeconds < 20,
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
            if (key != GameKey) throw new ApiBadRequest("这个游戏还没开放建房");
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
                HostSide = side,
                Status = "waiting",
                Turn = 1,
                Size = s.Size,
                Forbidden = s.Forbidden,
                MoveTimeoutSec = s.MoveTimeoutSec,
                TotalTimeoutSec = s.TotalTimeoutSec,
                HostSeenAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            db.GameRooms.Add(room);
            db.SaveChanges();
            return ApiKit.Ok(new
            {
                id = room.Id,
                code = room.Code,
                hostSide = room.HostSide,
                size = room.Size,
                forbidden = room.Forbidden,
                moveTimeoutSec = room.MoveTimeoutSec,
                totalTimeoutSec = room.TotalTimeoutSec,
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

            // 超时不靠后台任务：谁来看这一局，就顺手判一次。两边都在 1.2 秒轮询，
            // 所以「超时」最多迟一拍被发现，够用且不用维护定时器。
            if (GameClock.Enforce(db, room)) room = Load(db, id, key);

            Touch(db, room, uid);
            return ApiKit.Ok(Snap(room, uid));
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

        // ==================== 落子 ====================
        gs.MapPost("/rooms/{id:int}/move", (string gameKey, int id, MoveReq req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            if (room.Status == "waiting") throw new ApiBadRequest("对手还没进来，等一下");
            if (room.Status == "finished") throw new ApiBadRequest("这一局已经结束了");

            if (GameClock.Enforce(db, room)) throw new ApiBadRequest("这一局已经超时结束了");

            var size = room.Size;
            var moves = GomokuRules.Parse(room.MovesJson);
            if (!GomokuRules.InBoard(req.X, req.Y, size)) throw new ApiBadRequest("落子位置不合法");
            if (GomokuRules.Occupied(moves, req.X, req.Y)) throw new ApiBadRequest("这个位置已经有子了");
            if (room.Turn != mySide) throw new ApiBadRequest("还没轮到你");

            var rev = room.Revision;
            var now = DateTime.UtcNow;

            // 结算这一手用掉的时间（只算该走的一方，对手的时间不动）
            var elapsedMs = room.TurnStartedAt is null
                ? 0L
                : (long)Math.Max(0, (now - room.TurnStartedAt.Value).TotalMilliseconds);
            var hostUsed = room.HostUsedMs + (mySide == 1 ? elapsedMs : 0);
            var guestUsed = room.GuestUsedMs + (mySide == 2 ? elapsedMs : 0);

            moves.Add(new GomokuRules.Stone(req.X, req.Y, mySide));

            // 标准规则下黑方长连（6 连以上）判负；自由规则下长连算赢
            var overline = room.Forbidden
                           && mySide == 1
                           && GomokuRules.IsOverline(moves, req.X, req.Y, mySide, size);
            var win = !overline && GomokuRules.IsWin(moves, req.X, req.Y, mySide, size);
            var draw = !overline && !win && GomokuRules.IsDraw(moves, size);
            var over = overline || win || draw;

            var winner = overline ? 2 : win ? mySide : draw ? 3 : 0;
            var reason = overline ? "overline" : win ? "five" : draw ? "draw" : "";
            var nextTurn = over ? room.Turn : GomokuRules.Other(mySide);

            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, GomokuRules.Store(moves))
                    .SetProperty(x => x.Turn, nextTurn)
                    .SetProperty(x => x.Status, over ? "finished" : "playing")
                    .SetProperty(x => x.Winner, winner)
                    .SetProperty(x => x.ResultReason, reason)
                    .SetProperty(x => x.HostUsedMs, hostUsed)
                    .SetProperty(x => x.GuestUsedMs, guestUsed)
                    .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));

            if (rows == 0) throw new ApiBadRequest("对手刚走过一步，刷新一下再来");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(Snap(Load(db, id, key), uid));
        });

        // ==================== 认输 ====================
        gs.MapPost("/rooms/{id:int}/resign", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");
            if (room.Status != "playing") throw new ApiBadRequest("这一局现在没法认输");

            var rev = room.Revision;
            var now = DateTime.UtcNow;
            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.Status, "finished")
                    .SetProperty(x => x.Winner, GomokuRules.Other(mySide))
                    .SetProperty(x => x.ResultReason, "resign")
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, now));
            if (rows == 0) throw new ApiBadRequest("状态刚变过，刷新一下");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(Snap(Load(db, id, key), uid));
        });

        // ==================== 再来一局 ====================
        gs.MapPost("/rooms/{id:int}/rematch", (string gameKey, int id, RematchReq req, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");

            // 默认交换先手（输的先走更公平）；也可以指定「我继续执黑/执白」
            var newHostSide = req.Side is 1 or 2
                ? (room.HostUserId == uid ? req.Side.Value : GomokuRules.Other(req.Side.Value))
                : GomokuRules.Other(room.HostSide);

            var rev = room.Revision;
            var now = DateTime.UtcNow;
            var playing = room.GuestUserId is not null;
            var rows = db.GameRooms
                .Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.MovesJson, "")
                    .SetProperty(x => x.Turn, 1)
                    .SetProperty(x => x.Status, playing ? "playing" : "waiting")
                    .SetProperty(x => x.Winner, 0)
                    .SetProperty(x => x.ResultReason, "")
                    .SetProperty(x => x.HostSide, newHostSide)
                    // 计时归零重开；规则（盘面/禁手/限时）沿用这一局建房时定下的
                    .SetProperty(x => x.HostUsedMs, 0L)
                    .SetProperty(x => x.GuestUsedMs, 0L)
                    .SetProperty(x => x.TurnStartedAt, playing ? (DateTime?)now : null)
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, (DateTime?)null));
            if (rows == 0) throw new ApiBadRequest("状态刚变过，刷新一下");

            db.ChangeTracker.Clear();
            return ApiKit.Ok(Snap(Load(db, id, key), uid));
        });

        // ==================== 退出 ====================
        gs.MapPost("/rooms/{id:int}/leave", (string gameKey, int id, AppDbContext db, HttpContext ctx) =>
        {
            var key = GameCatalog.Require(gameKey);
            var uid = ApiKit.MeId(ctx);
            var room = Load(db, id, key);
            var mySide = MySide(room, uid);
            if (mySide == 0) throw new ApiBadRequest("你不在这一局里");

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
                db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.Status, "finished")
                        .SetProperty(x => x.Winner, GomokuRules.Other(mySide))
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
            return ApiKit.Ok(new { removed = false });
        });
    }

    // ==================== 内部工具 ====================

    /// <summary>取房间；给了 gameKey 就顺带验一下归属（别让五子棋的房间被别的入口操作）</summary>
    private static GameRoom Load(AppDbContext db, int id, string? gameKey = null)
    {
        var room = db.GameRooms.Include(x => x.Host).Include(x => x.Guest).FirstOrDefault(x => x.Id == id)
                   ?? throw new ApiBadRequest("这一局不存在或已被解散");
        if (gameKey is not null
            && !string.Equals(room.GameKey, gameKey, StringComparison.OrdinalIgnoreCase))
            throw new ApiBadRequest("房间不属于这个游戏");
        return room;
    }

    /// <summary>我在这一局执哪一方（1 黑 / 2 白），不在局中返回 0</summary>
    private static int MySide(GameRoom r, int uid) =>
        r.HostUserId == uid ? r.HostSide
        : r.GuestUserId == uid ? GomokuRules.Other(r.HostSide)
        : 0;

    /// <summary>
    /// 刷新「我还在看这盘」的时间戳。故意 5 秒才写一次 ——
    /// 轮询是 1.2 秒一次，每次都写库会让 SQLite 的写锁一直热着，
    /// 真落子时反而更容易撞「database is locked」。
    /// 不改 Revision：在线状态变化不该让对手的棋盘也重绘。
    /// </summary>
    private static void Touch(AppDbContext db, GameRoom room, int uid)
    {
        var now = DateTime.UtcNow;
        var isHost = room.HostUserId == uid;
        if (!isHost && room.GuestUserId != uid) return;

        var last = isHost ? room.HostSeenAt : room.GuestSeenAt;
        if (last is not null && (now - last.Value).TotalSeconds < 5) return;

        if (isHost) room.HostSeenAt = now; else room.GuestSeenAt = now;
        db.SaveChanges();
    }

    private static void Join_Internal(AppDbContext db, GameRoom room, int uid)
    {
        var mySide = MySide(room, uid);
        if (mySide != 0) return;                                  // 已经在局中，幂等
        if (room.Status != "waiting" || room.GuestUserId is not null)
            throw new ApiBadRequest("这一局已经有人了，让房主再开一盘");

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = db.GameRooms
            .Where(x => x.Id == room.Id && x.Revision == rev && x.GuestUserId == null)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.GuestUserId, uid)
                .SetProperty(x => x.Status, "playing")
                .SetProperty(x => x.TurnStartedAt, (DateTime?)now)   // 从坐下的这一刻开始计时
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

    /// <summary>一局的全量状态 —— 两端都拿这一份渲染，避免各算各的口径</summary>
    private static object Snap(GameRoom r, int uid)
    {
        var moves = GomokuRules.Parse(r.MovesJson);
        var mySide = MySide(r, uid);
        var iAmHost = r.HostUserId == uid;
        var oppSeen = iAmHost ? r.GuestSeenAt : r.HostSeenAt;
        var oppName = iAmHost ? r.Guest?.DisplayName ?? "" : r.Host?.DisplayName ?? "";
        var myName = iAmHost ? r.Host?.DisplayName ?? "" : r.Guest?.DisplayName ?? "";

        var now = DateTime.UtcNow;

        return new
        {
            id = r.Id,
            code = r.Code,
            gameKey = r.GameKey,
            status = r.Status,
            hostSide = r.HostSide,
            hostId = r.HostUserId,
            hostName = r.Host?.DisplayName ?? "",
            guestId = r.GuestUserId ?? 0,
            guestName = r.Guest?.DisplayName ?? "",
            turn = r.Turn,
            winner = r.Winner,
            resultReason = r.ResultReason,
            revision = r.Revision,
            // 规则（建房时定下的，双方一致）
            size = r.Size,
            forbidden = r.Forbidden,
            moveTimeoutSec = r.MoveTimeoutSec,
            totalTimeoutSec = r.TotalTimeoutSec,
            // 计时（毫秒；null = 这一项不限）
            moveRemainMs = GameClock.MoveRemainMs(r, now),
            myRemainMs = GameClock.RemainMs(r, mySide, now),
            oppRemainMs = GameClock.RemainMs(r, mySide == 0 ? 0 : GomokuRules.Other(mySide), now),
            hostUsedMs = r.HostUsedMs,
            guestUsedMs = r.GuestUsedMs,
            moves = moves.Select(m => new { x = m.x, y = m.y, s = m.s }).ToList(),
            moveCount = moves.Count,
            lastMove = moves.Count == 0 ? null : new { x = moves[^1].x, y = moves[^1].y, s = moves[^1].s },
            mySide,
            myName,
            opponentName = oppName,
            opponentOnline = oppSeen is not null && (DateTime.UtcNow - oppSeen.Value).TotalSeconds < 20,
            myTurn = r.Status == "playing" && mySide != 0 && r.Turn == mySide,
            canJoin = r.Status == "waiting" && mySide == 0 && r.GuestUserId is null,
            createdAt = ApiKit.StampUtc(r.CreatedAt),
            updatedAt = ApiKit.StampUtc(r.UpdatedAt),
        };
    }
}
