using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Data;

public partial class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<ScheduleItem> Schedules => Set<ScheduleItem>();
    public DbSet<MemoItem> Memos => Set<MemoItem>();
    public DbSet<Habit> Habits => Set<Habit>();
    public DbSet<HabitCheckin> HabitCheckins => Set<HabitCheckin>();
    public DbSet<Course> Courses => Set<Course>();
    public DbSet<Semester> Semesters => Set<Semester>();
    public DbSet<AnniversaryItem> Anniversaries => Set<AnniversaryItem>();
    public DbSet<CoupleSetting> CoupleSettings => Set<CoupleSetting>();
    public DbSet<LoveNote> LoveNotes => Set<LoveNote>();
    public DbSet<BoardMessage> BoardMessages => Set<BoardMessage>();
    public DbSet<ExpenseItem> Expenses => Set<ExpenseItem>();
    public DbSet<PeriodRecord> PeriodRecords => Set<PeriodRecord>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<AiMessage> AiMessages => Set<AiMessage>();
    public DbSet<EmailAccount> EmailAccounts => Set<EmailAccount>();
    public DbSet<EmailMessage> EmailMessages => Set<EmailMessage>();
    public DbSet<MailReminderSetting> MailReminderSettings => Set<MailReminderSetting>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<AiUsageDaily> AiUsageDailies => Set<AiUsageDaily>();
    /// <summary>App 接口令牌（Bearer），见 Models/ApiToken.cs</summary>
    public DbSet<ApiToken> ApiTokens => Set<ApiToken>();
    /// <summary>通知设置（本地提醒），一人一行</summary>
    public DbSet<NotifySetting> NotifySettings => Set<NotifySetting>();
    /// <summary>小游戏对局房间（五子棋），一行一盘</summary>
    public DbSet<GameRoom> GameRooms => Set<GameRoom>();
    /// <summary>单机游戏最高分，一人一游戏一行</summary>
    public DbSet<GameScore> GameScores => Set<GameScore>();

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<RolePermission>(e => e.HasKey(x => new { x.RoleId, x.PermissionId }));

        m.Entity<User>(e =>
        {
            e.HasIndex(x => x.Username).IsUnique();
            e.HasOne(x => x.Role).WithMany(r => r.Users).HasForeignKey(x => x.RoleId);
        });

        // 学期：删学期时连带删掉它下面的课（课离开学期没有意义，留着只会变成孤儿数据）
        m.Entity<Semester>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.IsCurrent });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
        });

        m.Entity<Course>(e =>
        {
            e.HasOne(x => x.Semester).WithMany()
                .HasForeignKey(x => x.SemesterId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.UserId, x.SemesterId });
        });

                m.Entity<Role>(e =>
        {
            e.HasIndex(x => x.Name).IsUnique();
            e.HasMany(x => x.RolePermissions).WithOne(x => x.Role).HasForeignKey(x => x.RoleId);
        });

        // 邀请码：Code 唯一（并发注册也只可能有一条落库）；按到期时间建索引便于清理/列表筛选
        m.Entity<Invitation>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => x.ExpiresAt);
            e.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.UsedBy).WithMany().HasForeignKey(x => x.UsedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        // AI 每日用量：一人一天一行（唯一索引兜底并发），加总时直接读这一行
        m.Entity<AiUsageDaily>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Day }).IsUnique();
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<Permission>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasMany(x => x.RolePermissions).WithOne(x => x.Permission).HasForeignKey(x => x.PermissionId);
        });

        m.Entity<ScheduleItem>(e =>
        {
            // 查某用户的日程按时间排序，(UserId, StartAt) 复合索引最高效
            e.HasIndex(x => new { x.UserId, x.StartAt });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<MemoItem>(e =>
        {
            // 查某用户的便签：置顶在前 + 按更新时间倒序
            e.HasIndex(x => new { x.UserId, x.Pinned, x.UpdatedAt });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // ---------- M5 生活模块群 ----------
        m.Entity<Habit>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<HabitCheckin>(e =>
        {
            // 一个习惯一天只能打一次卡：联合唯一索引兜底
            e.HasIndex(x => new { x.HabitId, x.CheckinDate }).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne(x => x.Habit).WithMany().HasForeignKey(x => x.HabitId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<Course>(e =>
        {
            // 周视图渲染：按用户 + 星期 + 节次取
            e.HasIndex(x => new { x.UserId, x.Weekday, x.StartPeriod });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<AnniversaryItem>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Date });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<CoupleSetting>(e =>
        {
            // 全站单行配置，Id 固定 1，无需额外索引
        });

        m.Entity<LoveNote>(e =>
        {
            e.HasIndex(x => x.CreatedAt);
            e.HasOne(x => x.FromUser).WithMany().HasForeignKey(x => x.FromUserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<BoardMessage>(e =>
        {
            e.HasIndex(x => x.CreatedAt);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<ExpenseItem>(e =>
        {
            // 记账按月查流水：(UserId, OccurDate) 复合索引
            e.HasIndex(x => new { x.UserId, x.OccurDate });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<PeriodRecord>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.StartDate });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<AppSetting>(e =>
        {
            // 键值对：Key 只此一家
            e.HasIndex(x => x.Key).IsUnique();
        });

        m.Entity<AiMessage>(e =>
        {
            // 对话历史按用户 + 时间取；(UserId, CreatedAt) 复合索引
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // ---------- M7 邮件模块 ----------
        m.Entity<EmailAccount>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<EmailMessage>(e =>
        {
            // 同账号同文件夹 UID 只此一封：重拉幂等不重复（同步唯一性兜底）
            e.HasIndex(x => new { x.AccountId, x.Folder, x.Uid }).IsUnique();
            // 收件箱按用户 + 发件时间倒序翻页
            e.HasIndex(x => new { x.UserId, x.SentAt });
            e.HasOne(x => x.Account).WithMany().HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        m.Entity<MailReminderSetting>(e =>
        {
            // 一人一行：UserId 唯一，后台轮询直接按 Enabled + Hour 取
            e.HasIndex(x => x.UserId).IsUnique();
            e.HasIndex(x => new { x.Enabled, x.Hour });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // App 接口令牌：按哈希查（唯一索引，验证只走一次索引扫描）；用户删号级联清令牌
        m.Entity<ApiToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // 通知设置：一人一行，删号级联
        m.Entity<NotifySetting>(e =>
        {
            e.HasIndex(x => x.UserId).IsUnique();
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        // 小游戏房间：房间码唯一（口头报码就能进，不能撞）；
        // 大厅按「状态 + 更新时间」筛，所以给这俩建复合索引。
        // 两级用户外键都 Cascade：删号时他参与的对局一起走，否则大厅里会出现「幽灵对局」。
        m.Entity<GameRoom>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => new { x.Status, x.UpdatedAt });
            e.HasIndex(x => x.HostUserId);
            e.HasIndex(x => x.GuestUserId);
            e.HasOne(x => x.Host).WithMany().HasForeignKey(x => x.HostUserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Guest).WithMany().HasForeignKey(x => x.GuestUserId).OnDelete(DeleteBehavior.Cascade);
        });

        // 单机游戏最高分：一人一游戏一行（唯一索引兜底并发）；删用户级联清除
        m.Entity<GameScore>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.GameKey }).IsUnique();
            e.HasIndex(x => new { x.GameKey, x.BestScore });
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
