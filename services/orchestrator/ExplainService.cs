using Microsoft.AspNetCore.SignalR;

namespace Slc.Orchestrator;

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

    // Fire and forget: the HTTP request returns 202 at once and the result arrives over SignalR.
    public void Enqueue(byte[] frame, string requestId) => _ = Task.Run(() => RunAsync(frame, requestId));

    private async Task RunAsync(byte[] frame, string requestId)
    {
        if (!await _busy.WaitAsync(0))
        {
            await SendAsync(requestId, "Still working on the previous request.", "en");
            return;
        }
        try
        {
            var ocr = await RunOcrAsync(frame);
            if (ocr is null) { await SendAsync(requestId, "Could not read the screen.", "en"); return; }

            var text = ocr.Text?.Trim() ?? "";
            switch (text.Length)
            {
                case < MinChars:
                    await SendAsync(requestId, "No readable text found on the screen.", "en"); return;
                case > MaxChars:
                    text = text[..MaxChars];
                    break;
            }

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            var explanation = await gemini.ExplainAsync(text, cts.Token);
            await SendAsync(requestId, explanation, "si");
        }
        catch (Exception ex)
        {
            // Type and message only. Never log the OCR text, the frame or the key.
            log.LogWarning("Explain failed: {Type}: {Message}", ex.GetType().Name, ex.Message);
            await SendAsync(requestId, "Could not generate an explanation right now.", "en");
        }
        finally
        {
            _busy.Release();
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

    private Task SendAsync(string requestId, string text, string language) =>
        hub.Clients.All.SendAsync("explanation", new { requestId, text, language });
}
