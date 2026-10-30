using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>通用教程页 —— 从 GameTutorials 取正文，双端同源。</summary>
[Authorize(Policy = "perm:games.use")]
public class RulesModel : PageModel
{
    public string GameKey { get; private set; } = "";
    public string GameName { get; private set; } = "";
    public bool IsSolo { get; private set; }
    public List<GameTutorials.Section> Sections { get; private set; } = [];

    public IActionResult OnGet(string gameKey)
    {
        var key = GameCatalog.Require(gameKey);
        GameKey = key;
        GameName = GameCatalog.Find(key)?.Name ?? key;
        IsSolo = GameCatalog.Find(key)?.Solo == true;
        Sections = GameTutorials.Get(key) ?? [];
        return Page();
    }
}
