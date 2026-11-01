# Dev setup: extra commands

Windows commands are marked untested until someone on Windows confirms them.

## Test a Gemini model before choosing it

In URLs write `${MODEL}` with braces. Without braces zsh and PowerShell read the colon as part of the name and build a broken URL.

Linux:

    MODEL=<model>
    curl -sS -m 40 -X POST "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent" \
      -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"Say hello in Sinhala."}]}]}'

Windows:

    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $model = "<model>"
    $body = @{ contents = @(@{ parts = @(@{ text = "Say hello in Sinhala." }) }) } | ConvertTo-Json -Depth 6
    (Invoke-RestMethod -Method Post -TimeoutSec 40 -Uri "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent" `
      -Headers @{ "x-goog-api-key" = $env:GEMINI_API_KEY } -ContentType "application/json" -Body $body).candidates[0].content.parts[0].text

Newer models are sometimes overloaded (503) or do not answer. Pick by testing, not by newness.
In AI Studio, check the project's request-logging setting.

## Send a test frame (orchestrator running, listener open)

Linux:

    grim -t jpeg /tmp/frame.jpg
    curl -i -X POST -H "Authorization: Bearer dev" -H "Content-Type: image/jpeg" -H "X-Request-Id: t1" --data-binary @/tmp/frame.jpg http://127.0.0.1:8100/context/frame

Windows (use `curl.exe`; plain `curl` is a PowerShell alias):

    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save("$env:TEMP\frame.jpg", [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $g.Dispose(); $bmp.Dispose()
    curl.exe -i -X POST -H "Authorization: Bearer dev" -H "Content-Type: image/jpeg" -H "X-Request-Id: t1" --data-binary "@$env:TEMP\frame.jpg" http://127.0.0.1:8100/context/frame

Expect `202`, then an `explanation` event in the listener.

## Check processes and camera

| Task | Linux | Windows |
| --- | --- | --- |
| Is Python still running? | `pgrep -af "python app.py"` | `Get-Process python -ErrorAction SilentlyContinue` |
| Is the camera in use? | `fuser -v /dev/video0` | watch the camera light |
| Hard-kill the orchestrator | `pkill -9 -f Slc.Orchestrator` | `Stop-Process -Name Slc.Orchestrator -Force` |
