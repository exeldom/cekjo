const config=JSON.parse(document.getElementById('viewer-config').textContent);
const $=id=>document.getElementById(id),root=$('view-content'),message=$('view-message');
const vendor='/static/preview-vendor/';
let expired=false,pdf=null,renderTask=null,page=1,pages=1,draw=null,busy=false;
let serverOffset=config.server_now*1000-Date.now();
const abort=new AbortController();
function expire(){if(expired)return;expired=true;abort.abort();renderTask?.cancel();pdf?.destroy();draw=null;root.replaceChildren();$('view-tools').hidden=true;$('view-note').textContent='';$('expiry').textContent='';message.textContent='Akses sudah berakhir.';}
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
function script(path){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=vendor+path;s.onload=resolve;s.onerror=()=>reject(new Error('Komponen preview gagal dimuat.'));document.head.append(s);});}
function zipBudget(buffer){
  const v=new DataView(buffer);let end=-1;
  for(let i=v.byteLength-22;i>=Math.max(0,v.byteLength-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Dokumen bukan berkas ZIP Office yang valid.');
  const count=v.getUint16(end+10,true);let pos=v.getUint32(end+16,true),total=0;
  if(count>20000)throw new Error('Dokumen terlalu kompleks untuk preview.');
  for(let i=0;i<count;i++){
    if(pos+46>v.byteLength||v.getUint32(pos,true)!==0x02014b50)throw new Error('Struktur dokumen tidak valid.');
    total+=v.getUint32(pos+24,true);
    if(total>80*1024*1024||(v.getUint16(pos+8,true)&1))throw new Error('Dokumen terlalu besar setelah dibuka atau diproteksi password.');
    pos+=46+v.getUint16(pos+28,true)+v.getUint16(pos+30,true)+v.getUint16(pos+32,true);
  }
}
function updateButtons(){$('view-page').textContent=page+' / '+pages;$('view-prev').disabled=busy||page<=1;$('view-next').disabled=busy||page>=pages;}
async function render(){if(!draw||busy||!clock())return;busy=true;updateButtons();try{await draw();}catch(e){if(!expired)message.textContent='Preview gagal ditampilkan.';}finally{busy=false;updateButtons();}}
$('view-prev').onclick=()=>{if(page>1&&!busy){page--;render();}};$('view-next').onclick=()=>{if(page<pages&&!busy){page++;render();}};
async function readFile(){
  if(config.size>10*1024*1024)throw new Error('Preview maksimal 10 MB.');
  const response=await fetch(config.url,{mode:'cors',credentials:'omit',cache:'no-store',signal:abort.signal});
  if(!response.ok)throw new Error('File tidak tersedia. Buka kembali link bila akses masih berlaku.');
  const length=Number(response.headers.get('content-length'));if(length>10*1024*1024)throw new Error('Preview maksimal 10 MB.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Browser ini belum mendukung preview.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();throw new Error('Preview maksimal 10 MB.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
async function start(){
  if(config.kind==='text'||!clock())return;
  try{
    const buffer=await readFile();if(!clock())return;
    if(config.extension==='pdf'){
      const base=vendor+'pdfjs-dist-6.3.289/';
      const lib=await import(base+'legacy/build/pdf.mjs');lib.GlobalWorkerOptions.workerSrc=base+'legacy/build/pdf.worker.mjs';
      pdf=await lib.getDocument({data:buffer,isEvalSupported:false,enableXfa:false,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/'}).promise;
      if(!clock()){pdf.destroy();return;}
      pages=pdf.numPages;draw=async()=>{const p=await pdf.getPage(page);if(!clock())return;const original=p.getViewport({scale:1});const scale=Math.min(Math.min(1200,root.clientWidth-36)/original.width,4096/original.height);const viewport=p.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);root.replaceChildren(canvas);renderTask=p.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;p.cleanup();};
      $('view-tools').hidden=false;await render();
    }else if(config.extension==='xlsx'){
      zipBudget(buffer);await script('sheetjs-0.20.3/xlsx.full.min.js');if(!clock())return;
      const workbook=XLSX.read(buffer,{type:'array',sheetRows:10001,cellHTML:false,cellFormula:false,cellStyles:false});
      const select=$('view-sheet');select.hidden=false;
      for(const name of workbook.SheetNames){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}
      draw=()=>{
        const sheet=workbook.Sheets[select.value],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
        const rows=Math.min(10000,range.e.r-range.s.r+1),cols=Math.min(100,range.e.c-range.s.c+1);pages=Math.max(1,Math.ceil(rows/100));
        const table=document.createElement('table'),body=document.createElement('tbody');
        for(let r=range.s.r+(page-1)*100;r<Math.min(range.s.r+rows,range.s.r+page*100);r++){
          const tr=document.createElement('tr');for(let c=range.s.c;c<range.s.c+cols;c++){const td=document.createElement('td'),cell=sheet[XLSX.utils.encode_cell({r,c})];td.textContent=cell?XLSX.utils.format_cell(cell):'';tr.append(td);}body.append(tr);
        }
        table.append(body);root.replaceChildren(table);
        $('view-note').textContent=(sheet['!fullref']||range.e.c-range.s.c+1>100)?'Preview dibatasi hingga 10.000 baris dan 100 kolom per sheet.':'';
      };
      select.onchange=()=>{page=1;render();};$('view-tools').hidden=false;await render();
    }else if(config.extension==='docx'){
      zipBudget(buffer);await Promise.all([script('mammoth-1.12.3/mammoth.browser.min.js'),script('dompurify-3.4.16/dist/purify.min.js')]);
      const converted=await mammoth.convertToHtml({arrayBuffer:buffer});if(!clock())return;
      const clean=DOMPurify.sanitize(converted.value,{RETURN_DOM_FRAGMENT:true,FORBID_TAGS:['style','script','iframe','form','input','button','object','embed','svg','math','link','meta','video','audio','source'],FORBID_ATTR:['style','srcset'],ALLOW_DATA_ATTR:false,ALLOWED_URI_REGEXP:/^data:image\/(?:png|jpeg|gif|webp);base64,/i});
      clean.querySelectorAll('a').forEach(a=>a.replaceWith(...a.childNodes));
      clean.querySelectorAll('img').forEach(img=>{if(!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.getAttribute('src')||''))img.remove();});
      root.replaceChildren(clean);$('view-note').textContent='Tampilan isi dokumen; tata letak dapat berbeda dari Word.';
    }else if(config.extension==='txt'){
      const text=new TextDecoder('utf-8').decode(buffer),pre=document.createElement('pre');pre.textContent=text.slice(0,500000);root.replaceChildren(pre);if(text.length>500000)$('view-note').textContent='Preview menampilkan 500.000 karakter pertama.';
    }else throw new Error('Format preview tidak didukung.');
    if(clock())message.textContent='';
  }catch(e){if(!expired){root.replaceChildren();message.textContent=e.message||'Preview gagal dibuka.';}}
}
start();
