import { h, formatTime, formatTotal, uid } from './util.js';
import { icon } from './icons.js';
import { toast, toastError, menu, confirmDialog, promptDialog, setRange, modalOpen, closeMenu } from './ui.js';
import { SpotifyProvider } from './providers/spotify.js';
import { AppleProvider } from './providers/apple.js';
import { Player } from './player.js';
import { toCsv, toM3u } from './importer.js';
import { openSettings, openImport, runTransfer } from './dialogs.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  library: { playlists: [] },
  remote: { spotify: null, apple: null }, // playlist lists
  cache: new Map(), // "service:id" -> tracks
  view: { type: 'home' },
  discord: { enabled: false, connected: false },
  playingContext: null,
};

const providers = { spotify: new SpotifyProvider(), apple: new AppleProvider() };
let player;
let dragTracks = null;

// ---------------- Persistence ----------------

let saveTimer;
function saveLibrary() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => glass.library.save(state.library).catch(toastError), 400);
}

async function updateSettings(patch) {
  state.settings = await glass.settings.set(patch);
  applyTheme();
  return state.settings;
}

function applyTheme() {
  const { accent, blur } = state.settings.theme;
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--blur', `${blur}px`);
  if (!player || !player.track) setGlow(accent);
}

function setGlow(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  document.documentElement.style.setProperty('--glow', `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`);
}

// Tint the whole UI from the current cover art.
function glowFromArtwork(url) {
  if (!url) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max ? (max - min) / max : 0;
        const score = sat * 0.7 + (max / 255) * 0.3 - (max < 40 ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = [r, g, b]; }
      }
      if (best) document.documentElement.style.setProperty('--glow', best.join(', '));
    } catch { /* CORS-tainted canvas: keep the current glow */ }
  };
  img.src = url;
}

// ---------------- Helpers ----------------

const localById = (id) => state.library.playlists.find((p) => p.id === id);
const cloneTrack = (t) => ({ ...t, refs: { ...t.refs } });
const totalMs = (tracks) => tracks.reduce((a, t) => a + (t.durationMs || 0), 0);

function serviceUrl(t) {
  if (t.refs.spotify) return `https://open.spotify.com/track/${t.refs.spotify.split(':').pop()}`;
  if (t.url) return t.url;
  return null;
}

function coverEl(item, tracks = []) {
  if (item.artwork) return h('div.cover', { style: { backgroundImage: `url("${item.artwork}")` } });
  const arts = [...new Set(tracks.map((t) => t.artwork).filter(Boolean))].slice(0, 4);
  if (arts.length === 4) return h('div.cover.mosaic', arts.map((a) => h('div', { style: { backgroundImage: `url("${a}")` } })));
  if (arts.length) return h('div.cover', { style: { backgroundImage: `url("${arts[0]}")` } });
  if (item.liked) return h('div.cover', { style: { background: 'linear-gradient(135deg,#5b3cff,#9fd3ff)' }, html: icon('heart', 72) });
  return h('div.cover', h('span.initial', (item.name || '?').trim().charAt(0).toUpperCase()));
}

function thumbEl(item) {
  if (item.liked) return h('span.thumb', { style: { background: 'linear-gradient(135deg,#5b3cff,#9fd3ff)', color: '#fff' }, html: icon('heart', 15) });
  const art = item.artwork || (item.tracks || []).map((t) => t.artwork).find(Boolean);
  return art ? h('span.thumb', { style: { backgroundImage: `url("${art}")` } }) : h('span.thumb', { html: icon('music', 15) });
}

// ---------------- Sidebar ----------------

function renderSidebar() {
  const sb = $('sidebar');
  const v = state.view;
  const navBtn = (label, ic, view, active) => h(`button.nav-item${active ? '.active' : ''}`, { onclick: () => go(view) },
    h('span', { html: icon(ic, 18), style: { display: 'flex' } }), h('span.label', label));

  const localItems = state.library.playlists.map((p) => {
    const btn = h(`button.nav-item${v.type === 'local' && v.id === p.id ? '.active' : ''}`, {
      onclick: () => go({ type: 'local', id: p.id }),
      oncontextmenu: (e) => { e.preventDefault(); localPlaylistMenu(p, e.clientX, e.clientY); },
      ondragover: (e) => { if (dragTracks) { e.preventDefault(); btn.classList.add('dragover'); } },
      ondragleave: () => btn.classList.remove('dragover'),
      ondrop: (e) => {
        e.preventDefault();
        btn.classList.remove('dragover');
        if (dragTracks) addToLocal(p, dragTracks);
      },
    }, thumbEl(p), h('span.label', p.name), h('span.count', p.tracks.length));
    return btn;
  });

  const remoteSection = (service, title, color) => {
    const prov = providers[service];
    const lists = state.remote[service];
    let content;
    if (!prov.connected) {
      content = h('div.side-empty', 'Not connected. ', h('button', { onclick: () => connect(service) }, 'Connect'));
    } else if (!lists) {
      content = h('div.side-empty', 'Loading playlists…');
    } else if (!lists.length) {
      content = h('div.side-empty', 'No playlists yet.');
    } else {
      content = lists.map((p) => h(`button.nav-item${v.type === 'remote' && v.service === service && v.id === p.id ? '.active' : ''}`, {
        onclick: () => go({ type: 'remote', service, id: p.id }),
      }, thumbEl(p), h('span.label', p.name)));
    }
    return h('div.side-section',
      h('div.side-head', h('span.dot', { style: { background: color } }), title, h('span.grow'),
        prov.connected ? h('button', { title: 'Refresh', html: icon('repeat', 14), onclick: () => loadRemote(service, true) }) : null),
      content);
  };

  const blocked = state.blockedCount || 0;
  sb.replaceChildren(
    h('div.side-scroll',
      navBtn('Home', 'home', { type: 'home' }, v.type === 'home'),
      navBtn('Search', 'search', { type: 'search', q: v.q || '' }, v.type === 'search'),
      h('div.side-section',
        h('div.side-head', 'Library', h('span.grow'),
          h('button', { title: 'New playlist', html: icon('plus', 15), onclick: newPlaylist }),
          h('button', { title: 'Import', html: icon('import', 15), onclick: () => openImport(ctx) })),
        localItems.length ? localItems : h('div.side-empty', 'Import playlists from Spotify, Apple Music, links or files. ', h('button', { onclick: () => openImport(ctx) }, 'Import'))),
      remoteSection('spotify', 'Spotify', 'var(--spotify)'),
      remoteSection('apple', 'Apple Music', 'var(--apple)'),
    ),
    h('div.side-footer', h('span', { html: icon('shield', 15), style: { display: 'flex' } }),
      h('button', { onclick: () => openSettings(ctx, 'privacy') }, blocked ? `${blocked} request${blocked === 1 ? '' : 's'} blocked · no tracking` : 'No ads · no tracking')),
  );
}

// ---------------- Views ----------------

function go(view) {
  state.view = view;
  closeMenu();
  renderSidebar();
  renderView();
}

function renderView() {
  const v = state.view;
  $('view').scrollTop = 0;
  if (v.type === 'local') return renderLocal(v.id);
  if (v.type === 'remote') return renderRemote(v.service, v.id);
  if (v.type === 'search') return renderSearch(v.q);
  return renderHome();
}

function connectionCard(service) {
  const p = providers[service];
  const meta = {
    spotify: { name: 'Spotify', ic: 'spotify', c: 'rgba(30,215,96,.55)', icc: 'var(--spotify)', desc: 'Stream with Premium, import playlists and Liked Songs.' },
    apple: { name: 'Apple Music', ic: 'apple', c: 'rgba(250,45,72,.55)', icc: '#ff6b80', desc: 'Stream your library and the Apple Music catalog.' },
  }[service];
  const who = service === 'spotify' && p.user ? `Signed in as ${p.user.display_name || p.user.id}` : p.connected ? 'Connected' : 'Not connected';
  return h('div.card', { style: { '--c': meta.c, '--ic': meta.icc } },
    h('div.card-top', h('span.ic', { html: icon(meta.ic, 18) }), meta.name),
    h(`span.status${p.connected ? '.on' : ''}`, who),
    h('p', meta.desc),
    p.connected
      ? h('button.pill.sm', {
        onclick: () => {
          const first = (state.remote[service] || [])[0];
          if (first) go({ type: 'remote', service, id: first.id });
          else toast('Playlists are still loading…');
        },
      }, 'Browse playlists')
      : h(`button.pill.sm.${service}`, { onclick: () => connect(service) }, 'Connect'));
}

function renderHome() {
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Late night listening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const d = state.discord;
  const discordCard = h('div.card', { style: { '--c': 'rgba(88,101,242,.6)', '--ic': '#8b95ff' } },
    h('div.card-top', h('span.ic', { html: icon('discord', 18) }), 'Discord'),
    h(`span.status${d.connected ? '.on' : d.enabled ? '.warn' : ''}`, d.connected ? `Showing on ${d.user || 'your profile'}` : d.enabled ? 'Waiting for Discord…' : 'Off'),
    h('p', 'Show what you’re listening to, with cover art and a live progress bar.'),
    h('button.pill.sm.discord', { onclick: () => openSettings(ctx, 'discord') }, d.enabled ? 'Presence settings' : 'Set up presence'));
  const privacyCard = h('div.card', { style: { '--c': 'rgba(110,231,168,.45)', '--ic': '#6ee7a8' } },
    h('div.card-top', h('span.ic', { html: icon('shield', 18) }), 'Private by design'),
    h('span.status.on', state.settings.network.strict ? 'Strict network mode' : 'Standard mode'),
    h('p', 'No ads, analytics or accounts of ours. The app can only talk to Spotify and Apple, and you can watch every request.'),
    h('button.pill.sm', { onclick: () => openSettings(ctx, 'privacy') }, 'See network log'));

  const tiles = state.library.playlists.map((p) => h('button.tile', { onclick: () => go({ type: 'local', id: p.id }) },
    coverEl(p, p.tracks),
    h('div.name', p.name),
    h('div.meta', `${p.tracks.length} tracks`),
    h('span.play-fab.tile-play', { html: icon('play', 20), onclick: (e) => { e.stopPropagation(); playList(p.tracks, 0, `local:${p.id}`); } })));

  $('view').replaceChildren(h('div.view-pad',
    h('div.greeting', h('h1', greet), h('p', 'Spotify and Apple Music in one place.')),
    h('div.cards', connectionCard('spotify'), connectionCard('apple'), discordCard, privacyCard),
    h('div.section-title', h('h2', 'Your library'), h('button.pill.sm', { onclick: () => openImport(ctx), html: `${icon('import', 15)} Import playlist` })),
    tiles.length
      ? h('div.grid', tiles)
      : h('div.empty-state', h('div.big', { html: icon('list', 34) }), h('h3', 'No playlists yet'),
        h('p', 'Bring playlists over from Spotify or Apple Music, paste a link, or drop in a CSV / M3U export. Your library works with both services.'),
        h('div.row', h('button.pill.primary', { onclick: () => openImport(ctx) }, 'Import a playlist'), h('button.pill', { onclick: newPlaylist }, 'New empty playlist'))),
  ));
}

function heroEl({ eyebrow, title, sub, cover, editable, onRename }) {
  const h1 = h('h1', title);
  if (editable) {
    h1.title = 'Click to rename';
    h1.onclick = () => {
      h1.contentEditable = 'true';
      h1.focus();
      document.getSelection().selectAllChildren(h1);
    };
    h1.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); h1.blur(); } if (e.key === 'Escape') { h1.textContent = title; h1.blur(); } };
    h1.onblur = () => {
      h1.contentEditable = 'false';
      const name = h1.textContent.trim();
      if (name && name !== title) onRename(name);
      else h1.textContent = title;
    };
  }
  return h('div.hero', cover, h('div.hero-meta', h('div.eyebrow', eyebrow), h1, h('div.sub', sub)));
}

function playFab(tracks, contextKey) {
  const isCtx = state.playingContext === contextKey && player.track;
  const btn = h('button.play-fab', {
    title: 'Play',
    html: icon(isCtx && player.playing ? 'pause' : 'play', 22),
    onclick: () => (isCtx ? player.toggle() : playList(tracks, 0, contextKey)),
  });
  btn.dataset.context = contextKey;
  return btn;
}

function renderLocal(id) {
  const p = localById(id);
  if (!p) return go({ type: 'home' });
  const key = `local:${p.id}`;
  const matchedSp = p.tracks.filter((t) => t.refs.spotify).length;
  const matchedAm = p.tracks.filter((t) => t.refs.apple).length;
  const sub = [`${p.tracks.length} tracks`, formatTotal(totalMs(p.tracks)),
    p.tracks.length ? `${matchedSp} on Spotify · ${matchedAm} on Apple Music` : null].filter(Boolean).join(' · ');
  $('view').replaceChildren(
    heroEl({ eyebrow: [h('span', { html: icon('list', 14), style: { display: 'flex' } }), 'Library playlist'], title: p.name, sub, cover: coverEl(p, p.tracks), editable: true, onRename: (name) => { p.name = name; saveLibrary(); renderSidebar(); } }),
    h('div.actions',
      playFab(p.tracks, key),
      h('button.icon-btn', { title: 'Shuffle play', html: icon('shuffle'), onclick: () => playList(p.tracks, Math.floor(Math.random() * p.tracks.length), key, true) }),
      h('span.spacer'),
      h('button.pill.sm', { onclick: () => runTransfer(ctx, p, 'spotify'), disabled: !providers.spotify.connected, html: `${icon('spotify', 15)} Copy to Spotify` }),
      h('button.pill.sm', { onclick: () => runTransfer(ctx, p, 'apple'), disabled: !providers.apple.connected, html: `${icon('apple', 15)} Copy to Apple Music` }),
      h('button.icon-btn', { title: 'More', html: icon('more'), onclick: (e) => localPlaylistMenu(p, e.clientX, e.clientY) })),
    p.tracks.length
      ? trackList(p.tracks, { contextKey: key, local: p })
      : h('div.empty-state', h('div.big', { html: icon('music', 30) }), h('h3', 'This playlist is empty'), h('p', 'Search for songs and use “Add to playlist”, or drag tracks onto it in the sidebar.')),
  );
}

async function renderRemote(service, id) {
  const prov = providers[service];
  const list = (state.remote[service] || []).find((p) => p.id === id);
  if (!list) {
    if (!prov.connected) return go({ type: 'home' });
    $('view').replaceChildren(h('div.view-pad', h('div.skeleton'), h('div.skeleton'), h('div.skeleton')));
    return;
  }
  const key = `${service}:${id}`;
  const svcName = prov.name;
  const draw = (tracks) => {
    if (state.view.type !== 'remote' || state.view.id !== id) return;
    const sub = tracks ? [list.owner, `${tracks.length} tracks`, formatTotal(totalMs(tracks))].filter(Boolean).join(' · ') : 'Loading…';
    const other = service === 'spotify' ? 'apple' : 'spotify';
    $('view').replaceChildren(
      heroEl({ eyebrow: [h('span', { html: icon(service, 14), style: { display: 'flex' } }), `${svcName} playlist`], title: list.name, sub, cover: coverEl(list, tracks || []) }),
      h('div.actions',
        tracks ? playFab(tracks, key) : null,
        tracks ? h('button.icon-btn', { title: 'Shuffle play', html: icon('shuffle'), onclick: () => playList(tracks, Math.floor(Math.random() * tracks.length), key, true) }) : null,
        h('span.spacer'),
        tracks ? h('button.pill.sm', { onclick: () => saveRemoteToLibrary(list, tracks), html: `${icon('import', 15)} Save to Library` }) : null,
        tracks ? h('button.pill.sm', {
          disabled: !providers[other].connected,
          onclick: () => runTransfer(ctx, { name: list.name, tracks }, other),
          html: `${icon(other, 15)} Copy to ${providers[other].name}`,
        }) : null,
        h('button.icon-btn', { title: 'Reload', html: icon('repeat'), onclick: () => { state.cache.delete(key); renderRemote(service, id); } })),
      tracks ? trackList(tracks, { contextKey: key }) : h('div.tracks', h('div.skeleton'), h('div.skeleton'), h('div.skeleton'), h('div.skeleton')),
    );
  };
  if (state.cache.has(key)) return draw(state.cache.get(key));
  draw(null);
  try {
    const tracks = await prov.playlistTracks(id);
    state.cache.set(key, tracks);
    draw(tracks);
  } catch (err) {
    toastError(err);
  }
}

let searchTimer;
let searchSeq = 0;
function renderSearch(q = '') {
  const input = $('search');
  if (input.value !== q) input.value = q;
  const connected = Object.values(providers).filter((p) => p.connected);
  if (!q.trim()) {
    $('view').replaceChildren(h('div.empty-state', h('div.big', { html: icon('search', 30) }), h('h3', 'Search everything'),
      h('p', connected.length ? `Results from ${connected.map((p) => p.name).join(' and ')} side by side.` : 'Connect Spotify or Apple Music first.')));
    return;
  }
  if (!connected.length) {
    $('view').replaceChildren(h('div.empty-state', h('h3', 'Nothing to search yet'), h('p', 'Connect a service from Settings.'), h('button.pill.primary', { onclick: () => openSettings(ctx, 'spotify') }, 'Open Settings')));
    return;
  }
  const seq = ++searchSeq;
  const cols = connected.map((p) => {
    const body = h('div', h('div.skeleton'), h('div.skeleton'), h('div.skeleton'));
    p.search(q, 20).then((tracks) => {
      if (seq !== searchSeq) return;
      body.replaceChildren(tracks.length ? trackList(tracks, { contextKey: `search:${p.id}:${q}`, compact: true }) : h('p.hint', { style: { padding: '0 12px' } }, 'No results'));
    }, (err) => { if (seq === searchSeq) body.replaceChildren(h('p.hint', { style: { padding: '0 12px' } }, err.message)); });
    return h('div.search-col', h('h3', h('span', { html: icon(p.id, 16), style: { display: 'flex', color: p.id === 'spotify' ? 'var(--spotify)' : 'var(--apple)' } }), p.name), body);
  });
  $('view').replaceChildren(
    h('div.hero', { style: { paddingBottom: '12px' } }, h('div.hero-meta', h('div.eyebrow', 'Search'), h('h1', { style: { fontSize: '34px' } }, `“${q}”`))),
    h(`div.search-cols${cols.length === 1 ? '.single' : ''}`, cols));
}

// ---------------- Track list ----------------

function trackList(tracks, { contextKey, local, compact }) {
  const rows = tracks.map((t, i) => trackRow(t, i, tracks, { contextKey, local, compact }));
  const wrap = compact ? h('div', rows) : h('div.tracks',
    h('div.track-head', h('span', { style: { textAlign: 'center' } }, '#'), h('span', 'Title'), h('span.album', 'Album'), h('span', { title: 'Available on' }, ''), h('span', { style: { textAlign: 'right' } }, 'Time'), h('span')),
    rows);
  markPlaying(wrap);
  return wrap;
}

function trackRow(t, i, tracks, { contextKey, local, compact }) {
  const art = h('span.art', { style: t.artwork ? { backgroundImage: `url("${t.artwork}")` } : {} });
  const title = h('div.t-title', t.explicit ? h('span.t-explicit', 'E') : null, t.title);
  const main = h('div.main', art, h('div.txt', title, h('div.t-artist', t.artist)));
  const dots = h('span.svc-dots', { title: [t.refs.spotify && 'Spotify', t.refs.apple && 'Apple Music'].filter(Boolean).join(' · ') || 'Not matched yet' },
    h(`i${t.refs.spotify ? '.sp' : ''}`), h(`i${t.refs.apple ? '.am' : ''}`));
  const more = h('button.icon-btn.sm.more', { title: 'More', html: icon('more', 16), onclick: (e) => { e.stopPropagation(); trackMenu(t, i, tracks, local, e.clientX, e.clientY); } });
  const play = () => playList(tracks, i, contextKey);
  const cells = compact
    ? [main, h('span.dur', formatTime(t.durationMs)), more]
    : [h('span.num', h('span.n', i + 1), h('span.play-ic', { html: icon('play', 14) })), main, h('span.album', t.album), dots, h('span.dur', formatTime(t.durationMs)), more];
  const row = h('div.track', {
    draggable: 'true',
    ondblclick: play,
    oncontextmenu: (e) => { e.preventDefault(); trackMenu(t, i, tracks, local, e.clientX, e.clientY); },
    ondragstart: (e) => {
      dragTracks = [t];
      e.dataTransfer.effectAllowed = local ? 'copyMove' : 'copy';
      e.dataTransfer.setData('text/plain', `${t.artist} - ${t.title}`);
      row.classList.add('dragging');
    },
    ondragend: () => { dragTracks = null; row.classList.remove('dragging'); },
  }, cells);
  if (!compact) row.querySelector('.num').onclick = play;
  else row.onclick = (e) => { if (e.detail === 1 && e.target.closest('.art')) play(); };
  if (local) {
    row.ondragover = (e) => { if (dragTracks && dragTracks[0] !== t) { e.preventDefault(); row.classList.add('drop-above'); } };
    row.ondragleave = () => row.classList.remove('drop-above');
    row.ondrop = (e) => {
      e.preventDefault();
      row.classList.remove('drop-above');
      if (!dragTracks) return;
      const from = local.tracks.indexOf(dragTracks[0]);
      if (from >= 0) {
        local.tracks.splice(from, 1);
        local.tracks.splice(local.tracks.indexOf(t), 0, dragTracks[0]);
      } else {
        local.tracks.splice(local.tracks.indexOf(t), 0, ...dragTracks.map(cloneTrack));
      }
      saveLibrary();
      renderView();
    };
  }
  row._track = t;
  row._contextKey = contextKey;
  return row;
}

function markPlaying(root = $('view')) {
  const cur = player && player.track;
  for (const row of root.querySelectorAll('.track')) {
    const on = row._track === cur && row._contextKey === state.playingContext;
    row.classList.toggle('playing', on);
    const num = row.querySelector('.num .n');
    if (num) {
      if (on) num.replaceChildren(h(`span.eq${player.playing ? '' : '.paused'}`, h('i'), h('i'), h('i')));
      else if (num.firstChild && num.firstChild.nodeType !== 3) num.textContent = [...row.parentNode.querySelectorAll('.track')].indexOf(row) + 1;
    }
  }
  for (const fab of $('view').querySelectorAll('.play-fab[data-context]')) {
    fab.innerHTML = icon(fab.dataset.context === state.playingContext && player.playing ? 'pause' : 'play', 22);
  }
}

function trackMenu(t, i, tracks, local, x, y) {
  const url = serviceUrl(t);
  menu(x, y, [
    { label: 'Play', icon: 'play', onClick: () => playList(tracks, i, local ? `local:${local.id}` : 'menu') },
    { label: 'Play next', icon: 'next', onClick: () => { player.addToQueue([t], true); toast('Playing next'); } },
    { label: 'Add to queue', icon: 'queue', onClick: () => { player.addToQueue([t]); toast('Added to queue'); } },
    '-',
    { header: 'Add to playlist' },
    { label: 'New playlist…', icon: 'plus', onClick: async () => { const p = await newPlaylist(false); if (p) addToLocal(p, [t]); } },
    ...state.library.playlists.filter((p) => p !== local).slice(0, 12).map((p) => ({ label: p.name, icon: 'list', onClick: () => addToLocal(p, [t]) })),
    '-',
    url ? { label: t.refs.spotify ? 'Open in Spotify' : 'Open in Apple Music', icon: 'link', onClick: () => glass.shell.open(url) } : null,
    local ? { label: 'Remove from playlist', icon: 'trash', danger: true, onClick: () => { local.tracks.splice(local.tracks.indexOf(t), 1); saveLibrary(); renderView(); renderSidebar(); } } : null,
  ]);
}

function localPlaylistMenu(p, x, y) {
  menu(x, y, [
    { label: 'Play', icon: 'play', onClick: () => playList(p.tracks, 0, `local:${p.id}`) },
    { label: 'Rename', icon: 'edit', onClick: async () => { const n = await promptDialog('Rename playlist', 'Name', p.name); if (n) { p.name = n; saveLibrary(); renderSidebar(); renderView(); } } },
    '-',
    { label: 'Copy to Spotify', icon: 'spotify', onClick: () => runTransfer(ctx, p, 'spotify') },
    { label: 'Copy to Apple Music', icon: 'apple', onClick: () => runTransfer(ctx, p, 'apple') },
    { label: 'Export as CSV', icon: 'export', onClick: () => exportPlaylist(p, 'csv') },
    { label: 'Export as M3U', icon: 'export', onClick: () => exportPlaylist(p, 'm3u') },
    '-',
    { label: 'Delete playlist', icon: 'trash', danger: true, onClick: () => deletePlaylist(p) },
  ]);
}

// ---------------- Library actions ----------------

async function newPlaylist(navigate = true) {
  const name = await promptDialog('New playlist', 'Name', `My playlist ${state.library.playlists.length + 1}`, 'Create');
  if (!name) return null;
  const p = { id: uid(), name, created: Date.now(), tracks: [] };
  state.library.playlists.unshift(p);
  saveLibrary();
  if (navigate) go({ type: 'local', id: p.id });
  else renderSidebar();
  return p;
}

function addLocalPlaylist({ name, tracks, artwork, origin }) {
  const p = { id: uid(), name, created: Date.now(), artwork: artwork || null, origin: origin || null, tracks: tracks.map(cloneTrack) };
  state.library.playlists.unshift(p);
  saveLibrary();
  go({ type: 'local', id: p.id });
  return p;
}

function addToLocal(p, tracks) {
  p.tracks.push(...tracks.map(cloneTrack));
  saveLibrary();
  renderSidebar();
  if (state.view.type === 'local' && state.view.id === p.id) renderView();
  toast(`Added to ${p.name}`, 'ok');
}

function saveRemoteToLibrary(list, tracks) {
  addLocalPlaylist({ name: list.name, tracks, artwork: list.artwork, origin: { service: list.service, id: list.id } });
  toast(`Saved “${list.name}” to your library`, 'ok');
}

async function deletePlaylist(p) {
  if (!(await confirmDialog('Delete playlist?', `“${p.name}” will be removed from GlassPlayer. Playlists on Spotify or Apple Music are not touched.`, 'Delete', true))) return;
  state.library.playlists = state.library.playlists.filter((x) => x !== p);
  saveLibrary();
  go({ type: 'home' });
}

async function exportPlaylist(p, format) {
  const safe = p.name.replace(/[\\/:*?"<>|]+/g, '_');
  const ok = await glass.files.savePlaylist({ suggestedName: `${safe}.${format}`, content: format === 'csv' ? toCsv(p.tracks) : toM3u(p.tracks) });
  if (ok) toast('Playlist exported', 'ok');
}

// ---------------- Playback ----------------

function playList(tracks, index, contextKey, shuffle = false) {
  if (!tracks.length) return;
  state.playingContext = contextKey;
  player.setQueue(tracks, index, { shuffle: shuffle || player.shuffle });
}

function renderNowbar() {
  const nb = $('nowbar');
  const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Seek' });
  const vol = h('input.vol', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
  let seeking = false;
  seek.oninput = () => { seeking = true; setRange(seek, Number(seek.value), Number(seek.max)); $('np-cur').textContent = formatTime(Number(seek.value)); };
  seek.onchange = () => { seeking = false; player.seek(Number(seek.value)); };
  let lastVol = player.volume || 0.7;
  vol.oninput = () => { player.setVolume(Number(vol.value) / 100); };
  vol.onchange = () => updateSettings({ volume: player.volume });

  nb.replaceChildren(
    h('div.np-left', h('div.np-art#np-art', { html: icon('music', 22) }), h('div.np-text', h('div.np-title#np-title', 'Nothing playing'), h('div.np-artist#np-artist', 'Pick something from your library'), h('div.np-src#np-src'))),
    h('div.np-center',
      h('div.np-controls',
        h('button.icon-btn#np-shuffle', { title: 'Shuffle', html: icon('shuffle', 18), onclick: () => player.toggleShuffle() }),
        h('button.icon-btn', { title: 'Previous', html: icon('prev', 18), onclick: () => player.prev() }),
        h('button.main-btn#np-play', { title: 'Play / Pause', html: icon('play', 20), onclick: () => player.toggle() }),
        h('button.icon-btn', { title: 'Next', html: icon('next', 18), onclick: () => player.next() }),
        h('button.icon-btn#np-repeat', { title: 'Repeat', html: icon('repeat', 18), onclick: () => player.cycleRepeat() })),
      h('div.np-seek', h('span#np-cur', '0:00'), seek, h('span#np-dur', '0:00'))),
    h('div.np-right',
      h('button.icon-btn#np-queue', { title: 'Queue', html: icon('queue', 18), onclick: toggleQueue }),
      h('button.icon-btn#np-mute', { title: 'Mute', html: icon('volume', 18), onclick: () => { if (player.volume > 0) { lastVol = player.volume; player.setVolume(0); } else player.setVolume(lastVol || 0.7); } }),
      vol),
  );
  setRange(vol, Math.round(player.volume * 100), 100);

  player.on('progress', () => {
    if (seeking) return;
    setRange(seek, Math.min(player.positionMs, player.durationMs), player.durationMs || 1);
    $('np-cur').textContent = formatTime(player.positionMs);
    $('np-dur').textContent = formatTime(player.durationMs);
  });
  player.on('volume', () => {
    setRange(vol, Math.round(player.volume * 100), 100);
    $('np-mute').innerHTML = icon(player.volume === 0 ? 'mute' : player.volume < 0.5 ? 'volumeLow' : 'volume', 18);
  });
  player.on('change', updateNowbar);
  updateNowbar();
}

function updateNowbar() {
  const t = player.track;
  const art = $('np-art');
  if (t) {
    $('np-title').textContent = t.title;
    $('np-artist').textContent = t.artist;
    art.innerHTML = '';
    art.style.backgroundImage = t.artwork ? `url("${t.artwork}")` : '';
    if (!t.artwork) art.innerHTML = icon('music', 22);
    const eng = player.engine && !player.loading ? player.engine.id : null;
    $('np-src').replaceChildren(player.loading ? h('span.badge', 'Loading…') : eng ? h(`span.badge.${eng}`, { html: `${icon(eng, 11)} ${eng === 'spotify' ? 'Spotify' : 'Apple Music'}` }) : '');
    const bg = $('backdrop-art');
    const big = t.artworkLarge || t.artwork;
    if (big && bg.dataset.src !== big) {
      bg.dataset.src = big;
      bg.style.backgroundImage = `url("${big}")`;
      bg.classList.add('show');
      glowFromArtwork(t.artwork || big);
    }
  }
  const play = $('np-play');
  play.innerHTML = icon(player.playing ? 'pause' : 'play', 20);
  play.classList.toggle('loading', player.loading);
  $('np-shuffle').classList.toggle('active', player.shuffle);
  const rep = $('np-repeat');
  rep.classList.toggle('active', player.repeat !== 'off');
  rep.innerHTML = icon(player.repeat === 'one' ? 'repeatOne' : 'repeat', 18);
  document.title = t ? `${t.title} · ${t.artist} — GlassPlayer` : 'GlassPlayer';
  markPlaying();
  if (!$('queue').hidden) renderQueue();
}

function toggleQueue() {
  const q = $('queue');
  q.hidden = !q.hidden;
  $('np-queue').classList.toggle('active', !q.hidden);
  if (!q.hidden) renderQueue();
}

function renderQueue() {
  const q = $('queue');
  const cur = player.track;
  const up = player.upcoming().slice(0, 80);
  const row = (t, label) => {
    const r = h('div.track', { ondblclick: () => { const idx = player.order.findIndex((oi, p) => p > player.pos && player.queue[oi] === t); if (idx >= 0) player.playAt(idx); } },
      h('div.main', h('span.art', { style: t.artwork ? { backgroundImage: `url("${t.artwork}")` } : {} }), h('div.txt', h('div.t-title', t.title), h('div.t-artist', t.artist))),
      h('span.dur', label || formatTime(t.durationMs)));
    r._track = t;
    return r;
  };
  q.replaceChildren(
    h('header', h('h3', 'Queue'), h('button.icon-btn.sm', { html: icon('x', 16), onclick: toggleQueue })),
    h('div.queue-list',
      h('div.label', 'Now playing'),
      cur ? row(cur) : h('p.hint', { style: { padding: '0 8px' } }, 'Nothing yet'),
      h('div.label', `Up next${up.length ? ` · ${player.order.length - player.pos - 1}` : ''}`),
      up.length ? up.map((t) => row(t)) : h('p.hint', { style: { padding: '0 8px' } }, player.repeat === 'all' ? 'Repeating from the top' : 'End of queue')),
  );
}

// ---------------- Connections ----------------

async function connect(service) {
  try {
    if (service === 'spotify') {
      const st = await glass.spotify.status();
      if (!st.clientId) return openSettings(ctx, 'spotify');
      toast('Finish signing in in your browser…');
      await providers.spotify.login();
    } else {
      const st = await glass.apple.status();
      if (!st.configured) return openSettings(ctx, 'apple');
      await providers.apple.login();
    }
    toast(`${providers[service].name} connected`, 'ok');
  } catch (err) {
    toastError(err);
  }
  onAuthChanged(service);
}

async function loadRemote(service, force = false) {
  const prov = providers[service];
  if (!prov.connected) {
    state.remote[service] = null;
    return renderSidebar();
  }
  if (force) {
    for (const k of [...state.cache.keys()]) if (k.startsWith(service + ':')) state.cache.delete(k);
  }
  state.remote[service] = null;
  renderSidebar();
  try {
    state.remote[service] = await prov.playlists();
  } catch (err) {
    state.remote[service] = [];
    toastError(err);
  }
  renderSidebar();
  if (state.view.type === 'remote' && state.view.service === service) renderView();
}

function onAuthChanged(service) {
  loadRemote(service);
  if (state.view.type === 'home') renderHome();
  if (state.view.type === 'local') renderView();
}

// ---------------- Chrome ----------------

function renderChrome(platform) {
  document.body.classList.add(`platform-${platform}`);
  $('brand').innerHTML = `${icon('logo')}<span>GlassPlayer</span>`;
  $('search-icon').innerHTML = icon('search', 17);
  $('btn-import').innerHTML = `${icon('import', 16)}<span>Import</span>`;
  $('btn-settings').innerHTML = icon('settings', 19);
  $('btn-import').onclick = () => openImport(ctx);
  $('btn-settings').onclick = () => openSettings(ctx);
  $('win-controls').replaceChildren(
    h('button', { title: 'Minimize', html: icon('minus', 16), onclick: () => glass.win.minimize() }),
    h('button', { title: 'Maximize', html: icon('square', 13), onclick: () => glass.win.maximize() }),
    h('button.close', { title: 'Close', html: icon('x', 16), onclick: () => glass.win.close() }),
  );
  const isMac = platform === 'darwin';
  document.querySelector('.search kbd').textContent = isMac ? '⌘K' : 'Ctrl K';

  const input = $('search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.view = { type: 'search', q: input.value };
      renderSidebar();
      renderSearch(input.value);
    }, 320);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.blur(); } });

  document.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (mod && (e.key === 'k' || e.key === 'f')) { e.preventDefault(); input.focus(); input.select(); return; }
    if (mod && e.key === ',') { e.preventDefault(); openSettings(ctx); return; }
    if (typing || modalOpen()) return;
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
    else if (mod && e.key === 'ArrowRight') player.next();
    else if (mod && e.key === 'ArrowLeft') player.prev();
    else if (e.key === 'ArrowRight' && e.shiftKey) player.seek(player.positionMs + 10000);
    else if (e.key === 'ArrowLeft' && e.shiftKey) player.seek(Math.max(0, player.positionMs - 10000));
    else if (mod && e.key === 'ArrowUp') player.setVolume(player.volume + 0.05);
    else if (mod && e.key === 'ArrowDown') player.setVolume(player.volume - 0.05);
  });
}

async function refreshBlocked() {
  try {
    const log = await glass.net.log();
    const blocked = log.reduce((a, e) => a + e.blocked, 0);
    if (blocked !== state.blockedCount) {
      state.blockedCount = blocked;
      renderSidebar();
    }
  } catch { /* ignore */ }
}

// Shared with dialogs.js
const ctx = {
  state, providers, updateSettings, saveLibrary, addLocalPlaylist, renderSidebar, renderView, connect, onAuthChanged,
  get player() { return player; },
};

async function main() {
  const [settings, library, platform, discord] = await Promise.all([
    glass.settings.get(), glass.library.get(), glass.win.platform(), glass.discord.status(),
  ]);
  state.settings = settings;
  state.library = library && Array.isArray(library.playlists) ? library : { playlists: [] };
  state.discord = discord;
  renderChrome(platform);
  applyTheme();

  player = new Player(providers, () => state.settings);
  player.on('error', toastError);
  player.on('track', () => saveLibrary()); // matching may have filled in refs/artwork
  player.on('queue', () => { if (!$('queue').hidden) renderQueue(); });
  renderNowbar();

  glass.discord.onStatus((s) => {
    state.discord = s;
    if (state.view.type === 'home') renderHome();
  });
  for (const [id, prov] of Object.entries(providers)) prov.on('auth', () => onAuthChanged(id));

  renderSidebar();
  renderHome();
  await Promise.all(Object.keys(providers).map(async (id) => {
    try {
      await providers[id].init();
    } catch (err) {
      console.warn(id, err);
    }
    providers[id].setVolume(player.volume);
    loadRemote(id);
  }));
  if (state.view.type === 'home') renderHome();
  refreshBlocked();
  setInterval(refreshBlocked, 5000);
}

main().catch(toastError);
