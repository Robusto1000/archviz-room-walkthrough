export function validateCamera(pose) {
  if (!pose || !Number.isInteger(pose.width) || !Number.isInteger(pose.height) || pose.width < 1 || pose.height < 1) throw Error('Camera needs integer width and height.');
  for (const key of ['fx','fy','cx','cy']) if (!Number.isFinite(pose.K?.[key])) throw Error(`Camera K.${key} is missing.`);
  if (pose.K.fx <= 0 || pose.K.fy <= 0) throw Error('Camera focal lengths must be positive.');
  if (pose.cameraToWorld?.length !== 4 || pose.cameraToWorld.some(row => row.length !== 4 || row.some(v => !Number.isFinite(v)))) throw Error('Camera needs a finite row-major OpenGL cameraToWorld matrix.');
  return pose;
}

export function projectionFromK({width:w,height:h,K:{fx,fy,cx,cy}}, near=.01, far=100) {
  if (!(near>0 && far>near)) throw Error('Invalid camera clipping planes.');
  return [2*fx/w,0,1-2*cx/w,0, 0,2*fy/h,2*cy/h-1,0, 0,0,-(far+near)/(far-near),-2*far*near/(far-near), 0,0,-1,0];
}

export function applyExactCamera(camera, pose, near=.01, far=100) {
  validateCamera(pose);
  camera.near=near; camera.far=far; camera.aspect=pose.width/pose.height;
  camera.matrixWorld.set(...pose.cameraToWorld.flat());
  camera.matrixWorld.decompose(camera.position,camera.quaternion,camera.scale);
  camera.up.set(pose.cameraToWorld[0][1],pose.cameraToWorld[1][1],pose.cameraToWorld[2][1]);
  camera.updateMatrixWorld(true);
  camera.projectionMatrix.set(...projectionFromK(pose,near,far));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export function cameraRecord(camera, width, height) {
  const p=camera.projectionMatrix.elements, w=camera.matrixWorld.elements;
  return {width,height,K:{fx:p[0]*width/2,fy:p[5]*height/2,cx:(1-p[8])*width/2,cy:(1+p[9])*height/2},cameraToWorld:Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>w[c*4+r])),near:camera.near,far:camera.far};
}
