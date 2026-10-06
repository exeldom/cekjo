/* Values only: never carry formulas or links into the merged workbook. */
async function appendExcelSheet(XLSX, workbook, output, first, yieldUI=()=>Promise.resolve()) {
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet || !sheet['!ref']) throw new Error('Sheet pertama kosong.');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  const values=row=>Array.from({length:45},(_,column)=>{
    const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];
    return cell && cell.t!=='z' ? cell : null;
  });
  const filled=cells=>cells.some(cell=>cell?.f || (cell?.v!=null && String(cell.v).trim()!==''));
  const header=values(4);
  if(range.e.r<4 || !filled(header)) throw new Error('Header baris 5 tidak tersedia.');
  function append(cells){
    if(output.rows>=1048576) throw new Error('Hasil melebihi batas 1.048.576 baris Excel.');
    for(let col=0;col<45;col++){
      const cell=cells[col];
      if(cell?.f && cell.v==null) throw new Error('Ada rumus tanpa nilai tersimpan. Simpan ulang file melalui Excel.');
      if(cell?.v==null) continue;
      const copy={t:cell.t,v:cell.v};
      if(cell.z) copy.z=cell.z;
      output.sheet[XLSX.utils.encode_cell({r:output.rows,c:col})]=copy;
    }
    output.rows++;
  }
  if(first) append(header);
  let added=0,last=null;
  for(let row=5;row<=range.e.r;row++){
    const cells=values(row);
    if(filled(cells)){
      if(last){append(last);added++;}
      last=cells;
    }
    if(row%2000===0) await yieldUI();
  }
  // The final populated A–AS row of each file is its total and is discarded.
  output.sheet['!ref']=`A1:AS${output.rows}`;
  output.sheet['!autofilter']={ref:output.sheet['!ref']};
  output.sheet['!cols']=Array.from({length:45},()=>({wch:20}));
  return added;
}
if(typeof module!=='undefined') module.exports=appendExcelSheet;
