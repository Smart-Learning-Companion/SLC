const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSessionState: (state) => ipcRenderer.send('session-state-changed', state),
  getCurrentSessionState: () => ipcRenderer.invoke('get-current-session-state'),
  onSyncSessionState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('sync-session-state', listener);
    return () => ipcRenderer.removeListener('sync-session-state', listener);
  },
  triggerSessionAction: (action) => ipcRenderer.send('trigger-session-action', action),
  onSessionAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('session-action', listener);
    return () => ipcRenderer.removeListener('session-action', listener);
  },
  restoreMainWindow: () => ipcRenderer.send('restore-main-window'),
  minimizeToWidget: () => ipcRenderer.send('minimize-to-widget'),
  sendFrameContext: (frameBuffer, requestId) =>
    ipcRenderer.invoke('send-frame-context', { frameBuffer, requestId }),
});
