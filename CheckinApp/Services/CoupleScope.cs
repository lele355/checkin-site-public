using CheckinApp.Data;
using CheckinApp.Services;

namespace CheckinApp.Services;

/// <summary>
/// 情侣域 —— 「情侣」大类的数据共享边界（2026-11-02 站主规划）。
/// 成员 = 持有 couples.view 权限的用户（内置「情侣」角色，≤2 人）。
/// 情侣大类（情侣空间/心情/排便/提问/总结/经期）内双方数据相互可见、可记。
/// </summary>
public class CoupleScope(AppDbContext db, CurrentUser me)
{
    private readonly AppDbContext _db = db;
    private readonly CurrentUser _me = me;

    /// <summary>情侣域成员 UserId 集合（持有 couples.view 的用户；含本人）。</summary>
    public List<int> MemberUids()
    {
        return _db.Users
            .Where(u => u.IsActive && u.Role.RolePermissions.Any(rp => rp.Permission.Code == "couples.view"))
            .Select(u => u.Id)
            .ToList();
    }

    /// <summary>对方 UserId（无则 null）。</summary>
    public int? PartnerUid()
    {
        if (_me.UserId is not int uid) return null;
        var other = MemberUids().Where(x => x != uid).ToList();
        return other.Count > 0 ? other[0] : null;
    }

    /// <summary>uid 是否情侣域成员（写操作校验用）。</summary>
    public bool IsMember(int uid) => MemberUids().Contains(uid);
}
