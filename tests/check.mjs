import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';import {join,resolve} from 'node:path';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const base=new URL('..',import.meta.url).pathname;
const manifest=JSON.parse(readFileSync(join(base,'manifest.json')));
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.host_permissions,['https://chatgpt.com/*']);
assert.ok(!manifest.permissions.some(p=>['debugger','cookies','webRequest','nativeMessaging','history'].includes(p)));
const paths=[manifest.background.service_worker,manifest.options_page,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(c=>c.js)];
for(const path of paths){assert.ok(resolve(base,path).startsWith(resolve(base)));assert.ok(existsSync(join(base,path)),`Missing manifest asset: ${path}`);}
function walk(dir){return readdirSync(dir).filter(n=>n!=='node_modules'&&!n.startsWith('.')).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});}
for(const file of walk(base)){
 if(/\.(js|mjs)$/.test(file)){execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}
 if(/\.html$/.test(file)&&!file.includes('/fixtures/')){
  const text=readFileSync(file,'utf8');for(const [,path] of text.matchAll(/(?:src|href)="([^"#]+)"/g))if(!path.includes('://'))assert.ok(existsSync(resolve(file,'..',path)),`Missing HTML asset: ${path}`);
  assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(text),'Inline script violates MV3 CSP');
 }
}
const bg=readFileSync(join(base,'background.mjs'),'utf8');const io=bg.slice(bg.indexOf('const io='),bg.indexOf('const coordinator='));assert.ok(!/chrome\.tabs\.(create|remove|update)|createHelper|closeHelper|parkHelper/.test(io),'Queue IO must not create, navigate or close tabs');assert.ok(!bg.includes('chrome.windows.update'));
assert.ok(readFileSync(join(base,'content.js'),'utf8').includes('Vaciar toda la cola'));assert.ok(readFileSync(join(base,'ui/manager.html'),'utf8').includes('Vaciar toda la cola'));
console.log('Manifest, assets, permissions, JavaScript syntax, CSP and clear-all controls: OK');
