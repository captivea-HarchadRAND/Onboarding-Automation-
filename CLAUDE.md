# CLAUDE.md — guide du projet pour les nouvelles conversations

Portail interne Captivea : modules **Onboarding** (comptes Microsoft 365) et **Monitoring** (licences IA : Claude, ChatGPT, Fireflies).
Lis ce fichier d'abord ; chaque fichier source commence par un en-tête `[EN-TÊTE]` qui explique son rôle. Documentation détaillée : `docs/` (`portail-et-connexion.md`, `onboarding.md`, `monitoring.md`) ; `docs/guide-production.md` = mise en production (valeurs de prod, `.env` prêt à copier) ; `docs/github.md` = invitations GitHub + dépôt + déploiement ; `docs/guide-simplifie.md` = guide pour non-techniciens (checklist de ce qui se règle à la main : Entra, Exchange, SharePoint, serveur).

## Règles de travail (demandées par l'utilisateur)

- **Ne jamais commiter ni pousser** tant que l'utilisateur n'écrit pas explicitement « push ». Ne pas le proposer.
- Ne **jamais** commiter `.mcp.json` ni `docs/audits/`. Ne jamais afficher de secrets du `.env` (masquer les valeurs).
- Un **push sur `main` déploie automatiquement** sur le VPS (`.github/workflows/deploy.yml` : `git pull`, build du frontend, `pm2 restart onboarding`). Le `.env` du VPS n'est jamais touché : toute nouvelle variable doit y être ajoutée **avant** le push.
- Répondre en **français**. Messages d'interface et journaux en français.
- Interface : respecter la skill **ui-ux-pro-max** (`.claude/skills/ui-ux-pro-max`) — labels visibles, états de focus, contrastes, pas d'emoji comme icône. Utiliser `<Select>` (jamais `<select>` natif) et les tokens CSS de `frontend/src/index.css`.
- Les serveurs de dev **de l'utilisateur** tournent sur **8081** (backend) et **5175** (frontend) : ne pas les arrêter. Pour tester, lancer ses propres instances sur d'autres ports (ex. 8099/5199) avec une base isolée.

## Stack et lancement

- Backend : Node.js + Express, base **sql.js** (SQLite en mémoire, fichier `backend/data/onboarding.db`). Frontend : React + Vite (`frontend/dist` servi par Express en production).
- `cd backend && npm run dev` (port 8081) · `cd frontend && npm run dev` (port 5175, proxy `/api` → 8081).
- Vérifications rapides : `node --check backend/server.js` et `cd frontend && npx vite build --outDir <dossier temporaire>`.
- **Tests isolés** : `DATA_DIR=<dossier temp>` (copie de la base), `MOCK_GRAPH=true` (Graph simulé), `SUPER_ADMIN_EMAILS=<email>`. Le serveur garde la base **en mémoire** : redémarrer après avoir modifié le fichier `.db` à la main. Créer une session de test en insérant une ligne dans `sessions` (token, user_id, name, role, expires_at) et envoyer le cookie `session=<token>`.

## Carte du code

```
backend/
  server.js            tout le backend (plan des sections en tête du fichier)
  db.js                sql.js + migrations (ajouter à la FIN du tableau, jamais modifier l'existant)
  lib/graph.js         Microsoft Graph (jeton d'application)        lib/group.js · license.js · user.js  (remplacés par lib/mock.js en MOCK_GRAPH)
  lib/microsoftSso.js  connexion Microsoft (OIDC + PKCE)            lib/netFetch.js  fetch avec essais courts (coupures de connexion)
  lib/modules.js       modules et accès par utilisateur             lib/aiUsage.js   calculs et stockage du Monitoring
  lib/sharepointSync.js lecture des rapports SharePoint             lib/xlsx.js      lecture .xlsx sans dépendance
frontend/src/
  App.jsx (routes, Guard) · modules.js (registre des modules) · components/Layout.jsx (menu, fil d'Ariane)
  components/Select.jsx · UsersManager.jsx · formA11y.js (labels/astérisques automatiques)
  pages/  Portal · PortalAdmin · LoginSSO · Login (secours) · Dashboard · NewOnboarding · ManualOnboarding · Transfer · MailboxAccess ·
          History · OnboardingDetail · Offboarding · Security · Admin · Monitoring · MonitoringAdmin
docs/  documentation (README.md = index ; README.html = ANCIENNE doc, dépassée). Chaque .md a une page .html (charte Captivea) :
       `node docs/build-html.js` les régénère (assets dans docs/assets/) — à relancer après toute modif d'un .md ; index.html = page d'accueil.
       `docs/odoo/` = version **Odoo Knowledge** (HTML à style en ligne, car Odoo retire CSS/JS) : `node docs/odoo/build-odoo.js` (guide d'import dans docs/odoo/index.html) ; relancer les DEUX scripts après une modif d'un .md
```

## Concepts clés

- **Connexion** : Microsoft SSO uniquement (`/login`). Le mot de passe n'est qu'un accès de **secours** pour les **administrateurs** (`/login/backup`). Le compte doit déjà exister dans l'app (créé dans « Gestion du portail »).
- **Rôles** : `operator`, `admin`. **Super admin** = adresse dans `SUPER_ADMIN_EMAILS` : seul à ouvrir « Gestion du portail » (utilisateurs + accès aux modules) et à supprimer l'historique. Si la variable est absente, le code retombe sur une adresse écrite en dur.
- **Modules** : `onboarding`, `monitoring` (registre `backend/lib/modules.js` + `frontend/src/modules.js`). Admin = tous les modules par défaut ; `users.modules` (JSON) restreint ; super admin = toujours tout. Appliqué **aussi côté serveur** : `requireModule('x')`.
- **Routes protégées** : `app.get(chemin, auth, [requireRole('admin')], [requireModule('x')], [requireSuperAdmin], handler)`.
- **Onboarding** : phase 1 immédiate (compte, groupe principal, licence → statut `partial` = « Finalisation », mot de passe affiché une seule fois), phase 2 après 60 s (groupes SharePoint/communication, boîtes partagées, GitHub, Teams → `done`). Échec en phase 1 = suppression automatique du compte (rollback). Au redémarrage, `recoverStaleOnboardings` reprend ou marque en échec.
- **Réglages métier** : table `settings` (clé/valeur JSON), modifiés dans l'interface ; `SETTINGS_MAP` les relie à des variables d'environnement ; la base **remplace** le `.env` au démarrage.
- **Monitoring** : les rapports Excel produits par n8n arrivent soit par lecture SharePoint (`sharepointSync`, lecture seule, `Sites.Selected`), soit par envoi de n8n (`POST /api/monitoring/ai-usage/ingest`, jeton `MONITORING_INGEST_TOKEN`). Même outil + même mois = le relevé est remplacé.
- **Niveaux d'usage** (Monitoring) : vert « Utilise », jaune « Utilise peu », orange « Pas utilisé ce mois-ci », rouge « Inactif · 2 mois ou plus » (0 ce mois-ci **et** le mois précédent). La règle est dans `lib/aiUsage.js` (`levelOf`) **et** dans `Monitoring.jsx` (`levelFor`) : les garder identiques. Seuils : Claude 10/50, ChatGPT 1/5, Fireflies 1/11.
- **Coût des licences inactives** : **Claude a deux prix** (siège Premium 30 € / Standard 25 €, lu dans la colonne « Siège » : contient « premium » → Premium, sinon Standard) ; ChatGPT 30 € et Fireflies 19 € = un prix unique. `settings.monitoring_prices` = `{outil:{siège:prix}}` (l'ancien format, un nombre par outil, est lu comme Standard). Calcul dans `aiUsage.dashboard` (`cells[].inactifs` par siège) **et** `Monitoring.jsx` (`costOf`).

## Pièges connus

- **`.env`** : le chargeur ne gère **pas** les commentaires en fin de ligne (`PORT=8081 # x` casse la valeur). Les commentaires vont sur leur propre ligne. Modèle : `backend/.env.example`.
- **Deux applications Entra** : la **production** (`AZURE_CLIENT_ID=ebd40beb-…`, tenant `be789c50-…`) et l'application de **test** `TestOnboardingAutomation` (`8d690b…`, celle du `.env` local). Tout réglage fait pour l'une (URI de retour, permissions, accès au site SharePoint, Exchange) est **à refaire** pour l'autre. Voir `docs/guide-production.md`.
- **Entra** : l'URI de retour (`<FRONTEND_URL>/api/auth/microsoft/callback` ou `MICROSOFT_REDIRECT_URI`) doit être enregistrée en plateforme **Web** — jamais « Single-page application » (sinon `AADSTS700025`, client public) ; « Allow public client flows » = Disabled.
- Réseau de l'utilisateur : coupures de connexion ponctuelles (`UND_ERR_CONNECT_TIMEOUT`). Les appels Microsoft du SSO et de SharePoint passent par `lib/netFetch.js` (3 essais courts). Les causes sont dans `backend/onboarding.log` (`[AUTH] SSO Microsoft …`).
- Erreur Exchange « `Remove-DelayedDelicensingInfoInMailboxTable … user wasn't found` » : bruit Microsoft, sans impact.
- `/opt/scripts/exchange.ps1` (Exchange) vit sur le VPS, hors du dépôt. Offboarding : état gardé en mémoire.
- Pour remplacer de gros blocs de code, utiliser l'outil d'édition de fichiers plutôt que `sed` ou `node -e` dans le terminal (problèmes d'échappement des guillemets et des expressions régulières déjà rencontrés).

## À savoir avant de modifier

- Ajouter une **variable d'environnement** : la lire dans le code, l'ajouter à `backend/.env.example` (commentée) et à `docs/portail-et-connexion.md`.
- Ajouter une **page** : route dans `App.jsx`, entrée dans `modules.js` (`nav` ou `adminNav`), libellé dans `ROUTE_LABELS` (`Layout.jsx`), route serveur avec `requireModule`.
- Ajouter une **migration** : fin du tableau dans `db.js`.
- Mettre à jour `docs/` quand un comportement visible change.

## Points en suspens (décisions de l'utilisateur à prendre)

- Code probablement mort : flux « script .bat + confirmation » de l'offboarding (`/confirm`, `/script`) ; invitations par lien (`/api/auth/invite/:token`, `AcceptInvite.jsx`) ; `/new/manual` sans lien de menu.
- Adresse de super admin de repli écrite en dur dans `isSuperAdmin` (server.js) : à retirer seulement après avoir défini `SUPER_ADMIN_EMAILS` sur le VPS.
- Quatre constats « High » d'un audit de sécurité antérieur ne sont pas corrigés (voir `docs/audits/`, non versionné).
- Le **code n'est pas encore poussé** : voir `git status` ; le `.env` du VPS doit être préparé avant (liste dans `docs/portail-et-connexion.md`, §9.2).
