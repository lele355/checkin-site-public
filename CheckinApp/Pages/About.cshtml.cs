using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

[AllowAnonymous]
public class AboutModel : PageModel
{
    private readonly IConfiguration _cfg;

    public AboutModel(IConfiguration cfg) => _cfg = cfg;

    public string Version { get; private set; } = "1.0.0";
    public int VersionCode { get; private set; }

    /// <summary>App 备案号（如 京ICP备00000000号-1A）。未拿到前为空，页面显示「办理中」，
    /// 绝不能先写一个还没批下来的号——那是虚假备案信息。</summary>
    public string AppBeiAn { get; private set; } = "";

    public void OnGet()
    {
        Version = _cfg["App:ClientVersion"] ?? "1.0";
        VersionCode = int.TryParse(_cfg["App:ClientVersionCode"], out var c) ? c : 1;
        AppBeiAn = (_cfg["App:AppBeiAn"] ?? "").Trim();
    }
}
