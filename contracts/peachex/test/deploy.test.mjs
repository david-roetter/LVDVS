import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { FetchRequest, HDNodeWallet, Interface, JsonRpcProvider, Wallet } from 'ethers';
import { compileContracts, verificationInput } from '../build.mjs';
import { backendSettings, checkOnChain, deploy, deployerWallet, verificationRequest } from '../script/deploy-sepolia.mjs';
import { ANCHOR_ABI, TOKEN_ABI, PeachExIntegration } from '../../../backend/src/integrations/peachex.js';

// Anvil's public development mnemonic. These accounts exist only on the throwaway local chain.
const anvilAccount = (index) => HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, `m/44'/60'/0'/0/${index}`);

async function localChain(t, chainId = 31337) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const binary = fileURLToPath(new URL('../../../node_modules/@foundry-rs/anvil/bin.mjs', import.meta.url));
  const child = spawn(process.execPath, [binary, '--silent', '--host', '127.0.0.1', '--port', String(port), '--hardfork', 'cancun', '--accounts', '3', '--chain-id', String(chainId)], { stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const rpc = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(200) });
      if (Number((await response.json()).result) === chainId) break;
    } catch {}
    if (i === 49) throw new Error('Local Anvil test node did not start.');
    await delay(100);
  }
  const request = new FetchRequest(rpc); request.timeout = 3_000;
  const provider = new JsonRpcProvider(request, { name: 'local-test', chainId }, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 50 });
  t.after(() => provider.destroy());
  return { provider, rpc };
}

test('standard JSON input for Etherscan recompiles to the exact tested bytecode', { timeout: 120_000 }, async () => {
  const artifacts = await compileContracts();
  const input = await verificationInput();
  assert.ok(Object.keys(input.sources).some(name => name.startsWith('@openzeppelin/contracts/')));
  const output = JSON.parse(solc.compile(JSON.stringify(input))); // no import callback: every source must be inlined
  assert.deepEqual((output.errors || []).filter(e => e.severity === 'error'), []);
  for (const [file, name] of [['PeachEx.sol', 'PeachEx'], ['PeachExGenesis.sol', 'PeachExGenesis'], ['PeachExChronicleAnchor.sol', 'PeachExChronicleAnchor']]) {
    assert.equal('0x' + output.contracts[file][name].evm.deployedBytecode.object, artifacts[name].deployedBytecode, name);
  }
});

test('deploy script simulates by default, deploys on request, and output configures the backend', { timeout: 120_000 }, async (t) => {
  const { provider, rpc } = await localChain(t);
  const wallet = anvilAccount(0).connect(provider), treasury = anvilAccount(1).address;
  const quiet = () => {};
  await assert.rejects(deploy({ provider, wallet, treasury, allowLocal: true, log: quiet }), /no contract code/);

  const simulated = await deploy({ provider, wallet, treasury, allowEoaTreasury: true, allowLocal: true, log: quiet });
  assert.equal(simulated.simulated, true);
  assert.equal(await provider.getTransactionCount(wallet.address), 0, 'simulation sends no transaction');

  const record = await deploy({ provider, wallet, treasury, broadcast: true, allowEoaTreasury: true, allowLocal: true, confirmations: 1, log: quiet });
  assert.equal(await provider.getTransactionCount(wallet.address), 3, 'exactly three deployments, nothing else');
  assert.equal(record.payments_enabled, false);
  assert.equal(JSON.stringify(record).includes(wallet.privateKey.slice(2)), false);
  await checkOnChain(record, provider);

  const settings = Object.fromEntries(backendSettings(record).split('\n').map(line => line.split('=')));
  assert.match(settings.PEACHEX_RPC_URL, /^</, 'the private RPC URL is never written out');
  const status = await new PeachExIntegration({ ...settings, PEACHEX_RPC_URL: rpc, PEACHEX_CONFIRMATIONS: '1' }).status();
  assert.equal(status.status, 'verified');
  assert.equal(status.payments_enabled, false);
  assert.equal(status.token_sales, false);

  const form = await verificationRequest(record, 'PeachExGenesis', 'test-key');
  assert.equal(form.get('contractname'), 'PeachExGenesis.sol:PeachExGenesis');
  assert.match(form.get('compilerversion'), /^v0\.8\.30\+commit\.[0-9a-f]{8}$/);
  assert.match(form.get('constructorArguements'), /^[0-9a-f]{128}$/);
});

test('deploy script refuses any chain other than Sepolia', { timeout: 60_000 }, async (t) => {
  const { provider } = await localChain(t, 1);
  const wallet = anvilAccount(0).connect(provider);
  await assert.rejects(deploy({ provider, wallet, treasury: anvilAccount(1).address, allowEoaTreasury: true, allowLocal: true, log: () => {} }), /Sepolia \(11155111\) only/);
  assert.equal(await provider.getTransactionCount(wallet.address), 0);
});

test('an invalid deployer key is rejected without echoing it', () => {
  const secret = 'not-a-key-but-could-be-sensitive';
  assert.throws(() => deployerWallet({ PEACHEX_DEPLOYER_PRIVATE_KEY: secret }), (error) => !error.message.includes(secret));
  assert.throws(() => deployerWallet({}), /PEACHEX_DEPLOYER_PRIVATE_KEY/);
  assert.ok(deployerWallet({ PEACHEX_DEPLOYER_PRIVATE_KEY: Wallet.createRandom().privateKey.slice(2) }));
});

test('no sale, transfer or approval paths: backend and deploy script only use read calls and anchor()', async () => {
  const writable = (abi) => new Interface(abi).fragments.filter(f => f.type === 'function' && !['view', 'pure'].includes(f.stateMutability)).map(f => f.name);
  assert.deepEqual(writable(TOKEN_ABI), []);
  assert.deepEqual(writable(ANCHOR_ABI), ['anchor']);
  const artifacts = await compileContracts();
  assert.deepEqual(writable(artifacts.PeachExChronicleAnchor.abi), ['anchor']);
  const sources = [await readFile(new URL('../script/deploy-sepolia.mjs', import.meta.url), 'utf8'), await readFile(new URL('../../../backend/src/integrations/peachex.js', import.meta.url), 'utf8')].join('\n');
  assert.doesNotMatch(sources, /\.(transfer|transferFrom|approve|permit|safeTransferFrom)\s*\(|['"](transfer|approve)['"]/);
});
