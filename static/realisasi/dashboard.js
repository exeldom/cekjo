(() => {
  const config=JSON.parse(document.getElementById('rd-config').textContent),status=document.getElementById('rd-status'),tree=document.getElementById('rd-tree'),identity=document.getElementById('rd-identity');
  const labels=['Dinas','Bidang Urusan','Program','Kegiatan','Sub Kegiatan','Rekening'];let data,busy=false;
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;};
  function controls(disabled){document.querySelectorAll('[data-upload],[data-download],#rd-identity button').forEach(e=>e.disabled=disabled);}
  function metric(label,value){const node=el('div',null,'rd-metric');node.append(el('strong',value),el('small',label));return node;}
  function node(item){
    const hasChildren=item.children.size>0,container=el(hasChildren?'details':'div',null,'rd-node'),row=el(hasChildren?'summary':'div',null,'rd-row');
    const title=el('div',null,'rd-title'),name=el('strong');if(hasChildren){const arrow=el('span','›','rd-chevron');arrow.setAttribute('aria-hidden','true');name.append(arrow);}name.append(document.createTextNode(item.name));title.append(name,el('small',`${labels[item.level]} · ${item.code}`));
    const percent=Realisasi.percent(item.real,item.pagu),progress=metric('Realisasi',percent===null?'—':percent.toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})+'%');progress.classList.add('rd-percent');
    const bar=el('progress');bar.max=100;bar.value=Math.max(0,Math.min(100,percent||0));bar.setAttribute('aria-label','Persentase realisasi');progress.append(bar);
    if(percent>100)progress.classList.add('rd-over');row.append(title,metric('Anggaran',Realisasi.money(item.pagu)),progress,metric('Realisasi',Realisasi.money(item.real)));container.append(row);
    if(hasChildren){
      let built=false;container.addEventListener('toggle',()=>{if(!container.open||built)return;built=true;const children=el('div',null,'rd-children');for(const child of item.children.values())children.append(node(child));container.append(children);});
    }
    return container;
  }
  function render(){
    tree.replaceChildren();if(data.pagu.length)tree.append(node(Realisasi.hierarchy(data)));else tree.append(el('p','Upload pagu untuk menampilkan dashboard.','rd-empty'));
    identity.elements.name.value=data.name;identity.elements.code.value=data.code;
    for(const kind of ['pagu','realisasi'])document.getElementById(kind+'-updated').textContent=data[kind+'_updated']?'Diperbarui '+new Date(data[kind+'_updated']*1000).toLocaleString('id-ID'):'Belum diunggah';
  }
  async function load(){const response=await fetch('/admin/dashboard-realisasi/data',{cache:'no-cache'});if(response.redirected||!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Sesi berakhir atau data belum tersedia. Muat ulang halaman.');data=await response.json();render();}
  async function save(kind,payload){
    const body=new FormData();body.set('csrf',config.csrf);body.set('kind',kind);body.set('version',data.version);body.set('data',JSON.stringify(payload));
    const response=await fetch('/admin/dashboard-realisasi/data',{method:'POST',body,cache:'no-store'});const result=await response.json().catch(()=>({error:'Permintaan gagal. Muat ulang halaman.'}));if(!response.ok)throw new Error(result.error);await load();
  }
  document.querySelectorAll('[data-upload]').forEach(input=>input.addEventListener('change',async()=>{
    const file=input.files[0],kind=input.dataset.upload;if(!file||busy)return;busy=true;controls(true);status.textContent='Membaca Excel…';
    try{
      if(!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('Pilih file XLSX.');
      if(file.size>20*1024*1024)throw new Error('File maksimal 20 MB.');
      if(!window.XLSX)throw new Error('Library Excel belum tersedia. Muat ulang halaman.');
      await new Promise(resolve=>setTimeout(resolve,0));
      const book=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=book.Sheets[book.SheetNames[0]];
      if(!sheet?.['!ref'])throw new Error('Sheet pertama kosong.');
      const range=XLSX.utils.decode_range(sheet['!ref']);if(range.e.r>100000||range.e.c>50)throw new Error('Ukuran sheet melebihi batas template.');
      for(const [address,cell] of Object.entries(sheet))if(!address.startsWith('!')&&cell.f&&cell.v==null)throw new Error(`Sel ${address}: rumus tidak memiliki nilai tersimpan. Simpan ulang melalui Excel.`);
      const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,blankrows:true,raw:true,range:0});
      const width=config.headers[kind].length;
      const cleaned=rows.map(row=>{while(row.length&&row.at(-1)==null)row.pop();return row;});
      const headers=cleaned.shift()||[];
      if(headers.length!==width||headers.some((v,i)=>String(v).trim().replace(/\s+/g,' ').toUpperCase()!==config.headers[kind][i].toUpperCase()))throw new Error('Header tidak sesuai template '+kind+'. Gunakan Download XLSX sebagai acuan.');
      if(kind==='pagu'&&!confirm('Ganti seluruh pagu dan kosongkan semua realisasi?')){status.textContent='Upload dibatalkan.';return;}
      if(kind==='realisasi'&&!confirm('Ganti seluruh realisasi dengan isi file ini?')){status.textContent='Upload dibatalkan.';return;}
      status.textContent='Menyimpan…';await save(kind,{headers,rows:cleaned});status.textContent=kind==='pagu'?'Pagu diperbarui. Realisasi dikosongkan.':'Realisasi diperbarui.';
    }catch(error){status.textContent=error.message;}finally{input.value='';busy=false;controls(!data);}
  }));
  document.querySelectorAll('[data-download]').forEach(button=>button.addEventListener('click',()=>{
    try{if(!data||busy)return;if(!window.XLSX)throw new Error('Library Excel belum tersedia.');const kind=button.dataset.download;
      const rows=[config.headers[kind],...data[kind].map(row=>[...row.slice(0,-1),Number(row.at(-1))/100])];
      const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=config.headers[kind].map(header=>({wch:header.toUpperCase().startsWith('NAMA')?45:24}));
      const last=config.headers[kind].length-1;for(let i=1;i<rows.length;i++)sheet[XLSX.utils.encode_cell({r:i,c:last})].z='#,##0.00';
      sheet['!autofilter']={ref:sheet['!ref']};const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Sheet1');XLSX.writeFile(book,kind+'.xlsx',{compression:true});
    }catch(error){status.textContent=error.message;}
  }));
  identity.onsubmit=async event=>{event.preventDefault();if(busy||!data)return;busy=true;controls(true);try{await save('identity',{name:identity.elements.name.value,code:identity.elements.code.value});status.textContent='Identitas diperbarui.';}catch(error){status.textContent=error.message;}finally{busy=false;controls(!data);}};
  load().then(()=>{status.textContent='';controls(false);}).catch(error=>{status.textContent=error.message;});
})();
