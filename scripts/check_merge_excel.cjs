const assert=require('node:assert/strict');
const XLSX=require('../static/merge-excel/vendor/xlsx.js');
const append=require('../static/merge-excel/core.js');
(async()=>{
  function source(count){
    const rows=Array.from({length:5},()=>['BUANG']);
    rows.push(['Header 6'],['Header 7']);
    for(let i=0;i<count;i++)rows.push([i,'00123',new Date(2026,0,2),null,null,null,null,null,null,25.5,'BUANG']);
    rows.splice(15,0,[]);
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows,{cellDates:true}),'Pertama');
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['BUANG']]),'Kedua');
    return XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellDates:true,cellNF:true});
  }
  const out={sheet:{},rows:0};
  assert.equal(await append(XLSX,source(1200),out,true),1200);
  assert.equal(await append(XLSX,source(20),out,false),20);
  assert.equal(out.rows,1221);
  assert.deepEqual(Array.from({length:10},(_,c)=>out.sheet[XLSX.utils.encode_cell({r:0,c})].v),['No.','Tanggal TBP','Nomor TBP','Unit SKPD','Nama Penerima','Keterangan','Jenis TBP','Bruto','Potongan','Neto']);
  assert.equal(out.sheet.A1202.v,0);assert.equal(out.sheet.J1221.v,25.5);assert.equal(out.sheet.B2.v,'00123');
  assert.equal(out.sheet.C2.t,'d');assert.equal(out.sheet.A2.t,'n');assert.equal(out.sheet.K2,undefined);
  const result=XLSX.utils.book_new();XLSX.utils.book_append_sheet(result,out.sheet,'Gabungan');
  const restored=XLSX.read(XLSX.write(result,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets.Gabungan;
  assert.equal(restored['!autofilter'].ref,'A1:J1221');assert.equal(restored['!merges'],undefined);
  console.log('OK: 1.220 baris data, header sekali, A–J, baris kosong, tipe sel dan sheet pertama.');
})().catch(error=>{console.error(error);process.exitCode=1;});
