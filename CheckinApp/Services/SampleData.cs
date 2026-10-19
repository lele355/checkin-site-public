using CheckinApp.Data;
using CheckinApp.Models;
using Microsoft.EntityFrameworkCore;

namespace CheckinApp.Services;

/// <summary>
/// 测试数据：给一个用户按模块各生成 3 条样例，全部以「【测试】」开头，
/// 目的是让新账号/新部署一进来就能看到每个功能长什么样，且随时能一键清干净。
/// 约定：标题/名称/正文前缀 + 备注里写明「测试数据，可删除」，绝不混进真实数据而不留痕。
/// </summary>
public static class SampleData
{
    public const string Mark = "【测试】";
    public const string Tail = "（示例数据，可删除）";

    /// <summary>给用户播种测试数据；已有「【测试】」记录时直接跳过（幂等，不会重复堆）。</summary>
    /// <param name="includePeriod">该用户是否有经期权限（情侣角色才播种经期记录）</param>
    /// <returns>新写入的行数</returns>
    public static int Seed(AppDbContext db, int userId, bool includePeriod = false)
    {
        if (HasAny(db, userId)) return 0;

        var today = DateTime.Today;
        var now = DateTime.Now;
        var rows = 0;

        // ---- 日程 3 条：今天下午 / 明天上午 / 后天晚上 ----
        db.Schedules.AddRange(
            new ScheduleItem
            {
                UserId = userId, Title = Mark + "小组会议",
                Description = "讨论课程设计分工" + Tail,
                StartAt = today.AddHours(14), EndAt = today.AddHours(15)
            },
            new ScheduleItem
            {
                UserId = userId, Title = Mark + "交课程作业",
                Description = "数据结构第 5 章习题" + Tail,
                StartAt = today.AddDays(1).AddHours(9).AddMinutes(30), EndAt = today.AddDays(1).AddHours(10).AddMinutes(30)
            },
            new ScheduleItem
            {
                UserId = userId, Title = Mark + "健身",
                Description = "跑步 5 公里" + Tail,
                StartAt = today.AddDays(2).AddHours(19),
                AllDay = false
            });
        rows += 3;

        // ---- 备忘 3 条：第一条置顶（工作台能看到） ----
        db.Memos.AddRange(
            new MemoItem { UserId = userId, Title = Mark + "要买的东西", Content = "牛奶、鸡蛋、面包" + Tail, Pinned = true },
            new MemoItem { UserId = userId, Title = Mark + "读书笔记", Content = "《代码整洁之道》第 3 章：函数要短。" + Tail },
            new MemoItem { UserId = userId, Title = Mark + "灵感碎片", Content = "工作台卡片可以按使用频率排序。" + Tail });
        rows += 3;

        // ---- 习惯 3 个 + 每个最近 3 天打卡 ----
        var habits = new[]
        {
            new Habit { UserId = userId, Name = Mark + "早起", Icon = "🌅" },
            new Habit { UserId = userId, Name = Mark + "喝水 8 杯", Icon = "💧" },
            new Habit { UserId = userId, Name = Mark + "跑步", Icon = "🏃" },
        };
        db.Habits.AddRange(habits);
        rows += 3;

        foreach (var h in habits)
        {
            for (var d = 0; d < 3; d++)
            {
                db.HabitCheckins.Add(new HabitCheckin
                {
                    Habit = h,                // 用导航属性，EF 会在插入 Habit 后自动回填 HabitId
                    UserId = userId,
                    CheckinDate = today.AddDays(-d),
                    Note = d == 0 ? "今天也坚持了" : ""
                });
                rows++;
            }
        }

        // ---- 课程 3 门（本周一/三/五） ----
        db.Courses.AddRange(
            new Course
            {
                UserId = userId, Name = Mark + "高等数学", Teacher = "张老师", Location = "教一楼 205",
                Weekday = 1, StartPeriod = 1, EndPeriod = 2, WeeksText = "1-16", Category = "required"
            },
            new Course
            {
                UserId = userId, Name = Mark + "大学物理", Teacher = "李老师", Location = "实验楼 A301",
                Weekday = 3, StartPeriod = 3, EndPeriod = 4, WeeksText = "1-16", Category = "required"
            },
            new Course
            {
                UserId = userId, Name = Mark + "羽毛球", Teacher = "王老师", Location = "体育馆",
                Weekday = 5, StartPeriod = 5, EndPeriod = 6, WeeksText = "1-8,10-16", Category = "school"
            });
        rows += 3;

        // ---- 纪念日 3 条 ----
        db.Anniversaries.AddRange(
            new AnniversaryItem
            {
                UserId = userId, Title = Mark + "在一起纪念日",
                Date = new DateTime(today.Year, 1, 1), RepeatYearly = true, Note = "第一天" + Tail
            },
            new AnniversaryItem
            {
                UserId = userId, Title = Mark + "生日",
                Date = new DateTime(today.Year, 7, 25), RepeatYearly = true
            },
            new AnniversaryItem
            {
                UserId = userId, Title = Mark + "搬进新家",
                Date = today.AddYears(-1).AddDays(-20), RepeatYearly = false
            });
        rows += 3;

        // ---- 记账 3 条（2 出 1 入） ----
        db.Expenses.AddRange(
            new ExpenseItem
            {
                UserId = userId, Amount = 25.50m, Type = "out", Category = "餐饮",
                OccurDate = today, Note = Mark + "午饭" + Tail
            },
            new ExpenseItem
            {
                UserId = userId, Amount = 8m, Type = "out", Category = "交通",
                OccurDate = today.AddDays(-1), Note = Mark + "地铁" + Tail
            },
            new ExpenseItem
            {
                UserId = userId, Amount = 300m, Type = "in", Category = "兼职",
                OccurDate = today.AddDays(-3), Note = Mark + "家教收入" + Tail
            });
        rows += 3;

        // ---- 留言板 3 条 ----
        db.BoardMessages.AddRange(
            new BoardMessage { UserId = userId, Content = Mark + "第一条测试留言，随便说点什么。" + Tail },
            new BoardMessage { UserId = userId, Content = Mark + "今天的天空很好看 ☁️" + Tail },
            new BoardMessage { UserId = userId, Content = Mark + "记得多喝水，早点睡。" + Tail });
        rows += 3;

        // ---- 经期 3 条（仅限有权限的账号，否则页面看不了反而是脏数据） ----
        if (includePeriod)
        {
            db.PeriodRecords.AddRange(
                new PeriodRecord
                {
                    UserId = userId, StartDate = today.AddDays(-70), EndDate = today.AddDays(-66),
                    Note = Mark + "第 1 次记录" + Tail
                },
                new PeriodRecord
                {
                    UserId = userId, StartDate = today.AddDays(-40), EndDate = today.AddDays(-36),
                    Note = Mark + "第 2 次记录" + Tail
                },
                new PeriodRecord
                {
                    UserId = userId, StartDate = today.AddDays(-12), EndDate = today.AddDays(-8),
                    Note = Mark + "第 3 次记录" + Tail
                });
            rows += 3;
        }

        db.SaveChanges();
        return rows;
    }

    public static bool HasAny(AppDbContext db, int userId)
        => db.Memos.Any(m => m.UserId == userId && m.Title.StartsWith(Mark))
        || db.Schedules.Any(s => s.UserId == userId && s.Title.StartsWith(Mark));

    /// <summary>数一下该用户当前有多少条测试数据（个人主页显示「生成/清除」状态用）。</summary>
    public static int Count(AppDbContext db, int userId)
    {
        var habitIds = db.Habits.Where(h => h.UserId == userId && h.Name.StartsWith(Mark))
                                .Select(h => h.Id).ToList();

        var n = db.Schedules.Count(x => x.UserId == userId && x.Title.StartsWith(Mark))
              + db.Memos.Count(x => x.UserId == userId && x.Title.StartsWith(Mark))
              + db.Courses.Count(x => x.UserId == userId && x.Name.StartsWith(Mark))
              + db.Anniversaries.Count(x => x.UserId == userId && x.Title.StartsWith(Mark))
              + db.Expenses.Count(x => x.UserId == userId && x.Note.StartsWith(Mark))
              + db.BoardMessages.Count(x => x.UserId == userId && x.Content.StartsWith(Mark))
              + db.PeriodRecords.Count(x => x.UserId == userId && x.Note.StartsWith(Mark));

        if (habitIds.Count > 0)
        {
            n += habitIds.Count;
            n += db.HabitCheckins.Count(c => habitIds.Contains(c.HabitId));
        }
        return n;
    }

    /// <summary>清掉该用户的全部测试数据（含测试习惯的打卡记录），返回删除行数。</summary>
    public static int Remove(AppDbContext db, int userId)
    {
        var rows = 0;

        var habitIds = db.Habits.Where(h => h.UserId == userId && h.Name.StartsWith(Mark))
                                .Select(h => h.Id).ToList();
        if (habitIds.Count > 0)
        {
            rows += db.HabitCheckins.Where(c => habitIds.Contains(c.HabitId)).ExecuteDelete();
            rows += db.Habits.Where(h => habitIds.Contains(h.Id)).ExecuteDelete();
        }

        rows += db.Schedules.Where(x => x.UserId == userId && x.Title.StartsWith(Mark)).ExecuteDelete();
        rows += db.Memos.Where(x => x.UserId == userId && x.Title.StartsWith(Mark)).ExecuteDelete();
        rows += db.Courses.Where(x => x.UserId == userId && x.Name.StartsWith(Mark)).ExecuteDelete();
        rows += db.Anniversaries.Where(x => x.UserId == userId && x.Title.StartsWith(Mark)).ExecuteDelete();
        rows += db.Expenses.Where(x => x.UserId == userId && x.Note.StartsWith(Mark)).ExecuteDelete();
        rows += db.BoardMessages.Where(x => x.UserId == userId && x.Content.StartsWith(Mark)).ExecuteDelete();
        rows += db.PeriodRecords.Where(x => x.UserId == userId && x.Note.StartsWith(Mark)).ExecuteDelete();

        return rows;
    }

    /// <summary>判断角色是否有某个权限码（给建号时决定要不要播种经期数据）。</summary>
    public static bool RoleHas(AppDbContext db, int roleId, string permCode)
        => db.RolePermissions.Any(rp => rp.RoleId == roleId && rp.Permission!.Code == permCode);
}
