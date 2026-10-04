(() => {
  const config=JSON.parse(document.getElementById('chat-config').textContent),root=document.getElementById('chat-messages'),status=document.getElementById('chat-status'),expiry=document.getElementById('chat-expiry'),form=document.getElementById('chat-form');
  let after=0,stopped=false,polling=false,timer,delay=3000,busy=false,selected=null,pending=null,requestId=null;
  const offset=config.server_now*1000-Date.now(),controller=new AbortController();
  const body=document.getElementById('chat-body'),picker=document.getElementById('chat-file'),selectedBox=document.getElementById('chat-selected');
  function stop(text='Chat sudah expired.'){
    stopped=true;clearTimeout(timer);controller.abort();root.replaceChildren();form?.reset();if(form)form.hidden=true;document.querySelector('.read-only')?.remove();expiry.textContent='';status.textContent=text;selected=null;pending=null;
  }
  function clock(){
    const left=config.expires_at*1000-Date.now()-offset;
    if(left<=0){stop();return false;}
    expiry.textContent=`${Math.ceil(left/60000)} menit tersisa`;return !stopped;
  }
  async function api(action,data,params={}){
    if(!clock())throw new Error('Chat sudah expired.');
    const url=new URL(config.endpoint,location.origin);url.searchParams.set('chat',action);
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const options={cache:'no-store',credentials:'same-origin',headers:{'X-Chat-Ticket':config.ticket},signal:controller.signal};
    if(data){const payload=new FormData();payload.set('csrf',config.csrf);for(const [key,value] of Object.entries(data))payload.set(key,value);options.method='POST';options.body=payload;}
    const response=await fetch(url,options);
    if(response.status===410){stop();throw new Error('Chat sudah expired.');}
    if(response.status===403){stop('Sesi berakhir. Buka kembali link chat.');throw new Error('Sesi berakhir.');}
    if(response.status===204)return null;
    const result=await response.json().catch(()=>({error:'Koneksi terputus. Coba lagi.'}));
    if(!response.ok)throw new Error(result.error||'Permintaan gagal.');return result;
  }
  function linkify(target,text){
    let position=0;
    for(const match of text.matchAll(/https?:\/\/[^\s<>]+/gi)){
      const raw=match[0].replace(/[.,;!?)\]]+$/,'');
      target.append(document.createTextNode(text.slice(position,match.index)));
      const a=document.createElement('a');a.textContent=raw;a.href=raw;a.target='_blank';a.rel='noopener noreferrer';target.append(a);position=match.index+raw.length;
    }
    target.append(document.createTextNode(text.slice(position)));
  }
  async function attachment(file,image=false){return (await api('attachment',null,{id:file.id,...(image?{image:'1'}:{})})).url;}
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting||stopped||document.hidden)return;
    observer.unobserve(entry.target);
    attachment(entry.target.chatFile,true).then(url=>{if(!stopped)entry.target.src=url;}).catch(()=>{entry.target.remove();});
  }),{root,rootMargin:'150px'});
  function append(message){
    const bubble=document.createElement('article');bubble.className='message'+(message.mine?' mine':'');
    const sender=document.createElement('strong');sender.textContent=message.sender;bubble.append(sender);
    if(message.body){const p=document.createElement('div');p.className='body';linkify(p,message.body);bubble.append(p);}
    if(message.attachment){
      const file=message.attachment;
      if(file.image){const img=document.createElement('img');img.alt=file.name;img.loading='lazy';img.referrerPolicy='no-referrer';img.chatFile=file;img.style.minHeight='80px';bubble.append(img);observer.observe(img);}
      const button=document.createElement('button');button.type='button';button.className='file-download';button.textContent=file.name;
      button.onclick=async()=>{button.disabled=true;try{const url=await attachment(file);if(!stopped)location.assign(url);}catch(error){if(!stopped)status.textContent=error.message;}finally{button.disabled=false;}};bubble.append(button);
    }
    const time=document.createElement('time');time.dateTime=new Date(message.created_at*1000).toISOString();time.textContent=new Date(message.created_at*1000).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});bubble.append(time);root.append(bubble);
  }
  async function poll(){
    clearTimeout(timer);if(stopped||document.hidden||polling)return;polling=true;
    try{
      const result=await api('messages',null,{after});if(stopped)return;
      const messages=result?.messages||[],bottom=root.scrollHeight-root.scrollTop-root.clientHeight<100;
      for(const message of messages){append(message);after=message.id;}
      if(bottom)root.scrollTop=root.scrollHeight;
      delay=messages.length?3000:Math.min(15000,delay+3000);
      if(messages.length===100)delay=50;
      if(status.textContent==='Koneksi terputus. Menghubungkan kembali…')status.textContent='';
    }catch(error){if(!stopped){status.textContent='Koneksi terputus. Menghubungkan kembali…';delay=15000;}}
    finally{polling=false;if(!stopped&&!document.hidden)timer=setTimeout(poll,delay);}
  }
  function selection(){selectedBox.hidden=!selected;selectedBox.querySelector('span').textContent=selected?.name||'';}
  if(form){
    picker.onchange=()=>{
      if(busy)return;
      const file=picker.files[0];
      if(file&&(!file.size||file.size>20*1024*1024)){status.textContent='Lampiran maksimal 20 MB.';picker.value='';return;}
      selected=file||null;pending=null;requestId=null;selection();status.textContent='';
    };
    document.getElementById('chat-remove').onclick=()=>{if(!busy){selected=null;pending=null;requestId=null;picker.value='';selection();}};
    body.oninput=()=>{requestId=null;body.style.height='auto';body.style.height=Math.min(140,body.scrollHeight)+'px';};
    body.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&matchMedia('(pointer:fine)').matches){event.preventDefault();form.requestSubmit();}};
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||stopped||(!body.value.trim()&&!selected))return;busy=true;
      form.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
      requestId ||= crypto.randomUUID();
      try{
        if(selected&&!pending){
          status.textContent='Mengunggah…';const file=await api('upload',{filename:selected.name,size:selected.size});
          const response=await fetch(file.url,{method:'PUT',headers:{'Content-Type':file.mime},body:selected,credentials:'omit',signal:controller.signal});
          if(!response.ok)throw new Error('Upload gagal. Periksa koneksi atau CORS bucket R2.');pending=file.id;
        }
        await api('send',{body:body.value,attachment:pending||'',request_id:requestId});
        if(stopped)return;body.value='';body.style.height='auto';selected=null;pending=null;requestId=null;picker.value='';selection();status.textContent='';delay=3000;await poll();root.scrollTop=root.scrollHeight;
      }catch(error){if(!stopped)status.textContent=error.message;}
      finally{busy=false;form.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);}
    };
  }
  const ticker=setInterval(clock,1000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else if(clock())poll();});
  addEventListener('online',()=>{if(clock())poll();});
  addEventListener('pagehide',()=>{clearInterval(ticker);observer.disconnect();stop('Buka kembali chat untuk melanjutkan.');});
  addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  const viewport=()=>{if(window.visualViewport)document.documentElement.style.setProperty('--chat-height',`${visualViewport.height}px`);};
  window.visualViewport?.addEventListener('resize',viewport);viewport();if(clock())poll();
})();
