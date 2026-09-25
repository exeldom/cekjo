(() => {
  const CACHE='cekjo-data-v1',KEY='/__cekjo_snapshot';
  let busy=false,stopped=false,controller;
  const channel='BroadcastChannel' in window?new BroadcastChannel('cekjo-data'):null;
  const status=text=>{const e=document.getElementById('sync-status');if(e)e.textContent=text;};
  async function clear(){stopped=true;controller?.abort();await caches.delete(CACHE);}
  channel?.addEventListener('message',e=>{if(e.data==='logout')clear();});
  async function read(){const r=await(await caches.open(CACHE)).match(KEY);return r?r.json():null;}
  function offlineNav(snapshot){
    if(!document.body.hasAttribute('data-offline-shell'))return;
    const nav=document.querySelector('.app-nav');if(!nav)return;
    if(snapshot?.role==='admin'){
      nav.innerHTML='<a href="/admin"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/></svg><span class="nav-label">Home</span></a><a href="/admin/settings"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg><span class="nav-label">Pengaturan</span></a><button type="button" id="offline-exit"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 4h5v16h-5M3 12h12m-4-4 4 4-4 4"/></svg><span class="nav-label">Keluar</span></button>';
      nav.querySelector('#offline-exit').onclick=()=>{if(!navigator.onLine)alert('Sambungkan internet untuk keluar dari akun.');else location.href='/admin';};
    }
  }
  async function sync(){
    if(busy||stopped||!navigator.onLine||!('caches' in window))return;
    busy=true;controller=new AbortController();
    try{
      status('Menyinkronkan…');
      const response=await fetch('/api/offline-snapshot',{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('sync');
      const snapshot=await response.json();if(stopped)return;
      await(await caches.open(CACHE)).put(KEY,new Response(JSON.stringify(snapshot),{headers:{'Content-Type':'application/json'}}));
      if(stopped){await caches.delete(CACHE);return;}
      status('Tersimpan di perangkat');
      offlineNav(snapshot);
      if(document.body.hasAttribute('data-offline-shell')){if(location.pathname==='/offline')location.replace('/home');else if(location.pathname==='/offline/kalkulator-pajak')location.replace('/kalkulator-pajak');else location.reload();return;}
      document.dispatchEvent(new CustomEvent('cekjo:synced',{detail:snapshot}));
    }catch(e){if(e.name!=='AbortError')status(navigator.onLine?'Belum tersinkron':'Offline');}finally{busy=false;}
  }
  document.querySelectorAll('form[action="/logout"]').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();channel?.postMessage('logout');await clear();HTMLFormElement.prototype.submit.call(form);
  }));
  window.CekjoOffline={read,sync,clear:async()=>{channel?.postMessage('logout');await clear();}};
  if('caches' in window){read().then(offlineNav).catch(()=>{});sync();window.addEventListener('online',sync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});setInterval(()=>{if(!document.hidden)sync();},120000);}
})();
