using System.Text.Json;
using CheckinApp.Models;

namespace CheckinApp.Services.Ai;

/// <summary>飞行棋 AI —— 贪心（优先起飞 > 走最远的子）</summary>
public static class LudoAi
{
    public static JsonElement? Think(IReadOnlyList<GameEvent> evs, int side, int level, GameRoom r) =>
        LudoRules.Think(evs, side, level, r);
}
