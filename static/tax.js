(() => {
  const {categories,calculate,formatAmount} = KosongTax;
  const grid=document.getElementById('tax-grid'), tip=document.getElementById('tax-tooltip');
  let active=null, pinned=false;
  const state = new Map();
  const element=(tag,className,text) => {const e=document.createElement(tag); if(className)e.className=className; if(text!==undefined)e.textContent=text; return e;};
  function positionTip(){
    if(!active)return;
    const r=active.getBoundingClientRect(), height=tip.offsetHeight, width=tip.offsetWidth;
    tip.style.left=Math.max(12,Math.min(r.left,innerWidth-width-12))+'px';
    tip.style.top=Math.max(12,r.bottom+height+12<innerHeight?r.bottom+8:r.top-height-8)+'px';
  }
  function closeTip(){if(active)active.setAttribute('aria-expanded','false');active=null;pinned=false;tip.hidden=true;}
  function showTip(button){
    if(active && active!==button)active.setAttribute('aria-expanded','false');
    active=button;button.setAttribute('aria-expanded','true');
    const row=state.get(button.dataset.card).results[Number(button.dataset.row)];
    tip.replaceChildren(element('strong','',row.label),element('p','tax-fullname',row.fullName));
    if(row.note)tip.append(element('p','',row.note+'.'));
    else {
      tip.append(element('small','','Rumus'),element('p','',row.formula));
      tip.append(element('small','','Perhitungan'),element('p','',row.amount?row.expression:'—'));
      tip.append(element('small','','Hasil'),element('strong','tax-tip-result',row.display));
    }
    tip.hidden=false;positionTip();
  }
  function update(card,digits){
    card.results=calculate(card.category,digits);
    card.results.forEach((r,i)=>card.outputs[i].textContent=r.display);
    if(active?.dataset.card===card.category.id)showTip(active);
  }
  function formatInput(input,card){
    const formatted=formatAmount(input.value,input.selectionStart??input.value.length);
    input.value=formatted.text;
    input.setSelectionRange(formatted.caret,formatted.caret);
    update(card,formatted.amount);
  }
  for(const category of categories){
    const card={category,outputs:[],results:[]};state.set(category.id,card);
    const section=element('section','tax-card');
    const heading=element('h2','',category.title); heading.id='title-'+category.id; section.setAttribute('aria-labelledby',heading.id);
    const label=element('label','tax-input-label','Nilai');label.htmlFor='nilai-'+category.id;
    const input=element('input','tax-input');input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.placeholder='Rp';input.id=label.htmlFor;
    label.append(input);section.append(heading,label);
    const results=element('dl','tax-results');
    calculate(category,'').forEach((row,i)=>{
      const line=element('div','tax-result');const term=element('dt');const button=element('button','tax-label',row.label);
      button.type='button';button.dataset.card=category.id;button.dataset.row=i;button.setAttribute('aria-expanded','false');button.setAttribute('aria-describedby','tax-tooltip');button.setAttribute('aria-label',row.label+' · lihat rumus');
      button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&!pinned)showTip(button);});
      button.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!pinned)closeTip();});
      button.addEventListener('focus',()=>{if(!pinned)showTip(button);});
      button.addEventListener('blur',()=>{if(!pinned)closeTip();});
      button.addEventListener('click',()=>{if(active===button&&pinned)closeTip();else{pinned=true;showTip(button);}});
      const output=element('dd','tax-value','—');card.outputs.push(output);term.append(button);line.append(term,output);results.append(line);
    });
    section.append(results);grid.append(section);card.input=input;update(card,'');
    input.addEventListener('input',()=>formatInput(input,card));
    // Delete the adjacent digit when the caret sits next to a formatting dot.
    input.addEventListener('beforeinput',e=>{
      const start=input.selectionStart,end=input.selectionEnd;
      if(start!==end)return;
      let index=-1;
      if(e.inputType==='deleteContentBackward' && input.value[start-1]==='.')index=start-2;
      if(e.inputType==='deleteContentForward' && input.value[start]==='.')index=start+1;
      if(index<0)return;
      e.preventDefault();input.setRangeText('',index,index+1,'start');formatInput(input,card);
    });
  }
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.tax-label')&&!tip.contains(e.target))closeTip();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTip();});
  window.addEventListener('resize',positionTip);
  window.addEventListener('scroll',closeTip,{passive:true});
  // Also clear browser-restored form state when returning via back/forward cache.
  window.addEventListener('pageshow',()=>{for(const card of state.values()){card.input.value='';update(card,'');}closeTip();});
})();
