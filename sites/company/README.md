# RoetterRobitics.com integration

This directory preserves the current production homepage, contact details, offers, Stripe link, legal pages and Tidal demo.

The homepage links to `/ludus/` and `/peachex/`. The Ludus route opens the existing Chronicle 2.2 server, keeping recovery codes and browser storage on their current origin. The PeachEx preview is a separate temporary game backend, explicitly labelled as a demo. Existing recovery codes stay on the original game server. The homepage copy describes the deployed Chronicle game instead of the separate Flutter season prototype.

PeachEx has a dedicated bilingual status page and public `integrations.json`. Token sales and payments stay disabled. The contracts and optional proof/balance integration are tested locally; no verified public-chain deployment is configured. The page does not ask for wallet access or transactions. Existing Stripe bookings remain available.

## Render

- Repository: `https://github.com/david-roetter/LVDVS`
- Branch: `main`
- Build command: `node sites/company/build.mjs`
- Publish directory: `public`
- Existing production hub: `srv-davr8kbncjis73ff9iog`
- Existing domain: `roetterrobitics.com`

Update the existing production service's source and build settings rather than creating another game service. Retain its custom domains, redirects and other settings. The build now uses versioned source files instead of environment-variable source bundles.

## Verify

Build from the repository root. Check home, German/English language controls, `/peachex/`, `/tidal/`, legal pages and `/ludus/` (which forwards to the existing backend). Confirm `build-info.json` reports the deployed Git commit.

## Existing production deployment adapter

The production hub still builds six files from `F_INDEX`, `F_CSS`, `F_IMPRESSUM`, `F_DATENSCHUTZ`, `F_ROBOTS`, `F_FAVICON` and `F_HASHES`. The Render integration can update these values without requiring the blocked dashboard login. `render-legacy.mjs` prepares the supported environment payload from the versioned site source, adapting Ludus and PeachEx links to the actual service URLs because that build does not generate those subdirectories.

```sh
COMPANY_SOURCE_REVISION=$(git rev-parse HEAD) node sites/company/render-legacy.mjs > /tmp/company-render-payload.json
```

Merge these seven values into the existing static service environment; do not replace the whole environment. Existing Tidal checksum settings and custom domains remain on that service. Its auto-deploy is disabled, so trigger a deployment after updating the values. Check the deployed homepage revision marker, all six file hashes, the Ludus/PeachEx links, language controls and `/tidal/`. This adapter publishes working links on the existing domain; it does not migrate the service repository or create local `/ludus/` and `/peachex/` routes there.

The captured previous public homepage is in `legacy/production-before-2026-10-04.html`. Use `node sites/company/render-legacy.mjs --rollback` to prepare the previous homepage with the unchanged supporting files if a rollback is needed. No deployment happens when running the generator.

## Public PeachEx deployment

See [../../contracts/peachex/README.md](../../contracts/peachex/README.md) for the wallet action, Sepolia treasury, verified addresses and runtime code fingerprints needed to enable optional anchoring. The preview currently exports offline signed proofs only. No checkout or token sale is implemented.
