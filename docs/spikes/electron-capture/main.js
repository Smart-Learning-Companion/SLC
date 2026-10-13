const { app, BrowserWindow, session } = require("electron");

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: { id: "screen:0:0", name: "Entire Screen" } });
  });
  const win = new BrowserWindow({ width: 900, height: 700 });
  win.loadFile("index.html");
});
app.on("window-all-closed", () => app.quit());
