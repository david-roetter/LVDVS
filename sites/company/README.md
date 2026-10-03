# RoetterRobitics.com integration

This directory preserves the current production homepage, contact details, offers, Stripe link, legal pages and Tidal demo.

The homepage links to `/ludus/` and `/peachex/`. The Ludus route opens the existing Chronicle 2.2 server, keeping recovery codes and browser storage on their current origin. It does not create a second game backend. The homepage copy describes the deployed Chronicle game instead of the separate Flutter season prototype.

PeachEx has a dedicated bilingual status page and public `integrations.json`. Payments stay disabled: no verified chain, deployed token contract or merchant address has been supplied. The page does not ask for wallet access or transactions. Existing Stripe bookings remain available.

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

## Remaining payment setup

Before implementing PeachEx checkout, establish the intended chain, verified deployed token address, merchant address, product amounts and a server-verified confirmation flow. Do not infer a deployed contract from the Solidity source or a wallet transaction reported only by a browser.
