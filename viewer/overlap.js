// SPDX-License-Identifier: GPL-3.0-or-later
// Convex distance (GJK): a Gaussian's finite 3-sigma ellipsoid versus the tool.
import {add,sub,mul,dot,length} from './controls.js';

function solve(matrix,rhs) {
    const a=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;
    for(let i=0;i<n;i++) {
        let pivot=i;
        for(let j=i+1;j<n;j++) if(Math.abs(a[j][i])>Math.abs(a[pivot][i])) pivot=j;
        if(Math.abs(a[pivot][i])<1e-12) return null;
        [a[i],a[pivot]]=[a[pivot],a[i]];
        const scale=a[i][i];for(let k=i;k<=n;k++) a[i][k]/=scale;
        for(let j=0;j<n;j++) if(j!==i) {
            const factor=a[j][i];for(let k=i;k<=n;k++) a[j][k]-=factor*a[i][k];
        }
    }
    return a.map(row=>row[n]);
}

// Enumerate simplex faces to find the closest point to the origin, including
// degenerate lines/triangles. Scaling coordinates keeps the solve well-conditioned.
function closest(points) {
    let best=null;
    for(let mask=1;mask<(1<<points.length);mask++) {
        const face=points.filter((_,i)=>mask&(1<<i));
        if(face.length>4) continue;
        const base=face[0],edges=face.slice(1).map(p=>sub(p,base));
        const values=edges.length?solve(edges.map(a=>edges.map(b=>dot(a,b))),edges.map(a=>-dot(a,base))):[];
        if(!values) continue;
        const weights=[1-values.reduce((a,b)=>a+b,0),...values];
        if(weights.some(w=>w < -1e-9)) continue;
        const point=face.reduce((p,v,i)=>add(p,mul(v,weights[i])),[0,0,0]);
        const distance=dot(point,point);
        if(!best||distance<best.distance) best={point,distance,points:face.filter((_,i)=>weights[i]>1e-9)};
    }
    return best;
}

// Center and ellipsoid axes are expressed in the selector's oriented frame.
export function overlapsEllipsoid(center,axes,radius,shape) {
    const scale=Math.max(radius,length(center),...axes.map(length),1e-12);
    center=mul(center,1/scale);axes=axes.map(a=>mul(a,1/scale));radius/=scale;
    const support=d=>{
        const projected=axes.map(a=>dot(a,d)),denom=Math.hypot(...projected);
        let p=center.slice();
        if(denom>0) axes.forEach((a,i)=>{p=add(p,mul(a,projected[i]/denom));});
        const tool=shape==='box'?d.map(v=>Math.sign(v)*radius):mul(d,radius/(length(d)||1));
        return add(p,tool);
    };
    let simplex=[support(length(center)>0?mul(center,-1):[1,0,0])];
    for(let iteration=0;iteration<96;iteration++) {
        const result=closest(simplex);
        if(result.distance<=1e-12) return true;
        const p=support(mul(result.point,-1));
        // The support plane separates the origin from the Minkowski difference.
        if(dot(result.point,p)>1e-6*Math.sqrt(result.distance)) return false;
        if(result.distance-dot(result.point,p)<=1e-13) return false;
        simplex=[...result.points,p];
    }
    return false;
}
