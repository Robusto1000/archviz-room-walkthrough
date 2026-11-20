import * as THREE from 'three';
import {SparkRenderer,SplatMesh,ExtSplats} from '@sparkjsdev/spark';
import {validateCamera} from './camera.js';
import {walkingSetup} from './walking.js';
import {prepareExactExtSplats} from './ext-delivery.js';

const $=id=>document.getElementById(id);
const base=new URL('./',import.meta.url);
let renderer,scene,camera,spark,splats,manifest,navigation;
let dirty=true,scheduled=false,lastTime=0,lastMotion=0,frames=0,frameWindow=performance.now(),busy=false;
const keys=new Set(),forward=new THREE.Vector3(),right=new THREE.Vector3(),delta=new THREE.Vector3(),euler=new THREE.Euler(0,0,0,'YXZ');

async function json(path,expectedSha){
  const response=await fetch(new URL(path,base));
  if(!response.ok)throw Error(`Could not load apartment data (HTTP ${response.status}).`);
  const bytes=await response.arrayBuffer();
  if(expectedSha){
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==expectedSha.toLowerCase())throw Error('Walking boundaries could not be verified.');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function status(title,detail,error=false){$('status').hidden=false;$('status-title').textContent=title;$('status-detail').textContent=detail;$('status').dataset.error=String(error);}
function setBusy(value){busy=value;for(const button of document.querySelectorAll('button'))button.disabled=value;}
function requestFrame(){dirty=true;if(!scheduled&&!document.hidden){scheduled=true;requestAnimationFrame(animate);}}
function markMotion(){const now=performance.now();if(now-lastMotion>250){frameWindow=now;frames=0;}lastMotion=now;}
function focusViewport(){renderer?.domElement.focus({preventScroll:true});}
function resize(){
  if(!renderer)return;
  renderer.setSize(innerWidth,innerHeight,false);renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();requestFrame();
}
function useRoom(room){
  if(busy)return;
  camera.fov=manifest.controls.fov;camera.near=manifest.rasterizer.near;camera.far=manifest.rasterizer.far;
  camera.position.fromArray(room.position);camera.up.set(0,1,0);camera.lookAt(new THREE.Vector3().fromArray(room.target));
  resize();requestFrame();
}
function reset(){useRoom(manifest.rooms[0]);}
function move(dt){
  if(!keys.size||busy)return false;
  camera.getWorldDirection(forward);forward.y=0;if(forward.lengthSq()<1e-8)return false;forward.normalize();
  right.crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();delta.set(0,0,0);
  if(keys.has('KeyW')||keys.has('ArrowUp'))delta.add(forward);
  if(keys.has('KeyS')||keys.has('ArrowDown'))delta.sub(forward);
  if(keys.has('KeyD')||keys.has('ArrowRight'))delta.add(right);
  if(keys.has('KeyA')||keys.has('ArrowLeft'))delta.sub(right);
  if(delta.lengthSq()===0)return false;
  delta.normalize().multiplyScalar(manifest.controls.moveSpeed*dt*(keys.has('ShiftLeft')||keys.has('ShiftRight')?2:1));
  const p=camera.position;
  const canMove=(x,z)=>navigation.testSegment?navigation.testSegment(p.x,p.z,x,z):navigation.test(x,z);
  if(canMove(p.x+delta.x,p.z))p.x+=delta.x;
  if(canMove(p.x,p.z+delta.z))p.z+=delta.z;
  p.y=navigation.eyeY;camera.updateMatrixWorld(true);markMotion();return true;
}
function animate(time){
  scheduled=false;const dt=Math.min(.05,lastTime?(time-lastTime)/1000:0);lastTime=time;
  const moved=move(dt);
  if(dirty||moved){dirty=false;renderer.render(scene,camera);frames++;}
  if(moved||time-lastMotion<180){const elapsed=time-frameWindow;if(elapsed>=400&&frames>1){$('fps').textContent=`${Math.round(frames*1000/elapsed)} fps`;frames=0;frameWindow=time;}}
  else{$('fps').textContent='Idle';frames=0;frameWindow=time;}
  if(keys.size||time-lastMotion<180)requestFrame();
}
function controls(){
  let dragging=false,px=0,py=0;
  renderer.domElement.addEventListener('pointerdown',event=>{if(event.button!==0||busy)return;focusViewport();dragging=true;px=event.clientX;py=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);});
  renderer.domElement.addEventListener('pointerup',()=>dragging=false);
  renderer.domElement.addEventListener('pointercancel',()=>dragging=false);
  renderer.domElement.addEventListener('dblclick',()=>{if(!busy)renderer.domElement.requestPointerLock?.();});
  document.addEventListener('pointermove',event=>{
    if(busy||(!dragging&&document.pointerLockElement!==renderer.domElement))return;
    const locked=document.pointerLockElement===renderer.domElement,dx=locked?event.movementX:event.clientX-px,dy=locked?event.movementY:event.clientY-py;
    px=event.clientX;py=event.clientY;euler.setFromQuaternion(camera.quaternion);
    euler.y-=dx*.0025;euler.x=THREE.MathUtils.clamp(euler.x-dy*.0025,-Math.PI*.49,Math.PI*.49);
    camera.quaternion.setFromEuler(euler);camera.updateMatrixWorld(true);markMotion();requestFrame();
  });
  document.addEventListener('keydown',event=>{
    if(event.target.closest?.('button,select,input,textarea')||busy)return;
    if(event.code==='KeyR'){reset();return;}
    if(/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(event.code)){event.preventDefault();keys.add(event.code);markMotion();requestFrame();}
  });
  document.addEventListener('keyup',event=>keys.delete(event.code));
  window.addEventListener('blur',()=>keys.clear());
  document.addEventListener('visibilitychange',()=>{keys.clear();lastTime=0;if(!document.hidden)requestFrame();});
  window.addEventListener('resize',resize);
  $('reset').onclick=()=>{reset();focusViewport();};
  $('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
}
async function start(){
  setBusy(true);$('retry').onclick=()=>location.reload();
  manifest=await json('./manifest.json');
  if(!manifest.model||manifest.model.pointCount!==5059728||manifest.model.shDegree!==3||manifest.model.sha256!=='b6f31ca6941ec74e8cb746ba568fb5e74fec101b1a11b66521ce0d9ea27d673c')throw Error('The apartment model identity could not be verified.');
  if(manifest.shadeOrder?.storedDegree!==3||manifest.shadeOrder.activeDegree!==3||manifest.shadeOrder.storedBasisCount!==16||manifest.shadeOrder.activeBasisCount!==16)throw Error('The apartment shading configuration is invalid.');
  if(manifest.rasterizer?.mode!=='classic'||manifest.rasterizer.eps2d!==.3)throw Error('The apartment renderer configuration is invalid.');
  manifest.cameraPresets.forEach(validateCamera);
  const navData=await json(manifest.navigation.path,manifest.navigation.sha256);
  navigation=walkingSetup(manifest,navData,manifest.rooms);
  renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  renderer.setClearColor(new THREE.Color().setRGB(...manifest.rasterizer.background,THREE.SRGBColorSpace),1);
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Drag to look. Use W A S D or arrow keys to walk.');
  $('viewport').append(renderer.domElement);scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(manifest.controls.fov,1,manifest.rasterizer.near,manifest.rasterizer.far);
  spark=new SparkRenderer({renderer,...manifest.renderer.options,onDirty:requestFrame});scene.add(spark);
  for(const room of manifest.rooms){const button=document.createElement('button');button.textContent=room.label;button.onclick=()=>{useRoom(room);focusViewport();};$('rooms').append(button);}
  controls();setBusy(false);reset();setBusy(true);$('progress').hidden=false;
  const delivery=await prepareExactExtSplats(new URL(manifest.model.delivery,base),{expectedModel:manifest.model,manifestSha256:manifest.model.deliverySha256,ExtSplats,onProgress:event=>{
    if(event.total>0)$('progress').value=event.loaded/event.total*100;
    if(event.phase==='download')$('status-detail').textContent=`Downloading apartment · ${Math.round(event.loaded/1048576)} / ${Math.round(event.total/1048576)} MB`;
    else if(event.phase==='decode')$('status-detail').textContent='Opening the apartment…';
  }});
  splats=new SplatMesh({...delivery.meshOptions});
  scene.add(splats);await Promise.all([splats.initialized,delivery.verified]);
  if(splats.numSplats!==manifest.model.pointCount)throw Error('The apartment point count could not be verified.');
  splats.maxSh=3;splats.updateGenerator();await spark.update({scene,camera});
  $('model-info').textContent='Work in progress · visual quality under review';
  $('status').hidden=true;setBusy(false);requestFrame();
}
start().catch(error=>{console.error(error);splats?.dispose();setBusy(false);status('Unable to open the tour',error.message||'Please refresh this page.',true);$('retry').hidden=false;});
