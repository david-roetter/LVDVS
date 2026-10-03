import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, FetchRequest, JsonRpcProvider, Signature, ZeroAddress, id, keccak256, parseEther } from 'ethers';
import { compileContracts } from '../build.mjs';
import { PeachExIntegration } from '../../../backend/src/integrations/peachex.js';
import { GameStore } from '../../../backend/src/game/store.js';

async function localChain(t) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const binary = fileURLToPath(new URL('../../../node_modules/@foundry-rs/anvil/bin.mjs', import.meta.url));
  const child = spawn(process.execPath, [binary, '--silent', '--host', '127.0.0.1', '--port', String(port), '--hardfork', 'cancun', '--accounts', '3'], { stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const rpc = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}), signal: AbortSignal.timeout(200) });
      if ((await response.json()).result === '0x7a69') break;
    } catch {}
    if (i === 49) throw new Error('Local Anvil test node did not start.');
    await delay(100);
  }
  const request = new FetchRequest(rpc); request.timeout = 3_000;
  const provider = new JsonRpcProvider(request, {name:'local-test',chainId:31337}, {staticNetwork:true,cacheTimeout:-1});
  t.after(() => provider.destroy());
  return { provider, rpc };
}

test('compiled PCHX, Genesis and Chronicle integration work on a local Cancun EVM', {timeout:120_000}, async (t) => {
  const artifacts = await compileContracts();
  const {provider,rpc} = await localChain(t);
  const treasury = await provider.getSigner(0), alice = await provider.getSigner(1);
  const treasuryAddress = await treasury.getAddress(), aliceAddress = await alice.getAddress();
  const deploy = async (name,args) => {
    const artifact = artifacts[name];
    const contract = await new ContractFactory(artifact.abi,artifact.bytecode,treasury).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const token = await deploy('PeachEx',[treasuryAddress]);
  const tokenAddress = await token.getAddress();
  const genesis = await deploy('PeachExGenesis',[treasuryAddress,tokenAddress]);
  const anchor = await deploy('PeachExChronicleAnchor',[tokenAddress]);
  const anchorAddress = await anchor.getAddress();

  await t.test('token cap, transfers, burning, permit and immutable Genesis metadata', async () => {
    assert.equal(await token.totalSupply(),parseEther('100000000'));
    assert.equal(await token.balanceOf(treasuryAddress),parseEther('100000000'));
    assert.equal(await token.symbol(),'PCHX'); assert.equal(await token.decimals(),18n);
    assert.equal(await token.ISSUER(),'Rötter Robotics');
    await (await token.transfer(aliceAddress,parseEther('25'))).wait();
    await (await token.connect(alice).burn(parseEther('4'))).wait();
    assert.equal(await token.balanceOf(aliceAddress),parseEther('21'));
    assert.equal(await token.totalSupply(),parseEther('99999996'));
    const deadline = BigInt((await provider.getBlock('latest')).timestamp) + 3600n;
    const values = {owner:treasuryAddress,spender:aliceAddress,value:123n,nonce:0n,deadline};
    const signature = Signature.from(await treasury.signTypedData({name:'PeachEx',version:'1',chainId:31337,verifyingContract:tokenAddress},
      {Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},values));
    await (await token.permit(values.owner,values.spender,values.value,deadline,signature.v,signature.r,signature.s)).wait();
    assert.equal(await token.allowance(treasuryAddress,aliceAddress),123n);
    assert.equal(await token.nonces(treasuryAddress),1n);
    await assert.rejects(token.permit.staticCall(values.owner,values.spender,values.value,deadline,signature.v,signature.r,signature.s));
    await assert.rejects(token.permit.staticCall(values.owner,values.spender,values.value,0,signature.v,signature.r,signature.s));
    assert.equal(await genesis.ownerOf(1),treasuryAddress);
    assert.equal(await genesis.balanceOf(treasuryAddress),1n);
    assert.equal(await genesis.token(),tokenAddress);
    const metadata = JSON.parse(Buffer.from((await genesis.tokenURI(1)).split(',')[1],'base64').toString());
    assert.equal(metadata.name,'PeachEx Genesis #1');
    assert.match(metadata.image,/^data:image\/svg\+xml;base64,/);
    const contractMetadata = JSON.parse(Buffer.from((await token.contractURI()).split(',')[1],'base64').toString());
    assert.equal(contractMetadata.symbol,'PCHX'); assert.equal(contractMetadata.issuer,'Rötter Robotics');
    await assert.rejects(genesis.tokenURI(2));
    await assert.rejects(new ContractFactory(artifacts.PeachEx.abi,artifacts.PeachEx.bytecode,treasury).deploy(ZeroAddress));
    await assert.rejects(new ContractFactory(artifacts.PeachExGenesis.abi,artifacts.PeachExGenesis.bytecode,treasury).deploy(ZeroAddress,tokenAddress));
    for (const name of ['PeachEx','PeachExGenesis','PeachExChronicleAnchor']) {
      const methods = artifacts[name].abi.filter(entry=>entry.type==='function').map(entry=>entry.name);
      for (const absent of ['mint','owner','pause','blacklist','upgradeTo']) assert.equal(methods.includes(absent),false);
    }
  });

  const directory = await mkdtemp(join(tmpdir(),'peachex-game-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const store = new GameStore(directory), created = await store.createSession();
  const state = await store.createGladiator(created.token,{name:'Aelia',gladiator_class:'murmillo'});
  const config = {PEACHEX_MODE:'testnet',PEACHEX_CHAIN_ID:'31337',PEACHEX_RPC_URL:rpc,PEACHEX_TOKEN_ADDRESS:tokenAddress,PEACHEX_ANCHOR_ADDRESS:anchorAddress,
    PEACHEX_TOKEN_CODEHASH:keccak256(await provider.getCode(tokenAddress)),PEACHEX_ANCHOR_CODEHASH:keccak256(await provider.getCode(anchorAddress)),PEACHEX_CONFIRMATIONS:'2'};
  const integration = new PeachExIntegration(config);
  const prepared = await integration.prepare(state);
  let transactionHash;

  await t.test('verified metadata and balance, safe unsigned preparation, confirmations and matching proof', async () => {
    const status = await integration.status();
    assert.equal(status.status,'verified'); assert.equal(status.payments_enabled,false);
    assert.equal('rpcUrl' in status,false); assert.equal(status.requires_token_balance,false);
    assert.equal((await integration.balance(aliceAddress)).balance,'21.0');
    assert.equal(prepared.broadcast,false); assert.equal(prepared.transaction.value,'0x0');
    assert.equal(prepared.transaction.to,anchorAddress);
    assert.equal(JSON.stringify(prepared).includes(created.token),false);
    const transaction = await alice.sendTransaction(prepared.transaction);
    const receipt = await transaction.wait(); transactionHash = receipt.hash;
    assert.equal((await integration.verify(state,transactionHash)).status,'awaiting_confirmations');
    await provider.send('evm_mine',[]);
    const verified = await integration.verify(state,transactionHash);
    assert.equal(verified.valid,true); assert.equal(verified.publisher,aliceAddress);
    assert.equal(verified.event_hash,prepared.event_hash);
    assert.equal(verified.proves_wallet_ownership,false); assert.equal(verified.proves_game_fairness,false);
    const other = await store.createSession();
    const otherState = await store.createGladiator(other.token,{name:'Felix',gladiator_class:'retiarius'});
    assert.equal((await integration.verify(otherState,transactionHash)).status,'chronicle_mismatch');
    assert.equal((await integration.verify(state,id('unknown transaction'))).status,'pending_or_unknown');
    const unrelated = await treasury.sendTransaction({to:aliceAddress,value:0}); await unrelated.wait(); await provider.send('evm_mine',[]);
    assert.equal((await integration.verify(state,unrelated.hash)).status,'chronicle_mismatch');
    await assert.rejects(integration.verify(state,'not-a-hash'),{statusCode:400});
    await assert.rejects(integration.balance('not-an-address'),{statusCode:400});
    await assert.rejects(integration.prepare(state,99),{statusCode:400});
  });

  await t.test('anchor rejects duplicates, empty heads and regression; next events stay independent of PCHX holdings', async () => {
    assert.equal(await token.balanceOf(await (await provider.getSigner(2)).getAddress()),0n);
    await assert.rejects(anchor.connect(alice).anchor.staticCall(prepared.chronicle_id,0,prepared.event_hash));
    await assert.rejects(anchor.anchor.staticCall(id('other'),0,'0x'+'00'.repeat(32)));
    const next = await store.checkIn(created.token), nextProof = await integration.prepare(next);
    await (await (await provider.getSigner(2)).sendTransaction(nextProof.transaction)).wait();
    await (await alice.sendTransaction(nextProof.transaction)).wait();
    assert.equal((await anchor.checkpoints(aliceAddress,prepared.chronicle_id)).eventIndex,1n);
    await assert.rejects(anchor.connect(alice).anchor.staticCall(prepared.chronicle_id,0,prepared.event_hash));
  });

  await t.test('mismatched chain or deployed bytecode fails closed', async () => {
    const invalidNetwork = await new PeachExIntegration({...config,PEACHEX_CHAIN_ID:'11155111',PEACHEX_RPC_URL:rpc}).prepare(state);
    // An invalid configuration permits only export, never a wallet transaction.
    assert.equal(invalidNetwork.transaction,null);
    assert.equal(invalidNetwork.deployment.status,'invalid_configuration');
    await assert.rejects(new PeachExIntegration({...config,PEACHEX_TOKEN_CODEHASH:id('wrong code')}).prepare(state),{statusCode:503});
    const disabled = await new PeachExIntegration({}).prepare(state);
    assert.equal(disabled.transaction,null); assert.equal(disabled.mode,'dry-run');
  });

  await t.test('HTTP API authenticates sessions and verifies the actual local-chain receipt', async () => {
    Object.assign(process.env,config,{LUDUS_DATA_DIR:directory});
    const {server} = await import('../../../backend/src/server.js');
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
    const base=`http://127.0.0.1:${server.address().port}`;
    const post=async(path,body,token=created.token)=>{
      const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      return {status:response.status,body:await response.json()};
    };
    assert.equal((await post('/api/game/peachex/prepare',{},null)).status,401);
    assert.equal((await post('/api/game/peachex/prepare',{})).body.transaction.to,anchorAddress);
    const proof=await post('/api/game/peachex/verify',{transaction_hash:transactionHash});
    assert.equal(proof.status,200);assert.equal(proof.body.valid,true);
    assert.equal((await post('/api/game/peachex/balance',{address:aliceAddress})).body.balance,'21.0');
  });
});
