using System.Text.Encodings.Web;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Slc.Orchestrator;

// SLC_DEV=1 means "services are started by hand": allow the dev token and do not launch Python.
var dev = Environment.GetEnvironmentVariable("SLC_DEV") == "1";
var token = Environment.GetEnvironmentVariable("SLC_TOKEN")
    ?? (dev ? "dev" : throw new InvalidOperationException("SLC_TOKEN is not set (SLC_DEV=1 allows the dev token)."));
var port = Environment.GetEnvironmentVariable("SLC_PORT") ?? "8100";
var mlPort = Environment.GetEnvironmentVariable("SLC_ML_PORT") ?? "8200";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.Services.AddSignalR();
builder.Services.AddSingleton<SessionState>();
builder.Services.AddSingleton(new SlcSettings(token, port, mlPort, dev));
// Localhost only + bearer token, so any origin is acceptable (Electron serves the UI from file:// or Vite).
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddHttpClient("ml", c =>
{
    c.BaseAddress = new Uri($"http://127.0.0.1:{mlPort}");
    c.Timeout = TimeSpan.FromSeconds(30);
    c.DefaultRequestHeaders.Authorization = new("Bearer", token);
});
builder.Services.AddHttpClient("gemini", c =>
{
    c.BaseAddress = new Uri("https://generativelanguage.googleapis.com/");
    c.Timeout = TimeSpan.FromSeconds(25);   // per attempt; GeminiClient retries once
});
builder.Services.AddSingleton<GeminiClient>();
builder.Services.AddSingleton<ExplainService>();
builder.Services.AddHostedService<MlProcessHost>();

var app = builder.Build();
if (string.IsNullOrWhiteSpace(app.Configuration["GEMINI_API_KEY"]) || string.IsNullOrWhiteSpace(app.Configuration["SLC_GEMINI_MODEL"]))
    app.Logger.LogWarning("GEMINI_API_KEY or SLC_GEMINI_MODEL is not set; explanations will fail.");
app.UseCors();

// Token check on everything except /health. The SignalR WebSocket passes it as ?access_token=.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/health")) { await next(); return; }
    var header = ctx.Request.Headers.Authorization.ToString();
    var supplied = header.StartsWith("Bearer ") ? header["Bearer ".Length..]
        : ctx.Request.Path.StartsWithSegments("/hub") ? ctx.Request.Query["access_token"].ToString()
        : "";
    if (CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(token)))
    {
        await next();
        return;
    }
    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
});

app.MapHub<SlcHub>("/hub");
app.MapGet("/health", () => new { status = "ok" });

app.MapPost("/ingest/features", (FeaturePacket p, SessionState s) =>
{
    s.Latest = p;
    var n = Interlocked.Increment(ref s.Count);
    if (n % 25 == 0)
        Console.WriteLine($"ingest #{n}: face={p.FaceFound} ear={p.Ear:F3} furrow={p.BrowFurrow:F2}");
    return Results.NoContent();
});

async Task SetSession(string state, bool perceptionOn, SessionState s, IHubContext<SlcHub> hub, IHttpClientFactory f)
{
    s.State = state;
    try { using var _ = await f.CreateClient("ml").PostAsync(perceptionOn ? "/perception/start" : "/perception/stop", null); }
    catch (Exception e) { Console.WriteLine($"ML service not reachable: {e.Message}"); }
    await hub.Clients.All.SendAsync("status", new { state, cpuPercent = 0.0 });
}

app.MapPost("/session/start", async (SessionState s, IHubContext<SlcHub> hub, IHttpClientFactory f) =>
{
    s.SessionId = Guid.NewGuid().ToString("N");
    await SetSession("monitoring", true, s, hub, f);
    return Results.Ok(new { sessionId = s.SessionId });
});
app.MapPost("/session/pause", async (SessionState s, IHubContext<SlcHub> hub, IHttpClientFactory f) =>
{
    await SetSession("paused", false, s, hub, f);
    return Results.NoContent();
});
app.MapPost("/session/stop", async (SessionState s, IHubContext<SlcHub> hub, IHttpClientFactory f) =>
{
    await SetSession("idle", false, s, hub, f);
    return Results.NoContent();
});

app.MapPost("/help/now", async (IHubContext<SlcHub> hub) =>
{
    await hub.Clients.All.SendAsync("captureRequest", new { requestId = Guid.NewGuid().ToString("N")[..8] });
    return Results.Accepted();
});

// Sinhala is shown as-is instead of \uXXXX escapes in the demo response.
var demoJson = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
};

app.MapPost("/context/frame", async (HttpRequest req, ExplainService explain, bool? wait) =>
{
    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);                       // frame stays in memory, never saved
    if (ms.Length == 0) return Results.BadRequest();
    var requestId = req.Headers["X-Request-Id"].ToString();
    if (wait == true)                                     // demo/debug: hold the request, return the result
        return Results.Json(await explain.ExplainAsync(ms.ToArray(), requestId), demoJson);
    explain.Enqueue(ms.ToArray(), requestId);             // the real app: 202 now, result over SignalR
    return Results.Accepted();
});

app.MapPost("/alerts/{id}/response", (string id, AlertResponse r) =>
{
    Console.WriteLine($"alert {id} accepted={r.Accepted}");
    return Results.NoContent();
});
app.MapGet("/analytics/timeline", () => Array.Empty<object>());
app.MapGet("/analytics/summary", () => new { focusedPct = 0.0, alerts = 0, accepted = 0 });

app.Run();

record FeaturePacket(double T, bool FaceFound, Dictionary<string, double>? Fer, double? Ear, double? BlinkRate,
    double? BrowFurrow, double? MouthOpen, double? HeadPitch, double? HeadYaw, Dictionary<string, double>? States);
record SlcSettings(string Token, string Port, string MlPort, bool Dev);
record AlertResponse(bool Accepted);
record OcrResult(string Text, double Confidence, double DurationMs);
class SlcHub : Hub { }
class SessionState
{
    public string State = "idle";
    public string SessionId = "";
    public FeaturePacket? Latest;
    public int Count;
}
