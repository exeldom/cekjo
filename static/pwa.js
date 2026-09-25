(() => {
  const install=document.getElementById('pwa-install');
  const help=document.getElementById('pwa-help');
  const update=document.getElementById('pwa-update');
  const offline=document.getElementById('pwa-offline');
  const standalone=()=>matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let promptEvent, registration;
  const updateConnection=()=> {
    offline.hidden=navigator.onLine && !document.body.hasAttribute('data-offline-shell');
    document.querySelectorAll('form').forEach(form=>{
      if(form.method.toLowerCase()!=='post')return;
      form.querySelectorAll('button,input[type="submit"]').forEach(button=>{
        if(button.type!=='submit')return;
        if(!navigator.onLine&&!button.disabled){button.dataset.offlineDisabled='1';button.disabled=true;button.title='Tersedia saat online';}
        else if(navigator.onLine&&button.dataset.offlineDisabled){button.disabled=false;delete button.dataset.offlineDisabled;button.removeAttribute('title');}
      });
    });
  };
  updateConnection();window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);
  if(install)install.hidden=false;

  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;});
  window.addEventListener('appinstalled',()=>{promptEvent=null;help.close();});
  install?.addEventListener('click',async()=>{
    if(standalone()){document.getElementById('pwa-help-text').textContent='cekjo sudah dibuka sebagai aplikasi di perangkat ini.';help.showModal();return;}
    if(promptEvent){await promptEvent.prompt();await promptEvent.userChoice;promptEvent=null;}
    else help.showModal();
  });
  document.getElementById('pwa-help-close').addEventListener('click',()=>help.close());
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  document.getElementById('pwa-help-text').textContent=ios
    ? 'Buka cekjo.com di Safari. Ketuk Bagikan, lalu Tambahkan ke Layar Utama. Aktifkan Buka sebagai App jika tersedia, lalu Tambah.'
    : 'Buka menu browser, lalu pilih Instal aplikasi atau Tambahkan ke layar utama. Jika belum tersedia, buka cekjo.com di Chrome dan coba lagi setelah halaman selesai dimuat.';
  document.getElementById('pwa-reconnect')?.addEventListener('click',()=>location.reload());
  if('serviceWorker' in navigator && window.isSecureContext){
    navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>{
      registration=reg;
      if(reg.waiting)update.hidden=false;
      reg.addEventListener('updatefound',()=>{
        const worker=reg.installing;
        worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)update.hidden=false;});
      });
    }).catch(()=>{/* Online features remain available if installation is unavailable. */});
    let updating=false;
    update.addEventListener('click',()=>{if(registration?.waiting){updating=true;registration.waiting.postMessage('ACTIVATE_UPDATE');}});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updating)location.reload();});
  }
  // Avoid restoring an old authenticated document from the back/forward cache.
  window.addEventListener('pageshow',event=>{if(event.persisted && !document.body.hasAttribute('data-offline-shell'))location.reload();});
  document.querySelectorAll('.filter').forEach(details=>{
    const close=document.createElement('button');
    close.type='button';close.className='filter-close';close.textContent='×';
    close.setAttribute('aria-label','Tutup filter');
    close.addEventListener('click',()=>{details.open=false;details.querySelector('summary').focus();});
    details.querySelector('.filter-menu').prepend(close);
    details.addEventListener('toggle',()=>{
      if(details.open)document.querySelectorAll('.filter[open]').forEach(other=>{if(other!==details)other.open=false;});
    });
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')document.querySelectorAll('.filter[open]').forEach(details=>{details.open=false;details.querySelector('summary').focus();});
  });
  const viewport=window.visualViewport;
  if(viewport){
    const keyboard=()=>{
      const editable=document.activeElement?.matches('input:not([type="checkbox"]),textarea,select');
      const open=editable && viewport.scale < 1.1 && innerHeight-viewport.height>140;
      document.body.classList.toggle('keyboard-open',Boolean(open));
      document.documentElement.style.setProperty('--keyboard-height',viewport.height+'px');
    };
    document.addEventListener('focusin',keyboard);
    document.addEventListener('focusout',()=>setTimeout(keyboard,100));
    viewport.addEventListener('resize',keyboard);keyboard();
  }
})();
