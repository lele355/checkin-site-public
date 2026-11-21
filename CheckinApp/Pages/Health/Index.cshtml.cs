using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CheckinApp.Pages.Health;

/// <summary>
/// 健康数据（网页最小版）：绑定列表 / 今日汇总 / 手动同步 / QR 绑定。
/// App 是主端（0.4），这里够用就行；数据直读 SQLite，同步动作走 HealthSyncService。
/// </summary>
[Authorize(Policy = "perm:health.use")]
public class IndexModel(AppDbContext db, CurrentUser me, HealthSyncService sync, IHttpClientFactory httpFactory, IOptions<HealthOptions> opt) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly HealthSyncService _sync = sync;
    private readonly IHttpClientFactory _httpFactory = httpFactory;
    private readonly HealthOptions _opt = opt.Value;

    public List<HealthBinding> Bindings { get; private set; } = [];
    public List<HealthDaily> Today { get; private set; } = [];
    public string? Note { get; private set; }
    /// <summary>发起绑定后要展示的二维码（base64 PNG）</summary>
    public string? QrPng { get; private set; }
    public int QrBindingId { get; private set; }

    public async Task OnGetAsync(string? note, CancellationToken ct)
    {
        Note = note;
        if (_me.UserId is not int uid) return;
        Bindings = await _db.HealthBindings.Where(b => b.UserId == uid).OrderBy(b => b.Id).ToListAsync(ct);
        Today = await _db.HealthDailies.AsNoTracking()
            .Where(d => d.UserId == uid && d.Date == DateTime.Today)
            .OrderBy(d => d.BindingId).ToListAsync(ct);
    }

    public async Task<IActionResult> OnPostSyncAsync(CancellationToken ct)
    {
        if (_me.UserId is not int uid) return RedirectToPage();
        var results = await _sync.SyncAllAsync(uid, forceLookback: true, ct);
        var okCount = results.Count;
        return RedirectToPage(new { note = $"已同步 {okCount} 个绑定" });
    }

    /// <summary>发起 QR 绑定（调 bridge，复用 API 同款链路）</summary>
    public async Task<IActionResult> OnPostStartBindAsync(CancellationToken ct)
    {
        if (_me.UserId is not int uid) return RedirectToPage();
        var http = _httpFactory.CreateClient("health-bridge");
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_opt.BridgeBaseUrl.TrimEnd('/')}/api/bindings/qr/start");
        if (_opt.BridgeToken.Length > 0) req.Headers.Authorization = new("Bearer", _opt.BridgeToken);
        using var resp = await http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            return RedirectToPage(new { note = "二维码服务暂不可用" });
        using var doc = System.Text.Json.JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var d = doc.RootElement;
        var binding = new HealthBinding
        {
            UserId = uid,
            BridgeBindingKey = d.GetProperty("binding_id").GetString() ?? "",
            DisplayName = "新的绑定",
            Status = "pending",
        };
        _db.HealthBindings.Add(binding);
        await _db.SaveChangesAsync(ct);

        QrPng = d.GetProperty("qr_png").GetString();
        QrBindingId = binding.Id;
        Bindings = await _db.HealthBindings.Where(b => b.UserId == uid).OrderBy(b => b.Id).ToListAsync(ct);
        Today = await _db.HealthDailies.AsNoTracking()
            .Where(x => x.UserId == uid && x.Date == DateTime.Today).OrderBy(x => x.BindingId).ToListAsync(ct);
        return Page();
    }

    public async Task<IActionResult> OnPostUnbindAsync(int id, CancellationToken ct)
    {
        if (_me.UserId is not int uid) return RedirectToPage();
        var b = await _db.HealthBindings.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct);
        if (b is null) return RedirectToPage();
        _db.HealthBindings.Remove(b);
        await _db.SaveChangesAsync(ct);
        try
        {
            var http = _httpFactory.CreateClient("health-bridge");
            using var req = new HttpRequestMessage(HttpMethod.Delete,
                $"{_opt.BridgeBaseUrl.TrimEnd('/')}/api/bindings/{Uri.EscapeDataString(b.BridgeBindingKey)}");
            if (_opt.BridgeToken.Length > 0) req.Headers.Authorization = new("Bearer", _opt.BridgeToken);
            await http.SendAsync(req, ct);
        }
        catch { /* bridge 不可达也先把本地删干净 */ }
        return RedirectToPage(new { note = "已解绑" });
    }
}
