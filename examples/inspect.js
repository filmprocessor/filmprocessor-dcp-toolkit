import {parseCompositionPlaylist} from '../src/index.js';
const xml=`<CompositionPlaylist><Id>synthetic-example</Id>
<ContentTitleText>Synthetic demonstration</ContentTitleText>
<ReelList><Reel><Id>reel-one</Id><AssetList><MainPicture>
<Id>picture-one</Id><EditRate>24 1</EditRate><Duration>48</Duration>
</MainPicture></AssetList></Reel></ReelList></CompositionPlaylist>`;
const cpl=parseCompositionPlaylist(xml);
console.log(JSON.stringify({title:cpl.contentTitleText,reels:cpl.reels.length,pictureFrames:cpl.reels[0].assets[0].duration}));
