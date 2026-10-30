namespace CheckinApp.Models;

/// <summary>用户表 —— 只存哈希，绝不存明文密码。</summary>
public class User
{
    public int Id { get; set; }
    public required string Username { get; set; }
    public required string PasswordHash { get; set; }
    public required string DisplayName { get; set; }
    /// <summary>联系邮箱（个人主页可改；仅本人和管理员可见）</summary>
    public string Email { get; set; } = "";
    /// <summary>个性签名（个人主页可改，显示在自己的个人主页）</summary>
    public string Signature { get; set; } = "";
    public int RoleId { get; set; }
    public Role? Role { get; set; }
    /// <summary>主题偏好：editorial / neumorphism / natural / macos / clay（跨设备兜底，本机 localStorage 优先）</summary>
    public string Theme { get; set; } = "editorial";
    /// <summary>强调色变体：仅 neumorphism / macos / clay 三套可换；单色主题留空</summary>
    public string Accent { get; set; } = "";
    /// <summary>底色系（data-tone）：每套主题的背景/卡片色系，空 = 默认底色</summary>
    public string Tone { get; set; } = "";
    /// <summary>
    /// 工作台卡片布局 JSON：{"pinned":[...],"order":[...],"hidden":[...]}（卡片 id 三组）。
    /// 空 = 默认顺序全部显示；写入前白名单校验（见 PreferencesModel.OnPostDashboard）。
    /// </summary>
    public string DashboardLayout { get; set; } = "";
    /// <summary>停用账号 = false，不删行（保留数据）</summary>
    public bool IsActive { get; set; } = true;
    /// <summary>首登/重置后强制改密码标志：true 时除改密码/退出外全部被重定向到 /ChangePassword</summary>
    public bool MustChangePassword { get; set; } = false;
    /// <summary>
    /// 工作台「测试数据」提示条是否已处理过：用户点过一次「一键删除」就置 true，
    /// 以后哪怕又生成过测试数据，首页都不再弹这个提示（避免反复打扰）。
    /// </summary>
    public bool SamplePromptDismissed { get; set; } = false;
    /// <summary>注册来源 IP（审计用：垃圾号可据此溯源，也便于后台按 IP 段排查）</summary>
    public string RegisterIp { get; set; } = "";
    /// <summary>
    /// 侧栏自定义：被隐藏的导航项 code 的 JSON 数组，如 ["email","stats"]。
    /// 只存「藏了哪些」，不存全量顺序 —— 以后新增模块不用改用户数据，默认就是显示。
    /// </summary>
    public string NavHidden { get; set; } = "";
    /// <summary>
    /// 记账分类（JSON 数组，如 ["餐饮","交通","宠物"]）。空 = 用内置默认那 7 个。
    /// 存**全量列表**而不是「改了哪些」：用户删掉的分类不该下次又被自动加回来。
    /// 写入前统一走 ExpenseCategoryCatalog.Normalize（去重 / 限长 / 限量）。
    /// </summary>
    public string ExpenseCategories { get; set; } = "";

    /// <summary>
    /// 小游戏的默认设置（JSON 对象，见 Services/GameSettingsCatalog.cs）。空 = 全部默认。
    /// 只影响**自己新建的房间**：盘面大小、规则、限时这些一开局就快照进 GameRoom，
    /// 已开打的房间不会因为你改设置而中途变形。
    /// </summary>
    public string GameSettings { get; set; } = "";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}

/// <summary>
/// 邀请码 —— 自用小站的「请柬」，本站不做开放注册。
/// 一次性（UsedAt 有值即作废）、可设有效期、可撤销；被管理员用来决定「谁能进来、进来是什么角色」。
/// 攻击者没有码就无法落到数据库，比任何验证码都彻底。
/// </summary>
public class Invitation
{
    public int Id { get; set; }
    /// <summary>邀请码本体（分组大写，如 ANLE-8F3K-2Q7M；唯一索引）</summary>
    public required string Code { get; set; }
    /// <summary>备注：发给谁用的（纯管理用，注册页看不到）</summary>
    public string Note { get; set; } = "";
    /// <summary>谁生成的（审计；生成者被删不影响邀请码本身，故可空 + 不级联）</summary>
    public int? CreatedByUserId { get; set; }
    public User? CreatedBy { get; set; }
    /// <summary>用这个码注册出来的账号给什么角色（默认「普通用户」）</summary>
    public int RoleId { get; set; }
    public Role? Role { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddDays(7);
    /// <summary>被谁用掉了（一次性；有值 = 已使用，不能再复用）</summary>
    public int? UsedByUserId { get; set; }
    public User? UsedBy { get; set; }
    public DateTime? UsedAt { get; set; }
    /// <summary>管理员手工撤销（不用删行，保留可追溯性）</summary>
    public bool Revoked { get; set; }
}

/// <summary>角色表 —— 支持后台自定义；IsBuiltin 两内置角色不可删（防自锁）。</summary>
public class Role
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string Description { get; set; } = "";
    public bool IsBuiltin { get; set; }
    public List<RolePermission> RolePermissions { get; set; } = new();
    public List<User> Users { get; set; } = new();
}

/// <summary>权限表 —— 权限码由代码启动时播种，库里只读。</summary>
public class Permission
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public required string Module { get; set; }
    public string Description { get; set; } = "";
    public List<RolePermission> RolePermissions { get; set; } = new();
}

/// <summary>角色-权限桥表（多对多，联合主键，满足 1NF/2NF/3NF）。</summary>
public class RolePermission
{
    public int RoleId { get; set; }
    public Role? Role { get; set; }
    public int PermissionId { get; set; }
    public Permission? Permission { get; set; }
}

/// <summary>
/// 日程项 —— M3 第一个真功能模块。
/// 三大范式自查：1NF 字段原子（时间单值不拆）；2NF 主键 Id 决定全部（无部分依赖）；
/// 3NF 无传递依赖（只存 UserId，用户名/角色通过 Join 取，不冗余进本表）。
/// </summary>
public class ScheduleItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required string Title { get; set; }
    public string Description { get; set; } = "";
    /// <summary>开始时间（用户输入的本地时间，不做时区换算 —— 同地区小站够用）</summary>
    public DateTime StartAt { get; set; }
    /// <summary>结束时间（可选；全天事件留空）</summary>
    public DateTime? EndAt { get; set; }
    /// <summary>全天事件（无具体时点）</summary>
    public bool AllDay { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>最后修改时间（与 MemoItem 对齐；编辑时刷新）</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 备忘便签 —— M4 模块。
/// 三大范式自查：1NF 字段原子；2NF 主键 Id 决定全部；3NF 只存 UserId 不冗余用户信息。
/// </summary>
public class MemoItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required string Title { get; set; }
    /// <summary>便签正文（多行）</summary>
    public string Content { get; set; } = "";
    /// <summary>置顶：true 时排在便签墙最前 + 工作台首页展示</summary>
    public bool Pinned { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// ==================== M5 生活模块群（一次性入住 8 组实体） ====================

/// <summary>习惯定义 —— 打卡模块的「习惯」主表。</summary>
public class Habit
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required string Name { get; set; }
    /// <summary>图标（单个 emoji 或符号字符）</summary>
    public string Icon { get; set; } = "🌱";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>打卡记录 —— 一个习惯一天最多一条（联合唯一索引兜底）。</summary>
public class HabitCheckin
{
    public int Id { get; set; }
    public int HabitId { get; set; }
    public Habit? Habit { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>打卡日期（只用日期部分，时分秒忽略）</summary>
    public DateTime CheckinDate { get; set; }
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>课程 —— 课程表模块。周视图按 大节×星期 渲染，颜色由课程类别决定。</summary>
public class Course
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>
    /// 所属学期。可空是为了兼容迁移前的旧数据 —— 迁移时会把它们挂到自动建好的默认学期上，
    /// 之后新建的课程一律带 SemesterId。
    /// </summary>
    public int? SemesterId { get; set; }
    public Semester? Semester { get; set; }
    public required string Name { get; set; }
    public string Teacher { get; set; } = "";
    public string Location { get; set; } = "";
    /// <summary>星期几：1=周一 … 7=周日</summary>
    public int Weekday { get; set; }
    /// <summary>开始节次（1 起，小节）</summary>
    public int StartPeriod { get; set; }
    /// <summary>结束节次（含，小节）</summary>
    public int EndPeriod { get; set; }
    /// <summary>上课周次描述，如 "1-16" / "1-8,10-16" / "单周" / "双周"</summary>
    public string WeeksText { get; set; } = "1-16";
    /// <summary>课程类别：required=必修 / college=院级选修 / school=校级选修 / other=其它（说明性字段，不再决定配色）</summary>
    public string Category { get; set; } = "other";
    /// <summary>
    /// 卡片配色色板键（如 "violet" / "blue"）。空 = 还没分配，读的时候按课程名现算默认色。
    /// 配色从「按类别」改成「按课程」：同一门课（同名）整个学期同一个颜色，一眼能顺着找。
    /// </summary>
    public string Color { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>全局小设置（键值对）。目前存课程表学期起始周一日期（courses.semester-start，ISO 日期）。</summary>

/// <summary>
/// 学期。一门课属于某一个学期，「切换学期」= 换一个当前学期，课表只显示它下面的课。
///
/// 【为什么单独建表而不是塞进 AppSetting】
/// 学期要能有好几个并存（这学期 / 上学期 / 下学期），还要给每个学期存名字和起始日、
/// 以及「哪一个是当前」。用 JSON 塞进 AppSetting 的话，删除学期时课程归谁、当前学期是谁
/// 这些一致性全靠字符串约定，出错难查；建表让数据库管外键和级联。
/// </summary>
public class Semester
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>学期名，如「2026 秋」。空则由起始日自动生成</summary>
    public string Name { get; set; } = "";
    /// <summary>第 1 周的周一（周次都从这里推）</summary>
    public DateTime StartDate { get; set; }
    /// <summary>是不是「当前学期」。同一个用户只会有一个为 true（切换时在服务端保证）</summary>
    public bool IsCurrent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AppSetting
{
    public int Id { get; set; }
    public required string Key { get; set; }
    public string Value { get; set; } = "";
}

/// <summary>纪念日 —— 支持每年重复；倒计时/已过天数由页面实时算。</summary>
public class AnniversaryItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required string Title { get; set; }
    /// <summary>纪念日日期（用户输入的本地日期）</summary>
    public DateTime Date { get; set; }
    /// <summary>每年重复：true 时按月日循环倒计时</summary>
    public bool RepeatYearly { get; set; } = true;
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>情侣空间配置 —— 全站单行（Id=1）：在一起起始日 + 称呼。</summary>
public class CoupleSetting
{
    public int Id { get; set; }
    /// <summary>在一起的日期（恋爱天数从这天起算）</summary>
    public DateTime StartDate { get; set; }
    /// <summary>标题，如「A &amp; B」</summary>
    public string Title { get; set; } = "我们在一起";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>情侣小纸条 —— 仅 couples.view 权限可见的互发留言。</summary>
public class LoveNote
{
    public int Id { get; set; }
    /// <summary>发送者</summary>
    public int FromUserId { get; set; }
    public User? FromUser { get; set; }
    public required string Content { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>留言板 —— 小圈子公开留言（所有 board.use 用户可见）。</summary>
public class BoardMessage
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required string Content { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>记账流水 —— Type: out=支出 / in=收入；Amount 恒为正数。</summary>
public class ExpenseItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>金额（正数；方向看 Type）</summary>
    public decimal Amount { get; set; }
    /// <summary>out=支出 / in=收入</summary>
    public string Type { get; set; } = "out";
    /// <summary>分类：餐饮/交通/学习/娱乐/日用/其他（或自填）</summary>
    public string Category { get; set; } = "其他";
    /// <summary>发生日期</summary>
    public DateTime OccurDate { get; set; }
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>经期记录 —— 数据严格按 UserId 隔离，仅本人可见。</summary>
public class PeriodRecord
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>开始日期</summary>
    public DateTime StartDate { get; set; }
    /// <summary>结束日期（未结束留空）</summary>
    public DateTime? EndDate { get; set; }
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// AI 对话消息 —— 每用户独立的对话历史。
/// Role: user=用户 / assistant=AI。ActionsJson 存待确认的建议单（空串=纯聊天）。
/// </summary>
public class AiMessage
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>user / assistant</summary>
    public required string Role { get; set; }
    public string Content { get; set; } = "";
    /// <summary>建议单 JSON（assistant 消息独有）；执行后清空</summary>
    public string ActionsJson { get; set; } = "";
    /// <summary>随消息附带的图片 MIME（空 = 无图）。图片只做单次打包：存一次、只随当轮请求发送。</summary>
    public string ImageMime { get; set; } = "";
    /// <summary>图片二进制（前端已压缩到 ≤1600px JPEG，通常 100-400KB）。列表查询时不加载这列。</summary>
    public byte[]? ImageData { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ==================== M7 邮件模块 ====================

/// <summary>
/// 每日邮件提醒设置 —— 每人至多一行。
/// 开启后，后台服务在指定整点把「提醒摘要」（今日日程/近 7 天纪念日/打卡进度/置顶备忘）发到收件邮箱；
/// 发信复用该用户已绑定邮箱账号的 SMTP 与授权码，不额外存第二份密码。
/// </summary>
public class MailReminderSetting
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>是否开启每日提醒</summary>
    public bool Enabled { get; set; }
    /// <summary>每天几点发（0-23，服务器本地时间）</summary>
    public int Hour { get; set; } = 8;
    /// <summary>收件地址；留空 = 用发信账号自己的地址</summary>
    public string ToAddress { get; set; } = "";
    /// <summary>用哪个邮箱账号发信（必须是本人的 EmailAccount）</summary>
    public int? AccountId { get; set; }
    /// <summary>最近一次成功发送的日期（只比日期部分，防同一天重复发）</summary>
    public DateTime? LastSentDate { get; set; }
    /// <summary>最近一次失败原因（空 = 正常）</summary>
    public string LastError { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 邮箱账号 —— 每用户绑定自己的邮箱（QQ/163/Gmail/Outlook…全走 IMAP 通用协议）。
/// 授权码 AES-GCM 加密存储，绝不落明文；密钥在配置/环境变量，不进库不进 git。
/// </summary>
public class EmailAccount
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>显示名称（如「QQ 主邮箱」）</summary>
    public required string DisplayName { get; set; }
    /// <summary>邮箱地址</summary>
    public required string Address { get; set; }
    /// <summary>平台预设键：qq / 163 / 126 / yeah / gmail / outlook / 139 / 189 / custom</summary>
    public string Provider { get; set; } = "custom";
    public string ImapHost { get; set; } = "";
    public int ImapPort { get; set; } = 993;
    /// <summary>SMTP 发信（第二期发信用；第一期只收信，先存着）</summary>
    public string SmtpHost { get; set; } = "";
    public int SmtpPort { get; set; } = 465;
    /// <summary>授权码密文（AES-GCM：nonce+tag+cipher 的 base64）</summary>
    public string AuthCodeEnc { get; set; } = "";
    /// <summary>最近一次同步时间（UTC）</summary>
    public DateTime? LastSyncAt { get; set; }
    /// <summary>
    /// 同步时间范围（天）。0 = 用全局默认。
    /// 拉新邮件时按「最近 N 天」过滤，超出的旧邮件不落库。
    /// </summary>
    public int SyncDays { get; set; }
    /// <summary>
    /// 同步条数上限。0 = 用全局默认。
    /// 拉新邮件时按「最近 N 封」兜底，防止一次同步把几年的信全灌进来。
    /// </summary>
    public int SyncCount { get; set; }
    /// <summary>最近一次同步错误（空 = 正常）；网络/授权码问题都记这里，页面直接展示</summary>
    public string LastSyncError { get; set; } = "";
    /// <summary>IMAP UIDVALIDITY —— 服务器邮箱「指纹」，若变化说明服务器重建过邮箱，本地缓存作废重拉</summary>
    public long UidValidity { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// 邮件缓存 —— 同步只拉信头+摘要入库；正文首次阅读时拉取并缓存（BodyText）。
/// 这样列表页轻、2核2G 的服务器不吃存储。
/// </summary>
public class EmailMessage
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public EmailAccount? Account { get; set; }
    /// <summary>冗余 UserId 做越权围栏（查询直接按 UserId 挡，不靠 join 二次判断）</summary>
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>IMAP 文件夹（第一期只收 INBOX）</summary>
    public string Folder { get; set; } = "INBOX";
    /// <summary>IMAP UID（文件夹内唯一；重拉同 UID 幂等不重复）</summary>
    public long Uid { get; set; }
    /// <summary>信头 Message-ID（去重/排查用）</summary>
    public string MessageId { get; set; } = "";
    public string FromName { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string ToAddress { get; set; } = "";
    public string Subject { get; set; } = "(无主题)";
    /// <summary>正文摘要（列表页展示；正文前一段的纯文本）</summary>
    public string Snippet { get; set; } = "";
    /// <summary>正文纯文本（首次阅读时拉取缓存；空 = 还没拉过）</summary>
    public string BodyText { get; set; } = "";
    /// <summary>发件时间（信头时间，服务器为准）</summary>
    public DateTime SentAt { get; set; }
    /// <summary>已读标记（本产品自身状态；与服务器 \\Seen 的双向同步放第二期）</summary>
    public bool IsRead { get; set; }
    /// <summary>带附件（信头 BodyStructure 推断，不下载附件本体）</summary>
    public bool HasAttachment { get; set; }
    /// <summary>信件大小（字节，信头给的估值）</summary>
    public long SizeBytes { get; set; }
    /// <summary>入库时间</summary>
    public DateTime FetchedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// AI 每日用量（按用户 + 自然日一行）。token 数来自接口返回的 usage，
/// 接口没给时用「字符数/3」估算 —— 宁可略微高估，也不要静默把配额算成 0。
/// 每日上限见 appsettings 的 Ai.DailyTokenLimit。
/// </summary>
public class AiUsageDaily
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>日期（UTC 日期部分，与 AiMessages.CreatedAt 的口径一致）</summary>
    public DateTime Day { get; set; }
    public long PromptTokens { get; set; }
    public long CompletionTokens { get; set; }
    public long TotalTokens { get; set; }
    /// <summary>当天请求次数（含兜底重试）</summary>
    public int Requests { get; set; }
}

// ==================== 小游戏 ====================

/// <summary>
/// 对局房间 —— 目前只有五子棋（GameKey = "gomoku"），字段留了扩展位。
///
/// 为什么走「一行房间 + 走子 JSON」而不是「一手一行」：
/// 五子棋一盘最多 225 手，整盘序列化也就几 KB；一行 = 一次读取拿到全量状态，
/// 轮询接口不用 join、也不用分页。落子用 <see cref="Revision"/> 做条件更新防并发双落。
/// </summary>
public class GameRoom
{
    public int Id { get; set; }

    /// <summary>房间码（6 位，去掉易混的 0/O/1/I）。口头报给朋友就能进</summary>
    public required string Code { get; set; }

    /// <summary>游戏类型：gomoku（将来可加别的，一套房间/轮询逻辑复用）</summary>
    public string GameKey { get; set; } = "gomoku";

    public int HostUserId { get; set; }
    public User? Host { get; set; }
    public int? GuestUserId { get; set; }
    public User? Guest { get; set; }

    /// <summary>房主执哪一方：1 = 黑（先手），2 = 白。对手方自动取另一方</summary>
    public int HostSide { get; set; } = 1;

    /// <summary>AI 等级：0 = 人类 guest（现状）；&gt;0 = AI 对局，GuestUserId 恒为 null，AI 执 HostSide 的对方</summary>
    public int AiLevel { get; set; }

    /// <summary>waiting（等人）/ playing（进行中）/ finished（终局，棋盘保留可复盘）</summary>
    public string Status { get; set; } = "waiting";

    /// <summary>轮到哪一方（1 黑 / 2 白）</summary>
    public int Turn { get; set; } = 1;

    /// <summary>走子序列 JSON：[{"x":7,"y":7,"s":1}, …]（x 列、y 行，从 0 开始；s 为落子方）</summary>
    public string MovesJson { get; set; } = "";

    /// <summary>0 = 未分胜负，1 = 黑胜，2 = 白胜，3 = 和棋</summary>
    public int Winner { get; set; }

    /// <summary>终局原因：five（五连）/ overline（黑方长连判负）/ timeout（超时）/ resign（认输）/ draw（棋盘满）</summary>
    public string ResultReason { get; set; } = "";

    // ---------------- 本局规则（建房时从房主的默认设置快照过来，两边看到的是同一套） ----------------

    /// <summary>盘面大小：13 / 15 / 19</summary>
    public int Size { get; set; } = 15;

    /// <summary>黑方长连（六连以上）判负。false = 自由规则，长连也算赢</summary>
    public bool Forbidden { get; set; }

    /// <summary>单步限时（秒），0 = 不限</summary>
    public int MoveTimeoutSec { get; set; }

    /// <summary>每方总用时上限（秒），0 = 不限</summary>
    public int TotalTimeoutSec { get; set; }

    /// <summary>当前这一手从什么时候开始算（落子后重置）</summary>
    public DateTime? TurnStartedAt { get; set; }

    /// <summary>双方已用毫秒（暂停不扣，只在落子时结算）</summary>
    public long HostUsedMs { get; set; }
    public long GuestUsedMs { get; set; }

    /// <summary>状态版本号：任何变化 +1。客户端拿它判断「这轮轮询要不要重绘」</summary>
    public int Revision { get; set; }

    /// <summary>最后在线时刻（每次轮询刷新）—— 用来显示「对手已离开」</summary>
    public DateTime? HostSeenAt { get; set; }
    public DateTime? GuestSeenAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }

    /// <summary>
    /// 飞行棋专属：座位唯一真相（2/3/4 座 JSON 数组），其余五款恒 null 不读不写。
    /// 读到 null 时按 Host/Guest 懒回填 2 座（存量 2 人局零漂移）。
    /// 结构：[{seat,side,color,uid|null=AI,isAi,usedMs,seenAt,active}]，seat0=房主。
    /// </summary>
    public string? SeatsJson { get; set; }
}

/// <summary>
/// 单机游戏最高分 —— 一人一游戏一行，只存最高分（不需要每局历史）。
/// 防作弊：服务端 <c>BestScore = max(旧值, 新值)</c> 幂等更新（分数只增不减），
/// 加上限 + 限速（见 Services/GameScores.cs）。删用户级联清除。
/// </summary>
public class GameScore
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>游戏 key："fish" / "melon"</summary>
    public required string GameKey { get; set; }
    /// <summary>最高分（只增不减）</summary>
    public int BestScore { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
