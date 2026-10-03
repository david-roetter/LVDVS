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

Artifacts are generated in `contracts/peachex/out/` and excluded from Git. Tests compile the actual Solidity, deploy all three contracts to an isolated local Anvil chain, exercise transfers, burns, permit/replay protection, Genesis metadata, monotonic anchoring, and authenticated Ludus HTTP receipt verification. They also check code fingerprint mismatches, confirmations, unrelated receipts and dry-run exports. These tests send no public-chain transactions. The older Foundry unit tests are retained but are not part of `npm test`.

## Optional Sepolia deployment

Deployment is a separate wallet action. Choose and verify a treasury (for example, a Safe on Sepolia with ERC-721 receiver support), retain its control credentials privately, and fund the deployment account with testnet ETH. The script permits Sepolia (11155111) and local development (31337) only. Outside a local chain, the treasury must already contain contract code. It receives the entire initial token supply and Genesis NFT.

The Foundry deployment script uses `forge-std`; install the dependencies in this directory if using Forge:

```sh
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0
forge install foundry-rs/forge-std@v1.9.7
```

Set `SEPOLIA_RPC_URL` and `TREASURY` privately. Use an encrypted Foundry account or hardware wallet; never put a private key in source, environment examples, shell arguments or screenshots. First simulate (without `--broadcast`):

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url "$SEPOLIA_RPC_URL" --account peachex-deployer --sender <deployment-account-address>
```

Review the treasury, chain, simulation and contract addresses before explicitly broadcasting that same script with `--broadcast`. This repository does not broadcast automatically. Verify all deployed source contracts in the explorer using the pinned settings. Check the deployment log's token, Genesis and anchor addresses against receipts and the explorer.

Record **keccak256 of the actual deployed runtime bytecode** for token and anchor after confirming their addresses and constructor values. Constructor immutables mean a generic compiler artifact hash is insufficient. The script prints these fingerprints after simulation/broadcast; confirm them against `eth_getCode` from the actual network. Do not copy local simulation addresses or hashes into production configuration.

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
