# FilmProcessor DCP Toolkit

Parse DCP manifests, compare asset references, sizes and SHA-1 hashes, and
check basic raw JPEG 2000 codestream framing.
Dependency-free JavaScript for browsers and Node.js 20+.

## Use

Clone this repository and import `src/index.js`; it is not published to npm.

```js
import {parseAssetMap,parsePackingList,verifyPackingList} from './src/index.js';
const assetMap=parseAssetMap(assetMapXml);
const packingList=parsePackingList(pklXml,'PKL.xml');
const files=new Map([['picture.mxf',pictureFile]]);
const comparisons=await verifyPackingList(packingList,assetMap,files);
```

`parseVolumeIndex` and `parseCompositionPlaylist` read the other manifest types.
`inspectCompositionReferences(cpl, assetMap)` reports whether each CPL asset ID
appears in the AssetMap. ID matching is case-insensitive; file paths are exact.

The integrity helper consumes an explicit map of relative paths to Blobs.
It handles offsets and concatenated chunks within a single volume. Results
contain actual/declared sizes and hashes, matches and missing paths.
Null match fields mean no comparison was possible; they do not mean success.
`sha1Base64ForBlob(blob, {chunkBytes, signal, onProgress})` hashes incrementally.
SHA-1 is included for existing DCP packing lists, not as a recommendation for
new security protocols. Unsupported declared hash algorithms are rejected.

## Raw JPEG 2000 structure

```js
import { getJ2KCodestreamValidationError } from './src/index.js';
const error = getJ2KCodestreamValidationError(rawCodestreamBytes);
// null: the implemented framing checks passed; string: a structural error.
```

Accepts a Uint8Array (including an offset view). Checks SOC/SIZ/SOT/SOD/EOC
ordering, marker-segment bounds, tile-part lengths and trailing bytes. Segment
and packet payloads are skipped by their declared bounds; marker-like bytes
inside them are not interpreted as new tile boundaries. A final zero Psot is
handled through the ending EOC. This reads raw codestreams, not JP2 containers
or MXF files.

A null result is **not** proof that the image can decode or meets a cinema
profile. SIZ/COD field semantics, component dimensions, packet data, quality,
bitrate limits and DCI acceptance are not checked. The function has no encoder
presets, product verdicts or quality tuning. It returns a structural diagnostic,
not a severity or application acceptance decision.

## Boundaries

These APIs provide parsed data and factual comparisons. Applications define
their own QC policy, severities and acceptance decisions.

This is a selected DCP metadata reader, not XML Schema validation, a full DCP
validator or a standards certification tool. XML attributes outside the few
needed fields are ignored. Input is limited to 8 Mi characters and 255 element
levels; DTDs and custom entities are rejected. It accepts conventional ASCII
element names with optional namespace prefixes.

`signed` only reports that a Signature element exists; signatures are not
verified. Encryption, KDM processing, signing, full essence validation and remote
storage integration are outside this package. No filesystem paths are opened
and no network requests are made by the library.

## Validation and licence

Run `npm test` and `node examples/inspect.js`. Tests use synthetic manifests,
standard SHA-1 vectors and byte-level corruption, missing-file and malformed-XML
cases, plus synthetic codestream framing, truncation, false markers and tile-boundary
cases. MIT; see `LICENSE` and `NOTICE`.
