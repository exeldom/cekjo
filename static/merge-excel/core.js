/* Values only: never carry formulas or links into the merged workbook. */
async function appendExcelSheet(XLSX, workbook, output, first, yieldUI=()=>Promise.resolve()) {
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet || !sheet['!ref']) throw new Error('Sheet pertama kosong.');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  const values=row=>Array.from({length:10},(_,column)=>{
    const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];
    if(cell?.f && cell.v==null) throw new Error('Ada rumus tanpa nilai tersimpan. Simpan ulang file melalui Excel.');
    return cell && cell.t!=='z' ? cell : null;
  });
  const filled=cells=>cells.some(cell=>cell?.v!=null && String(cell.v).trim()!=='');
  const headers=[values(5),values(6)];
  if(range.e.r<6 || !headers.every(filled)) throw new Error('Header baris 6 dan 7 tidak tersedia.');
  function append(cells){
    if(output.rows>=1048576) throw new Error('Hasil melebihi batas 1.048.576 baris Excel.');
    for(let col=0;col<10;col++){
      const cell=cells[col];
      if(cell?.v==null) continue;
      const copy={t:cell.t,v:cell.v};
      if(cell.z) copy.z=cell.z;
      output.sheet[XLSX.utils.encode_cell({r:output.rows,c:col})]=copy;
    }
    output.rows++;
  }
  if(first) append(['No.','Tanggal TBP','Nomor TBP','Unit SKPD','Nama Penerima','Keterangan','Jenis TBP','Bruto','Potongan','Neto'].map(v=>({t:'s',v})));
  let added=0;
  for(let row=7;row<=range.e.r;row++){
    const cells=values(row);
    if(filled(cells)){append(cells);added++;}
    if(row%2000===0) await yieldUI();
  }
  output.sheet['!ref']=`A1:J${output.rows}`;
  output.sheet['!autofilter']={ref:output.sheet['!ref']};
  output.sheet['!cols']=Array.from({length:10},()=>({wch:20}));
  return added;
}
if(typeof module!=='undefined') module.exports=appendExcelSheet;
