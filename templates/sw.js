const CACHE = 'cekjo-{{ version }}';
const GAME_MEDIA_BASE = {{ game_asset_base|tojson }};
const ASSETS = {{ assets|tojson }};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload',credentials:'omit'})));
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith('cekjo-') && key !== CACHE && key !== 'cekjo-data-v1' && !key.startsWith('cekjo-game-ellery-elric-')).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
  if (event.data?.type === 'GAME_CACHE_READY' && /^[a-f0-9]{16}$/.test(event.data.version)) {
    event.waitUntil((async()=>{
      const current='cekjo-game-ellery-elric-'+event.data.version;
      if(!await (await caches.open(current)).match('/game/ellery-elric'))return;
      const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      if(tabs.filter(t=>new URL(t.url).pathname==='/game/ellery-elric').length>1)return;
      await Promise.all((await caches.keys()).filter(k=>k.startsWith('cekjo-game-ellery-elric-')&&k!==current).map(k=>caches.delete(k)));
    })());
  }
});
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method !== 'GET')return;
  const remoteGame=GAME_MEDIA_BASE && request.url.startsWith(GAME_MEDIA_BASE+'/games/ellery-elric/');
  if(url.origin !== self.location.origin && !remoteGame)return;
  if(request.mode === 'navigate') {
    event.respondWith((async()=>{
      // Never save live HTML: it may contain private rows, session or admin UI.
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),8000);
      try { return await fetch(request,{cache:'no-store',signal:controller.signal}); }
      catch {
        if(url.pathname==='/game/ellery-elric'){
          for(const key of (await caches.keys()).reverse().filter(k=>k.startsWith('cekjo-game-ellery-elric-'))){
            const saved=await (await caches.open(key)).match('/game/ellery-elric');
            if(saved)return saved;
          }
        }
        const cache=await caches.open(CACHE);
        return await cache.match(url.pathname === '/kalkulator-pajak' || url.pathname === '/offline/kalkulator-pajak' ? '/offline/kalkulator-pajak' : '/offline');
      } finally {clearTimeout(timer);}
    })());
  } else if(remoteGame || url.pathname.startsWith('/static/game/ellery-elric/')) {
    event.respondWith((async()=>{
      // Version query is part of the key: never mix two game packages.
      for(const key of (await caches.keys()).filter(k=>k.startsWith('cekjo-game-ellery-elric-'))){
        const saved=await (await caches.open(key)).match(request);
        if(saved)return saved;
      }
      return fetch(request);
    })());
  } else if(ASSETS.includes(url.pathname) && url.pathname.startsWith('/static/')) {
    event.respondWith((async()=> (await (await caches.open(CACHE)).match(url.pathname)) || fetch(request))());
  }
});
