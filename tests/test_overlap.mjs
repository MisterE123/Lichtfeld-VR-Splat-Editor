import assert from 'node:assert/strict';
import {overlapsEllipsoid} from '../outputs/lichtfeld_vr_editor/viewer/overlap.js';
import {rotateVector} from '../outputs/lichtfeld_vr_editor/viewer/controls.js';
const axes=(x,y=x,z=x)=>[[x,0,0],[0,y,0],[0,0,z]];
for(const shape of ['sphere','box']) {
    assert.ok(overlapsEllipsoid([1.15,0,0],axes(.2),1,shape));
    assert.ok(!overlapsEllipsoid([1.21,0,0],axes(.2),1,shape));
    assert.ok(overlapsEllipsoid([1.2,0,0],axes(.2),1,shape));
    assert.ok(overlapsEllipsoid([0,0,0],axes(3),1,shape));
    // Long splats overlap only along their actual orientation, not a bounding sphere.
    assert.ok(!overlapsEllipsoid([0,1.3,0],axes(2,.05,.05),1,shape));
    assert.ok(overlapsEllipsoid([1.3,0,0],axes(2,.05,.05),1,shape));
    const q=[0,0,Math.SQRT1_2,Math.SQRT1_2];
    assert.ok(overlapsEllipsoid([0,1.3,0],axes(2,.05,.05).map(a=>rotateVector(a,q)),1,shape));
}
// A corner hit needs true ellipsoid overlap, not independent expanded axis bounds.
assert.ok(!overlapsEllipsoid([1.18,1.18,0],axes(.2),1,'box'));
assert.ok(overlapsEllipsoid([1.1,1.1,0],axes(.2),1,'box'));
let seed=17;
const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<1000;i++) {
    const center=Array.from({length:3},()=>random()*4-2),extent=.01+random()*.7,radius=.1+random();
    for(const shape of ['sphere','box']) {
        const distance=shape==='sphere'?Math.hypot(...center)-radius:
            Math.hypot(...center.map(v=>Math.max(0,Math.abs(v)-radius)));
        assert.equal(overlapsEllipsoid(center,axes(extent),radius,shape),distance<=extent,JSON.stringify({center,extent,radius,shape,distance}));
    }
}
console.log('Edge selection checks passed: tangency, anisotropy, orientation, box corners, and 2,000 analytic sphere/box comparisons.');
