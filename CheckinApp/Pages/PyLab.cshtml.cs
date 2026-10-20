using System.Text.Json.Nodes;
using CheckinApp.Data;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages;

/// <summary>
/// PyLab：《Python 程序设计》简易线上教学平台（实验八 大作业二）的网页入口。
///
/// 分工（2026-10-20 调整）：
///   · ③ 内嵌代码片段、④ 拓展应用 —— 仍由 Python 执行（tools/pylab/main.py）。
///     代码沙箱是这套东西里唯一真正需要 Python 的部分，也是它最有价值的地方。
///   · ① 课堂点名、② 课件播放 —— 改在 C# 侧做，因为两者都要**持久化**
///     （名单、考勤、上传的课件），而 Python 那份是无状态的命令行程序。
///     控制台版 main.py 依旧完整实现四个功能，交作业时跑它就行。
///
/// 本类拆成三个 partial 文件，避免一个文件几千行：
///   · PyLab.cshtml.cs        —— 页面本体 + Python 桥转发
///   · PyLab.Roster.cs        —— 名单导入、点名、考勤
///   · PyLab.Deck.cs          —— 课件上传、分类、逐页图片
///
/// 拆除方式：删掉 Pages/PyLab*、Services/PyLab*、Models/Entities.cs 里的 PyLab* 五个类、
/// AppDbContext 里对应的两段、data/pylab 目录、一份迁移，再撤销 NavCatalog /
/// PermissionCatalog 里的几行配置即可。
/// </summary>
[Authorize(Policy = "perm:pylab.use")]
// 上传课件是 multipart，默认 30MB 的请求体上限会把稍大的 ppt 挡在门外（连 413 都来不及提示）。
// 这个特性只能挂在 PageModel 上，挂 handler 上无效（MVC1001）。
[RequestSizeLimit(80_000_000)]
public partial class PyLabModel : PageModel
{
    private readonly PyLabBridge _bridge;
    private readonly AppDbContext _db;
    private readonly CurrentUser _me;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger _log;
    private readonly PyLabDeckConverter _conv;

    public PyLabModel(
        AppDbContext db, CurrentUser me, IWebHostEnvironment env,
        IConfiguration cfg, ILogger<PyLabBridge> log, ILoggerFactory lf)
    {
        _db = db;
        _me = me;
        _env = env;
        _log = log;
        _bridge = new PyLabBridge(log, cfg);
        _conv = new PyLabDeckConverter(lf.CreateLogger<PyLabDeckConverter>(), cfg);
    }

    public bool Enabled => _bridge.Enabled;
    public string StatusText => _bridge.StatusText;

    /// <summary>当前登录用户 id；理论上一定存在（页面要求登录），拿不到时按未授权处理。</summary>
    private int? Uid => _me.UserId;

    public void OnGet() { }

    /// <summary>
    /// Python 桥的统一入口：POST /PyLab?handler=Call
    /// body = {"action":"snippet","payload":{"state":{...},"id":"s03_loop"}}
    /// 返回值原样透传 Python 的 JSON（ok / error / data / elapsedMs）。
    /// </summary>
    public async Task<IActionResult> OnPostCallAsync(
        [FromBody] PyLabRequest? body, CancellationToken ct)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.Action))
            return new JsonResult(new JsonObject { ["ok"] = false, ["error"] = "缺少 action" });

        var result = await _bridge.CallAsync(body.Action, body.Payload, ct);
        return new JsonResult(result);
    }

    public sealed record PyLabRequest(string Action, JsonObject? Payload);

    // ───────────────────────────────────────────────────────────────
    //  统一的返回格式：{ ok, data } / { ok:false, error }
    // ───────────────────────────────────────────────────────────────

    private IActionResult JsonOk(object? data = null)
        => new JsonResult(new { ok = true, data });

    private IActionResult JsonErr(string message)
        => new JsonResult(new { ok = false, error = message });

    /// <summary>课件仓库根目录：data/pylab/{userId}/ —— 故意放在 wwwroot 外面，
    /// 图片一律走处理器鉴权后再吐，不能靠静态文件直接下载别人的课件。</summary>
    private string UserDataRoot(int uid)
        => Path.Combine(_env.ContentRootPath, "data", "pylab", uid.ToString());

    private string DeckDir(int uid, int deckId)
        => Path.Combine(UserDataRoot(uid), "deck_" + deckId);
}
