using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages.Board;

[Authorize(Policy = "perm:board.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    public List<BoardMessage> Messages { get; set; } = [];
    [BindProperty] public string Body { get; set; } = "";
    public string? Error { get; private set; }

    public void OnGet()
    {
        Messages = _db.BoardMessages.Include(m => m.User)
            .OrderByDescending(m => m.CreatedAt)
            .Take(100)
            .ToList();
    }

    public IActionResult OnPost()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (string.IsNullOrWhiteSpace(Body))
        { Error = "留言内容不能为空。"; OnGet(); return Page(); }

        _db.BoardMessages.Add(new BoardMessage
        {
            UserId = uid,
            Content = Body.Trim(),
            CreatedAt = DateTime.UtcNow
        });
        _db.SaveChanges();
        return RedirectToPage();
    }

    public IActionResult OnPostDelete(int id)
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        // 只能删自己的；有 board.moderate（管理员）可删任意
        var m = _db.BoardMessages.FirstOrDefault(x => x.Id == id);
        if (m is null) return NotFound();
        if (m.UserId != uid && !_me.Has("board.moderate")) return Forbid();
        _db.BoardMessages.Remove(m);
        _db.SaveChanges();
        return RedirectToPage();
    }
}
