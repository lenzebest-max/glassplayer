'use strict';
// Minimal Discord Rich Presence client over Discord's local IPC socket.
// Zero dependencies: the protocol is just length-prefixed JSON frames.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RECONNECT_MS = 15000;
const MIN_SEND_INTERVAL_MS = 4000; // Discord allows 5 updates / 20s

function candidatePaths() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
  const bases = [...new Set([XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP, '/tmp'].filter(Boolean))];
  // Plain install, Flatpak, Snap and Vesktop all put the socket in different places.
  const subdirs = ['', 'app/com.discordapp.Discord', 'snap.discord', 'app/dev.vencord.Vesktop', '.flatpak/dev.vencord.Vesktop/xdg-run'];
  const out = [];
  for (const base of bases) {
    for (const sub of subdirs) {
      for (let i = 0; i < 10; i++) {
        const p = path.join(base, sub, `discord-ipc-${i}`);
        if (fs.existsSync(p)) out.push(p);
      }
    }
  }
  return out;
}

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

function tryConnect(p) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(p);
    const onError = (err) => { sock.destroy(); reject(err); };
    sock.once('connect', () => { sock.off('error', onError); resolve(sock); });
    sock.once('error', onError);
  });
}

class DiscordPresence extends EventEmitter {
  constructor() {
    super();
    this.clientId = null;
    this.enabled = false;
    this.socket = null;
    this.ready = false;
    this.user = null;
    this.buffer = Buffer.alloc(0);
    this.activity = null;
    this.lastSent = 0;
    this.sendTimer = null;
    this.reconnectTimer = null;
    this.connecting = false;
    this.compat = false; // set when Discord rejects newer activity fields
    this.pending = new Map();
  }

  configure({ enabled, clientId }) {
    const changed = clientId !== this.clientId;
    this.enabled = Boolean(enabled && clientId);
    this.clientId = clientId || null;
    if (!this.enabled) return this.disconnect();
    if (changed) this.disconnect();
    if (!this.socket) this.connect();
  }

  status() {
    return { enabled: this.enabled, connected: this.ready, user: this.user ? this.user.username : null };
  }

  async connect() {
    if (this.connecting || this.socket || !this.enabled) return;
    this.connecting = true;
    clearTimeout(this.reconnectTimer);
    try {
      for (const p of candidatePaths()) {
        try {
          this.socket = await tryConnect(p);
          break;
        } catch { /* try next */ }
      }
      if (!this.socket) throw new Error('Discord is not running');
      this.buffer = Buffer.alloc(0);
      this.socket.on('data', (chunk) => this.onData(chunk));
      this.socket.on('close', () => this.onClose());
      this.socket.on('error', () => this.onClose());
      this.socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    } catch {
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.sendTimer);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
    }
    this.socket = null;
    this.ready = false;
    this.user = null;
    this.emit('status', this.status());
  }

  onClose() {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.destroy();
    this.socket = null;
    this.ready = false;
    this.user = null;
    this.emit('status', this.status());
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    if (!this.enabled) return;
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      const body = this.buffer.subarray(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.subarray(8 + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      this.onMessage(op, msg);
    }
  }

  onMessage(op, msg) {
    if (op === OP.PING) return this.socket && this.socket.write(encode(OP.PONG, msg));
    if (op === OP.CLOSE) return this.onClose();
    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.ready = true;
      this.user = msg.data && msg.data.user;
      this.emit('status', this.status());
      this.flush(true);
      return;
    }
    if (msg.nonce && this.pending.has(msg.nonce)) {
      this.pending.delete(msg.nonce);
      if (msg.evt === 'ERROR' && !this.compat) {
        // Older Discord builds reject newer fields (type / status_display_type). Retry plain.
        this.compat = true;
        this.flush(true);
      }
    }
  }

  setActivity(activity) {
    this.activity = activity;
    this.flush(false);
  }

  flush(immediate) {
    if (!this.ready) return;
    clearTimeout(this.sendTimer);
    const wait = immediate ? 0 : Math.max(0, this.lastSent + MIN_SEND_INTERVAL_MS - Date.now());
    this.sendTimer = setTimeout(() => this.send(), wait);
  }

  send() {
    if (!this.ready || !this.socket) return;
    let activity = this.activity;
    if (activity && this.compat) {
      activity = { ...activity };
      delete activity.type;
      delete activity.status_display_type;
    }
    const nonce = crypto.randomUUID();
    this.pending.set(nonce, true);
    if (this.pending.size > 50) this.pending.delete(this.pending.keys().next().value);
    this.socket.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: activity || undefined },
      nonce,
    }));
    this.lastSent = Date.now();
  }
}

const clip = (s, n = 128) => {
  s = String(s || '').trim();
  if (s.length < 2) s = s.padEnd(2, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Turn the renderer's now-playing snapshot into a Discord activity.
function buildActivity(np, { showPaused = true } = {}) {
  if (!np || !np.title) return null;
  if (!np.playing && !showPaused) return null;
  const serviceName = np.service === 'apple' ? 'Apple Music' : 'Spotify';
  const activity = {
    type: 2, // "Listening to"
    status_display_type: 2, // show the song title in the member list
    details: clip(np.title),
    state: clip(np.artist ? `by ${np.artist}` : serviceName),
    assets: {},
    instance: false,
  };
  if (np.artwork && /^https:\/\//.test(np.artwork) && np.artwork.length <= 256) {
    activity.assets.large_image = np.artwork;
    if (np.album) activity.assets.large_text = clip(np.album);
  }
  activity.assets.small_text = np.playing ? `via ${serviceName}` : 'Paused';
  if (np.playing && np.durationMs > 0) {
    const start = Date.now() - Math.max(0, np.positionMs || 0);
    activity.timestamps = { start, end: start + np.durationMs };
  }
  if (np.url && /^https:\/\/(open\.spotify\.com|music\.apple\.com)\//.test(np.url)) {
    activity.buttons = [{ label: `Open in ${serviceName}`, url: np.url }];
  }
  if (!Object.keys(activity.assets).length) delete activity.assets;
  return activity;
}

module.exports = { DiscordPresence, buildActivity, encode, OP };
