const CACHE='cekjo-shell-{{ version }}',STATIC='cekjo-static-v2';
const ASSETS={{ assets|tojson }},SHELL={{ shell|tojson }},URLS=new Set(Object.values(ASSETS).map(value=>new URL(value,self.location.origin).href));
const ALL={{ all_assets|tojson }};
const ALLOWED=new Set(Object.values(ALL).map(value=>new URL(value,self.location.origin).href));
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const assets=await caches.open(STATIC);
  for(const url of URLS){
    if(await assets.match(url))continue;
    const response=await fetch(url,{credentials:'omit',mode:'cors',cache:'default'});
    if(!response.ok||response.type==='opaque')throw new Error('Asset unavailable');
    await assets.put(url,response);
  }
  // These two safe, session-free documents change with the application version.
  const shell=await caches.open(CACHE);
  await shell.addAll(SHELL.map(url=>new Request(url,{credentials:'omit',cache:'reload'})));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keep=new Set([CACHE,STATIC,'cekjo-data-v1','cekjo-data-v2']);
  await Promise.all((await caches.keys()).filter(key=>key.startsWith('cekjo-')&&!keep.has(key)).map(key=>caches.delete(key)));
  // Old immutable assets may still belong to an open tab. Prune only with no other tab.
  const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(tabs.length<=1){const cache=await caches.open(STATIC);for(const req of await cache.keys())if(!ALLOWED.has(req.url))await cache.delete(req);}
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET')return;
  if(ALLOWED.has(url.href)){
    event.respondWith((async()=>{
      const cache=await caches.open(STATIC),saved=await cache.match(url.href);if(saved)return saved;
      const response=await fetch(request);
      if(response.ok&&response.type!=='opaque')await cache.put(url.href,response.clone());
      return response;
    })());return;
  }
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate')event.respondWith((async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await fetch(request,{cache:'no-store',signal:controller.signal});}
    catch{const cache=await caches.open(CACHE);return await cache.match(['/kalkulator-pajak','/offline/kalkulator-pajak'].includes(url.pathname)?'/offline/kalkulator-pajak':'/offline');}
    finally{clearTimeout(timer);}
  })());
});
