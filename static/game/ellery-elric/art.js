/* Turn the supplied painted atlases into aligned Phaser textures at load time. */
window.ElciArt = {
  prepare(scene) {
    function source(key){return scene.textures.get(key).getSourceImage();}
    function crop(image,rect){
      const c=document.createElement('canvas');c.width=rect[2];c.height=rect[3];
      const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,...rect,0,0,c.width,c.height);
      const pixels=ctx.getImageData(0,0,c.width,c.height).data;
      let left=c.width,top=c.height,right=0,bottom=0;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      return {canvas:c,left,top,width:right-left+1,height:bottom-top+1,bottom};
    }
    for(const hero of ['ellery','elric']){
      const image=source(hero+'-sheet'),texture=scene.textures.createCanvas(hero,320*8,320),ctx=texture.getContext();
      for(let i=0;i<8;i++){
        const x=Math.round((i%4)*image.width/4),y=Math.round(Math.floor(i/4)*image.height/2);
        const w=Math.round((i%4+1)*image.width/4)-x,h=Math.round((Math.floor(i/4)+1)*image.height/2)-y;
        const frame=crop(image,[x,y,w,h]);
        // One fixed scale keeps head/body size stable; feet share the same baseline.
        ctx.save();ctx.beginPath();ctx.rect(i*320,0,320,320);ctx.clip();
        ctx.drawImage(frame.canvas,i*320+160-w*.65*.64,310-frame.bottom*.64,w*.64,h*.64);ctx.restore();
        texture.add(i,0,i*320,0,320,320);
      }
      texture.refresh();
      scene.anims.create({key:hero+'-walk',frames:scene.anims.generateFrameNumbers(hero,{start:0,end:3}),frameRate:9,repeat:-1});
    }
    const image=source('props-sheet'),rows=[0,448,813,1086];
    const items=[['princess',140,180],['spider-hero',140,180],['wolf',150,110],['wolf-step',150,110],['gate',180,240],['rock',180,190],['platform',240,100],['finish',200,230],['star',60,60],['sparkle',130,110],['astor',240,160],['bread',240,160]];
    items.forEach(([name,w,h],i)=>{
      const x=Math.round((i%4)*image.width/4),next=Math.round((i%4+1)*image.width/4),r=Math.floor(i/4);
      const top=Math.round(rows[r]*image.height/1086),bottom=Math.round(rows[r+1]*image.height/1086);
      const frame=crop(image,[x,top,next-x,bottom-top]),texture=scene.textures.createCanvas(name,w,h);
      texture.getContext().drawImage(frame.canvas,frame.left,frame.top,frame.width,frame.height,0,0,w,h);texture.refresh();
    });
    scene.anims.create({key:'wolf-walk',frames:[{key:'wolf'},{key:'wolf-step'}],frameRate:5,repeat:-1});
  }
};
