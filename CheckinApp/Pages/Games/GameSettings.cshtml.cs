using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>
/// 单游戏设置 —— 按 gameKey 只显示适用项（走查表 §2.1：每款只显示真的能生效的项）。
/// 两层生效（走查表 §1）：显示层（落子确认/坐标/最后落子/音效）即时生效；
/// 重建层（盘面/禁手/军旗模式/限时）建房快照，对局中改 → 提醒 + 一键重建（§3）。
/// 红线 19：各设置 DTO 独立（DisplayDto / GomokuRulesDto / ArmyChessModeDto / TimeoutRuleDefaultsDto）。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class GameSettingsModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public string GameKey { get; private set; } = "";
    public string GameName { get; private set; } = "";

    // ---- 按 gameKey 的适用项（走查表 §2.1；固定盘面绝不出现「盘面大小」） ----
    public bool ShowTapConfirm { get; private set; }
    public bool ShowCoord { get; private set; }
    public bool ShowLastMark { get; private set; }
    public bool ShowSound { get; private set; }        // 只对有音效的游戏（fish；melon 待 M13）
    public bool ShowSize { get; private set; }
    public bool ShowForbidden { get; private set; }
    public bool ShowMode { get; private set; }         // 军旗专属
    public bool ShowTimers { get; private set; }       // 联机对战类 6 款
    public bool HasItems { get; private set; }

    /// <summary>盘面档位（五子棋 13/15/19、黑白棋 6/8/10/12）</summary>
    public int[] SizeOptionsArr => GameKey == "reversi" ? ReversiRules.SizeOptions : [13, 15, 19];

    // ---- 当前值 ----
    public bool TapConfirm { get; private set; }
    public bool ShowCoordVal { get; private set; }
    public bool LastMark { get; private set; }
    public bool SoundVal { get; private set; }
    public int GomokuSize { get; private set; } = GomokuRules.DefaultSize;
    public bool GomokuForbidden { get; private set; }
    public string ArmyMode { get; private set; } = "open";
    public int MoveTimeoutSec { get; private set; }
    public int TotalTimeoutSec { get; private set; }
    public int[] MoveTimeoutOptions => GameSettingsCatalog.MoveTimeoutOptions;
    public int[] TotalTimeoutOptions => GameSettingsCatalog.TotalTimeoutOptions;
    public string[] ModeOptions => GameSettingsCatalog.ModeOptions;

    public string? Ok { get; private set; }

    // ---- 重建提醒（§3）：对局中改重建层 → 提醒 + 一键重建 ----
    public bool RebuildPrompt { get; private set; }
    public int RebuildRoomId { get; private set; }
    public bool RebuildIsAi { get; private set; }
    public int RebuildAiLevel { get; private set; }

    public IActionResult OnGet(string gameKey, bool saved = false)
    {
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        GameName = GameCatalog.Find(key)?.Name ?? key;
        ApplyItemVisibility(key);
        Load(key);
        if (saved) Ok = "已保存";
        return Page();
    }

    public IActionResult OnPostSave(
        string gameKey,
        bool tapConfirm = false, bool showCoord = false, bool lastMark = false, bool sound = true,
        int moveTimeoutSec = 0, int totalTimeoutSec = 0,
        int size = 0, bool forbidden = false, string mode = "open",
        bool rebuildConfirm = false)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        GameName = GameCatalog.Find(key)?.Name ?? key;
        ApplyItemVisibility(key);

        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) { Load(key); return Page(); }
        var cur = GameSettingsCatalog.Load(user.GameSettings);

        // 重建层是否变化（走查表 §3.3：只有重建层改动才弹提醒）
        var curRules = cur.GetRules(key);
        var rebuildChanged =
            (ShowSize && size > 0 && size != curRules.Size) ||
            (ShowForbidden && forbidden != curRules.Forbidden) ||
            (ShowMode && !string.Equals(mode, curRules.Mode, StringComparison.OrdinalIgnoreCase)) ||
            (ShowTimers &&
                (GameSettingsCatalog.Nearest(MoveTimeoutOptions, moveTimeoutSec) != curRules.MoveTimeoutSec ||
                 GameSettingsCatalog.Nearest(TotalTimeoutOptions, totalTimeoutSec) != curRules.TotalTimeoutSec));

        // 对局中 + 重建层改动 + 未确认 → 弹提醒（不落库，等待一键重建 / 取消回滚）
        var active = FindPlayingRoom(uid, key);
        if (rebuildChanged && active is not null && !rebuildConfirm)
        {
            RebuildPrompt = true;
            RebuildRoomId = active.Id;
            RebuildIsAi = active.AiLevel > 0 && active.GuestUserId is null;
            RebuildAiLevel = active.AiLevel;
            // 回显将改未改的值（取消即整页重载回滚）
            TapConfirm = tapConfirm; ShowCoordVal = showCoord; LastMark = lastMark; SoundVal = sound;
            if (ShowSize && size > 0) GomokuSize = GameKey == "reversi" ? ReversiRules.ClampSize(size) : GomokuRules.ClampSize(size);
            GomokuForbidden = forbidden;
            if (ShowMode && GameSettingsCatalog.ModeOptions.Contains(mode.ToLowerInvariant())) ArmyMode = mode.ToLowerInvariant();
            MoveTimeoutSec = GameSettingsCatalog.Nearest(MoveTimeoutOptions, moveTimeoutSec);
            TotalTimeoutSec = GameSettingsCatalog.Nearest(TotalTimeoutOptions, totalTimeoutSec);
            return Page();
        }

        // 落库：显示层（DisplayDto）+ 重建层（各游戏独立 DTO）
        var disp = new GameSettingsCatalog.DisplayDto
        {
            TapConfirm = tapConfirm,
            ShowCoord = showCoord,
            LastMark = lastMark,
            Vibrate = cur.Display.Vibrate,
            Sound = sound,
        };
        var merged = GameSettingsCatalog.Apply(cur, disp);
        if (key == "gomoku")
        {
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.GomokuRulesDto
            {
                Size = size > 0 ? GomokuRules.ClampSize(size) : curRules.Size,
                Forbidden = forbidden,
                MoveTimeoutSec = GameSettingsCatalog.Nearest(MoveTimeoutOptions, moveTimeoutSec),
                TotalTimeoutSec = GameSettingsCatalog.Nearest(TotalTimeoutOptions, totalTimeoutSec),
            });
        }
        else if (key == "reversi")
        {
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.ReversiRulesDto
            {
                Size = size > 0 ? ReversiRules.ClampSize(size) : curRules.Size,
                MoveTimeoutSec = GameSettingsCatalog.Nearest(MoveTimeoutOptions, moveTimeoutSec),
                TotalTimeoutSec = GameSettingsCatalog.Nearest(TotalTimeoutOptions, totalTimeoutSec),
            });
        }
        else if (key == "armychess")
        {
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.ArmyChessModeDto
            {
                Mode = GameSettingsCatalog.ModeOptions.Contains(mode.ToLowerInvariant()) ? mode.ToLowerInvariant() : curRules.Mode,
                MoveTimeoutSec = GameSettingsCatalog.Nearest(MoveTimeoutOptions, moveTimeoutSec),
                TotalTimeoutSec = GameSettingsCatalog.Nearest(TotalTimeoutOptions, totalTimeoutSec),
            });
        }
        else
        {
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.TimeoutRuleDefaultsDto
            {
                MoveTimeoutSec = GameSettingsCatalog.Nearest(MoveTimeoutOptions, moveTimeoutSec),
                TotalTimeoutSec = GameSettingsCatalog.Nearest(TotalTimeoutOptions, totalTimeoutSec),
            }, key);
        }
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();

        // 一键重建确认后：直接给出重建脚本所需参数（建新关旧由页面脚本走 API）
        if (rebuildChanged && active is not null && rebuildConfirm)
        {
            RebuildPrompt = false;
            RebuildRoomId = active.Id;
            RebuildIsAi = active.AiLevel > 0 && active.GuestUserId is null;
            RebuildAiLevel = active.AiLevel;
            Load(key);
            Ok = "已保存";
            return Page();
        }
        return RedirectToPage("/Games/GameSettings", new { gameKey = key, saved = true });
    }

    /// <summary>恢复默认 = 立即恢复出厂值并落库（只动本游戏这半 + 显示层不动）</summary>
    public IActionResult OnPostReset(string gameKey)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");

        var merged = GameSettingsCatalog.Load(user.GameSettings);
        if (key == "gomoku")
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.GomokuRulesDto());
        else if (key == "reversi")
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.ReversiRulesDto());
        else if (key == "armychess")
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.ArmyChessModeDto());
        else
            merged = GameSettingsCatalog.Apply(merged, new GameSettingsCatalog.TimeoutRuleDefaultsDto(), key);
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/GameSettings", new { gameKey = key, saved = true });
    }

    private GameRoom? FindPlayingRoom(int uid, string key) =>
        _db.GameRooms
            .Where(x => x.GameKey == key && x.Status == "playing"
                && (x.HostUserId == uid || x.GuestUserId == uid))
            .OrderByDescending(x => x.Id)   // 多局并行时「这一局」= 最近开的
            .FirstOrDefault();

    private void ApplyItemVisibility(string key)
    {
        // 走查表 §2.1：每款只显示真的能生效的项（0.2：不显示的项一个字都不出现）
        ShowTapConfirm = key is "gomoku" or "jungle" or "xiangqi" or "armychess" or "reversi" or "ludo";
        ShowCoord = key is "gomoku" or "jungle" or "xiangqi" or "reversi";
        ShowLastMark = key is "gomoku" or "jungle" or "xiangqi" or "armychess" or "reversi" or "ludo";
        ShowSound = key is "fish" or "melon";             // 有音效的游戏才显示（melon M13 落地即通）
        ShowSize = key is "gomoku" or "reversi";          // 可变盘面两款（档位不同，SizeOptionsArr 分流）
        ShowForbidden = key == "gomoku";
        ShowMode = key == "armychess";
        ShowTimers = key is "gomoku" or "jungle" or "xiangqi" or "armychess" or "reversi" or "ludo";
        HasItems = ShowTapConfirm || ShowCoord || ShowLastMark || ShowSound
            || ShowSize || ShowForbidden || ShowMode || ShowTimers;
    }

    private void Load(string key)
    {
        if (_me.UserId is not int uid) return;
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        var s = GameSettingsCatalog.Load(u?.GameSettings);
        var d = GameSettingsCatalog.ToDisplay(s);
        TapConfirm = d.TapConfirm;
        ShowCoordVal = d.ShowCoord;
        LastMark = d.LastMark;
        SoundVal = d.Sound;
        var r = s.GetRules(key);
        GomokuSize = r.Size;
        GomokuForbidden = r.Forbidden;
        ArmyMode = GameSettingsCatalog.ModeOptions.Contains(r.Mode) ? r.Mode : "open";
        MoveTimeoutSec = r.MoveTimeoutSec;
        TotalTimeoutSec = r.TotalTimeoutSec;
    }
}
