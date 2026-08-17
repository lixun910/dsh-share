import { contextBridge, ipcRenderer } from 'electron';
import type { DshShareApi } from './ipc';

const api: DshShareApi = {
  start: () => ipcRenderer.invoke('start'),
  stop: () => ipcRenderer.invoke('stop'),
  getAuth: () => ipcRenderer.invoke('get-auth'),
  regenerateAuth: () => ipcRenderer.invoke('regenerate-auth'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  openLocal: () => ipcRenderer.invoke('open-local'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  checkDshConflict: () => ipcRenderer.invoke('check-dsh-conflict'),
  stopDshOnPort: () => ipcRenderer.invoke('stop-dsh-on-port'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, data) => cb(data)),
};

contextBridge.exposeInMainWorld('dshShare', api);
