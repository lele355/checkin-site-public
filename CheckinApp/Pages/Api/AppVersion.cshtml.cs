using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Api;

/// <summary>
/// 客户端版本信息：安卓壳启动时拉一次，比自己 web 端的 versionCode 大就提示升级。
/// 故意放在 /api/ 下，方便 nginx 单独放行 / 缓存。
/// </summary>
[AllowAnonymous]
public class AppVersionModel : PageModel
{
    private readonly IConfiguration _cfg;

    public AppVersionModel(IConfiguration cfg) => _cfg = cfg;

    public IActionResult OnGet()
    {
        var apk = _cfg["App:ClientApk"] ?? "/download/app-release.apk";
        var url = apk.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? apk
            : (_cfg["App:PublicUrl"] ?? "").TrimEnd('/') + apk;

        return new JsonResult(new
        {
            // 固定字段名，别改成 PascalCase——客户端按小写读
            version = _cfg["App:ClientVersion"] ?? "1.0.0",
            versionCode = int.TryParse(_cfg["App:ClientVersionCode"], out var c) ? c : 1,
            notes = _cfg["App:ClientNotes"] ?? "",
            url,
            minSupported = int.TryParse(_cfg["App:ClientMinCode"], out var m) ? m : 1
        });
    }
}
