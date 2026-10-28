import assert from 'node:assert/strict';
import test from 'node:test';
import {startAdminEntry} from '../../dist-ts/platform/admin-entry.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
  value='';hidden=false;disabled=false;textContent='';innerHTML='';listeners=new Map();
  classList={add(){},remove(){},toggle(){}};
  addEventListener(name,fn){this.listeners.set(name,fn)}
  emit(name){this.listeners.get(name)?.({preventDefault(){}})}
}
function harness({admin=true,user=true}={}){
 const before={window:globalThis.window,document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 const selectors=['#admin-login','#admin-email','#admin-password','#admin-submit','#admin-logout','#admin-status','#btn-platform-admin-v231','#modal-platform-admin-v231','#platform-business-list-v231','#platform-error-list-v231','#platform-businesses-v231','#platform-trials-v231','#platform-sales-v231','#platform-errors-v231'];
 const nodes=new Map(selectors.map(s=>[s,new Element()]));
 const events=new Map();globalThis.window={addEventListener:(k,v)=>events.set(k,v)};globalThis.document={hidden:false,querySelector:s=>nodes.get(s)??null,addEventListener:(k,v)=>events.set(k,v)};
 const connection={onLine:true};Object.defineProperty(globalThis,'navigator',{configurable:true,value:connection});
 const state={user,admin,authCallback:null,pending:null,loginCalls:0};const calls=[];
 const auth={async getUser(){return {data:{user:state.user?{id:'test-session'}:null},error:null}},onAuthStateChange(fn){state.authCallback=fn},async signInWithPassword(){state.loginCalls++;state.user=true;return {data:{},error:null}},async signOut(options){assert.deepEqual(options,{scope:"local"});if(state.pending)await state.pending;state.user=false;return {data:{},error:null}}};
 const client={auth,async rpc(name){calls.push(name);if(name==='es_admin_plataforma_v1')return {data:state.admin,error:null};if(!state.admin)return {data:null,error:{message:'42501'}};if(name==='listar_negocios_plataforma_v2')return {data:{contract_version:1,items:[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',nombre:'Private fixture',creado:'2026-10-14T12:00:00.123456Z',activo:true,suscripcion:null,uso:{usuarios:1,sucursales:1,productos:1}}],next_cursor:null},error:null};return {data:name==='listar_errores_plataforma_v1'?[]:{negocios:1},error:null}}};
 startAdminEntry(client);
 return {nodes,state,events,calls,connection,restore(){for(const key of ['window','document'])if(before[key]===undefined)delete globalThis[key];else globalThis[key]=before[key];if(before.navigator)Object.defineProperty(globalThis,'navigator',before.navigator);else delete globalThis.navigator;}};
}
test('admin entry loads through server guard; logout clears private rows before remote signout and prevents concurrent login',async()=>{
 const h=harness();try{await turn();await turn();assert.match(h.nodes.get('#platform-business-list-v231').innerHTML,/Private fixture/);let release;h.state.pending=new Promise(resolve=>release=resolve);h.nodes.get('#admin-logout').emit('click');assert.equal(h.nodes.get('#platform-business-list-v231').innerHTML,'');assert.equal(h.nodes.get('#admin-submit').disabled,true);h.nodes.get('#admin-login').emit('submit');assert.equal(h.state.loginCalls,0);release();await turn();assert.equal(h.nodes.get('#admin-login').hidden,false);assert.equal(h.nodes.get('#admin-submit').disabled,false)}finally{h.restore()}
});
test('ordinary account is denied by server helper and never requests global list',async()=>{
 const h=harness({admin:false});try{await turn();await turn();assert.equal(h.calls.includes('listar_negocios_plataforma_v2'),false);assert.doesNotMatch(h.nodes.get('#platform-business-list-v231').innerHTML,/Private fixture/);assert.match(h.nodes.get('#platform-business-list-v231').innerHTML,/Verificá tu acceso/)}finally{h.restore()}
});
test('offline and session-change events immediately remove loaded privileged content',async()=>{
 const h=harness();try{await turn();await turn();assert.match(h.nodes.get('#platform-business-list-v231').innerHTML,/Private fixture/);h.connection.onLine=false;h.events.get('offline')();assert.equal(h.nodes.get('#platform-business-list-v231').innerHTML,'');h.state.user=false;h.state.authCallback();assert.equal(h.nodes.get('#admin-login').hidden,false);assert.equal(h.nodes.get('#admin-password').value,'');await new Promise(resolve=>setTimeout(resolve,5));}finally{h.restore()}
});
