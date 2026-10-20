using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages;

/// <summary>
/// ② 课件库 + 播放器（C# 侧）。
///
/// 上传的 ppt 先落到 data/pylab/{uid}/deck_{id}/，再交给 PyLabDeckConverter 渲染成
/// p1.png…pN.png。播放 = 换图，页码就是硬坐标，所以「第 N 页挂哪个代码片段」
/// 可以直接存成 (DeckId, PageNo) → SnippetId，功能③ 因此比外部播放器方案更靠谱。
///
/// 图片不存在 wwwroot 里：课件是本班的东西，不能让拿到 URL 的任何人直接下，
/// 一律走 Image 处理器验一遍归属再吐。
/// </summary>
public partial class PyLabModel
{
    private static readonly string[] DeckExts = [".ppt", ".pptx", ".pps", ".ppsx"];

    /// <summary>单份课件上限。60MB 大概是一百多页带图的课件，够用了。</summary>
    private const long MaxDeckBytes = 60L * 1024 * 1024;

    // ───────────────────────────────────────────────────────────────
    //  列表
    // ───────────────────────────────────────────────────────────────

    /// <summary>GET /PyLab?handler=Decks —— 分类 + 课件 + 页码挂载表 + 本机可用引擎。</summary>
    public IActionResult OnGetDecks()
    {
        if (Uid is not int uid) return JsonErr("请先登录");

        var cats = _db.PyLabDeckCategories.Where(c => c.UserId == uid)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Id)
            .Select(c => new { c.Id, c.Name })
            .ToList();

        var decks = _db.PyLabDecks.Where(d => d.UserId == uid)
            .OrderByDescending(d => d.CreatedAt).ThenByDescending(d => d.Id)
            .Select(d => new
            {
                d.Id,
                d.Title,
                d.CategoryId,
                d.PageCount,
                d.Status,
                d.Error,
                d.SizeBytes,
                d.Engine,
                d.OriginalFileName,
                d.CreatedAt,
            })
            .ToList();

        // 页码 → 片段（整个用户一次取回，前端翻页时零请求；一个班几十份课件也就几十条）
        var maps = _db.PyLabDeckSnippets
            .Where(s => _db.PyLabDecks.Any(d => d.Id == s.DeckId && d.UserId == uid))
            .Select(s => new { s.DeckId, s.PageNo, s.SnippetId })
            .ToList();

        var catName = cats.ToDictionary(c => c.Id, c => c.Name);
        var (ppt, lo) = _conv.Engines();

        // 有没有 PDF 决定播放器给不给「矢量模式」开关：老课件（这份功能之前转的）只有 PNG，
        // 直接看目录里 deck.pdf 在不在，不额外加库字段 —— 文件才是唯一事实。
        var pdfs = new HashSet<int>();
        var pdfMb = new Dictionary<int, double>();
        foreach (var d in decks)
        {
            var p = Path.Combine(DeckDir(uid, d.Id), PyLabDeckConverter.PdfName);
            var fi = new FileInfo(p);
            if (!fi.Exists) continue;
            pdfs.Add(d.Id);
            pdfMb[d.Id] = Math.Round(fi.Length / 1024.0 / 1024.0, 1);
        }

        return JsonOk(new
        {
            categories = cats.Select(c => new
            {
                c.Id,
                c.Name,
                count = decks.Count(d => d.CategoryId == c.Id),
            }),
            decks = decks.Select(d => new
            {
                d.Id,
                d.Title,
                d.CategoryId,
                categoryName = d.CategoryId is int cid && catName.TryGetValue(cid, out var n) ? n : "",
                d.PageCount,
                d.Status,
                d.Error,
                sizeMb = Math.Round(d.SizeBytes / 1024.0 / 1024.0, 1),
                d.Engine,
                hasPdf = pdfs.Contains(d.Id),
                pdfMb = pdfMb.TryGetValue(d.Id, out var mb) ? mb : 0,
                d.OriginalFileName,
                createdAt = d.CreatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm"),
                snippets = maps.Where(m => m.DeckId == d.Id).ToDictionary(m => m.PageNo.ToString(), m => m.SnippetId),
            }),
            engines = new { powerpoint = ppt, libreoffice = lo },
            uncategorizedCount = decks.Count(d => d.CategoryId is null),
            total = decks.Count,
        });
    }

    // ───────────────────────────────────────────────────────────────
    //  上传 + 转换
    // ───────────────────────────────────────────────────────────────

    public async Task<IActionResult> OnPostUploadAsync(
        IFormFile? file, string? title, int? categoryId, CancellationToken ct)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        if (file is null || file.Length == 0) return JsonErr("没有选文件。");
        if (file.Length > MaxDeckBytes) return JsonErr($"课件超过 {MaxDeckBytes / 1024 / 1024}MB，换个小一点的版本吧。");

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!DeckExts.Contains(ext))
            return JsonErr("只支持 .ppt / .pptx / .pps / .ppsx。（.pdf 请用「幻灯片另存为图片」后再传）");

        // 分类归属校验：不能把课件塞进别人的分类里
        if (categoryId is int cid && !_db.PyLabDeckCategories.Any(c => c.Id == cid && c.UserId == uid))
            categoryId = null;

        var cleanTitle = (title ?? "").Trim();
        if (cleanTitle.Length == 0) cleanTitle = Path.GetFileNameWithoutExtension(file.FileName);
        if (cleanTitle.Length > 80) cleanTitle = cleanTitle[..80];

        var deck = new PyLabDeck
        {
            UserId = uid,
            Title = cleanTitle,
            CategoryId = categoryId,
            OriginalFileName = Path.GetFileName(file.FileName),
            SizeBytes = file.Length,
            Status = "pending",
        };
        _db.PyLabDecks.Add(deck);
        _db.SaveChanges();       // 先落库拿到 Id，目录名才能对上

        var dir = DeckDir(uid, deck.Id);
        Directory.CreateDirectory(dir);
        var source = Path.Combine(dir, "source" + ext);

        try
        {
            await using (var fs = System.IO.File.Create(source))
                await file.CopyToAsync(fs, ct);

            var r = await _conv.ConvertAsync(source, dir, ct);
            deck.Status = r.Ok ? "ready" : "failed";
            deck.PageCount = r.PageCount;
            deck.Engine = r.Engine;
            deck.Error = r.Error;
            deck.UpdatedAt = DateTime.UtcNow;
            _db.SaveChanges();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "PyLab 课件上传/转换失败");
            deck.Status = "failed";
            deck.Error = ex.Message;
            deck.UpdatedAt = DateTime.UtcNow;
            _db.SaveChanges();
        }

        return JsonOk(new
        {
            id = deck.Id,
            title = deck.Title,
            status = deck.Status,
            pageCount = deck.PageCount,
            engine = deck.Engine,
            error = deck.Error,
            hasPdf = System.IO.File.Exists(Path.Combine(DeckDir(uid, deck.Id), PyLabDeckConverter.PdfName)),
        });
    }

    /// <summary>重新转换（换了引擎、或第一次被 PowerPoint 弹窗卡住时用）。</summary>
    public async Task<IActionResult> OnPostDeckRetryAsync(int id, CancellationToken ct)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var deck = _db.PyLabDecks.FirstOrDefault(d => d.Id == id && d.UserId == uid);
        if (deck is null) return JsonErr("课件不存在。");

        var dir = DeckDir(uid, id);
        var source = Directory.Exists(dir)
            ? Directory.GetFiles(dir, "source.*").FirstOrDefault()
            : null;
        if (source is null) return JsonErr("原始文件已经不在了，只能重新上传。");

        var r = await _conv.ConvertAsync(source, dir, ct);
        deck.Status = r.Ok ? "ready" : "failed";
        deck.PageCount = r.PageCount;
        deck.Engine = r.Engine;
        deck.Error = r.Error;
        deck.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();

        return JsonOk(new
        {
            status = deck.Status,
            pageCount = deck.PageCount,
            engine = deck.Engine,
            error = deck.Error,
            hasPdf = System.IO.File.Exists(Path.Combine(dir, PyLabDeckConverter.PdfName)),
        });
    }

    // ───────────────────────────────────────────────────────────────
    //  改名 / 分类 / 删除
    // ───────────────────────────────────────────────────────────────

    public IActionResult OnPostDeckSave(int id, string? title, int? categoryId)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var deck = _db.PyLabDecks.FirstOrDefault(d => d.Id == id && d.UserId == uid);
        if (deck is null) return JsonErr("课件不存在。");

        var t = (title ?? "").Trim();
        if (t.Length > 0) deck.Title = t.Length > 80 ? t[..80] : t;
        if (categoryId is int cid && !_db.PyLabDeckCategories.Any(c => c.Id == cid && c.UserId == uid))
            return JsonErr("分类不存在。");
        deck.CategoryId = categoryId;
        deck.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return JsonOk();
    }

    public IActionResult OnPostDeckDelete(int id)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var deck = _db.PyLabDecks.FirstOrDefault(d => d.Id == id && d.UserId == uid);
        if (deck is null) return JsonErr("课件不存在。");

        _db.PyLabDecks.Remove(deck);       // 页码映射随级联删除
        _db.SaveChanges();

        // 先删库再删文件：删文件失败最多留点垃圾，反过来会留下「打不开的课件」
        try
        {
            var dir = DeckDir(uid, id);
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "PyLab 删除课件目录失败 deck={Id}", id);
        }
        return JsonOk();
    }

    public IActionResult OnPostCatAdd(string? name)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var n = (name ?? "").Trim();
        if (n.Length is 0 or > 30) return JsonErr("分类名不能为空，且不超过 30 个字。");
        if (_db.PyLabDeckCategories.Any(c => c.UserId == uid && c.Name == n))
            return JsonErr("已经有同名分类了。");

        var order = (_db.PyLabDeckCategories.Where(c => c.UserId == uid).Max(c => (int?)c.SortOrder) ?? 0) + 1;
        var cat = new PyLabDeckCategory { UserId = uid, Name = n, SortOrder = order };
        _db.PyLabDeckCategories.Add(cat);
        _db.SaveChanges();
        return JsonOk(new { id = cat.Id, name = cat.Name });
    }

    public IActionResult OnPostCatRename(int id, string? name)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var n = (name ?? "").Trim();
        if (n.Length is 0 or > 30) return JsonErr("分类名不能为空，且不超过 30 个字。");
        var cat = _db.PyLabDeckCategories.FirstOrDefault(c => c.Id == id && c.UserId == uid);
        if (cat is null) return JsonErr("分类不存在。");
        if (_db.PyLabDeckCategories.Any(c => c.UserId == uid && c.Name == n && c.Id != id))
            return JsonErr("已经有同名分类了。");
        cat.Name = n;
        _db.SaveChanges();
        return JsonOk();
    }

    /// <summary>删分类 —— 课件不删，自动回到「未分类」（OnDelete SetNull）。</summary>
    public IActionResult OnPostCatDelete(int id)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var cat = _db.PyLabDeckCategories.FirstOrDefault(c => c.Id == id && c.UserId == uid);
        if (cat is null) return JsonErr("分类不存在。");
        _db.PyLabDeckCategories.Remove(cat);
        _db.SaveChanges();
        return JsonOk();
    }

    // ───────────────────────────────────────────────────────────────
    //  页码 → 代码片段
    // ───────────────────────────────────────────────────────────────

    /// <summary>POST /PyLab?handler=PageSnippet —— snippetId 传空表示取消这一页的挂载。</summary>
    public IActionResult OnPostPageSnippet(int deckId, int pageNo, string? snippetId)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var deck = _db.PyLabDecks.FirstOrDefault(d => d.Id == deckId && d.UserId == uid);
        if (deck is null) return JsonErr("课件不存在。");
        if (pageNo < 1 || pageNo > Math.Max(deck.PageCount, 1)) return JsonErr("页码超出范围。");

        var existed = _db.PyLabDeckSnippets.FirstOrDefault(s => s.DeckId == deckId && s.PageNo == pageNo);
        var sid = (snippetId ?? "").Trim();

        if (sid.Length == 0)
        {
            if (existed is not null) { _db.PyLabDeckSnippets.Remove(existed); _db.SaveChanges(); }
            return JsonOk();
        }
        if (sid.Length > 40) return JsonErr("片段 id 不合法。");

        if (existed is null)
            _db.PyLabDeckSnippets.Add(new PyLabDeckSnippet { DeckId = deckId, PageNo = pageNo, SnippetId = sid });
        else
            existed.SnippetId = sid;
        _db.SaveChanges();
        return JsonOk();
    }

    // ───────────────────────────────────────────────────────────────
    //  图片
    // ───────────────────────────────────────────────────────────────

    /// <summary>
    /// GET /PyLab?handler=Image&amp;deckId=3&amp;pageNo=2 —— 鉴权后吐 PNG。
    /// 参数名不能叫 page：那是 Razor Pages 的保留路由键（会被塞成 "/PyLab"），
    /// 绑定到 int 上直接变成 0，查任何页都 404。
    ///
    /// thumb=1 时返回 320px 小图（底部页码条用）：全尺寸 1600×900 单张约 1.2MB，
    /// 十几张缩略图就是十几 MB，会把整条带宽吃干净，正文和 PDF 全排在后面。
    /// 老课件没有 t*.png 时自动退回大图，行为与以前一致。
    /// </summary>
    public IActionResult OnGetImage(int deckId, int pageNo, int thumb = 0)
    {
        if (Uid is not int uid) return NotFound();
        var deck = _db.PyLabDecks.FirstOrDefault(d => d.Id == deckId && d.UserId == uid);
        if (deck is null || deck.Status != "ready") return NotFound();
        if (pageNo < 1 || pageNo > deck.PageCount) return NotFound();

        var dir = DeckDir(uid, deckId);
        var path = Path.Combine(dir, $"p{pageNo}.png");
        if (thumb == 1)
        {
            var t = Path.Combine(dir, PyLabDeckConverter.ThumbName(pageNo));
            if (System.IO.File.Exists(t)) path = t;
        }
        if (!System.IO.File.Exists(path)) return NotFound();

        // 课件内容不变，图片地址里又带页码 → 让浏览器放心缓存，翻回上一页是零延迟的
        Response.Headers.CacheControl = "private, max-age=86400";
        return PhysicalFile(path, "image/png");
    }

    /// <summary>
    /// GET /PyLab?handler=Pdf&amp;deckId=3 —— 鉴权后吐整份 PDF（给前端 PDF.js 的矢量模式用）。
    ///
    /// 和图片一样不能放 wwwroot：课件是本班的东西，拿到 URL 不等于有权限。
    /// 必须开 enableRangeProcessing：PDF.js 是按 Range 分段拉字节流的，
    /// 关闭后它要么整份下载完才开始渲染，要么直接报 416。
    /// </summary>
    public IActionResult OnGetPdf(int deckId)
    {
        if (Uid is not int uid) return NotFound();
        var deck = _db.PyLabDecks.FirstOrDefault(d => d.Id == deckId && d.UserId == uid);
        if (deck is null || deck.Status != "ready") return NotFound();

        var path = Path.Combine(DeckDir(uid, deckId), PyLabDeckConverter.PdfName);
        if (!System.IO.File.Exists(path)) return NotFound();

        Response.Headers.CacheControl = "private, max-age=86400";

        // PageModel 自带的 PhysicalFile 只有 (路径, 类型, 下载名) 三个重载，没有 Range 开关，
        // 这里显式用 FileStreamResult —— PDF.js 分段拉字节流全靠它。
        return new FileStreamResult(System.IO.File.OpenRead(path), "application/pdf")
        {
            EnableRangeProcessing = true,
        };
    }
}
