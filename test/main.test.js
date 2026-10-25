'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { encode, buildActivity, OP } = require('../main/discord-rpc');
const { makeDeveloperToken, tokenExpiry } = require('../main/apple-token');
const { classify } = require('../main/network-guard');
const { merge, DEFAULT_SETTINGS } = require('../main/store');

test('Discord frames are little-endian op + length + JSON', () => {
  const buf = encode(OP.HANDSHAKE, { v: 1, client_id: '1' });
  assert.equal(buf.readInt32LE(0), 0);
  assert.equal(buf.readInt32LE(4), buf.length - 8);
  assert.deepEqual(JSON.parse(buf.subarray(8)), { v: 1, client_id: '1' });
});

test('buildActivity: playing track has timestamps, button and listening type', () => {
  const a = buildActivity({ title: 'Song', artist: 'Artist', album: 'Album', artwork: 'https://i.scdn.co/image/x', durationMs: 200000, positionMs: 50000, playing: true, service: 'spotify', url: 'https://open.spotify.com/track/abc' });
  assert.equal(a.type, 2);
  assert.equal(a.details, 'Song');
  assert.equal(a.state, 'by Artist');
  assert.equal(a.timestamps.end - a.timestamps.start, 200000);
  assert.ok(Math.abs(Date.now() - a.timestamps.start - 50000) < 1000);
  assert.deepEqual(a.buttons, [{ label: 'Open in Spotify', url: 'https://open.spotify.com/track/abc' }]);
});

test('buildActivity: paused hides timestamps, optional hide, rejects odd urls', () => {
  const np = { title: 'S', artist: '', playing: false, service: 'apple', url: 'https://evil.example/' };
  const a = buildActivity(np);
  assert.equal(a.details.length, 2);
  assert.equal(a.timestamps, undefined);
  assert.equal(a.buttons, undefined);
  assert.equal(a.assets.small_text, 'Paused');
  assert.equal(buildActivity(np, { showPaused: false }), null);
  assert.equal(buildActivity(null), null);
});

test('Apple developer token is a valid ES256 JWT', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const { token, expiresAt } = makeDeveloperToken({ teamId: 'ABCDE12345', keyId: 'KEY1234567', privateKey: pem });
  const [h, p, s] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'ABCDE12345');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(tokenExpiry(token), expiresAt);
  assert.throws(() => makeDeveloperToken({ teamId: 'bad', keyId: 'KEY1234567', privateKey: pem }));
});

test('network guard: allowlist, telemetry block, local passthrough', () => {
  const strict = { strict: true, blockTelemetry: true };
  assert.equal(classify('https://api.spotify.com/v1/me', strict).allow, true);
  assert.equal(classify('https://i.scdn.co/image/1', strict).allow, true);
  assert.equal(classify('https://is1-ssl.mzstatic.com/a.jpg', strict).allow, true);
  assert.equal(classify('https://api.music.apple.com/v1', strict).allow, true);
  assert.equal(classify('https://www.google-analytics.com/collect', strict).allow, false);
  assert.equal(classify('https://evilspotify.com/', strict).allow, false);
  assert.equal(classify('https://xp.apple.com/report', strict).reason, 'telemetry');
  assert.equal(classify('https://xp.apple.com/report', { strict: true, blockTelemetry: false }).allow, true);
  assert.equal(classify('https://example.com/', { strict: false, blockTelemetry: true }).allow, true);
  assert.equal(classify('http://127.0.0.1:8888/callback', strict).allow, true);
});

test('settings merge is deep and keeps defaults', () => {
  const s = merge(DEFAULT_SETTINGS, { discord: { enabled: true } });
  assert.equal(s.discord.enabled, true);
  assert.equal(s.discord.showPaused, true);
  assert.equal(s.network.strict, true);
});
