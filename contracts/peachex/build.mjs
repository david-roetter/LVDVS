import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import solc from 'solc';

const directory = fileURLToPath(new URL('./', import.meta.url));
const root = resolve(directory, '../..');
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
async function readSources() {
  const sources = {};
  for (const name of await readdir(resolve(directory, 'src'))) {
    if (name.endsWith('.sol')) sources[name] = { content: await readFile(resolve(directory, 'src', name), 'utf8') };
  }
  return sources;
}
function resolveImport(name) {
  if (!name.startsWith('@openzeppelin/contracts/') || name.includes('..')) return { error: 'Unsupported import' };
  // Compiler import callbacks are synchronous.
  try { return { contents: readImport(name) }; } catch { return { error: 'Missing pinned dependency: ' + name }; }
}
/** Solidity standard JSON input with every imported source inlined, as block explorers expect it. */
export async function verificationInput() {
  const sources = await readSources(), imported = {};
  solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { ...settings, outputSelection: {} } }), { import: (name) => {
    const result = resolveImport(name);
    if (result.contents) imported[name] = { content: result.contents };
    return result;
  } });
  return { language: 'Solidity', sources: { ...sources, ...imported }, settings };
}
export const compilerVersion = () => 'v' + solc.version().replace(/\.Emscripten.*$/, '');
export async function compileContracts() {
  const sources = await readSources();
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), { import: resolveImport }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  const artifacts = {};
  for (const [file, contracts] of Object.entries(output.contracts)) {
    if (!sources[file]) continue;
    for (const [name, contract] of Object.entries(contracts)) artifacts[name] = {
      compiler: solc.version(), evmVersion: 'cancun', optimizerRuns: 200,
      abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object,
      deployedBytecode: '0x' + contract.evm.deployedBytecode.object
    };
  }
  return artifacts;
}
import { readFileSync } from 'node:fs';
function readImport(name) { return readFileSync(resolve(root, 'node_modules', name), 'utf8'); }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifacts = await compileContracts();
  await mkdir(resolve(directory, 'out'), { recursive: true });
  for (const [name, artifact] of Object.entries(artifacts)) await writeFile(resolve(directory, 'out', name + '.json'), JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Compiled ${Object.keys(artifacts).length} PeachEx contracts with ${solc.version()} (Cancun).`);
}
