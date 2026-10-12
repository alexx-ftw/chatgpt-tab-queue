import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
test('release is signed CRX3, has stable identity, rejects tampering and excludes private files',()=>{
 const script=new URL('../scripts/package_release.py',import.meta.url).pathname;assert.ok(existsSync(script),'release packager exists');
 const dir=mkdtempSync(join(tmpdir(),'cq-release-test-'));
 try{const root=join(dir,'src');mkdirSync(root);mkdirSync(join(root,'core'));writeFileSync(join(root,'content.js'),'// fixture');writeFileSync(join(root,'background.mjs'),'// fixture');writeFileSync(join(root,'core','safe.js'),'// fixture');writeFileSync(join(root,'secret.pem'),'PRIVATE FILE MUST NEVER BE PACKAGED');
 const manifest={manifest_version:3,name:'test',version:'1.0.0',update_url:'https://example.com/updates.xml'};writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));
 const key=join(dir,'key.pem');execFileSync('openssl',['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',key],{stdio:'ignore'});
 const out=join(dir,'out');execFileSync('python3',[script,'--source',root,'--key',key,'--out',out],{stdio:'pipe'});
 const crx=join(out,'chatgpt-queue.crx');assert.equal(readFileSync(crx).subarray(0,4).toString(),'Cr24');
 const meta=JSON.parse(readFileSync(join(out,'release.json')));assert.match(meta.id,/^[a-p]{32}$/);
 execFileSync('python3',[script,'--verify',crx],{stdio:'pipe'});
 const names=execFileSync('python3',['-c',`import zipfile;print(zipfile.ZipFile(r'${join(out,'chatgpt-queue.zip')}').namelist())`]).toString();assert.ok(!names.includes('secret.pem'));assert.ok(names.includes('core/safe.js'));
 manifest.version='1.0.1';writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));execFileSync('python3',[script,'--source',root,'--key',key,'--out',out],{stdio:'pipe'});assert.equal(JSON.parse(readFileSync(join(out,'release.json'))).id,meta.id);
 const b=readFileSync(crx);b[b.length-5]^=1;const bad=join(dir,'bad.crx');writeFileSync(bad,b);assert.notEqual(spawnSync('python3',[script,'--verify',bad]).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
