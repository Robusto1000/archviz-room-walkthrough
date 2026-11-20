import * as THREE from 'three';
let SparkRenderer,SplatMesh,ExtSplats;
import {validateCamera} from './camera.js';
import {walkingSetup} from './walking.js';
import {prepareExactExtSplats} from './ext-delivery.js';
import {chooseProfile,selectQuality,getMobilePreset,readInterrupted,markAttempt,clearAttempt,validateCapabilities,loadMobileAsset,mobileMeshOptions,mobileRenderSize} from './mobile-loader.js?v=mobile-v4';

import {joystickVector,movementAxes,nativeFullscreenAvailable,standaloneMode,hasPendingDetail,createDetailMonitor} from './viewer-input.js?v=mobile-v4';

import {createViewGate} from './mobile-startup.js?v=mobile-v4';

const $=id=>document.getElementById(id);
const base=new URL('./',import.meta.url);
let renderer,scene,camera,spark,splats,manifest,navigation,loadAbort,removeContextListener;
const profile=chooseProfile(navigator);
let activeQuality=selectQuality(location.search);
let failed=false,modelReady=false,firstFramePending=false,installOpen=false,uiHidden=false;
let inputCleanup,resetJoystick,resetViewInput,detailMonitor,lastDetailProbe=-Infinity;
let viewGate,viewSettling=false,viewGateTimedOut=false,viewGateReason='startup',viewEpoch=0,lastPresented=null;
const startupHistory=[];let lastHistoryAt=0;
const joystick={x:0,y:0,active:false};
function attemptStorage(){try{return sessionStorage;}catch{return undefined;}}
function waitForStart(interrupted){
  if(!profile.requiresStart&&!interrupted)return Promise.resolve();
  if(profile.kind==='mobile'){
    $('quality-controls').hidden=false;$('quality').value=activeQuality;$('quality').disabled=false;
  }
  status(profile.kind==='mobile'?'Open mobile tour':'Open apartment tour',interrupted?'The previous loading attempt was interrupted. Choose a quality and tap Start.':'Choose a quality and tap Start to open the touch-friendly tour.');
  $('start-tour').hidden=false;$('start-tour').disabled=false;
  return new Promise(resolve=>{$('start-tour').onclick=()=>{
    if(profile.kind==='mobile'){activeQuality=selectQuality(location.search,$('quality').value);$('quality').disabled=true;}
    $('start-tour').hidden=true;$('start-tour').disabled=true;resolve();
  };});
}
function setViewerUI(hidden){
  uiHidden=hidden;document.body.classList.toggle('ui-minimal',hidden);
  $('ui-toggle').textContent=hidden?'Show controls':'Hide controls';
  $('ui-toggle').setAttribute('aria-pressed',String(hidden));
}
function openInstallHelp(){
  installOpen=true;keys.clear();resetJoystick?.();$('install-panel').hidden=false;$('install-close').focus();
}
function closeInstallHelp(){
  installOpen=false;$('install-panel').hidden=true;$('fullscreen').focus();
}
function setupViewportUI(){
  const standalone=standaloneMode(navigator,query=>matchMedia(query));
  const native=nativeFullscreenAvailable(document);
  const update=()=>{
    const full=Boolean(document.fullscreenElement);
    $('fullscreen').textContent=full?'Exit fullscreen':native?'Fullscreen':'App mode';
    $('fullscreen').hidden=standalone&&!native;
    $('exit-fullscreen').hidden=!full;
    if(full)setViewerUI(true);
  };
  $('fullscreen').onclick=async()=>{
    if(!native){openInstallHelp();return;}
    try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
    catch{openInstallHelp();}
    update();
  };
  $('exit-fullscreen').onclick=()=>document.exitFullscreen?.().catch(()=>{});
  $('ui-toggle').onclick=()=>setViewerUI(!uiHidden);
  $('install-close').onclick=closeInstallHelp;
  document.addEventListener('keydown',event=>{
    if(event.code==='Escape'&&installOpen){event.preventDefault();closeInstallHelp();}
    else if(event.code==='Escape'&&uiHidden&&!document.fullscreenElement)setViewerUI(false);
  });
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)setViewerUI(false);update();resize();});
  setViewerUI(standalone);update();
}
function readMobileReadiness(){
  const pager=spark?.pager,lod=spark?.currentLod,display=spark?.display,current=spark?.current;
  const priority=pager?.fetchPriority??[],limit=pager?.maxPages??0,eligible=[];
  for(const item of priority){if(!eligible.some(p=>p.splats===item.splats&&p.chunk===item.chunk))eligible.push(item);if(eligible.length>=limit)break;}
  const loaded=eligible.filter(item=>pager.getSplatsChunk(item.splats,item.chunk)).length;
  const missingEligible=eligible.length-loaded;
  const queued=Boolean(pager?.fetched?.length||pager?.newUploads?.length||pager?.readyUploads?.length||pager?.lodTreeUpdates?.length||spark?.lodUpdates?.length);
  const positionMatches=Boolean(lod&&camera&&Math.hypot(lod.pos.x-camera.position.x,lod.pos.y-camera.position.y,lod.pos.z-camera.position.z)<.001);
  const rotationMatches=Boolean(lod&&camera&&Math.abs(lod.quat.dot(camera.quaternion))>.99999);
  const lodComplete=Boolean(lod&&lod===spark?.lastLod&&positionMatches&&rotationMatches);
  const mappingMatches=Boolean(display&&current&&display.mappingVersion===current.mappingVersion&&!display.mappingChanged?.());
  const frameMatches=Boolean(lastPresented&&lastPresented.epoch===viewEpoch&&lastPresented.mappingVersion===display?.mappingVersion&&lastPresented.version===display?.version&&lastPresented.activeSplats===spark?.activeSplats);
  const activeSplats=Number(spark?.activeSplats)||0,target=getMobilePreset(activeQuality).lodSplatCount,detailEnough=activeSplats>=Math.floor(target*.9);
  const ready=Boolean(modelReady&&renderer&&spark&&splats);
  const pending=!ready||!eligible.length||missingEligible>0||queued||!lodComplete||!mappingMatches||!frameMatches||!detailEnough;
  const workerBusy=spark?.lodWorker?.queue!=null,sorting=Boolean(spark?.sorting);
  const needsFrame=Boolean(renderer&&!scheduled&&!workerBusy&&!sorting&&(queued||(!frameMatches&&lodComplete&&mappingMatches)||(!activeSplats&&ready)));
  const blockingReasons=[!ready&&'model',!eligible.length&&'page-plan',missingEligible>0&&'pages',queued&&'uploads',!lodComplete&&'view-selection',!mappingMatches&&'display-mapping',!frameMatches&&'presented-frame',!detailEnough&&'detail-level'].filter(Boolean);
  const signature=[eligible.length,loaded,activeSplats,viewEpoch].join(':');
  return{ready,activeSplats,pending,needsFrame,signature,blockingReasons,eligibleParts:eligible.length,loadedParts:loaded,missingEligible,queued,lodComplete,mappingMatches,frameMatches,detailEnough,target,advisory:{workerBusy,sorting,sortDirty:Boolean(spark?.sortDirty),sparkDirty:Boolean(spark?.dirty),appDirty:dirty,scheduled}};
}
function revealMobileView(){
  viewSettling=false;viewGateTimedOut=false;firstFramePending=false;clearAttempt(attemptStorage());detailMonitor?.resume();
  $('viewport').classList.remove('preparing-view');$('view-cover').hidden=true;$('status').hidden=true;$('progress').hidden=true;
  $('wait-detail').hidden=true;$('open-preview').hidden=true;setBusy(false);
  $('detail-status').hidden=!(detailMonitor?.visible??false);requestFrame();
}
function onViewGateState(event){
  if(event.status==='waiting'){
    viewSettling=true;viewEpoch++;lastPresented=null;firstFramePending=true;viewGateTimedOut=false;viewGateReason=event.reason;detailMonitor?.resume();
    $('viewport').classList.add('preparing-view');$('view-cover').hidden=false;setBusy(true);
    status('Preparing room detail…','Loading and refining this room.');
    $('progress').hidden=false;$('progress').removeAttribute('value');
    $('wait-detail').hidden=true;$('open-preview').hidden=true;$('detail-status').hidden=true;
  }else if(event.status==='progress'){
    const s=event.snapshot;
    if(event.elapsedMs>=12000&&s.activeSplats>0){$('open-preview').hidden=false;$('open-preview').disabled=false;}
    if(s.eligibleParts)$('status-detail').textContent=s.missingEligible>0?'Loading room detail · '+s.loadedParts+' of '+s.eligibleParts+' parts':'Applying room detail…';
    if(performance.now()-lastHistoryAt>=1000){lastHistoryAt=performance.now();startupHistory.push({elapsedMs:event.elapsedMs,...s});if(startupHistory.length>30)startupHistory.shift();}
    if(new URL(location.href).searchParams.get('diagnostics')==='1'&&event.elapsedMs>=15000){$('copy-diagnostics').hidden=false;$('copy-diagnostics').disabled=false;}
  }else if(event.status==='preview-available'){
    if(spark?.activeSplats>0){$('open-preview').hidden=false;$('open-preview').disabled=false;}
  }else if(event.status==='settled')revealMobileView();
  else if(event.status==='timeout'){
    viewGateTimedOut=true;
    status('Still preparing room detail','Room detail is still loading. You can open the current preview while loading continues.');
    $('progress').hidden=false;$('wait-detail').hidden=true;
    $('open-preview').hidden=!(spark?.activeSplats>0);$('open-preview').disabled=!(spark?.activeSplats>0);
  }else if(event.status==='error')failTour(event.error??Error('Room detail could not be prepared.'));
}
function beginMobileGate(reason){
  keys.clear();resetViewInput?.();resetJoystick?.();viewGate?.begin(reason);if(document.hidden)viewGate?.pause();
}
function disposeTour(){
  $('view-cover').hidden=true;viewGate?.stop();viewGate=null;detailMonitor?.stop();detailMonitor=null;inputCleanup?.();inputCleanup=null;
  removeContextListener?.();removeContextListener=null;keys.clear();
  const canvas=renderer?.domElement;
  try{splats?.dispose();}catch{}splats=null;
  try{spark?.dispose();}catch{}spark=null;
  try{renderer?.dispose();renderer?.forceContextLoss?.();}catch{}
  canvas?.remove();renderer=null;scene=null;
}
function failTour(error,{contextLost=false}={}){
  if(failed)return;failed=true;modelReady=false;loadAbort?.abort(error);disposeTour();
  if(!contextLost)clearAttempt(attemptStorage());
  setBusy(false);$('progress').hidden=true;
  status(contextLost?'Tour paused':'Unable to open the tour',contextLost?'Your browser stopped the 3D view. Return to the start screen to open a new mobile session.':error.message||'Please return to the start screen.',true);
  $('retry').hidden=false;$('retry').disabled=false;
}
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
function setBusy(value){busy=value;for(const button of document.querySelectorAll('button'))if(!['fullscreen','ui-toggle','exit-fullscreen','install-close','copy-diagnostics'].includes(button.id))button.disabled=value;}
function queueFrame(){if(!renderer||failed)return;const probeTime=performance.now();if(probeTime-lastDetailProbe>=200){lastDetailProbe=probeTime;detailMonitor?.notify();}dirty=true;if(!scheduled&&!document.hidden){scheduled=true;requestAnimationFrame(animate);}}
function requestFrame(){viewGate?.notify();queueFrame();}
function markMotion(){const now=performance.now();if(now-lastMotion>250){frameWindow=now;frames=0;}lastMotion=now;}
function focusViewport(){renderer?.domElement.focus({preventScroll:true});}
function resize(){
  if(!renderer)return;
  const size=profile.kind==='mobile'?mobileRenderSize(innerWidth,innerHeight,activeQuality,devicePixelRatio||1):{width:innerWidth,height:innerHeight};
  renderer.setSize(size.width,size.height,false);renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();requestFrame();
}
function useRoom(room){
  if(busy)return;
  if(profile.kind==='mobile'&&viewGate)beginMobileGate(room.label??room.id??'room');
  camera.fov=manifest.controls.fov;camera.near=manifest.rasterizer.near;camera.far=manifest.rasterizer.far;
  camera.position.fromArray(room.position);camera.up.set(0,1,0);camera.lookAt(new THREE.Vector3().fromArray(room.target));
  resize();requestFrame();
}
function reset(){useRoom(manifest.rooms[0]);}
function move(dt){
  if(busy||installOpen)return false;
  const axes=movementAxes(keys,joystick);if(axes.magnitude===0)return false;
  camera.getWorldDirection(forward);forward.y=0;if(forward.lengthSq()<1e-8)return false;forward.normalize();
  right.crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();delta.set(0,0,0);
  delta.addScaledVector(forward,axes.forward).addScaledVector(right,axes.strafe);
  if(delta.lengthSq()===0)return false;
  delta.normalize().multiplyScalar(manifest.controls.moveSpeed*dt*axes.magnitude*(keys.has('ShiftLeft')||keys.has('ShiftRight')?2:1));
  const p=camera.position;
  const canMove=(x,z)=>navigation.testSegment?navigation.testSegment(p.x,p.z,x,z):navigation.test(x,z);
  if(canMove(p.x+delta.x,p.z))p.x+=delta.x;
  if(canMove(p.x,p.z+delta.z))p.z+=delta.z;
  p.y=navigation.eyeY;camera.updateMatrixWorld(true);markMotion();return true;
}
function animate(time){
  scheduled=false;const dt=Math.min(.05,lastTime?(time-lastTime)/1000:0);lastTime=time;
  const moved=move(dt);
  if(!renderer||failed)return;
  if(dirty||moved){dirty=false;try{renderer.render(scene,camera);}catch(error){failTour(error);return;}frames++;
    if(profile.kind==='mobile')lastPresented={epoch:viewEpoch,mappingVersion:spark?.display?.mappingVersion,version:spark?.display?.version,activeSplats:spark?.activeSplats??0};
    if(profile.kind!=='mobile'&&modelReady&&firstFramePending&&(splats?.numSplats??0)>0){firstFramePending=false;clearAttempt(attemptStorage());
      $('status').hidden=true;setBusy(false);}}
  if(viewGateTimedOut&&spark?.activeSplats>0){$('open-preview').hidden=false;$('open-preview').disabled=false;}
  if(moved||time-lastMotion<180){const elapsed=time-frameWindow;if(elapsed>=400&&frames>1){$('fps').textContent=`${Math.round(frames*1000/elapsed)} fps`;frames=0;frameWindow=time;}}
  else{$('fps').textContent='Idle';frames=0;frameWindow=time;}
  if(keys.size||Math.hypot(joystick.x,joystick.y)>0||time-lastMotion<180)requestFrame();
}
function controls(){
  let lookPointer=null,joyPointer=null,px=0,py=0;const removals=[];
  const canvas=renderer.domElement,pad=$('joystick'),thumb=$('joystick-thumb');
  const listen=(target,type,handler,options)=>{target.addEventListener(type,handler,options);removals.push(()=>target.removeEventListener(type,handler,options));};
  resetJoystick=()=>{
    joystick.x=0;joystick.y=0;joystick.active=false;
    const old=joyPointer;joyPointer=null;pad.classList.remove('active');thumb.style.transform='translate(0px,0px)';
    if(old!==null&&pad.hasPointerCapture?.(old)){try{pad.releasePointerCapture(old);}catch{}}
  };
  const updateJoystick=event=>{
    const rect=pad.getBoundingClientRect(),radius=Math.max(1,rect.width/2-thumb.offsetWidth/2-4);
    const v=joystickVector(event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2,radius);
    joystick.x=v.x;joystick.y=v.y;joystick.active=true;
    thumb.style.transform='translate('+v.thumbX+'px,'+v.thumbY+'px)';markMotion();requestFrame();
  };
  listen(pad,'pointerdown',event=>{
    if(event.button!==0||busy||installOpen||joyPointer!==null)return;
    event.preventDefault();event.stopPropagation();joyPointer=event.pointerId;pad.classList.add('active');
    try{pad.setPointerCapture(event.pointerId);}catch{}updateJoystick(event);
  });
  listen(pad,'pointermove',event=>{if(event.pointerId!==joyPointer)return;event.preventDefault();updateJoystick(event);});
  const stopJoystick=event=>{if(event.pointerId===joyPointer)resetJoystick();};
  listen(pad,'pointerup',stopJoystick);listen(pad,'pointercancel',stopJoystick);listen(pad,'lostpointercapture',stopJoystick);
  listen(pad,'contextmenu',event=>event.preventDefault());
  listen(canvas,'pointerdown',event=>{
    if(event.button!==0||busy||installOpen||lookPointer!==null)return;
    event.preventDefault();focusViewport();lookPointer=event.pointerId;px=event.clientX;py=event.clientY;
    try{canvas.setPointerCapture(event.pointerId);}catch{}
  });
  const stopLook=event=>{if(event.pointerId===lookPointer)lookPointer=null;};
  listen(canvas,'pointerup',stopLook);listen(canvas,'pointercancel',stopLook);listen(canvas,'lostpointercapture',stopLook);
  listen(canvas,'dblclick',()=>{if(!busy&&!installOpen&&profile.kind==='desktop')canvas.requestPointerLock?.();});
  listen(document,'pointermove',event=>{
    const locked=document.pointerLockElement===canvas;
    if(busy||installOpen||(!locked&&event.pointerId!==lookPointer))return;
    event.preventDefault();const dx=locked?event.movementX:event.clientX-px,dy=locked?event.movementY:event.clientY-py;
    px=event.clientX;py=event.clientY;euler.setFromQuaternion(camera.quaternion);
    euler.y-=dx*.0025;euler.x=THREE.MathUtils.clamp(euler.x-dy*.0025,-Math.PI*.49,Math.PI*.49);
    camera.quaternion.setFromEuler(euler);camera.updateMatrixWorld(true);markMotion();requestFrame();
  },{passive:false});
  listen(document,'keydown',event=>{
    if(event.target.closest?.('button,select,input,textarea')||busy||installOpen)return;
    if(event.code==='KeyR'){reset();return;}
    if(/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(event.code)){event.preventDefault();keys.add(event.code);markMotion();requestFrame();}
  });
  listen(document,'keyup',event=>keys.delete(event.code));
  const clearInput=()=>{keys.clear();resetJoystick();lookPointer=null;};
  resetViewInput=clearInput;
  listen(window,'blur',clearInput);
  listen(document,'visibilitychange',()=>{clearInput();lastTime=0;if(document.hidden){detailMonitor?.pause();viewGate?.pause();}else{detailMonitor?.resume();viewGate?.resume();requestFrame();}});
  listen(window,'resize',resize);
  inputCleanup=()=>{clearInput();for(const remove of removals)remove();$('touch-controls').hidden=true;resetJoystick=null;resetViewInput=null;};
  $('reset').onclick=()=>{reset();focusViewport();};
  $('touch-controls').hidden=profile.kind!=='mobile';
  $('instructions').textContent=profile.kind==='mobile'?'Left stick to walk · Drag to look':'Drag to look · Double-click to lock mouse · WASD move · Shift faster · R reset';
}
async function start(){
  setupViewportUI();
  $('wait-detail').onclick=()=>beginMobileGate(viewGateReason);
  $('open-preview').onclick=()=>{if(spark?.activeSplats>0){viewGate?.cancel();revealMobileView();}};
  $('copy-diagnostics').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(globalThis.__archvizQA?.(),null,2));$('copy-diagnostics').textContent='Copied';}catch{$('copy-diagnostics').textContent='Copy unavailable';}};
  setBusy(true);$('retry').onclick=()=>location.reload();
  manifest=await json('./manifest.json');
  if(!manifest.model||manifest.model.pointCount!==5059728||manifest.model.shDegree!==3||manifest.model.sha256!=='b6f31ca6941ec74e8cb746ba568fb5e74fec101b1a11b66521ce0d9ea27d673c')throw Error('The apartment model identity could not be verified.');
  if(manifest.shadeOrder?.storedDegree!==3||manifest.shadeOrder.activeDegree!==3||manifest.shadeOrder.storedBasisCount!==16||manifest.shadeOrder.activeBasisCount!==16)throw Error('The apartment shading configuration is invalid.');
  if(manifest.rasterizer?.mode!=='classic'||manifest.rasterizer.eps2d!==.3)throw Error('The apartment renderer configuration is invalid.');
  manifest.cameraPresets.forEach(validateCamera);
  const navData=await json(manifest.navigation.path,manifest.navigation.sha256);
  navigation=walkingSetup(manifest,navData,manifest.rooms);
  await waitForStart(readInterrupted(attemptStorage()));
  const runtime=await import(profile.kind==='mobile'?'./vendor/spark.mobile-fixed.js?v=mobile-v4':'./vendor/spark.module.js');
  ({SparkRenderer,SplatMesh,ExtSplats}=runtime);
  loadAbort=new AbortController();markAttempt(attemptStorage(),profile.kind);
  const mobileAsset=profile.kind==='mobile'?await loadMobileAsset(new URL('mobile-model-v3.json',base),{signal:loadAbort.signal,quality:activeQuality}):null;
  status('Opening the apartment',profile.kind==='mobile'?'Loading the mobile tour…':'Loading the full desktop tour…');
  try{renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});}
  catch{throw Error('The 3D view is unavailable. Please use a recent browser with WebGL 2.');}
  const gl=renderer.getContext();validateCapabilities({webgl2:typeof gl.texImage3D==='function'&&String(gl.getParameter(gl.VERSION)).startsWith('WebGL 2'),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),maxArrayLayers:gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)},profile.kind);
  const lost=event=>{event.preventDefault();failTour(Error('WebGL context lost'),{contextLost:true});};
  renderer.domElement.addEventListener('webglcontextlost',lost);removeContextListener=()=>renderer?.domElement.removeEventListener('webglcontextlost',lost);
  renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  renderer.setClearColor(new THREE.Color().setRGB(...manifest.rasterizer.background,THREE.SRGBColorSpace),1);
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Drag to look. Use W A S D or arrow keys to walk.');
  $('viewport').append(renderer.domElement);scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(manifest.controls.fov,1,manifest.rasterizer.near,manifest.rasterizer.far);
  spark=new SparkRenderer({renderer,...manifest.renderer.options,...(mobileAsset?.renderer??{}),onDirty:requestFrame});scene.add(spark);
  if(profile.kind==='mobile'){
    detailMonitor=createDetailMonitor({isPending:()=>modelReady&&hasPendingDetail(spark),onChange:visible=>{$('detail-status').hidden=!visible||viewSettling;}});
    viewGate=createViewGate({readState:readMobileReadiness,requestFrame:queueFrame,onState:onViewGateState});
  }
  for(const room of manifest.rooms){const button=document.createElement('button');button.textContent=room.label;button.onclick=()=>{useRoom(room);focusViewport();};$('rooms').append(button);}
  controls();setBusy(false);reset();setBusy(true);$('progress').hidden=false;
  if(mobileAsset){
    splats=new SplatMesh(mobileMeshOptions(mobileAsset));scene.add(splats);
    await splats.initialized;
    if(failed)throw Error('Tour loading was interrupted.');
    splats.maxSh=1;splats.updateGenerator();await spark.update({scene,camera});
  }else{
    const delivery=await prepareExactExtSplats(new URL(manifest.model.delivery,base),{expectedModel:manifest.model,manifestSha256:manifest.model.deliverySha256,ExtSplats,signal:loadAbort.signal,onProgress:event=>{
      if(event.total>0)$('progress').value=event.loaded/event.total*100;
      if(event.phase==='download')$('status-detail').textContent='Downloading apartment · '+Math.round(event.loaded/1048576)+' / '+Math.round(event.total/1048576)+' MB';
      else if(event.phase==='decode')$('status-detail').textContent='Opening the apartment…';
    }});
    splats=new SplatMesh({...delivery.meshOptions});
    scene.add(splats);await Promise.all([splats.initialized,delivery.verified]);
    if(splats.numSplats!==manifest.model.pointCount)throw Error('The apartment point count could not be verified.');
    splats.maxSh=3;splats.updateGenerator();await spark.update({scene,camera});
  }
  if(failed)throw Error('Tour loading was interrupted.');
  modelReady=true;firstFramePending=true;detailMonitor?.notify();
  $('model-info').textContent=profile.kind==='mobile'?'Mobile preview · '+getMobilePreset(activeQuality).label+' · visual quality under review':'Work in progress · visual quality under review';
  requestFrame();
}
if(new URL(location.href).searchParams.get('qa')==='1'||new URL(location.href).searchParams.get('diagnostics')==='1'){
  Object.defineProperty(globalThis,'__archvizQA',{configurable:false,writable:false,value:()=>Object.freeze({
    startupHistory:startupHistory.map(s=>({...s})),profile:{...profile},activeQuality:profile.kind==='mobile'?{...getMobilePreset(activeQuality)}:null,sourceMode:profile.kind==='mobile'?'mobile-paged-rad':'desktop-exact-sh3',ready:modelReady&&!firstFramePending&&!viewSettling,loading:busy,failed,
    spark:spark?{maxPagedSplats:spark.maxPagedSplats,lodSplatCount:spark.lodSplatCount,numLodFetchers:spark.numLodFetchers,pagedExtSplats:spark.pagedExtSplats,accumExtSplats:spark.accumExtSplats,enableLod:spark.enableLod}:null,
    numSplats:splats?.numSplats??0,maxSh:splats?.maxSh??null,joystick:{...joystick},uiHidden,installOpen,viewSettling,viewGateStatus:viewGate?.status??null,viewReadiness:profile.kind==='mobile'?readMobileReadiness():null,detailPending:hasPendingDetail(spark),detailIndicatorVisible:detailMonitor?.visible??false,
    currentCamera:camera?{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov}:null,
    viewport:renderer?{width:renderer.domElement.width,height:renderer.domElement.height,cssWidth:innerWidth,cssHeight:innerHeight,physicalDPR:devicePixelRatio||1,scaleX:renderer.domElement.width/innerWidth,scaleY:renderer.domElement.height/innerHeight}:null
  })});
}
start().catch(error=>failTour(error));
