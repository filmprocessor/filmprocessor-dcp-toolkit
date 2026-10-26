import test from 'node:test';
import assert from 'node:assert/strict';
import {getJ2KCodestreamValidationError as check} from '../src/index.js';

// Synthetic framing only: these bytes are not a decodable image.
const marker = (code, payload=[]) => [0xff,code,0,(payload.length+2),...payload];
const u32 = n => [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255];
const siz = marker(0x51,[0,0,...u32(1),...u32(1),...u32(0),...u32(0),...u32(1),...u32(1),...u32(0),...u32(0),0,1,7,1,1]);
const tile = (payload=[0x11,0x22], {length=14+payload.length,header=[],index=0}={}) => [0xff,0x90,0,10,0,index,...u32(length),0,1,...header,0xff,0x93,...payload];
const stream = (...parts) => Uint8Array.from([0xff,0x4f,...siz,...parts.flat(),0xff,0xd9]);

test('accept one and multiple length-bounded tile-parts',()=>{
 assert.equal(check(stream(tile())),null);
 assert.equal(check(stream(tile(),tile([1],{index:1}))),null);
});
test('marker-looking bytes inside marker payload and entropy bytes are not boundaries',()=>{
 const header=marker(0x64,[0xff,0x90,0xff,0xd9]);
 assert.equal(check(stream(header,tile([0xff,0x90,0xff,0xd9]))),null);
 const tileHeader=marker(0x64,[0xff,0x90]);
 assert.equal(check(stream(tile([1],{header:tileHeader,length:15+tileHeader.length}))),null);
});
test('zero Psot reaches the final EOC, and requires that EOC',()=>{
 const bytes=stream(tile([1,2],{length:0}));
 assert.equal(check(bytes),null);
 assert.notEqual(check(bytes.slice(0,-2)),null);
});
test('oversized and undersized Psot are refused',()=>{
 assert.match(check(stream(tile([1],{length:0xffffffff}))),/tile-part length/);
 assert.match(check(stream(tile([1],{length:13}))),/tile-part length/);
 assert.notEqual(check(stream(tile([1],{length:14}))),null);
});
test('missing SOC, SIZ, SOT, SOD and EOC fail',()=>{
 assert.match(check(Uint8Array.from([0,0,0xff,0xd9])),/SOC/);
 assert.match(check(Uint8Array.from([0xff,0x4f,...tile(),0xff,0xd9])),/SIZ/);
 assert.match(check(stream()),/SOT/);
 assert.match(check(stream([0xff,0x90,0,10,0,0,0,0,0,14,0,1])),/SOD/);
 assert.match(check(stream(tile()).slice(0,-2)),/EOC/);
});
test('bad marker segment lengths, duplicate SIZ and invalid SOT lengths fail',()=>{
 assert.match(check(stream(marker(0x51),tile())),/SIZ/);
 assert.match(check(stream([0xff,0x64,0,1],tile())),/segment length/);
 const bad=tile();bad[3]=9;assert.match(check(stream(bad)),/SOT length/);
 assert.match(check(stream([0xff,0x64,0,100],tile())),/segment length/);
});
test('trailing bytes and every truncated prefix fail without throwing',()=>{
 const bytes=stream(tile());
 assert.match(check(Uint8Array.from([...bytes,0])),/trailing/);
 for(let length=0;length<bytes.length;length++) assert.notEqual(check(bytes.slice(0,length)),null);
});
test('typed array offsets are respected and wrong input types refused',()=>{
 const bytes=stream(tile());const buffer=new Uint8Array(bytes.length+10);buffer.set(bytes,5);
 assert.equal(check(buffer.subarray(5,5+bytes.length)),null);
 for(const value of [null,undefined,[],new ArrayBuffer(12),'bytes']) assert.equal(typeof check(value),'string');
});
test('bounded deterministic random input never throws or stalls',()=>{
 let state=12345;
 for(let i=0;i<500;i++){
  const bytes=new Uint8Array(i%127);
  for(let j=0;j<bytes.length;j++){state=(Math.imul(state,1664525)+1013904223)>>>0;bytes[j]=state&255;}
  if(i%2===0&&bytes.length>2)bytes.set([0xff,0x4f]);
  assert.equal(typeof check(bytes),'string');
 }
});
