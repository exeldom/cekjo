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
  function formatAmount(raw, cursor=raw.length) {
    const clean = raw.replace(/[^0-9,]/g, '');
    if (!clean) return {text:'', amount:'', caret:0};
    const comma = clean.indexOf(',');
    const originalWhole = comma < 0 ? clean : clean.slice(0,comma);
    const whole = originalWhole.replace(/^0+(?=\d)/, '') || '0';
    const fraction = comma < 0 ? '' : clean.slice(comma+1).replace(/,/g,'');
    const amount = whole + (comma < 0 ? '' : ','+fraction);
    const text = 'Rp'+group(whole)+(comma < 0 ? '' : ','+fraction);
    const prefix = raw.slice(0,cursor).replace(/[^0-9,]/g, '');
    let count;
    if (comma >= 0 && prefix.includes(',')) {
      count = whole.length+1+prefix.slice(prefix.indexOf(',')+1).replace(/,/g,'').length;
    } else {
      count = Math.max(0,prefix.length-Math.max(0,originalWhole.length-whole.length));
    }
    let caret=2, seen=0;
    for (let i=2; i<text.length && seen<count; i++) {
      if (/[0-9,]/.test(text[i])) seen++;
      caret=i+1;
    }
    return {text,amount,caret};
  }
  function calculate(category, digits) {
    const hasValue = /^\d+(?:,\d*)?$/.test(digits);
    const [whole, fraction=''] = digits.split(',');
    const value = hasValue ? ratio(whole+fraction, 10n ** BigInt(fraction.length)) : null;
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
  const api={categories,calculate,round,rupiah,exactText,group,formatAmount};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.KosongTax=api;
})(typeof globalThis!=='undefined'?globalThis:this);
