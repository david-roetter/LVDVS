import { Contract, FetchRequest, Interface, JsonRpcProvider, formatUnits, getAddress, keccak256 } from 'ethers';
import { gameError, sha256 } from '../game/domain.js';

export const TOKEN_ABI = [
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function INITIAL_SUPPLY() view returns (uint256)', 'function ISSUER() view returns (string)',
  'function balanceOf(address) view returns (uint256)'
];
export const ANCHOR_ABI = [
  'function peachExToken() view returns (address)',
  'function anchor(bytes32 chronicleId,uint64 eventIndex,bytes32 head)',
  'event ChronicleAnchored(address indexed publisher,bytes32 indexed chronicleId,bytes32 head,uint64 eventIndex)'
];
const anchorInterface = new Interface(ANCHOR_ABI);
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const initialSupply = 100_000_000n * 10n ** 18n;

export function peachExConfiguration(env = process.env) {
  const result = { mode: env.PEACHEX_MODE || 'disabled', payments_enabled: false, demo: env.LUDUS_DEMO === 'true' };
  if (result.mode === 'disabled') return { ...result, enabled: false, status: 'disabled' };
  const required = ['PEACHEX_CHAIN_ID', 'PEACHEX_RPC_URL', 'PEACHEX_TOKEN_ADDRESS', 'PEACHEX_ANCHOR_ADDRESS', 'PEACHEX_TOKEN_CODEHASH', 'PEACHEX_ANCHOR_CODEHASH'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) return { ...result, enabled: false, status: 'not_configured', missing };
  try {
    const chainId = Number(env.PEACHEX_CHAIN_ID), rpc = new URL(env.PEACHEX_RPC_URL);
    if (result.mode !== 'testnet' || ![31337, 11155111].includes(chainId)) throw new Error();
    if (rpc.protocol !== 'https:' && !(chainId === 31337 && rpc.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(rpc.hostname))) throw new Error();
    const tokenAddress = getAddress(env.PEACHEX_TOKEN_ADDRESS), anchorAddress = getAddress(env.PEACHEX_ANCHOR_ADDRESS);
    if (/^0x0{40}$/i.test(tokenAddress) || /^0x0{40}$/i.test(anchorAddress) || tokenAddress === anchorAddress) throw new Error();
    if (![env.PEACHEX_TOKEN_CODEHASH, env.PEACHEX_ANCHOR_CODEHASH].every(hash => hashPattern.test(hash))) throw new Error();
    const confirmations = Number(env.PEACHEX_CONFIRMATIONS || 3);
    if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error();
    return { ...result, enabled: true, status: 'configured', chain_id: chainId,
      token_address: tokenAddress, anchor_address: anchorAddress, confirmations,
      rpcUrl: rpc.href, tokenCodehash: env.PEACHEX_TOKEN_CODEHASH.toLowerCase(), anchorCodehash: env.PEACHEX_ANCHOR_CODEHASH.toLowerCase() };
  } catch { return { ...result, enabled: false, status: 'invalid_configuration' }; }
}

export function publicConfiguration(config) {
  const { rpcUrl, tokenCodehash, anchorCodehash, ...publicFields } = config;
  return { ...publicFields, symbol: 'PCHX', token_sales: false, requires_token_balance: false };
}

export function chronicleCommitment(state, eventIndex = state.events.length - 1) {
  if (!Number.isSafeInteger(eventIndex) || eventIndex < 0 || eventIndex >= state.events.length) throw gameError('Choose an existing Chronicle event.');
  if (!state.verification?.valid || !state.verification?.signed) throw gameError('A verified, server-signed Chronicle is required.', 409);
  const event = state.events[eventIndex];
  return { chronicle_id: '0x' + sha256('lvdvs:chronicle:' + state.player_id), event_hash: '0x' + event.hash,
    event_index: eventIndex, algorithm: 'sha256', public_data: 'Only the Chronicle identifier, event index and hash.',
    private_verification: { event, signing_public_key: state.signing_public_key } };
}

export class PeachExIntegration {
  constructor(env = process.env) { this.config = peachExConfiguration(env); }
  async withDeployment(action) {
    const config = this.config;
    if (!config.enabled) throw gameError('PeachEx has no verified testnet deployment configured.', 503);
    const request = new FetchRequest(config.rpcUrl);
    request.timeout = 5_000;
    const provider = new JsonRpcProvider(request, { name: 'peachex-testnet', chainId: config.chain_id }, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
    try {
      const chainId = BigInt(await provider.send('eth_chainId', []));
      if (chainId !== BigInt(config.chain_id)) throw gameError('PeachEx RPC network does not match the configured testnet.', 503);
      const blockNumber = Number(BigInt(await provider.send('eth_blockNumber', [])));
      const [tokenCode, anchorCode] = await Promise.all([provider.getCode(config.token_address, blockNumber), provider.getCode(config.anchor_address, blockNumber)]);
      if (tokenCode === '0x' || anchorCode === '0x' || keccak256(tokenCode) !== config.tokenCodehash || keccak256(anchorCode) !== config.anchorCodehash) {
        throw gameError('PeachEx deployed code does not match the approved fingerprints.', 503);
      }
      const token = new Contract(config.token_address, TOKEN_ABI, provider), anchor = new Contract(config.anchor_address, ANCHOR_ABI, provider);
      const options = { blockTag: blockNumber };
      const [name, symbol, decimals, supply, cap, issuer, anchorToken] = await Promise.all([
        token.name(options), token.symbol(options), token.decimals(options), token.totalSupply(options), token.INITIAL_SUPPLY(options), token.ISSUER(options), anchor.peachExToken(options)
      ]);
      if (name !== 'PeachEx' || symbol !== 'PCHX' || decimals !== 18n || cap !== initialSupply || supply > initialSupply || issuer !== 'Rötter Robotics' || getAddress(anchorToken) !== config.token_address) {
        throw gameError('PeachEx contract identity check failed.', 503);
      }
      return await action({ provider, token, anchor, blockNumber, supply });
    } catch (error) {
      if (error.statusCode) throw error;
      throw gameError('PeachEx RPC verification is unavailable. Try again later.', 503);
    } finally { provider.destroy(); }
  }
  async status() {
    if (!this.config.enabled) return publicConfiguration(this.config);
    return this.withDeployment(({ blockNumber, supply }) => ({ ...publicConfiguration(this.config), status: 'verified', checked_block: blockNumber, total_supply: formatUnits(supply, 18) }));
  }
  async balance(address) {
    let account;
    try { account = getAddress(address); } catch { throw gameError('Enter a valid public Ethereum address.'); }
    return this.withDeployment(async ({ token, blockNumber }) => {
      const value = await token.balanceOf(account, { blockTag: blockNumber });
      return { account, chain_id: this.config.chain_id, token_address: this.config.token_address, symbol: 'PCHX', decimals: 18, raw_balance: value.toString(), balance: formatUnits(value, 18), checked_block: blockNumber, proves_wallet_ownership: false };
    });
  }
  async prepare(state, index) {
    const commitment = chronicleCommitment(state, index);
    if (!this.config.enabled) return { ...commitment, mode: 'dry-run', broadcast: false, transaction: null, deployment: publicConfiguration(this.config) };
    return this.withDeployment(() => ({ ...commitment, mode: 'testnet', broadcast: false,
      deployment: publicConfiguration(this.config), transaction: {
        to: this.config.anchor_address, data: anchorInterface.encodeFunctionData('anchor', [commitment.chronicle_id, commitment.event_index, commitment.event_hash]),
        value: '0x0', chainId: '0x' + this.config.chain_id.toString(16)
      }, notice: 'Signing publishes these hashes publicly and requires testnet gas. No PCHX transfer or approval is requested.' }));
  }
  async verify(state, transactionHash) {
    if (typeof transactionHash !== 'string' || !hashPattern.test(transactionHash)) throw gameError('Enter a valid transaction hash.');
    return this.withDeployment(async ({ provider, blockNumber }) => {
      const receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt) return { valid: false, status: 'pending_or_unknown' };
      const confirmations = blockNumber - receipt.blockNumber + 1;
      if (receipt.status !== 1) return { valid: false, status: 'failed_transaction' };
      const canonicalBlock = await provider.getBlock(receipt.blockNumber);
      if (!canonicalBlock || canonicalBlock.hash !== receipt.blockHash) return { valid: false, status: 'noncanonical_block' };
      if (confirmations < this.config.confirmations) return { valid: false, status: 'awaiting_confirmations', confirmations, required_confirmations: this.config.confirmations };
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== this.config.anchor_address || log.removed) continue;
        let event;
        try { event = anchorInterface.parseLog(log); } catch { continue; }
        if (!event || event.name !== 'ChronicleAnchored') continue;
        const index = Number(event.args.eventIndex);
        if (!Number.isSafeInteger(index) || index >= state.events.length) continue;
        const commitment = chronicleCommitment(state, index);
        if (event.args.chronicleId !== commitment.chronicle_id || event.args.head !== commitment.event_hash) continue;
        return { valid: true, status: 'anchored', transaction_hash: transactionHash, chain_id: this.config.chain_id,
          contract_address: this.config.anchor_address, block_number: receipt.blockNumber, block_hash: receipt.blockHash, confirmations,
          publisher: event.args.publisher, event_index: index, event_hash: commitment.event_hash,
          proves_wallet_ownership: false, proves_game_fairness: false,
          notice: 'The confirmed public hash matches this signed Chronicle event. It does not prove who controls the publisher wallet or that the game rules are fair.' };
      }
      return { valid: false, status: 'chronicle_mismatch' };
    });
  }
}
