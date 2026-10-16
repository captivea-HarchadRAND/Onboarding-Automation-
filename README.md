# Onboarding Automation : portail interne Captivea

Portail web interne qui regroupe deux modules, derrière une connexion **Microsoft** :

| Module | À quoi il sert |
|---|---|
| **Onboarding** | Créer, muter et faire partir les comptes **Microsoft 365** des employés : compte, licence, groupes SharePoint et de communication, boîtes partagées, canaux Teams, invitation GitHub |
| **Monitoring** | Suivre l'usage des licences IA (**Claude**, **ChatGPT**, **Fireflies**) : licences inutilisées, personnes à surveiller, coût |

Un **portail** d'accueil montre à chacun les modules auxquels il a accès. Le **super administrateur** gère les utilisateurs et leurs accès.

> Dépôt **interne** : il ne contient aucun secret. La configuration sensible vit uniquement dans `backend/.env` sur chaque machine.

---

## Documentation

| Pour… | Lire |
|---|---|
| **Régler à la main** ce qu'il faut (Microsoft, Exchange, SharePoint, serveur), sans connaissances techniques | [docs/guide-simplifie.md](docs/guide-simplifie.md) · [version web](docs/guide-simplifie.html) |
| **Mettre en production** : identifiants, fichier `.env`, application Microsoft de production, vérifications | [docs/guide-production.md](docs/guide-production.md) · [version web](docs/guide-production.html) |
| Toute la documentation en **pages web** (menu, mode sombre) | [docs/index.html](docs/index.html) (régénérer avec `node docs/build-html.js`) |
| Comprendre la **connexion**, les rôles, l'installation, le déploiement | [docs/portail-et-connexion.md](docs/portail-et-connexion.md) |
| Utiliser ou administrer le module **Onboarding** | [docs/onboarding.md](docs/onboarding.md) |
| Utiliser ou administrer le module **Monitoring** | [docs/monitoring.md](docs/monitoring.md) |
| **GitHub** : invitations des employés, dépôt, déploiement automatique | [docs/github.md](docs/github.md) |
| Travailler sur le code avec Claude Code | [CLAUDE.md](CLAUDE.md) |

Index complet : [docs/README.md](docs/README.md).

---

## Fonctionnalités

**Portail et sécurité**
- Connexion **Microsoft** uniquement (OpenID Connect). Un accès de secours par mot de passe existe pour les administrateurs sur `/login/backup`.
- Rôles : opérateur, administrateur, super administrateur. Accès **par module**, vérifié aussi côté serveur.
- Journal de sécurité, limites de tentatives, cookies protégés.

**Onboarding**
- Assistant en 5 étapes : identité, groupe, licence avec code de confirmation, exécution, résultat (mot de passe temporaire affiché une seule fois).
- Deux phases : création immédiate (compte, groupe, licence), puis intégration aux groupes, boîtes partagées, GitHub et Teams environ une minute plus tard.
- Annulation automatique du compte si la création échoue ; reprise au redémarrage du serveur.
- Onboarding manuel, changement de poste ou de pays, accès aux boîtes partagées, offboarding en 8 étapes.
- Administration sans code : groupes, pays et villes, domaines, affectations par poste, étapes du pipeline.

**Monitoring**
- Tableau de bord par outil et par pays, avec comparaison au mois précédent, niveaux d'usage (Utilise, Utilise peu, Pas utilisé ce mois-ci, Inactif) et coût des licences inutilisées.
- Données reçues de **n8n** ou lues dans **SharePoint** (lecture seule, droits minimaux).

---

## Architecture

```
Navigateur ─→ Nginx (HTTPS) ─→ Node.js / Express (PM2, port 8081)
                                 ├─ interface React compilée (frontend/dist)
                                 ├─ API /api/*
                                 ├─→ Microsoft Entra ID (connexion) et Microsoft Graph
                                 ├─→ Exchange Online (script PowerShell sur le serveur)
                                 ├─→ GitHub (invitations)
                                 └─ Base SQLite (sql.js) : backend/data/onboarding.db
```

| Dossier | Contenu |
|---|---|
| `backend/` | Serveur Express (`server.js`), base de données (`db.js`), modules de `lib/` |
| `frontend/` | Interface React + Vite |
| `docs/` | Documentation |
| `.github/workflows/` | Déploiement automatique |

---

## Démarrage rapide (développement)

Prérequis : Node.js 20 ou plus, Git.

```bash
git clone https://github.com/captivea-HarchadRAND/Onboarding-Automation-.git
cd Onboarding-Automation-
```

Serveur (port 8081) :

```bash
cd backend
cp .env.example .env     # puis remplir : voir docs/portail-et-connexion.md §6
npm install
npm run dev
```

Interface (port 5175), dans un autre terminal :

```bash
cd frontend
npm install
npm run dev
```

Sans identifiants Microsoft, mets `MOCK_GRAPH=true` dans `backend/.env` : tous les appels Microsoft sont simulés. Ne l'utilise jamais en production.

---

## Configuration

Tout se règle dans `backend/.env` (jamais commité). Le modèle commenté est [`backend/.env.example`](backend/.env.example) : seules les variables réellement lues par le code y figurent, avec « requis » ou « facultatif ».

Le plus important : `FRONTEND_URL`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `SUPER_ADMIN_EMAILS`, `LAUNCH_PASSWORD`.

> Pas de commentaire à la fin d'une ligne du `.env` (`PORT=8081 # texte` casserait la valeur).

---

## Déploiement

Chaque envoi sur la branche **`main`** déclenche automatiquement la mise en ligne sur le serveur : récupération du code, reconstruction de l'interface, installation des dépendances, redémarrage. Le fichier `backend/.env` du serveur n'est jamais modifié : **toute nouvelle variable doit y être ajoutée avant l'envoi**.

Avant d'envoyer du code sur `main`, parcours [docs/guide-production.md](docs/guide-production.md). Détails du fonctionnement : [docs/github.md](docs/github.md).

---

## Sécurité

- Aucun secret dans le dépôt ni dans l'interface : `backend/.env` uniquement.
- Connexion Microsoft avec PKCE et vérification du jeton ; mot de passe réservé à l'accès de secours des administrateurs.
- Requêtes SQL paramétrées, appels Exchange sans interprétation de commande, validation des entrées.
- Lecture seule sur SharePoint, avec `Sites.Selected`.

Signaler un problème de sécurité : contacter directement l'équipe IT, sans ouvrir de ticket public.
