'use strict';
// The renderer's entire view of the OS. Nothing else is exposed.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('glass', {
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  library: { get: invoke('library:get'), save: invoke('library:save') },
  spotify: {
    status: invoke('spotify:status'),
    login: invoke('spotify:login'),
    logout: invoke('spotify:logout'),
    token: invoke('spotify:token'),
  },
  apple: {
    status: invoke('apple:status'),
    developerToken: invoke('apple:developerToken'),
    pickKey: invoke('apple:pickKey'),
    setToken: invoke('apple:setToken'),
    clear: invoke('apple:clear'),
  },
  discord: {
    nowPlaying: invoke('discord:nowPlaying'),
    status: invoke('discord:status'),
    onStatus: (cb) => ipcRenderer.on('discord:status', (_e, s) => cb(s)),
  },
  net: { log: invoke('net:log') },
  privacy: { info: invoke('privacy:info') },
  files: { openPlaylist: invoke('file:openPlaylist'), savePlaylist: invoke('file:savePlaylist') },
  shell: { open: invoke('shell:open') },
  win: {
    minimize: invoke('window:minimize'),
    maximize: invoke('window:maximize'),
    close: invoke('window:close'),
    platform: invoke('app:platform'),
  },
});
