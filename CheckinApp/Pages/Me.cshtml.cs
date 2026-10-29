using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Security;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace CheckinApp.Pages;

/// <summary>个人主页的数据概览格子（每格=一个模块的条数，点进去就是模块首页）。</summary>
public record MeStat(string Label, string Icon, string Url, int Count);

/// <summary>
/// 个人主页 —— 看的（头像/资料/加入时间/数据概览）+ 改的（昵称/邮箱/签名/密码）+ 测试数据开关。
/// 只允许改自己的资料；UserId 一律取当前登录身份，不接受表单传入（防越权改别人）。
/// </summary>
public class MeModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    // ---------- 资料编辑绑定 ----------
    [BindProperty] public string DisplayName { get; set; } = "";
    [BindProperty] public string Email { get; set; } = "";
    [BindProperty] public string Signature { get; set; } = "";

    // ---------- 改密码绑定 ----------
    [BindProperty] public string OldPassword { get; set; } = "";
    [BindProperty] public string NewPassword { get; set; } = "";
    [BindProperty] public string ConfirmPassword { get; set; } = "";

    // ---------- 展示用 ----------
    public User? Row { get; private set; }
    public string Username => Row?.Username ?? "";
    public string RoleName => Row?.Role?.Name ?? "-";
    public DateTime CreatedAt => Row is { } r ? SiteClock.ToLocal(r.CreatedAt) : DateTime.Now;
    public DateTime? LastLoginAt => Row?.LastLoginAt is DateTime t ? SiteClock.ToLocal(t) : null;
    public bool CanUsePeriod { get; private set; }
    public List<MeStat> Stats { get; private set; } = [];
    public int SampleRows { get; private set; }
    /// <summary>头像字：取显示名的第一个「字」（emoji/生僻字也不会被劈成半个）</summary>
    public string Avatar =>
        string.IsNullOrWhiteSpace(DisplayName) ? "我" : StringInfo.GetNextTextElement(DisplayName.Trim());

    public async Task<IActionResult> OnGetAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        Row = await _db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Id == uid);
        if (Row is null) return RedirectToPage("/Login");

        DisplayName = Row.DisplayName;
        Email = Row.Email;
        Signature = Row.Signature;

        CanUsePeriod = _me.Has("period.use");
        Stats = await BuildStatsAsync(uid);
        SampleRows = SampleData.Count(_db, uid);
        return Page();
    }

    /// <summary>保存资料：昵称（≤20）/ 邮箱（可空，形如 a@b.c）/ 个性签名（≤60）。</summary>
    public async Task<IActionResult> OnPostProfileAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        var row = await _db.Users.FirstOrDefaultAsync(u => u.Id == uid);
        if (row is null) return RedirectToPage("/Login");

        var name = (DisplayName ?? "").Trim();
        var mail = (Email ?? "").Trim();
        var sign = (Signature ?? "").Trim();

        if (name.Length == 0)
        {
            TempData["Err"] = "昵称不能为空。";
            return RedirectToPage();
        }
        if (name.Length > 20)
        {
            TempData["Err"] = "昵称最多 20 个字。";
            return RedirectToPage();
        }
        // 邮箱可以留空（不强留），填了就得像个邮箱：有 @、@ 两侧都不为空、不带空格
        if (mail.Length > 0)
        {
            var at = mail.IndexOf('@');
            if (mail.Length > 100 || at <= 0 || at == mail.Length - 1
                || mail.Any(char.IsWhiteSpace) || mail.IndexOf('@', at + 1) >= 0
                || !mail[(at + 1)..].Contains('.'))
            {
                TempData["Err"] = "邮箱格式看起来不对，示例：you@example.com（也可以留空）。";
                return RedirectToPage();
            }
        }
        if (sign.Length > 60)
        {
            TempData["Err"] = "个性签名最多 60 个字。";
            return RedirectToPage();
        }

        row.DisplayName = name;
        row.Email = mail;
        row.Signature = sign;
        await _db.SaveChangesAsync();

        TempData["Ok"] = "资料已保存。";
        return RedirectToPage();
    }

    /// <summary>改密码：校验旧密码 → 新密码强度 → 两次一致 → 不能与旧密码相同。</summary>
    public async Task<IActionResult> OnPostPasswordAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        var user = await _db.Users.FindAsync(uid);
        if (user is null) return RedirectToPage("/Login");

        if (!PasswordHasher.Verify(OldPassword, user.PasswordHash))
        {
            TempData["Err"] = "当前密码不正确。";
            return RedirectToPage();
        }
        if (NewPassword.Length < 8 || !NewPassword.Any(char.IsLetter) || !NewPassword.Any(char.IsDigit))
        {
            TempData["Err"] = "新密码至少 8 位，且须同时包含字母和数字。";
            return RedirectToPage();
        }
        if (NewPassword != ConfirmPassword)
        {
            TempData["Err"] = "两次输入的新密码不一致。";
            return RedirectToPage();
        }
        if (PasswordHasher.Verify(NewPassword, user.PasswordHash))
        {
            TempData["Err"] = "新密码不能与当前密码相同。";
            return RedirectToPage();
        }

        user.PasswordHash = PasswordHasher.Hash(NewPassword);
        await _db.SaveChangesAsync();
        TempData["Ok"] = "密码已更新，其它设备需要重新登录";
        return RedirectToPage();
    }

    /// <summary>一键生成测试数据（已有则跳过，不会重复堆）。</summary>
    public async Task<IActionResult> OnPostSampleAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        var added = SampleData.Seed(_db, uid, _me.Has("period.use"));
        TempData["Ok"] = added > 0
            ? $"已生成 {added} 条测试数据，全部带「{SampleData.Mark}」前缀，随时可一键清除。"
            : "已有测试数据，未重复生成（想重来请先清除）。";
        return RedirectToPage();
    }

    /// <summary>一键清除测试数据（只删带「【测试】」标记的行，真实数据不动）。</summary>
    public async Task<IActionResult> OnPostClearSampleAsync()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");

        var removed = SampleData.Remove(_db, uid);
        TempData["Ok"] = removed > 0
            ? $"已清除 {removed} 条测试数据。"
            : "没有找到测试数据。";
        return RedirectToPage();
    }

    /// <summary>数据概览：只统计当前用户有权限的模块（没权限的格子不出现，免得点进去被挡）。</summary>
    private async Task<List<MeStat>> BuildStatsAsync(int uid)
    {
        var list = new List<MeStat>();

        if (_me.Has("schedule.use"))
            list.Add(new("日程", "calendar", "/Schedule", await _db.Schedules.CountAsync(x => x.UserId == uid)));
        if (_me.Has("memo.use"))
            list.Add(new("备忘", "note", "/Memo", await _db.Memos.CountAsync(x => x.UserId == uid)));
        if (_me.Has("habits.use"))
            list.Add(new("打卡", "check", "/Habits", await _db.HabitCheckins.CountAsync(x => x.UserId == uid)));
        if (_me.Has("courses.use"))
            list.Add(new("课程", "grid", "/Courses", await _db.Courses.CountAsync(x => x.UserId == uid)));
        if (_me.Has("anniversary.use"))
            list.Add(new("纪念日", "heart", "/Anniversaries", await _db.Anniversaries.CountAsync(x => x.UserId == uid)));
        if (_me.Has("expense.use"))
            list.Add(new("记账", "wallet", "/Expenses", await _db.Expenses.CountAsync(x => x.UserId == uid)));
        if (_me.Has("board.use"))
            list.Add(new("留言", "chat", "/Board", await _db.BoardMessages.CountAsync(x => x.UserId == uid)));
        if (_me.Has("period.use"))
            list.Add(new("经期", "drop", "/Period", await _db.PeriodRecords.CountAsync(x => x.UserId == uid)));

        // 邮箱只统计「绑定了几个账号」，不播测试数据也没有内容语义，放进来总是 0，容易看成 bug —— 不放。
        return list;
    }
}
