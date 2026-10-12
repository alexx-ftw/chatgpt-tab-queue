import test from 'node:test';import assert from 'node:assert/strict';import {dom,fixture} from './dom-harness.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function contexts(){const outer=dom(`<html><body>${fixture('finished')}<iframe data-cq-frame-token="test-frame" data-cq-frame-key="${A}"></iframe></body></html>`,`https://chatgpt.com/c/${B}`);const inner=dom(`<html><body>${fixture('finished')}</body></html>`,`https://chatgpt.com/c/${A}`);outer.document.querySelector('iframe').contentWindow=inner.context;return {outer,inner};}
test('page RPC explicitly selects the internal conversation, never the visible parent',()=>{
 const {outer}=contexts();assert.equal(outer.page({cmd:'inspect',frameToken:'test-frame'}).pathId,A);assert.equal(outer.page({cmd:'inspect'}).pathId,B);
});
test('missing internal target fails closed and does not inspect parent instead',()=>{
 const {outer}=contexts();assert.throws(()=>outer.page({cmd:'inspect',frameToken:'missing-frame'}),/intern|context|marco/i);
});
test('cross-origin internal frame is rejected before reading or writing a composer',()=>{
 const {outer}=contexts();outer.document.querySelector('iframe').contentWindow.location=new URL('https://example.org/');assert.throws(()=>outer.page({cmd:'inspect',frameToken:'test-frame'}),/origen|dominio/i);
});
function editableContexts(){
 const c=contexts(),frame=c.outer.document.querySelector('iframe'),innerEditor=c.inner.document.querySelector('[data-composer-markdown]'),outerEditor=c.outer.document.querySelector('[data-composer-markdown]');
 frame.setAttribute('inert','');c.outer.document.activeElement=outerEditor;
 c.inner.document.createRange=()=>({selectNodeContents(){}});
 c.inner.context.getSelection=()=>({removeAllRanges(){},addRange(){}});
 innerEditor.focus=()=>{if(frame.hasAttribute('inert'))return;c.inner.document.activeElement=innerEditor;c.outer.document.activeElement=frame;};
 c.inner.document.execCommand=(cmd,_ui,text)=>{if(frame.hasAttribute('inert')||c.inner.document.activeElement!==innerEditor)return false;innerEditor.querySelector('p').textContent=text||'';return true;};
 return {...c,frame,innerEditor,outerEditor};
}
test('fallback editing inside an inert internal frame restores parent focus and inertness synchronously',()=>{
 const c=editableContexts();const before=c.outer.page({cmd:'inspect'}).text;
 c.outer.page({cmd:'write',frameToken:'test-frame',conversationId:A,expectText:'',snapshot:{text:'texto solo A'}});
 assert.equal(c.inner.page({cmd:'inspect'}).text,'texto solo A');assert.equal(c.outer.page({cmd:'inspect'}).text,before);
 assert.equal(c.outer.document.activeElement===c.outerEditor,true,'parent focus must be preserved');assert.equal(c.frame.hasAttribute('inert'),true);
});
test('a failed internal fallback edit still restores parent focus and inertness',()=>{
 const c=editableContexts();c.inner.document.execCommand=()=>{throw Error('native edit failed');};
 assert.throws(()=>c.outer.page({cmd:'write',frameToken:'test-frame',conversationId:A,expectText:'',snapshot:{text:'pending'}}));
 assert.equal(c.outer.document.activeElement===c.outerEditor,true);assert.equal(c.frame.hasAttribute('inert'),true);
});
