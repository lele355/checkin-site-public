using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games.Gomoku;

/// <summary>
/// 五子棋杂项设置 —— 只管「我新建对局时用什么规则」：盘面大小 / 禁手 / 限时。
///
/// 这一组是**默认值**：建房那一刻快照进 `GameRoom`，已开打的局不会因改这里而中途变形。
/// 与「游戏总设置」（/Games/Settings，只管自己的画面）分开存同一个 JSON 的不同字段，
/// 所以两边的表单各自只读写自己那半，互不覆盖。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class SettingsModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public GameSettingsCatalog.RuleDefaults Rules { get; private set; } = new();

    public string? Ok { get; private set; }
    public string? Err { get; private set; }

    public static int[] Sizes => GomokuRules.AllowedSizes;
    public static int[] MoveOptions => GameSettingsCatalog.MoveTimeoutOptions;
    public static int[] TotalOptions => GameSettingsCatalog.TotalTimeoutOptions;

    public void OnGet(bool saved = false)
    {
        Load();
        if (saved) Ok = "已保存";
    }

    public IActionResult OnPostSave()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) { Err = "账号不存在"; Load(); return Page(); }

        var rules = new GameSettingsCatalog.RuleDefaults
        {
            Size = Int("size", GomokuRules.DefaultSize),
            Forbidden = Chk("forbidden"),
            MoveTimeoutSec = Int("moveTimeoutSec", 0),
            TotalTimeoutSec = Int("totalTimeoutSec", 0),
        };
        var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings), rules);
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/Gomoku/Settings", new { saved = true });
    }

    /// <summary>恢复默认 = 只把「规则默认」这一半摁回出厂值，不动显示偏好</summary>
    public IActionResult OnPostReset()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");
        var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings),
                                               new GameSettingsCatalog.RuleDefaults());
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/Gomoku/Settings", new { saved = true });
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        Rules = GameSettingsCatalog.ToRules(GameSettingsCatalog.Load(u?.GameSettings));
    }

    private bool Chk(string name) =>
        Request.HasFormContentType && Request.Form[name].Any(v => v == "1" || v == "true" || v == "on");

    private int Int(string name, int fallback) =>
        int.TryParse(Request.Form[name].FirstOrDefault(), out var v) ? v : fallback;
}
