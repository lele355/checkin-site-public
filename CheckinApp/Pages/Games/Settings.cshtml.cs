using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>
/// 游戏总设置 —— 只管「我这台设备上怎么显示」：落子二次确认 / 坐标 / 最后一手标记 / 落子震动。
///
/// 这四项**不进房间、不上服务端判定**，纯前端表现，所以改它不影响对手、也不用快照。
/// 影响对局的规则（盘面 / 禁手 / 限时）在各自的「游戏设置」里，
/// 目前只有五子棋 → /Games/Gomoku/Settings。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class SettingsModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public GameSettingsCatalog.DisplayDto Display { get; private set; } = new();

    public string? Ok { get; private set; }
    public string? Err { get; private set; }

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

        var d = new GameSettingsCatalog.DisplaySettings
        {
            TapConfirm = Chk("tapConfirm"),
            ShowCoord = Chk("showCoord"),
            LastMark = Chk("lastMark"),
            Vibrate = Chk("vibrate"),
        };
        var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings), d);
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/Settings", new { saved = true });
    }

    /// <summary>恢复默认 = 只把「显示偏好」这一半摁回出厂值，不动规则默认</summary>
    public IActionResult OnPostReset()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");
        var merged = GameSettingsCatalog.Apply(GameSettingsCatalog.Load(user.GameSettings),
                                               new GameSettingsCatalog.DisplaySettings());
        user.GameSettings = GameSettingsCatalog.Store(merged);
        _db.SaveChanges();
        return RedirectToPage("/Games/Settings", new { saved = true });
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        Display = GameSettingsCatalog.ToDisplay(GameSettingsCatalog.Load(u?.GameSettings));
    }

    private bool Chk(string name) =>
        Request.HasFormContentType && Request.Form[name].Any(v => v == "1" || v == "true" || v == "on");
}
