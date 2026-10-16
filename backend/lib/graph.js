// [EN-TÊTE] backend/lib/graph.js — accès Microsoft Graph avec l'application Entra (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET).
//   graphFetch(chemin, options) : appel Graph authentifié (jeton d'application mis en cache), renvoie le JSON ;
//   en cas d'erreur Graph lève une Error portant code, graphStatus, innerMessage, innerType (utilisés pour reconnaître
//   « Exchange pas encore prêt » pendant l'assignation de licence).
//   resetCredential() : à appeler quand les identifiants changent (page Administration → API).
//   Utilisé par group.js, license.js, user.js et par server.js. En mode MOCK_GRAPH, lib/mock.js remplace ces modules.

const { ClientSecretCredential } = require('@azure/identity');

let _credential = null;

function getCredential() {
  if (_credential) return _credential;
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET)
    throw new Error('Credentials Azure manquants dans .env (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)');
  _credential = new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
  return _credential;
}

async function graphFetch(path, options = {}, extraHeaders = {}) {
  const cred = getCredential();
  const { token } = await cred.getToken('https://graph.microsoft.com/.default');

  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body,
  });

  if (res.status === 204) return null;

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    const err = new Error(msg);
    err.code = data?.error?.code;
    err.graphStatus = res.status;
    // Détail Exchange — internalexception est plus précis que innererror.message
    err.innerMessage = data?.error?.innererror?.internalexception?.message
                    || data?.error?.innererror?.message
                    || null;
    err.innerType = data?.error?.innererror?.type || null;
    throw err;
  }

  return data;
}

function resetCredential() { _credential = null; }

module.exports = { graphFetch, resetCredential };
