#:package Microsoft.AspNetCore.SignalR.Client@10.0.14
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;

// Dev tool: prints every SignalR event the orchestrator sends.
var port = Environment.GetEnvironmentVariable("SLC_PORT") ?? "8100";
var token = Environment.GetEnvironmentVariable("SLC_TOKEN") ?? "dev";

var hub = new HubConnectionBuilder()
    .WithUrl($"http://127.0.0.1:{port}/hub", o => o.AccessTokenProvider = () => Task.FromResult<string?>(token))
    .WithAutomaticReconnect()
    .Build();

foreach (var name in new[] { "status", "softAlert", "captureRequest", "explanation" })
    hub.On<JsonElement>(name, payload => Console.WriteLine($"[{name}] {payload}"));

await hub.StartAsync();
Console.WriteLine("listening on /hub (Ctrl+C to stop)");
await Task.Delay(Timeout.Infinite);
