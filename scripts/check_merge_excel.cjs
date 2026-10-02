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
  assert.equal(out.rows,1222);assert.equal(out.sheet.A1.v,'Header 6');assert.equal(out.sheet.A2.v,'Header 7');
  assert.equal(out.sheet.A1203.v,0);assert.equal(out.sheet.J1222.v,25.5);assert.equal(out.sheet.B3.v,'00123');
  assert.equal(out.sheet.C3.t,'d');assert.equal(out.sheet.A3.t,'n');assert.equal(out.sheet.K3,undefined);
  console.log('OK: 1.220 baris data, header sekali, A–J, baris kosong, tipe sel dan sheet pertama.');
})().catch(error=>{console.error(error);process.exitCode=1;});
