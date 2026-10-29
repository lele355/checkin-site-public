using System.Text.Json;
using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Games.Gomoku;

/// <summary>
/// 棋盘页。首屏由服务端渲染（关掉 JS 也能看到当前局面和最后一手），
/// 之后交给 wwwroot/js/games.js 每 1.2 秒轮询 /api/v1/games/{id} 增量刷新。
///
/// 落子本身不在 PageModel 里做 —— 网页和 App 都打同一个 POST /api/v1/games/{id}/move，
/// 规则判定只有一份，不会出现「网页能下、App 判负」这种两套口径。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class PlayModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public GameRoom? Room { get; private set; }
    public int MySide { get; private set; }
    public string MyName { get; private set; } = "";
    public string OppName { get; private set; } = "";
    public List<GomokuRules.Stone> Moves { get; private set; } = [];
    public GomokuRules.Stone? Last { get; private set; }
    public bool CanJoin { get; private set; }
    public bool IsHost { get; private set; }

    /// <summary>盘面边长（13 / 15 / 19），本局建房时定下的</summary>
    public int Size { get; private set; } = GomokuRules.DefaultSize;

    /// <summary>我的显示偏好（落子确认 / 坐标 / 最后一手）</summary>
    public GameSettings Settings { get; private set; } = GameSettingsCatalog.Defaults;

    /// <summary>给 JS 的初始状态（口径与 /api/v1/games/{id} 一致）</summary>
    public string StateJson { get; private set; } = "{}";

    public IActionResult OnGet(int id, int join = 0)
    {
        if (!Load(id)) return RedirectToPage("/Games");

        // 从大厅点进来时带 join=1：顺手坐下（省一次点击）
        if (join == 1 && CanJoin && _me.UserId is int uid && uid != Room!.HostUserId)
        {
            if (Join(id, uid) && !Load(id)) return RedirectToPage("/Games");
        }
        return Page();
    }

    public IActionResult OnPostJoin(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        Join(id, uid);
        return RedirectToPage("/Games/Gomoku/Play", new { id });
    }

    /// <summary>退出：等人中的房主 = 解散；对局中 = 认输（与 App 的 leave 语义一致）</summary>
    public IActionResult OnPostLeave(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id);
        if (room is null) return RedirectToPage("/Games");

        var side = MySideOf(room, uid);
        if (side == 0) return RedirectToPage("/Games");

        if (room.Status == "waiting" && room.HostUserId == uid)
        {
            _db.GameRooms.Remove(room);
            _db.SaveChanges();
        }
        else if (room.Status == "playing")
        {
            var rev = room.Revision;
            var now = DateTime.UtcNow;
            var loser = side;
            var winner = GomokuRules.Other(loser);
            _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
                .ExecuteUpdate(s => s
                    .SetProperty(x => x.Status, "finished")
                    .SetProperty(x => x.Winner, winner)
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
        return RedirectToPage("/Games");
    }

    /// <summary>再来一局：清盘 + 交换先手（输的先走）+ 计时归零，规则沿用这一局</summary>
    public IActionResult OnPostRematch(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id);
        if (room is null) return RedirectToPage("/Games");
        var side = MySideOf(room, uid);
        if (side == 0) return RedirectToPage("/Games");

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var playing = room.GuestUserId is not null;
        var newHostSide = GomokuRules.Other(room.HostSide);
        _db.GameRooms.Where(x => x.Id == id && x.Revision == rev)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.MovesJson, "")
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
        return RedirectToPage("/Games/Gomoku/Play", new { id });
    }

    /// <summary>坐下（幂等）。成了返回 true</summary>
    private bool Join(int id, int uid)
    {
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id);
        if (room is null) return false;
        if (MySideOf(room, uid) != 0) return false;
        if (room.Status != "waiting" || room.GuestUserId is not null) return false;

        var rev = room.Revision;
        var now = DateTime.UtcNow;
        var rows = _db.GameRooms
            .Where(x => x.Id == id && x.Revision == rev && x.GuestUserId == null)
            .ExecuteUpdate(s => s
                .SetProperty(x => x.GuestUserId, uid)
                .SetProperty(x => x.Status, "playing")
                .SetProperty(x => x.TurnStartedAt, (DateTime?)now)   // 坐下就开始计时
                .SetProperty(x => x.GuestSeenAt, now)
                .SetProperty(x => x.Revision, rev + 1)
                .SetProperty(x => x.UpdatedAt, now));
        _db.ChangeTracker.Clear();
        return rows > 0;
    }

    private bool Load(int id)
    {
        if (_me.UserId is not int uid) return false;
        var room = _db.GameRooms.Include(x => x.Host).Include(x => x.Guest).FirstOrDefault(x => x.Id == id);
        if (room is null) return false;

        // 打开页面顺手结算一次超时：不然「超时判负」得等下一次轮询才看见
        if (GameClock.Enforce(_db, room))
            room = _db.GameRooms.Include(x => x.Host).Include(x => x.Guest).FirstOrDefault(x => x.Id == id);
        if (room is null) return false;

        Room = room;
        IsHost = room.HostUserId == uid;
        MySide = MySideOf(room, uid);
        Size = GomokuRules.ClampSize(room.Size);
        MyName = IsHost ? room.Host?.DisplayName ?? "" : room.Guest?.DisplayName ?? "";
        OppName = IsHost ? room.Guest?.DisplayName ?? "" : room.Host?.DisplayName ?? "";
        Moves = GomokuRules.Parse(room.MovesJson);
        Last = Moves.Count == 0 ? null : Moves[^1];
        CanJoin = room.Status == "waiting" && room.GuestUserId is null && MySide == 0;

        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        Settings = GameSettingsCatalog.Load(u?.GameSettings);

        var now = DateTime.UtcNow;
        // 棋盘留白：开了坐标要留一圈字位（与 Play.cshtml 用同一口径，只算一次）
        var pad = Settings.ShowCoord ? 40 : 20;
        StateJson = JsonSerializer.Serialize(new
        {
            id = room.Id,
            code = room.Code,
            mySide = MySide,
            size = Size,
            pad,
            forbidden = room.Forbidden,
            tapConfirm = Settings.TapConfirm,
            lastMark = Settings.LastMark,
            showCoord = Settings.ShowCoord,
            revision = room.Revision,
            status = room.Status,
            turn = room.Turn,
            winner = room.Winner,
            resultReason = room.ResultReason,
            moves = Moves.Select(m => new { x = m.x, y = m.y, s = m.s }),
            lastMove = Last is null ? null : new { x = Last.x, y = Last.y, s = Last.s },
            myTurn = room.Status == "playing" && MySide != 0 && room.Turn == MySide,
            canJoin = CanJoin,
            moveRemainMs = GameClock.MoveRemainMs(room, now),
            myRemainMs = GameClock.RemainMs(room, MySide, now),
            oppRemainMs = GameClock.RemainMs(room, MySide == 0 ? 0 : GomokuRules.Other(MySide), now),
        });
        return true;
    }

    private static int MySideOf(GameRoom r, int uid) =>
        r.HostUserId == uid ? r.HostSide
        : r.GuestUserId == uid ? GomokuRules.Other(r.HostSide)
        : 0;
}
