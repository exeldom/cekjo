const config=JSON.parse(document.getElementById('viewer-config').textContent);
const $=id=>document.getElementById(id),root=$('view-content'),message=$('view-message');
let expired=false;
let serverOffset=config.server_now*1000-Date.now();
const abort=new AbortController();
function expire(){if(expired)return;expired=true;abort.abort();root.replaceChildren();$('expiry').textContent='';message.textContent='Akses sudah berakhir.';}
function clock(){
  if(config.expires_at){const left=config.expires_at*1000-Date.now()-serverOffset;if(left<=0){expire();return false;}$('expiry').textContent='Berakhir '+new Date(config.expires_at*1000).toLocaleString('id-ID');}
  return !expired;
}
clock();const timer=setInterval(clock,1000);
async function status(){
  if(!clock())return;
  try{const r=await fetch(config.status_url,{cache:'no-store',credentials:'same-origin',signal:abort.signal});const data=await r.json();if(!r.ok||!data.active){expire();return;}serverOffset=data.server_now*1000-Date.now();clock();}
  catch(e){if(e.name!=='AbortError'){expire();message.textContent='Sambungkan internet dan buka kembali link untuk memeriksa akses.';}}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)status();});
addEventListener('pageshow',e=>{if(e.persisted)status();});
addEventListener('pagehide',()=>{clearInterval(timer);expire();});
