import { Emitter, loadScript, sleep } from '../util.js';

const API = 'https://api.spotify.com/v1';
const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

function mapTrack(t) {
  if (!t || !t.id || t.type === 'episode') return null;
  const images = (t.album && t.album.images) || [];
  return {
    id: `sp:${t.id}`,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album ? t.album.name : '',
    durationMs: t.duration_ms,
    isrc: t.external_ids && t.external_ids.isrc,
    explicit: Boolean(t.explicit),
    artwork: (images[1] || images[0] || {}).url || null,
    artworkLarge: (images[0] || {}).url || null,
    url: t.external_urls && t.external_urls.spotify,
    refs: { spotify: t.uri },
    source: 'spotify',
  };
}

export class SpotifyProvider extends Emitter {
  constructor() {
    super();
    this.id = 'spotify';
    this.name = 'Spotify';
    this.connected = false;
    this.player = null;
    this.deviceId = null;
    this.playerReady = null;
    this.user = null;
    this.expected = null;
    this.volume = 0.7;
  }

  async init() {
    const status = await glass.spotify.status();
    this.clientId = status.clientId;
    this.connected = status.connected;
    if (this.connected) {
      try {
        this.user = await this.api('/me');
      } catch (err) {
        this.connected = false;
        console.warn('Spotify session expired', err);
      }
    }
    return this.connected;
  }

  async login() {
    await glass.spotify.login();
    this.connected = true;
    this.user = await this.api('/me');
    this.emit('auth');
  }

  async logout() {
    await glass.spotify.logout();
    if (this.player) this.player.disconnect();
    this.player = null;
    this.playerReady = null;
    this.connected = false;
    this.user = null;
    this.emit('auth');
  }

  async token() {
    const t = await glass.spotify.token();
    if (!t) throw new Error('Not signed in to Spotify');
    return t.accessToken;
  }

  async api(path, { method = 'GET', body, retry = 2 } = {}) {
    const url = path.startsWith('http') ? path : API + path;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && retry > 0) {
      await sleep((Number(res.headers.get('Retry-After')) || 2) * 1000);
      return this.api(path, { method, body, retry: retry - 1 });
    }
    if (res.status === 204 || res.status === 202) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((json && json.error && json.error.message) || `Spotify error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async paginate(path, pick = (j) => j) {
    const items = [];
    let next = path;
    while (next) {
      const page = pick(await this.api(next));
      items.push(...(page.items || []));
      next = page.next;
    }
    return items;
  }

  // Spotify renamed playlist "/tracks" endpoints to "/items" for newer apps; support both.
  async playlistEndpoint(id, suffix, opts) {
    try {
      return await this.api(`/playlists/${id}/items${suffix}`, opts);
    } catch (err) {
      if (err.status !== 404 && err.status !== 403 && err.status !== 410) throw err;
      return this.api(`/playlists/${id}/tracks${suffix}`, opts);
    }
  }

  async playlists() {
    const items = await this.paginate('/me/playlists?limit=50');
    const lists = items.filter(Boolean).map((p) => ({
      id: p.id,
      service: 'spotify',
      name: p.name,
      owner: p.owner && p.owner.display_name,
      artwork: (p.images && p.images[0] && p.images[0].url) || null,
      count: (p.items || p.tracks || {}).total,
    }));
    return [{ id: 'liked', service: 'spotify', name: 'Liked Songs', liked: true }, ...lists];
  }

  async playlistTracks(id) {
    if (id === 'liked') {
      const items = await this.paginate('/me/tracks?limit=50');
      return items.map((i) => mapTrack(i.track)).filter(Boolean);
    }
    const first = await this.playlistEndpoint(id, '?limit=100');
    const items = [...first.items];
    let next = first.next;
    while (next) {
      const page = await this.api(next);
      items.push(...page.items);
      next = page.next;
    }
    return items.map((i) => mapTrack(i.item || i.track)).filter(Boolean);
  }

  async playlistInfo(id) {
    const p = await this.api(`/playlists/${id}?fields=name,description,images,owner(display_name)`);
    return { name: p.name, artwork: p.images && p.images[0] && p.images[0].url };
  }

  async albumTracks(id) {
    const album = await this.api(`/albums/${id}`);
    const ids = album.tracks.items.map((t) => t.id);
    const tracks = [];
    for (let i = 0; i < ids.length; i += 20) {
      const res = await this.api(`/tracks?ids=${ids.slice(i, i + 20).join(',')}`);
      tracks.push(...res.tracks.map(mapTrack).filter(Boolean));
    }
    return { name: `${album.name} — ${album.artists.map((a) => a.name).join(', ')}`, tracks };
  }

  async search(query, limit = 20) {
    const res = await this.api(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`);
    return res.tracks.items.map(mapTrack).filter(Boolean);
  }

  async findByIsrc(isrc) {
    const res = await this.api(`/search?type=track&limit=3&q=${encodeURIComponent(`isrc:${isrc}`)}`);
    return res.tracks.items.map(mapTrack).filter(Boolean);
  }

  async findByText({ title, artist }) {
    const strict = await this.search(`track:${title} artist:${artist.split(',')[0]}`, 8).catch(() => []);
    return strict.length ? strict : this.search(`${title} ${artist}`, 8);
  }

  async createPlaylist(name, uris, description = 'Made with GlassPlayer') {
    let playlist;
    try {
      playlist = await this.api('/me/playlists', { method: 'POST', body: { name, public: false, description } });
    } catch (err) {
      if (err.status !== 404 && err.status !== 405) throw err;
      playlist = await this.api(`/users/${this.user.id}/playlists`, { method: 'POST', body: { name, public: false, description } });
    }
    for (let i = 0; i < uris.length; i += 100) {
      await this.playlistEndpoint(playlist.id, '', { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
    }
    return { id: playlist.id, url: playlist.external_urls && playlist.external_urls.spotify };
  }

  // ---------- Playback (Web Playback SDK, Premium only) ----------

  ensurePlayer() {
    if (this.playerReady) return this.playerReady;
    this.playerReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Spotify player did not start. Is Widevine available?')), 20000);
      window.onSpotifyWebPlaybackSDKReady = () => {
        const player = new window.Spotify.Player({
          name: 'GlassPlayer',
          getOAuthToken: (cb) => this.token().then(cb, () => cb('')),
          volume: this.volume,
        });
        const fail = (msg) => ({ message }) => {
          clearTimeout(timeout);
          this.playerReady = null;
          this.emit('error', new Error(`${msg}: ${message}`));
          reject(new Error(`${msg}: ${message}`));
        };
        player.addListener('initialization_error', fail('Spotify player could not initialise'));
        player.addListener('authentication_error', fail('Spotify sign-in expired'));
        player.addListener('account_error', fail('Spotify playback needs a Premium account'));
        player.addListener('playback_error', ({ message }) => this.emit('error', new Error(message)));
        player.addListener('ready', ({ device_id }) => {
          clearTimeout(timeout);
          this.deviceId = device_id;
          resolve(player);
        });
        player.addListener('not_ready', () => { this.deviceId = null; });
        player.addListener('player_state_changed', (s) => this.onSdkState(s));
        player.connect();
        this.player = player;
      };
      loadScript(SDK_URL).then(() => {
        if (window.Spotify && window.Spotify.Player && !this.player) window.onSpotifyWebPlaybackSDKReady();
      }, (err) => { clearTimeout(timeout); this.playerReady = null; reject(err); });
    });
    return this.playerReady;
  }

  async play(track) {
    const player = await this.ensurePlayer();
    if (player.activateElement) await player.activateElement();
    this.expected = track.refs.spotify;
    this.sawExpected = false;
    this.endedFired = false;
    this.lastPos = 0;
    await this.api(`/me/player/play?device_id=${this.deviceId}`, { method: 'PUT', body: { uris: [track.refs.spotify] } });
  }

  isExpected(state) {
    const cur = state.track_window && state.track_window.current_track;
    if (!cur) return false;
    return cur.uri === this.expected || (cur.linked_from && cur.linked_from.uri === this.expected);
  }

  onSdkState(state) {
    if (!state || !this.expected) return;
    const ours = this.isExpected(state);
    if (ours) this.sawExpected = true;
    // Spotify either stops at 0 or autoplays something else when a track ends.
    const finished = (this.sawExpected && !ours)
      || (ours && state.paused && state.position === 0 && this.lastPos > 0 && this.lastDur - this.lastPos < 3000);
    if (finished && !this.endedFired) {
      this.endedFired = true;
      if (!ours) this.player.pause();
      this.emit('ended');
      return;
    }
    this.lastPos = state.position;
    this.lastDur = state.duration;
    this.emit('state', { playing: !state.paused, positionMs: state.position, durationMs: state.duration });
  }

  async position() {
    if (!this.player) return null;
    const s = await this.player.getCurrentState();
    if (!s) return null;
    this.onSdkState(s);
    return { playing: !s.paused, positionMs: s.position, durationMs: s.duration };
  }

  pause() { return this.player && this.player.pause(); }
  resume() { return this.player && this.player.resume(); }
  seek(ms) { return this.player && this.player.seek(Math.round(ms)); }
  stop() {
    this.expected = null;
    return this.player && this.player.pause();
  }
  setVolume(v) {
    this.volume = v;
    return this.player && this.player.setVolume(v);
  }
}
