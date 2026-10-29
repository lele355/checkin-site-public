using System.Text.Json;

namespace CheckinApp.Services;

/// <summary>
/// 小游戏的用户默认设置 —— 网页 / App 共用一套字段名与取值范围。
///
/// 存到 `User.GameSettings`（JSON 对象），空字符串 = 从没改过 = 用 <see cref="Defaults"/>。
/// 只有**新建房间**时会把它快照进 `GameRoom`：已经开打的局不会因为谁改了设置而中途变形，
/// 两个人看到的必须是同一套规则。
///
/// 分两类：
///   · 影响对局的（size / forbidden / 限时）—— 建房时写进房间，双方共享，服务端据此判定
///   · 只影响自己的（tapConfirm / showCoord / lastMark / vibrate）—— 纯前端表现，不上服务端校验
/// </summary>
public sealed class GameSettings
{
    /// <summary>盘面 13 / 15 / 19</summary>
    public int Size { get; set; } = GomokuRules.DefaultSize;

    /// <summary>标准规则：黑方长连（6 连以上）判负。false = 自由规则</summary>
    public bool Forbidden { get; set; }

    /// <summary>落子二次确认：第一下预览、第二下才落</summary>
    public bool TapConfirm { get; set; }

    /// <summary>棋盘显示坐标（A…／1…）</summary>
    public bool ShowCoord { get; set; } = true;

    /// <summary>最后一手打标记</summary>
    public bool LastMark { get; set; } = true;

    /// <summary>App 落子时震动一次</summary>
    public bool Vibrate { get; set; } = true;

    /// <summary>单步限时（秒），0 = 不限</summary>
    public int MoveTimeoutSec { get; set; }

    /// <summary>每方总用时上限（秒），0 = 不限</summary>
    public int TotalTimeoutSec { get; set; }
}

public static class GameSettingsCatalog
{
    public static GameSettings Defaults => new();

    /// <summary>单步限时可选值（秒）。0 = 不限</summary>
    public static readonly int[] MoveTimeoutOptions = [0, 15, 30, 60, 120];

    /// <summary>每方总用时可选值（秒）。0 = 不限</summary>
    public static readonly int[] TotalTimeoutOptions = [0, 300, 600, 900, 1800];

    /// <summary>解析存库 JSON；坏数据一律回落默认值，别让设置页打不开</summary>
    public static GameSettings Load(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Defaults;
        try
        {
            var s = JsonSerializer.Deserialize<GameSettings>(json);
            return s is null ? Defaults : Normalize(s);
        }
        catch (JsonException) { return Defaults; }
    }

    /// <summary>只认白名单里的档位：手改请求里塞 999 也只会落回最近的合法值</summary>
    public static GameSettings Normalize(GameSettings s) => new()
    {
        Size = GomokuRules.ClampSize(s.Size),
        Forbidden = s.Forbidden,
        TapConfirm = s.TapConfirm,
        ShowCoord = s.ShowCoord,
        LastMark = s.LastMark,
        Vibrate = s.Vibrate,
        MoveTimeoutSec = Nearest(MoveTimeoutOptions, s.MoveTimeoutSec),
        TotalTimeoutSec = Nearest(TotalTimeoutOptions, s.TotalTimeoutSec),
    };

    /// <summary>序列化成存库字符串（已 Normalize）</summary>
    public static string Store(GameSettings s) => JsonSerializer.Serialize(Normalize(s));

    /// <summary>取列表里最接近的一个（不知道就 0 = 不限）</summary>
    public static int Nearest(int[] options, int value)
    {
        if (options.Contains(value)) return value;
        var best = options[0];
        foreach (var o in options)
            if (Math.Abs(o - value) < Math.Abs(best - value)) best = o;
        return best;
    }

    // ---------- 分两个入口改：游戏总设置 / 单游戏杂项设置 ----------
    // 两者共用 User.GameSettings 这一行 JSON，但**必须各自独立的 DTO**：
    // 若直接拿半截 payload 反序列化成 GameSettings，没传的那半会落回默认值 ——
    // 改一下显示偏好，规则默认就被重置了。

    /// <summary>游戏总设置（显示偏好）：不进房间、不上服务端判定，纯前端表现</summary>
    public sealed class DisplaySettings
    {
        public bool TapConfirm { get; set; }
        public bool ShowCoord { get; set; } = true;
        public bool LastMark { get; set; } = true;
        public bool Vibrate { get; set; } = true;
    }

    /// <summary>五子棋杂项设置（规则默认）：建房时快照进房间，之后双方共享</summary>
    public sealed class RuleDefaults
    {
        public int Size { get; set; } = CheckinApp.Services.GomokuRules.DefaultSize;
        public bool Forbidden { get; set; }
        public int MoveTimeoutSec { get; set; }
        public int TotalTimeoutSec { get; set; }
    }

    public static DisplaySettings ToDisplay(GameSettings s) => new()
    {
        TapConfirm = s.TapConfirm,
        ShowCoord = s.ShowCoord,
        LastMark = s.LastMark,
        Vibrate = s.Vibrate,
    };

    public static GameSettings Apply(GameSettings s, DisplaySettings d) => Normalize(new()
    {
        Size = s.Size,
        Forbidden = s.Forbidden,
        MoveTimeoutSec = s.MoveTimeoutSec,
        TotalTimeoutSec = s.TotalTimeoutSec,
        TapConfirm = d.TapConfirm,
        ShowCoord = d.ShowCoord,
        LastMark = d.LastMark,
        Vibrate = d.Vibrate,
    });

    public static RuleDefaults ToRules(GameSettings s) => new()
    {
        Size = s.Size,
        Forbidden = s.Forbidden,
        MoveTimeoutSec = s.MoveTimeoutSec,
        TotalTimeoutSec = s.TotalTimeoutSec,
    };

    public static GameSettings Apply(GameSettings s, RuleDefaults r) => Normalize(new()
    {
        Size = r.Size,
        Forbidden = r.Forbidden,
        MoveTimeoutSec = r.MoveTimeoutSec,
        TotalTimeoutSec = r.TotalTimeoutSec,
        TapConfirm = s.TapConfirm,
        ShowCoord = s.ShowCoord,
        LastMark = s.LastMark,
        Vibrate = s.Vibrate,
    });
}
