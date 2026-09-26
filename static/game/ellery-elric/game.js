(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ROOT='/static/game/ellery-elric/', PAGE='/game/ellery-elric';
  const asset = path => ELCI.media_root+path+(ELCI.media_suffix||'');
  let game=null;
  let forest=null, paused=false, muted=false, ready=false;
  const held=new Set(), taps=new Set(), pointers=new Map(), keyboard=new Set();
  const portrait=()=>$('game-shell').clientHeight>$('game-shell').clientWidth;
  function clearInput(){held.clear();taps.clear();pointers.clear();keyboard.clear();document.querySelectorAll('.pressed').forEach(e=>e.classList.remove('pressed'));}
  function updateHeld(){held.clear();for(const key of [...pointers.values(),...keyboard])held.add(key);document.querySelectorAll('[data-key]').forEach(b=>b.classList.toggle('pressed',held.has(b.dataset.key)));}
  function freeze(){
    clearInput();
    if(!forest)return;
    const stop=paused||portrait()||forest.finished;
    forest.player.setVelocityX(0);
    if(stop){forest.physics.pause();forest.tweens.pauseAll();}
    else {forest.physics.resume();forest.tweens.resumeAll();}
  }
  function pause(value){if(!forest||forest.finished)return;paused=value;$('pause-panel').hidden=!value;freeze();}
  function orientation(){
    const view=window.visualViewport,shell=$('game-shell');
    shell.style.width=(view?.width||innerWidth)+'px';shell.style.height=(view?.height||innerHeight)+'px';
    $('rotate').hidden=!portrait();freeze();
    requestAnimationFrame(()=>game?.scale.refresh());
  }
  const keyMap={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',Space:'jump',ArrowUp:'jump',KeyE:'power',KeyQ:'switch'};
  addEventListener('keydown',e=>{if(e.code==='Escape'){pause(!paused);return;}const k=keyMap[e.code];if(!k||!forest)return;e.preventDefault();if(paused||portrait()||forest.finished)return;if(!e.repeat)taps.add(k);keyboard.add(k);updateHeld();});
  addEventListener('keyup',e=>{const k=keyMap[e.code];if(k){keyboard.delete(k);updateHeld();}});
  document.querySelectorAll('[data-key]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{e.preventDefault();if(!forest||paused||portrait()||forest.finished)return;button.setPointerCapture(e.pointerId);pointers.set(e.pointerId,button.dataset.key);taps.add(button.dataset.key);updateHeld();});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>{pointers.delete(e.pointerId);updateHeld();});
  });
  $('pause').onclick=()=>pause(true);$('resume').onclick=()=>pause(false);
  $('sound').onclick=()=>{muted=!muted;if(forest)forest.sound.mute=muted;$('sound').textContent='Suara: '+(muted?'mati':'aktif');};
  const replay=()=>{paused=false;clearInput();$('pause-panel').hidden=true;$('reward-panel').hidden=true;forest.scene.restart();};
  $('restart').onclick=replay;$('again').onclick=replay;
  addEventListener('resize',orientation);
  window.visualViewport?.addEventListener('resize',orientation);
  addEventListener('orientationchange',()=>requestAnimationFrame(orientation));
  document.addEventListener('fullscreenchange',orientation);
  addEventListener('pageshow',orientation);
  addEventListener('blur',()=>{clearInput();if(forest&&!forest.finished)pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(forest&&!forest.finished)pause(true);}else orientation();});
  orientation();

  class Boot extends Phaser.Scene {
    constructor(){super('Boot');}
    preload(){
      this.load.setCORS('anonymous');
      this.load.on('loaderror',()=>{$('load-message').textContent='Aset belum lengkap. Sambungkan internet, lalu buka kembali game.';this.failed=true;});
      for(const key of ['ellery','elric'])this.load.image(key+'-sheet',asset('assets/'+key+'-sprites.png'));
      this.load.image('props-sheet',asset('assets/props-atlas.png'));
      this.load.image('forest',asset('assets/forest-background.png'));
      for(const key of ['jump','star','power','finish'])this.load.audio(key,asset('audio/'+key+'.wav'));
    }
    create(){
      if(this.failed)return;
      ElciArt.prepare(this);
      this.add.image(640,360,'forest').setDisplaySize(1920,720);
      ready=true;$('start').disabled=false;$('start').textContent='Mulai Petualangan';
      $('start').onclick=()=>{
        if(!ready||portrait())return;
        try{this.sound.context?.resume()?.catch(()=>{});}catch{}
        try{if(!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches&&this.scale.fullscreen.available)this.scale.startFullscreen();}catch{}
        $('start-panel').hidden=true;this.scene.start('Forest');
      };
    }
  }

  class Forest extends Phaser.Scene {
    constructor(){super('Forest');}
    create(){
      forest=this;paused=false;this.active='ellery';this.castUntil=0;this.powers={ellery:false,elric:false};this.finished=false;this.stars=0;this.cooldown=0;this.facing=1;this.trail=[];this.toastUntil=0;this.hintTag=null;
      this.sound.mute=muted;clearInput();$('hud').hidden=false;$('controls').hidden=false;$('stars').textContent='0';$('hint').hidden=true;
      this.physics.world.setBounds(0,0,4200,720);
      this.cameras.main.setBounds(0,0,4200,720);
      this.backdrop=this.add.image(0,0,'forest').setOrigin(0).setDisplaySize(2160,720).setScrollFactor(0).setDepth(-10);
      this.add.rectangle(2100,670,4200,140,0x614d32).setDepth(-2);
      for(let x=-80;x<4400;x+=260)this.add.image(x,593,'platform').setOrigin(0,0).setDisplaySize(300,180).setDepth(-1);
      this.platforms=this.physics.add.staticGroup();
      const floor=this.add.rectangle(2100,660,4200,120,0x000000,0);this.platforms.add(floor);
      for(const [x,y] of [[510,521],[1810,531],[2910,521]]){
        this.add.image(x,y-10,'platform').setOrigin(.5,0).setDisplaySize(220,85);
        this.platforms.add(this.add.rectangle(x,y,200,20,0,0));
      }
      this.player=this.physics.add.sprite(130,600,'ellery',4).setOrigin(.5,310/320).setScale(.68).setDepth(5);
      this.player.body.setSize(65,180).setOffset(127,130);this.player.setCollideWorldBounds(true);this.player.body.setMaxVelocity(230,700);
      this.physics.add.collider(this.player,this.platforms);
      this.follower=this.add.sprite(55,600,'elric',4).setOrigin(.5,310/320).setScale(.65).setDepth(4);
      this.cameras.main.startFollow(this.player,true,.12,.12,0,0);
      this.collectibles=this.physics.add.staticGroup();
      for(const [x,y] of [[300,555],[445,472],[530,472],[620,555],[820,555],[1120,555],[1590,555],[1800,477],[2160,555],[2740,555],[2900,472],[3060,555],[3540,555],[3750,555]]){
        const s=this.collectibles.create(x,y,'star').setScale(.55).refreshBody();this.tweens.add({targets:s,angle:12,duration:1000,yoyo:true,repeat:-1});
      }
      this.physics.add.overlap(this.player,this.collectibles,(_,s)=>{s.disableBody(true,true);$('stars').textContent=String(++this.stars);this.chime('star');});
      this.npcs=[{character:'ellery',x:980,key:'princess'},{character:'elric',x:2040,key:'spider-hero'}];
      for(const npc of this.npcs){const figure=this.add.image(npc.x,600,npc.key).setOrigin(.5,1).setScale(1.05).setDepth(3);this.tweens.add({targets:figure,angle:1.5,duration:1600,yoyo:true,repeat:-1,ease:'Sine.inOut'});this.add.text(npc.x,439,npc.key==='princess'?'Princess':'Spider Hero',{fontFamily:'sans-serif',fontSize:'19px',color:'#375d52',backgroundColor:'#fff4d9',padding:{x:10,y:6}}).setOrigin(.5);}
      this.obstacles=this.physics.add.staticGroup();
      this.gate=this.obstacles.create(1390,600,'gate').setOrigin(.5,1).setScale(.94).refreshBody();this.gate.kind='gate';this.gate.owner='ellery';
      this.rock=this.obstacles.create(2510,600,'rock').setOrigin(.5,1).setScale(.94).refreshBody();this.rock.kind='rock';this.rock.owner='elric';
      this.physics.add.collider(this.player,this.obstacles);
      this.wolf=this.add.sprite(3210,600,'wolf').play('wolf-walk').setOrigin(.5,1).setScale(.8).setDepth(3);this.wolfGone=false;
      this.add.image(3980,600,'finish').setOrigin(.5,1).setScale(.95).setDepth(2);
      this.badges();freeze();
    }
    chime(key){if(!muted)this.sound.play(key,{volume:.32});}
    badges(){
      for(const key of ['ellery','elric']){$(key+'-badge').classList.toggle('active',key===this.active);$(key+'-badge').classList.toggle('powered',this.powers[key]);}

    }
    switchCharacter(){
      this.active=this.active==='ellery'?'elric':'ellery';
      this.player.anims.stop();this.follower.anims.stop();this.player.setTexture(this.active,4);this.follower.setTexture(this.active==='ellery'?'elric':'ellery',4);this.castUntil=0;
      this.badges();
    }
    hint(text,character){
      const tag=(character||'')+text;if(tag===this.hintTag)return;this.hintTag=tag;
      $('hint').replaceChildren();$('hint').hidden=!text;
      if(character){const img=document.createElement('span');img.className='portrait-asset';img.style.backgroundImage='url('+asset('assets/'+character+'-sprites.png')+')';img.setAttribute('aria-label',character==='ellery'?'Ellery':'Elric');$('hint').append(img);}
      $('hint').append(document.createTextNode(text));
    }
    power(){
      if(!this.powers[this.active]){this.toastUntil=this.time.now+1800;this.hint(this.active==='ellery'?'Temui Princess di depan, yuk!':'Temui Spider Hero di depan, yuk!',this.active);return;}
      if(this.time.now<this.cooldown)return;this.cooldown=this.time.now+1000;this.castUntil=this.time.now+500;this.chime('power');
      const barrier=[this.gate,this.rock].find(o=>o.body.enable&&Math.abs(o.x-this.player.x)<210);
      const target=barrier||(!this.wolfGone&&Math.abs(this.wolf.x-this.player.x)<240?this.wolf:null);
      const fx=this.add.graphics().setDepth(8);
      if(this.active==='elric'){
        const tx=target?target.x:this.player.x+this.facing*160,ty=target?target.y-75:this.player.y-90;
        fx.lineStyle(4,0xf8fbff,.95);for(let i=-2;i<=2;i++){fx.lineBetween(this.player.x,this.player.y-65,tx,ty+i*14);}
        fx.strokeCircle(tx,ty,30);
      }else{
        fx.lineStyle(4,0xffd8fa,.9);fx.strokeCircle(this.player.x,this.player.y-60,85);for(let i=0;i<7;i++){const sparkle=this.add.image(this.player.x+Math.cos(i)*75,this.player.y-70+Math.sin(i)*55,'star').setScale(.25).setDepth(8);this.tweens.add({targets:sparkle,y:sparkle.y-45,alpha:0,duration:650,onComplete:()=>sparkle.destroy()});}
      }
      this.tweens.add({targets:fx,alpha:0,duration:600,onComplete:()=>fx.destroy()});
      if(barrier&&ElciRules.canOpen(this.active,true,barrier.kind)){
        barrier.body.enable=false;this.tweens.add({targets:barrier,alpha:0,y:barrier.y-35,scaleX:.4,scaleY:.4,duration:500,onComplete:()=>barrier.setVisible(false)});
      }
      if(target===this.wolf){this.wolfGone=true;this.wolf.setFlipX(false);this.tweens.add({targets:this.wolf,x:this.wolf.x+430,alpha:0,duration:1100});}
    }
    finish(){
      this.finished=true;clearInput();this.physics.pause();this.player.setVelocity(0);this.chime('finish');
      const reward=ElciRules.reward(this.active),name=this.active==='ellery'?'Ellery':'Elric';
      $('reward-title').textContent='Hore, '+name+'!';$('reward-name').textContent=reward.name;$('reward-image').src=this.textures.getBase64(reward.image);$('reward-image').alt=reward.name;
      $('reward-panel').hidden=false;$('controls').hidden=true;$('hint').hidden=true;
    }
    update(time,delta){
      if(paused||portrait()||this.finished)return;
      if(taps.has('switch'))this.switchCharacter();
      const dir=Number(held.has('right'))-Number(held.has('left'));
      this.player.setVelocityX(dir*225);if(dir)this.facing=dir;this.player.setFlipX(this.facing<0);
      if(taps.has('jump')&&(this.player.body.blocked.down||this.player.body.touching.down)){this.player.setVelocityY(-495);this.chime('jump');}
      if(taps.has('power'))this.power();taps.clear();
      this.backdrop.x=-this.cameras.main.scrollX*.28;
      this.trail.push({x:this.player.x,y:this.player.y,face:this.facing,t:time});
      while(this.trail.length>1&&this.trail[1].t<time-330)this.trail.shift();
      const point=this.trail[0],stationary=!dir;
      const tx=stationary?this.player.x-this.facing*110:point.x-this.facing*60;
      this.follower.x=Phaser.Math.Linear(this.follower.x,Math.max(40,tx),Math.min(1,delta*.015));
      this.follower.y=Phaser.Math.Linear(this.follower.y,point.y,Math.min(1,delta*.025));this.follower.setFlipX(point.face<0);
      if(Math.abs(this.follower.x-this.player.x)>240)this.follower.setPosition(this.player.x-this.facing*110,this.player.y);
      const pose=(sprite,hero,moving,airborne,velocity,casting)=>{
        if(casting||airborne||!moving){sprite.anims.stop();sprite.setFrame(casting?7:airborne?(velocity<0?5:6):4);}
        else sprite.play(hero+'-walk',true);
      };
      pose(this.player,this.active,Boolean(dir),!this.player.body.blocked.down&&!this.player.body.touching.down,this.player.body.velocity.y,time<this.castUntil);
      pose(this.follower,this.active==='ellery'?'elric':'ellery',Boolean(dir),Math.abs(point.y-this.player.y)>8,this.player.body.velocity.y,false);
      for(const npc of this.npcs)if(!this.powers[npc.character]&&Math.abs(this.player.x-npc.x)<150){
        this.powers[npc.character]=true;this.badges();this.chime('power');this.toastUntil=time+2400;
        this.hint(npc.character==='ellery'?'Magic Loyor mendapat sihir!':'Magic Loyor mendapat jaring!',npc.character);
      }
      if(!this.wolfGone){this.wolf.x=3210+Math.sin(time*.0018)*42;this.wolf.setFlipX(Math.cos(time*.0018)<0);}
      const barrier=[this.gate,this.rock].find(o=>o.body.enable&&Math.abs(o.x-this.player.x)<270);
      $('switch').classList.toggle('prompt',Boolean(barrier&&this.active!==barrier.owner));
      $('power').classList.toggle('prompt',Boolean(barrier&&this.active===barrier.owner));
      $('power').classList.toggle('cooldown',time<this.cooldown);
      if(time>this.toastUntil){
        if(barrier)this.hint(this.active!==barrier.owner?'Tekan Switch, yuk!':(barrier.kind==='gate'?'Tekan Power untuk membuka gerbang':'Tekan Power untuk menarik batu'),barrier.owner);
        else if(!this.wolfGone&&Math.abs(this.player.x-this.wolf.x)<220)this.hint('Power membuat serigala kabur',this.active);
        else this.hint('');
      }
      if(this.player.x>3930)this.finish();
    }
  }
  if(!window.Phaser){$('load-message').textContent='Game belum tersedia. Sambungkan internet lalu buka kembali.';return;}
  game=new Phaser.Game({type:Phaser.AUTO,parent:'game',width:1280,height:720,backgroundColor:'#c4dfd3',antialias:true,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH,fullscreenTarget:document.getElementById('game-shell')},physics:{default:'arcade',arcade:{gravity:{y:1100},debug:false}},input:{activePointers:4},scene:[Boot,Forest]});

  // Complete package first, publish the HTML marker last. Old versions survive failed downloads.
  async function cacheGame(){
    if(!('serviceWorker' in navigator)||!('caches' in window)||!navigator.onLine)return;
    try{
      const registration=await navigator.serviceWorker.register('/sw.js');
      registration.waiting?.postMessage('ACTIVATE_UPDATE');
      await navigator.serviceWorker.ready;
      const name='cekjo-game-ellery-elric-'+ELCI.version,cache=await caches.open(name);
      if(await cache.match(PAGE)){registration.active?.postMessage({type:'GAME_CACHE_READY',version:ELCI.version});return;}
      await cache.addAll(ELCI.assets.map(url=>new Request(url,{credentials:'omit',cache:'reload',mode:'cors'})));
      const response=await fetch(PAGE,{credentials:'omit',cache:'no-store'});
      if(!response.ok)throw new Error('Game page unavailable');
      const html=await response.text();
      // A deployment during the download must not mix HTML from another package.
      if(!html.includes('"version": "'+ELCI.version+'"'))throw new Error('Game version changed');
      await cache.put(PAGE,new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}}));
      // Retain older packages while another game tab may still be using them.
      const clients=await navigator.serviceWorker.getRegistration();
      clients?.active?.postMessage({type:'GAME_CACHE_READY',version:ELCI.version});
    }catch{/* The game remains playable online; the next online visit retries caching. */}
  }
  cacheGame();
})();
