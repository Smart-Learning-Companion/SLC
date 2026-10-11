using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.SignalR;

var token = Environment.GetEnvironmentVariable("SLC_TOKEN") ?? "dev";
var port = Environment.GetEnvironmentVariable("SLC_PORT") ?? "8100";
var mlPort = Environment.GetEnvironmentVariable("SLC_ML_PORT") ?? "8200";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.Services.AddSignalR();
builder.Services.AddSingleton<SessionState>();
// Localhost only + bearer token, so any origin is acceptable (Electron serves the UI from file:// or Vite).
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddHttpClient("ml", c =>
{
    c.BaseAddress = new Uri($"http://127.0.0.1:{mlPort}");
    c.Timeout = TimeSpan.FromSeconds(15);
    c.DefaultRequestHeaders.Authorization = new("Bearer", token);
});

var app = builder.Build();
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

app.MapPost("/context/frame", async (HttpRequest req, IHttpClientFactory f, IHubContext<SlcHub> hub) =>
{
    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);                       // frame stays in memory, never saved
    var requestId = req.Headers["X-Request-Id"].ToString();
    using var content = new ByteArrayContent(ms.ToArray());
    content.Headers.ContentType = new("image/jpeg");
    using var resp = await f.CreateClient("ml").PostAsync("/context/ocr", content);
    if (!resp.IsSuccessStatusCode) return Results.StatusCode(StatusCodes.Status502BadGateway);
    var ocr = await resp.Content.ReadFromJsonAsync<OcrResult>();
    // Gemini comes in Week 4. For now echo the OCR text so the UI panel has something to show.
    await hub.Clients.All.SendAsync("explanation",
        new { requestId, text = $"[mock] OCR saw: {ocr?.Text}", language = "en" });
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
