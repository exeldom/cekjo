const picker=document.getElementById('merge-picker'),drop=document.getElementById('merge-drop'),list=document.getElementById('merge-files'),run=document.getElementById('merge-run'),status=document.getElementById('merge-status');
let files=[],busy=false;
function render(){
  list.replaceChildren();
  files.forEach((file,index)=>{
    const row=document.createElement('li'),name=document.createElement('span'),remove=document.createElement('button');
    name.textContent=`${index+1}. ${file.name}`;
    remove.type='button';remove.textContent='×';remove.className='icon-button';remove.setAttribute('aria-label',`Hapus ${file.name}`);remove.disabled=busy;
    remove.onclick=()=>{files.splice(index,1);render();status.textContent='';};
    row.append(name,remove);list.append(row);
  });
  picker.disabled=busy;run.disabled=busy||!files.length;drop.setAttribute('aria-disabled',String(busy));
}
function add(incoming){
  if(busy)return;
  const batch=Array.from(incoming);
  if(batch.some(file=>!file.name.toLowerCase().endsWith('.xlsx'))){status.textContent='Pilih file .xlsx saja.';return;}
  files.push(...batch);render();status.textContent='';
}
picker.addEventListener('change',()=>{add(picker.files);picker.value='';});
for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();if(!busy)drop.classList.add('dragging');});
for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('dragging');});
drop.addEventListener('drop',event=>add(event.dataTransfer.files));
const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
run.addEventListener('click',async()=>{
  if(busy||!files.length)return;
  busy=true;render();let current='';
  try{
    if(!window.XLSX)throw new Error('Library Excel belum tersedia. Muat ulang halaman.');
    const output={sheet:{},rows:0};let count=0;
    for(let i=0;i<files.length;i++){
      current=files[i].name;status.textContent=`Memproses ${i+1}/${files.length}: ${current}`;await yieldUI();
      let workbook;
      try{workbook=XLSX.read(await files[i].arrayBuffer(),{type:'array',cellDates:true,cellNF:true});}
      catch(error){throw new Error('File tidak dapat dibaca. Pastikan XLSX valid dan tidak diproteksi password.');}
      count+=await appendExcelSheet(XLSX,workbook,output,i===0,yieldUI);
    }
    current='';status.textContent=`Menyiapkan ${count.toLocaleString('id-ID')} baris…`;await yieldUI();
    const merged=XLSX.utils.book_new();XLSX.utils.book_append_sheet(merged,output.sheet,'Gabungan');
    XLSX.writeFile(merged,'gabungan.xlsx',{compression:true});
    status.textContent=`Selesai: ${files.length} file, ${count.toLocaleString('id-ID')} baris data.`;
  }catch(error){status.textContent=(current?`${current}: `:'')+error.message;}
  finally{busy=false;render();}
});
render();
