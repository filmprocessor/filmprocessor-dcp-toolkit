function localName(node) {
  return node?.localName || node?.name?.split(':').pop() || '';
}

function directChildren(node, name = null) {
  const children = Array.from(node?.children || []);
  return name ? children.filter((child) => localName(child) === name) : children;
}

function firstDirect(node, name) {
  return directChildren(node, name)[0] || null;
}

function textOf(node, name) {
  return firstDirect(node, name)?.text?.trim() || '';
}

function numberOf(node, name) {
  const element = firstDirect(node, name);
  if (!element) {
    return null;
  }

  const text = element.text?.trim() || '';
  if (!text) {
    return null;
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid integer field ${name}`);
  return value;
}

function parseXml(text, expectedRoot, path) {
  const root = parseXmlTree(text, path);
  if (!root || localName(root) !== expectedRoot) {
    throw new Error(`${path}: expected ${expectedRoot}, found ${localName(root) || 'empty document'}`);
  }
  return { root };
}

export function parseAssetMap(text, path = 'ASSETMAP.xml') {
  const { root } = parseXml(text, 'AssetMap', path);
  const assetList = firstDirect(root, 'AssetList');
  const assets = directChildren(assetList, 'Asset').map((asset) => {
    const chunkList = firstDirect(asset, 'ChunkList');
    const chunks = directChildren(chunkList, 'Chunk').map((chunk) => ({
      path: textOf(chunk, 'Path'),
      volumeIndex: numberOf(chunk, 'VolumeIndex'),
      offset: numberOf(chunk, 'Offset'),
      length: numberOf(chunk, 'Length'),
    }));
    return {
      id: textOf(asset, 'Id'),
      packingList: /^true$/i.test(textOf(asset, 'PackingList')),
      chunks,
    };
  });

  return {
    path,
    id: textOf(root, 'Id'),
    annotationText: textOf(root, 'AnnotationText'),
    creator: textOf(root, 'Creator'),
    issuer: textOf(root, 'Issuer'),
    issueDate: textOf(root, 'IssueDate'),
    volumeCount: numberOf(root, 'VolumeCount'),
    assets,
  };
}

export function parseVolumeIndex(text, path = 'VOLINDEX.xml') {
  const { root } = parseXml(text, 'VolumeIndex', path);
  return {
    path,
    index: numberOf(root, 'Index'),
  };
}

export function parsePackingList(text, path = 'PKL.xml') {
  const { root } = parseXml(text, 'PackingList', path);
  const assetList = firstDirect(root, 'AssetList');
  const assets = directChildren(assetList, 'Asset').map((asset) => ({
    id: textOf(asset, 'Id'),
    annotationText: textOf(asset, 'AnnotationText'),
    hash: textOf(asset, 'Hash').replace(/\s+/g, ''),
    hashAlgorithm: firstDirect(asset, 'HashAlgorithm')?.attributes?.Algorithm || firstDirect(asset, 'Hash')?.attributes?.Algorithm || 'http://www.w3.org/2000/09/xmldsig#sha1',
    hasHashElement: Boolean(firstDirect(asset, 'Hash')),
    size: numberOf(asset, 'Size'),
    type: textOf(asset, 'Type'),
    originalFileName: textOf(asset, 'OriginalFileName'),
  }));

  return {
    path,
    id: textOf(root, 'Id'),
    annotationText: textOf(root, 'AnnotationText'),
    creator: textOf(root, 'Creator'),
    issuer: textOf(root, 'Issuer'),
    issueDate: textOf(root, 'IssueDate'),
    signed: hasDescendant(root, 'Signature'),
    assets,
  };
}

export function parseCompositionPlaylist(text, path = 'CPL.xml') {
  const { root } = parseXml(text, 'CompositionPlaylist', path);
  const reelList = firstDirect(root, 'ReelList');
  const reels = directChildren(reelList, 'Reel').map((reel) => {
    const assetList = firstDirect(reel, 'AssetList');
    const assets = directChildren(assetList)
      .filter((asset) => ['MainPicture', 'MainStereoscopicPicture', 'MainSound', 'MainSubtitle', 'AuxData'].includes(localName(asset)))
      .map((asset) => ({
        kind: localName(asset),
        stereoscopic: localName(asset) === 'MainStereoscopicPicture',
        id: textOf(asset, 'Id'),
        editRate: textOf(asset, 'EditRate'),
        intrinsicDuration: numberOf(asset, 'IntrinsicDuration'),
        entryPoint: numberOf(asset, 'EntryPoint'),
        duration: numberOf(asset, 'Duration'),
        hash: textOf(asset, 'Hash').replace(/\s+/g, ''),
        frameRate: textOf(asset, 'FrameRate'),
        keyId: textOf(asset, 'KeyId'),
      }));
    return {
      id: textOf(reel, 'Id'),
      assets,
    };
  });

  return {
    path,
    id: textOf(root, 'Id'),
    annotationText: textOf(root, 'AnnotationText'),
    contentTitleText: textOf(root, 'ContentTitleText'),
    contentKind: textOf(root, 'ContentKind'),
    creator: textOf(root, 'Creator'),
    issuer: textOf(root, 'Issuer'),
    issueDate: textOf(root, 'IssueDate'),
    signed: hasDescendant(root, 'Signature'),
    reels,
  };
}

function parseXmlTree(text, path) {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) throw new Error('XML must be a string of at most 8 Mi characters.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD and entity declarations are unsupported.');
  const root = {name:'#document',children:[],text:''};
  const stack = [root];
  const tokens = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>|[^<]+/g;
  let at = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index !== at) throw new Error(`${path}: invalid XML markup`);
    const token = match[0]; at += token.length;
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) {
      if (stack.length === 1) throw new Error(`${path}: text outside document element`);
      stack.at(-1).text += token.slice(9,-3); continue;
    }
    if (token.startsWith('</')) {
      if (stack.length < 2) throw new Error(`${path}: unexpected closing tag`);
      const name = token.slice(2,-1).trim();
      const node = stack.pop();
      if (name !== node.name) throw new Error(`${path}: mismatched closing tag`);
      stack.at(-1).text += node.text; continue;
    }
    if (token.startsWith('<')) {
      const name = /^<([\w:.-]+)/.exec(token)[1];
      const attributes = Object.create(null);
      for (const attr of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        if (Object.hasOwn(attributes,attr[1])) throw new Error(`${path}: duplicate attribute`);
        attributes[attr[1]] = decodeXmlEntities(attr[2] ?? attr[3]);
      }
      const node = {name,localName:name.split(':').pop(),children:[],text:'',attributes};
      stack.at(-1).children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
      if (stack.length > 256) throw new Error(`${path}: XML nesting limit exceeded`);
      continue;
    }
    if (stack.length === 1 && token.trim()) throw new Error(`${path}: text outside document element`);
    if (stack.length > 1) stack.at(-1).text += decodeXmlEntities(token);
  }
  if (at !== text.length || stack.length !== 1 || root.children.length !== 1) throw new Error(`${path}: incomplete or multiple XML roots`);
  return root.children[0];
}

function hasDescendant(node, name) {
  if (!node) {
    return false;
  }
  for (const child of node.children || []) {
    if (localName(child) === name || hasDescendant(child, name)) {
      return true;
    }
  }
  return false;
}

function decodeXmlEntities(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/.test(value)) throw new Error('Unsupported XML entity');
  return value.replace(/&([^;]+);/g, (_, name) => {
    const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (Object.hasOwn(named,name)) return named[name];
    const n = name.startsWith('#x') ? parseInt(name.slice(2),16) : parseInt(name.slice(1),10);
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new Error('Invalid XML character');
    return String.fromCodePoint(n);
  });
}
