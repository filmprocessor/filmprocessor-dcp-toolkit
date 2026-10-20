import { iterateBlobChunks } from './range-reader.js';

const SHA1_BLOCK_BYTES = 64;

class StreamingSHA1 {
  constructor() {
    this.h0 = 0x67452301;
    this.h1 = 0xefcdab89;
    this.h2 = 0x98badcfe;
    this.h3 = 0x10325476;
    this.h4 = 0xc3d2e1f0;
    this.buffer = new Uint8Array(SHA1_BLOCK_BYTES);
    this.bufferLength = 0;
    this.bytesHashed = 0;
    this.words = new Uint32Array(80);
    this.finished = false;
  }

  update(data) {
    if (this.finished) {
      throw new Error('SHA-1 digest has already been finalized.');
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let position = 0;
    this.bytesHashed += bytes.byteLength;

    if (this.bufferLength) {
      const available = Math.min(SHA1_BLOCK_BYTES - this.bufferLength, bytes.byteLength);
      this.buffer.set(bytes.subarray(0, available), this.bufferLength);
      this.bufferLength += available;
      position += available;
      if (this.bufferLength === SHA1_BLOCK_BYTES) {
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }

    while (position + SHA1_BLOCK_BYTES <= bytes.byteLength) {
      this.processBlock(bytes.subarray(position, position + SHA1_BLOCK_BYTES));
      position += SHA1_BLOCK_BYTES;
    }

    if (position < bytes.byteLength) {
      this.buffer.set(bytes.subarray(position), 0);
      this.bufferLength = bytes.byteLength - position;
    }
    return this;
  }

  digest() {
    if (this.finished) {
      throw new Error('SHA-1 digest has already been finalized.');
    }
    const bitsHi = Math.floor(this.bytesHashed / 0x20000000);
    const bitsLo = (this.bytesHashed << 3) >>> 0;
    let position = this.bufferLength;

    this.buffer[position++] = 0x80;
    if (position > 56) {
      this.buffer.fill(0, position, SHA1_BLOCK_BYTES);
      this.processBlock(this.buffer);
      position = 0;
    }
    this.buffer.fill(0, position, 56);
    this.buffer[56] = (bitsHi >>> 24) & 0xff;
    this.buffer[57] = (bitsHi >>> 16) & 0xff;
    this.buffer[58] = (bitsHi >>> 8) & 0xff;
    this.buffer[59] = bitsHi & 0xff;
    this.buffer[60] = (bitsLo >>> 24) & 0xff;
    this.buffer[61] = (bitsLo >>> 16) & 0xff;
    this.buffer[62] = (bitsLo >>> 8) & 0xff;
    this.buffer[63] = bitsLo & 0xff;
    this.processBlock(this.buffer);
    this.finished = true;

    const out = new Uint8Array(20);
    this.writeWord(out, 0, this.h0);
    this.writeWord(out, 4, this.h1);
    this.writeWord(out, 8, this.h2);
    this.writeWord(out, 12, this.h3);
    this.writeWord(out, 16, this.h4);
    return out;
  }

  processBlock(block) {
    const words = this.words;
    for (let i = 0; i < 16; i++) {
      const offset = i * 4;
      words[i] = (
        (block[offset] << 24) |
        (block[offset + 1] << 16) |
        (block[offset + 2] << 8) |
        block[offset + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      words[i] = this.rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;

    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = ((b & c) | ((~b) & d)) >>> 0;
        k = 0x5a827999;
      } else if (i < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }
      const temp = (this.rotateLeft(a, 5) + f + e + k + words[i]) >>> 0;
      e = d;
      d = c;
      c = this.rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
  }

  rotateLeft(value, bits) {
    return ((value << bits) | (value >>> (32 - bits))) >>> 0;
  }

  writeWord(target, offset, word) {
    target[offset] = (word >>> 24) & 0xff;
    target[offset + 1] = (word >>> 16) & 0xff;
    target[offset + 2] = (word >>> 8) & 0xff;
    target[offset + 3] = word & 0xff;
  }
}

export async function sha1Base64ForBlob(blob, options = {}) {
  const sha1 = new StreamingSHA1();
  for await (const { chunk, loadedBytes, totalBytes } of iterateBlobChunks(blob, options)) {
    sha1.update(chunk);
    options.onProgress?.({ loadedBytes, totalBytes });
  }
  return bytesToBase64(sha1.digest());
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
