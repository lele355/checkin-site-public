using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Caching.Memory;

namespace CheckinApp.Services;

/// <summary>
/// 注册防护「三件套」（自建、零第三方依赖，足够挡住脚本与注册机）：
///   1. 一次性表单令牌 —— GET 注册页时下发，POST 校验后立刻作废。挡住「不走页面、直接 POST 接口」的脚本；
///   2. 最短填写时长 —— GET 时把服务器时间加密塞进隐藏字段，POST 解密比对。真人填表不可能 3 秒内交卷，
///      反过来停留超过 2 小时也判为过期（表单是旧的，令牌多半已被作废）；
///   3. 邀请码 —— 本站不做开放注册，没有码的人连落库的机会都没有。
///
/// 蜜罐字段的逻辑不在这里：那是「判断某个 input 有没有值」的一行代码，直接写在注册页里更直观。
/// </summary>
public class RegistrationGuard(IMemoryCache cache, IDataProtectionProvider dp)
{
    /// <summary>最短填写时长（真人手打 4 个字段 + 一个邀请码，通常 10 秒以上）</summary>
    public static readonly TimeSpan MinFill = TimeSpan.FromSeconds(3);
    /// <summary>最长停留时长（超时视为旧表单，要求刷新）</summary>
    public static readonly TimeSpan MaxFill = TimeSpan.FromHours(2);
    private static readonly TimeSpan TokenTtl = TimeSpan.FromMinutes(30);

    /// <summary>邀请码字符集：去掉 0/O/1/I 这些抄错率高的字符，全是肉眼可辨的</summary>
    private const string CodeAlphabet = "23456789ACDEFGHJKLMNPQRSTUVWXYZ";

    private readonly IDataProtector _protector = dp.CreateProtector("CheckinApp.RegisterForm.v1");

    // ---------------- 一次性表单令牌 ----------------

    public string NewFormToken()
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        cache.Set(TokenKey(token), true, TokenTtl);
        return token;
    }

    /// <summary>校验并作废令牌（一次性：成功读取即移除，重复提交/脚本重放都不认）</summary>
    public bool ConsumeFormToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        var key = TokenKey(token);
        if (!cache.TryGetValue(key, out _)) return false;
        cache.Remove(key);
        return true;
    }

    private static string TokenKey(string token) => "reg:token:" + token;

    // ---------------- 填写时长 ----------------

    /// <summary>把「此刻」加密后下发给页面（客户端改不了：改了 Unprotect 直接抛异常）</summary>
    public string NewFormStamp() => _protector.Protect(DateTime.UtcNow.Ticks.ToString());

    /// <summary>校验填写时长；reason 用于给用户看的中文提示</summary>
    public bool TimingOk(string? stamp, out string reason)
    {
        reason = "";
        if (string.IsNullOrWhiteSpace(stamp))
        {
            reason = "表单校验信息缺失，请刷新页面后重试。";
            return false;
        }

        long ticks;
        try
        {
            var raw = _protector.Unprotect(stamp);
            if (!long.TryParse(raw, out ticks)) { reason = "表单校验失败，请刷新页面后重试。"; return false; }
        }
        catch (CryptographicException)
        {
            // 伪造的戳、或服务器换了密钥（重启且密钥未持久化）
            reason = "表单校验失败，请刷新页面后重试。";
            return false;
        }

        var elapsed = DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc);
        if (elapsed < MinFill)
        {
            reason = "提交太快了，请确认信息后再提交。";
            return false;
        }
        if (elapsed > MaxFill)
        {
            reason = "页面停留时间过长，表单已失效，请刷新后重新填写。";
            return false;
        }
        return true;
    }

    // ---------------- 邀请码 ----------------

    /// <summary>
    /// 生成一个邀请码，返回「裸码」（12 位、无分隔符、已大写）。
    /// 库里一律存裸码：用户抄写时加不加短横线都能对上（比较前统一走 NormalizeCode）。
    /// 展示给别人看时再调 FormatCode 加短横线。
    /// </summary>
    public static string NewCode()
    {
        Span<char> buf = stackalloc char[12];
        for (var i = 0; i < buf.Length; i++)
            buf[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
        return new string(buf);
    }

    /// <summary>
    /// 归一化邀请码：**只保留字母和数字**，其余全丢，再转大写。
    ///
    /// 为什么不只去 ASCII 短横：用户从微信/备忘录复制过来的常常是
    /// 全角短横 `－`(U+FF0D)、en dash `–`(U+2013) 或 em dash `—`，
    /// 以前只白名单了 `-` 和空格，这些字符留着就变成 14 位 → 直接报「格式不对」。
    /// 现在只认字母数字，加不加横杠、加的是哪种横杠，结果都一样。
    /// </summary>
    public static string NormalizeCode(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return "";
        var sb = new System.Text.StringBuilder(code.Length);
        foreach (var ch in code)
        {
            if (char.IsLetterOrDigit(ch)) sb.Append(char.ToUpperInvariant(ch));
        }
        return sb.ToString();
    }

    /// <summary>把 12 位裸码格式化成 XXXX-XXXX-XXXX（展示用）</summary>
    public static string FormatCode(string raw)
    {
        var s = NormalizeCode(raw);
        return s.Length == 12 ? $"{s[..4]}-{s[4..8]}-{s[8..]}" : s;
    }

    /// <summary>
    /// 形状校验（不做数据库查询）：只要求「12 位字母数字」。
    ///
    /// ⚠️ 这里**不套用** <see cref="CodeAlphabet"/>：那个字符集排除 B/I/O/0/1 是为了
    /// **生成**时避免易混，不是给人看的规则。一旦拿它做校验，管理员手填的码（含 B）就会被
    /// 判成「格式不对」—— 用户看到的是「明明是 12 位却说格式错」，完全无从排查。
    /// 真假交给数据库查（`Invitations.Code == normalized`）。
    /// </summary>
    public static bool LooksLikeCode(string normalized)
    {
        if (normalized.Length != 12) return false;
        foreach (var ch in normalized)
            if (!char.IsLetterOrDigit(ch)) return false;
        return true;
    }
}
