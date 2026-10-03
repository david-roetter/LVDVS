# Optional Fly.io backend deployment

The company site uses the existing Render Chronicle origin. These instructions are for a separately planned backend deployment, not the company-site cutover.

Use a unique app name in `fly.toml`, sign in with `fly auth login`, then run from the repository root:

```sh
fly launch --no-deploy
fly volumes create ludus_data --region iad --size 1
fly deploy
```

The Docker image includes the browser UI. `/ready` checks persistent storage, while `/health` reports optional AI configuration. The game works without AI. Keep one application instance for this file-based store.

To enable AI, configure the selected provider's credentials and `LUDUS_AI_ACCESS_TOKEN` through Fly secrets, set `LUDUS_AI_PROVIDER`, and enable `LUDUS_AI_ENABLED`. See `backend/.env.example` for variable names. Never put secrets in the image or frontend.

Before any migration, back up all session JSON files and `signing-key.pem`. Recovery codes stored in the old browser origin are not automatically carried to a different origin. Preserve the existing backend until the migration is verified.

Verify the deployed root opens the game, `/ready` reports available storage, and a test Chronicle remains after a restart. Treat the backup API output as private: it contains the signing key. See [LUDUS_RELEASE_CHECKLIST.md](LUDUS_RELEASE_CHECKLIST.md).
