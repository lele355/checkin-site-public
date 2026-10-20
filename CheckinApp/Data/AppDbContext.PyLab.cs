using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Data;

/// <summary>
/// PyLab 临时模块的 EF 映射（partial 挂在 AppDbContext 上）。
/// 拆模块时：删掉本文件 + Models/PyLabEntities.cs + 一份迁移，
/// AppDbContext.cs 里只留一行 OnModelCreatingPyLab(m) 的挂载点，不实现也能编译。
/// </summary>
public partial class AppDbContext
{
    public DbSet<PyLabStudent> PyLabStudents => Set<PyLabStudent>();
    public DbSet<PyLabAttendance> PyLabAttendances => Set<PyLabAttendance>();
    public DbSet<PyLabDeckCategory> PyLabDeckCategories => Set<PyLabDeckCategory>();
    public DbSet<PyLabDeck> PyLabDecks => Set<PyLabDeck>();
    public DbSet<PyLabDeckSnippet> PyLabDeckSnippets => Set<PyLabDeckSnippet>();

    partial void OnModelCreatingPyLab(ModelBuilder m)
    {
    // ---------- PyLab 临时模块 ----------
            m.Entity<PyLabStudent>(e =>
            {
                // 点名表按「用户 + 顺序」取；同一个人重名允许（真实班级确实会有），不做唯一约束
                e.HasIndex(x => new { x.UserId, x.SortOrder });
                e.HasIndex(x => new { x.UserId, x.ClassName });
                e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            });

            m.Entity<PyLabAttendance>(e =>
            {
                e.HasIndex(x => new { x.UserId, x.CreatedAt });
                e.HasIndex(x => new { x.StudentId, x.CreatedAt });
                // 删学生 → 考勤记录跟着走（留着会变成「查不到人的孤儿记录」）
                e.HasOne(x => x.Student).WithMany().HasForeignKey(x => x.StudentId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            });

            m.Entity<PyLabDeckCategory>(e =>
            {
                // 同一用户下分类名不重复，省得列表里出现两个「第一章」
                e.HasIndex(x => new { x.UserId, x.Name }).IsUnique();
                e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            });

            m.Entity<PyLabDeck>(e =>
            {
                e.HasIndex(x => new { x.UserId, x.CategoryId });
                // 删分类不删课件：课件回到「未分类」，别把老师上传的东西一起弄丢
                e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.SetNull);
                e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            });

            m.Entity<PyLabDeckSnippet>(e =>
            {
                // 一页只能挂一个片段：靠唯一索引兜底（先查再插的写法在并发下会漏）
                e.HasIndex(x => new { x.DeckId, x.PageNo }).IsUnique();
                e.HasOne(x => x.Deck).WithMany().HasForeignKey(x => x.DeckId).OnDelete(DeleteBehavior.Cascade);
            });
    }
}
