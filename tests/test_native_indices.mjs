import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeIndexMap} from '../viewer/controls.js';

// Exercise the actual bundled engine's Morton ordering and property reordering.
const source=fs.readFileSync(new URL('../viewer/viewer.js',import.meta.url),'utf8');
const start=source.indexOf('\t\tcalcMortonOrder() {');
const end=source.indexOf('\t\tconstructor(elements, comments = [])',start);
const methods=source.slice(start,end);
const Data=Function(`return class {${methods}}`)();
const properties=[{name:'x',storage:Float32Array.from([1,-1,1,-1,0,0])},
    {name:'y',storage:Float32Array.from([1,-1,-1,1,0,0])},
    {name:'z',storage:Float32Array.from([1,-1,1,-1,0,0])},
    {name:'lfs_index',storage:Uint32Array.from([0,1,2,3,4,5])}];
const data=new Data();data.numSplats=6;data.elements=[{properties}];
data.getProp=name=>properties.find(p=>p.name===name).storage;
const order=data.calcMortonOrder();assert.notDeepEqual(Array.from(order),[0,1,2,3,4,5]);
data.reorderData();
const ids=data.getProp('lfs_index'),inverse=nativeIndexMap(ids,6);
assert.deepEqual(Array.from(ids),Array.from(order));
// A hit on render row zero must select/delete native row one, never native zero.
assert.equal(ids[0],1);assert.equal(inverse[1],0);
const deletedNative=[1,3];const deletedRender=deletedNative.map(id=>inverse[id]);
assert.deepEqual(deletedRender.map(row=>ids[row]),deletedNative);
assert.equal(nativeIndexMap(Uint32Array.from([0,1,2]),3),null);
assert.throws(()=>nativeIndexMap(undefined,3),/Missing/);
assert.throws(()=>nativeIndexMap(Uint32Array.from([0,0,2]),3),/duplicate/);
assert.throws(()=>nativeIndexMap(Uint32Array.from([0,1,8]),3),/Invalid/);
// Repeated coordinates must preserve source order in the engine's stable sort.
assert.ok(Array.from(order).indexOf(4)<Array.from(order).indexOf(5));
console.log('Native index checks passed against actual engine sorting: paint IDs, state mapping, ties, and invalid-ID rejection.');
if(process.argv.includes('--fixture')) {
    let seed=31;
    const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
    const xyz=Array.from({length:3},()=>Float32Array.from({length:257},()=>random()*100-50));
    for(let axis=0;axis<3;axis++) {xyz[axis][4]=xyz[axis][3];xyz[axis][256]=xyz[axis][0];}
    const randomData=new Data();randomData.numSplats=257;randomData.getProp=name=>xyz[['x','y','z'].indexOf(name)];
    console.log(JSON.stringify({points:Array.from({length:257},(_,i)=>xyz.map(a=>a[i])),order:Array.from(randomData.calcMortonOrder())}));
}

