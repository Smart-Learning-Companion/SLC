#:property PublishAot=false
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:package Microsoft.AspNetCore.SignalR.Client@10.0.14
#:package Microsoft.Extensions.Logging.Console@10.0.14
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

// Dev tool: prints every SignalR event the orchestrator sends. Client log shows warnings and errors only.
var port = Environment.GetEnvironmentVariable("SLC_PORT") ?? "8100";
var token = Environment.GetEnvironmentVariable("SLC_TOKEN") ?? "dev";

var hub = new HubConnectionBuilder()
    .WithUrl($"http://127.0.0.1:{port}/hub", o => o.AccessTokenProvider = () => Task.FromResult<string?>(token))
    .WithAutomaticReconnect(new RetryForever())   // the default gives up after about 40 s
    .ConfigureLogging(l => { l.SetMinimumLevel(LogLevel.Warning); l.AddConsole(); })
    .Build();

hub.Closed += ex => { Console.WriteLine($"[conn] closed: {ex?.Message}"); return Task.CompletedTask; };
hub.Reconnecting += ex => { Console.WriteLine($"[conn] reconnecting: {ex?.Message}"); return Task.CompletedTask; };
hub.Reconnected += id => { Console.WriteLine($"[conn] reconnected, id={id}"); return Task.CompletedTask; };

foreach (var name in new[] { "status", "softAlert", "captureRequest", "explanation" })
    hub.On<JsonElement>(name, payload => Console.WriteLine($"[{name}] {payload}"));

await hub.StartAsync();
Console.WriteLine($"[conn] connected, id={hub.ConnectionId}, state={hub.State}");
await Task.Delay(Timeout.Infinite);

sealed class RetryForever : IRetryPolicy
{
    public TimeSpan? NextRetryDelay(RetryContext context) => TimeSpan.FromSeconds(2);
}
