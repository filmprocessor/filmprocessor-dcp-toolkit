import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  parseAssetMap,parseVolumeIndex,parsePackingList,parseCompositionPlaylist,
  verifyPackingList,inspectCompositionReferences,normalizeAssetPath,sha1Base64ForBlob,
} from '../src/index.js';

const picture = new Blob(['synthetic picture bytes']);
const sound = new Blob(['synthetic sound bytes']);
const hash = text => createHash('sha1').update(text).digest('base64');
const assetMapXml = `<am:AssetMap xmlns:am="urn:synthetic"><am:Id>package</am:Id><am:VolumeCount>1</am:VolumeCount><am:AssetList>
<am:Asset><am:Id>URN:UUID:PICTURE</am:Id><am:ChunkList><am:Chunk><am:Path>picture.mxf</am:Path><am:VolumeIndex>1</am:VolumeIndex><am:Offset>0</am:Offset><am:Length>${picture.size}</am:Length></am:Chunk></am:ChunkList></am:Asset>
<am:Asset><am:Id>sound</am:Id><am:ChunkList><am:Chunk><am:Path>sound.mxf</am:Path></am:Chunk></am:ChunkList></am:Asset>
</am:AssetList></am:AssetMap>`;
const pklXml = `<PackingList><Id>pkl</Id><AssetList>
<Asset><Id>urn:uuid:picture</Id><Size>${picture.size}</Size><Hash>${hash('synthetic picture bytes')}</Hash></Asset>
<Asset><Id>sound</Id><Size>${sound.size}</Size><Hash>${hash('synthetic sound bytes')}</Hash></Asset>
</AssetList></PackingList>`;
const cplXml = `<CompositionPlaylist><Id>cpl</Id><ContentTitleText>A &amp; B &#x1f3ac;</ContentTitleText>
<ReelList><Reel><Id>reel</Id><AssetList><MainPicture><Id>urn:uuid:picture</Id><EditRate>24 1</EditRate><Duration>48</Duration></MainPicture>
<MainSound><Id>missing</Id></MainSound></AssetList></Reel></ReelList></CompositionPlaylist>`;
const files = () => new Map([['picture.mxf',picture],['sound.mxf',sound]]);

test('parses namespace-prefixed manifests and selected CPL metadata',()=>{
  const am=parseAssetMap(assetMapXml);
  assert.equal(am.volumeCount,1);
  assert.equal(am.assets[0].chunks[0].length,picture.size);
  const cpl=parseCompositionPlaylist(cplXml,'CPL.xml');
  assert.equal(cpl.contentTitleText,'A & B 🎬');
  assert.equal(cpl.reels[0].assets[0].duration,48);
  assert.equal(cpl.signed,false);
  assert.equal(parseVolumeIndex('<VolumeIndex><Index>1</Index></VolumeIndex>').index,1);
  assert.deepEqual(inspectCompositionReferences(cpl,am).map(x=>x.presentInAssetMap),[true,false]);
});

test('compares synthetic PKL hashes and lengths with the supplied files',async()=>{
  const results=await verifyPackingList(parsePackingList(pklXml,'PKL.xml'),parseAssetMap(assetMapXml),files(),{chunkBytes:3});
  assert.deepEqual(results.map(x=>[x.sizeMatches,x.hashMatches]),[[true,true],[true,true]]);
  assert.ok(results.every(x=>!('severity' in x)));
});

test('line-wrapped base64 is normalized and unsafe integer fields are rejected',()=>{
  assert.equal(parsePackingList('<PackingList><AssetList><Asset><Id>x</Id><Hash>ab cd\n ef==</Hash></Asset></AssetList></PackingList>').assets[0].hash,'abcdef==');
  assert.throws(()=>parsePackingList('<PackingList><AssetList><Asset><Size>9007199254740993</Size></Asset></AssetList></PackingList>'),/integer/);
});

test('missing assets and changed bytes never become a successful comparison',async()=>{
  const changed=files();changed.set('picture.mxf',new Blob(['X'.repeat(picture.size)]));changed.delete('sound.mxf');
  const results=await verifyPackingList(parsePackingList(pklXml),parseAssetMap(assetMapXml),changed);
  assert.equal(results[0].sizeMatches,true);
  assert.equal(results[0].hashMatches,false);
  assert.deepEqual(results[1].missingPaths,['sound.mxf']);
  assert.equal(results[1].hashMatches,null);
  assert.equal(results[1].sizeMatches,null);
});

test('hashes concatenated chunks in declared order with offsets',async()=>{
  const am={assets:[{id:'asset',chunks:[{path:'part',offset:2,length:3},{path:'part',offset:6,length:2}]}]};
  const pkl={assets:[{id:'ASSET',size:5,hash:hash('abcde')}]};
  const [result]=await verifyPackingList(pkl,am,new Map([['part',new Blob(['xxabc_de!'])]]));
  assert.equal(result.hashMatches,true);
});

test('rejects ambiguous IDs, invalid paths, out-of-bounds chunks and unsupported hashes',async()=>{
  for(const path of ['../x','/x','https://host/x','C:\\x','x/../y',''])assert.throws(()=>normalizeAssetPath(path));
  assert.equal(normalizeAssetPath('./sub\\file.mxf'),'sub/file.mxf');
  const am=parseAssetMap(assetMapXml),pkl=parsePackingList(pklXml);
  await assert.rejects(verifyPackingList(pkl,{assets:[am.assets[0],am.assets[0]]},files()),/duplicate/);
  am.assets[0].chunks[0].length=picture.size+1;
  await assert.rejects(verifyPackingList(pkl,am,files()),/exceeds/);
  pkl.assets[0].hashAlgorithm='unsupported';
  await assert.rejects(verifyPackingList(pkl,parseAssetMap(assetMapXml),files()),/algorithm/);
});

test('rejects malformed roots, declarations, entities and excessive XML depth',()=>{
  for(const text of [
    '<AssetMap>', '<AssetMap></Other>', '<AssetMap/><AssetMap/>',
    '<!DOCTYPE AssetMap [<!ENTITY custom "x">]><AssetMap/>',
    '<AssetMap><Id>&unknown;</Id></AssetMap>',
    '<AssetMap><Id>&#0;</Id></AssetMap>', '<AssetMap/><', 'outside<AssetMap/>',
    '<AssetMap a="x" a="y"/>', '<AssetMap>'+ '<a>'.repeat(256) + '</a>'.repeat(256) + '</AssetMap>',
  ])assert.throws(()=>parseAssetMap(text),undefined,text.slice(0,70));
  assert.throws(()=>parseAssetMap('<PackingList/>'),/expected/);
  assert.equal(parseAssetMap('<AssetMap><AnnotationText><![CDATA[a < b]]></AnnotationText></AssetMap>').annotationText,'a < b');
});

test('Signature presence is metadata, not a verified signature',()=>{
  assert.equal(parsePackingList('<PackingList><Signature><SignatureValue>synthetic</SignatureValue></Signature></PackingList>').signed,true);
});

for(const length of [0,1,55,56,63,64,65,129,1000000]) {
  test(`chunked SHA-1 matches Node crypto for ${length} bytes`,async()=>{
    const bytes=new Uint8Array(length).fill(97);
    const expected=createHash('sha1').update(bytes).digest('base64');
    assert.equal(await sha1Base64ForBlob(new Blob([bytes]),{chunkBytes:101}),expected);
  });
}
test('hashing honours cancellation and refuses invalid chunk sizes',async()=>{
  const abort=new AbortController();abort.abort();
  await assert.rejects(sha1Base64ForBlob(picture,{signal:abort.signal}),{name:'AbortError'});
  await assert.rejects(sha1Base64ForBlob(picture,{chunkBytes:NaN}),RangeError);
});
