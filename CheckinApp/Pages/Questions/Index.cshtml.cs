using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Questions;

/// <summary>
/// 互相提问 —— 情侣大类（2026-11-02 站主规划）：双方互问互答。
/// 页面管理：未答/已答筛选 + 分页 + 按月归档（控条数）。双方可见。
/// </summary>
[Authorize(Policy = "perm:couples.view")]
public class IndexModel(AppDbContext db, CurrentUser me, CoupleScope couple) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;
    private readonly CoupleScope _couple = couple;

    public record QView(int Id, string From, int FromId, string To, int ToId, string Content, string? Answer, string AskedAt, string? AnsweredAt, bool MineToAnswer);

    public List<QView> Items { get; private set; } = [];
    public int Total { get; private set; }
    public int Page { get; private set; } = 1;
    public int Pages { get; private set; } = 1;
    public int Unanswered { get; private set; }
    public string Status { get; private set; } = "all";
    public string? Month { get; private set; }
    public int MyUid { get; private set; }

    [BindProperty] public string AskContent { get; set; } = "";
    [BindProperty] public string AnswerContent { get; set; } = "";
    [BindProperty] public int AnswerId { get; set; }
    public string? Error { get; private set; }

    public void OnGet(string? status, string? month, int page = 1)
    {
        if (_me.UserId is not int uid) return;
        MyUid = uid;
        Status = status ?? "all";
        Month = month;
        Page = page;

        var uids = _couple.MemberUids();
        var q = _db.CoupleQuestions.Where(x => uids.Contains(x.FromUserId) && uids.Contains(x.ToUserId));
        if (Status == "unanswered") q = q.Where(x => x.Answer == null);
        else if (Status == "answered") q = q.Where(x => x.Answer != null);
        if (!string.IsNullOrWhiteSpace(Month) && DateTime.TryParse(Month + "-01", out var m))
            q = q.Where(x => x.CreatedAt >= m && x.CreatedAt < m.AddMonths(1));

        Total = q.Count();
        Pages = Math.Max(1, (Total + 19) / 20);
        Page = Math.Clamp(Page, 1, Pages);

        var names = _db.Users.Where(u => uids.Contains(u.Id)).ToDictionary(u => u.Id, u => u.DisplayName);
        Items = q.OrderByDescending(x => x.CreatedAt)
            .Skip((Page - 1) * 20).Take(20).ToList()
            .Select(x => new QView(
                x.Id,
                names.GetValueOrDefault(x.FromUserId, "?"), x.FromUserId,
                names.GetValueOrDefault(x.ToUserId, "?"), x.ToUserId,
                x.Content, x.Answer,
                x.CreatedAt.AddHours(8).ToString("MM-dd HH:mm"),
                x.AnsweredAt?.AddHours(8).ToString("MM-dd HH:mm"),
                x.ToUserId == uid && x.Answer == null))
            .ToList();
        Unanswered = _db.CoupleQuestions.Count(x => uids.Contains(x.FromUserId) && uids.Contains(x.ToUserId) && x.Answer == null);
    }

    public IActionResult OnPostAsk()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(AskContent)) { Error = "问题不能为空。"; OnGet(Status, Month, Page); return Page(); }
        var to = _couple.PartnerUid();
        if (to is null) { Error = "还没有对方。"; OnGet(Status, Month, Page); return Page(); }
        _db.CoupleQuestions.Add(new CoupleQuestion
        {
            FromUserId = uid,
            ToUserId = to.Value,
            Content = AskContent.Trim(),
            CreatedAt = DateTime.UtcNow,
        });
        _db.SaveChanges();
        return RedirectToPage(new { status = Status, month = Month, page = Page });
    }

    public IActionResult OnPostAnswer()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(AnswerContent)) return RedirectToPage(new { status = Status, month = Month, page = Page });
        var r = _db.CoupleQuestions.FirstOrDefault(x => x.Id == AnswerId && x.ToUserId == uid);
        if (r is not null)
        {
            r.Answer = AnswerContent.Trim();
            r.AnsweredAt = DateTime.UtcNow;
            _db.SaveChanges();
        }
        return RedirectToPage(new { status = Status, month = Month, page = Page });
    }

    public IActionResult OnPostDelete(int id)
    {
        var uids = _couple.MemberUids();
        var r = _db.CoupleQuestions.FirstOrDefault(x => x.Id == id && uids.Contains(x.FromUserId));
        if (r is not null) { _db.CoupleQuestions.Remove(r); _db.SaveChanges(); }
        return RedirectToPage(new { status = Status, month = Month, page = Page });
    }
}
