// SPDX-License-Identifier: GPL-3.0-or-later
// Pure controller math, shared with automated checks.
export const sub = (a,b) => a.map((v,i)=>v-b[i]);
export const add = (a,b) => a.map((v,i)=>v+b[i]);
export const mul = (a,s) => a.map(v=>v*s);
export const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length = a => Math.hypot(...a);
export const unit = a => mul(a,1/(length(a)||1));
export const midpoint = (a,b) => mul(add(a,b),.5);
export const deadzone = (v,d=.15) => Math.abs(v)<=d ? 0 : Math.sign(v)*(Math.abs(v)-d)/(1-d);
export function rotationBetween(a,b) {
    a=unit(a); b=unit(b);
    const d=Math.max(-1,Math.min(1,dot(a,b)));
    if(d < -.999999) {
        const axis=unit(cross(a,Math.abs(a[0])<.9?[1,0,0]:[0,1,0]));
        return [...axis,0];
    }
    const q=[...cross(a,b),1+d], n=Math.hypot(...q);
    return q.map(v=>v/n);
}
export function gripDelta(startLeft,startRight,left,right) {
    const initial=sub(startRight,startLeft), current=sub(right,left);
    if(length(initial)<.08 || length(current)<.08) return null;
    return {rotation:rotationBetween(initial,current),scale:Math.max(.02,Math.min(50,length(current)/length(initial)))};
}
export function rotateVector(v,q) {
    const t=mul(cross(q.slice(0,3),v),2);
    return add(v,add(mul(t,q[3]),cross(q.slice(0,3),t)));
}
export function grabPosition(position,startAnchor,currentAnchor,rotation=[0,0,0,1],scale=1) {
    return add(currentAnchor,mul(rotateVector(sub(position,startAnchor),rotation),scale));
}
export function inSelector(point,center,radius,shape,orientation=[0,0,0,1]) {
    const d=rotateVector(sub(point,center),[-orientation[0],-orientation[1],-orientation[2],orientation[3]]);
    return shape==='box' ? d.every(v=>Math.abs(v)<=radius) : dot(d,d)<=radius*radius;
}
export function buttons(source) {
    const gp=source?.gamepad;
    const pressed=i => !!gp?.buttons?.[i] && (gp.buttons[i].pressed || gp.buttons[i].value>.65);
    return {trigger:pressed(0),grip:pressed(1),lower:pressed(4),upper:pressed(5),
            x:deadzone(gp?.axes?.[2]||0),y:deadzone(gp?.axes?.[3]||0)};
}
