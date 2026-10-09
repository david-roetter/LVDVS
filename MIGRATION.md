# Migrating ludus-chronicle to durable storage

**Why:** `ludus-chronicle` runs on Render's free plan, which has no disk. Session files in `LUDUS_DATA_DIR` and a file-based `signing-key.pem` are lost on every redeploy, restart or spin-down. Without the signing key, every existing Chronicle fails verification.

**Target:** the same service, `ludus-chronicle`, with the same URL (https://ludus-chronicle.onrender.com/). It runs on a paid Starter instance with a 1 GB disk mounted at `/data`, and the signing key comes from the `LUDUS_SIGNING_KEY` environment variable. Players' recovery codes depend on that URL. **Upgrade the existing service in place.** A new service would get a different `*.onrender.com` URL.

Cost: Starter is $7/month and disks cost about $0.25/GB/month, so about **$7.25/month** for 1 GB. Check the price Render shows before confirming. Workspace plan fees, if any, are extra.

## What the code does now

- `LUDUS_DATA_DIR` sets where session files live. Production refuses to start without it.
- `LUDUS_SIGNING_KEY` is an Ed25519 private key, given either as PEM or as single-line base64 of the PEM. When it is set, the key is never written to disk. If a `signing-key.pem` with a *different* key exists in the data directory, the server refuses to start.
- `LUDUS_REQUIRE_SIGNING_KEY=true` makes the server refuse to start instead of silently generating a new key.
- `GET /ready` returns `signing_key.source` (`environment` or `file`) and a 16-hex public-key `fingerprint`. Use these to confirm the key survived.
- `backend/scripts/backup-tool.mjs` has three subcommands:
  - `verify` checks a backup file.
  - `signing-key` prints the key as base64.
  - `restore` writes the Chronicles into `LUDUS_DATA_DIR`. It never overwrites a different file and refuses a key mismatch or a tampered Chronicle.

## 0. Check first (nothing changes yet)

1. In the Render dashboard, open `ludus-chronicle` → **Settings** and note the repository, branch, root directory, build/start commands and region.
2. Run `curl -s -o /dev/null -w "%{http_code}\n" https://ludus-chronicle.onrender.com/api/admin/backup`. A `401` means the endpoint exists. A `404` means the live code predates it.
3. Check whether `LUDUS_BACKUP_TOKEN` is already set on the service.

> **Important:** on the free plan, *any* env-var change, deploy or restart wipes the current data. If `LUDUS_BACKUP_TOKEN` is not already live, you cannot take a backup without losing the data you are trying to back up. The data is also already being wiped at every spin-down, after about 15 minutes idle. In that case, skip step 1, accept a fresh start, and tell players that old recovery codes will not work.

## 1. Backup (only if the token is already live)

Run this on your own computer. Keep the instance awake by doing it right after a request.

```sh
curl -fsS https://ludus-chronicle.onrender.com/ready
curl -fsS -H "Authorization: Bearer $LUDUS_BACKUP_TOKEN" \
  https://ludus-chronicle.onrender.com/api/admin/backup -o ludus-backup.json
node backend/scripts/backup-tool.mjs verify ludus-backup.json
```

`verify` prints the number of Chronicles and the key fingerprint, which should match `/ready`. **The backup contains the private signing key and player data.** Store it encrypted, outside Git, and never paste it into chat.

## 2. Switchover (Render dashboard, existing `ludus-chronicle` service)

1. **Signing key.** Run `node backend/scripts/backup-tool.mjs signing-key ludus-backup.json`. If you have no backup, generate a key instead: `node -e "const k=require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});console.log(Buffer.from(k).toString('base64'))"`. Paste the output into the env var `LUDUS_SIGNING_KEY`. Also keep a copy in your password manager. It is the only copy outside Render.
2. **Env vars.** Set these with **Save only** (no deploy yet):
   - `NODE_ENV=production`
   - `NODE_VERSION=24`
   - `LUDUS_DATA_DIR=/data`
   - `LUDUS_REQUIRE_SIGNING_KEY=true`
   - `LUDUS_SIGNING_KEY` (from item 1)
   - `LUDUS_BACKUP_TOKEN`: a new long random value that you choose
   - `LUDUS_AI_ENABLED=false`
   - `PEACHEX_MODE=disabled`
3. **Source.** If the service does not already build from this repo, set **Repository** `david-roetter/LVDVS`, **Branch** `main` (or `durable-data-peachex` before it is merged), **Root Directory** `backend`, **Build** `npm ci --omit=dev`, **Start** `npm start`, **Health check** `/ready`. Set **Auto-Deploy** to *Off* so merges to `main` do not redeploy the live game.
4. **Instance type.** Change it to **Starter** (paid).
5. **Disk.** Open **Disks** → **Add disk**: name `ludus-data`, mount path `/data`, size `1 GB`. Render redeploys. Note that services with a disk have a few seconds of downtime per deploy and cannot scale beyond one instance.
6. **Restore** (only if you have a backup). Copy `ludus-backup.json` to the instance's `/tmp`. Use `scp -s` after setting up SSH for the service, or `wormhole send` / `wormhole receive` from the service's **Shell** page. Then run in the Shell:

   ```sh
   cd backend 2>/dev/null || true
   node scripts/backup-tool.mjs restore /tmp/ludus-backup.json --dry-run
   node scripts/backup-tool.mjs restore /tmp/ludus-backup.json --write-key-file
   rm /tmp/ludus-backup.json
   ```

   `--write-key-file` also stores the same key as `/data/signing-key.pem`, so a rollback to older code still verifies Chronicles.
7. **Verify.**
   - `curl https://ludus-chronicle.onrender.com/ready` should show `"source":"environment"` and the same fingerprint as `verify`.
   - Reconnect with a known recovery code.
   - **Restart** the service (Manual Deploy → Restart), then check that the fingerprint and the session are unchanged.
8. Update the README's "Production backend" section and `sites/company/README.md` if anything differs from the above.

## Rollback

- **Bad deploy:** in **Events**, roll back to the previous deploy. The disk and its data stay. Code from before this change reads `/data/signing-key.pem`, which is why step 6 writes it. If you skipped the restore, run `restore` with `--write-key-file` (or put the key file there) before rolling back. Otherwise the old code generates a new key.
- **Bad data on the disk:** **Disks** → restore a snapshot. Render snapshots daily and keeps snapshots for at least 7 days. Changes made after the snapshot are lost. Alternatively, restore again from `ludus-backup.json` into an empty `/data`.
- **Back to free:** take a backup first (step 1). Then remove the disk, which **permanently deletes it**, and change the instance type to Free. Data is then ephemeral again, as it was before.
- **Signing key mismatch on start:** the server logs `LUDUS_SIGNING_KEY does not match …`. Do not delete the key file. Set `LUDUS_SIGNING_KEY` to the key that signed the existing Chronicles (from the backup) and redeploy.
