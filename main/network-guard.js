'use strict';
// Every request the app makes goes through here. In strict mode only the
// music services are reachable; everything else is blocked and logged, so
// you can see exactly where your data goes.

const ALLOWED_SUFFIXES = [
  // Spotify: API, auth, Web Playback SDK, artwork, audio CDN, DRM licences
  'spotify.com',
  'scdn.co',
  'spotifycdn.com',
  'audio-ak-spotify-com.akamaized.net',
  // Apple Music: MusicKit, API, login, artwork, audio
  'apple.com',
  'mzstatic.com',
  'cdn-apple.com',
];

// Pure analytics endpoints. Blocking them doesn't affect playback.
const TELEMETRY_HOSTS = ['xp.apple.com', 'metrics.apple.com', 'metrics.mzstatic.com'];

const matches = (host, suffix) => host === suffix || host.endsWith('.' + suffix);

function classify(url, { strict, blockTelemetry }) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { host: null, allow: true };
  }
  if (!host || host === '127.0.0.1' || host === 'localhost') return { host, allow: true, local: true };
  if (blockTelemetry && TELEMETRY_HOSTS.some((h) => matches(host, h))) return { host, allow: false, reason: 'telemetry' };
  if (strict && !ALLOWED_SUFFIXES.some((s) => matches(host, s))) return { host, allow: false, reason: 'not-allowlisted' };
  return { host, allow: true };
}

class NetworkGuard {
  constructor(getOptions) {
    this.getOptions = getOptions;
    this.log = new Map(); // host -> { host, allowed, blocked, reason, last }
  }

  attach(session) {
    session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
      const verdict = classify(details.url, this.getOptions());
      if (verdict.host && !verdict.local) this.record(verdict);
      cb(verdict.allow ? {} : { cancel: true });
    });
  }

  record({ host, allow, reason }) {
    const entry = this.log.get(host) || { host, allowed: 0, blocked: 0, reason: null, last: 0 };
    if (allow) entry.allowed++;
    else {
      entry.blocked++;
      entry.reason = reason;
    }
    entry.last = Date.now();
    this.log.set(host, entry);
  }

  entries() {
    return [...this.log.values()].sort((a, b) => b.last - a.last);
  }
}

module.exports = { NetworkGuard, classify, ALLOWED_SUFFIXES, TELEMETRY_HOSTS };
