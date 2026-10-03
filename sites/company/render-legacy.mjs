import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// The existing production service writes these six files from environment values.
// This adapter preserves that supported deployment route until source settings can change.
const files = { F_INDEX:'index.html', F_CSS:'style.css', F_IMPRESSUM:'impressum.html', F_DATENSCHUTZ:'datenschutz.html', F_ROBOTS:'robots.txt', F_FAVICON:'favicon.svg' };
export async function prepareLegacyDeployment({ revision='local', rollback=false } = {}) {
  if (!/^(local|[a-f0-9]{40})$/.test(revision)) throw new Error('Use a full source commit SHA.');
  const integration = JSON.parse(await readFile(new URL('./integrations.json',import.meta.url),'utf8'));
  const envVars=[], hashes={};
  for (const [key,name] of Object.entries(files)) {
    let content = await readFile(new URL(rollback && key==='F_INDEX' ? './legacy/production-before-2026-10-04.html' : './'+name,import.meta.url),'utf8');
    if (key==='F_INDEX' && !rollback) {
      content=content.replaceAll('href="/ludus/"','href="'+integration.ludus.url+'"')
        .replaceAll('href="/peachex/"','href="https://roetterrobitics-lvdvs-preview.onrender.com/peachex/"')
        .replace('</head>','<meta name="company-source-revision" content="'+revision+'">\n</head>');
      if (/href="\/(ludus|peachex)\//.test(content)) throw new Error('Unsupported legacy route.');
      if (!content.includes(integration.peachex.integration_preview_url)) throw new Error('Missing integration preview link.');
    }
    const value=content.replaceAll('\r','').trim();
    hashes[key]=createHash('sha256').update(value).digest('hex').slice(0,12);
    envVars.push({key,value});
  }
  envVars.push({key:'F_HASHES',value:JSON.stringify(hashes)});
  return {envVars};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await prepareLegacyDeployment({revision:process.env.COMPANY_SOURCE_REVISION||'local',rollback:process.argv.includes('--rollback')})));
}
