'use strict';
// Local-only persistence. Settings and playlists are plain JSON in the user
// data folder; credentials are encrypted with the OS keychain (safeStorage).

const fs = require('fs');
const path = require('path');

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const DEFAULT_SETTINGS = {
  preferredService: 'auto',
  volume: 0.7,
  discord: { enabled: false, clientId: '', showPaused: true },
  spotify: { clientId: '' },
  network: { strict: true, blockTelemetry: true },
  theme: { accent: '#8b7bff', blur: 60 },
};

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v)
      : v;
  }
  return out;
}

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safeStorage = safeStorage;
    fs.mkdirSync(dir, { recursive: true });
    this.settingsFile = path.join(dir, 'settings.json');
    this.libraryFile = path.join(dir, 'library.json');
    this.secretsFile = path.join(dir, 'secrets.bin');
    this.settings = merge(DEFAULT_SETTINGS, readJson(this.settingsFile, {}));
    this.secrets = this.loadSecrets();
  }

  getSettings() {
    return this.settings;
  }

  updateSettings(patch) {
    this.settings = merge(this.settings, patch);
    atomicWrite(this.settingsFile, JSON.stringify(this.settings, null, 2));
    return this.settings;
  }

  getLibrary() {
    return readJson(this.libraryFile, { playlists: [] });
  }

  saveLibrary(library) {
    atomicWrite(this.libraryFile, JSON.stringify(library));
  }

  encryptionBackend() {
    if (!this.safeStorage.isEncryptionAvailable()) return 'unavailable';
    return process.platform === 'linux' ? this.safeStorage.getSelectedStorageBackend() : 'os-keychain';
  }

  loadSecrets() {
    try {
      const raw = fs.readFileSync(this.secretsFile);
      return JSON.parse(this.safeStorage.decryptString(raw));
    } catch {
      return {};
    }
  }

  getSecret(key) {
    return this.secrets[key] || null;
  }

  setSecret(key, value) {
    if (value == null) delete this.secrets[key];
    else this.secrets[key] = value;
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable, refusing to store credentials in plain text');
    }
    atomicWrite(this.secretsFile, this.safeStorage.encryptString(JSON.stringify(this.secrets)));
  }
}

module.exports = { Store, DEFAULT_SETTINGS, merge };
