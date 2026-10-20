using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Unicode;

namespace CheckinApp.Services;

/// <summary>
/// PyLab 进程桥：把「一次网页请求」翻译成「启动一个 Python 进程 + stdin 喂 JSON + stdout 收 JSON」。
///
/// 为什么不用常驻 Python 服务：
///   四个功能都是「一问一答」，没有流式输出需求。常驻服务要多一个 systemd unit、一个端口、
///   一层反代和一套存活探测，故障面变大，只省掉 0.3 秒冷启动，不划算。
///
/// 设计约束（为了让这个模块能一键拆除，见 Pages/PyLab.cshtml.cs）：
///   · 本类没有实例状态，页面里直接 new 就能用，不必在 Program.cs 注册 DI；
///   · 并发闸门、路径缓存都是 static，多实例共享。
///
/// 安全边界：
///   本层只转发动作名，动作必须在白名单内。真正的代码永远由 Python 侧按 id 从预置片段库取，
///   浏览器传进来的字符串不会被当成代码执行。
/// </summary>
public sealed class PyLabBridge
{
    /// <summary>
    /// 浏览器可以触发的动作。注意这里刻意<b>没有</b> convert ——
    /// 转换会拉起 LibreOffice、读写磁盘，只能由服务端内部调用。
    /// </summary>
    private static readonly HashSet<string> BrowserActions =
    [
        "probe", "bootstrap", "pick", "mark", "attendance", "reset",
        "slide", "goto", "outline", "page_links", "snippet", "extension"
    ];

    private static readonly JsonSerializerOptions JsonOut = new()
    {
        // 中文不转义成 \uXXXX：响应更小，调试时肉眼可读
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    };

    private static readonly SemaphoreSlim Gate = new(4, 4);   // 最多 4 个 Python 子进程并发
    private static string? _pythonCache;
    private static string? _rootCache;

    private readonly ILogger<PyLabBridge> _log;
    private readonly IConfiguration _cfg;

    public PyLabBridge(ILogger<PyLabBridge> log, IConfiguration cfg)
    {
        _log = log;
        _cfg = cfg;
    }

    public int TimeoutSeconds =>
        int.TryParse(_cfg["PyLab:TimeoutSeconds"], out var t) ? Math.Clamp(t, 5, 120) : 20;

    public string? PythonPath => _pythonCache ??= ResolvePython();

    public string? ScriptRoot => _rootCache ??= ResolveRoot();

    public bool Enabled => PythonPath is not null && ScriptRoot is not null;

    /// <summary>给页面顶部徽标用的状态文案。</summary>
    public string StatusText
    {
        get
        {
            if (PythonPath is null) return "未找到 Python";
            if (ScriptRoot is null) return "未找到 main.py";
            return "Python 就绪";
        }
    }

    // ---------------- 路径探测 ----------------

    private string? ResolvePython()
    {
        // 1) 显式指定（环境变量优先于配置）——线上推荐用这个，避免 PATH 里有假 python
        var configured = Environment.GetEnvironmentVariable("PYLAB_PYTHON") ?? _cfg["PyLab:PythonPath"];
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

        // 2) PATH：Windows 优先 python.exe（python3.exe 常是应用商店的占位符，会弹窗）
        foreach (var name in OperatingSystem.IsWindows()
                     ? new[] { "python", "python3" }
                     : new[] { "python3", "python" })
        {
            var found = FindOnPath(name);
            if (found is not null && !found.Contains("WindowsApps", StringComparison.OrdinalIgnoreCase))
                return found;
        }

        // 3) Windows 常见安装位置
        if (OperatingSystem.IsWindows())
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            foreach (var v in new[] { "Python314", "Python313", "Python312", "Python311" })
            {
                var p = Path.Combine(local, "Programs", "Python", v, "python.exe");
                if (File.Exists(p)) return p;
            }
        }

        return null;
    }

    private static string? FindOnPath(string name)
    {
        var exe = OperatingSystem.IsWindows() ? name + ".exe" : name;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            try
            {
                var full = Path.Combine(dir.Trim('"'), exe);
                if (File.Exists(full)) return full;
            }
            catch { /* 非法路径字符，跳过 */ }
        }
        return null;
    }

    private static string? ResolveRoot()
    {
        var candidates = new List<string>();

        var env = Environment.GetEnvironmentVariable("PYLAB_ROOT");
        if (!string.IsNullOrWhiteSpace(env)) candidates.Add(env);

        // 开发时程序在 bin/Debug/net10.0，要向上回溯到项目根；发布后直接在 bin 目录下
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var dir = new DirectoryInfo(start);
            for (var i = 0; i < 5 && dir is not null; i++, dir = dir.Parent)
                candidates.Add(Path.Combine(dir.FullName, "tools", "pylab"));
        }

        return candidates.FirstOrDefault(c => File.Exists(Path.Combine(c, "main.py")));
    }

    // ---------------- 调用 ----------------

    /// <summary>调用 Python 侧的一个动作。永远返回结构化 JSON，不抛异常。</summary>
    public async Task<JsonObject> CallAsync(string action, JsonObject? payload, CancellationToken ct)
    {
        if (!BrowserActions.Contains(action))
            return Fail($"动作不在白名单内：{action}");

        var python = PythonPath;
        var root = ScriptRoot;
        if (python is null) return Fail("服务器未安装 Python，或未配置 PyLab:PythonPath");
        if (root is null) return Fail("未找到 tools/pylab/main.py");

        // 组装请求体：动作 + 状态 + 参数
        var request = new JsonObject { ["action"] = action };
        if (payload is not null)
        {
            foreach (var kv in payload.ToList())
            {
                payload.Remove(kv.Key);
                request[kv.Key] = kv.Value;
            }
        }

        await Gate.WaitAsync(ct);
        var sw = Stopwatch.StartNew();
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = python,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardInputEncoding = new UTF8Encoding(false),
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false),
            };
            psi.ArgumentList.Add(Path.Combine(root, "main.py"));
            psi.ArgumentList.Add("--json");
            // 子进程强制 UTF-8：服务器 locale 可能是 POSIX，不设中文直接崩
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["PYTHONUTF8"] = "1";
            psi.Environment["PYTHONDONTWRITEBYTECODE"] = "1";

            using var proc = new Process { StartInfo = psi };
            if (!proc.Start()) return Fail("Python 进程启动失败");

            // 关键顺序：先并行起读取任务，再写 stdin。
            // 反过来在输出较大时会互相等待，死锁。
            var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = proc.StandardError.ReadToEndAsync(ct);

            await proc.StandardInput.WriteAsync(request.ToJsonString(JsonOut).AsMemory(), ct);
            proc.StandardInput.Close();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds));
            try
            {
                await proc.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                _log.LogWarning("PyLab 超时：action={Action}", action);
                return Fail($"Python 执行超时（>{TimeoutSeconds}s）");
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            if (string.IsNullOrWhiteSpace(stdout))
            {
                _log.LogWarning("PyLab 无输出：action={Action} stderr={Err}", action, Trim(stderr));
                return Fail("Python 没有返回结果：" + Trim(stderr));
            }

            var node = JsonNode.Parse(stdout) as JsonObject;
            if (node is null) return Fail("Python 返回的不是 JSON 对象");
            node["elapsedMs"] = sw.ElapsedMilliseconds;
            return node;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "PyLab 调用异常：action={Action}", action);
            return Fail("调用 Python 时出错：" + ex.Message);
        }
        finally
        {
            Gate.Release();
        }
    }

    private static JsonObject Fail(string message) => new() { ["ok"] = false, ["error"] = message };

    private static string Trim(string s) =>
        string.IsNullOrEmpty(s) ? "(空)" : s.Length <= 600 ? s : s[..600] + "…";
}
