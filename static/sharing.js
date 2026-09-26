(() => {
  if(typeof Intl.DisplayNames==='function'){
    const names=new Intl.DisplayNames(['id'],{type:'region'});
    document.querySelectorAll('[data-country]').forEach(e=>{if(e.dataset.country){try{e.textContent=names.of(e.dataset.country)||e.dataset.country;}catch{}}});
  }
  document.querySelectorAll('[data-ts]').forEach(e=>e.textContent=new Date(Number(e.dataset.ts)*1000).toLocaleString('id-ID'));
  const form=document.getElementById('share-form');if(!form)return;
  const csrf=form.elements.csrf.value,dialog=document.getElementById('share-dialog'),error=document.getElementById('share-error'),save=document.getElementById('share-save');
  let file,pending=null,busy=false;
  const toast=text=>{const e=document.getElementById('share-toast');e.textContent=text;e.hidden=false;setTimeout(()=>e.hidden=true,3500);};
  const post=async(url,data)=>{const response=await fetch(url,{method:'POST',body:data,cache:'no-store'});const result=await response.json().catch(()=>({error:'Permintaan gagal. Muat ulang halaman dan coba lagi.'}));if(!response.ok)throw new Error(result.error||'Permintaan gagal.');return result;};
  document.getElementById('share-add').onclick=()=>dialog.showModal();document.getElementById('share-close').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  const kind=()=>form.elements.kind.value;
  const fileMode=document.getElementById('file-mode'),mode=document.getElementById('share-mode');
  function fields(){
    const isFile=kind()==='file',preview=isFile&&fileMode.value==='preview',hasKind=Boolean(kind());
    document.getElementById('file-fields').hidden=!isFile;fileMode.disabled=!isFile;
    document.getElementById('content-fields').hidden=!hasKind||isFile;
    form.elements.title.disabled=!hasKind||isFile;
    for(const type of ['link','text']){document.getElementById(type+'-field').hidden=kind()!==type;form.elements[type==='link'?'url':'text'].disabled=kind()!==type;}
    document.getElementById('share-options').hidden=!hasKind;
    for(const option of mode.options)option.disabled=preview&&option.value.startsWith('download');
    if(preview&&mode.value.startsWith('download'))mode.value=mode.value.endsWith('passcode')?'time-passcode':'time';
    const timed=mode.value.startsWith('time'),pass=mode.value.endsWith('passcode');
    document.getElementById('time-field').hidden=!timed;document.getElementById('download-field').hidden=timed;
    document.getElementById('passcode-field').hidden=!pass;form.elements.minutes.disabled=!timed;form.elements.downloads.disabled=timed;form.elements.passcode.disabled=!pass;form.elements.passcode.required=pass;
    document.getElementById('file-limit').textContent=preview?'PDF, XLSX, TXT, DOCX · maksimal 10 MB':'Maksimal 500 MB';
    document.getElementById('share-file').accept=preview?'.pdf,.xlsx,.txt,.docx':'';
  }
  form.addEventListener('change',()=>{if(!busy){pending=null;fields();}});fields();
  function choose(selected){if(busy||!selected)return;file=selected;pending=null;document.getElementById('share-filename').textContent=file.name;error.textContent='';}
  document.getElementById('share-file').addEventListener('change',e=>choose(e.target.files[0]));
  const drop=document.getElementById('share-drop');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');choose(e.dataTransfer.files[0]);});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;error.textContent='';
    const isFile=kind()==='file',preview=isFile&&fileMode.value==='preview';
    if(isFile&&(!file||file.size<1||file.size>(preview?10:500)*1024*1024)){error.textContent=preview?'Pilih file maksimal 10 MB.':'Pilih file maksimal 500 MB.';return;}
    if(preview&&!/\.(pdf|xlsx|txt|docx)$/i.test(file.name)){error.textContent='Preview hanya PDF, XLSX, TXT, DOCX.';return;}
    const data=new FormData(form);if(isFile){data.append('filename',file.name);data.append('size',file.size);}
    busy=true;save.disabled=true;form.querySelector('fieldset').disabled=true;save.textContent=isFile?'Mengunggah…':'Menyimpan…';
    try{
      if(!pending){
        const upload=await post('/admin/sharing/upload',data);
        if(upload.complete){location.reload();return;}
        const progress=document.getElementById('share-progress');progress.hidden=false;progress.value=0;
        await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',upload.upload_url);xhr.setRequestHeader('Content-Type',upload.content_type);xhr.timeout=900000;xhr.upload.onprogress=e=>{if(e.lengthComputable)progress.value=e.loaded/e.total*100;};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('Upload R2 gagal. Periksa CORS dan koneksi.'));xhr.onerror=xhr.ontimeout=()=>reject(new Error('Upload gagal. Periksa koneksi dan CORS.'));xhr.send(file);});
        pending=upload.manage_key;
      }
      save.textContent='Menyimpan…';const complete=new FormData();complete.append('csrf',csrf);await post('/admin/sharing/'+pending+'/complete',complete);location.reload();
    }catch(e){error.textContent=e.message;save.textContent=pending?'Coba simpan lagi':'Simpan';}finally{busy=false;save.disabled=false;form.querySelector('fieldset').disabled=false;}
  });
  document.querySelectorAll('[data-link]').forEach(button=>button.addEventListener('click',()=>{
    const urlPromise=fetch(button.dataset.link,{cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Link tidak tersedia.');return data.url;});
    const copy=window.ClipboardItem&&navigator.clipboard?.write?navigator.clipboard.write([new ClipboardItem({'text/plain':urlPromise.then(url=>new Blob([url],{type:'text/plain'}))})]):urlPromise.then(url=>navigator.clipboard.writeText(url));
    Promise.all([urlPromise,copy]).then(()=>toast('Link copied')).catch(e=>toast(e.message||'Izinkan clipboard untuk menyalin link.'));
  }));
  document.querySelectorAll('[data-delete]').forEach(button=>button.addEventListener('click',async()=>{
    if(!confirm('Hapus data, link, dan seluruh riwayat aksesnya?'))return;button.disabled=true;
    const data=new FormData();data.append('csrf',csrf);
    try{await post(button.dataset.delete,data);location.reload();}catch(e){toast(e.message);button.disabled=false;}
  }));
})();
