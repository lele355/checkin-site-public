using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

[Authorize(Policy = "perm:workbench.view")]
public class DownloadModel : PageModel
{
    private readonly IConfiguration _cfg;
    private readonly IWebHostEnvironment _env;

    public DownloadModel(IConfiguration cfg, IWebHostEnvironment env)
    {
        _cfg = cfg;
        _env = env;
    }

    public string Version { get; private set; } = "1.0";
    public string Notes { get; private set; } = "";
    public string ApkUrl { get; private set; } = "/download/app-release.apk";
    public bool ApkExists { get; private set; }
    public string SizeText { get; private set; } = "-";
    public string UpdatedText { get; private set; } = "-";

    public void OnGet()
    {
        Version = _cfg["App:ClientVersion"] ?? "1.0";
        Notes = _cfg["App:ClientNotes"] ?? "安卓客户端（远程加载网页的壳）";
        ApkUrl = _cfg["App:ClientApk"] ?? "/download/app-release.apk";

        var file = _env.WebRootFileProvider.GetFileInfo(ApkUrl.TrimStart('~'));
        ApkExists = file.Exists && file.Length > 0;
        if (ApkExists)
        {
            SizeText = $"{file.Length / 1024d / 1024d:F1} MB";
            UpdatedText = file.LastModified.LocalDateTime.ToString("yyyy-MM-dd HH:mm");
        }
    }
}
