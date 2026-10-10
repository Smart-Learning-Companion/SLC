const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Main → Floating: push session state changes from dashboard to main process
  setSessionState: (state) => ipcRenderer.send('session-state-changed', state),

  // Floating → Any: read current authoritative state stored in main process
  getCurrentSessionState: () => ipcRenderer.invoke('get-current-session-state'),

  // Floating: subscribe to state broadcasts from main process
  onSyncSessionState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('sync-session-state', listener);
    return () => ipcRenderer.removeListener('sync-session-state', listener);
  },

  // Floating: send action (start / pause / resume / stop) to main process
  triggerSessionAction: (action) => ipcRenderer.send('trigger-session-action', action),

  // Dashboard: receive forwarded actions from floating widget
  onSessionAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('session-action', listener);
    return () => ipcRenderer.removeListener('session-action', listener);
  },

  // Floating → Expand button: bring back main dashboard window
  restoreMainWindow: () => ipcRenderer.send('restore-main-window'),

  // Dashboard → Minimize button: hide main window, show floating widget
  minimizeToWidget: () => ipcRenderer.send('minimize-to-widget'),
});
