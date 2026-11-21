using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Calculator;

/// <summary>数学计算器 —— 简单 / 科学 / 矩阵三模式，全部浏览器本地运算，不碰服务端。</summary>
[Authorize(Policy = "perm:calc.use")]
public class IndexModel : PageModel
{
    public void OnGet()
    {
    }
}
