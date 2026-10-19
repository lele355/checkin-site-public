using CheckinApp.Data;
using CheckinApp.Models;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CheckinApp.Pages.Courses;

[Authorize(Policy = "perm:courses.use")]
public class IndexModel(AppDbContext db, CurrentUser me) : PageModel
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    /// <summary>大节定义：标题 / 小节 / 时段。由可自定义的节次配置两两配对派生</summary>
    public record BlockInfo(string Label, string Sub, string Hours);

    /// <summary>手机课表网格卡片：Row=起始行(0基)、Span=跨行数、Lane/Lanes=同日撞课分列</summary>
    public record GridCard(int Id, string Name, string Location, string Category, int Row, int Span, int Lane, int Lanes);

    /// <summary>课程类别 → 图例/表单共用</summary>
    public static readonly (string Slug, string Label)[] Categories =
    [
        ("required", "必修课"), ("college", "院级选修课"), ("school", "校级选修课"), ("other", "其它"),
    ];

    public const int DayCount = 7;        // 星期数

    public int Week { get; private set; }                // 正在显示的教学周
    public int CurrentWeek { get; private set; }         // 今天所处的教学周
    public DateTime WeekStart { get; private set; }      // 显示周的周一
    public DateTime SemesterStart { get; private set; }  // 学期第 1 周的周一
    public bool SemesterConfigured { get; private set; }
    public DateTime Today { get; private set; } = DateTime.Today;

    /// <summary>节次配置（节数 = Periods.Count，可自定义）</summary>
    public List<PeriodSlot> Periods { get; private set; } = [.. CoursesConfig.Default];
    public int PeriodCount => Periods.Count;

    /// <summary>大节视图（桌面表格用）：相邻两小节配成一大节</summary>
    public BlockInfo[] Blocks { get; private set; } = [];
    public int BlockCount => Blocks.Length;

    [BindProperty] public DateTime? SemesterStartInput { get; set; }

    /// <summary>Cells[大节][星期] → 课程列表（已按周次过滤）</summary>
    public List<Course>[][] Cells { get; private set; } = [];

    /// <summary>DayGrid[星期] → 手机网格卡片（已按周次过滤 + 撞课分列）</summary>
    public List<GridCard>[] DayGrid { get; private set; } = CreateDays();

    public void OnGet(int? week)
    {
        if (_me.UserId is not int uid) return;
        Today = DateTime.Today;

        // 学期起始：设置过用设置的，没设置默认「本周=第 1 周」
        var setting = _db.AppSettings.FirstOrDefault(s => s.Key == "courses.semester-start");
        SemesterConfigured = setting is not null && DateTime.TryParse(setting.Value, out _);
        var raw = SemesterConfigured && DateTime.TryParse(setting!.Value, out var parsed) ? parsed : Today;
        SemesterStart = MondayOf(raw);
        SemesterStartInput = SemesterStart;

        CurrentWeek = Math.Max(1, (int)((Today - SemesterStart).TotalDays / 7) + 1);
        Week = Math.Clamp(week ?? CurrentWeek, 1, 30);
        WeekStart = SemesterStart.AddDays((Week - 1) * 7);

        // 节次配置 → 大节视图（相邻两小节配对；奇数节最后单一大节）
        Periods = CoursesConfig.Load(_db);
        Blocks = BuildBlocks(Periods);
        Cells = CreateCells(Blocks.Length);

        var courses = _db.Courses.Where(c => c.UserId == uid).ToList();
        foreach (var c in courses)
        {
            if (!Weeks.Includes(c.WeeksText, Week)) continue;     // 周次过滤：第7-12周的课第3周不出现
            var d = Math.Clamp(c.Weekday, 1, 7) - 1;
            for (var b = 0; b < Blocks.Length; b++)
            {
                // 大节 b 覆盖小节 (2b+1, 2b+2)；课程与其有交集就在该行出现（跨大节连上会占多行，与教务一致）
                if (c.StartPeriod <= b * 2 + 2 && c.EndPeriod >= b * 2 + 1)
                    Cells[b][d].Add(c);
            }
        }
        foreach (var row in Cells)
            foreach (var cell in row)
                cell.Sort((a, b) => a.StartPeriod.CompareTo(b.StartPeriod));

        // 手机网格：按星期分列，撞课同日多车道并排（贪心区间着色）
        DayGrid = CreateDays();
        var perDay = new List<Course>[DayCount];
        for (var d = 0; d < DayCount; d++) perDay[d] = [];
        foreach (var c in courses)
        {
            if (!Weeks.Includes(c.WeeksText, Week)) continue;
            var s = Math.Clamp(c.StartPeriod, 1, Periods.Count);
            var e = Math.Clamp(c.EndPeriod, s, Periods.Count);
            if (c.EndPeriod < 1 || c.StartPeriod > Periods.Count) continue;   // 整节都在配置范围外
            perDay[Math.Clamp(c.Weekday, 1, 7) - 1].Add(c);
        }
        for (var d = 0; d < DayCount; d++)
        {
            var sorted = perDay[d].OrderBy(c => c.StartPeriod).ThenBy(c => c.EndPeriod).ToList();
            var laneEnds = new List<int>();      // 每条车道上一节课的结束节
            var tmp = new List<(Course C, int Row, int Span, int Lane)>();
            foreach (var c in sorted)
            {
                var s = Math.Clamp(c.StartPeriod, 1, Periods.Count);
                var e = Math.Clamp(c.EndPeriod, s, Periods.Count);
                var lane = laneEnds.FindIndex(end => end < s);
                if (lane < 0) { lane = laneEnds.Count; laneEnds.Add(e); }
                else laneEnds[lane] = e;
                tmp.Add((c, s - 1, e - s + 1, lane));
            }
            var lanes = Math.Max(1, laneEnds.Count);
            foreach (var (c, row, span, lane) in tmp.OrderBy(t => t.Row).ThenBy(t => t.Lane))
                DayGrid[d].Add(new GridCard(c.Id, c.Name, c.Location, c.Category, row, span, lane, lanes));
        }
    }

    /// <summary>设置学期起始（自动对齐到所在周的周一），重算教学周</summary>
    public IActionResult OnPostSemesterStart()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (SemesterStartInput is null) return RedirectToPage("/Courses/Index");

        var monday = MondayOf(SemesterStartInput.Value.Date).ToString("yyyy-MM-dd");
        var setting = _db.AppSettings.FirstOrDefault(s => s.Key == "courses.semester-start");
        if (setting is null)
            _db.AppSettings.Add(new AppSetting { Key = "courses.semester-start", Value = monday });
        else
            setting.Value = monday;
        _db.SaveChanges();
        return RedirectToPage("/Courses/Index");
    }

    /// <summary>小节配置 → 大节视图（相邻两两配对；中文序数标题）</summary>
    public static BlockInfo[] BuildBlocks(List<PeriodSlot> periods)
    {
        var blocks = new List<BlockInfo>();
        for (var i = 0; i < periods.Count; i += 2)
        {
            var first = periods[i];
            var hasSecond = i + 1 < periods.Count;
            var sub = hasSecond
                ? $"{(i + 1):D2}{(i + 2):D2}小节"
                : $"{(i + 1):D2}小节";
            var hours = hasSecond
                ? $"{first.Start}～{periods[i + 1].End}"
                : $"{first.Start}～{first.End}";
            blocks.Add(new BlockInfo($"第{CnOrdinal(blocks.Count + 1)}大节", sub, hours));
        }
        return [.. blocks];
    }

    private static string CnOrdinal(int n) => n switch
    {
        1 => "一", 2 => "二", 3 => "三", 4 => "四", 5 => "五", 6 => "六",
        7 => "七", 8 => "八", 9 => "九", 10 => "十", 11 => "十一", 12 => "十二",
        _ => n.ToString(),
    };

    private static List<Course>[][] CreateCells(int blockCount)
    {
        var cells = new List<Course>[blockCount][];
        for (var b = 0; b < blockCount; b++)
        {
            cells[b] = new List<Course>[DayCount];
            for (var d = 0; d < DayCount; d++) cells[b][d] = [];
        }
        return cells;
    }

    private static List<GridCard>[] CreateDays()
    {
        var days = new List<GridCard>[DayCount];
        for (var d = 0; d < DayCount; d++) days[d] = [];
        return days;
    }

    /// <summary>取所在周的周一（周一是第 1 天）</summary>
    private static DateTime MondayOf(DateTime d) =>
        d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
