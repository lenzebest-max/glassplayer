import { Emitter } from './util.js';
import { resolveTrack } from './importer.js';

// One queue, two engines. Each track is played on whichever service has it,
// preferring the one picked in Settings, and matched on the fly when needed.
export class Player extends Emitter {
  constructor(providers, getSettings) {
    super();
    this.providers = providers; // { spotify, apple }
    this.getSettings = getSettings;
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.current = null;
    this.engine = null;
    this.playing = false;
    this.positionMs = 0;
    this.durationMs = 0;
    this.volume = getSettings().volume ?? 0.7;
    this.loading = false;
    this.playToken = 0;

    for (const p of Object.values(providers)) {
      p.on('ended', () => p === this.engine && this.onEnded());
      p.on('state', (s) => p === this.engine && this.applyState(s));
      p.on('error', (err) => this.emit('error', err));
    }
    this.poll = setInterval(() => this.tick(), 500);
    this.setupMediaSession();
  }

  get track() {
    return this.current;
  }

  destroy() {
    clearInterval(this.poll);
  }

  setQueue(tracks, startIndex = 0, { shuffle } = {}) {
    this.queue = tracks.slice();
    if (shuffle !== undefined) this.shuffle = shuffle;
    this.order = this.buildOrder(this.shuffle ? startIndex : null);
    return this.playAt(this.shuffle ? 0 : startIndex);
  }

  // Identity order, or a shuffle that starts with `first` when given.
  buildOrder(first) {
    const idx = this.queue.map((_, i) => i);
    if (!this.shuffle) return idx;
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (first != null && first >= 0) {
      idx.splice(idx.indexOf(first), 1);
      idx.unshift(first);
    }
    return idx;
  }

  addToQueue(tracks, next = false) {
    const start = this.queue.length;
    this.queue.push(...tracks);
    const added = tracks.map((_, i) => start + i);
    if (next && this.pos >= 0) this.order.splice(this.pos + 1, 0, ...added);
    else this.order.push(...added);
    this.emit('queue');
  }

  upcoming() {
    return this.order.slice(this.pos + 1).map((i) => this.queue[i]);
  }

  toggleShuffle() {
    const currentIdx = this.pos >= 0 ? this.order[this.pos] : null;
    this.shuffle = !this.shuffle;
    this.order = this.buildOrder(currentIdx);
    this.pos = currentIdx == null ? -1 : this.shuffle ? 0 : currentIdx;
    this.emit('change');
    this.emit('queue');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.emit('change');
  }

  // "auto" plays a track on the service it came from; otherwise the chosen
  // service goes first and the other is the fallback.
  enginesFor(track) {
    const pref = this.getSettings().preferredService;
    const appleFirst = pref === 'apple' || (pref === 'auto' && !track.refs.spotify && track.refs.apple);
    const ids = appleFirst ? ['apple', 'spotify'] : ['spotify', 'apple'];
    return ids.map((id) => this.providers[id]).filter((p) => p.connected);
  }

  async playAt(orderPos) {
    if (orderPos < 0 || orderPos >= this.order.length) return this.stop();
    const token = ++this.playToken;
    this.pos = orderPos;
    const track = this.queue[this.order[orderPos]];
    this.current = track;
    this.positionMs = 0;
    this.durationMs = track.durationMs || 0;
    this.loading = true;
    this.emit('change');

    const engines = this.enginesFor(track);
    if (!engines.length) {
      this.loading = false;
      this.emit('error', new Error('Connect Spotify or Apple Music to play music'));
      return this.emit('change');
    }
    for (const engine of engines) {
      try {
        const ref = await resolveTrack(track, engine);
        if (token !== this.playToken) return;
        if (!ref) continue;
        if (this.engine && this.engine !== engine) await this.engine.stop();
        this.engine = engine;
        engine.setVolume(this.volume);
        await engine.play(track);
        if (token !== this.playToken) return;
        this.playing = true;
        this.loading = false;
        this.emit('change');
        this.emit('track', track);
        this.pushPresence();
        return;
      } catch (err) {
        if (token !== this.playToken) return;
        this.emit('error', err);
      }
    }
    this.loading = false;
    this.emit('error', new Error(`Couldn't find “${track.title}” on any connected service`));
    // Skip unplayable tracks so a playlist keeps going.
    if (orderPos + 1 < this.order.length) setTimeout(() => token === this.playToken && this.playAt(orderPos + 1), 800);
    else this.emit('change');
  }

  async stop() {
    this.playToken++;
    if (this.engine) await this.engine.stop();
    this.playing = false;
    this.loading = false;
    this.emit('change');
    this.pushPresence();
  }

  onEnded() {
    if (this.repeat === 'one') return this.playAt(this.pos);
    this.next(true);
  }

  next(auto = false) {
    if (this.pos + 1 < this.order.length) return this.playAt(this.pos + 1);
    if (this.repeat === 'all' && this.order.length) {
      if (this.shuffle) this.order = this.buildOrder(null);
      return this.playAt(0);
    }
    if (auto) {
      this.playing = false;
      this.emit('change');
      this.pushPresence();
    }
  }

  prev() {
    if (this.positionMs > 3000 || this.pos <= 0) return this.seek(0);
    return this.playAt(this.pos - 1);
  }

  async toggle() {
    if (!this.current) return;
    if (!this.engine) return this.playAt(this.pos);
    if (this.playing) await this.engine.pause();
    else await this.engine.resume();
    this.playing = !this.playing;
    this.emit('change');
    this.pushPresence();
  }

  async seek(ms) {
    if (!this.engine) return;
    this.positionMs = ms;
    await this.engine.seek(ms);
    this.emit('progress');
    this.pushPresence();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.engine) this.engine.setVolume(this.volume);
    this.emit('volume');
  }

  applyState(s) {
    if (!s) return;
    const wasPlaying = this.playing;
    this.playing = s.playing;
    if (Number.isFinite(s.positionMs)) this.positionMs = s.positionMs;
    if (s.durationMs > 0) this.durationMs = s.durationMs;
    if (wasPlaying !== this.playing && !this.loading) {
      this.emit('change');
      this.pushPresence();
    }
  }

  async tick() {
    if (!this.engine || !this.current || this.loading) return;
    try {
      const s = await this.engine.position();
      if (s) {
        this.applyState(s);
        this.emit('progress');
        this.updatePositionState();
      }
    } catch { /* engine not ready */ }
  }

  pushPresence() {
    const t = this.current;
    const service = this.engine && this.engine.id;
    const spotifyUrl = t && t.refs.spotify && `https://open.spotify.com/track/${t.refs.spotify.split(':').pop()}`;
    glass.discord.nowPlaying(t ? {
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: t.artworkLarge || t.artwork,
      durationMs: this.durationMs,
      positionMs: this.positionMs,
      playing: this.playing,
      service,
      url: service === 'spotify' ? spotifyUrl : t.url && t.url.includes('music.apple.com') ? t.url : spotifyUrl,
    } : null).catch(() => {});
    this.updateMediaSession();
  }

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', () => !this.playing && this.toggle());
    set('pause', () => this.playing && this.toggle());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.prev());
    set('seekto', (d) => this.seek(d.seekTime * 1000));
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const t = this.current;
    const src = t.artworkLarge || t.artwork;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: src ? [{ src, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
  }

  updatePositionState() {
    if (!('mediaSession' in navigator) || !this.durationMs) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.durationMs / 1000,
        position: Math.min(this.positionMs, this.durationMs) / 1000,
        playbackRate: 1,
      });
    } catch { /* ignore */ }
  }
}
