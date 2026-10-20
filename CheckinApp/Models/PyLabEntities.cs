namespace CheckinApp.Models;

// ═══════════════════════════════════════════════════════════════════════
//  PyLab 临时模块的实体（《Python 程序设计》教学平台）
//  整个模块的拆除方式见 docs/pylab-module.md：
//    删本文件 + Models/ 下 PyLab* 、Data/AppDbContext.PyLab.cs、
//    Services/PyLab*.cs、Pages/PyLab*、tools/pylab/、一份迁移，
//    外加 Security/NavCatalog.cs 与 PermissionCatalog.cs 各一行。
//  所有表都按 UserId 隔离，删用户时级联清干净（不留下孤儿数据）。
// ═══════════════════════════════════════════════════════════════════════

/// <summary>
/// 班级名单里的一个学生。点名器从这里抽人，考勤也挂在这上面。
/// 同一个用户可以有多个班级（ClassName 相同即同班），点名时可只抽某个班。
/// </summary>
public class PyLabStudent
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>学号（可空：很多老师只想要名字）</summary>
    public string StudentNo { get; set; } = "";
    public required string Name { get; set; }
    /// <summary>班级名（可空 = 未分班）</summary>
    public string ClassName { get; set; } = "";
    /// <summary>名单里的原始顺序（导入顺序，点名表按它展示）</summary>
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 一次考勤记录。故意做成「一行人一次」，而不是「一人一行累加」——
/// 累加型一旦记错就没法撤销，流水型可以按时间回看是谁哪天记的，也能直接删。
/// </summary>
public class PyLabAttendance
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public int StudentId { get; set; }
    public PyLabStudent? Student { get; set; }
    /// <summary>点名当时的姓名快照（学生被删后统计仍能显示人名，不留空白）</summary>
    public string StudentName { get; set; } = "";
    /// <summary>present 出勤 / late 迟到 / absent 缺勤</summary>
    public required string Status { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>课件分类（如「第一章 基础语法」），纯用户自定义，删分类不删课件（课件回到未分类）。</summary>
public class PyLabDeckCategory
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required string Name { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 一份上传的课件。原始 ppt 与逐页 PNG 都放在 data/pylab/{UserId}/deck_{Id}/ 下，
/// 库里只记相对路径与页数——图不放数据库（SQLite 塞二进制会拖垮备份）。
/// </summary>
public class PyLabDeck
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>展示标题（默认取上传文件名去后缀，可改）</summary>
    public required string Title { get; set; }
    /// <summary>所属分类；null = 未分类</summary>
    public int? CategoryId { get; set; }
    public PyLabDeckCategory? Category { get; set; }
    public string OriginalFileName { get; set; } = "";
    /// <summary>转换状态：pending 排队 / ready 可播放 / failed 失败（Error 里有原因）</summary>
    public string Status { get; set; } = "pending";
    public string Error { get; set; } = "";
    /// <summary>转好的页数（= 图片张数），播放器的上界</summary>
    public int PageCount { get; set; }
    /// <summary>源文件字节数（列表里显示体积，也用来拦超大文件）</summary>
    public long SizeBytes { get; set; }
    /// <summary>用的哪个转换引擎：powerpoint / libreoffice（排查「为什么这台机器转不了」用）</summary>
    public string Engine { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 第 N 页挂哪个代码片段 —— 功能③「PPT 内嵌代码演示」的骨架。
/// 静态图片没有超链接，所以「页 → 片段」的对应关系必须由这张表提供；
/// 好处是页码是硬坐标（第 3 页永远显示第 3 张图），比外部播放器里猜页码可靠得多。
/// </summary>
public class PyLabDeckSnippet
{
    public int Id { get; set; }
    public int DeckId { get; set; }
    public PyLabDeck? Deck { get; set; }
    /// <summary>页码，从 1 开始</summary>
    public int PageNo { get; set; }
    /// <summary>片段 id（tools/pylab/main.py 里 SNIPPETS 的 key，如 s03_loop）</summary>
    public required string SnippetId { get; set; }
}