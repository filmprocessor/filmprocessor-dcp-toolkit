import {sha1Base64ForBlob} from './hash.js';
const key=id=>String(id||'').trim().toLowerCase();
export function normalizeAssetPath(path) {
  const value=String(path||'').replace(/\\/g,'/').trim();
  if(!value || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('Expected a relative asset path.');
  const parts=value.split('/').filter(p=>p && p!=='.');
  if(parts.includes('..') || value.includes('\0') || !parts.length)throw new Error('Unsafe asset path.');
  return parts.join('/');
}
function indexAssets(assets) {
  const map=new Map();
  for(const asset of assets) {
    const id=key(asset.id);
    if(!id || map.has(id))throw new Error('Missing or duplicate asset ID.');
    map.set(id,asset);
  }
  return map;
}
/** Return matching IDs; applications decide how to interpret absent references. */
export function inspectCompositionReferences(cpl,assetMap) {
  const assets=indexAssets(assetMap.assets);
  return cpl.reels.flatMap(reel=>reel.assets.map(asset=>({
    reelId:reel.id,id:asset.id,kind:asset.kind,presentInAssetMap:assets.has(key(asset.id))
  })));
}
/** Compare PKL sizes and SHA-1 hashes with explicit caller-provided files. */
export async function verifyPackingList(packingList,assetMap,files,options={}) {
  const mapped=indexAssets(assetMap.assets);
  indexAssets(packingList.assets);
  const contents=new Map();
  for(const [path,blob] of files) {
    const normalized=normalizeAssetPath(path);
    if(contents.has(normalized))throw new Error('Duplicate asset path.');
    if(!blob || !Number.isSafeInteger(blob.size) || typeof blob.slice!=='function')throw new TypeError('Expected Blob-compatible files.');
    contents.set(normalized,blob);
  }
  const results=[];
  for(const asset of packingList.assets) {
    const entry=mapped.get(key(asset.id));
    const missingPaths=[],parts=[];
    for(const chunk of entry?.chunks||[]) {
      if(chunk.volumeIndex!=null && chunk.volumeIndex!==1)throw new Error('Only single-volume packages are supported.');
      const path=normalizeAssetPath(chunk.path),file=contents.get(path);
      if(!file){missingPaths.push(path);continue;}
      const offset=chunk.offset??0,length=chunk.length??(file.size-offset);
      if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>file.size)throw new RangeError('Asset chunk exceeds its file.');
      parts.push(file.slice(offset,offset+length));
    }
    const available=Boolean(entry?.chunks?.length)&&!missingPaths.length;
    const blob=available?new Blob(parts):null;
    const algorithm=asset.hashAlgorithm||'http://www.w3.org/2000/09/xmldsig#sha1';
    if(asset.hash && algorithm!=='http://www.w3.org/2000/09/xmldsig#sha1')throw new Error('Unsupported PKL hash algorithm.');
    const computedHash=blob&&asset.hash?await sha1Base64ForBlob(blob,options):null;
    results.push({id:asset.id,presentInAssetMap:Boolean(entry),missingPaths,
      declaredSize:asset.size,actualSize:blob?.size??null,
      sizeMatches:blob&&asset.size!=null?blob.size===asset.size:null,
      declaredHash:asset.hash||null,computedHash,
      hashMatches:computedHash?computedHash===asset.hash:null});
  }
  return results;
}
