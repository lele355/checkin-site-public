using CheckinApp.Api;
using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Games.Gomoku;

/// <summary>
/// 游戏大厅：我的对局 + 谁在等人。
///
/// 页面渲染用服务端数据（关掉 JS 也能看到有哪些房间），
/// 真正的落子/轮询走 /api/v1/games（与 App 同一套接口，见 Api/GamesApi.cs）。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public record RoomRow(
        int Id, string Code, string Status, string HostName, string GuestName,
        int HostSide, int MoveCount, int MySide, bool MyTurn, int Winner, string UpdatedAt,
        int Size, bool Forbidden);

    public List<RoomRow> Mine { get; private set; } = [];
    public List<RoomRow> Open { get; private set; } = [];
    /// <summary>本页提示（不跳转的失败场景直接回显，不走 TempData）</summary>
    public string? Err { get; private set; }

    /// <summary>我的默认设置（决定建房时各字段的初始值）</summary>
    public GameSettings Settings { get; private set; } = GameSettingsCatalog.Defaults;

    public void OnGet() => Load();

    /// <summary>
    /// 建房。size / forbidden 留空（0 / null）就走我的默认设置 ——
    /// 大厅里那两个下拉框只是「这一局改一下」，不会覆盖存下来的默认值。
    /// </summary>
    public IActionResult OnPostCreate(int side, int size = 0, string? forbidden = null)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        var s = LoadSettings(uid);
        if (size > 0) s.Size = size;
        if (forbidden is not null) s.Forbidden = forbidden == "1";
        s = GameSettingsCatalog.Normalize(s);

        // 一个人只留一个等待中的房间，否则大厅里堆一屏自己的空房
        var stale = _db.GameRooms
            .Where(x => x.HostUserId == uid && x.Status == "waiting" && x.GuestUserId == null)
            .ToList();
        if (stale.Count > 0) _db.GameRooms.RemoveRange(stale);

        var room = new GameRoom
        {
            Code = NewCode(),
            HostUserId = uid,
            HostSide = side == 2 ? 2 : 1,
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
        _db.GameRooms.Add(room);
        _db.SaveChanges();
        return RedirectToPage("/Games/Gomoku/Play", new { id = room.Id });
    }

    public IActionResult OnPostJoin(string? code)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var c = (code ?? "").Trim().ToUpperInvariant();
        if (c.Length == 0) { Err = "请输入房间码"; Load(); return Page(); }

        var room = _db.GameRooms.Include(x => x.Host).Include(x => x.Guest)
            .FirstOrDefault(x => x.Code == c);
        if (room is null) { Err = "没有这个房间，房间码可能输错了"; Load(); return Page(); }
        if (MySide(room, uid) == 0 && (room.Status != "waiting" || room.GuestUserId is not null))
        {
            // 已经有人了 —— 但允许旁观：直接进房间看
            return RedirectToPage("/Games/Gomoku/Play", new { id = room.Id });
        }
        return RedirectToPage("/Games/Gomoku/Play", new { id = room.Id, join = 1 });
    }

    public IActionResult OnPostLeave(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var room = _db.GameRooms.FirstOrDefault(x => x.Id == id);
        if (room is not null && room.HostUserId == uid && room.Status != "playing")
        {
            _db.GameRooms.Remove(room);
            _db.SaveChanges();
        }
        return RedirectToPage();
    }

    private GameSettings LoadSettings(int uid)
    {
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        return GameSettingsCatalog.Load(u?.GameSettings);
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;

        // 顺手扫掉闲置 5 分钟的房间（与 API 大厅同一套懒结算）
        GameSweeper.Sweep(_db);

        var cutoff = DateTime.UtcNow.AddHours(-24);      // 别人挂着的空房只留 24 小时
        var keepDone = DateTime.UtcNow.AddDays(-3);      // 我打完的局只留 3 天，免得大厅越攒越长

        Settings = LoadSettings(uid);

        var rooms = _db.GameRooms.Include(x => x.Host).Include(x => x.Guest)
            .Where(x => x.GameKey == GamesApi.GameKey
                        && (((x.HostUserId == uid || x.GuestUserId == uid) && x.Status != "finished")
                            || ((x.HostUserId == uid || x.GuestUserId == uid) && x.UpdatedAt > keepDone)
                            || (x.Status == "waiting" && x.GuestUserId == null && x.CreatedAt > cutoff)))
            .OrderByDescending(x => x.UpdatedAt)
            .Take(40)
            .ToList();

        var rows = rooms.Select(r => new RoomRow(
            r.Id, r.Code, r.Status,
            r.Host?.DisplayName ?? "",
            r.Guest?.DisplayName ?? "",
            r.HostSide,
            GomokuRules.Parse(r.MovesJson).Count,
            MySide(r, uid),
            r.Status == "playing" && MySide(r, uid) != 0 && r.Turn == MySide(r, uid),
            r.Winner,
            SiteClock.ToLocal(DateTime.SpecifyKind(r.UpdatedAt, DateTimeKind.Utc)).ToString("M月d日 HH:mm"),
            r.Size,
            r.Forbidden)).ToList();

        Mine = rows.Where(x => x.MySide != 0).Take(12).ToList();
        Open = rows.Where(x => x.MySide == 0).ToList();
    }

    private static int MySide(GameRoom r, int uid) =>
        r.HostUserId == uid ? r.HostSide
        : r.GuestUserId == uid ? GomokuRules.Other(r.HostSide)
        : 0;

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
