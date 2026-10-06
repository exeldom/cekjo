(function(scope){
  function hierarchy(data){
    const real=new Map(data.realisasi.map(row=>[JSON.stringify(row.slice(0,5)),BigInt(row[5])]));
    const root={name:data.name,code:data.code,level:0,pagu:0n,real:0n,children:new Map()};
    for(const row of data.pagu){
      const codes=[row[0],row[2],row[4],row[6],row[8]],amount=BigInt(row[10]),spent=real.get(JSON.stringify(codes))||0n;
      let node=root;node.pagu+=amount;node.real+=spent;
      for(let i=0;i<5;i++){
        if(!node.children.has(codes[i]))node.children.set(codes[i],{name:row[i*2+1],code:codes[i],level:i+1,pagu:0n,real:0n,children:new Map()});
        node=node.children.get(codes[i]);node.pagu+=amount;node.real+=spent;
      }
    }
    return root;
  }
  function money(cents){const negative=cents<0n;const n=negative?-cents:cents;return (negative?'-':'')+'Rp'+(n/100n).toLocaleString('id-ID')+','+(n%100n).toString().padStart(2,'0');}
  function percent(real,pagu){if(pagu===0n)return null;const negative=(real<0n)!==(pagu<0n);const a=real<0n?-real:real,b=pagu<0n?-pagu:pagu;return Number((a*10000n+b/2n)/b)/100*(negative?-1:1);}
  const api={hierarchy,money,percent};if(typeof module!=='undefined')module.exports=api;else scope.Realisasi=api;
})(globalThis);
