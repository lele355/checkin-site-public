using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 学期（Semesters 表）的读写。
///
/// 【为什么要有这一层】「当前学期」是全局状态（课表、工作台今日课程都要用它），
/// 而它有两个来源：Semesters 表（2.4.1 起）和老的 AppSetting("courses.semester-start")（2.4.0 及以前）。
/// 所有读当前学期的地方都走 <see cref="Current"/>，就不用各处重复处理「还没建学期」的兜底。
/// </summary>
public static class SemesterService
{
    public const string LegacyStartKey = "courses.semester-start";

    /// <summary>
    /// 取当前学期；没有就建一个（首次升级、或用户把学期全删了）。
    ///
    /// 建的时候优先沿用老的 AppSetting 起始日 —— 升级上来的用户课表周次不能因为加了个学期表就变。
    /// 同时把 SemesterId 为空的旧课程挂到它下面（迁移没法在 SQL 里按用户算起始日，只能在这里补）。
    /// </summary>
    public static Semester Current(AppDbContext db, int userId, bool createIfMissing = true)
    {
        var cur = db.Semesters.FirstOrDefault(s => s.UserId == userId && s.IsCurrent);
        if (cur is not null) return cur;
        if (!createIfMissing) return new Semester { UserId = userId, StartDate = WeekStart(DateTime.Today) };

        // 没有标记为当前的：优先挑最近建的那个（用户可能手工删过 IsCurrent 标记）
        cur = db.Semesters.Where(s => s.UserId == userId)
            .OrderByDescending(s => s.StartDate).FirstOrDefault();
        if (cur is not null)
        {
            cur.IsCurrent = true;
            db.SaveChanges();
            return cur;
        }

        var legacy = db.AppSettings.FirstOrDefault(s => s.Key == LegacyStartKey);
        var start = legacy is not null && DateTime.TryParse(legacy.Value, out var d)
            ? WeekStart(d)
            : WeekStart(DateTime.Today);

        cur = new Semester
        {
            UserId = userId,
            Name = AutoName(start),
            StartDate = start,
            IsCurrent = true,
        };
        db.Semesters.Add(cur);
        db.SaveChanges();

        // 把还没归属的旧课程挂到默认学期上
        var orphans = db.Courses.Where(c => c.UserId == userId && c.SemesterId == null).ToList();
        if (orphans.Count > 0)
        {
            foreach (var c in orphans) c.SemesterId = cur.Id;
            db.SaveChanges();
        }
        return cur;
    }

    /// <summary>某用户的所有学期（按起始日倒序，最近的在前）</summary>
    public static List<Semester> List(AppDbContext db, int userId) =>
        db.Semesters.Where(s => s.UserId == userId)
            .OrderByDescending(s => s.StartDate)
            .ToList();

    /// <summary>切换当前学期：先把该用户其它学期的标记清掉，保证只有一个当前</summary>
    public static Semester? SwitchTo(AppDbContext db, int userId, int semesterId)
    {
        var target = db.Semesters.FirstOrDefault(s => s.Id == semesterId && s.UserId == userId);
        if (target is null) return null;
        foreach (var s in db.Semesters.Where(s => s.UserId == userId && s.IsCurrent && s.Id != semesterId))
            s.IsCurrent = false;
        target.IsCurrent = true;
        // 老的 AppSetting 一并更新：还有别的代码（如导出）在读它
        SyncLegacy(db, target);
        db.SaveChanges();
        return target;
    }

    /// <summary>新建学期并设为当前（刚开学的人不会想让新学期是「非当前」）</summary>
    public static Semester Create(AppDbContext db, int userId, string? name, DateTime startDate)
    {
        var start = WeekStart(startDate);
        foreach (var s in db.Semesters.Where(s => s.UserId == userId && s.IsCurrent))
            s.IsCurrent = false;
        var sem = new Semester
        {
            UserId = userId,
            Name = string.IsNullOrWhiteSpace(name) ? AutoName(start) : name.Trim(),
            StartDate = start,
            IsCurrent = true,
        };
        db.Semesters.Add(sem);
        db.SaveChanges();
        SyncLegacy(db, sem);
        db.SaveChanges();
        return sem;
    }

    /// <summary>改名字 / 起始日</summary>
    public static Semester? Update(AppDbContext db, int userId, int semesterId, string? name, DateTime? startDate)
    {
        var sem = db.Semesters.FirstOrDefault(s => s.Id == semesterId && s.UserId == userId);
        if (sem is null) return null;
        if (!string.IsNullOrWhiteSpace(name)) sem.Name = name.Trim();
        if (startDate is DateTime d) sem.StartDate = WeekStart(d);
        db.SaveChanges();
        if (sem.IsCurrent) SyncLegacy(db, sem);
        return sem;
    }

    /// <summary>
    /// 删学期（连带它下面的课 —— 外键 Cascade 已配）。
    /// 删的如果正好是当前学期，自动把剩下的、起始日最新的那个设为当前；
    /// 一门学期都不剩就什么都不要了，下次 <see cref="Current"/> 会重新建默认学期。
    /// </summary>
    public static (bool ok, string? error, int deletedCourses) Delete(AppDbContext db, int userId, int semesterId)
    {
        var sem = db.Semesters.FirstOrDefault(s => s.Id == semesterId && s.UserId == userId);
        if (sem is null) return (false, "学期不存在或已删除", 0);

        var courseCount = db.Courses.Count(c => c.UserId == userId && c.SemesterId == semesterId);
        db.Semesters.Remove(sem);
        db.SaveChanges();

        if (sem.IsCurrent)
        {
            var next = db.Semesters.Where(s => s.UserId == userId)
                .OrderByDescending(s => s.StartDate).FirstOrDefault();
            if (next is not null)
            {
                next.IsCurrent = true;
                SyncLegacy(db, next);
                db.SaveChanges();
            }
        }
        return (true, null, courseCount);
    }

    /// <summary>把当前学期的起始日写回老 AppSetting（导出、旧页面还在读它）</summary>
    private static void SyncLegacy(AppDbContext db, Semester sem)
    {
        var row = db.AppSettings.FirstOrDefault(s => s.Key == LegacyStartKey);
        var val = sem.StartDate.ToString("yyyy-MM-dd");
        if (row is null) db.AppSettings.Add(new AppSetting { Key = LegacyStartKey, Value = val });
        else row.Value = val;
    }

    /// <summary>取所在周的周一</summary>
    public static DateTime WeekStart(DateTime d) => d.Date.AddDays(-(((int)d.DayOfWeek + 6) % 7));

    /// <summary>由起始日推一个可读的学期名：9 月以后算秋季，2 月以后算春季</summary>
    public static string AutoName(DateTime start) =>
        start.Month >= 8 ? $"{start.Year} 秋" : $"{start.Year} 春";
}
