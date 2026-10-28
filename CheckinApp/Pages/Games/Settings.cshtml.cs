using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>
/// 小游戏设置。存的是**我新建房间时的默认值** ——
/// 已经开打的局不会因为这里改了而中途变形（规则在建房那刻就快照进房间了）。
///
/// 表单读值走 <see cref="Request"/> 的 Form 而不是方法参数：
/// 开关型字段用「勾上才提交」的原生 checkbox，比给每个 bool 配 hidden 默认值更好读，
/// 也不用担心同名字段提交两次时的绑定顺序。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class SettingsModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public GameSettings Settings { get; private set; } = GameSettingsCatalog.Defaults;

    public bool Saved { get; private set; }
    public string? Ok { get; private set; }
    public string? Err { get; private set; }

    public static int[] Sizes => GomokuRules.AllowedSizes;
    public static int[] MoveOptions => GameSettingsCatalog.MoveTimeoutOptions;
    public static int[] TotalOptions => GameSettingsCatalog.TotalTimeoutOptions;

    public void OnGet(bool saved = false)
    {
        Load();
        if (saved)
        {
            Saved = true;
            Ok = "已保存。新建对局会按这套设置来。";
        }
    }

    public IActionResult OnPostSave()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) { Err = "账号不存在"; Load(); return Page(); }

        var s = new GameSettings
        {
            Size = Int("size", GomokuRules.DefaultSize),
            Forbidden = Chk("forbidden"),
            TapConfirm = Chk("tapConfirm"),
            ShowCoord = Chk("showCoord"),
            LastMark = Chk("lastMark"),
            Vibrate = Chk("vibrate"),
            MoveTimeoutSec = Int("moveTimeoutSec", 0),
            TotalTimeoutSec = Int("totalTimeoutSec", 0),
        };
        user.GameSettings = GameSettingsCatalog.Store(s);
        _db.SaveChanges();
        return RedirectToPage("/Games/Settings", new { saved = true });
    }

    /// <summary>恢复默认 = 清空这个字段（空 = 从没改过 = 用代码里的默认值）</summary>
    public IActionResult OnPostReset()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var user = _db.Users.FirstOrDefault(x => x.Id == uid);
        if (user is null) return RedirectToPage("/Login");
        user.GameSettings = "";
        _db.SaveChanges();
        return RedirectToPage("/Games/Settings", new { saved = true });
    }

    private void Load()
    {
        if (_me.UserId is not int uid) return;
        var u = _db.Users.FirstOrDefault(x => x.Id == uid);
        Settings = GameSettingsCatalog.Load(u?.GameSettings);
    }

    private bool Chk(string name) =>
        Request.HasFormContentType && Request.Form[name].Any(v => v == "1" || v == "true" || v == "on");

    private int Int(string name, int fallback) =>
        int.TryParse(Request.Form[name].FirstOrDefault(), out var v) ? v : fallback;
}
