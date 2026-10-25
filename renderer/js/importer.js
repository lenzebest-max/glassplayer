// Playlist parsing, cross-service matching and export. Pure functions where
// possible so they can be unit-tested without a browser.

const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// ---------------- Text parsing ----------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  title: ['track name', 'title', 'name', 'song', 'song name', 'track'],
  artist: ['artist name(s)', 'artist name', 'artist', 'artists', 'artist(s)'],
  album: ['album name', 'album', 'album title'],
  isrc: ['isrc'],
  durationMs: ['duration (ms)', 'duration_ms', 'duration ms', 'duration'],
  spotify: ['track uri', 'spotify uri', 'uri', 'spotify id', 'track id'],
  apple: ['apple music id', 'apple id'],
};

function trackFromCsv(rows) {
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  const col = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.title == null) throw new Error('CSV needs a "Track Name" or "Title" column');
  return rows.slice(1).map((r) => {
    const get = (k) => (col[k] == null ? '' : (r[col[k]] || '').trim());
    let duration = get('durationMs');
    let durationMs = duration.includes(':')
      ? duration.split(':').reduce((acc, p) => acc * 60 + Number(p), 0) * 1000
      : Number(duration) || undefined;
    if (durationMs && durationMs < 20000) durationMs *= 1000; // seconds, not ms
    let sp = get('spotify');
    if (sp && /^[A-Za-z0-9]{22}$/.test(sp)) sp = `spotify:track:${sp}`;
    const refs = {};
    if (/^spotify:track:/.test(sp)) refs.spotify = sp;
    if (get('apple')) refs.apple = get('apple');
    return makeTrack({
      title: get('title'),
      artist: get('artist').replace(/\s*;\s*/g, ', '),
      album: get('album'),
      isrc: get('isrc').toUpperCase() || undefined,
      durationMs,
      refs,
    });
  }).filter((t) => t.title);
}

function splitArtistTitle(s) {
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: s.trim() };
}

function parseM3u(text) {
  const tracks = [];
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const inf = line.match(/^#EXTINF:(-?\d+)[^,]*,(.*)$/i);
    if (inf) {
      pending = { ...splitArtistTitle(inf[2]), durationMs: Number(inf[1]) > 0 ? Number(inf[1]) * 1000 : undefined };
      continue;
    }
    if (line.startsWith('#')) continue;
    const fromFile = () => splitArtistTitle(decodeURIComponent(line.split(/[\\/]/).pop()).replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\d+[\s.-]+/, ''));
    const meta = pending || fromFile();
    const refs = {};
    const sp = line.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/) || line.match(/^spotify:track:([A-Za-z0-9]{22})$/);
    if (sp) refs.spotify = `spotify:track:${sp[1]}`;
    tracks.push(makeTrack({ ...meta, refs }));
    pending = null;
  }
  return tracks.filter((t) => t.title);
}

function parseLines(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => makeTrack(splitArtistTitle(l.replace(/^\d+[.)]\s*/, ''))));
}

function parseJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.tracks || (data.playlists && data.playlists[0] && data.playlists[0].tracks) || [];
  return {
    name: data.name,
    tracks: list.map((t) => makeTrack({
      title: t.title || t.name || t.trackName,
      artist: t.artist || t.artistName || (Array.isArray(t.artists) ? t.artists.map((a) => a.name || a).join(', ') : ''),
      album: t.album || t.albumName,
      isrc: t.isrc,
      durationMs: t.durationMs || t.duration_ms,
      refs: t.refs || {},
    })).filter((t) => t.title),
  };
}

export function parsePlaylistFile(filename, content) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const name = filename.replace(/\.[^.]+$/, '');
  if (ext === 'json') {
    const r = parseJson(content);
    return { name: r.name || name, tracks: r.tracks };
  }
  if (ext === 'm3u' || ext === 'm3u8' || content.trimStart().startsWith('#EXTM3U')) return { name, tracks: parseM3u(content) };
  if (ext === 'csv') return { name, tracks: trackFromCsv(parseCsv(content)) };
  return { name, tracks: parseLines(content) };
}

export function makeTrack(t) {
  return {
    id: t.id || `lc:${uid()}`,
    title: t.title || '',
    artist: t.artist || '',
    album: t.album || '',
    durationMs: t.durationMs || undefined,
    isrc: t.isrc || undefined,
    artwork: t.artwork || null,
    refs: { ...(t.refs || {}) },
    source: t.source || 'file',
  };
}

// ---------------- URL parsing ----------------

export function parseMusicUrl(input) {
  const s = input.trim();
  let m = s.match(/^spotify:(playlist|album):([A-Za-z0-9]{22})$/);
  if (m) return { service: 'spotify', kind: m[1], id: m[2] };
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?(playlist|album)\/([A-Za-z0-9]{22})/);
  if (m) return { service: 'spotify', kind: m[1], id: m[2] };
  m = s.match(/music\.apple\.com\/([a-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[A-Za-z0-9-]+)/);
  if (m) return { service: 'apple', kind: 'playlist', id: m[2], storefront: m[1] };
  m = s.match(/music\.apple\.com\/([a-z]{2})\/album\/(?:[^/]+\/)?(\d+)/);
  if (m) return { service: 'apple', kind: 'album', id: m[2], storefront: m[1] };
  return null;
}

// ---------------- Matching ----------------

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?(feat|ft\.|with|remaster|version|edit|mono|stereo|live|deluxe).*?[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|mono|stereo|live).*$/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

export function scoreCandidate(target, cand) {
  const title = normalize(target.title) === normalize(cand.title) ? 1 : similarity(target.title, cand.title);
  const tArtist = (target.artist || '').split(',')[0];
  const artist = target.artist ? Math.max(similarity(tArtist, cand.artist), similarity(target.artist, cand.artist)) : 0.5;
  let score = title * 0.6 + artist * 0.4;
  if (target.durationMs && cand.durationMs) {
    const diff = Math.abs(target.durationMs - cand.durationMs);
    if (diff < 3000) score += 0.1;
    else if (diff > 15000) score -= 0.2;
  }
  return score;
}

export function pickBest(target, candidates, threshold = 0.62) {
  let best = null;
  let bestScore = threshold;
  for (const c of candidates) {
    const s = scoreCandidate(target, c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}

// Finds the same recording on `provider`. ISRC first, then a fuzzy text search.
export async function resolveTrack(track, provider) {
  const key = provider.id;
  if (track.refs && track.refs[key]) return track.refs[key];
  let match = null;
  if (track.isrc) {
    const byIsrc = await provider.findByIsrc(track.isrc).catch(() => []);
    match = byIsrc.length ? (pickBest(track, byIsrc, 0.3) || byIsrc[0]) : null;
  }
  if (!match && track.title) {
    match = pickBest(track, await provider.findByText(track).catch(() => []));
  }
  if (!match) return null;
  track.refs = { ...track.refs, [key]: match.refs[key] };
  if (!track.isrc && match.isrc) track.isrc = match.isrc;
  if (!track.artwork && match.artwork) track.artwork = match.artwork;
  if (!track.durationMs && match.durationMs) track.durationMs = match.durationMs;
  if (!track.url && match.url) track.url = match.url;
  return track.refs[key];
}

// ---------------- Export ----------------

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(tracks) {
  const header = ['Track Name', 'Artist Name(s)', 'Album Name', 'ISRC', 'Duration (ms)', 'Spotify URI', 'Apple Music ID'];
  const rows = tracks.map((t) => [t.title, t.artist, t.album, t.isrc, t.durationMs, t.refs.spotify, t.refs.apple].map(csvCell).join(','));
  return [header.join(','), ...rows].join('\n') + '\n';
}

export function toM3u(tracks) {
  const lines = ['#EXTM3U'];
  for (const t of tracks) {
    lines.push(`#EXTINF:${t.durationMs ? Math.round(t.durationMs / 1000) : -1},${t.artist} - ${t.title}`);
    const sp = t.refs.spotify && t.refs.spotify.split(':').pop();
    lines.push(sp ? `https://open.spotify.com/track/${sp}` : `${t.artist} - ${t.title}`);
  }
  return lines.join('\n') + '\n';
}
