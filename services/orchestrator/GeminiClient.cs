using System.Net;
using System.Text;
using System.Text.Json;

namespace Slc.Orchestrator;

/// Text-only Gemini client. Only OCR text is ever sent, never images.
/// The API key goes in a header, so it never appears in a URL or a log line.
sealed class GeminiClient(IHttpClientFactory httpFactory, IConfiguration config)
{
    // Loaded once. Edit Prompts/system-si.txt to change behaviour; no code change needed.
    private readonly string _systemPrompt =
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Prompts", "system-si.txt"));

    public async Task<string> ExplainAsync(string ocrText, CancellationToken ct)
    {
        var key = config["GEMINI_API_KEY"];
        if (string.IsNullOrWhiteSpace(key))
            throw new InvalidOperationException("GEMINI_API_KEY is not set");
        var model = config["SLC_GEMINI_MODEL"];
        if (string.IsNullOrWhiteSpace(model))
            throw new InvalidOperationException("SLC_GEMINI_MODEL is not set");
        var fallback = config["SLC_GEMINI_FALLBACK_MODEL"];

        var body = new
        {
            systemInstruction = new { parts = new[] { new { text = _systemPrompt } } },
            contents = new[]
            {
                new { role = "user", parts = new[] { new { text = $"<screen_text>\n{ocrText}\n</screen_text>" } } },
            },
            // Thinking models spend part of this budget on reasoning, so keep it generous.
            generationConfig = new { temperature = 0.3, maxOutputTokens = 4096 },
        };

        // Two attempts: the fallback model if one is set, otherwise the same model again.
        string[] attempts = string.IsNullOrWhiteSpace(fallback) ? [model, model] : [model, fallback];

        Exception? last = null;
        for (var i = 0; i < attempts.Length; i++)
        {
            if (i > 0) await Task.Delay(TimeSpan.FromSeconds(1), ct);
            try
            {
                return await CallAsync(attempts[i], key, body, ct);
            }
            // 429 (rate limit) and 503 (overloaded) are usually short spikes.
            catch (HttpRequestException ex) when (ex.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable)
            {
                last = ex;
            }
            // The HttpClient timeout (not the caller cancelling): the model never answered.
            catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
            {
                last = ex;
            }
        }
        throw last!;
    }

    private async Task<string> CallAsync<T>(string model, string key, T body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, $"v1beta/models/{model}:generateContent");
        req.Content = JsonContent.Create(body);
        req.Headers.Add("x-goog-api-key", key);

        using var res = await httpFactory.CreateClient("gemini").SendAsync(req, ct);
        res.EnsureSuccessStatusCode(); // the message holds the status code only: no key, no body

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var sb = new StringBuilder();
        if (doc.RootElement.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0
                                                                        && cands[0].TryGetProperty("content", out var content)
                                                                        && content.TryGetProperty("parts", out var parts))
        {
            foreach (var part in parts.EnumerateArray())
                if (part.TryGetProperty("text", out var t)) sb.Append(t.GetString());
        }
        return sb.Length > 0 ? sb.ToString() : throw new InvalidOperationException("Gemini returned no text");
    }
}
