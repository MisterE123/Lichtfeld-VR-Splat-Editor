import assert from 'node:assert/strict';
import {gripDelta,grabPosition,inSelector,buttons,deadzone,rotationBetween} from '../viewer/controls.js';
assert.equal(deadzone(.1),0);assert.equal(deadzone(1),1);
assert.equal(gripDelta([0,0,0],[.01,0,0],[0,0,0],[1,0,0]),null);
const scale=gripDelta([-.5,0,0],[.5,0,0],[-1,0,0],[1,0,0]);
assert.equal(scale.scale,2);assert.deepEqual(scale.rotation,[0,0,0,1]);
const rotation=gripDelta([0,0,0],[1,0,0],[0,0,0],[0,1,0]);
assert.ok(Math.abs(rotation.rotation[2]-Math.SQRT1_2)<1e-6);
assert.equal(rotation.scale,1);
assert.ok(rotationBetween([1,0,0],[-1,0,0]).every(Number.isFinite));
assert.ok(inSelector([.8,.8,0],[0,0,0],1,'box'));
assert.ok(!inSelector([.8,.8,0],[0,0,0],1,'sphere'));
assert.ok(inSelector([1,0,0],[0,0,0],1,'sphere'));
assert.deepEqual(buttons(null),{trigger:false,grip:false,lower:false,upper:false,x:0,y:0});
const gp={buttons:Array.from({length:6},()=>({pressed:false,value:0})),axes:[0,0,0,0]};
gp.buttons[4].pressed=true;assert.equal(buttons({gamepad:gp}).lower,true);
gp.buttons[5].value=.9;assert.equal(buttons({gamepad:gp}).upper,true);
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-6,`${a} != ${b}`));
// One grip translates without changing the rotation/scale.
near(grabPosition([4,5,6],[1,2,3],[2,4,6]),[5,7,9]);
// Both grips translate their midpoint, rotate 90 degrees, and double the scene together.
const combined=gripDelta([-1,0,0],[1,0,0],[3,2,0],[3,6,0]);
near(grabPosition([1,0,0],[0,0,0],[3,4,0],combined.rotation,combined.scale),[3,6,0]);
// Rebased one/two-hand transitions preserve the current transform on the first frame.
near(grabPosition([3,6,0],[3,4,0],[3,4,0]),[3,6,0]);
// An oriented box accepts its rotated corner and rejects an unrotated corner outside it.
const q=[0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)];
assert.ok(inSelector([1.3,0,0],[0,0,0],1,'box',q));
assert.ok(!inSelector([.9,.9,0],[0,0,0],1,'box',q));
assert.ok(!inSelector([1.3,0,0],[0,0,0],1,'sphere',q));
console.log('Controller checks passed: combined pan/scale/rotation, grab transitions, oriented box, sphere, degeneracy, deadzone, Quest mapping.');

