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

    /// <summary>手机课表网格卡片：Row=起始行(0基)、Span=跨行数、Lane/Lanes=同日撞课分列</summary>
    /// <param name="Color">色板键（已算好：用户设过的优先，否则按课名默认）</param>
    /// <param name="OffWeek">true = 这门课本周不上（设置里打开了「显示非本周课程」才画，画成虚化）</param>
    public record GridCard(int Id, string Name, string Location, string Color, bool OffWeek,
                           int Row, int Span, int Lane, int Lanes);

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

    /// <summary>当前学期（页面顶部要显示它的名字，学期切换也靠它）</summary>
    public Semester CurrentSemester { get; private set; } = new();
    public DateTime Today { get; private set; } = SiteClock.Today;

    /// <summary>节次配置（节数 = Periods.Count，可自定义）</summary>
    public List<PeriodSlot> Periods { get; private set; } = [.. CoursesConfig.Default];
    public int PeriodCount => Periods.Count;

    [BindProperty] public DateTime? SemesterStartInput { get; set; }

    /// <summary>DayGrid[星期] → 网格卡片（已按周次过滤 + 撞课分列）</summary>
    public List<GridCard>[] DayGrid { get; private set; } = CreateDays();

    public void OnGet(int? week)
    {
        if (_me.UserId is not int uid) return;
        Today = SiteClock.Today;

        // 学期：现在是一张表（可多个、可切换）。没有就自动建一个，起始日沿用老的 AppSetting。
        var sem = SemesterService.Current(_db, uid);
        CurrentSemester = sem;
        SemesterConfigured = true;
        SemesterStart = sem.StartDate;
        SemesterStartInput = SemesterStart;

        CurrentWeek = Math.Max(1, (int)((Today - SemesterStart).TotalDays / 7) + 1);
        Week = Math.Clamp(week ?? CurrentWeek, 1, 30);
        WeekStart = SemesterStart.AddDays((Week - 1) * 7);

        // 节次配置：格子左侧的时间字串直接来自它。
        // 不再做「相邻两节配成一大节」的猜测 —— 作息一旦不是两两成对（比如按 6 大节配），
        // 那套配对拼出来的时段就是错的，和 App 端逐节显示的时间对不上。
        Periods = CoursesConfig.Load(_db);

        // 「显示非本周课程」开关：没设置过按开处理（看不到课会以为丢了）
        var offSetting = _db.AppSettings.FirstOrDefault(s => s.Key == ShowOffWeekKey);
        ShowOffWeek = offSetting is null || offSetting.Value != "0";

        // 只取当前学期的课：切到上学期就该看到上学期的课表，而不是所有学期的课叠在一起
        var courses = _db.Courses.Where(c => c.UserId == uid && c.SemesterId == sem.Id).ToList();
        foreach (var c in courses)
            if (Weeks.Includes(c.WeeksText, Week)) ThisWeekCount++;

        // 网格：按星期分列，撞课同日多车道并排（贪心区间着色）
        DayGrid = CreateDays();
        var perDay = new List<(Course C, bool Off)>[DayCount];
        for (var d = 0; d < DayCount; d++) perDay[d] = [];
        foreach (var c in courses)
        {
            var inWeek = Weeks.Includes(c.WeeksText, Week);
            if (!inWeek && !ShowOffWeek) continue;
            if (c.EndPeriod < 1 || c.StartPeriod > Periods.Count) continue;   // 整节都在配置范围外
            perDay[Math.Clamp(c.Weekday, 1, 7) - 1].Add((c, !inWeek));
        }
        for (var d = 0; d < DayCount; d++)
        {
            // 非本周的课：与任何本周课时间重叠就不画。否则两块并排分车道，
            // 本周真正要上的那门被挤成半宽、课程名只能一字一行（App 端就是这么过滤的）。
            var onWeek = perDay[d].Where(x => !x.Off).ToList();
            var draw = perDay[d]
                .Where(x => !x.Off || onWeek.All(a =>
                    x.C.EndPeriod < a.C.StartPeriod || a.C.EndPeriod < x.C.StartPeriod))
                .ToList();

            // 先按开始节次排出「时间上真的撞在一起」的簇（clusters）。
            // 必须按簇算车道数，不能按整天算：一天 7 门课若全用同一个 lane 数，
            // 每张卡都只有 1/4 宽（手机上一格 78px → 19px），课程名会被挤成一字一行，
            // 而实际上早上那两门并列、下午那门独占整行，根本不冲突。
            var sorted = draw
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

    /// <summary>设置当前学期的起始日（自动对齐到所在周的周一）</summary>
    public IActionResult OnPostSemesterStart()
    {
        if (_me.UserId is not int uid) return RedirectToPage("/Login");
        if (SemesterStartInput is null) return RedirectToPage("/Courses/Index");

        var sem = SemesterService.Current(_db, uid);
        SemesterService.Update(_db, uid, sem.Id, null, SemesterStartInput.Value);
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
