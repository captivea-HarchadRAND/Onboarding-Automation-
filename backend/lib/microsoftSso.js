// Connexion unique Microsoft (OpenID Connect, flux « authorization code » + PKCE) avec l'app Entra existante.
//
// Prérequis côté Entra (une seule fois) : plateforme Web, URI de redirection
//   <FRONTEND_URL>/api/auth/microsoft/callback   (ou MICROSOFT_REDIRECT_URI)
// Les permissions déléguées openid / profile / email sont implicites. Le secret client est celui d'AZURE_*.
//
// Sécurité : state lié au navigateur (cookie) + nonce + PKCE ; le jeton d'identité est vérifié (signature
// RS256 contre les clés publiques du tenant, émetteur, audience, expiration, nonce, tenant).
const crypto = require('crypto');
const { retryFetch } = require('./netFetch');

const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map(); // state → { nonce, verifier, exp }

const b64url = buf => Buffer.from(buf).toString('base64url');
const env = k => (process.env[k] || '').trim();

const msFetch = (url, options) => retryFetch(url, options, { label: 'Microsoft' });

function config() {
  const tenant = env('AZURE_TENANT_ID'), clientId = env('AZURE_CLIENT_ID'), secret = env('AZURE_CLIENT_SECRET');
  if (!tenant || !clientId || !secret) throw new Error('Identifiants Entra manquants');
  const base = env('FRONTEND_URL').split(',')[0].trim().replace(/\/$/, '') || 'http://localhost:5174';
  return { tenant, clientId, secret, redirectUri: env('MICROSOFT_REDIRECT_URI') || `${base}/api/auth/microsoft/callback` };
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
}

// → { url, state } : adresse Microsoft vers laquelle rediriger le navigateur
function startAuth() {
  const { tenant, clientId, redirectUri } = config();
  sweep();
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  pending.set(state, { nonce, verifier, exp: Date.now() + PENDING_TTL_MS });
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
    scope: 'openid profile email', state, nonce, prompt: 'select_account',
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  });
  return { url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`, state };
}

let jwks = { keys: null, at: 0 };
async function signingKey(kid) {
  const { tenant } = config();
  if (!jwks.keys || Date.now() - jwks.at > 3600 * 1000 || !jwks.keys.some(k => k.kid === kid)) {
    const res = await msFetch(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('Clés de signature Microsoft indisponibles');
    jwks = { keys: (await res.json()).keys || [], at: Date.now() };
  }
  const jwk = jwks.keys.find(k => k.kid === kid);
  if (!jwk) throw new Error('Clé de signature inconnue');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

// Vérifie le jeton d'identité et renvoie ses revendications
async function verifyIdToken(idToken, nonce) {
  const { tenant, clientId } = config();
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('Jeton invalide');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error('Algorithme de signature refusé');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), await signingKey(header.kid), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Signature du jeton invalide');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  if (c.iss !== `https://login.microsoftonline.com/${tenant}/v2.0`) throw new Error('Émetteur du jeton invalide');
  if (c.tid !== tenant) throw new Error('Tenant invalide');
  if (c.aud !== clientId) throw new Error('Audience du jeton invalide');
  if (!c.exp || c.exp < now - 60) throw new Error('Jeton expiré');
  if (c.nbf && c.nbf > now + 60) throw new Error('Jeton pas encore valide');
  if (c.nonce !== nonce) throw new Error('Nonce invalide');
  return c;
}

// → { email, name } de la personne authentifiée par Microsoft
async function finishAuth({ code, state }) {
  const entry = pending.get(state);
  pending.delete(state); // usage unique
  if (!entry || entry.exp < Date.now()) throw new Error('Demande de connexion expirée');
  const { tenant, clientId, secret, redirectUri } = config();
  const res = await msFetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code,
      redirect_uri: redirectUri, code_verifier: entry.verifier, scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id_token) {
    // Code Microsoft (AADSTS…) : il dit précisément ce qui manque (secret périmé, client public, URI…). Ne contient aucun secret.
    const aad = String(body.error_description || '').split(/\r?\n/)[0].match(/AADSTS\d+.*/)?.[0]?.slice(0, 200);
    throw new Error(`Échange du code refusé (${body.error || res.status}${aad ? ` — ${aad}` : ''})`);
  }
  const claims = await verifyIdToken(body.id_token, entry.nonce);
  const email = String(claims.email || claims.preferred_username || claims.upn || '').trim().toLowerCase();
  if (!email) throw new Error('Adresse email absente du jeton');
  return { email, name: claims.name || email };
}

module.exports = { startAuth, finishAuth, verifyIdToken, redirectUri: () => config().redirectUri };
