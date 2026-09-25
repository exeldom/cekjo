(async()=>{
  const root=document.getElementById('offline-content');
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const link=(href,text,cls='button')=>{const a=el('a',cls,text);a.href=href;return a;};
  let snapshot=await CekjoOffline.read().catch(()=>null);
  const rupiah=new Intl.NumberFormat('id-ID',{maximumFractionDigits:12});
  function cell(value,col){if(value===null)return '—';if(typeof value==='number'&&!/tahun|year|kode|nomor|telepon|nik|nip|\bid\b/i.test(col))return rupiah.format(value);return String(value);}
  function render(){
    root.replaceChildren();
    if(!snapshot){root.append(el('p','empty','Belum ada data offline. Sambungkan internet untuk mengunduh data.'));return;}
    const path=location.pathname;

    if(path==='/login'||path.startsWith('/admin/settings')){
      root.append(el('p','empty','Halaman pengelolaan memerlukan koneksi.'),link('/home','Home'));return;
    }
    const tableId=path.startsWith('/table/')?path.split('/')[2]:null;
    if(tableId){const t=snapshot.tables.find(t=>t.id===tableId);if(!t){root.append(el('p','empty','Tabel tidak tersedia pada perangkat ini.'),link('/home','Home'));return;}renderTable(t);return;}
    const catalog=el('section','minimal-catalog');const identity=el('div','identity'),logo=el('img');logo.src='/static/icons/cekjo-logo.png';logo.alt='';logo.width=64;logo.height=64;identity.append(logo,el('h1','catalog-brand','cekjo'));catalog.append(identity);
    const searchWrap=el('div','search'),search=el('input');search.type='search';search.placeholder='Cari data…';search.setAttribute('aria-label','Cari data');searchWrap.append(search);catalog.append(searchWrap);
    const list=el('div','table-list');const items=[{name:'Kalkulator Pajak Sederhana - PMK 131/2024 dan PP 9/2022',href:'/kalkulator-pajak'},...snapshot.tables.filter(t=>location.pathname!=='/home'||!t.locked).map(t=>({name:t.name,href:'/table/'+t.id}))];
    function filter(){list.replaceChildren();for(const item of items.filter(x=>x.name.toLocaleLowerCase('id').includes(search.value.toLocaleLowerCase('id'))))list.append(link(item.href,item.name,'catalog-row'));}
    search.addEventListener('input',filter);filter();catalog.append(list);root.append(catalog);
  }
  function renderTable(t){
    root.append(link('/home','←','button icon-button'),el('h1','',t.name));
    const controls=el('div','filterbar panel'),search=el('input');search.type='search';search.placeholder='Cari di dalam tabel…';search.setAttribute('aria-label','Cari data');const box=el('div','search');box.append(search);controls.append(box);
    const selected=new Map(), filterControls=el('div','filter-actions');
    for(const col of t.filters){
      const index=t.columns.indexOf(col),values=[...new Set(t.rows.map(row=>String(row[index]??'')))].sort((a,b)=>a.localeCompare(b,'id'));
      const chosen=new Set(values);selected.set(index,chosen);
      const details=el('details','filter'),summary=el('summary','',col),menu=el('div','offline-filter-menu'),tools=el('div','tools'),options=el('div','filter-options');
      for(const [label,all] of [['Select All',true],['Deselect All',false]]){const b=el('button','',label);b.type='button';b.onclick=()=>{chosen.clear();if(all)values.forEach(v=>chosen.add(v));options.querySelectorAll('input').forEach(x=>x.checked=all);page=1;draw();};tools.append(b);}
      for(const value of values){const label=el('label'),check=el('input');check.type='checkbox';check.checked=true;check.onchange=()=>{check.checked?chosen.add(value):chosen.delete(value);page=1;draw();};label.append(check,el('span','',value||'(Kosong)'));options.append(label);}
      menu.append(tools,options);details.append(summary,menu);filterControls.append(details);
    }
    controls.append(filterControls);root.append(controls);
    const panel=el('section','data-panel'),scroll=el('div','overflow'),table=el('table','data'),head=el('thead'),header=el('tr'),body=el('tbody'),pagination=el('div','pagination');scroll.tabIndex=0;scroll.setAttribute('aria-label','Data tabel, geser ke samping');
    let sort=-1,descending=false,page=1;const visible=t.visible.map(c=>t.columns.indexOf(c));
    const headers=[];
    for(const col of t.visible){const th=el('th'),button=el('button','sort-header',col+' ↕'),index=t.columns.indexOf(col);button.onclick=()=>{descending=sort===index?!descending:false;sort=index;page=1;draw();};th.append(button);header.append(th);headers.push({th,button,col,index});}
    head.append(header);table.append(head,body);scroll.append(table);panel.append(scroll,pagination);root.append(panel);
    function numeric(v){if(typeof v==='number')return v;const s=String(v).trim();if(!/^[+-]?[\d.,]+$/.test(s))return NaN;return Number(s.includes(',')?s.replaceAll('.','').replace(',','.'):s.replace(/\.(?=\d{3}(?:\.|$))/g,''));}
    function draw(){
      const q=search.value.toLocaleLowerCase('id');let rows=t.rows.filter(row=>[...selected].every(([i,set])=>set.has(String(row[i]??'')))&&(!q||visible.some(i=>(String(row[i]??'')+' '+cell(row[i],t.columns[i])).toLocaleLowerCase('id').includes(q))));
      if(sort>=0){const blank=v=>v===null||String(v).trim()==='';const numericColumn=rows.filter(r=>!blank(r[sort])).every(r=>Number.isFinite(numeric(r[sort])));rows.sort((a,b)=>{const av=a[sort],bv=b[sort];if(blank(av)||blank(bv))return Number(blank(av))-Number(blank(bv));const result=numericColumn?numeric(av)-numeric(bv):String(av).localeCompare(String(bv),'id');return descending?-result:result;});}
      headers.forEach(({th,button,col,index})=>{th.setAttribute('aria-sort',index===sort?(descending?'descending':'ascending'):'none');button.textContent=col+' '+(index===sort?(descending?'↓':'↑'):'↕');});
      const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.min(page,pages);body.replaceChildren();
      rows.slice((page-1)*50,page*50).forEach(row=>{const tr=el('tr');visible.forEach(i=>tr.append(el('td','',cell(row[i],t.columns[i]))));body.append(tr);});
      if(!rows.length){const tr=el('tr'),td=el('td','empty','Tidak ada data yang cocok.');td.colSpan=visible.length;tr.append(td);body.append(tr);}
      pagination.replaceChildren(el('span','',page+' / '+pages));const buttons=el('div');for(const [label,step,disabled] of [['←',-1,page===1],['→',1,page===pages]]){const b=el('button','icon-button',label);b.disabled=disabled;b.setAttribute('aria-label',step<0?'Sebelumnya':'Berikutnya');b.onclick=()=>{page+=step;draw();scroll.scrollTop=0;};buttons.append(b);}pagination.append(buttons);
    }
    search.addEventListener('input',()=>{page=1;draw();});draw();
  }
  document.addEventListener('cekjo:synced',event=>{snapshot=event.detail;if(location.pathname.startsWith('/admin/settings')||location.pathname==='/login')location.reload();else render();});
  render();
})();
