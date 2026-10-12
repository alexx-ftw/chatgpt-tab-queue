import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {readdirSync,statSync} from 'node:fs';
function sources(dir){return readdirSync(dir).filter(n=>!n.startsWith('.')&&n!=='node_modules'&&n!=='tests').flatMap(n=>{const p=dir+'/'+n;return statSync(p).isDirectory()?sources(p):/\.(?:js|mjs)$/.test(n)?[p]:[];});}
for(const file of sources(new URL('..',import.meta.url).pathname))test(`JavaScript syntax: ${file.split('/').slice(-2).join('/')}`,()=>assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',file],{stdio:'pipe'})));
