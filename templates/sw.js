const CACHE = 'cekjo-{{ version }}';
const ASSETS = {{ assets|tojson }};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload',credentials:'omit'})));
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith('cekjo-') && key !== CACHE && key !== 'cekjo-data-v1').map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if(request.method !== 'GET' || url.origin !== self.location.origin)return;
  if(request.mode === 'navigate') {
    event.respondWith((async()=>{
      // Never save live HTML: it may contain private rows, session or admin UI.
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),8000);
      try { return await fetch(request,{cache:'no-store',signal:controller.signal}); }
      catch {
        const cache=await caches.open(CACHE);
        return await cache.match(url.pathname === '/kalkulator-pajak' || url.pathname === '/offline/kalkulator-pajak' ? '/offline/kalkulator-pajak' : '/offline');
      } finally {clearTimeout(timer);}
    })());
  } else if(ASSETS.includes(url.pathname) && url.pathname.startsWith('/static/')) {
    event.respondWith((async()=> (await (await caches.open(CACHE)).match(url.pathname)) || fetch(request))());
  }
});
