using System.Diagnostics;

namespace Slc.Orchestrator;

/// Starts the Python ML service as a child process and stops it with the orchestrator.
/// Startup is not blocked: health is polled in the background and logged.
internal sealed class MlProcessHost(
    SlcSettings settings,
    IConfiguration config,
    IHostEnvironment env,
    IHttpClientFactory httpFactory,
    ILogger<MlProcessHost> log) : IHostedService, IDisposable
{
    private readonly CancellationTokenSource _cts = new();
    private Process? _proc;
    private volatile bool _stopping;

    public Task StartAsync(CancellationToken ct)
    {
        // Debug mode: the developer starts services by hand.
        if (settings.Dev)
        {
            log.LogInformation("SLC_DEV=1: not launching the ML service");
            return Task.CompletedTask;
        }

        // Defaults assume `dotnet run` from services/orchestrator. Electron must set SLC_ML_DIR.
        var mlDir = config["SLC_ML_DIR"] ?? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "ml"));
        var python = config["SLC_PYTHON"]
                     ?? Path.Combine(mlDir, ".venv", OperatingSystem.IsWindows() ? @"Scripts\python.exe" : "bin/python");

        if (!File.Exists(python))
        {
            log.LogError("Python interpreter not found at {Path}. Create the venv or set SLC_PYTHON.", python);
            return Task.CompletedTask;
        }

        var psi = new ProcessStartInfo(python)
        {
            WorkingDirectory = mlDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("app.py");

        // Token and ports travel by environment variable, never on the command line.
        psi.Environment["SLC_TOKEN"] = settings.Token;
        psi.Environment["SLC_ML_PORT"] = settings.MlPort;
        psi.Environment["SLC_ORCH_PORT"] = settings.Port;
        psi.Environment["SLC_WATCHDOG"] = "1";        // Python exits if this process disappears (Day 3)
        psi.Environment["PYTHONUNBUFFERED"] = "1";    // deliver log lines immediately

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data is not null) log.LogInformation("[ml] {Line}", e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) log.LogWarning("[ml] {Line}", e.Data); };
        proc.Exited += (sender, _) =>
        {
            var code = (sender as Process)?.ExitCode;
            if (_stopping) log.LogInformation("ML service stopped");
            else log.LogWarning("ML service exited unexpectedly with code {Code}", code);
        };

        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
        _proc = proc;
        log.LogInformation("Started ML service (pid {Pid}) in {Dir}", proc.Id, mlDir);

        _ = WaitForHealthAsync(_cts.Token); // fire and forget; logs the outcome
        return Task.CompletedTask;
    }

    private async Task WaitForHealthAsync(CancellationToken ct)
    {
        try
        {
            var client = httpFactory.CreateClient("ml");
            // up to ~30 s; importing MediaPipe on first start can be slow
            for (var i = 0; i < 60 && _proc is { HasExited: false }; i++)
            {
                try
                {
                    using var res = await client.GetAsync("/health", ct);
                    if (res.IsSuccessStatusCode) { log.LogInformation("ML service is healthy"); return; }
                }
                catch (HttpRequestException) { /* not up yet */ }
                await Task.Delay(500, ct);
            }
            log.LogWarning("ML service did not become healthy within 30 s");
        }
        catch (OperationCanceledException) { /* shutting down */ }
    }

    public async Task StopAsync(CancellationToken ct)
    {
        _stopping = true;
        await _cts.CancelAsync();
        if (_proc is not { HasExited: false } proc) return;

        proc.Kill(entireProcessTree: true);
        try { await proc.WaitForExitAsync(ct).WaitAsync(TimeSpan.FromSeconds(5), ct); }
        catch (TimeoutException) { log.LogWarning("ML service did not exit within 5 s"); }
    }

    public void Dispose()
    {
        _proc?.Dispose();
        _cts.Dispose();
    }
}
