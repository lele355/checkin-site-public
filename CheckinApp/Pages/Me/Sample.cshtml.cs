using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Me;

/// <summary>
/// 测试数据工具片段（dialog.app-modal 装载；生成/清除仍走 /Me?handler=Sample|ClearSample）。
/// </summary>
public class SampleModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    /// <summary>当前账号带「【测试】」标记的记录条数。</summary>
    public int SampleRows { get; private set; }

    public IActionResult OnGet()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        SampleRows = SampleData.Count(_db, uid);
        return Page();
    }
}
