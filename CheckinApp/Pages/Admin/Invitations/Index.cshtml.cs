using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace CheckinApp.Pages.Admin.Invitations;

/// <summary>
/// 邀请码管理：本站不做开放注册，新人只能靠这里的码进来。
/// 一次性 + 有效期 + 可撤销，配合注册页的蜜罐/令牌/时长校验，构成「请柬制」入口。
/// </summary>
[Authorize(Policy = "perm:admin.users")]
public class IndexModel(AppDbContext db) : PageModel
{
    private readonly AppDbContext _db = db;

    public record InviteRow(int Id, string Code, string Note, string RoleName,
                            DateTime CreatedAt, DateTime ExpiresAt,
                            string Status, string StatusTone, string UsedBy);

    [BindProperty] public int Count { get; set; } = 1;
    [BindProperty] public string Note { get; set; } = "";
    [BindProperty] public int Days { get; set; } = 7;
    [BindProperty] public int RoleId { get; set; }

    public List<InviteRow> Rows { get; set; } = [];
    public List<Role> Roles { get; set; } = [];
    public string? Error { get; private set; }
    /// <summary>刚生成的码（TempData 跨一次重定向带过来，方便直接复制发给对方）</summary>
    public List<string> NewCodes { get; private set; } = [];

    public void OnGet()
    {
        Load();
    }

    public async Task<IActionResult> OnPostCreateAsync()
    {
        Load();

        if (Count < 1 || Count > 10) { Error = "一次最多生成 10 个。"; return Page(); }
        if (Days < 1 || Days > 90) { Error = "有效期请填 1–90 天。"; return Page(); }
        if (!_db.Roles.Any(r => r.Id == RoleId)) { Error = "请选择有效角色。"; return Page(); }

        var me = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var v) ? v : (int?)null;
        var codes = new List<string>();
        var now = DateTime.UtcNow;

        for (var i = 0; i < Count; i++)
        {
            var raw = RegistrationGuard.NewCode();
            _db.Invitations.Add(new Invitation
            {
                Code = raw,
                Note = (Note ?? "").Trim(),
                RoleId = RoleId,
                CreatedByUserId = me,
                CreatedAt = now,
                ExpiresAt = now.AddDays(Days),
            });
            codes.Add(RegistrationGuard.FormatCode(raw));
        }

        await _db.SaveChangesAsync();
        // 用换行拼接的单字符串走 TempData（Cookie 提供程序对「字符串数组」的往返类型不可靠）
        TempData["NewCodes"] = string.Join("\n", codes);
        TempData["Ok"] = $"已生成 {codes.Count} 个邀请码，{Days} 天内有效，每个只能用一次。";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostRevokeAsync(int id)
    {
        var inv = await _db.Invitations.FirstOrDefaultAsync(x => x.Id == id);
        if (inv is null) { TempData["Err"] = "邀请码不存在。"; return RedirectToPage(); }
        if (inv.UsedAt is not null) { TempData["Err"] = "这个码已经被用掉了，撤销也拦不住已注册的账号。"; return RedirectToPage(); }

        inv.Revoked = true;
        await _db.SaveChangesAsync();
        TempData["Ok"] = "已撤销，这个码不能再用了。";
        return RedirectToPage();
    }

    private void Load()
    {
        Roles = _db.Roles.OrderBy(r => r.Name).ToList();
        if (RoleId == 0)
            RoleId = Roles.FirstOrDefault(r => r.Name == "普通用户")?.Id ?? Roles.FirstOrDefault()?.Id ?? 0;

        var now = DateTime.UtcNow;
        Rows = _db.Invitations
            .Include(i => i.Role)
            .Include(i => i.UsedBy)
            .OrderByDescending(i => i.CreatedAt)
            .Take(100)
            .AsEnumerable()
            .Select(i =>
            {
                var (status, tone) = i.UsedAt is not null ? ("已使用", "ok")
                    : i.Revoked ? ("已撤销", "weak")
                    : i.ExpiresAt <= now ? ("已过期", "weak")
                    : ("可用", "warn");
                return new InviteRow(i.Id, RegistrationGuard.FormatCode(i.Code), i.Note,
                    i.Role?.Name ?? "-", i.CreatedAt, i.ExpiresAt, status, tone,
                    i.UsedBy?.Username ?? "");
            })
            .ToList();

        NewCodes = (TempData["NewCodes"] as string)?
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .ToList() ?? [];
    }
}
