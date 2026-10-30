using System.Text.Json;
using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Games;

/// <summary>
/// 通用对局页 —— 按 {gameKey}/Play/{id} 路由分发。
/// 首屏由服务端渲染状态条，棋盘由 boards.js + games.js 轮询刷新。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class PlayModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public string GameKey { get; private set; } = "";
    public string GameName { get; private set; } = "";
    public int Uid { get; private set; }
    public string StatusText { get; private set; } = "";
    public string StateJson { get; private set; } = "{}";

    /// <summary>快照（给 Razor 引用字段用）</summary>
    public dynamic Snap { get; private set; } = new { };

    public IActionResult OnGet(string gameKey, int id, int join = 0)
    {
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        GameName = GameCatalog.Find(key)?.Name ?? key;

        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        Uid = uid;

        if (!Load(id, key, uid)) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        // join=1 顺手坐下
        if (join == 1)
        {
            TryJoin(id, uid);
            if (!Load(id, key, uid)) return RedirectToPage("/Games/Lobby", new { gameKey = key });
        }
        return Page();
    }

    public IActionResult OnPostJoin(string gameKey, int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        TryJoin(id, uid);
        return RedirectToPage("/Games/Play", new { gameKey = key, id });
    }

    public IActionResult OnPostLeave(string gameKey, int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id && x.GameKey == key);
        if (room is null) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        var mySide = GameViews.MySide(room, uid);
        if (mySide == 0) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        if (room.Status == "waiting" && room.HostUserId == uid)
        {
            _db.GameRooms.Remove(room);
            _db.SaveChanges();
        }
        else if (room.Status == "playing")
        {
            var engine = GameEngines.Get(key);
            var rev = room.Revision;
            var now = DateTime.UtcNow;

            // 飞行棋多人（N>2）：认输 = 该座出局、其余继续
            if (key == "ludo" && LudoSeats.Count(room) > 2)
            {
                var seats = LudoSeats.MarkInactive(room, mySide);
                var activeSides = seats.Where(s => s.Active).Select(s => s.Side).ToList();
                var over = activeSides.Count <= 1;
                var soleActive = over ? (activeSides.Count == 1 ? activeSides[0] : 0) : 0;
                var nextTurn = over ? room.Turn : LudoSeats.NextActive(room, mySide);
                _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.SeatsJson, LudoSeats.Store(seats))
                        .SetProperty(x => x.Status, over ? "finished" : "playing")
                        .SetProperty(x => x.Winner, soleActive)
                        .SetProperty(x => x.ResultReason, over ? "resign" : "")
                        .SetProperty(x => x.Turn, nextTurn)
                        .SetProperty(x => x.TurnStartedAt, over ? room.TurnStartedAt : (DateTime?)now)
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now)
                        .SetProperty(x => x.FinishedAt, over ? now : room.FinishedAt));
            }
            else
            {
                _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                    .ExecuteUpdate(s => s
                        .SetProperty(x => x.Status, "finished")
                        .SetProperty(x => x.Winner, engine.NextTurn(mySide, room))
                        .SetProperty(x => x.ResultReason, "resign")
                        .SetProperty(x => x.Revision, rev + 1)
                        .SetProperty(x => x.UpdatedAt, now)
                        .SetProperty(x => x.FinishedAt, now));
            }
        }
        else if (room.HostUserId == uid)
        {
            _db.GameRooms.Remove(room);
            _db.SaveChanges();
        }
        return RedirectToPage("/Games/Lobby", new { gameKey = key });
    }

    public IActionResult OnPostRematch(string gameKey, int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id && x.GameKey == key);
        if (room is null) return RedirectToPage("/Games/Lobby", new { gameKey = key });

        var engine = GameEngines.Get(key);
        var newHostSide = engine.Other(room.HostSide);
        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var playing = room.GuestUserId is not null || room.AiLevel > 0;
        var initJson = GameEvents.Store(engine.InitialEvents(room));

        // 飞行棋多座：重置座位（全员 active、清零 usedMs）
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

        _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
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
        return RedirectToPage("/Games/Play", new { gameKey = key, id });
    }

    private void TryJoin(int id, int uid)
    {
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id);
        if (room is null) return;
        if (GameViews.MySide(room, uid) != 0) return;

        // 飞行棋多座：填下一个空真人座
        if (room.GameKey == "ludo" && room.SeatsJson != null)
        {
            if (room.Status != "playing" && room.Status != "waiting") return;
            var seats = LudoSeats.Get(room);
            var empty = seats.FirstOrDefault(s => s.Uid is null && !s.IsAi && s.Active);
            if (empty is null) return;
            empty.Uid = uid;
            empty.Name = _db.Users.FirstOrDefault(x => x.Id == uid)?.DisplayName ?? "";
            empty.SeenAt = DateTime.UtcNow;
            var stillEmpty = seats.Any(s => s.Uid is null && !s.IsAi && s.Active);
            var seat1 = seats.FirstOrDefault(s => s.Seat == 1);
            var guestId = seat1 is { IsAi: false } ? seat1.Uid : null;
            var rev0 = room.Revision;
            var now0 = DateTime.UtcNow;
            _db.GameRooms.Where(x => x.Id == id && x.Revision == rev0)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.SeatsJson, LudoSeats.Store(seats))
                    .SetProperty(x => x.GuestUserId, guestId)
                    .SetProperty(x => x.Status, stillEmpty ? "waiting" : "playing")
                    .SetProperty(x => x.TurnStartedAt, stillEmpty ? room.TurnStartedAt : (DateTime?)now0)
                    .SetProperty(x => x.Revision, rev0 + 1)
                    .SetProperty(x => x.UpdatedAt, now0));
            _db.ChangeTracker.Clear();
            return;
        }

        if (room.Status != "waiting" || room.GuestUserId is not null) return;

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        _db.GameRooms
            .Where(x => x.Id == id && x.Revision == rev && x.GuestUserId == null)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.GuestUserId, uid)
                .SetProperty(x => x.Status, "playing")
                .SetProperty(x => x.TurnStartedAt, (DateTime?)now)
                .SetProperty(x => x.GuestSeenAt, now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now));
        _db.ChangeTracker.Clear();
    }

    private bool Load(int id, string key, int uid)
    {
        var room = _db.GameRooms.Find(id);
        if (room is null || !string.Equals(room.GameKey, key, StringComparison.OrdinalIgnoreCase)) return false;

        if (GameClock.Enforce(_db, room)) room = _db.GameRooms.Find(id);
        if (room is null) return false;
        if (GameAi.EnsureMove(_db, room)) room = _db.GameRooms.Find(id);
        if (room is null) return false;
        if (GameAi.EnsureAutoPass(_db, room)) room = _db.GameRooms.Find(id);
        if (room is null) return false;

        var snap = GameViews.Snap(room, uid);
        Snap = snap;

        // 飞行棋多座：当前轮到谁的名字
        var isLudoMulti = key == "ludo" && LudoSeats.Count(room) > 2;
        var turnName = "";
        if (isLudoMulti)
        {
            var seat = LudoSeats.BySide(room, room.Turn);
            turnName = seat is { IsAi: true } ? "AI" : seat?.Name ?? "";
        }

        // 状态条文案
        dynamic s = snap;
        StatusText = s.status switch
        {
            "waiting" => $"等人进来 —— 把房间码 {s.code} 发给朋友",
            "finished" => s.winner switch
            {
                3 => "和棋",
                0 => "已结束",
                _ => s.winner == s.mySide ? "你赢了" : "你输了",
            } + (s.resultReason == "resign" ? "（认输）" : s.resultReason == "timeout" ? "（超时）" : s.resultReason == "count" ? "（终局数子）" : ""),
            _ when s.mySide == 0 => "你在旁观这一局",
            _ when s.myTurn => "轮到你",
            _ => isLudoMulti ? $"等 {turnName} 走棋" : $"等 {s.opponentName} 落子",
        };

        // 给 JS 的初始状态
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        var settings = GameSettingsCatalog.Load(u?.GameSettings);
        StateJson = JsonSerializer.Serialize(new
        {
            id = room.Id,
            code = room.Code,
            gameKey = key,
            mySide = s.mySide,
            status = s.status,
            turn = s.turn,
            winner = s.winner,
            resultReason = s.resultReason,
            revision = s.revision,
            myTurn = s.myTurn,
            canJoin = s.canJoin,
            players = (object?)s.players,
            tapConfirm = settings.TapConfirm,
            lastMark = settings.LastMark,
            showCoord = settings.ShowCoord,
            moveRemainMs = s.moveRemainMs,
            myRemainMs = s.myRemainMs,
            oppRemainMs = s.oppRemainMs,
            state = s.state,
        });
        return true;
    }
}
