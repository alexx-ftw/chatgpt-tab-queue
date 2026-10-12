/* Lightweight XML-backed DOM harness for supplied selector fixtures. Not a browser emulator. */
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const require=createRequire(import.meta.url);let parser;
try{parser=require('@xmldom/xmldom');}catch{parser=require('/usr/local/slides_js/node_modules/@xmldom/xmldom');}
const {DOMParser}=parser;
function match(e,selector){
 if(!e||e.nodeType!==1)return false;
 return selector.split(/,(?![^\[]*\])/).some(raw=>{
  let s=raw.trim();const attrs=[...s.matchAll(/\[([\w-]+)(?:([\^$*~|]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)];
  s=s.replace(/\[[^\]]+\]/g,'');const tag=s.match(/^[\w*-]+/);
  if(tag&&tag[0]!=='*'&&tag[0].toLowerCase()!==e.tagName.toLowerCase())return false;
  for(const c of s.matchAll(/\.([\w-]+)/g))if(!String(e.getAttribute('class')||'').split(/\s+/).includes(c[1]))return false;
  const id=s.match(/#([\w-]+)/);if(id&&e.getAttribute('id')!==id[1])return false;
  for(const a of attrs){if(!e.hasAttribute(a[1]))return false;if(!a[2])continue;const v=e.getAttribute(a[1]),want=a[3]??a[4]??a[5]??'';
   if(a[2]==='='&&v!==want)return false;if(a[2]==='*='&&!v.includes(want))return false;if(a[2]==='^='&&!v.startsWith(want))return false;if(a[2]==='$='&&!v.endsWith(want))return false;
  }return true;
 });
}
export function dom(html,url='https://chatgpt.com/c/11111111-1111-4111-8111-111111111111'){
 const doc=new DOMParser({onError:()=>{}}).parseFromString(html,'text/html');const listeners=new WeakMap();
 function patch(n){
  Object.defineProperty(n,'children',{get(){return Array.from(this.childNodes||[]).filter(x=>x.nodeType===1);},configurable:true});
  n.querySelectorAll=function(sel){const result=[];const visit=x=>{for(const c of Array.from(x.childNodes||[])){if(match(c,sel))result.push(c);visit(c);}};visit(this);return result;};n.querySelector=function(s){return this.querySelectorAll(s)[0]||null;};
  n.matches=function(s){return match(this,s);};n.closest=function(s){let x=this;while(x){if(match(x,s))return x;x=x.parentNode;}return null;};
  n.contains=function(x){while(x){if(x===this)return true;x=x.parentNode;}return false;};
  Object.defineProperty(n,'parentElement',{get(){return this.parentNode?.nodeType===1?this.parentNode:null;},configurable:true});
  n.getClientRects=()=>[{}];Object.defineProperty(n,'isConnected',{get(){return doc.contains(this);},configurable:true});
  n.addEventListener=function(type,fn){let m=listeners.get(this);if(!m)listeners.set(this,m=new Map());if(!m.has(type))m.set(type,[]);m.get(type).push(fn);};
  n.removeEventListener=function(type,fn){const m=listeners.get(this);if(m?.has(type))m.set(type,m.get(type).filter(f=>f!==fn));};
  n.dispatchEvent=function(e){if(!e.target)e.target=this;for(const fn of listeners.get(this)?.get(e.type)||[])fn(e);return true;};n.click=function(){this.dispatchEvent({type:'click',isTrusted:false});};n.focus=function(){doc.activeElement=this;};
  if(n.nodeType===1){
   n.tagName=n.tagName.toUpperCase();n.dataset=new Proxy({}, {get:(_t,k)=>n.getAttribute('data-'+k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))});
   Object.defineProperty(n,'hidden',{get(){return this.hasAttribute('hidden');}});Object.defineProperty(n,'disabled',{get(){return this.hasAttribute('disabled');}});
   Object.defineProperty(n,'innerText',{get(){return this.textContent;}});
  }
  const children=Array.from(n.childNodes||[]);if(n.childNodes&&!n.childNodes[Symbol.iterator])n.childNodes[Symbol.iterator]=function*(){for(let i=0;i<this.length;i++)yield this[i];};for(const c of children)patch(c);
 }
 patch(doc);doc.title='Prueba';doc.body=doc.querySelector('body');doc.documentElement=doc.querySelector('html');doc.activeElement=null;doc.hasFocus=()=>false;doc.visibilityState='hidden';
 const observers=[];
 class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
 const context=vm.createContext({document:doc,location:new URL(url),navigator:{onLine:true},MutationObserver:Observer,queueMicrotask, setTimeout,clearTimeout,console,Event:class {constructor(type,opts){this.type=type;Object.assign(this,opts);}},
 getComputedStyle:e=>({display:String(e.getAttribute?.('class')||'').split(/\s+/).includes('hidden')?'none':'block',visibility:'visible'})});
 vm.runInContext(readFileSync(new URL('../core/adapter.js',import.meta.url),'utf8'),context);
 return {document:doc,page:args=>context.CQPage(args),observers,context};
}
export const fixture=name=>readFileSync(new URL(`./fixtures/${name}.html`,import.meta.url),'utf8');
