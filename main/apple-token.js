'use strict';
// Signs an Apple Music developer token (ES256 JWT) locally from your MusicKit
// .p8 key, so the key never leaves your machine.

const crypto = require('crypto');

const MAX_TTL_S = 15777000; // Apple's limit: ~6 months

const b64url = (input) => Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeDeveloperToken({ teamId, keyId, privateKey, ttlSeconds = 60 * 60 * 24 * 90 }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId || '')) throw new Error('Team ID should be 10 letters/digits');
  if (!/^[A-Z0-9]{10}$/.test(keyId || '')) throw new Error('Key ID should be 10 letters/digits');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.min(ttlSeconds, MAX_TTL_S);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = b64url(JSON.stringify({ iss: teamId, iat, exp }));
  const input = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { token: `${input}.${b64url(signature)}`, expiresAt: exp * 1000 };
}

// Reads exp from a pasted token so we know when it goes stale.
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

module.exports = { makeDeveloperToken, tokenExpiry };
