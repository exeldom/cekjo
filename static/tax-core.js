/* Shared configuration and exact rational arithmetic; no intermediate rounding. */
(function (root) {
  const standard = (id, title, label, rate, percent) => ({id, title, mode:'standard', label, rate, percent});
  const categories = [
    standard('barang','Belanja ATK / Alat Kantor / Barang','PPh 22',150,'1,5%'),
    {id:'makan',title:'Belanja Makan Minum',mode:'meal',label:'PPh 23',rate:200,percent:'2%'},
    standard('jasa','Belanja Jasa / Sewa Kendaraan, dll.','PPh 23',200,'2%'),
    standard('kecil','Konstruksi / Pembangunan (SBU Kecil)','PPh 4 (2)',175,'1,75%'),
    standard('menengah','Konstruksi / Pembangunan (SBU Menengah / Besar / Spesialis)','PPh 4 (2)',265,'2,65%'),
    standard('tanpa-sbu','Konstruksi / Pembangunan (Tanpa SBU / Sertifikat)','PPh 4 (2)',400,'4%'),
    standard('konsultan','Konsultansi Konstruksi (Bersertifikat)','PPh 4 (2)',350,'3,5%'),
    standard('konsultan-tanpa','Konsultansi Konstruksi (Tanpa SBU / Sertifikat)','PPh 4 (2)',600,'6%'),
    standard('gedung','Sewa Gedung / Tanah dan Bangunan','PPh 4 (2)',1000,'10%'),
    {id:'hotel',title:'Sewa Hotel / Jasa Perhotelan',mode:'hotel',label:'PPh 23',rate:200,percent:'2%'}
  ];
  const ratio = (n,d=1n) => ({n:BigInt(n),d:BigInt(d)});
  const multiply = (r,n,d=1) => ratio(r.n*BigInt(n),r.d*BigInt(d));
  const round = r => (2n*r.n+r.d)/(2n*r.d);
  const group = digits => String(digits).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const rupiah = n => 'Rp'+group(n);
  const exactText = r => {
    let remainder=r.n%r.d, fraction='';
    for(let i=0; i<12 && remainder; i++){remainder*=10n; fraction+=String(remainder/r.d); remainder%=r.d;}
    return rupiah(r.n/r.d)+(fraction ? ','+fraction+(remainder?'…':'') : '');
  };
  function calculate(category, digits) {
    const hasValue = /^\d+$/.test(digits);
    const value = hasValue ? ratio(digits) : null;
    const dpp = value && (category.mode==='standard' ? multiply(value,100,111) : value);
    const item = (label, fullName, formula, expression, amount, note='') => ({label, fullName, formula, expression, amount, note, display:!hasValue?'—':note||rupiah(round(amount))});
    const valueText = value ? exactText(value) : 'Nilai';
    const dppText = dpp ? exactText(dpp) : 'DPP';
    const result = [item('DPP','Dasar Pengenaan Pajak',category.mode==='standard'?'Nilai × 100 / 111':'Nilai',category.mode==='standard'?valueText+' × 100 / 111':valueText,dpp,category.mode==='meal'?'Tanpa DPP':'')];
    if(category.mode!=='meal') result.push(item('PPN','Pajak Pertambahan Nilai','DPP × 11/12 × 12%',dppText+' × 11/12 × 12%',dpp && multiply(dpp,11,100),category.mode==='hotel'?'Tidak Dikenakan':''));
    result.push(item(category.label,'Pajak Penghasilan '+category.label.replace('PPh ', 'Pasal '),(category.mode==='standard'?'DPP':'Nilai')+' × '+category.percent,(category.mode==='standard'?dppText:valueText)+' × '+category.percent,dpp && multiply(dpp,category.rate,10000)));
    if(category.mode==='meal') result.push(item('PBJT','Pajak Barang dan Jasa Tertentu','Nilai × 10%',valueText+' × 10%',value && multiply(value,10,100)));
    return result;
  }
  const api={categories,calculate,round,rupiah,exactText,group};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.KosongTax=api;
})(typeof globalThis!=='undefined'?globalThis:this);
