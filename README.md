# LVDVS · Ludus Chronicle 2.2

Playable Chronicle backend and browser UI, plus the RoetterRobitics.com company site and PeachEx status page. The game records signed events, verifies encounters, and stores sessions on the server. Provider keys stay on the backend.

## Run locally

Node.js 24 is required. There are no external runtime packages.

```sh
git clone https://github.com/david-roetter/LVDVS.git
cd LVDVS
npm test
npm start
```

Open http://localhost:3000 to create a session, recruit gladiators, run encounters, replay and verify the Chronicle, export it, and manage the recovery code. Local state and signing keys are stored in `backend/data/`, which is excluded from Git.

## Company site

```sh
npm run build
```

Output is `public/`. It includes the bilingual homepage, `/ludus/`, `/peachex/`, Tidal demo, legal pages, public integration settings, and a build manifest with source hashes and the deployed revision.

The Ludus link continues to https://ludus-chronicle.onrender.com/. Keeping that origin preserves existing browser recovery codes and game sessions. The company-site migration does not restart or replace the live game.

See [sites/company/README.md](sites/company/README.md) for the existing production hub's source settings. `render.yaml` defines a separate static preview; applying it does not switch the production domain.

## Production backend

The Docker image uses Node 24 and includes the playable browser UI. Mount persistent storage at `/data`; production requires `LUDUS_DATA_DIR`. Preserve both session files and `signing-key.pem` when migrating. See [FLY_DEPLOY.md](FLY_DEPLOY.md) for optional Fly.io hosting. Keep the existing Render game until its storage and origin migration have been planned.

AI is optional and disabled by default. To enable it, choose `gemini` or `gwdg`, configure that provider's server secrets, set `LUDUS_AI_ENABLED=true`, and provide `LUDUS_AI_ACCESS_TOKEN`. The ordinary game UI does not need provider credentials. `/api/admin/backup` requires a separate `LUDUS_BACKUP_TOKEN`; its response contains the signing key and must remain private.

## PeachEx

Payments remain disabled. No verified deployed token address, chain, merchant address, or checkout prices have been configured. The status page does not request wallet access. Chronicle commitments are dry runs and are not broadcast on a blockchain.

## Source history

Copied from `davidjmercedesr-hub/Ludus` main at `7aeec95d5b4169f339547f74329476e761e58d90`, then updated with the recovered Chronicle 2.2 backend and publicly served browser UI. Company-site source comes from `david-roetter/ludus` main at `a814ca163f52a0592d43f1faeea2fcfd4321aceb` (PR #4). The separate Flutter season prototype remains in that repository's `codex/playable-flutter-2026-09-30` branch.
