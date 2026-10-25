'use strict';
// Spotify Authorization Code + PKCE flow. No client secret, no backend:
// the browser redirects back to a one-shot loopback server on 127.0.0.1.

const http = require('http');
const crypto = require('crypto');

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
];

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;background:#0b0b12;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>${title}</h2><p style="opacity:.7">${body}</p></div></body>`;

function waitForCode(authUrl, state, openExternal) {
  return new Promise((resolve, reject) => {
    let timer;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const done = (err, code) => {
        clearTimeout(timer);
        server.close();
        err ? reject(err) : resolve(code);
      };
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Login failed', 'State mismatch. Try again from GlassPlayer.'));
        return done(new Error('State mismatch'));
      }
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Login cancelled', 'You can close this tab.'));
        return done(new Error(error));
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Connected to GlassPlayer', 'You can close this tab and go back to the app.'));
      done(null, url.searchParams.get('code'));
    });
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'EADDRINUSE' ? new Error(`Port ${PORT} is in use. Close the app using it and retry.`) : err);
    });
    server.listen(PORT, '127.0.0.1', () => openExternal(authUrl));
    timer = setTimeout(() => { server.close(); reject(new Error('Login timed out')); }, 5 * 60 * 1000);
  });
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || params.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    scope: json.scope,
  };
}

async function authorize(clientId, openExternal) {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  const code = await waitForCode(authUrl, state, openExternal);
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
}

function refresh(clientId, refreshToken) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
}

module.exports = { authorize, refresh, REDIRECT_URI, SCOPES };
