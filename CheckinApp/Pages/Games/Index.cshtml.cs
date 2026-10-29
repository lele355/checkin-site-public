using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Games;

/// <summary>
/// 小游戏入口 —— 先是游戏列表 + 游戏总设置，点进某个游戏再开房间 / 玩 / 调它的杂项设置。
///
/// 列表直接读 <see cref="GameCatalog"/>：加第二种游戏只要在那儿登记一条，
/// 这里会自动多出一张卡，页面本身不用改。
/// </summary>
[Authorize(Policy = "perm:games.use")]
public class IndexModel : PageModel
{
    public GameCatalog.GameInfo[] Games => GameCatalog.All;

    public void OnGet() { }
}
