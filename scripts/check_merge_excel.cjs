const assert=require('node:assert/strict');
const XLSX=require('../static/merge-excel/vendor/xlsx.js');
const append=require('../static/merge-excel/core.js');
(async()=>{
  function source(count){
    const rows=Array.from({length:4},()=>['BUANG']);
    rows.push(Array.from({length:45},(_,i)=>`Kolom ${i+1}`));
    for(let i=0;i<count;i++){
      const row=Array(46).fill(null);row[0]=i;row[1]='00123';row[2]=new Date(2026,0,2);row[44]=25.5;row[45]='BUANG';rows.push(row);
    }
    rows.splice(15,0,[]);
    rows.push(['TOTAL']);rows.push([],[]);
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows,{cellDates:true}),'Pertama');
    const sheet=book.Sheets.Pertama;sheet['!ref']=`A1:AT${rows.length+3}`;sheet[`B${rows.length-2}`]={t:'n',f:'SUM(B6:B10)'};
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['BUANG']]),'Kedua');
    return XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellDates:true,cellNF:true});
  }
  const out={sheet:{},rows:0};
  assert.equal(await append(XLSX,source(1200),out,true),1200);
  assert.equal(await append(XLSX,source(20),out,false),20);
  assert.equal(out.rows,1221);
  assert.deepEqual(Array.from({length:45},(_,c)=>out.sheet[XLSX.utils.encode_cell({r:0,c})].v),Array.from({length:45},(_,i)=>`Kolom ${i+1}`));
  assert.equal(out.sheet.A1202.v,0);assert.equal(out.sheet.AS1221.v,25.5);assert.equal(out.sheet.B2.v,'00123');
  assert.equal(out.sheet.C2.t,'d');assert.equal(out.sheet.A2.t,'n');assert.equal(out.sheet.AT2,undefined);
  assert.ok(!Object.values(out.sheet).some(cell=>cell?.v==='TOTAL'));
  const result=XLSX.utils.book_new();XLSX.utils.book_append_sheet(result,out.sheet,'Gabungan');
  const restored=XLSX.read(XLSX.write(result,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets.Gabungan;
  assert.equal(restored['!autofilter'].ref,'A1:AS1221');assert.equal(restored['!merges'],undefined);
  console.log('OK: 1.220 baris data, header sekali, A–AS, total tiap file dibuang, baris kosong, tipe sel dan sheet pertama.');
})().catch(error=>{console.error(error);process.exitCode=1;});
