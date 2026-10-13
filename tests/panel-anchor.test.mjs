import test from 'node:test';
import assert from 'node:assert/strict';
import {dom} from './dom-harness.mjs';
const form='<form data-chatgpt-composer=""><div contenteditable="true" data-composer-markdown="" role="textbox"><p>Unchanged draft</p></div><button aria-label="Stop"></button></form>';
for(const hidden of ['hidden=""','aria-hidden="true"','inert=""'])test('UI anchor and sender agree with hidden duplicate: '+hidden,()=>{
 const h=dom('<html><body><main>'+form+'</main><div '+hidden+'>'+form+'</div></body></html>');
 const snap=h.page({cmd:'inspect'});assert.equal(snap.ready,true);assert.equal(snap.state,'busy');
 const anchor=h.page({cmd:'uiAnchor'});assert.equal(anchor.form,h.document.querySelector('main').querySelector('form'));assert.equal(anchor.editor,h.document.querySelector('main').querySelector('[contenteditable]'));
 assert.equal(anchor.totalForms,2);assert.equal(anchor.visibleForms,1);assert.equal(h.document.querySelector('main').textContent,'Unchanged draft');
});
test('UI anchor does not choose between two live composers',()=>{
 const h=dom('<html><body>'+form+form+'</body></html>');const a=h.page({cmd:'uiAnchor'});
 assert.equal(a.form,null);assert.equal(a.visibleForms,2);assert.equal(h.page({cmd:'inspect'}).ready,false);
});
test('UI anchor is read-only and works with an unfocused document',()=>{
 const h=dom('<html><body>'+form+'</body></html>');const a=h.page({cmd:'uiAnchor'});
 assert.equal(h.document.visibilityState,'hidden');assert.ok(a.form);assert.equal(a.totalForms,1);assert.equal(a.visibleForms,1);assert.equal(h.page({cmd:'inspect'}).text,'Unchanged draft');
});
