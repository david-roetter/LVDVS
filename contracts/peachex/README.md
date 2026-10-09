# PeachEx · PCHX and Ludus Chronicle

Source and local EVM tests are ready. **There is no verified public deployment and no token sale.** Ludus requires neither a wallet nor PCHX. This code has automated tests, not an independent security audit.

## Contracts

- `PeachEx`: ERC-20, 18 decimals, 100,000,000 PCHX minted once to a nonzero treasury. Holders can burn tokens, so circulating/total supply can decrease. EIP-2612 permit is available. There is no administrator, later mint, pause, blacklist or upgrade mechanism.
- `PeachExGenesis`: one transferable ERC-721, token ID 1, initially sent to the treasury with a safe mint. Metadata and peach artwork are generated on-chain. The treasury must accept ERC-721 safe transfers.
- `PeachExChronicleAnchor`: references the PCHX contract and records a Chronicle hash and increasing event index per publisher and Chronicle ID. It requests no PCHX transfer, allowance or balance. A hash anchor is a publisher's claim; it proves neither wallet ownership for a game account nor game fairness.

Solidity 0.8.30, Cancun EVM and optimizer (200 runs) are pinned. OpenZeppelin 5.7.0, ethers 6.17.0 and the local Anvil test node 1.7.1 are pinned in the root lockfile.

## Build and verify locally

From the repository root, with Node 24:

```sh
npm ci
npm --prefix backend ci
npm test
npm run build:contracts
```

Artifacts are generated in `contracts/peachex/out/` and excluded from Git. `test/deploy.test.mjs` runs the Sepolia deploy script against local chains: simulation sends nothing, non-Sepolia chains are refused, the Etherscan input recompiles to identical bytecode, and the script and backend contain no transfer/approval calls. Tests compile the actual Solidity, deploy all three contracts to an isolated local Anvil chain, exercise transfers, burns, permit/replay protection, Genesis metadata, monotonic anchoring, and authenticated Ludus HTTP receipt verification. They also check code fingerprint mismatches, confirmations, unrelated receipts and dry-run exports. These tests send no public-chain transactions. The older Foundry unit tests are retained but are not part of `npm test`.

## Optional Sepolia deployment

Scope: signed Chronicle proofs plus optional **testnet** anchoring. Payments remain disabled. There is no token sale, and the script sends no transfer, approval or permit transaction. Its only transactions are the three contract deployments.

Deployment is a separate wallet action that you run on your own machine. The script `script/deploy-sepolia.mjs`:
- uses the same pinned compiler settings as the tests;
- refuses every chain except Sepolia (11155111);
- only simulates unless `--broadcast` is passed;
- never prints the key or the RPC URL.

### What you need (you do these yourself)

1. **A fresh deployer account used only for testnets.** Create a new account in your wallet and export its private key only into the local `.env` file below. Never reuse a key that holds mainnet funds. Never paste it into chat, an issue, a screenshot or a shell command.
2. **Sepolia test ETH** for that account from a Sepolia faucet. Deploying all three contracts costs a few million gas, and the simulation prints an upper bound.
3. **An RPC URL**, for example a free Alchemy/Infura/QuickNode Sepolia HTTPS endpoint. Treat it as private.
4. **A treasury address.** It receives the whole initial PCHX supply and Genesis #1. A Sepolia Safe is preferred. For a plain address, set `PEACHEX_ALLOW_EOA_TREASURY=true`.
5. **An Etherscan API key** (free, API v2) for source verification.

### Steps

From the repository root, with Node 24, run `npm ci`. On Windows, run `npm ci --ignore-scripts`, then `TARGET_TOOL=anvil node node_modules/@foundry-rs/anvil/postinstall.mjs` in Git Bash.

```sh
cp contracts/peachex/.env.example contracts/peachex/.env   # then fill it in with an editor
npm test                                                   # local tests only, no public chain

# 1. Simulate: checks chain, balance, treasury and estimated cost. Sends nothing.
node --env-file=contracts/peachex/.env contracts/peachex/script/deploy-sepolia.mjs

# 2. Deploy. Writes contracts/peachex/deployments/sepolia.json and prints the backend settings.
node --env-file=contracts/peachex/.env contracts/peachex/script/deploy-sepolia.mjs --broadcast

# 3. Verify source on Etherscan. It first re-checks on-chain code against the recorded fingerprints.
node --env-file=contracts/peachex/.env contracts/peachex/script/deploy-sepolia.mjs verify
```

Check the token, Genesis and anchor addresses on https://sepolia.etherscan.io against `deployments/sepolia.json`. The **runtime code fingerprints** in that file are keccak256 of the code actually deployed (`eth_getCode`). Constructor immutables make a compiler-artifact hash insufficient. You can commit `deployments/sepolia.json`: it holds only public addresses, hashes and constructor arguments. Afterwards, delete the key from `.env` or empty the deployer account.

The older Foundry script `script/Deploy.s.sol` remains as an alternative (`forge script ... --account <encrypted keystore>`, simulate first, then `--broadcast`). It needs `forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 foundry-rs/forge-std@v1.9.7`.

## Enable the optional integration

Configure backend secrets/settings only after verifying the deployment:

```text
PEACHEX_MODE=testnet
PEACHEX_CHAIN_ID=11155111
PEACHEX_RPC_URL=<HTTPS Sepolia RPC URL>
PEACHEX_TOKEN_ADDRESS=<verified PCHX contract>
PEACHEX_ANCHOR_ADDRESS=<verified Chronicle anchor>
PEACHEX_TOKEN_CODEHASH=<0x-prefixed keccak256 of deployed token code>
PEACHEX_ANCHOR_CODEHASH=<0x-prefixed keccak256 of deployed anchor code>
PEACHEX_CONFIRMATIONS=3
```

The backend checks the actual RPC chain, both code fingerprints, token name/symbol/decimals/issuer/supply cap and the anchor's token reference. Mainnet and incomplete or invalid settings do not enable wallet transactions. RPC URLs remain private. A valid configuration whose RPC/code validation fails returns an unavailable error rather than a transaction.

`GET /api/peachex/status` exposes only public status. The authenticated game endpoints `/api/game/peachex/prepare`, `/balance` and `/verify` prepare an unsigned zero-value anchor call, read a public PCHX balance, and check a confirmed receipt against the signed Chronicle. The receipt must include the expected event from the configured anchor, a matching Chronicle hash, a canonical block and sufficient confirmations. Smart-wallet relayed calls are accepted through the emitted publisher field; ownership is not inferred.

The browser asks for wallet access only when a player chooses to publish a configured testnet proof. It checks the selected chain and requests wallet confirmation. Backend services never hold a wallet key or broadcast a transaction. The game works if users decline.

## Proof export and privacy

With the default `PEACHEX_MODE=disabled`, the PeachEx tab exports a signed Chronicle event and public signing key as JSON with `transaction: null` and `broadcast: false`. This is an offline proof, not a blockchain receipt. The export contains private game-event details; share deliberately. It excludes the recovery code and signing private key.

If a player later publishes, only the Chronicle identifier, event index and hash enter the anchor transaction. Repeated identifiers can link events publicly. Signature verification relies on trusting the game's signing public key; preserve and independently identify it. Existing replay and encounter verification remain independent of AI and blockchain availability.

The separate Render integration preview uses `LUDUS_DEMO=true`, disabled blockchain mode and temporary storage. Its sessions and signing key may reset on redeploy. Keep real recovery codes and game sessions on the existing game origin until a persistent-storage migration has been completed.
