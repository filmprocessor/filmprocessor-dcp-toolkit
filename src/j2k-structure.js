/**
 * Check marker framing in a raw JPEG 2000 codestream.
 * Marker segments are length-delimited; SOD payloads are bounded by Psot.
 * Searching every byte for FF90 mistakes marker data (including TLM lengths)
 * for SOT. This is a structural check, not a decoder or a DCI profile check.
 */
export function getJ2KCodestreamValidationError(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return 'codestream is empty';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = bytes.byteLength;
    if (view.getUint16(0) !== 0xff4f) return 'missing SOC marker';

    let offset = 2;
    let hasSIZ = false;
    let hasSOT = false;
    let tileEnd = null;
    let inTileHeader = false;
    while (offset + 2 <= length) {
        const marker = view.getUint16(offset);
        if (marker === 0xffd9) {
            if (inTileHeader) return 'missing SOD marker';
            if (!hasSIZ) return 'missing SIZ marker';
            if (!hasSOT) return 'missing SOT marker';
            return offset + 2 === length ? null : 'trailing bytes after EOC marker';
        }
        if (marker === 0xff93) {
            if (!inTileHeader) return `unexpected SOD marker at byte ${offset}`;
            if (tileEnd < offset + 2) return `tile-part ends before SOD at byte ${offset}`;
            offset = tileEnd;
            inTileHeader = false;
            continue;
        }
        if (marker === 0xff90) {
            if (inTileHeader) return 'missing SOD marker';
            if (!hasSIZ) return 'missing SIZ marker';
            if (offset + 12 > length) return `truncated SOT marker at byte ${offset}`;
            if (view.getUint16(offset + 2) !== 10) return `invalid SOT length at byte ${offset}`;
            const psot = view.getUint32(offset + 6);
            if (psot > length - offset) {
                return `tile-part length ${psot} exceeds remaining codestream bytes ${length - offset} at byte ${offset}`;
            }
            if (psot !== 0 && psot < 14) return `invalid tile-part length ${psot} at byte ${offset}`;
            // Psot=0 denotes the last tile-part, ending at the final EOC.
            tileEnd = psot === 0 ? length - 2 : offset + psot;
            inTileHeader = true;
            hasSOT = true;
            offset += 12;
            continue;
        }
        if (hasSOT && !inTileHeader) return `expected SOT or EOC marker at byte ${offset}`;
        if (marker < 0xff50 || marker > 0xff8f) return `unexpected marker at byte ${offset}`;
        const boundary = inTileHeader ? tileEnd : length;
        if (offset + 4 > boundary) return `truncated marker segment at byte ${offset}`;
        const segmentLength = view.getUint16(offset + 2);
        if (segmentLength < 2 || offset + 2 + segmentLength > boundary) {
            return `invalid marker segment length ${segmentLength} at byte ${offset}`;
        }
        if (marker === 0xff51) {
            if (hasSIZ || hasSOT || offset !== 2) return `unexpected SIZ marker at byte ${offset}`;
            hasSIZ = true;
        }
        offset += 2 + segmentLength;
    }
    return inTileHeader ? 'missing SOD marker' : 'missing EOC marker';
}
