export async function* iterateBlobChunks(blob, {chunkBytes=8*1024*1024, signal, shouldAbort}={}) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes<1) throw new RangeError('chunkBytes must be a positive safe integer.');
  for (let offset=0;offset<blob.size;offset+=chunkBytes) {
    if (signal?.aborted || shouldAbort?.()) throw signal?.reason || new DOMException('Aborted','AbortError');
    const end=Math.min(blob.size,offset+chunkBytes);
    const chunk=new Uint8Array(await blob.slice(offset,end).arrayBuffer());
    yield {chunk,offset,loadedBytes:end,totalBytes:blob.size};
  }
}
