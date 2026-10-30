using System.Text.Json;

namespace CheckinApp.Services;

/// <summary>
/// 五子棋规则 —— 两端（网页 / App）都只负责画棋盘，判定一律回到这里。
///
/// 盘面大小是**每局可配**的（13 / 15 / 19，见 <see cref="AllowedSizes"/>），
/// 所以这里的每个方法都要显式传 size —— 别再用常量，那样换个盘面就会越界判错。
///
/// 规则变体：
///   · <c>forbidden = false</c>（自由规则）：先连成 5 个或以上即胜，长连也算赢
///   · <c>forbidden = true</c>（标准规则）：黑方连成 6 个以上判负（白方长连仍算赢）
/// </summary>
public static class GomokuRules
{
    /// <summary>成五即胜（固定 5，不随盘面变）</summary>
    public const int WinLen = 5;

    public const int DefaultSize = 15;

    /// <summary>可选的盘面大小。加档位只改这里 + 两端的选择器</summary>
    public static readonly int[] AllowedSizes = [13, 15, 19];

    /// <summary>把手滑传进来的 size 收拢到合法档位</summary>
    public static int ClampSize(int size) => AllowedSizes.Contains(size) ? size : DefaultSize;

    public static int MaxMoves(int size) => ClampSize(size) * ClampSize(size);

    /// <summary>一手棋。字段名故意用小写：它同时是落库 JSON 与下发 JSON 的形状</summary>
    public record Stone(int x, int y, int s);

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    public static bool InBoard(int x, int y, int size)
    {
        var n = ClampSize(size);
        return x >= 0 && y >= 0 && x < n && y < n;
    }

    public static List<Stone> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<Stone>>(json, JsonOpts) ?? []; }
        catch (JsonException) { return []; }   // 手改坏的数据不让整页 500
    }

    public static string Store(List<Stone> moves) => JsonSerializer.Serialize(moves);

    public static bool Occupied(IReadOnlyList<Stone> moves, int x, int y)
        => moves.Any(m => m.x == x && m.y == y);

    /// <summary>
    /// 落在 (x,y) 这手棋，在横 / 竖 / 两条斜线里最长的同色连子数。
    /// 只看经过落子点的四条线 —— 别的方向不可能因为这手棋同时凑齐，全盘扫描纯属浪费。
    /// </summary>
    public static int LongestRun(IReadOnlyList<Stone> moves, int x, int y, int side, int size)
        => LineRuns(moves, x, y, side, size).Max();

    /// <summary>落子后四个方向各自的连子数（横、竖、右下斜、右上斜）</summary>
    public static int[] LineRuns(IReadOnlyList<Stone> moves, int x, int y, int side, int size)
    {
        // 方向向量：横、竖、右下斜、右上斜
        int[] dx = [1, 0, 1, 1];
        int[] dy = [0, 1, 1, -1];

        var runs = new int[4];
        for (var d = 0; d < 4; d++)
        {
            var count = 1;
            for (var i = 1; i < WinLen + 1; i++)          // 多看一格，好判长连
            {
                if (!Has(moves, x + dx[d] * i, y + dy[d] * i, side, size)) break;
                count++;
            }
            for (var i = 1; i < WinLen + 1; i++)
            {
                if (!Has(moves, x - dx[d] * i, y - dy[d] * i, side, size)) break;
                count++;
            }
            runs[d] = count;
        }
        return runs;
    }

    /// <summary>成五（含以上）。自由规则下长连也算赢</summary>
    public static bool IsWin(IReadOnlyList<Stone> moves, int x, int y, int side, int size)
        => LongestRun(moves, x, y, side, size) >= WinLen;

    /// <summary>长连：连成 6 个以上。只在「标准规则」下对黑方判负</summary>
    public static bool IsOverline(IReadOnlyList<Stone> moves, int x, int y, int side, int size)
        => LineRuns(moves, x, y, side, size).Any(r => r > WinLen);

    /// <summary>
    /// 黑方禁手（仅标准规则用；自由规则禁手全关）。
    /// 三三 / 四四：简化判定 —— 每方向最多记一个「四」（连四）/「活三」（两端皆空的三），
    /// 同一手形成 ≥2 个即禁手。返回 null=无禁手，否则禁手名。
    /// </summary>
    public static string? ForbiddenFoul(IReadOnlyList<Stone> moves, int x, int y, int size)
    {
        var runs = LineRuns(moves, x, y, 1, size);
        if (runs.Count(r => r == WinLen) >= 2) return "double-four";
        if (CountOpenThrees(moves, x, y, size) >= 2) return "double-three";
        return null;
    }

    /// <summary>活三数量：某方向恰连三且两端外一格都空</summary>
    private static int CountOpenThrees(IReadOnlyList<Stone> moves, int x, int y, int size)
    {
        int[] dx = [1, 0, 1, 1];
        int[] dy = [0, 1, 1, -1];
        var n = 0;
        for (var d = 0; d < 4; d++)
        {
            var lo = 0;
            var hi = 0;
            while (Has(moves, x - dx[d] * (lo + 1), y - dy[d] * (lo + 1), 1, size)) lo++;
            while (Has(moves, x + dx[d] * (hi + 1), y + dy[d] * (hi + 1), 1, size)) hi++;
            if (lo + hi + 1 != WinLen - 2) continue;   // 本方向恰成三

            var ex = x - dx[d] * (lo + 1);
            var ey = y - dy[d] * (lo + 1);
            var aOpen = InBoard(ex, ey, size) && !Occupied(moves, ex, ey);
            ex = x + dx[d] * (hi + 1);
            ey = y + dy[d] * (hi + 1);
            var bOpen = InBoard(ex, ey, size) && !Occupied(moves, ex, ey);
            if (aOpen && bOpen) n++;
        }
        return n;
    }

    private static bool Has(IReadOnlyList<Stone> list, int cx, int cy, int side, int size)
    {
        if (!InBoard(cx, cy, size)) return false;
        for (var i = 0; i < list.Count; i++)
            if (list[i].x == cx && list[i].y == cy) return list[i].s == side;
        return false;
    }

    /// <summary>棋盘下满且无人成五 = 和棋</summary>
    public static bool IsDraw(IReadOnlyList<Stone> moves, int size) => moves.Count >= MaxMoves(size);

    /// <summary>
    /// 星位：四角的「三三点」+ 天元。19 路盘正规是 9 个星，但这里只用来做视觉锚点，
    /// 5 个已经够定位，多画反而在手机上糊成一片。
    /// </summary>
    public static IReadOnlyList<(int x, int y)> StarPoints(int size)
    {
        var n = ClampSize(size);
        return [(3, 3), (n - 4, 3), (3, n - 4), (n - 4, n - 4), (n / 2, n / 2)];
    }

    /// <summary>另一方（1 ↔ 2）</summary>
    public static int Other(int side) => side == 1 ? 2 : 1;

    /// <summary>方名（给提示语用）</summary>
    public static string SideName(int side) => side == 1 ? "黑棋" : "白棋";
}
