using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace CheckinApp.Services;

/// <summary>名单里解析出的一行。</summary>
public sealed record PyLabRosterRow(string StudentNo, string Name, string ClassName);

/// <summary>
/// 学生名单解析：支持「直接粘贴 / CSV / TXT / XLSX」四种来源。
///
/// 之所以要自己解析 xlsx：它本质是个 zip 包（xl/sharedStrings.xml + xl/worksheets/sheet1.xml），
/// 只用 BCL 的 ZipArchive + XDocument 就能读，为这一件事引一个 ClosedXML/NPOI 不值得
/// —— 少一个依赖，发版时少一份体积和漏洞面。
///
/// 列的位置不靠死规矩：先找含「姓名/学号/班级」的标题行，找不到再按内容猜
/// （纯数字当学号、含中文的当姓名）。老师们的表格长得五花八门，硬编码列序一定翻车。
/// </summary>
public static class PyLabRosterParser
{
    public const int MaxRows = 2000;

    /// <summary>老 .xls（BIFF 二进制）和 .doc 一样难缠，明确不支持，引导另存。</summary>
    public static bool IsSupported(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext is ".csv" or ".txt" or ".tsv" or ".xlsx";
    }

    public static List<PyLabRosterRow> ParseFile(string fileName, byte[] bytes, string defaultClass)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".xlsx" => ParseXlsx(bytes, defaultClass),
            _ => ParseText(DecodeText(bytes), defaultClass),
        };
    }

    /// <summary>
    /// 解码文本：中文 CSV 十有八九是 Excel 存的 GBK，直接按 UTF-8 读会全是乱码。
    /// 先看 BOM，再看是不是合法 UTF-8，都不是就当 GB18030（GBK 的超集）。
    /// </summary>
    private static string DecodeText(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);

        try
        {
            return new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            try
            {
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                return Encoding.GetEncoding(936).GetString(bytes);   // GBK
            }
            catch
            {
                return Encoding.UTF8.GetString(bytes);               // 实在不行就带替换符硬读
            }
        }
    }

    // ───────────────────────────────────────────────────────────────
    //  文本 / CSV
    // ───────────────────────────────────────────────────────────────

    public static List<PyLabRosterRow> ParseText(string text, string defaultClass)
    {
        var rows = new List<string[]>();
        foreach (var raw in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            var cells = SplitLine(line);
            if (cells.Length == 0) continue;
            rows.Add(cells);
            if (rows.Count > MaxRows + 20) break;
        }
        return Map(rows, defaultClass);
    }

    /// <summary>拆一行：逗号/制表符/分号/中文逗号/连续空格 都试，谁拆出来的列多用谁。</summary>
    private static string[] SplitLine(string line)
    {
        var candidates = new[] { '\t', ',', ';', '，', '、' };
        string[] best = { line };
        foreach (var sep in candidates)
        {
            if (line.IndexOf(sep) < 0) continue;
            var parts = line.Split(sep).Select(x => x.Trim().Trim('"').Trim()).ToArray();
            if (parts.Length > best.Length) best = parts;
        }
        if (best.Length <= 1)
        {
            // 空格分隔（"20230101 张三"）：连续空格才拆，单个空格可能是名字里的
            var parts = Regex.Split(line, @"\s{2,}").Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();
            if (parts.Length > 1) best = parts;
        }
        // 保留空列：CSV 里 "张三,,计算机1班" 的空位是列坐标，删掉会让班级错位
        return best;
    }

    // ───────────────────────────────────────────────────────────────
    //  XLSX
    // ───────────────────────────────────────────────────────────────

    private static List<PyLabRosterRow> ParseXlsx(byte[] bytes, string defaultClass)
    {
        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        var shared = ReadSharedStrings(zip);

        var sheet = zip.Entries
            .Where(e => e.FullName.StartsWith("xl/worksheets/sheet", StringComparison.OrdinalIgnoreCase)
                        && e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
            .OrderBy(e => e.FullName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault()
            ?? throw new InvalidOperationException("这个 xlsx 里没有工作表，文件可能已损坏。");

        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        using var s = sheet.Open();
        var doc = XDocument.Load(s);

        var rows = new List<string[]>();
        foreach (var row in doc.Descendants(ns + "row"))
        {
            var cells = new List<(int Col, string Text)>();
            foreach (var c in row.Elements(ns + "c"))
            {
                var r = (string?)c.Attribute("r") ?? "";
                var col = ColumnIndex(r);
                var type = (string?)c.Attribute("t") ?? "";
                string text;
                if (type == "s")
                {
                    var v = (string?)c.Element(ns + "v");
                    text = int.TryParse(v, out var idx) && idx >= 0 && idx < shared.Count ? shared[idx] : "";
                }
                else if (type == "inlineStr")
                {
                    text = string.Concat(c.Descendants(ns + "t").Select(t => t.Value));
                }
                else
                {
                    text = (string?)c.Element(ns + "v") ?? "";
                }
                cells.Add((col, text.Trim()));
            }
            if (cells.Count == 0) continue;
            var width = cells.Max(x => x.Col) + 1;
            var arr = new string[width];
            for (var i = 0; i < width; i++) arr[i] = "";
            foreach (var (col, text) in cells)
                if (col >= 0 && col < width) arr[col] = text;
            rows.Add(arr);
            if (rows.Count > MaxRows + 20) break;
        }

        return Map(rows, defaultClass);
    }

    private static List<string> ReadSharedStrings(ZipArchive zip)
    {
        var entry = zip.GetEntry("xl/sharedStrings.xml");
        if (entry is null) return new List<string>();
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        using var s = entry.Open();
        var doc = XDocument.Load(s);
        return doc.Descendants(ns + "si")
            .Select(si => string.Concat(si.Descendants(ns + "t").Select(t => t.Value)))
            .ToList();
    }

    /// <summary>"B12" → 1（列号从 0 起）</summary>
    private static int ColumnIndex(string cellRef)
    {
        var n = 0;
        var got = false;
        foreach (var ch in cellRef)
        {
            if (ch is >= 'A' and <= 'Z') { n = n * 26 + (ch - 'A' + 1); got = true; }
            else break;
        }
        return got ? n - 1 : 0;
    }

    // ───────────────────────────────────────────────────────────────
    //  行列 → 名单（文本与 xlsx 共用的落位逻辑）
    // ───────────────────────────────────────────────────────────────

    private static readonly string[] NameKeys = { "姓名", "名字", "学生", "name", "学员" };
    private static readonly string[] NoKeys = { "学号", "编号", "工号", "序号", "no", "id" };
    private static readonly string[] ClassKeys = { "班级", "班别", "班", "class", "专业" };

    private static List<PyLabRosterRow> Map(List<string[]> rows, string defaultClass)
    {
        var result = new List<PyLabRosterRow>();
        if (rows.Count == 0) return result;

        int nameCol = -1, noCol = -1, classCol = -1;

        // 1) 在头 10 行里找标题行
        for (var r = 0; r < Math.Min(rows.Count, 10) && nameCol < 0; r++)
        {
            for (var c = 0; c < rows[r].Length; c++)
            {
                var cell = (rows[r][c] ?? "").Trim();
                if (cell.Length == 0 || cell.Length > 12) continue;
                var low = cell.ToLowerInvariant();
                if (nameCol < 0 && NameKeys.Any(k => low.Contains(k))) nameCol = c;
                else if (noCol < 0 && NoKeys.Any(k => low.Contains(k))) noCol = c;
                else if (classCol < 0 && ClassKeys.Any(k => low.Contains(k))) classCol = c;
            }
        }

        var headerRow = nameCol >= 0 ? FindHeaderRow(rows, nameCol) : -1;

        // 2) 没有标题行 → 按内容猜列
        if (nameCol < 0)
        {
            for (var c = 0; c < rows[0].Length && nameCol < 0; c++)
            {
                var hits = rows.Take(20).Count(x => c < x.Length && LooksLikeName(x[c]));
                if (hits >= Math.Min(2, rows.Count)) nameCol = c;
            }
            if (nameCol < 0) nameCol = 0;
        }
        if (noCol < 0)
        {
            for (var c = 0; c < rows[0].Length; c++)
            {
                if (c == nameCol) continue;
                var hits = rows.Take(20).Count(x => c < x.Length && LooksLikeStudentNo(x[c]));
                if (hits >= Math.Min(2, rows.Count)) { noCol = c; break; }
            }
        }

        foreach (var row in rows)
        {
            var name = Cell(row, nameCol);
            if (!LooksLikeName(name)) continue;
            if (headerRow >= 0 && LooksLikeHeaderRow(row)) continue;    // 跳过标题行本身
            var no = noCol >= 0 ? Cell(row, noCol) : "";
            var cls = classCol >= 0 ? Cell(row, classCol) : "";
            if (cls.Length == 0) cls = defaultClass;
            result.Add(new PyLabRosterRow(no, name, cls));
            if (result.Count >= MaxRows) break;
        }

        // 同一份名单里姓名+学号重复的只留一条（导两遍不会变成两个人）
        return result
            .GroupBy(x => x.StudentNo.Length > 0 ? x.StudentNo + "|" + x.Name : x.Name)
            .Select(g => g.First())
            .ToList();
    }

    private static int FindHeaderRow(List<string[]> rows, int nameCol)
    {
        for (var r = 0; r < Math.Min(rows.Count, 10); r++)
            if (Cell(rows[r], nameCol).Contains("姓名") || Cell(rows[r], nameCol).Contains("名字"))
                return r;
        return -1;
    }

    private static bool LooksLikeHeaderRow(string[] row)
        => row.Any(c =>
        {
            var s = (c ?? "").ToLowerInvariant();
            return s is "姓名" or "名字" or "name" || s.Contains("学号");
        });

    private static string Cell(string[] row, int col)
        => col >= 0 && col < row.Length ? (row[col] ?? "").Trim() : "";

    private static bool LooksLikeName(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return false;
        s = s.Trim();
        if (s.Length is < 2 or > 20) return false;
        if (s.All(char.IsDigit)) return false;
        // 至少有一个中日韩字符或字母，且不是表头词
        var hasWord = s.Any(ch => ch >= 0x4E00 && ch <= 0x9FFF) || s.Any(char.IsLetter);
        if (!hasWord) return false;
        return !LooksLikeHeaderRow(new[] { s });
    }

    private static bool LooksLikeStudentNo(string s)
    {
        s = (s ?? "").Trim();
        if (s.Length < 4 || s.Length > 24) return false;
        return s.All(ch => char.IsDigit(ch) || ch is '-' or '_') && s.Any(char.IsDigit);
    }
}
