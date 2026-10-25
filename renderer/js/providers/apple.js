import { Emitter, loadScript } from '../util.js';

const MUSICKIT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';

const art = (artwork, size) => (artwork && artwork.url ? artwork.url.replace('{w}', size).replace('{h}', size) : null);

function mapSong(s) {
  if (!s || !s.attributes) return null;
  const a = s.attributes;
  const catalog = s.relationships && s.relationships.catalog && s.relationships.catalog.data && s.relationships.catalog.data[0];
  const playId = (a.playParams && (a.playParams.catalogId || a.playParams.id)) || s.id;
  return {
    id: `am:${playId}`,
    title: a.name,
    artist: a.artistName,
    album: a.albumName || '',
    durationMs: a.durationInMillis,
    isrc: a.isrc || (catalog && catalog.attributes && catalog.attributes.isrc) || undefined,
    explicit: a.contentRating === 'explicit',
    artwork: art(a.artwork, 300),
    artworkLarge: art(a.artwork, 1000),
    url: a.url || (catalog && catalog.attributes && catalog.attributes.url) || undefined,
    refs: { apple: playId },
    source: 'apple',
  };
}

function splitPath(next) {
  const u = new URL(next, 'https://api.music.apple.com');
  return [u.pathname, Object.fromEntries(u.searchParams)];
}

export class AppleProvider extends Emitter {
  constructor() {
    super();
    this.id = 'apple';
    this.name = 'Apple Music';
    this.music = null;
    this.connected = false;
    this.volume = 0.7;
  }

  get storefront() {
    return (this.music && (this.music.storefrontId || this.music.storefrontCountryCode)) || 'us';
  }

  async init() {
    const status = await glass.apple.status();
    this.configured = status.configured;
    if (!status.configured) return false;
    try {
      await this.ensure();
      this.connected = this.music.isAuthorized;
    } catch (err) {
      console.warn('MusicKit failed to start', err);
    }
    return this.connected;
  }

  async ensure() {
    if (this.music) return this.music;
    const developerToken = await glass.apple.developerToken();
    if (!developerToken) throw new Error('Add your Apple developer key in Settings first');
    await loadScript(MUSICKIT_URL);
    if (!window.MusicKit) await new Promise((r) => document.addEventListener('musickitloaded', r, { once: true }));
    this.music = await window.MusicKit.configure({
      developerToken,
      app: { name: 'GlassPlayer', build: '0.1.0' },
    });
    const S = window.MusicKit.PlaybackStates;
    this.music.addEventListener('playbackStateDidChange', ({ state }) => {
      if ((state === S.ended || state === S.completed) && this.active && !this.endedFired) {
        this.endedFired = true;
        this.emit('ended');
      } else {
        this.emit('state', this.snapshot());
      }
    });
    this.music.addEventListener('mediaPlaybackError', (e) => this.emit('error', new Error((e && e.message) || 'Apple Music playback error')));
    this.music.addEventListener('authorizationStatusDidChange', () => {
      this.connected = this.music.isAuthorized;
      this.emit('auth');
    });
    return this.music;
  }

  async login() {
    await this.ensure();
    await this.music.authorize();
    this.connected = this.music.isAuthorized;
    this.emit('auth');
  }

  async logout() {
    if (this.music) await this.music.unauthorize();
    this.connected = false;
    this.emit('auth');
  }

  async api(path, params = {}, fetchOptions) {
    await this.ensure();
    const res = await this.music.api.music(path, params, fetchOptions ? { fetchOptions } : undefined);
    return res.data;
  }

  async paginate(path, params) {
    const out = [];
    let page = await this.api(path, params);
    out.push(...(page.data || []));
    while (page.next) {
      const [p, q] = splitPath(page.next);
      page = await this.api(p, { ...params, ...q });
      out.push(...(page.data || []));
    }
    return out;
  }

  async playlists() {
    const items = await this.paginate('/v1/me/library/playlists', { limit: 100 });
    return items.map((p) => ({
      id: p.id,
      service: 'apple',
      name: p.attributes.name,
      artwork: art(p.attributes.artwork, 300),
    }));
  }

  async playlistTracks(id) {
    const isCatalog = id.startsWith('pl.');
    const path = isCatalog
      ? `/v1/catalog/${this.storefront}/playlists/${id}/tracks`
      : `/v1/me/library/playlists/${id}/tracks`;
    const items = await this.paginate(path, isCatalog ? { limit: 100 } : { limit: 100, include: 'catalog' });
    return items.filter((s) => s.type && s.type.includes('songs')).map(mapSong).filter(Boolean);
  }

  async playlistInfo(id) {
    const res = await this.api(`/v1/catalog/${this.storefront}/playlists/${id}`);
    const p = res.data[0];
    return { name: p.attributes.name, artwork: art(p.attributes.artwork, 300) };
  }

  async albumTracks(id) {
    const res = await this.api(`/v1/catalog/${this.storefront}/albums/${id}`, { include: 'tracks' });
    const album = res.data[0];
    const tracks = album.relationships.tracks.data.map(mapSong).filter(Boolean);
    return { name: `${album.attributes.name} — ${album.attributes.artistName}`, tracks };
  }

  async search(query, limit = 20) {
    const res = await this.api(`/v1/catalog/${this.storefront}/search`, { term: query, types: 'songs', limit: Math.min(limit, 25) });
    return ((res.results && res.results.songs && res.results.songs.data) || []).map(mapSong).filter(Boolean);
  }

  async findByIsrc(isrc) {
    const res = await this.api(`/v1/catalog/${this.storefront}/songs`, { 'filter[isrc]': isrc });
    return (res.data || []).map(mapSong).filter(Boolean);
  }

  findByText({ title, artist }) {
    return this.search(`${title} ${artist.split(',')[0]}`, 10);
  }

  async createPlaylist(name, ids, description = 'Made with GlassPlayer') {
    const post = (path, body) => this.api(path, {}, { method: 'POST', body: JSON.stringify(body) });
    const toData = (list) => list.map((id) => ({ id, type: 'songs' }));
    const res = await post('/v1/me/library/playlists', {
      attributes: { name, description },
      relationships: { tracks: { data: toData(ids.slice(0, 100)) } },
    });
    const playlist = res.data[0];
    for (let i = 100; i < ids.length; i += 100) {
      await post(`/v1/me/library/playlists/${playlist.id}/tracks`, { data: toData(ids.slice(i, i + 100)) });
    }
    return { id: playlist.id };
  }

  // ---------- Playback ----------

  async play(track) {
    await this.ensure();
    if (!this.music.isAuthorized) await this.login();
    this.active = true;
    this.endedFired = false;
    await this.music.setQueue({ song: track.refs.apple, startPlaying: false });
    this.music.volume = this.volume;
    await this.music.play();
  }

  snapshot() {
    const m = this.music;
    if (!m) return null;
    return {
      playing: m.isPlaying,
      positionMs: (m.currentPlaybackTime || 0) * 1000,
      durationMs: (m.currentPlaybackDuration || 0) * 1000,
    };
  }

  async position() {
    return this.snapshot();
  }

  pause() { return this.music && this.music.pause(); }
  resume() { return this.music && this.music.play(); }
  seek(ms) { return this.music && this.music.seekToTime(ms / 1000); }
  stop() {
    this.active = false;
    return this.music && this.music.stop();
  }
  setVolume(v) {
    this.volume = v;
    if (this.music) this.music.volume = v;
  }
}
