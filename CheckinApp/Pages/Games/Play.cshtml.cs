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

            _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.Status, "finished")
                    .SetProperty(x => x.Winner, engine.NextTurn(mySide, room))
                    .SetProperty(x => x.ResultReason, "resign")
                    .SetProperty(x => x.Revision, rev + 1)
                    .SetProperty(x => x.UpdatedAt, now)
                    .SetProperty(x => x.FinishedAt, now));
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

        _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, initJson)
                .SetProperty(x => x.Turn, 1)
                .SetProperty(x => x.Status, playing ? "playing" : "waiting")
                .SetProperty(x => x.Winner, 0)
                .SetProperty(x => x.ResultReason, "")
                .SetProperty(x => x.HostSide, newHostSide)
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
            "setup" => "布阵中",   // 军棋布阵期阶段名（与 App/games.js 同词）
            _ when s.myTurn => "轮到你",
            _ => $"等 {s.opponentName} 落子",
        };

        // 给 JS 的初始状态：快照**整包** + 本机显示偏好。
        // 必须走 GameViews.Snap 同一出口（与轮询 GET /rooms/{id} 同形状）——
        // 手工匿名投影会漏新加字段（D4-BUG-1：rebuild 双通路全断），整包序列化杜绝这类漂移。
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        var settings = GameSettingsCatalog.Load(u?.GameSettings);
        var node = JsonSerializer.SerializeToNode(snap)!.AsObject();
        node["tapConfirm"] = settings.Display.TapConfirm;
        node["lastMark"] = settings.Display.LastMark;
        node["showCoord"] = settings.Display.ShowCoord;
        StateJson = node.ToJsonString();
        return true;
    }
}
