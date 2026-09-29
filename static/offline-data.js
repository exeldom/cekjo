(() => {
  const CACHE='cekjo-data-v2',META='/__cekjo_manifest',LEGACY='cekjo-data-v1',MIN_CHECK=60000;
  let busy=false,stopped=false,controller;
  const channel='BroadcastChannel' in window?new BroadcastChannel('cekjo-data'):null;
  const expectedRole=document.body.dataset.userRole;
  const key=(role,t)=>'/__cekjo_table/'+role+'/'+t.id+'/'+t.revision;
  async function clear(){stopped=true;controller?.abort();await Promise.all([caches.delete(CACHE),caches.delete(LEGACY)]);}
  channel?.addEventListener('message',e=>{if(e.data==='logout')clear();});
  async function metadata(cache){const r=await cache.match(META);return r?r.json():null;}
  async function read(){
    const cache=await caches.open(CACHE),meta=await metadata(cache);
    if(!meta){const names=await caches.keys();if(!names.includes(LEGACY))return null;const old=await(await caches.open(LEGACY)).match('/__cekjo_snapshot');const snapshot=old?await old.json():null;return expectedRole&&snapshot?.role!==expectedRole?null:snapshot;}
    if(expectedRole&&meta.role!==expectedRole)return null;
    const tables=[];
    for(const item of meta.tables){const response=await cache.match(key(meta.role,item));if(response)tables.push(await response.json());}
    return {role:meta.role,tables,saved:meta.saved};
  }
  function offlineNav(snapshot){
    if(!document.body.hasAttribute('data-offline-shell'))return;
    const nav=document.querySelector('.app-nav');if(!nav)return;
    if(snapshot?.role==='admin'){
      nav.innerHTML='<a href="/admin"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/></svg><span class="nav-label">Home</span></a><a href="/admin/settings"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg><span class="nav-label">Pengaturan</span></a><button type="button" id="offline-exit"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 4h5v16h-5M3 12h12m-4-4 4 4-4 4"/></svg><span class="nav-label">Keluar</span></button>';
      nav.querySelector('#offline-exit').onclick=()=>{if(!navigator.onLine)alert('Sambungkan internet untuk keluar dari akun.');else location.href='/admin';};
    }
  }
  function reconnect(){
    if(!document.body.hasAttribute('data-offline-shell'))return;
    if(location.pathname==='/offline')location.replace('/home');
    else if(location.pathname==='/offline/kalkulator-pajak')location.replace('/kalkulator-pajak');
    else location.reload();
  }
  async function perform(force){
    const cache=await caches.open(CACHE);let previous=await metadata(cache);
    if(expectedRole&&previous&&previous.role!==expectedRole){await Promise.all([caches.delete(CACHE),caches.delete(LEGACY)]);previous=null;}
    const store=await caches.open(CACHE);
    if(!force&&previous?.complete&&Date.now()-previous.checkedAt<MIN_CHECK)return;
    controller=new AbortController();const signal=controller.signal;
    const headers={};if(previous?.complete&&previous.etag)headers['If-None-Match']=previous.etag;
    const response=await fetch('/api/offline-manifest',{headers,cache:'no-store',signal});
    if(stopped)return;
    if(response.status===304){
      previous.checkedAt=Date.now();await store.put(META,new Response(JSON.stringify(previous)));reconnect();return;
    }
    if(!response.ok)throw new Error('manifest');
    const manifest=await response.json();
    if(manifest.protocol!==2||!['admin','public'].includes(manifest.role)||!Array.isArray(manifest.tables))throw new Error('protocol');
    // Remove revoked, changed and admin-only cached data before downloading replacements.
    const keep=new Set(manifest.tables.map(t=>key(manifest.role,t)));
    for(const req of await store.keys()){const path=new URL(req.url).pathname;if(path!==META&&!keep.has(path))await store.delete(req);}
    await caches.delete(LEGACY);
    const meta={...manifest,etag:response.headers.get('ETag'),checkedAt:Date.now(),saved:new Date().toISOString(),complete:false};
    if(stopped)return;
    await store.put(META,new Response(JSON.stringify(meta)));
    // Sequential downloads cap peak memory on phones and avoid a burst of transfers.
    for(const table of manifest.tables){
      if(stopped)return;
      const path=key(manifest.role,table);if(await store.match(path))continue;
      const result=await fetch('/api/offline-table/'+encodeURIComponent(table.id)+'?v='+encodeURIComponent(table.revision)+'&role='+encodeURIComponent(manifest.role),{cache:'no-store',signal});
      if(!result.ok)throw new Error('table changed');
      const data=await result.json();
      if(data.id!==table.id||data.revision!==table.revision)throw new Error('version');
      if(stopped)return;
      await store.put(path,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
    }
    if(stopped){await caches.delete(CACHE);return;}
    meta.complete=true;await store.put(META,new Response(JSON.stringify(meta)));
    reconnect();
    if(document.body.hasAttribute('data-offline-shell'))return;
    // Online pages already have their own rows; do not parse all cached tables again.
    document.dispatchEvent(new CustomEvent('cekjo:sync-complete'));
  }
  async function sync(force=false){
    if(busy||stopped||!navigator.onLine||!('caches' in window)||document.hidden)return;
    busy=true;
    try{
      if(navigator.locks)await navigator.locks.request('cekjo-offline-sync',{ifAvailable:true},lock=>lock?perform(force):undefined);
      else await perform(force);
    }catch{/* Keep completed cached tables; next foreground check resumes missing downloads. */}
    finally{busy=false;}
  }
  document.querySelectorAll('form[action="/logout"]').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();channel?.postMessage('logout');await clear();HTMLFormElement.prototype.submit.call(form);
  }));
  window.CekjoOffline={read,sync:()=>sync(true),clear:async()=>{channel?.postMessage('logout');await clear();}};
  if('caches' in window){
    if(document.body.hasAttribute('data-offline-shell'))read().then(offlineNav).catch(()=>{});
    sync(location.pathname.startsWith('/admin/settings'));
    window.addEventListener('online',()=>sync(true));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
    setInterval(()=>sync(),300000);
  }
})();
