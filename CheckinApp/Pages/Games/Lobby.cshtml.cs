using CheckinApp.Api;
using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Games;

/// <summary>大厅房间行（模板页渲染用）</summary>
public record LobbyRoomRow(int Id, string Code, string HostName, string Status, string StatusText);

/// <summary>
/// 通用游戏大厅 —— 按 {gameKey} 路由分发，替代各游戏独立大厅页。
/// URL 形如 /Games/Gomoku、/Games/Reversi（与旧 URL 完全一致）。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class LobbyModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public string GameKey { get; private set; } = "";
    public string GameName { get; private set; } = "";
    public GameCatalog.GameInfo? Game { get; private set; }
    public List<LobbyRoomRow> MyRooms { get; private set; } = [];
    public List<LobbyRoomRow> OpenRooms { get; private set; } = [];

    public IActionResult OnGet(string gameKey)
    {
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        Game = GameCatalog.Find(key);
        GameName = Game?.Name ?? key;

        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        GameSweeper.Sweep(_db);
        var cutoff = DateTime.UtcNow.AddHours(-24);
        var keepDone = DateTime.UtcNow.AddDays(-3);

        var rooms = _db.GameRooms
            .Include(x => x.Host).Include(x => x.Guest)
            .Where(x => x.GameKey == key
                        && (((x.HostUserId == uid || x.GuestUserId == uid) && x.Status != "finished")
                            || ((x.HostUserId == uid || x.GuestUserId == uid) && x.UpdatedAt > keepDone)
                            || (x.Status == "waiting" && x.GuestUserId == null && x.CreatedAt > cutoff)))
            .OrderByDescending(x => x.UpdatedAt)
            .Take(GamesApi.LobbyKeep)
            .ToList();

        foreach (var r in rooms)
        {
            var mySide = GameViews.MySide(r, uid);
            var isAi = r.AiLevel > 0 && r.GuestUserId is null;
            var row = new LobbyRoomRow(
                r.Id, r.Code,
                r.Host?.DisplayName ?? "",
                r.Status,
                r.Status switch
                {
                    "waiting" => mySide != 0 ? "等人进来" : "可加入",
                    "finished" => r.Winner switch { 3 => "和棋", 0 => "已结束", _ => mySide != 0 && r.Winner == mySide ? "你赢了" : "你输了" },
                    _ => r.Turn == mySide ? "轮到你" : "等对手",
                });
            if (mySide != 0) MyRooms.Add(row);
            else OpenRooms.Add(row);
        }
        return Page();
    }

    public IActionResult OnPostCreate(string gameKey, int side = 1, string? mode = null)
    {
        return CreateRoom(gameKey, side, 0, mode);
    }

    public IActionResult OnPostCreateAi(string gameKey, string? mode = null)
    {
        return CreateRoom(gameKey, 1, 2, mode);
    }

    /// <summary>飞行棋多座建房（2~4 人，每座朋友/AI）</summary>
    public IActionResult OnPostCreateLudo(string gameKey, int seatCount = 2, bool ai1 = false, bool ai2 = false, bool ai3 = false)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        if (key != "ludo") return CreateRoom(gameKey, 1, 0);

        seatCount = Math.Clamp(seatCount, 2, 4);
        // 2 人：走原 CreateRoom（AI 可选）
        if (seatCount == 2) return CreateRoom(gameKey, 1, ai1 ? 2 : 0);

        GameSweeper.Sweep(_db);
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");
        var s = GameSettingsCatalog.Load(user.GameSettings);

        var stale = _db.GameRooms
            .Where(x => x.HostUserId == uid && x.Status == "waiting" && x.GuestUserId == null)
            .ToList();
        if (stale.Count > 0) _db.GameRooms.RemoveRange(stale);

        var specs = new List<bool> { false };                 // seat0 = 房主
        specs.Add(ai1);
        if (seatCount >= 3) specs.Add(ai2);
        if (seatCount >= 4) specs.Add(ai3);

        var seats = new List<LudoSeat>();
        for (var i = 0; i < specs.Count; i++)
        {
            var sd = i + 1;
            if (i == 0)
                seats.Add(new LudoSeat { Seat = 0, Side = 1, Color = LudoSeats.ColorOf(1), Uid = uid, Name = user.DisplayName, IsAi = false, Active = true });
            else if (specs[i])
                seats.Add(new LudoSeat { Seat = i, Side = sd, Color = LudoSeats.ColorOf(sd), Uid = null, Name = "AI", IsAi = true, Active = true });
            else
                seats.Add(new LudoSeat { Seat = i, Side = sd, Color = LudoSeats.ColorOf(sd), Uid = null, Name = "", IsAi = false, Active = true });
        }
        var hasEmptyHuman = seats.Any(x => x.Uid is null && !x.IsAi);
        var seat1 = seats.FirstOrDefault(x => x.Seat == 1);
        var guestId = seat1 is { IsAi: false } ? seat1.Uid : null;

        var now = DateTime.UtcNow;
        var room = new GameRoom
        {
            Code = NewCode(),
            GameKey = key,
            HostUserId = uid,
            HostSide = 1,
            GuestUserId = guestId,
            SeatsJson = LudoSeats.Store(seats),
            Status = hasEmptyHuman ? "waiting" : "playing",
            Turn = 1,
            AiLevel = seats.Any(x => x.IsAi) ? 2 : 0,
            Size = s.Size,
            Forbidden = s.Forbidden,
            MoveTimeoutSec = s.MoveTimeoutSec,
            TotalTimeoutSec = s.TotalTimeoutSec,
            TurnStartedAt = hasEmptyHuman ? null : now,
            HostSeenAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.GameRooms.Add(room);
        _db.SaveChanges();

        var engine = GameEngines.Get(key);
        var initEvs = engine.InitialEvents(room);
        if (initEvs.Count > 0)
        {
            room.MovesJson = GameEvents.Store(initEvs);
            _db.SaveChanges();
        }
        return RedirectToPage("/Games/Play", new { gameKey = key, id = room.Id });
    }

    private IActionResult CreateRoom(string gameKey, int side, int aiLevel, string? mode = null)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);

        GameSweeper.Sweep(_db);

        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");
        var s = GameSettingsCatalog.Load(user.GameSettings);

        var stale = _db.GameRooms
            .Where(x => x.HostUserId == uid && x.Status == "waiting" && x.GuestUserId == null)
            .ToList();
        if (stale.Count > 0) _db.GameRooms.RemoveRange(stale);

        // 军旗三模式（P3-1 与 API 400 对齐）：建房表单显式带 mode（UI 默认明棋）；
        // 缺省/空 = dark（现状兼容）；未知值与 API 同判——拒绝（ApiBadRequest），不静默降级
        var armyMode = key == "armychess"
            ? (mode?.Trim().ToLowerInvariant() switch
            {
                "" or null => "dark",
                "open" => "open",
                "dark" => "dark",
                "fanqi" => "fanqi",
                _ => throw new ApiBadRequest("没有这种军旗模式"),
            })
            : null;

        var isAi = aiLevel > 0;
        var room = new GameRoom
        {
            Code = NewCode(),
            GameKey = key,
            HostUserId = uid,
            HostSide = side == 2 ? 2 : 1,
            Status = armyMode == "open" ? "waiting" : (isAi ? "playing" : "waiting"),   // 明棋统一翻 setup
            // 翻棋开棋方系统随机（规则文档一、3）
            Turn = armyMode == "fanqi" ? Random.Shared.Next(1, 3) : 1,
            AiLevel = aiLevel,
            Size = s.Size,
            Forbidden = s.Forbidden,
            MoveTimeoutSec = s.MoveTimeoutSec,
            TotalTimeoutSec = s.TotalTimeoutSec,
            TurnStartedAt = isAi && armyMode != "open" ? DateTime.UtcNow : null,
            Mode = armyMode,
            HostSeenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.GameRooms.Add(room);
        _db.SaveChanges();

        var engine = GameEngines.Get(key);
        var initEvs = engine.InitialEvents(room);
        if (initEvs.Count > 0)
        {
            room.MovesJson = GameEvents.Store(initEvs);
            _db.SaveChanges();
        }

        // 军旗明棋 + AI 对手：进布阵阶段并即时随机布 AI 那一侧（同 API 建房）
        if (armyMode == "open" && isAi)
            ArmyChessSetup.EnterSetup(_db, _db.GameRooms.AsNoTracking().First(x => x.Id == room.Id));

        return RedirectToPage("/Games/Play", new { gameKey = key, id = room.Id });
    }

    public IActionResult OnPostJoinByCode(string gameKey, string code)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        code = (code ?? "").Trim().ToUpperInvariant();
        if (code.Length == 0) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        var room = _db.GameRooms.FirstOrDefault(x => x.Code == code);
        if (room is null) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        // 幂等加入
        if (GameViews.MySide(room, uid) == 0 && room.Status == "waiting" && room.GuestUserId is null)
        {
            var rev = room.Revision;
            var now = DateTime.UtcNow;
            // 军旗明棋：加入 → 布阵阶段（同 API Join_Internal）
            var armyOpenSetup = room.GameKey == "armychess" && room.Mode == "open";
            _db.GameRooms
                .Where(x => x.Id == room.Id && x.Revision == rev && x.GuestUserId == null)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.GuestUserId, uid)
                    .SetProperty(x => x.Status, armyOpenSetup ? "setup" : "playing")
                    .SetProperty(x => x.TurnStartedAt, (DateTime?)now)
                    .SetProperty(x => x.GuestSeenAt, now)
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now));
        }
        return RedirectToPage("/Games/Play", new { gameKey = key, id = room.Id });
    }

    public IActionResult OnPostLeave(string gameKey, int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id && x.GameKey == key);
        if (room is null) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        if (room.Status == "waiting" && room.HostUserId == uid)
        {
            _db.GameRooms.Remove(room);
            _db.SaveChanges();
        }
        return RedirectToPage("/Games/Lobby", new { gameKey = key });
    }

    private string NewCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        for (var attempt = 0; attempt < 12; attempt++)
        {
            var code = new char[6];
            for (var i = 0; i < code.Length; i++) code[i] = alphabet[Random.Shared.Next(alphabet.Length)];
            var s = new string(code);
            if (!_db.GameRooms.Any(x => x.Code == s)) return s;
        }
        return $"G{DateTime.UtcNow:HHmmss}";
    }
}
