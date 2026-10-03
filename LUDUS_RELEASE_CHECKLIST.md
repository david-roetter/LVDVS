# Ludus 2.2 release checks

- Run `npm test` and `npm run build` using Node 24.
- Open the game UI; create two gladiators, resolve an encounter, replay it, and verify the signed Chronicle.
- Verify repeated encounter requests with the same request ID do not duplicate events.
- Reconnect with the recovery code; rotate it and verify the old code is rejected.
- Export the Chronicle. Verify malformed or modified histories fail verification.
- Preserve the signing key and all session files when restarting or migrating a backend. Use persistent storage in production.
- Keep AI disabled unless its provider and server access token are configured. No client bundle may contain provider or backup credentials.
- Check the bilingual company homepage, legal pages, Tidal demo, `/peachex/`, and `/ludus/`. The latter must still open the existing live Chronicle origin.
- Confirm `build-info.json` matches the deployed commit and file hashes.
- Keep PeachEx payments disabled until the chain, deployed token, recipient, pricing and server verification are established.

Publishing a source repository or preview does not switch `roetterrobitics.com`. Update the existing hub's source settings as described in [sites/company/README.md](sites/company/README.md) and then verify the production domain.
