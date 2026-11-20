export function createNavigation(manifest) {
  const grid=manifest?.grid;
  if (!grid) return {test:()=>true,eyeY:(manifest?.floorY??0)+(manifest?.eyeHeight??1.6),source:'unrestricted-floor'};
  const {origin,cellSize,width,height,data}=grid;
  if (!Array.isArray(origin)||origin.length!==2||!origin.every(Number.isFinite)||!Number.isFinite(cellSize)||cellSize<=0||!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||data?.length!==width*height) throw Error('Invalid navigation grid.');
  if(!Array.isArray(data)||!data.every(value=>value===0||value===1))throw Error('Navigation cells must be zero or one.');
  if(!Number.isFinite(manifest.floorY??0)||!Number.isFinite(manifest.eyeHeight??1.6)||(manifest.eyeHeight??1.6)<=0||!Number.isFinite(manifest.bodyRadius??.16)||(manifest.bodyRadius??.16)<=0||!Number.isFinite(manifest.bodyHeight??1.85)||(manifest.bodyHeight??1.85)<=0)throw Error('Invalid walking dimensions.');
  const radius=manifest.bodyRadius??.16, offsets=[[0,0],...Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4)*radius,Math.sin(i*Math.PI/4)*radius])];
  const free=(x,z)=>{const c=Math.floor((x-origin[0])/cellSize),r=Math.floor((z-origin[1])/cellSize);return c>=0&&r>=0&&c<width&&r<height&&data[r*width+c]===1;};
  if(grid.space==='body-centres'){
    if(!grid.wholeCellConservative||!Number.isFinite(radius)||radius<=0||!Number.isFinite(grid.appliedBodyRadius)||Math.abs(grid.appliedBodyRadius-radius)>1e-9)throw Error('Body-centre grid needs matching pre-applied clearance.');
    const freeCell=(c,r)=>c>=0&&r>=0&&c<width&&r<height&&data[r*width+c]===1;
    const testSegment=(x0,z0,x1,z1)=>{
      if(![x0,z0,x1,z1].every(Number.isFinite))return false;
      let c=Math.floor((x0-origin[0])/cellSize),r=Math.floor((z0-origin[1])/cellSize);
      const endC=Math.floor((x1-origin[0])/cellSize),endR=Math.floor((z1-origin[1])/cellSize);
      if(!freeCell(c,r)||!freeCell(endC,endR))return false;
      const dx=x1-x0,dz=z1-z0,sx=Math.sign(dx),sz=Math.sign(dz),tx=dx?cellSize/Math.abs(dx):Infinity,tz=dz?cellSize/Math.abs(dz):Infinity;
      let nextX=dx?(origin[0]+(c+(sx>0?1:0))*cellSize-x0)/dx:Infinity,nextZ=dz?(origin[1]+(r+(sz>0?1:0))*cellSize-z0)/dz:Infinity;
      for(let i=0;i<width+height+4;i++){
        if(c===endC&&r===endR)return true;
        const boundary=Math.min(nextX,nextZ);
        if(boundary>1+1e-12)return true;
        if(Math.abs(nextX-nextZ)<1e-12){if(!freeCell(c+sx,r)||!freeCell(c,r+sz)||!freeCell(c+sx,r+sz))return false;if(boundary>=1-1e-12)return true;c+=sx;r+=sz;nextX+=tx;nextZ+=tz;}
        else if(nextX<nextZ){if(!freeCell(c+sx,r))return false;if(boundary>=1-1e-12)return true;c+=sx;nextX+=tx;}else{if(!freeCell(c,r+sz))return false;if(boundary>=1-1e-12)return true;r+=sz;nextZ+=tz;}
        if(!freeCell(c,r))return false;
      }
      return false;
    };
    return {test:free,testSegment,eyeY:(manifest.floorY??0)+(manifest.eyeHeight??1.6),source:'evaluated-body-centre-grid',bodyRadius:radius,bodyHeight:manifest.bodyHeight};
  }
  return {test:(x,z)=>offsets.every(([dx,dz])=>free(x+dx,z+dz)),eyeY:(manifest.floorY??0)+(manifest.eyeHeight??1.6),source:'measured-floor-grid',bodyRadius:radius};
}
