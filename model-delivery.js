// Lossless static transport. Renderer/model parameters are never changed here.
const HEX=/^[a-f0-9]{64}$/i;
const integer=n=>Number.isSafeInteger(n)&&n>0;
const littleEndian=new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]===4;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function fail(message){throw Error(message);}
export function chunkURL(value,base){
  if(typeof value!=='string'||!value||value.includes('\\'))fail('Invalid model chunk location.');
  if(/^https:\/\//i.test(value)){
    const u=new URL(value);const h=u.hostname.toLowerCase();
    if(u.username||u.password||u.hash||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal')||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)||h.includes(':'))fail('Model chunks require a public HTTPS location without credentials.');
    return u;
  }
  if(!/^[A-Za-z0-9_.\/-]+$/.test(value)||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'))fail('Model chunks require safe relative paths or public HTTPS URLs.');
  const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol))fail('A web model location is required.');return u;
}
export function validateDeliveryManifest(m,expected){
  if(m?.schemaVersion!==1||!['gzip-chunks','gzip-byte-shuffle-chunks'].includes(m.encoding))fail('Unsupported lossless model delivery.');
  const a=m.original,b=m.compressed;
  if(!expected||!HEX.test(expected.sha256??'')||!integer(expected.pointCount)||expected.shDegree!==3||!a||!integer(a.bytes)||a.bytes>=2**31||a.sha256!==expected.sha256||a.pointCount!==expected.pointCount||a.shDegree!==3||(expected.bytes!==undefined&&a.bytes!==expected.bytes))fail('The hosted model differs from the accepted model.');
  if(!b||!integer(b.bytes)||!HEX.test(b.sha256??'')||!Array.isArray(m.chunks)||!m.chunks.length)fail('Incomplete model download manifest.');
  let total=0;for(const c of m.chunks){if(!integer(c.bytes)||c.bytes>24*1024*1024||!HEX.test(c.sha256??'')||typeof c.path!=='string')fail('Invalid model chunk identity/size.');total+=c.bytes;}
  if(total!==b.bytes)fail('Model chunk byte counts do not add up.');
  if(m.encoding==='gzip-byte-shuffle-chunks'){
    const t=m.transform;if(t?.name!=='ply-byte-shuffle-v1'||!integer(t.headerBytes)||t.headerBytes>65536||!integer(t.strideBytes)||t.strideBytes!==236||!integer(t.blockVertices)||t.blockVertices>65536||t.headerBytes+a.pointCount*t.strideBytes!==a.bytes)fail('Invalid reversible model byte-shuffle contract.');
  }
  return m;
}
export function unshufflePLYStream(stream,m,{signal}={}){
  if(m.encoding==='gzip-chunks')return stream;
  const t=m.transform;let headerLeft=t.headerBytes,vertices=m.original.pointCount,buffer=null,filled=0;
  const allocate=()=>{buffer=vertices?new Uint8Array(Math.min(vertices,t.blockVertices)*t.strideBytes):null;filled=0;};
  return stream.pipeThrough(new TransformStream({
    async transform(chunk,controller){
      let at=0;
      if(headerLeft){const n=Math.min(headerLeft,chunk.length);controller.enqueue(chunk.slice(0,n));headerLeft-=n;at=n;}
      while(at<chunk.length){
        if(signal?.aborted)throw signal.reason??Error('Model loading cancelled.');
        if(!vertices)fail('Unexpected bytes after the model body.');if(!buffer)allocate();
        const n=Math.min(buffer.length-filled,chunk.length-at);buffer.set(chunk.subarray(at,at+n),filled);filled+=n;at+=n;
        if(filled===buffer.length){
          const rows=Math.min(vertices,t.blockVertices),restored=new Uint8Array(buffer.length);
          // Preserve every original bit: no floats are parsed/re-encoded.
          if(littleEndian){
            const words=new Uint32Array(restored.buffer),strideWords=t.strideBytes/4;
            for(let column=0;column<strideWords;column++){let src=column*4*rows,dst=column;for(let row=0;row<rows;row++,dst+=strideWords)words[dst]=buffer[src+row]|buffer[src+rows+row]<<8|buffer[src+2*rows+row]<<16|buffer[src+3*rows+row]<<24;}
          }else for(let column=0;column<t.strideBytes;column++){let src=column*rows,dst=column;for(let row=0;row<rows;row++,dst+=t.strideBytes)restored[dst]=buffer[src+row];}
          controller.enqueue(restored);vertices-=rows;buffer=null;filled=0;
        }
      }
    },
    flush(){if(headerLeft||vertices||filled)fail('The model byte-shuffle stream ended early.');}
  }));
}
function inspectHeader(bytes,original){
  const text=new TextDecoder('ascii').decode(bytes),match=/end_header\r?\n/.exec(text);if(!match)return null;
  const end=match.index+match[0].length,header=text.slice(0,match.index),count=Number(/element vertex (\d+)/.exec(header)?.[1]);
  const fields=header.split(/\r?\n/).filter(s=>s.startsWith('property ')).map(s=>s.trim().split(/\s+/));
  const required=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3',...Array.from({length:45},(_,i)=>'f_rest_'+i)];
  if(!header.startsWith('ply\n')&&!header.startsWith('ply\r\n'))fail('Restored model is not PLY.');
  if(!header.includes('format binary_little_endian 1.0')||count!==original.pointCount||fields.length!==59||fields.some(f=>!['float','float32'].includes(f[1]))||required.some(name=>!fields.some(f=>f[2]===name))||end+count*236!==original.bytes)fail('Restored PLY header/count/SH3 differs from the accepted model.');
  return{headerBytes:end,pointCount:count,storedSHDegree:3,strideBytes:236};
}
export async function prepareExactPlyStream(manifestURL,{expectedModel,onProgress=()=>{},signal,fetchImpl=fetch}={}){
  const base=new URL(manifestURL,globalThis.location?.href??'http://127.0.0.1/');if(!['http:','https:'].includes(base.protocol))fail('The model manifest must use a web URL.');
  const abort=new AbortController();if(signal?.aborted)throw signal.reason??Error('Model loading cancelled.');signal?.addEventListener('abort',()=>abort.abort(signal.reason),{once:true});
  const response=await fetchImpl(base,{signal:abort.signal,credentials:'omit',cache:'no-cache'});if(!response.ok)fail('The model manifest could not be downloaded.');
  const manifest=validateDeliveryManifest(await response.json(),expectedModel);manifest.chunks.forEach(c=>chunkURL(c.path,base));
  let index=0,compressedBytes=0,decodedBytes=0,header=null,prefix=new Uint8Array(0),resolveVerified,rejectVerified;
  const verified=new Promise((resolve,reject)=>{resolveVerified=resolve;rejectVerified=reject;});verified.catch(()=>{});
  const progress=phase=>onProgress({phase,loaded:compressedBytes,total:manifest.compressed.bytes,decodedBytes,totalDecoded:manifest.original.bytes});
  const compressed=new ReadableStream({async pull(controller){
    try{
      if(index===manifest.chunks.length){if(compressedBytes!==manifest.compressed.bytes)fail('Compressed model byte count differs.');controller.close();return;}
      const item=manifest.chunks[index],r=await fetchImpl(chunkURL(item.path,base),{signal:abort.signal,credentials:'omit',cache:'force-cache',mode:'cors'});if(!r.ok)fail('A model download part is unavailable.');
      const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==item.bytes||await digest(bytes)!==item.sha256)fail('A model download part failed its integrity check.');index++;compressedBytes+=bytes.length;progress('download');controller.enqueue(bytes);
    }catch(error){abort.abort(error);rejectVerified(error);controller.error(error);}
  },cancel(reason){abort.abort(reason);rejectVerified(reason??Error('Model loading cancelled.'));}},{highWaterMark:0});
  if(typeof DecompressionStream==='undefined')fail('This browser does not support the required lossless gzip decoder. Please use a current desktop browser.');
  const original=unshufflePLYStream(compressed.pipeThrough(new DecompressionStream('gzip')),manifest,{signal:abort.signal}),reader=original.getReader();
  const stream=new ReadableStream({async pull(controller){
    try{
      const next=await reader.read();
      if(next.done){if(decodedBytes!==manifest.original.bytes||!header||index!==manifest.chunks.length)fail('The restored model download is incomplete.');resolveVerified({acceptedOriginalSha256:manifest.original.sha256,originalWholeSHARecomputedInBrowser:false,allCompressedChunkSHA256Verified:true,gzipCRCValidatedByPlatform:true,originalByteCount:decodedBytes,...header});progress('verified');controller.close();return;}
      const bytes=next.value;decodedBytes+=bytes.length;if(decodedBytes>manifest.original.bytes)fail('The restored model is larger than expected.');
      if(!header){const n=Math.min(bytes.length,65536-prefix.length),joined=new Uint8Array(prefix.length+n);joined.set(prefix);joined.set(bytes.subarray(0,n),prefix.length);prefix=joined;header=inspectHeader(prefix,manifest.original);if(!header&&prefix.length===65536)fail('Restored PLY header is too large.');if(header){if(manifest.transform&&header.headerBytes!==manifest.transform.headerBytes)fail('The model header differs from its byte-shuffle contract.');prefix=new Uint8Array(0);}}
      progress('decode');controller.enqueue(bytes);
    }catch(error){abort.abort(error);rejectVerified(error);controller.error(error);}
  },cancel(reason){abort.abort(reason);rejectVerified(reason??Error('Model loading cancelled.'));return reader.cancel(reason);}},{highWaterMark:0});
  return{stream,streamLength:manifest.original.bytes,fileType:'ply',fileName:'accepted-model.ply',verified,manifest};
}
export async function loadExactPlyBytes(url,options){
  const delivery=await prepareExactPlyStream(url,options),bytes=new Uint8Array(delivery.streamLength),reader=delivery.stream.getReader();let offset=0;
  for(;;){const item=await reader.read();if(item.done)break;bytes.set(item.value,offset);offset+=item.value.length;}
  await delivery.verified;return bytes;
}
