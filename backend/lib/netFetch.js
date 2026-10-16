// fetch() de Node ne dit que « fetch failed » : la vraie cause (DNS, certificat, délai…) est dans error.cause.
// Une connexion vers Microsoft tombe parfois sur une adresse qui ne répond pas et attend 10 s avant d'échouer.
// Plutôt qu'un seul long essai, on tente jusqu'à 3 fois avec un délai court (5 s) : chaque essai ouvre une
// nouvelle connexion, qui aboutit presque toujours. On ne rejoue que les échecs de connexion ou de délai ;
// les refus du serveur (code invalide, 403, 404…) sont renvoyés tels quels. À réserver aux appels dont un
// rejeu est sans danger (lecture, ou échange d'un code d'autorisation qui n'a pas pu partir).
const RETRYABLE = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);
const ATTEMPTS = 3, ATTEMPT_TIMEOUT_MS = 5000;

async function retryFetch(url, options = {}, { attemptTimeoutMs = ATTEMPT_TIMEOUT_MS, retryDelayMs = 300, label = 'Le serveur distant' } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(attemptTimeoutMs) });
    } catch (e) {
      const code = e.cause?.code;
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      if (attempt < ATTEMPTS && (RETRYABLE.has(code) || timedOut)) {
        await new Promise(r => setTimeout(r, retryDelayMs));
        continue;
      }
      throw new Error(`${label} injoignable depuis le serveur (${code || (timedOut ? 'délai dépassé' : e.cause?.message || e.name)})`);
    }
  }
}

module.exports = { retryFetch };
