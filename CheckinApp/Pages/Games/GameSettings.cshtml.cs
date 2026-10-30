using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>通用规则默认设置 —— 与 GameSettingsCatalog.RuleDefaults 对应（红线 19 独立 DTO）。</summary>
[Authorize(Policy = "perm:games.use")]
public class GameSettingsModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public string GameKey { get; private set; } = "";
    public string GameName { get; private set; } = "";
    public GameSettingsCatalog.RuleDefaults Rules { get; private set; } = new();
    public int GomokuSize => Rules.Size;
    public bool GomokuForbidden => Rules.Forbidden;
    public int MoveTimeoutSec => Rules.MoveTimeoutSec;
    public int TotalTimeoutSec => Rules.TotalTimeoutSec;
    public int[] MoveTimeoutOptions => GameSettingsCatalog.MoveTimeoutOptions;
    public int[] TotalTimeoutOptions => GameSettingsCatalog.TotalTimeoutOptions;
    public string? Ok { get; private set; }

    public IActionResult OnGet(string gameKey, bool saved = false)
    {
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        GameName = GameCatalog.Find(key)?.Name ?? key;
        Load();
        if (saved) Ok = "已保存";
        return Page();
    }

    public IActionResult OnPostSave(string gameKey, int moveTimeoutSec, int totalTimeoutSec, int size = 0, bool forbidden = false)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        GameName = GameCatalog.Find(key)?.Name ?? key;

        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) { Load(); return Page(); }

        // 保存限时半（只动限时，不动 size/forbidden）
        var timeoutDto = new GameSettingsCatalog.TimeoutRuleDefaultsDto
        {
            MoveTimeoutSec = GameSettingsCatalog.Nearest(GameSettingsCatalog.MoveTimeoutOptions, moveTimeoutSec),
            TotalTimeoutSec = GameSettingsCatalog.Nearest(GameSettingsCatalog.TotalTimeoutOptions, totalTimeoutSec),
        };
        var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings), timeoutDto, key);

        // 五子棋：保存盘面半（只动 size/forbidden，不动限时）
        if (key == "gomoku" && size > 0)
        {
            var gomokuDto = new GameSettingsCatalog.GomokuRulesDto
            {
                Size = size,
                Forbidden = forbidden,
                MoveTimeoutSec = timeoutDto.MoveTimeoutSec,
                TotalTimeoutSec = timeoutDto.TotalTimeoutSec,
            };
            merged = GameSettingsCatalog.Apply(merged, gomokuDto);
        }

        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/GameSettings", new { gameKey = key, saved = true });
    }

    /// <summary>恢复默认 = 立即恢复出厂值并落库（只动规则默认这半）</summary>
    public IActionResult OnPostReset(string gameKey)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var key = GameCatalog.Require(gameKey);
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");

        var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings),
                                                new GameSettingsCatalog.RuleDefaults());
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/GameSettings", new { gameKey = key, saved = true });
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        Rules = GameSettingsCatalog.ToRules(GameSettingsCatalog.Load(u?.GameSettings));
    }
}
