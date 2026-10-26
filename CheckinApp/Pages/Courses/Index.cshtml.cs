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
    /// <param name="Color">色板键（已算好：用户设过的优先，否则按课名默认）</param>
    /// <param name="OffWeek">true = 这门课本周不上（设置里打开了「显示非本周课程」才画，画成虚化）</param>
    public record GridCard(int Id, string Name, string Location, string Color, bool OffWeek,
                           int Row, int Span, int Lane, int Lanes);

    /// <summary>表格单元格里的一门课（桌面大节视图用）</summary>
    public record CellCard(int Id, string Name, string Teacher, string Location, string WeeksText,
                          string Color, bool OffWeek);

    /// <summary>课程类别 → 只作说明字段（配色已改成按课程，见 CoursePalette）</summary>
    public static readonly (string Slug, string Label)[] Categories =
    [
        ("required", "必修课"), ("college", "院级选修课"), ("school", "校级选修课"), ("other", "其它"),
    ];

    /// <summary>设置键：是否把「本周不上」的课程以虚化形式画出来</summary>
    public const string ShowOffWeekKey = "courses.show-offweek";

    public const int DayCount = 7;        // 星期数

    /// <summary>是否显示非本周课程（默认开：看不到会以为课丢了）</summary>
    public bool ShowOffWeek { get; private set; } = true;
    /// <summary>本周实际有几门课（用来决定「本周没有课」提示要不要出现）</summary>
    public int ThisWeekCount { get; private set; }

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

    /// <summary>Cells[大节][星期] → 课程列表（含本周与非本周，非本周由 OffWeek 标出）</summary>
    public List<CellCard>[][] Cells { get; private set; } = [];

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

        // 「显示非本周课程」开关：没设置过按开处理（看不到课会以为丢了）
        var offSetting = _db.AppSettings.FirstOrDefault(s => s.Key == ShowOffWeekKey);
        ShowOffWeek = offSetting is null || offSetting.Value != "0";

        var courses = _db.Courses.Where(c => c.UserId == uid).ToList();
        foreach (var c in courses)
        {
            // 本周上不上：非本周的照样进网格（虚化显示），但不算进 ThisWeekCount
            var inWeek = Weeks.Includes(c.WeeksText, Week);
            if (!inWeek && !ShowOffWeek) continue;
            if (inWeek) ThisWeekCount++;

            var color = CoursePalette.Of(c);
            var card = new CellCard(c.Id, c.Name, c.Teacher, c.Location, c.WeeksText, color, !inWeek);

            var d = Math.Clamp(c.Weekday, 1, 7) - 1;
            for (var b = 0; b < Blocks.Length; b++)
            {
                // 大节 b 覆盖小节 (2b+1, 2b+2)；课程与其有交集就在该行出现（跨大节连上会占多行，与教务一致）
                if (c.StartPeriod <= b * 2 + 2 && c.EndPeriod >= b * 2 + 1)
                    Cells[b][d].Add(card);
            }
        }
        // 本周的排前面：同一格既有本周又有非本周时，先看到的是真正要上的那门
        foreach (var row in Cells)
            foreach (var cell in row)
                cell.Sort((a, b) => a.OffWeek != b.OffWeek
                    ? (a.OffWeek ? 1 : 0) - (b.OffWeek ? 1 : 0)
                    : string.CompareOrdinal(a.Name, b.Name));

        // 手机网格：按星期分列，撞课同日多车道并排（贪心区间着色）
        DayGrid = CreateDays();
        var perDay = new List<(Course C, bool Off)>[DayCount];
        for (var d = 0; d < DayCount; d++) perDay[d] = [];
        foreach (var c in courses)
        {
            var inWeek = Weeks.Includes(c.WeeksText, Week);
            if (!inWeek && !ShowOffWeek) continue;
            var s = Math.Clamp(c.StartPeriod, 1, Periods.Count);
            var e = Math.Clamp(c.EndPeriod, s, Periods.Count);
            if (c.EndPeriod < 1 || c.StartPeriod > Periods.Count) continue;   // 整节都在配置范围外
            perDay[Math.Clamp(c.Weekday, 1, 7) - 1].Add((c, !inWeek));
        }
        for (var d = 0; d < DayCount; d++)
        {
            // 先按开始节次排出「时间上真的撞在一起」的簇（clusters）。
            // 必须按簇算车道数，不能按整天算：一天 7 门课若全用同一个 lane 数，
            // 每张卡都只有 1/4 宽（手机上一格 78px → 19px），课程名会被挤成一字一行，
            // 而实际上早上那两门并列、下午那门独占整行，根本不冲突。
            var sorted = perDay[d]
                .OrderBy(x => x.C.StartPeriod).ThenBy(x => x.C.EndPeriod).ToList();

            var clusters = new List<List<(Course C, bool Off, int S, int E)>>();
            foreach (var (c, off) in sorted)
            {
                if (c.EndPeriod < 1 || c.StartPeriod > Periods.Count) continue;
                var s = Math.Clamp(c.StartPeriod, 1, Periods.Count);
                var e = Math.Clamp(c.EndPeriod, s, Periods.Count);
                // 与上一簇的「最晚结束」不重叠 → 开新簇；重叠（含首尾相接）→ 并入
                if (clusters.Count == 0 || s > clusters[^1].Max(x => x.E))
                    clusters.Add([]);
                clusters[^1].Add((c, off, s, e));
            }

            foreach (var cluster in clusters)
            {
                // 本周的优先占道：非本周课不该把本周课挤成半宽
                var order = cluster.OrderBy(x => x.Off ? 1 : 0)
                                   .ThenBy(x => x.S).ThenBy(x => x.E).ToList();
                var laneEnds = new List<int>();      // 每条车道上一节课的结束节
                var tmp = new List<(Course C, bool Off, int Row, int Span, int Lane)>();
                foreach (var (c, off, s, e) in order)
                {
                    var lane = laneEnds.FindIndex(end => end < s);
                    if (lane < 0) { lane = laneEnds.Count; laneEnds.Add(e); }
                    else laneEnds[lane] = e;
                    tmp.Add((c, off, s - 1, e - s + 1, lane));
                }
                var lanes = Math.Max(1, laneEnds.Count);
                foreach (var (c, off, row, span, lane) in tmp.OrderBy(t => t.Row).ThenBy(t => t.Lane))
                    DayGrid[d].Add(new GridCard(c.Id, c.Name, c.Location, CoursePalette.Of(c), off,
                                                row, span, lane, lanes));
            }
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

    /// <summary>设置「显示非本周课程」开关（即点即存，返回原周次）</summary>
    /// <param name="show">
    /// 1 = 显示非本周课程，0 = 只看本周。
    /// 不能用 bool：ASP.NET Core 的 bool 模型绑定只认 "true"/"false"，
    /// 表单里传 "1"/"0" 会绑不上、静默变成 false —— 开关就只能往「关」的方向走，永远打不开。
    /// </param>
    public IActionResult OnPostToggleOffWeek(int? week, int show = 0)
    {
        if (_me.UserId is null) return RedirectToPage("/Login");
        var setting = _db.AppSettings.FirstOrDefault(s => s.Key == ShowOffWeekKey);
        var val = show != 0 ? "1" : "0";
        if (setting is null)
            _db.AppSettings.Add(new AppSetting { Key = ShowOffWeekKey, Value = val });
        else
            setting.Value = val;
        _db.SaveChanges();
        return RedirectToPage("/Courses/Index", new { week });
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

    private static List<CellCard>[][] CreateCells(int blockCount)
    {
        var cells = new List<CellCard>[blockCount][];
        for (var b = 0; b < blockCount; b++)
        {
            cells[b] = new List<CellCard>[DayCount];
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
