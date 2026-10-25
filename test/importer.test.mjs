import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parsePlaylistFile, parseMusicUrl, normalize, pickBest, resolveTrack, toCsv, toM3u } from '../renderer/js/importer.js';

test('parseCsv handles quotes, commas and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('Exportify-style CSV becomes tracks with ISRC and Spotify refs', () => {
  const csv = '﻿Track URI,Track Name,Artist Name(s),Album Name,Duration (ms),ISRC\n'
    + 'spotify:track:4cOdK2wGLETKBW3PvgPWqT,Never Gonna Give You Up,Rick Astley,Whenever You Need Somebody,213573,GBARL9300135\n'
    + ',"Song, With Comma","A;B",,180000,\n';
  const { name, tracks } = parsePlaylistFile('My Mix.csv', csv);
  assert.equal(name, 'My Mix');
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].refs.spotify, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(tracks[0].isrc, 'GBARL9300135');
  assert.equal(tracks[0].durationMs, 213573);
  assert.equal(tracks[1].title, 'Song, With Comma');
  assert.equal(tracks[1].artist, 'A, B');
});

test('M3U with EXTINF and bare file paths', () => {
  const m3u = '#EXTM3U\n#EXTINF:215,Daft Punk - One More Time\n/music/one.mp3\nC:\\Music\\03 - Phoenix - 1901.flac\n';
  const { tracks } = parsePlaylistFile('list.m3u8', m3u);
  assert.equal(tracks.length, 2);
  assert.deepEqual([tracks[0].artist, tracks[0].title, tracks[0].durationMs], ['Daft Punk', 'One More Time', 215000]);
  assert.deepEqual([tracks[1].artist, tracks[1].title], ['Phoenix', '1901']);
});

test('plain text lists', () => {
  const { tracks } = parsePlaylistFile('x.txt', '1. Tame Impala - The Less I Know The Better\n\nJust A Title\n');
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].artist, 'Tame Impala');
  assert.equal(tracks[1].title, 'Just A Title');
});

test('parseMusicUrl recognises Spotify and Apple links', () => {
  assert.deepEqual(parseMusicUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), { service: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parseMusicUrl('https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy'), { service: 'spotify', kind: 'album', id: '4aawyAB9vmqN3uQ7FjRGTy' });
  assert.deepEqual(parseMusicUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), { service: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.deepEqual(parseMusicUrl('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'), { service: 'apple', kind: 'playlist', id: 'pl.f4d106fed2bd41149aaacabb233eb5eb', storefront: 'us' });
  assert.deepEqual(parseMusicUrl('https://music.apple.com/gb/album/discovery/697194953'), { service: 'apple', kind: 'album', id: '697194953', storefront: 'gb' });
  assert.equal(parseMusicUrl('https://example.com/x'), null);
});

test('normalize strips remaster and feat noise', () => {
  assert.equal(normalize('Bohemian Rhapsody - Remastered 2011'), 'bohemian rhapsody');
  assert.equal(normalize('Señorita (feat. Someone)'), 'senorita');
});

test('pickBest prefers the right recording', () => {
  const target = { title: 'One More Time', artist: 'Daft Punk', durationMs: 320000 };
  const cands = [
    { title: 'One More Time (Cover)', artist: 'Random Band', durationMs: 200000 },
    { title: 'One More Time', artist: 'Daft Punk', durationMs: 320357 },
  ];
  assert.equal(pickBest(target, cands), cands[1]);
  assert.equal(pickBest(target, [{ title: 'Something Else', artist: 'Nobody', durationMs: 100000 }]), null);
});

test('resolveTrack uses ISRC first and caches the ref', async () => {
  let textCalls = 0;
  const provider = {
    id: 'apple',
    findByIsrc: async () => [{ title: 'Song', artist: 'Artist', refs: { apple: '123' }, artwork: 'https://x/a.jpg' }],
    findByText: async () => { textCalls++; return []; },
  };
  const t = { title: 'Song', artist: 'Artist', isrc: 'USX', refs: { spotify: 'spotify:track:1' } };
  assert.equal(await resolveTrack(t, provider), '123');
  assert.equal(t.refs.apple, '123');
  assert.equal(t.artwork, 'https://x/a.jpg');
  assert.equal(await resolveTrack(t, provider), '123');
  assert.equal(textCalls, 0);
});

test('CSV and M3U export round-trip', () => {
  const tracks = [{ title: 'A, "quoted"', artist: 'B', album: 'C', isrc: 'X1', durationMs: 1000 * 61, refs: { spotify: 'spotify:track:abc' } }];
  const back = parsePlaylistFile('x.csv', toCsv(tracks)).tracks;
  assert.equal(back[0].title, 'A, "quoted"');
  assert.equal(back[0].refs.spotify, 'spotify:track:abc');
  assert.match(toM3u(tracks), /#EXTINF:61,B - A, "quoted"\nhttps:\/\/open\.spotify\.com\/track\/abc/);
});
