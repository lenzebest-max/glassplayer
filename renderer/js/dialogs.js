import { h, mapLimit } from './util.js';
import { icon } from './icons.js';
import { modal, toast, toastError, toggleRow } from './ui.js';
import { parseMusicUrl, parsePlaylistFile, resolveTrack } from './importer.js';

const ext = (url, label) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); glass.shell.open(url); } }, label);
const copyBtn = (text) => h('button.icon-btn.sm', { title: 'Copy', html: icon('copy', 15), onclick: () => { navigator.clipboard.writeText(text); toast('Copied'); } });

// ---------------- Settings ----------------

export function openSettings(ctx, initialTab = 'general') {
  const tabs = [
    ['general', 'General', 'settings'],
    ['spotify', 'Spotify', 'spotify'],
    ['apple', 'Apple Music', 'apple'],
    ['discord', 'Discord', 'discord'],
    ['privacy', 'Privacy', 'shield'],
  ];
  let current = initialTab;
  let netTimer = null;
  const body = h('div.modal-body');
  const tabBar = h('div.tabs');
  const drawTabs = () => tabBar.replaceChildren(...tabs.map(([id, label, ic]) => h(`button${id === current ? '.active' : ''}`, {
    onclick: () => { current = id; drawTabs(); draw(); },
    html: `${icon(ic, 15)}<span>${label}</span>`,
  })));
  const draw = async () => {
    clearInterval(netTimer);
    const panels = { general, spotify, apple, discord, privacy };
    body.replaceChildren(await panels[current](ctx, draw, (t) => { netTimer = t; }));
  };
  modal({ title: 'Settings', body: h('div', { style: { display: 'contents' } }, tabBar, body), onClose: () => clearInterval(netTimer) });
  drawTabs();
  draw();
}

async function general(ctx) {
  const s = ctx.state.settings;
  const accents = ['#8b7bff', '#5ea8ff', '#3dd6c6', '#6ee7a8', '#ffcf6e', '#ff9a62', '#ff7ab6', '#f5f5f7'];
  const swatches = h('div.swatches', accents.map((c) => h(`button${s.theme.accent === c ? '.on' : ''}`, {
    style: { background: c }, title: c,
    onclick: async (e) => {
      await ctx.updateSettings({ theme: { accent: c } });
      for (const b of swatches.children) b.classList.toggle('on', b === e.currentTarget);
    },
  })));
  const blur = h('input', { type: 'range', min: 0, max: 120, value: s.theme.blur, style: { '--p': `${(s.theme.blur / 120) * 100}%` } });
  blur.oninput = () => { blur.style.setProperty('--p', `${(blur.value / 120) * 100}%`); document.documentElement.style.setProperty('--blur', `${blur.value}px`); };
  blur.onchange = () => ctx.updateSettings({ theme: { blur: Number(blur.value) } });
  const pref = h('select.text-input', { onchange: (e) => ctx.updateSettings({ preferredService: e.target.value }) },
    [['auto', 'Automatic: play on the service the track came from'], ['spotify', 'Prefer Spotify'], ['apple', 'Prefer Apple Music']]
      .map(([v, l]) => h('option', { value: v, selected: s.preferredService === v }, l)));
  return h('div',
    h('label.field', h('span', 'Playback service'), pref,
      h('small', 'Tracks missing on one service are matched automatically on the other (by ISRC, then title, artist and length).')),
    h('div.field', h('span', 'Accent colour'), swatches, h('small', 'While music plays, the glow follows the album art.')),
    h('label.field', h('span', 'Background blur'), blur),
    h('div.box', h('h4', 'Keyboard'), h('div.hint', h('code', 'Space'), ' play/pause · ', h('code', 'Ctrl/⌘ ←/→'), ' prev/next · ', h('code', 'Shift ←/→'), ' seek 10s · ', h('code', 'Ctrl/⌘ ↑/↓'), ' volume · ', h('code', 'Ctrl/⌘ K'), ' search')),
  );
}

async function spotify(ctx, redraw) {
  const st = await glass.spotify.status();
  const prov = ctx.providers.spotify;
  const input = h('input.text-input', { value: st.clientId || '', placeholder: 'e.g. 3f2a1b…', spellcheck: false });
  const save = async () => {
    await ctx.updateSettings({ spotify: { clientId: input.value.trim() } });
    if (input.value.trim() !== (st.clientId || '')) {
      prov.connected = false;
      ctx.onAuthChanged('spotify');
    }
    toast('Saved', 'ok');
    redraw();
  };
  return h('div',
    h('div.box',
      h('h4', h('span', { html: icon('spotify', 16), style: { display: 'flex', color: 'var(--spotify)' } }), prov.connected ? `Connected${prov.user ? ` as ${prov.user.display_name || prov.user.id}` : ''}` : 'Not connected'),
      h('div.hint', 'Streaming uses the Spotify Web Playback SDK and needs Spotify Premium. Browsing, importing and copying playlists work with any account.'),
      h('div.row', { style: { marginTop: '12px' } },
        prov.connected
          ? h('button.pill.sm.danger', { onclick: async () => { await prov.logout(); redraw(); } }, 'Disconnect')
          : h('button.pill.sm.spotify', { disabled: !st.clientId, onclick: async () => { await ctx.connect('spotify'); redraw(); } }, 'Connect Spotify'))),
    h('label.field', h('span', 'Your Spotify app Client ID'), h('div.row', h('div.grow', input), h('button.pill.sm', { onclick: save }, 'Save'))),
    h('div.box',
      h('h4', 'One-time setup (2 minutes)'),
      h('ol.steps',
        h('li', 'Open the ', ext('https://developer.spotify.com/dashboard', 'Spotify Developer Dashboard'), ' and click ', h('b', 'Create app'), '.'),
        h('li', 'Name it anything (e.g. GlassPlayer). Tick ', h('b', 'Web API'), ' and ', h('b', 'Web Playback SDK'), '.'),
        h('li', 'Add this Redirect URI exactly: ', h('code', st.redirectUri), ' ', copyBtn(st.redirectUri)),
        h('li', 'Save, then paste the app’s ', h('b', 'Client ID'), ' above. No client secret is needed.')),
      h('div.hint', { style: { marginTop: '8px' } }, 'You own the app, so nothing goes through anyone else’s servers. Tokens are encrypted with your OS keychain.')),
  );
}

async function apple(ctx, redraw) {
  const st = await glass.apple.status();
  const prov = ctx.providers.apple;
  const team = h('input.text-input', { placeholder: 'Team ID (10 chars)', value: st.teamId || '', spellcheck: false });
  const key = h('input.text-input', { placeholder: 'Key ID (10 chars)', value: st.keyId || '', spellcheck: false });
  const token = h('textarea.text-input', { placeholder: 'eyJhbGciOiJFUzI1NiIs…', spellcheck: false, style: { height: '90px' } });
  const after = async (p) => {
    try {
      const res = await p;
      if (res && res.configured) {
        toast('Apple Music developer key saved', 'ok');
        prov.music = null; // reconfigure with the new token
        await prov.init();
        ctx.onAuthChanged('apple');
      }
    } catch (err) {
      toastError(err);
    }
    redraw();
  };
  return h('div',
    h('div.box',
      h('h4', h('span', { html: icon('apple', 16), style: { display: 'flex', color: '#ff6b80' } }),
        prov.connected ? 'Signed in to Apple Music' : st.configured ? 'Developer key ready, not signed in' : 'Not set up'),
      h('div.hint', 'Streaming needs an Apple Music subscription. Apple requires a MusicKit developer key to use its API; it is signed locally and never leaves this computer.'),
      st.error ? h('div.hint', { style: { color: 'var(--danger)' } }, st.error) : null,
      h('div.row', { style: { marginTop: '12px' } },
        prov.connected
          ? h('button.pill.sm.danger', { onclick: async () => { await prov.logout(); redraw(); } }, 'Sign out')
          : h('button.pill.sm.apple', { disabled: !st.configured, onclick: async () => { await ctx.connect('apple'); redraw(); } }, 'Sign in to Apple Music'),
        st.configured ? h('button.pill.sm', { onclick: () => after(glass.apple.clear()) }, 'Remove key') : null)),
    h('div.field', h('span', 'Option A: MusicKit private key (.p8)'),
      h('div.row', h('div.grow', team), h('div.grow', key)),
      h('div.row', h('button.pill.sm', { onclick: () => after(glass.apple.pickKey({ teamId: team.value, keyId: key.value })), html: `${icon('file', 15)} Choose .p8 key…` })),
      h('small', 'Get one at ', ext('https://developer.apple.com/account/resources/authkeys/list', 'developer.apple.com → Keys'), ' with the “Media Services (MusicKit)” capability. Requires an Apple Developer membership.')),
    h('div.divider', 'or'),
    h('label.field', h('span', 'Option B: paste a developer token'), token,
      h('div.row', h('button.pill.sm', { onclick: () => after(glass.apple.setToken(token.value)) }, 'Save token')),
      h('small', 'Any valid MusicKit developer token (JWT) works. GlassPlayer will warn you when it expires.')),
  );
}

async function discord(ctx, redraw) {
  const s = ctx.state.settings.discord;
  const st = await glass.discord.status();
  const id = h('input.text-input', { value: s.clientId, placeholder: 'Application ID, e.g. 1234567890123456789', spellcheck: false });
  return h('div',
    h('div.box',
      h('h4', h('span', { html: icon('discord', 16), style: { display: 'flex', color: '#8b95ff' } }),
        st.connected ? `Connected${st.user ? ` as ${st.user}` : ''}` : s.enabled ? 'Waiting for the Discord app…' : 'Off'),
      h('div.hint', 'Shows “Listening to” with the song, artist, cover art, a live progress bar and an “Open in …” button. Talks only to the Discord app running on this computer.')),
    toggleRow({
      label: 'Show what I’m listening to',
      hint: 'Needs the Discord desktop app open.',
      checked: s.enabled,
      onChange: async (v) => { await ctx.updateSettings({ discord: { enabled: v, clientId: id.value.trim() } }); setTimeout(redraw, 600); },
    }),
    toggleRow({
      label: 'Keep showing while paused',
      checked: s.showPaused,
      onChange: (v) => ctx.updateSettings({ discord: { showPaused: v } }),
    }),
    h('label.field', h('span', 'Discord Application ID'),
      h('div.row', h('div.grow', id), h('button.pill.sm', { onclick: async () => { await ctx.updateSettings({ discord: { clientId: id.value.trim() } }); toast('Saved', 'ok'); setTimeout(redraw, 600); } }, 'Save')),
      h('small', 'Create one at ', ext('https://discord.com/developers/applications', 'discord.com/developers'), ' → New Application. The name you give it (e.g. “GlassPlayer”) is what friends see. Copy its Application ID here.')),
  );
}

async function privacy(ctx, redraw, setTimer) {
  const s = ctx.state.settings.network;
  const info = await glass.privacy.info();
  const table = h('tbody');
  const stats = h('div.stat-row');
  const refresh = async () => {
    const log = await glass.net.log();
    const allowed = log.reduce((a, e) => a + e.allowed, 0);
    const blocked = log.reduce((a, e) => a + e.blocked, 0);
    stats.replaceChildren(
      h('div.stat', h('b', log.length), h('span', 'hosts contacted')),
      h('div.stat', h('b', allowed), h('span', 'requests allowed')),
      h('div.stat', h('b', blocked), h('span', 'requests blocked')));
    table.replaceChildren(...(log.length ? log.map((e) => h(`tr${e.blocked && !e.allowed ? '.blocked' : ''}`,
      h('td', e.host),
      h('td.n', e.allowed),
      h('td.n', e.blocked),
      h('td', { style: { fontFamily: 'inherit', color: 'var(--text-3)' } }, e.blocked ? (e.reason === 'telemetry' ? 'telemetry' : 'not allowed') : ''))) : [h('tr', h('td', { colspan: 4, style: { fontFamily: 'inherit', color: 'var(--text-3)' } }, 'No network requests yet.'))]));
  };
  await refresh();
  setTimer(setInterval(refresh, 2000));
  return h('div',
    h('div.box',
      h('h4', h('span', { html: icon('shield', 16), style: { display: 'flex', color: '#6ee7a8' } }), 'What GlassPlayer does not do'),
      h('div.hint', 'No ads. No analytics, crash reporting or telemetry. No GlassPlayer accounts or servers. No auto-updater phoning home. Your playlists and settings stay in ', h('code', info.dataDir), '.'),
      h('div.hint', { style: { marginTop: '6px' } }, 'Credentials are encrypted with: ', h('code', info.encryption))),
    toggleRow({
      label: 'Strict network mode',
      hint: 'Only Spotify and Apple Music hosts are reachable. Everything else is blocked.',
      checked: s.strict,
      onChange: (v) => ctx.updateSettings({ network: { strict: v } }),
    }),
    toggleRow({
      label: 'Block service telemetry',
      hint: 'Blocks Apple’s analytics endpoints (xp.apple.com). Playback is unaffected.',
      checked: s.blockTelemetry,
      onChange: (v) => ctx.updateSettings({ network: { blockTelemetry: v } }),
    }),
    h('div.field', h('span', 'Live network log'), stats,
      h('table.netlog', h('thead', h('tr', h('th', 'Host'), h('th', { style: { textAlign: 'right' } }, 'Allowed'), h('th', { style: { textAlign: 'right' } }, 'Blocked'), h('th', ''))), table)),
  );
}

// ---------------- Import ----------------

export function openImport(ctx) {
  const { providers } = ctx;
  const link = h('input.text-input', { placeholder: 'https://open.spotify.com/playlist/…  or  https://music.apple.com/…/playlist/…', spellcheck: false, onkeydown: (e) => e.key === 'Enter' && importLink() });
  const text = h('textarea.text-input', { placeholder: 'Daft Punk - One More Time\nPhoenix - 1901\nTame Impala - The Less I Know The Better', spellcheck: false });
  const textName = h('input.text-input', { placeholder: 'Playlist name', value: 'Pasted playlist' });
  let busy = false;

  const finish = (playlist) => {
    m.close();
    ctx.addLocalPlaylist(playlist);
    toast(`Imported “${playlist.name}” · ${playlist.tracks.length} tracks`, 'ok');
  };

  async function importLink() {
    if (busy) return;
    const parsed = parseMusicUrl(link.value);
    if (!parsed) return toast('That link isn’t a Spotify or Apple Music playlist/album', 'error');
    const prov = providers[parsed.service];
    if (parsed.service === 'spotify' && !prov.connected) return toast('Connect Spotify first to import Spotify links', 'error');
    busy = true;
    linkBtn.disabled = true;
    linkBtn.textContent = 'Importing…';
    try {
      let result;
      if (parsed.service === 'apple') await prov.ensure();
      if (parsed.kind === 'album') {
        result = await prov.albumTracks(parsed.id);
      } else {
        const [info, tracks] = await Promise.all([prov.playlistInfo(parsed.id), prov.playlistTracks(parsed.id)]);
        result = { name: info.name, artwork: info.artwork, tracks };
      }
      if (!result.tracks.length) throw new Error('No tracks found at that link');
      finish({ ...result, origin: { service: parsed.service, id: parsed.id } });
    } catch (err) {
      toastError(err.status === 404 ? new Error('Playlist not found or private') : err);
    } finally {
      busy = false;
      linkBtn.disabled = false;
      linkBtn.textContent = 'Import';
    }
  }

  async function importFile() {
    try {
      const file = await glass.files.openPlaylist();
      if (!file) return;
      const parsed = parsePlaylistFile(file.name, file.content);
      if (!parsed.tracks.length) throw new Error('No tracks found in that file');
      finish(parsed);
    } catch (err) {
      toastError(err);
    }
  }

  function importText() {
    const parsed = parsePlaylistFile('pasted.txt', text.value);
    if (!parsed.tracks.length) return toast('Paste at least one “Artist - Title” line', 'error');
    finish({ name: textName.value.trim() || 'Pasted playlist', tracks: parsed.tracks });
  }

  const linkBtn = h('button.pill.primary', { onclick: importLink }, 'Import');
  const body = h('div.modal-body',
    h('div.box',
      h('h4', h('span', { html: icon('link', 16), style: { display: 'flex' } }), 'From a link'),
      h('div.hint', 'Spotify or Apple Music playlist and album links.'),
      h('div.row', { style: { marginTop: '10px' } }, h('div.grow', link), linkBtn)),
    h('div.box',
      h('h4', h('span', { html: icon('file', 16), style: { display: 'flex' } }), 'From a file'),
      h('div.hint', 'CSV (Exportify, TuneMyMusic, Soundiiz, GlassPlayer), M3U/M3U8, JSON, or a text file with one “Artist - Title” per line.'),
      h('div.row', { style: { marginTop: '10px' } }, h('button.pill', { onclick: importFile, html: `${icon('file', 15)} Choose file…` }))),
    h('div.box',
      h('h4', h('span', { html: icon('list', 16), style: { display: 'flex' } }), 'Paste a track list'),
      h('div.row', { style: { margin: '10px 0' } }, h('div.grow', textName)),
      text,
      h('div.row', { style: { marginTop: '10px' } }, h('button.pill', { onclick: importText }, 'Create playlist'))),
    h('p.hint', 'Your own Spotify and Apple Music playlists are already in the sidebar. Open one and press ', h('b', 'Save to Library'), ' or ', h('b', 'Copy to …'), ' to move it between services.'),
  );
  const m = modal({ title: 'Import playlist', body });
  return m;
}

// ---------------- Transfer ----------------

export async function runTransfer(ctx, playlist, service) {
  const prov = ctx.providers[service];
  if (!prov.connected) return toast(`Connect ${prov.name} first`, 'error');
  const tracks = playlist.tracks;
  if (!tracks.length) return toast('Playlist is empty', 'error');

  let cancelled = false;
  const bar = h('div');
  const status = h('div.hint', 'Matching tracks…');
  const result = h('div');
  const closeBtn = h('button.pill', { onclick: () => { cancelled = true; m.close(); } }, 'Cancel');
  const m = modal({
    title: `Copy to ${prov.name}`,
    size: 'sm',
    body: h('div.modal-body', h('p', { style: { margin: '0 0 4px', fontWeight: 600 } }, playlist.name), h('div.progress', bar), status, result),
    foot: [closeBtn],
    onClose: () => { cancelled = true; },
  });

  let done = 0;
  const ids = await mapLimit(tracks, 4, async (t) => {
    if (cancelled) return null;
    const ref = await resolveTrack(t, prov).catch(() => null);
    done++;
    bar.style.width = `${(done / tracks.length) * 100}%`;
    status.textContent = `Matched ${done} of ${tracks.length}…`;
    return ref;
  });
  if (cancelled) return;
  ctx.saveLibrary(); // matches are cached on the tracks for next time
  const found = ids.filter(Boolean);
  const missing = tracks.filter((_, i) => !ids[i]);
  if (!found.length) {
    status.textContent = 'None of these tracks could be found.';
    closeBtn.textContent = 'Close';
    return;
  }
  status.textContent = `Creating playlist with ${found.length} tracks…`;
  try {
    const created = await prov.createPlaylist(playlist.name, [...new Set(found)]);
    status.replaceChildren(h('b', { style: { color: '#6ee7a8' } }, `Done: ${found.length} of ${tracks.length} tracks copied.`));
    if (created.url) result.append(h('p', h('a.link', { onclick: () => glass.shell.open(created.url) }, `Open in ${prov.name}`)));
    if (missing.length) {
      result.append(h('p.hint', { style: { marginBottom: 0 } }, `${missing.length} couldn’t be matched:`),
        h('div.unmatched', missing.map((t) => h('div', `${t.artist} — ${t.title}`))));
    }
    if (service === 'spotify' || service === 'apple') ctx.onAuthChanged(service);
  } catch (err) {
    status.textContent = `Couldn’t create the playlist: ${err.message}`;
  }
  closeBtn.textContent = 'Close';
  closeBtn.classList.add('primary');
}
