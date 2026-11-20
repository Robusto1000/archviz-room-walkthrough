import {createNavigation} from './navigation.js';

export function walkingSetup(manifest,data,rooms){
  if(!data?.grid||data.source!=='new-complete-evaluated-triangles'||data.grid.space!=='body-centres'||data.grid.wholeCellConservative!==true||data.geometryMetaSha256!==manifest.navigation.geometryMetaSha256)throw Error('The walking boundaries are unavailable.');
  if(data.bodyRadius!==.2||data.bodyHeight!==1.85||data.grid.appliedBodyRadius!==.2)throw Error('Walking clearance differs from the apartment settings.');
  const navigation=createNavigation(data);
  if(!Array.isArray(rooms)||!['living','bedroom'].every(id=>rooms.some(room=>room.id===id)))throw Error('Both saved room viewpoints are required.');
  for(const room of rooms){
    if(!Array.isArray(room.position)||!Array.isArray(room.target)||room.position.length!==3||room.target.length!==3||![...room.position,...room.target].every(Number.isFinite)||Math.abs(room.position[1]-navigation.eyeY)>.02||!navigation.test(room.position[0],room.position[2])||Math.hypot(room.target[0]-room.position[0],room.target[2]-room.position[2])<.1)throw Error('A saved room viewpoint is outside the walking area.');
  }
  return navigation;
}
