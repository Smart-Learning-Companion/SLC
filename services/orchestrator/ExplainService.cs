using Microsoft.AspNetCore.SignalR;

namespace Slc.Orchestrator;

sealed record ExplainResult(string RequestId, string Text, string Language);

/// Quick-help pipeline: frame -> Python OCR -> Gemini -> "explanation" event.
/// One request at a time. Frames and OCR text stay in memory and are never logged.
sealed class ExplainService(
    IHttpClientFactory httpFactory,
    GeminiClient gemini,
    IHubContext<SlcHub> hub,
    ILogger<ExplainService> log)
{
    private const int MinChars = 10;    // below this there is nothing worth explaining
    private const int MaxChars = 6000;  // keeps the prompt small and cheap
    private readonly SemaphoreSlim _busy = new(1, 1);

    // The real app path: returns at once, the result arrives over SignalR.
    public void Enqueue(byte[] frame, string requestId) => _ = Task.Run(() => ExplainAsync(frame, requestId));

    // Runs the pipeline, sends the "explanation" event, and also returns the result (used by ?wait=true).
    public async Task<ExplainResult> ExplainAsync(byte[] frame, string requestId)
    {
        ExplainResult result;
        if (!await _busy.WaitAsync(0))
        {
            result = new(requestId, "Still working on the previous request.", "en");
        }
        else
        {
            try { result = await RunAsync(frame, requestId); }
            finally { _busy.Release(); }
        }
        await hub.Clients.All.SendAsync("explanation", result);
        return result;
    }

    private async Task<ExplainResult> RunAsync(byte[] frame, string requestId)
    {
        try
        {
            var ocr = await RunOcrAsync(frame);
            if (ocr is null) return new(requestId, "Could not read the screen.", "en");

            var text = ocr.Text?.Trim() ?? "";
            if (text.Length < MinChars) return new(requestId, "No readable text found on the screen.", "en");
            if (text.Length > MaxChars) text = text[..MaxChars];

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            return new(requestId, await gemini.ExplainAsync(text, cts.Token), "si");
        }
        catch (Exception ex)
        {
            // Type and message only. Never log the OCR text, the frame or the key.
            log.LogWarning("Explain failed: {Type}: {Message}", ex.GetType().Name, ex.Message);
            return new(requestId, "Could not generate an explanation right now.", "en");
        }
    }

    private async Task<OcrResult?> RunOcrAsync(byte[] frame)
    {
        using var content = new ByteArrayContent(frame);
        content.Headers.ContentType = new("image/jpeg");
        using var resp = await httpFactory.CreateClient("ml").PostAsync("/context/ocr", content);
        if (!resp.IsSuccessStatusCode) return null;
        return await resp.Content.ReadFromJsonAsync<OcrResult>();
    }
}
