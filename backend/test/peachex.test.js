import test from 'node:test';
import assert from 'node:assert/strict';
import { peachExConfiguration, publicConfiguration } from '../src/integrations/peachex.js';

const complete = {PEACHEX_MODE:'testnet',PEACHEX_CHAIN_ID:'11155111',PEACHEX_RPC_URL:'https://example.com/private-rpc-key',
  PEACHEX_TOKEN_ADDRESS:'0x'+'11'.repeat(20),PEACHEX_ANCHOR_ADDRESS:'0x'+'22'.repeat(20),
  PEACHEX_TOKEN_CODEHASH:'0x'+'33'.repeat(32),PEACHEX_ANCHOR_CODEHASH:'0x'+'44'.repeat(32)};
test('PeachEx requires explicit testnet configuration and approved code fingerprints',()=>{
  assert.equal(peachExConfiguration({}).enabled,false);
  assert.equal(peachExConfiguration({PEACHEX_MODE:'testnet'}).status,'not_configured');
  for (const bad of [{PEACHEX_CHAIN_ID:'1'},{PEACHEX_MODE:'mainnet'},{PEACHEX_TOKEN_ADDRESS:'invalid'},{PEACHEX_TOKEN_CODEHASH:'0x0'},{PEACHEX_CONFIRMATIONS:'0'},{PEACHEX_RPC_URL:'http://example.com/rpc'}]) {
    assert.equal(peachExConfiguration({...complete,...bad}).enabled,false);
  }
  const safe = publicConfiguration(peachExConfiguration(complete));
  assert.equal(safe.enabled,true);assert.equal(safe.payments_enabled,false);
  assert.equal(JSON.stringify(safe).includes('private-rpc-key'),false);
  assert.equal(safe.token_sales,false);assert.equal(safe.requires_token_balance,false);
});
