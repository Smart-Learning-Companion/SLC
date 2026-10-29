# Electron capture spike

## Linux Wayland (Pahasara): run `npm install && npm start` here and fill in the same list.
- Electron version: <output of npx electron --version>
- Working flags: <none needed / --ozone-platform=wayland / ... + WebRTCPipeWireCapturer>
- Portal prompts: 1 when the stream starts, 0 on later grabs (consent persists for the whole stream)
- Frame size, JPEG size, encode time: 1920x1080, 324-435 KB JPEG at quality 0.8, usually 30-45 ms, occasional spikes of 1.0-1.6 s
- Screen-share indicator visible; disappears on stop: yes
- /context/frame -> 202 in the page log; orchestrator forwarded every frame to /context/ocr and got 200
- Explanation event: sent by the hub; not verified in this spike (no SignalR client), the real UI will check it
- Decision: Electron capture works on Hyprland; no grim fallback needed
- Known limitation: none

## Windows 10/11 (Avishka): run `npm install && npm start` here and fill in the same list.
