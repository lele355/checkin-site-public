namespace CheckinApp.Ui;

/// <summary>
/// 心情贴纸脸（2026-11-02 站主定：贴合示意图的可爱手绘贴纸风）。
/// 两种脸型区分两人：圆脸（暖橙）/ 方脸（米色）。
/// 6 种心情**从左到右由坏到好**（站主定）：
/// 1 生气(皱眉撅嘴) 2 难过(八字眉撇嘴) 3 困(闭眼 o 嘴) 4 平淡(豆豆眼) 5 害羞(ω 嘴深腮红) 6 开心(眯眼大笑)。
/// 参数化拼 SVG（描边+腮红+高光，贴纸质感）；App 端 Compose Canvas 同款。
/// </summary>
public static class MoodStickers
{
    public static readonly string[] Names = ["生气", "难过", "困", "平淡", "害羞", "开心"];

    /// <summary>生成贴纸 SVG。mood 1..6（坏→好）；round=true 圆脸（自己）/ false 方脸（对方）。</summary>
    public static string Svg(int mood, bool round, int size = 46)
    {
        mood = Math.Clamp(mood, 1, 6);
        var body = round
            ? """<circle cx="32" cy="33" r="25" fill="var(--sticker-face,#FFD9A8)" stroke="#7A5B3C" stroke-width="2.5"/>"""
            : """<rect x="9" y="10" width="46" height="46" rx="13" fill="var(--sticker-face,#F2E3C9)" stroke="#7A5B3C" stroke-width="2.5"/>""";

        // 高光
        var shine = round
            ? """<ellipse cx="23" cy="20" rx="6" ry="4" fill="#fff" opacity=".45" transform="rotate(-18 23 20)"/>"""
            : """<ellipse cx="21" cy="18" rx="5" ry="3.5" fill="#fff" opacity=".45" transform="rotate(-18 21 18)"/>""";

        // 腮红（害羞更深）
        var blushOpacity = mood == 5 ? ".85" : ".5";
        var cy = round ? 38 : 39;
        var blush = $"""
            <ellipse cx="{(round ? 20 : 19)}" cy="{cy}" rx="5.2" ry="3.4" fill="#FF9E9E" opacity="{blushOpacity}"/>
            <ellipse cx="{(round ? 44 : 45)}" cy="{cy}" rx="5.2" ry="3.4" fill="#FF9E9E" opacity="{blushOpacity}"/>
            """;

        // 眼睛 + 嘴（按心情 1..6 坏→好）
        var eyY = round ? 30 : 31;
        (string eyes, string mouth) = mood switch
        {
            // 1 生气：皱眉斜眼 + 撅嘴
            1 => ($"""
                <path d="M19.5 {eyY - 3} l6.5 2.2 M44.5 {eyY - 3} l-6.5 2.2" stroke="#5B4632" stroke-width="2.4" stroke-linecap="round"/>
                <circle cx="23.6" cy="{eyY + 1.8}" r="2.1" fill="#5B4632"/>
                <circle cx="40.4" cy="{eyY + 1.8}" r="2.1" fill="#5B4632"/>
                """, $"""<path d="M27 {eyY + 10} q6 -4.4 12 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>"""),
            // 2 难过：八字眉 + 下垂眼 + 撇嘴（∩ 型）
            2 => ($"""
                <path d="M19.5 25.5 q3.5 -2.2 7 -0.8 M44.5 25.5 q-3.5 -2.2 -7 -0.8" stroke="#5B4632" stroke-width="2.2" stroke-linecap="round" fill="none"/>
                <path d="M20 {eyY + 1.5} q3.2 3.6 6.4 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M37.6 {eyY + 1.5} q3.2 3.6 6.4 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                """, $"""<path d="M26 {eyY + 10} q6 -5.5 12 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>"""),
            // 3 困：闭眼线 + 小 o 嘴 + zzz
            3 => ($"""
                <path d="M20 {eyY} h6.4 M37.6 {eyY} h6.4" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                """, $"""
                <ellipse cx="32" cy="{eyY + 9}" rx="3" ry="3.8" fill="none" stroke="#5B4632" stroke-width="2.4"/>
                <text x="47" y="18" font-size="12" fill="#8FA9C9">z</text>
                <text x="53" y="12" font-size="9" fill="#8FA9C9">z</text>
                """),
            // 4 平淡：豆豆眼 + 平嘴
            4 => ($"""
                <circle cx="23.2" cy="{eyY}" r="2.4" fill="#5B4632"/>
                <circle cx="40.8" cy="{eyY}" r="2.4" fill="#5B4632"/>
                """, $"""<path d="M28 {eyY + 8} h8" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>"""),
            // 5 害羞：眯眼 + ω 猫嘴 + 深腮红（和开心拉开：嘴是 ω 不是大笑弧）
            5 => ($"""
                <path d="M20 {eyY + 1} q3.2 -3.6 6.4 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M37.6 {eyY + 1} q3.2 -3.6 6.4 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                """, $"""<path d="M27 {eyY + 8} q2.5 2.8 5 0 q2.5 -2.8 5 0" fill="none" stroke="#5B4632" stroke-width="2.3" stroke-linecap="round"/>"""),
            // 6 开心：弯月眯眼 + 大笑弧
            _ => ($"""
                <path d="M20 {eyY} q3.2 -4.2 6.4 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M37.6 {eyY} q3.2 -4.2 6.4 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>
                """, $"""<path d="M26 {eyY + 8} q6 6.2 12 0" fill="none" stroke="#5B4632" stroke-width="2.6" stroke-linecap="round"/>"""),
        };

        return $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 64 64">
            {body}{shine}{eyes}{mouth}{blush}
            </svg>
            """;
    }
}
