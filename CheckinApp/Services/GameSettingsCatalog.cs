using System.Text.Json;
using System.Text.Json.Serialization;

namespace CheckinApp.Services;

/// <summary>
/// 小游戏的用户默认设置 —— 网页 / App 共用一套字段名与取值范围。
///
/// 存到 `User.GameSettings`（JSON 对象），空字符串 = 从没改过 = 用默认值。
///
/// 【2.8.0 嵌套形状升级】从扁平 `{Size,Forbidden,TapConfirm,…}` 改为嵌套：
/// `{display:{…}, games:{gomoku:{…}, reversi:{…}, …}}`
/// 读侧垫片：旧扁平格式自动转换（懒升级，零 DB 迁移）；写侧只写新。
///
/// 分两类：
///   · 影响对局的（size / forbidden / 限时）—— 建房时写进房间，双方共享，服务端据此判定
///   · 只影响自己的（tapConfirm / showCoord / lastMark / vibrate）—— 纯前端表现，不上服务端校验
/// </summary>
public sealed class GameSettings
{
    /// <summary>显示偏好（全局，不进房间）</summary>
    public DisplaySettings Display { get; set; } = new();

    /// <summary>各游戏的规则默认（按 gameKey 分）</summary>
    public Dictionary<string, GameRuleDefaults> Games { get; set; } = new();

    /// <summary>兼容旧调用：取指定游戏的规则默认（没有就回落默认值）</summary>
    public GameRuleDefaults GetRules(string gameKey) =>
        Games.TryGetValue(gameKey, out var r) ? r : new GameRuleDefaults();

    /// <summary>兼容旧调用：取显示偏好</summary>
    public DisplaySettings GetDisplay() => Display;

    // ---------- 兼容旧扁平属性（读嵌套，下版删） ----------
    /// <summary>兼容：五子棋盘面（读 games.gomoku）</summary>
    public int Size
    {
        get => GetRules("gomoku").Size;
        set { var r = GetRules("gomoku"); r.Size = value; Games["gomoku"] = r; }
    }
    /// <summary>兼容：五子棋禁手</summary>
    public bool Forbidden
    {
        get => GetRules("gomoku").Forbidden;
        set { var r = GetRules("gomoku"); r.Forbidden = value; Games["gomoku"] = r; }
    }
    /// <summary>兼容：单步限时（五子棋）</summary>
    public int MoveTimeoutSec
    {
        get => GetRules("gomoku").MoveTimeoutSec;
        set { var r = GetRules("gomoku"); r.MoveTimeoutSec = value; Games["gomoku"] = r; }
    }
    /// <summary>兼容：每方总用时（五子棋）</summary>
    public int TotalTimeoutSec
    {
        get => GetRules("gomoku").TotalTimeoutSec;
        set { var r = GetRules("gomoku"); r.TotalTimeoutSec = value; Games["gomoku"] = r; }
    }
    /// <summary>兼容：落子二次确认</summary>
    public bool TapConfirm { get => Display.TapConfirm; set => Display.TapConfirm = value; }
    /// <summary>兼容：显示坐标</summary>
    public bool ShowCoord { get => Display.ShowCoord; set => Display.ShowCoord = value; }
    /// <summary>兼容：标记最后一手</summary>
    public bool LastMark { get => Display.LastMark; set => Display.LastMark = value; }
    /// <summary>兼容：震动</summary>
    public bool Vibrate { get => Display.Vibrate; set => Display.Vibrate = value; }
}

/// <summary>显示偏好：纯前端表现，不进房间、不上服务端判定</summary>
public class DisplaySettings
{
    public bool TapConfirm { get; set; }
    public bool ShowCoord { get; set; } = true;
    public bool LastMark { get; set; } = true;
    public bool Vibrate { get; set; } = true;
}

/// <summary>通用规则默认（新五款用）：size/forbidden + 限时（扁平化，不依赖多态）</summary>
public class GameRuleDefaults
{
    /// <summary>盘面大小（仅五子棋用，其它游戏忽略）</summary>
    public int Size { get; set; } = GomokuRules.DefaultSize;

    /// <summary>标准规则禁手（仅五子棋用）</summary>
    public bool Forbidden { get; set; }

    /// <summary>单步限时（秒），0 = 不限</summary>
    public int MoveTimeoutSec { get; set; }

    /// <summary>每方总用时上限（秒），0 = 不限</summary>
    public int TotalTimeoutSec { get; set; }
}

/// <summary>兼容旧类型名（= GameRuleDefaults，保留避免编译错误）</summary>
public class GomokuRuleDefaults : GameRuleDefaults { }

public static class GameSettingsCatalog
{
    public static GameSettings Defaults => new();

    /// <summary>单步限时可选值（秒）。0 = 不限</summary>
    public static readonly int[] MoveTimeoutOptions = [0, 15, 30, 60, 120];

    /// <summary>每方总用时可选值（秒）。0 = 不限</summary>
    public static readonly int[] TotalTimeoutOptions = [0, 300, 600, 900, 1800];

    /// <summary>
    /// 解析存库 JSON。读侧垫片：旧扁平格式自动转换为嵌套。
    /// 坏数据一律回落默认值，别让设置页打不开。
    /// </summary>
    public static GameSettings Load(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Defaults;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            // 读侧垫片：旧扁平格式（有 Size/TapConfirm 等顶层字段）→ 转嵌套
            if (root.TryGetProperty("Size", out _) || root.TryGetProperty("TapConfirm", out _))
            {
                return MigrateFromFlat(root);
            }

            // 新嵌套格式
            var s = JsonSerializer.Deserialize<GameSettings>(json, JsonOpts);
            return s is null ? Defaults : Normalize(s);
        }
        catch (JsonException) { return Defaults; }
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>旧扁平格式 → 嵌套格式（读侧垫片）</summary>
    private static GameSettings MigrateFromFlat(JsonElement root)
    {
        var display = new DisplaySettings();
        if (root.TryGetProperty("TapConfirm", out var tc)) display.TapConfirm = tc.GetBoolean();
        if (root.TryGetProperty("ShowCoord", out var sc)) display.ShowCoord = sc.GetBoolean();
        if (root.TryGetProperty("LastMark", out var lm)) display.LastMark = lm.GetBoolean();
        if (root.TryGetProperty("Vibrate", out var vb)) display.Vibrate = vb.GetBoolean();

        var gomoku = new GameRuleDefaults();
        if (root.TryGetProperty("Size", out var sz)) gomoku.Size = GomokuRules.ClampSize(sz.GetInt32());
        if (root.TryGetProperty("Forbidden", out var fb)) gomoku.Forbidden = fb.GetBoolean();
        if (root.TryGetProperty("MoveTimeoutSec", out var mt)) gomoku.MoveTimeoutSec = Nearest(MoveTimeoutOptions, mt.GetInt32());
        if (root.TryGetProperty("TotalTimeoutSec", out var tt)) gomoku.TotalTimeoutSec = Nearest(TotalTimeoutOptions, tt.GetInt32());

        return Normalize(new GameSettings
        {
            Display = display,
            Games = new Dictionary<string, GameRuleDefaults> { ["gomoku"] = gomoku },
        });
    }

    /// <summary>只认白名单里的档位：手改请求里塞 999 也只会落回最近的合法值</summary>
    public static GameSettings Normalize(GameSettings s)
    {
        s.Display.TapConfirm = s.Display.TapConfirm;
        s.Display.ShowCoord = s.Display.ShowCoord;
        s.Display.LastMark = s.Display.LastMark;
        s.Display.Vibrate = s.Display.Vibrate;

        foreach (var (key, rules) in s.Games)
        {
            rules.Size = GomokuRules.ClampSize(rules.Size);
            rules.MoveTimeoutSec = Nearest(MoveTimeoutOptions, rules.MoveTimeoutSec);
            rules.TotalTimeoutSec = Nearest(TotalTimeoutOptions, rules.TotalTimeoutSec);
        }
        return s;
    }

    /// <summary>序列化成存库字符串（只写新嵌套格式）</summary>
    public static string Store(GameSettings s) => JsonSerializer.Serialize(Normalize(s), JsonOpts);

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
    // 两者共用 User.GameSettings 这一行 JSON，但**必须各自独立的 DTO**（红线 19）。

    /// <summary>游戏总设置（显示偏好）：不进房间、不上服务端判定，纯前端表现</summary>
    public sealed class DisplayDto
    {
        public bool TapConfirm { get; set; }
        public bool ShowCoord { get; set; } = true;
        public bool LastMark { get; set; } = true;
        public bool Vibrate { get; set; } = true;
    }

    /// <summary>五子棋规则默认 DTO（含 size/forbidden）</summary>
    public sealed class GomokuRulesDto
    {
        public int Size { get; set; } = GomokuRules.DefaultSize;
        public bool Forbidden { get; set; }
        public int MoveTimeoutSec { get; set; }
        public int TotalTimeoutSec { get; set; }
    }

    /// <summary>新五款游戏的规则默认 DTO（只有限时，无 size/forbidden）</summary>
    public sealed class TimeoutRuleDefaultsDto
    {
        public int MoveTimeoutSec { get; set; }
        public int TotalTimeoutSec { get; set; }
    }

    public static DisplayDto ToDisplay(GameSettings s) => new()
    {
        TapConfirm = s.Display.TapConfirm,
        ShowCoord = s.Display.ShowCoord,
        LastMark = s.Display.LastMark,
        Vibrate = s.Display.Vibrate,
    };

    public static GameSettings Apply(GameSettings s, DisplayDto d)
    {
        s.Display = new CheckinApp.Services.DisplaySettings
        {
            TapConfirm = d.TapConfirm,
            ShowCoord = d.ShowCoord,
            LastMark = d.LastMark,
            Vibrate = d.Vibrate,
        };
        return Normalize(s);
    }

    /// <summary>取五子棋规则（兼容旧调用）</summary>
    public static GomokuRulesDto ToGomokuRules(GameSettings s)
    {
        var r = s.GetRules("gomoku");
        return new GomokuRulesDto
        {
            Size = r.Size,
            Forbidden = r.Forbidden,
            MoveTimeoutSec = r.MoveTimeoutSec,
            TotalTimeoutSec = r.TotalTimeoutSec,
        };
    }

    /// <summary>应用五子棋规则（只动五子棋那半，其它游戏不受影响）</summary>
    public static GameSettings Apply(GameSettings s, GomokuRulesDto r)
    {
        s.Games["gomoku"] = new GameRuleDefaults
        {
            Size = GomokuRules.ClampSize(r.Size),
            Forbidden = r.Forbidden,
            MoveTimeoutSec = Nearest(MoveTimeoutOptions, r.MoveTimeoutSec),
            TotalTimeoutSec = Nearest(TotalTimeoutOptions, r.TotalTimeoutSec),
        };
        return Normalize(s);
    }

    /// <summary>取指定游戏的限时规则</summary>
    public static TimeoutRuleDefaultsDto ToTimeoutRules(GameSettings s, string gameKey)
    {
        var r = s.GetRules(gameKey);
        return new TimeoutRuleDefaultsDto
        {
            MoveTimeoutSec = r.MoveTimeoutSec,
            TotalTimeoutSec = r.TotalTimeoutSec,
        };
    }

    /// <summary>应用限时规则（只动限时，保留 size/forbidden）</summary>
    public static GameSettings Apply(GameSettings s, TimeoutRuleDefaultsDto r, string gameKey)
    {
        var existing = s.GetRules(gameKey);
        existing.MoveTimeoutSec = Nearest(MoveTimeoutOptions, r.MoveTimeoutSec);
        existing.TotalTimeoutSec = Nearest(TotalTimeoutOptions, r.TotalTimeoutSec);
        s.Games[gameKey] = existing;
        return Normalize(s);
    }

    // ---------- 兼容旧接口（保持现有调用点编译通过） ----------

    /// <summary>兼容旧 DisplaySettings 形状（= 顶层 DisplaySettings）</summary>
    public sealed class DisplaySettings : CheckinApp.Services.DisplaySettings { }

    /// <summary>兼容旧 RuleDefaults 形状（五子棋专用，独立 DTO 不继承）</summary>
    public sealed class RuleDefaults
    {
        public int Size { get; set; } = GomokuRules.DefaultSize;
        public bool Forbidden { get; set; }
        public int MoveTimeoutSec { get; set; }
        public int TotalTimeoutSec { get; set; }
    }

    public static RuleDefaults ToRules(GameSettings s) => new()
    {
        Size = s.GetRules("gomoku").Size,
        Forbidden = s.GetRules("gomoku").Forbidden,
        MoveTimeoutSec = s.GetRules("gomoku").MoveTimeoutSec,
        TotalTimeoutSec = s.GetRules("gomoku").TotalTimeoutSec,
    };

    public static GameSettings Apply(GameSettings s, RuleDefaults r) => Apply(s, new GomokuRulesDto
    {
        Size = r.Size,
        Forbidden = r.Forbidden,
        MoveTimeoutSec = r.MoveTimeoutSec,
        TotalTimeoutSec = r.TotalTimeoutSec,
    });

    public static GameSettings Apply(GameSettings s, DisplaySettings d) => Apply(s, new DisplayDto
    {
        TapConfirm = d.TapConfirm,
        ShowCoord = d.ShowCoord,
        LastMark = d.LastMark,
        Vibrate = d.Vibrate,
    });
}
