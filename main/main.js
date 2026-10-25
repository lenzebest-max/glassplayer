'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, protocol, net, session, dialog, safeStorage } = electron;

const { Store } = require('./store');
const { NetworkGuard } = require('./network-guard');
const { DiscordPresence, buildActivity } = require('./discord-rpc');
const spotifyAuth = require('./spotify-auth');
const { makeDeveloperToken, tokenExpiry } = require('./apple-token');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const APP_ORIGIN = 'app://glassplayer';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
// Music should start when you press play, even if the SDK calls play() off a gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;
let store;
let guard;
const discord = new DiscordPresence();
let lastNowPlaying = null;
let appleTokenCache = null;

const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isAppleAuthHost = (h) => /(^|\.)apple\.com$/.test(h);

function windowOptions() {
  const base = {
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#00000000',
    title: 'GlassPlayer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };
  if (process.platform === 'darwin') {
    return { ...base, vibrancy: 'under-window', visualEffectState: 'active', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } };
  }
  if (process.platform === 'win32') {
    return { ...base, backgroundMaterial: 'acrylic', titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 44 } };
  }
  return { ...base, frame: false, transparent: true };
}

function createWindow() {
  win = new BrowserWindow(windowOptions());
  win.loadURL(`${APP_ORIGIN}/index.html`);
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  // Never navigate the main window away from the app.
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) e.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    // MusicKit's sign-in runs in a popup that has to stay in-app to hand the token back.
    if (isHttps(url) && isAppleAuthHost(hostOf(url))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      };
    }
    if (isHttps(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function serveRenderer() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function lockDownPermissions(ses) {
  const allowed = new Set(['media', 'protected-media-identifier', 'mediaKeySystem', 'speaker-selection', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

// ---------------- Spotify ----------------

async function spotifyToken() {
  const clientId = store.getSettings().spotify.clientId;
  let tok = store.getSecret('spotify');
  if (!tok || !clientId) return null;
  if (Date.now() >= tok.expiresAt) {
    try {
      tok = await spotifyAuth.refresh(clientId, tok.refreshToken);
      store.setSecret('spotify', tok);
    } catch (err) {
      if (/invalid_grant|revoked/i.test(err.message)) store.setSecret('spotify', null);
      throw err;
    }
  }
  return { accessToken: tok.accessToken, expiresAt: tok.expiresAt };
}

// ---------------- Apple Music ----------------

function appleDeveloperToken() {
  if (appleTokenCache && appleTokenCache.expiresAt - Date.now() > 24 * 3600 * 1000) return appleTokenCache.token;
  const creds = store.getSecret('apple');
  if (!creds) return null;
  if (creds.token) {
    const exp = tokenExpiry(creds.token);
    if (exp && exp < Date.now()) return null;
    appleTokenCache = { token: creds.token, expiresAt: exp || Date.now() + 7 * 24 * 3600 * 1000 };
    return creds.token;
  }
  appleTokenCache = makeDeveloperToken(creds);
  return appleTokenCache.token;
}

function appleStatus() {
  const creds = store.getSecret('apple');
  if (!creds) return { configured: false };
  try {
    return { configured: Boolean(appleDeveloperToken()), mode: creds.token ? 'token' : 'key', teamId: creds.teamId || null, keyId: creds.keyId || null };
  } catch (err) {
    return { configured: false, error: err.message };
  }
}

// ---------------- Discord ----------------

function applyDiscordSettings() {
  const d = store.getSettings().discord;
  discord.configure({ enabled: d.enabled, clientId: (d.clientId || '').trim() });
  if (d.enabled) discord.setActivity(buildActivity(lastNowPlaying, d));
}

discord.on('status', (status) => {
  if (win) win.webContents.send('discord:status', status);
});

// ---------------- IPC ----------------

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!event.senderFrame || !event.senderFrame.url.startsWith(APP_ORIGIN)) throw new Error('Untrusted sender');
    return fn(...args);
  });
}

function registerIpc() {
  handle('settings:get', () => store.getSettings());
  handle('settings:set', (patch) => {
    const prevClientId = store.getSettings().spotify.clientId;
    const next = store.updateSettings(patch);
    if (patch && patch.discord) applyDiscordSettings();
    // Tokens are bound to the app that issued them.
    if (next.spotify.clientId !== prevClientId && store.getSecret('spotify')) store.setSecret('spotify', null);
    return next;
  });

  handle('library:get', () => store.getLibrary());
  handle('library:save', (library) => store.saveLibrary(library));

  handle('spotify:status', () => ({
    clientId: store.getSettings().spotify.clientId,
    connected: Boolean(store.getSecret('spotify')),
    redirectUri: spotifyAuth.REDIRECT_URI,
  }));
  handle('spotify:login', async () => {
    const clientId = store.getSettings().spotify.clientId.trim();
    if (!clientId) throw new Error('Add your Spotify Client ID in Settings first');
    const tok = await spotifyAuth.authorize(clientId, (url) => shell.openExternal(url));
    store.setSecret('spotify', tok);
    if (win) win.focus();
    return true;
  });
  handle('spotify:logout', () => store.setSecret('spotify', null));
  handle('spotify:token', () => spotifyToken());

  handle('apple:status', () => appleStatus());
  handle('apple:developerToken', () => appleDeveloperToken());
  handle('apple:pickKey', async ({ teamId, keyId }) => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose your MusicKit private key',
      filters: [{ name: 'MusicKit key', extensions: ['p8'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return appleStatus();
    const privateKey = fs.readFileSync(res.filePaths[0], 'utf8');
    const creds = { teamId: teamId.trim().toUpperCase(), keyId: keyId.trim().toUpperCase(), privateKey };
    makeDeveloperToken(creds); // throws on a bad key before we save anything
    store.setSecret('apple', creds);
    appleTokenCache = null;
    return appleStatus();
  });
  handle('apple:setToken', (token) => {
    token = String(token || '').trim();
    if (token.split('.').length !== 3) throw new Error('That does not look like a developer token (JWT)');
    store.setSecret('apple', { token });
    appleTokenCache = null;
    return appleStatus();
  });
  handle('apple:clear', () => {
    store.setSecret('apple', null);
    appleTokenCache = null;
    return appleStatus();
  });

  handle('discord:nowPlaying', (np) => {
    lastNowPlaying = np;
    const d = store.getSettings().discord;
    if (d.enabled) discord.setActivity(buildActivity(np, d));
  });
  handle('discord:status', () => discord.status());

  handle('net:log', () => guard.entries());
  handle('privacy:info', () => ({ encryption: store.encryptionBackend(), dataDir: app.getPath('userData') }));

  handle('file:openPlaylist', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Import a playlist file',
      filters: [{ name: 'Playlists', extensions: ['csv', 'm3u', 'm3u8', 'txt', 'json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('File is too large');
    return { name: path.basename(file), content: fs.readFileSync(file, 'utf8') };
  });
  handle('file:savePlaylist', async ({ suggestedName, content }) => {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [{ name: 'Playlist', extensions: [path.extname(suggestedName).slice(1) || 'csv'] }],
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, content, 'utf8');
    return true;
  });

  handle('shell:open', (url) => {
    if (isHttps(url)) shell.openExternal(url);
  });

  handle('window:minimize', () => win && win.minimize());
  handle('window:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('window:close', () => win && win.close());
  handle('app:platform', () => process.platform);
}

// ---------------- Lifecycle ----------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // castlabs Electron ships Widevine as a component, needed for DRM'd streams.
    if (electron.components) {
      try {
        await electron.components.whenReady();
      } catch (err) {
        console.error('Widevine component failed to load:', err);
      }
    }
    store = new Store(app.getPath('userData'), safeStorage);
    guard = new NetworkGuard(() => store.getSettings().network);
    guard.attach(session.defaultSession);
    lockDownPermissions(session.defaultSession);
    serveRenderer();
    registerIpc();
    createWindow();
    applyDiscordSettings();

    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  app.on('window-all-closed', () => {
    discord.disconnect();
    if (process.platform !== 'darwin') app.quit();
  });
}
