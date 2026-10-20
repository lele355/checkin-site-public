using System.Text.Json;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Pages;

/// <summary>
/// ① 课堂点名（C# 侧）。
///
/// 设计取舍：名单与考勤进数据库，**轮次状态留在浏览器**。
/// 理由——「这一轮抽过谁」是课堂内的一次性会话状态，刷新页面就该重新开一轮；
/// 而名单和考勤是要留档的，必须落库。把会话状态也塞进数据库只会多一张每天清一次的表。
/// </summary>
public partial class PyLabModel
{
    public sealed record RosterRow(int Id, string StudentNo, string Name, string ClassName);

    // ───────────────────────────────────────────────────────────────
    //  名单读取
    // ───────────────────────────────────────────────────────────────

    /// <summary>GET /PyLab?handler=Roster —— 名单 + 班级列表 + 各班人数。</summary>
    public IActionResult OnGetRoster()
    {
        if (Uid is not int uid) return JsonErr("请先登录");

        var rows = _db.PyLabStudents
            .Where(s => s.UserId == uid)
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Id)
            .Select(s => new RosterRow(s.Id, s.StudentNo, s.Name, s.ClassName))
            .ToList();

        var classes = rows
            .GroupBy(r => string.IsNullOrWhiteSpace(r.ClassName) ? "" : r.ClassName)
            .Select(g => new { name = g.Key.Length == 0 ? "未分班" : g.Key, raw = g.Key, count = g.Count() })
            .OrderBy(g => g.raw)
            .ToList();

        return JsonOk(new { students = rows, classes, total = rows.Count });
    }

    // ───────────────────────────────────────────────────────────────
    //  导入
    // ───────────────────────────────────────────────────────────────

    /// <summary>
    /// POST /PyLab?handler=Import —— 支持上传文件（csv/txt/xlsx）或直接粘贴文本。
    /// replace=1 表示「先清空这个班再导入」，否则追加（重复的姓名+学号自动跳过）。
    /// </summary>
    public async Task<IActionResult> OnPostImportAsync(
        IFormFile? file, string? text, string? className, bool replace = false)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        className = (className ?? "").Trim();
        if (className.Length > 40) className = className[..40];

        List<PyLabRosterRow> parsed = [];
        try
        {
            if (file is not null && file.Length > 0)
            {
                if (!PyLabRosterParser.IsSupported(file.FileName))
                    return JsonErr("只认 .xlsx / .csv / .txt。老的 .xls 请先用 Excel 另存为 .xlsx。");
                if (file.Length > 15 * 1024 * 1024)
                    return JsonErr("名单文件太大了（超过 15MB），确认一下是不是选错文件了。");

                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                parsed = PyLabRosterParser.ParseFile(file.FileName, ms.ToArray(), className);
            }
            else if (!string.IsNullOrWhiteSpace(text))
            {
                parsed = PyLabRosterParser.ParseText(text, className);
            }
            else
            {
                return JsonErr("没有拿到名单内容：上传一个文件，或者把名字粘贴进来。");
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "PyLab 名单解析失败");
            return JsonErr("名单解析失败：" + ex.Message);
        }

        if (parsed.Count == 0)
            return JsonErr("一行学生都没解析出来。检查一下文件里有没有「姓名」这一列。");

        if (replace)
        {
            // 只清这一个班；考勤记录随学生级联删除（EF 配置了 Cascade）
            var old = _db.PyLabStudents.Where(s => s.UserId == uid && s.ClassName == className).ToList();
            if (old.Count > 0) _db.PyLabStudents.RemoveRange(old);
            _db.SaveChanges();
        }

        // 查重口径：学号相同即同一人；没学号的按「班级+姓名」
        var existing = _db.PyLabStudents.Where(s => s.UserId == uid)
            .Select(s => new { s.StudentNo, s.Name, s.ClassName })
            .ToList();
        var seen = existing.Select(x => Key(x.StudentNo, x.Name, x.ClassName)).ToHashSet();

        var order = (_db.PyLabStudents.Where(s => s.UserId == uid).Max(s => (int?)s.SortOrder) ?? 0) + 1;
        var added = 0;
        var skipped = 0;
        foreach (var r in parsed)
        {
            var key = Key(r.StudentNo, r.Name, r.ClassName);
            if (!seen.Add(key)) { skipped++; continue; }
            _db.PyLabStudents.Add(new PyLabStudent
            {
                UserId = uid,
                StudentNo = r.StudentNo,
                Name = r.Name,
                ClassName = r.ClassName,
                SortOrder = order++,
            });
            added++;
        }
        _db.SaveChanges();

        return JsonOk(new
        {
            added,
            skipped,
            parsed = parsed.Count,
            total = _db.PyLabStudents.Count(s => s.UserId == uid),
            preview = parsed.Take(5).Select(p => p.Name).ToList(),
        });
    }

    private static string Key(string no, string name, string cls)
        => string.IsNullOrWhiteSpace(no) ? $"{cls}|{name}" : "no:" + no.Trim();

    // ───────────────────────────────────────────────────────────────
    //  单条增删 / 清空
    // ───────────────────────────────────────────────────────────────

    public IActionResult OnPostStudentAdd(string? studentNo, string? name, string? className)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        name = (name ?? "").Trim();
        if (name.Length is 0 or > 30) return JsonErr("姓名必填，且不超过 30 个字。");

        var no = (studentNo ?? "").Trim();
        if (no.Length > 24) no = no[..24];

        var order = (_db.PyLabStudents.Where(s => s.UserId == uid).Max(s => (int?)s.SortOrder) ?? 0) + 1;
        _db.PyLabStudents.Add(new PyLabStudent
        {
            UserId = uid,
            StudentNo = no,
            Name = name,
            ClassName = (className ?? "").Trim(),
            SortOrder = order,
        });
        _db.SaveChanges();
        return JsonOk();
    }

    public IActionResult OnPostStudentDelete(int id)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var s = _db.PyLabStudents.FirstOrDefault(x => x.Id == id && x.UserId == uid);
        if (s is null) return JsonErr("这个学生不在你的名单里。");
        _db.PyLabStudents.Remove(s);
        _db.SaveChanges();
        return JsonOk();
    }

    public IActionResult OnPostRosterClear(string? className)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        var q = _db.PyLabStudents.Where(s => s.UserId == uid);
        if (!string.IsNullOrWhiteSpace(className)) q = q.Where(s => s.ClassName == className);
        var list = q.ToList();
        _db.PyLabStudents.RemoveRange(list);
        _db.SaveChanges();
        return JsonOk(new { removed = list.Count });
    }

    // ───────────────────────────────────────────────────────────────
    //  点名
    // ───────────────────────────────────────────────────────────────

    /// <summary>
    /// POST /PyLab?handler=Pick —— 从名单里随机抽 count 个人。
    /// called 是浏览器带回来的「本轮已抽过的 id」，抽空了就自动开新一轮（wrapped=true）。
    /// 名单为 0 人时不会报错，而是返回一句明确的提示，前端直接显示出来。
    /// </summary>
    public IActionResult OnPostPick(int count = 1, string? className = null, string? called = null)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        count = Math.Clamp(count, 1, 10);

        var pool = _db.PyLabStudents.Where(s => s.UserId == uid);
        if (!string.IsNullOrWhiteSpace(className)) pool = pool.Where(s => s.ClassName == className);
        var all = pool.OrderBy(s => s.SortOrder).ThenBy(s => s.Id)
            .Select(s => new RosterRow(s.Id, s.StudentNo, s.Name, s.ClassName))
            .ToList();

        if (all.Count == 0)
            return JsonOk(new
            {
                picked = Array.Empty<RosterRow>(),
                total = 0,
                remaining = 0,
                wrapped = false,
                message = "名单是空的，先在上面导入一份学生名单。",
            });

        var calledIds = ParseIds(called);
        var remaining = all.Where(s => !calledIds.Contains(s.Id)).ToList();
        var wrapped = false;

        var picked = new List<RosterRow>();
        for (var i = 0; i < count; i++)
        {
            if (remaining.Count == 0)
            {
                // 一轮抽完 → 自动开新一轮，并把这批人重新放回池子
                wrapped = true;
                calledIds.Clear();
                remaining = all.ToList();
            }
            var idx = Random.Shared.Next(remaining.Count);
            var who = remaining[idx];
            remaining.RemoveAt(idx);
            calledIds.Add(who.Id);
            picked.Add(who);
        }

        return JsonOk(new
        {
            picked,
            total = all.Count,
            remaining = remaining.Count,
            wrapped,
            calledIds,
            message = "",
        });
    }

    private static HashSet<int> ParseIds(string? json)
    {
        var set = new HashSet<int>();
        if (string.IsNullOrWhiteSpace(json)) return set;
        try
        {
            var arr = JsonSerializer.Deserialize<int[]>(json);
            if (arr is not null) foreach (var i in arr) set.Add(i);
        }
        catch { /* 前端传坏了就当没抽过，重新开始一轮，不值得把点名卡住 */ }
        return set;
    }

    // ───────────────────────────────────────────────────────────────
    //  考勤
    // ───────────────────────────────────────────────────────────────

    public IActionResult OnPostMark(int studentId, string? status)
    {
        if (Uid is not int uid) return JsonErr("请先登录");
        if (status is not ("present" or "late" or "absent")) return JsonErr("status 只能是 present / late / absent。");
        var s = _db.PyLabStudents.FirstOrDefault(x => x.Id == studentId && x.UserId == uid);
        if (s is null) return JsonErr("这个学生不在你的名单里。");

        _db.PyLabAttendances.Add(new PyLabAttendance
        {
            UserId = uid,
            StudentId = s.Id,
            StudentName = s.Name,
            Status = status,
        });
        _db.SaveChanges();
        return JsonOk();
    }

    /// <summary>GET /PyLab?handler=Attendance —— 按学生汇总出勤/迟到/缺勤。</summary>
    public IActionResult OnGetAttendance()
    {
        if (Uid is not int uid) return JsonErr("请先登录");

        var students = _db.PyLabStudents.Where(s => s.UserId == uid)
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.StudentNo, s.Name, s.ClassName })
            .ToList();

        // 小数据量（一个班几十人），直接在内存里 GroupBy，SQL 翻译更省心
        var marks = _db.PyLabAttendances.Where(a => a.UserId == uid)
            .Select(a => new { a.StudentId, a.Status })
            .ToList()
            .GroupBy(a => a.StudentId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var rows = students.Select(s =>
        {
            marks.TryGetValue(s.Id, out var list);
            var p = list?.Count(x => x.Status == "present") ?? 0;
            var l = list?.Count(x => x.Status == "late") ?? 0;
            var a = list?.Count(x => x.Status == "absent") ?? 0;
            var total = p + l + a;
            return new
            {
                id = s.Id,
                no = s.StudentNo,
                name = s.Name,
                className = s.ClassName,
                present = p,
                late = l,
                absent = a,
                total,
                // 分母用「被打过卡的次数」：没打过卡的人不该被算成 0%
                rate = total == 0 ? (double?)null : Math.Round(p * 100.0 / total, 1),
            };
        }).ToList();

        var marked = rows.Where(r => r.total > 0).ToList();
        var avg = marked.Count == 0 ? (double?)null : Math.Round(marked.Average(r => r.rate ?? 0), 1);

        return JsonOk(new { rows, avgRate = avg, markedCount = marked.Count });
    }
}
