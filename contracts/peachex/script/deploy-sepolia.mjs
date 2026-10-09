#!/usr/bin/env node
// Sepolia-only deployment and Etherscan verification for PeachEx. See ../README.md.
//
//   node --env-file=contracts/peachex/.env contracts/peachex/script/deploy-sepolia.mjs            # simulate only
//   node --env-file=contracts/peachex/.env contracts/peachex/script/deploy-sepolia.mjs --broadcast
//   node --env-file=contracts/peachex/.env contracts/peachex/script/deploy-sepolia.mjs verify
//
// Reads SEPOLIA_RPC_URL, PEACHEX_DEPLOYER_PRIVATE_KEY, TREASURY and ETHERSCAN_API_KEY from the
// environment. It never prints the key or the RPC URL. It refuses every chain except Sepolia.
// No token sale, transfer or approval is performed: the only transactions are the three deployments.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AbiCoder, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, formatEther, getAddress, getCreateAddress, keccak256 } from 'ethers';
import { compileContracts, compilerVersion, verificationInput } from '../build.mjs';

export const SEPOLIA = 11155111;
const LOCAL = 31337;
const deploymentFile = fileURLToPath(new URL('../deployments/sepolia.json', import.meta.url));
const plan = [
  { name: 'PeachEx', file: 'PeachEx.sol', args: ({ treasury }) => [treasury], types: ['address'] },
  { name: 'PeachExGenesis', file: 'PeachExGenesis.sol', args: ({ treasury, token }) => [treasury, token], types: ['address', 'address'] },
  { name: 'PeachExChronicleAnchor', file: 'PeachExChronicleAnchor.sol', args: ({ token }) => [token], types: ['address'] }
];

function required(env, key) {
  if (!env[key]) throw new Error(`Set ${key} in contracts/peachex/.env (see .env.example).`);
  return env[key];
}

export function deployerWallet(env, provider) {
  const key = required(env, 'PEACHEX_DEPLOYER_PRIVATE_KEY').trim();
  try { return new Wallet(key.startsWith('0x') ? key : '0x' + key, provider); }
  catch { throw new Error('PEACHEX_DEPLOYER_PRIVATE_KEY is not a valid private key.'); } // never echo the value
}

export function rpcProvider(url) {
  const request = new FetchRequest(url); request.timeout = 30_000;
  return new JsonRpcProvider(request, undefined, { staticNetwork: false });
}

/** Simulates (default) or broadcasts the three deployments. `allowLocal` exists for tests only. */
export async function deploy({ provider, wallet, treasury, broadcast = false, allowEoaTreasury = false, confirmations = 2, allowLocal = false, log = console.log }) {
  const { chainId } = await provider.getNetwork();
  if (!(Number(chainId) === SEPOLIA || (allowLocal && Number(chainId) === LOCAL))) {
    throw new Error(`Refusing chain ${chainId}: this script deploys to Sepolia (${SEPOLIA}) only.`);
  }
  treasury = getAddress(treasury);
  const deployer = await wallet.getAddress();
  const treasuryCode = await provider.getCode(treasury);
  if (treasuryCode === '0x' && !allowEoaTreasury) {
    throw new Error('TREASURY has no contract code. Use a Sepolia Safe, or set PEACHEX_ALLOW_EOA_TREASURY=true for a testnet-only plain address.');
  }
  const balance = await provider.getBalance(deployer);
  log(`Chain ${chainId} · deployer ${deployer} · balance ${formatEther(balance)} ETH · treasury ${treasury}${treasuryCode === '0x' ? ' (plain address)' : ' (contract)'}`);
  const artifacts = await compileContracts();
  const nonce = await provider.getTransactionCount(deployer, 'pending');
  const feeData = await provider.getFeeData();
  const token = getCreateAddress({ from: deployer, nonce });
  let gas = 0n;
  for (const [i, step] of plan.entries()) {
    const tx = await new ContractFactory(artifacts[step.name].abi, artifacts[step.name].bytecode, wallet).getDeployTransaction(...step.args({ treasury, token }));
    // Genesis and the anchor need the token's code, which only exists after step one. Bound them from
    // their size instead: 200 gas per deployed byte, calldata, the base fee and a generous constructor margin.
    gas += i === 0 ? await provider.estimateGas({ ...tx, from: deployer })
      : 53_000n + 200n * BigInt((artifacts[step.name].deployedBytecode.length - 2) / 2) + 16n * BigInt((tx.data.length - 2) / 2) + 500_000n;
  }
  const maxCost = gas * (feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n);
  log(`Estimated gas ≈ ${gas} (upper bound) · max cost ≈ ${formatEther(maxCost)} ETH`);
  if (balance < maxCost) log('Warning: the deployer balance may be too low. Get Sepolia test ETH from a faucet first.');
  if (!broadcast) { log('Simulation only. Re-run with --broadcast to deploy.'); return { simulated: true, deployer, treasury, chainId: Number(chainId) }; }

  const deployed = {};
  const record = { network: 'sepolia', chain_id: Number(chainId), deployer, treasury, compiler: compilerVersion(), evm_version: 'cancun', optimizer_runs: 200, payments_enabled: false, contracts: {} };
  for (const step of plan) {
    const args = step.args({ treasury, token: deployed.PeachEx });
    const contract = await new ContractFactory(artifacts[step.name].abi, artifacts[step.name].bytecode, wallet).deploy(...args);
    const tx = contract.deploymentTransaction();
    log(`${step.name}: sent ${tx.hash}`);
    const receipt = await tx.wait(confirmations);
    deployed[step.name] = await contract.getAddress();
    const code = await provider.getCode(deployed[step.name]);
    record.contracts[step.name] = { address: deployed[step.name], transaction: tx.hash, block: receipt.blockNumber,
      source: step.file, constructor_args: AbiCoder.defaultAbiCoder().encode(step.types, args), runtime_codehash: keccak256(code) };
    log(`${step.name}: ${deployed[step.name]} (block ${receipt.blockNumber})`);
  }
  return record;
}

/** Backend settings to paste into Render once the deployment is verified. The RPC URL stays a placeholder. */
export function backendSettings(record) {
  return [
    'PEACHEX_MODE=testnet',
    `PEACHEX_CHAIN_ID=${record.chain_id}`,
    'PEACHEX_RPC_URL=<your private HTTPS Sepolia RPC URL>',
    `PEACHEX_TOKEN_ADDRESS=${record.contracts.PeachEx.address}`,
    `PEACHEX_ANCHOR_ADDRESS=${record.contracts.PeachExChronicleAnchor.address}`,
    `PEACHEX_TOKEN_CODEHASH=${record.contracts.PeachEx.runtime_codehash}`,
    `PEACHEX_ANCHOR_CODEHASH=${record.contracts.PeachExChronicleAnchor.runtime_codehash}`,
    'PEACHEX_CONFIRMATIONS=3'
  ].join('\n');
}

/** Etherscan API v2 form fields for one contract (standard JSON input). */
export async function verificationRequest(record, name, apiKey) {
  const entry = record.contracts[name];
  return new URLSearchParams({
    apikey: apiKey, module: 'contract', action: 'verifysourcecode', codeformat: 'solidity-standard-json-input',
    sourceCode: JSON.stringify(await verificationInput()), contractaddress: entry.address,
    contractname: `${entry.source}:${name}`, compilerversion: record.compiler,
    constructorArguements: entry.constructor_args.replace(/^0x/, '') // Etherscan's field name is misspelled.
  });
}

async function etherscan(apiKey, body, query = '') {
  const response = await fetch(`https://api.etherscan.io/v2/api?chainid=${SEPOLIA}${query}`, body ? { method: 'POST', body } : {});
  return response.json();
}

export async function verifyAll(record, apiKey, log = console.log) {
  let failures = 0;
  for (const name of Object.keys(record.contracts)) {
    const submitted = await etherscan(apiKey, await verificationRequest(record, name, apiKey));
    if (submitted.status !== '1') {
      if (/already verified/i.test(submitted.result)) { log(`${name}: already verified`); continue; }
      log(`${name}: submission failed: ${submitted.result}`); failures++; continue;
    }
    let result;
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise(done => setTimeout(done, 5_000));
      result = await etherscan(apiKey, null, `&module=contract&action=checkverifystatus&guid=${encodeURIComponent(submitted.result)}&apikey=${encodeURIComponent(apiKey)}`);
      if (!/pending/i.test(result.result)) break;
    }
    const ok = result?.status === '1' || /already verified/i.test(result?.result);
    if (!ok) failures++;
    log(`${name}: ${result?.result} · https://sepolia.etherscan.io/address/${record.contracts[name].address}#code`);
  }
  return failures;
}

export async function checkOnChain(record, provider) {
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== record.chain_id) throw new Error('RPC chain does not match the deployment record.');
  for (const [name, entry] of Object.entries(record.contracts)) {
    if (keccak256(await provider.getCode(entry.address)) !== entry.runtime_codehash) throw new Error(`${name}: on-chain code does not match the recorded fingerprint.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env, args = process.argv.slice(2);
  try {
    if (args[0] === 'verify') {
      const record = JSON.parse(await readFile(deploymentFile, 'utf8'));
      const provider = rpcProvider(required(env, 'SEPOLIA_RPC_URL'));
      await checkOnChain(record, provider);
      console.log('On-chain runtime code matches the recorded fingerprints.');
      const failures = await verifyAll(record, required(env, 'ETHERSCAN_API_KEY'));
      provider.destroy();
      process.exit(failures ? 1 : 0);
    }
    const provider = rpcProvider(required(env, 'SEPOLIA_RPC_URL'));
    const record = await deploy({ provider, wallet: deployerWallet(env, provider), treasury: required(env, 'TREASURY'),
      broadcast: args.includes('--broadcast'), allowEoaTreasury: env.PEACHEX_ALLOW_EOA_TREASURY === 'true' });
    if (!record.simulated) {
      await mkdir(resolve(deploymentFile, '..'), { recursive: true });
      await writeFile(deploymentFile, JSON.stringify(record, null, 2) + '\n');
      console.log(`\nSaved ${deploymentFile}\nNext: run with "verify", then configure the backend with:\n\n${backendSettings(record)}`);
    }
    provider.destroy();
  } catch (error) {
    console.error(error.shortMessage || error.message);
    process.exit(1);
  }
}
