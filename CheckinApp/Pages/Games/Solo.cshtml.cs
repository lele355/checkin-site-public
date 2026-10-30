using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>
/// 单机游戏页 —— 纯前端玩法 + 记分接口，不进 GameRooms。
/// URL：/Games/{gameKey}/Solo（fish / melon）。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class SoloModel : PageModel
{
    public string GameKey { get; private set; } = "";
    public string GameName { get; private set; } = "";
    public int MaxScore { get; private set; }

    public IActionResult OnGet(string gameKey)
    {
        var key = GameCatalog.Require(gameKey);
        var info = GameCatalog.Find(key);
        if (info is not { Solo: true }) return RedirectToPage("/Games");
        GameKey = key;
        GameName = info.Name;
        MaxScore = info.MaxScore;
        return Page();
    }
}
