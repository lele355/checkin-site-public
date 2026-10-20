using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace CheckinApp.Services;

/// <summary>
/// PPT → 逐页 PNG 转换器。
///
/// 浏览器里没有 PPT 引擎，「播放真实 ppt」只有一条路：在服务器上先把课件**渲染成图片**，
/// 前端拿到的就是一张张静态图，翻页 = 换图。代价是动画/切换效果必然丢失，
/// 换来的是 100% 可控的页码坐标（第 N 页永远是第 N 张图），这对「PPT 里嵌代码」至关重要。
///
/// 两条后端，按可用性自动挑：
///   1. PowerPoint COM（Windows 首选）—— 真正的 PowerPoint 渲染，保真度最高；
///      实测 24 页 1920×1080 约 8.6 秒。
///   2. LibreOffice headless + pdftoppm（Linux 服务器 / 装了 LO 的 Windows）——
///      先转 PDF 再逐页栅格化，版式基本一致，复杂动效与部分字体会有差异。
///
/// 两者都没有时不会静默失败：返回明确原因，页面上直接告诉用户「这台机器缺什么」。
/// </summary>
public sealed class PyLabDeckConverter
{
    /// <summary>输出图片宽度（高度按 16:9 推）。1920 足够投影和全屏，单页约 120KB。</summary>
    private const int TargetWidth = 1920;
    private const int TargetHeight = 1080;

    /// <summary>
    /// 除了逐页 PNG，还额外留一份 PDF（同一个目录下）。
    /// 前端「矢量模式」用 PDF.js 直接渲染它：文字是真矢量、放大不糊，
    /// 而且一份 40 页带图课件 PDF 约 1.2MB，同样内容的 PNG 一套 47MB。
    /// </summary>
    public const string PdfName = "deck.pdf";

    /// <summary>
    /// 缩略图：底部的页码条用它。之前缩略图直接用 p{n}.png（1600×900 约 1.2MB），
    /// 一份 14 页课件光缩略图就要下 18MB —— 在 800KB/s 的服务器上把带宽全吃掉了，
    /// 结果正文和 PDF 都排在后面，用户看到的就是「半天不出图」。
    /// 320px 宽的小图每张 20~40KB，整条缩略图条加起来还不到一页正文的大小。
    /// </summary>
    public const int ThumbWidth = 320;
    public static string ThumbName(int pageNo) => $"t{pageNo}.png";

    /// <summary>
    /// PowerPoint 是**单实例**应用：同一时刻只能有一个进程在开演示文稿。
    /// 两个用户同时上传，第二个会撞上「文件被占用 / 调用被拒绝」，所以这里串行化。
    /// </summary>
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private readonly ILogger _log;
    private readonly IConfiguration _cfg;

    public PyLabDeckConverter(ILogger log, IConfiguration cfg)
    {
        _log = log;
        _cfg = cfg;
    }

    public sealed record ConvertResult(bool Ok, int PageCount, string Engine, string Error);

    /// <summary>当前这台机器能用哪些引擎（页面顶上显示，方便排查「为什么转不了」）。</summary>
    public (bool PowerPoint, bool LibreOffice) Engines()
        => (FindPowerPoint() is not null, FindSoffice() is not null);

    // ───────────────────────────────────────────────────────────────
    //  主入口
    // ───────────────────────────────────────────────────────────────

    public async Task<ConvertResult> ConvertAsync(string sourcePath, string outDir, CancellationToken ct)
    {
        Directory.CreateDirectory(outDir);
        await Gate.WaitAsync(ct);
        try
        {
            // 1) PowerPoint COM
            var ppt = FindPowerPoint();
            if (OperatingSystem.IsWindows() && ppt is not null)
            {
                var r = await TryPowerPointAsync(ppt, sourcePath, outDir, ct);
                if (r.Ok) return r;
                _log.LogWarning("PyLab: PowerPoint 转换失败，尝试 LibreOffice。{Err}", r.Error);
                CleanImages(outDir);
            }

            // 2) LibreOffice → PDF → PNG
            var soffice = FindSoffice();
            if (soffice is not null)
            {
                var r = await TryLibreOfficeAsync(soffice, sourcePath, outDir, ct);
                if (r.Ok) return r;
                CleanImages(outDir);
                return r;
            }

            return new ConvertResult(false, 0, "", ppt is null
                ? "这台机器上没有可用的 PPT 转换引擎：既没有 Microsoft PowerPoint，也没有 LibreOffice。"
                  + "Windows 装 PowerPoint 或 LibreOffice 任一即可；Linux 请 apt install libreoffice-impress poppler-utils。"
                : "PowerPoint 转换失败，且没找到 LibreOffice 可以兜底。");
        }
        finally
        {
            Gate.Release();
        }
    }

    // ───────────────────────────────────────────────────────────────
    //  后端一：PowerPoint COM
    // ───────────────────────────────────────────────────────────────

    [SupportedOSPlatform("windows")]
    private async Task<ConvertResult> TryPowerPointAsync(string exePath, string sourcePath, string outDir, CancellationToken ct)
    {
        // 转换开始前是否有 PowerPoint 在跑：有的话说明是用户自己开着的，
        // 结束时**绝不能 Quit**，否则会把老师正在编辑的 PPT 一起关掉。
        var owned = !Process.GetProcessesByName("POWERPNT").Any();
        var tmp = Path.Combine(Path.GetTempPath(), "pylab_ppt_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);

        var work = Task.Run(() =>
        {
            object? app = null;
            object? pres = null;
            try
            {
                var t = Type.GetTypeFromProgID("PowerPoint.Application");
                if (t is null) return (false, "系统里找不到 PowerPoint 的 COM 组件");
                dynamic dapp = Activator.CreateInstance(t)!;
                app = dapp;
                // PowerPoint 不支持真正的后台自动化：Visible 必须是 msoTrue，否则 Open 直接 HRESULT E_FAIL
                dapp.Visible = -1;
                dynamic dpres = dapp.Presentations.Open(sourcePath, -1 /*ReadOnly*/, 0 /*Untitled*/, -1 /*WithWindow*/);
                pres = dpres;
                int slides = (int)dpres.Slides.Count;
                if (slides <= 0) return (false, "这份课件里没有幻灯片");
                dpres.Export(tmp, "PNG", TargetWidth, TargetHeight);
                // 再导一套小图给底部页码条（失败不影响主流程，前端会退回用大图）
                try
                {
                    var td = System.IO.Path.Combine(tmp, "thumbs");
                    Directory.CreateDirectory(td);
                    dpres.Export(td, "PNG", ThumbWidth, ThumbWidth * 9 / 16);
                }
                catch (Exception ex) { _log.LogWarning(ex, "PyLab: 导出缩略图失败（页码条将使用大图）"); }
                // 顺手再导一份 PDF（ppSaveAsPDF = 32）：前端「矢量模式」靠它渲染。
                // 这一步失败不影响主流程 —— PNG 已经拿到了，最差就是没有矢量模式。
                try { dpres.SaveAs(System.IO.Path.Combine(tmp, PdfName), 32); } catch { }
                dpres.Close();
                pres = null;
                return (true, slides.ToString());
            }
            finally
            {
                try { if (pres is not null) ((dynamic)pres).Close(); } catch { }
                try { if (app is not null && owned) ((dynamic)app).Quit(); } catch { }
                if (app is not null) { try { Marshal.ReleaseComObject(app); } catch { } }
            }
        });

        try
        {
            var done = await work.WaitAsync(TimeSpan.FromSeconds(240), ct);
            if (!done.Item1)
                return new ConvertResult(false, 0, "powerpoint", done.Item2);

            // PowerPoint 导出的文件名是「幻灯片1.PNG」，序号不一定按位数对齐（1,2,…,10）
            // → 按文件名里的数字排，绝不按字符串排（否则 10 会排到 2 前面）
            var files = new DirectoryInfo(tmp).GetFiles("*.PNG")
                .Select(f => (f, no: TrailingNumber(Path.GetFileNameWithoutExtension(f.Name))))
                .Where(x => x.no > 0)
                .OrderBy(x => x.no)
                .ToList();

            if (files.Count == 0)
                return new ConvertResult(false, 0, "powerpoint", "导出成功但没拿到任何图片，可能是导出目录权限问题");

            for (var i = 0; i < files.Count; i++)
                files[i].f.MoveTo(Path.Combine(outDir, $"p{i + 1}.png"), overwrite: true);

            MoveThumbs(Path.Combine(tmp, "thumbs"), outDir, files.Count);

            // PDF 是「加菜」不是「主菜」：拷不过去也只丢矢量模式，不该让整次转换失败
            try
            {
                var pdf = Path.Combine(tmp, PdfName);
                if (System.IO.File.Exists(pdf)) System.IO.File.Copy(pdf, Path.Combine(outDir, PdfName), overwrite: true);
            }
            catch (Exception ex) { _log.LogWarning(ex, "PyLab: 复制 PDF 失败（矢量模式将不可用）"); }

            return new ConvertResult(true, files.Count, "powerpoint", "");
        }
        catch (TimeoutException)
        {
            return new ConvertResult(false, 0, "powerpoint", "PowerPoint 转换超过 240 秒仍未完成，可能是弹了对话框卡住了。请在服务器上手动打开一次 PowerPoint 关掉弹窗后重试。");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "PyLab: PowerPoint COM 异常");
            return new ConvertResult(false, 0, "powerpoint", Short(ex));
        }
        finally
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
        }
    }

    /// <summary>取文件名结尾的数字（"幻灯片12" → 12）。取不到返回 0。</summary>
    private static int TrailingNumber(string name)
    {
        var i = name.Length;
        while (i > 0 && char.IsDigit(name[i - 1])) i--;
        if (i == name.Length) return 0;
        return int.TryParse(name.AsSpan(i), out var n) ? n : 0;
    }

    /// <summary>把小图按页码搬成 t1.png / t2.png …；数量对不上就整体放弃（前端会退回用大图）。</summary>
    private void MoveThumbs(string srcDir, string outDir, int expected)
    {
        if (!Directory.Exists(srcDir)) return;
        var fs = Directory.GetFiles(srcDir)
            .Where(f => f.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            .Select(f => (f, no: TrailingNumber(Path.GetFileNameWithoutExtension(f))))
            .Where(x => x.no > 0)
            .OrderBy(x => x.no)
            .ToList();
        if (fs.Count != expected)
        {
            _log.LogWarning("PyLab: 缩略图数量对不上（{Got}/{Want}），页码条将使用大图", fs.Count, expected);
            return;
        }
        for (var i = 0; i < fs.Count; i++)
        {
            try { File.Move(fs[i].f, Path.Combine(outDir, ThumbName(i + 1)), overwrite: true); }
            catch (Exception ex) { _log.LogWarning(ex, "PyLab: 缩略图搬运失败（页码条将使用大图）{Err}", ex.Message); return; }
        }
    }

    // ───────────────────────────────────────────────────────────────
    //  后端二：LibreOffice headless
    // ───────────────────────────────────────────────────────────────

    private async Task<ConvertResult> TryLibreOfficeAsync(string soffice, string sourcePath, string outDir, CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), "pylab_lo_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            // -env:UserInstallation 必须每进程独立：共用默认 profile 时，
            // 两个转换同时跑会互相锁 profile 直接卡死（这是 LibreOffice 的老坑）
            var profile = "file:///" + tmp.Replace('\\', '/').Trim('/');
            var args = $"--headless --norestore --nolockcheck --nodefault --nofirststartwizard "
                     + $"-env:UserInstallation={profile} --convert-to pdf --outdir \"{tmp}\" \"{sourcePath}\"";
            var (code, output) = await RunAsync(soffice, args, 180, ct);
            var pdf = Directory.GetFiles(tmp, "*.pdf").FirstOrDefault();
            if (pdf is null)
                return new ConvertResult(false, 0, "libreoffice",
                    $"LibreOffice 没能生成 PDF（退出码 {code}）。{Trim(output)}");

            // pdftoppm 由 poppler-utils 提供；TeX Live 也自带一份，所以两个路径都找
            var pdftoppm = FindOnPath("pdftoppm") ?? FindTool(@"C:\texlive\2026\bin\windows\pdftoppm.exe");
            if (pdftoppm is null)
                return new ConvertResult(false, 0, "libreoffice",
                    "已生成 PDF，但找不到 pdftoppm（poppler-utils）来栅格化。Linux: apt install poppler-utils");

            // 160 DPI：10×5.63 英寸的 16:9 幻灯片出图 1600×900，投 1080p 投影仪正好清晰；
            // 再高（192+）单页 PNG 到 1MB 以上，14 页课件要几十 MB，2C2G 机器上不划算。
            var prefix = Path.Combine(tmp, "pg");
            var (c2, o2) = await RunAsync(pdftoppm, $"-png -r 160 \"{pdf}\" \"{prefix}\"", 180, ct);
            var imgs = Directory.GetFiles(tmp, "pg-*.png").OrderBy(x => TrailingNumber(Path.GetFileNameWithoutExtension(x))).ToList();
            if (imgs.Count == 0)
                return new ConvertResult(false, 0, "libreoffice", $"PDF 转图片失败（退出码 {c2}）。{Trim(o2)}");

            for (var i = 0; i < imgs.Count; i++)
                File.Move(imgs[i], Path.Combine(outDir, $"p{i + 1}.png"), overwrite: true);

            // 再来一套小图给底部页码条（320px 宽，单张 20~40KB）。失败不影响主流程
            var tprefix = Path.Combine(tmp, "tb");
            await RunAsync(pdftoppm, $"-png -scale-to {ThumbWidth} \"{pdf}\" \"{tprefix}\"", 180, ct);
            MoveThumbs(tmp, outDir, imgs.Count);

            // PDF 也留一份：前端「矢量模式」用 PDF.js 直接渲染它——
            // 文字是真矢量，放大不糊；同一份 40 页带图课件 PDF 1.2MB、PNG 一套 47MB。
            // 两种产物并存，播放时由用户二选一。拷不过去只丢矢量模式，不影响 PNG 播放。
            try { File.Copy(pdf, Path.Combine(outDir, PdfName), overwrite: true); }
            catch (Exception ex) { _log.LogWarning(ex, "PyLab: 复制 PDF 失败（矢量模式将不可用）"); }

            return new ConvertResult(true, imgs.Count, "libreoffice", "");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "PyLab: LibreOffice 转换异常");
            return new ConvertResult(false, 0, "libreoffice", Short(ex));
        }
        finally
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
        }
    }

    // ───────────────────────────────────────────────────────────────
    //  工具
    // ───────────────────────────────────────────────────────────────

    private static async Task<(int Code, string Output)> RunAsync(string exe, string args, int timeoutSec, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(exe, args)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var p = Process.Start(psi)!;
        var o = p.StandardOutput.ReadToEndAsync(ct);
        var e = p.StandardError.ReadToEndAsync(ct);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(timeoutSec));
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch { } throw new TimeoutException($"{Path.GetFileName(exe)} 超时"); }
        return (p.ExitCode, (await o) + (await e));
    }

    private void CleanImages(string outDir)
    {
        foreach (var pat in new[] { "p*.png", "t*.png" })
        {
            foreach (var f in Directory.GetFiles(outDir, pat))
            {
                try { File.Delete(f); } catch { }
            }
        }
    }

    private static string Trim(string s)
    {
        s = (s ?? "").Trim();
        return s.Length > 300 ? s[..300] + "…" : s;
    }

    private static string Short(Exception ex)
    {
        var msg = ex.Message;
        var inner = ex.InnerException?.Message;
        if (!string.IsNullOrWhiteSpace(inner) && inner != msg) msg += " / " + inner;
        return Trim(msg);
    }

    private static string? FindOnPath(string name)
    {
        var exts = OperatingSystem.IsWindows() ? new[] { ".exe", ".cmd", ".bat" } : new[] { "" };
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            foreach (var ext in exts)
            {
                var full = Path.Combine(dir, name + ext);
                if (File.Exists(full)) return full;
            }
        }
        return null;
    }

    private static string? FindTool(string full)
        => File.Exists(full) ? full : null;

    /// <summary>找 PowerPoint 主程序：先看 POWERPNT.EXE 的常见安装位置，再看 ProgID 能不能解析。</summary>
    private string? FindPowerPoint()
    {
        if (!OperatingSystem.IsWindows()) return null;
        var configured = _cfg["PyLab:PowerPointPath"];
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

        foreach (var root in new[]
                 {
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                     Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                 })
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            foreach (var rel in new[] { @"Microsoft Office\root\Office16\POWERPNT.EXE", @"Microsoft Office\Office16\POWERPNT.EXE" })
            {
                var p = Path.Combine(root, rel);
                if (File.Exists(p)) return p;
            }
        }
        // Office 365 装法各异，最后核一次 COM 注册表里有没有 PowerPoint.Application
        return Type.GetTypeFromProgID("PowerPoint.Application") is not null ? "com" : null;
    }

    private string? FindSoffice()
    {
        var configured = _cfg["PyLab:SofficePath"];
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

        var onPath = FindOnPath("soffice");
        if (onPath is not null) return onPath;

        foreach (var p in new[]
                 {
                     @"C:\Program Files\LibreOffice\program\soffice.exe",
                     @"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
                     "/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice",
                     "/opt/libreoffice/program/soffice", "/snap/bin/libreoffice",
                 })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }
}
