// SPDX-License-Identifier: GPL-3.0-or-later
import {Vec3,Quat,Mat4,Entity,Color,loadGsplat} from './viewer.js';
import {buttons,gripDelta,midpoint,grabPosition} from './controls.js';
import {overlapsEllipsoid} from './overlap.js';

export function attachEditor(global,first,config,token) {
    const {app,camera}=global, rig=camera.parent;
    const root=new Entity('VR scene manipulation'); app.root.addChild(root);
    const nodes=[];
    let ready=false,painting=false,grabbing=null,previous={},reference=null,lastFrame=0;
    let radius=.12,shape='sphere',lastPaint=0,inFlight=false,polling=false,fault=false;
    let chain=Promise.resolve();
    let lastTracking='',lastTelemetry=0;
    let selectionMode='center';
    const status=document.createElement('div');
    status.id='editorStatus';
    status.style.cssText='position:fixed;left:12px;top:12px;z-index:1000;background:#101725e8;color:white;padding:12px;font:14px sans-serif;max-width:420px;pointer-events:none';
    document.body.appendChild(status);
    function diagnostic(event,details='') {
        fetch('/diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-VR-Token':token},
              body:JSON.stringify({event,details:String(details),time:new Date().toISOString()})}).catch(()=>{});
    }
    function show(message) { status.textContent=message; diagnostic('status',message); }
    show('Loading VR editing data…');
    function applyState(state) {
        if(state?.selectionMode && state.selectionMode!==selectionMode) {
            finish();selectionMode=state.selectionMode;
            diagnostic('selection-mode',selectionMode);
        }
        if(!state?.nodes || state.nodes.length!==nodes.length) return;
        nodes.forEach((n,i)=>{
            const current=state.nodes[i], signature=JSON.stringify(current);
            if(n.signature===signature) return;
            n.signature=signature;
            n.deleted.fill(0); for(const id of current.deleted) n.deleted[id]=1;
            const selected=new Set(current.selected);
            const opacity=n.data.getProp('opacity');
            const rgb=[0,1,2].map(j=>n.data.getProp(`f_dc_${j}`));
            for(let j=0;j<n.count;j++) {
                opacity[j]=n.deleted[j]?-100:n.opacity[j];
                for(let c=0;c<3;c++) rgb[c][j]=selected.has(j)?([-1,2,-1][c]):n.rgb[c][j];
            }
            n.resource.updateColorData(n.data);
        });
        app.renderNextFrame=true;
    }
    async function request(command) {
        const response=await fetch('/command',{method:'POST',headers:{'Content-Type':'application/json','X-VR-Token':token},body:JSON.stringify(command)});
        const data=await response.json();
        if(!response.ok) throw new Error(data.error||`HTTP ${response.status}`);
        applyState(data); return data;
    }
    function send(command) {
        chain=chain.then(()=>request(command)).catch(e=>{
            fault=true; painting=false; grabbing=null;
            show(`Editing paused: ${e.message}. Stop and relaunch from Lichtfeld.`);
            console.error(e);
        });
        return chain;
    }
    function finish(cancel=false) {
        if(painting) {painting=false; send({op:cancel?'cancel':'commit'});}
    }
    function addNode(entity,record) {
        // Raw dataset positions and node matrices become viewer space through Z=180°.
        const m=new Mat4();
        m.set(record.matrix[0].map((_,i)=>record.matrix.map(row=>row[i])).flat());
        const flip=new Mat4().setTRS(Vec3.ZERO,new Quat().setFromEulerAngles(0,0,180),Vec3.ONE);
        m.mul2(flip,m);
        root.addChild(entity);
        entity.setLocalPosition(m.getTranslation()); entity.setLocalRotation(new Quat().setFromMat4(m));
        entity.setLocalScale(m.getScale());
        const resource=entity.gsplat.instance.resource, data=resource.gsplatData;
        if(data.numSplats!==record.count) throw new Error('Export index count mismatch');
        const scales=[0,1,2].map(i=>data.getProp(`scale_${i}`));
        const bounds=new Float32Array(record.count);
        for(let i=0;i<record.count;i++) bounds[i]=3*Math.exp(Math.max(scales[0][i],scales[1][i],scales[2][i]));
        nodes.push({entity,resource,data,count:record.count,offset:record.offset,
                    scales,bounds,rotations:[1,2,3,0].map(i=>data.getProp(`rot_${i}`)),
                    xyz:['x','y','z'].map(p=>data.getProp(p)),opacity:data.getProp('opacity').slice(),
                    rgb:[0,1,2].map(i=>data.getProp(`f_dc_${i}`).slice()),deleted:new Uint8Array(record.count)});
    }
    (async()=>{
        addNode(first,config.nodes[0]);
        for(const record of config.nodes.slice(1)) {
            const url=`/${record.file}`;
            const entity=await loadGsplat(app,{contentUrl:url,contents:fetch(url,{headers:{'X-VR-Token':token}}),unified:false,aa:false},()=>{});
            addNode(entity,record);
        }
        ready=true;
        await send({op:'state'});
        if(!fault) show('Ready. Click Enter VR at the top right. Right stick: turn/move • Right trigger: select • Left stick: left/right size, up/down vertical movement • One grip: pan • Both grips: pan/rotate/scale • Y clear • X delete • B undo • A redo');
    })().catch(e=>{fault=true;show(e.message);console.error(e);});

    // Request immersive VR directly inside the click's user-activation event.
    const vrButton=document.createElement('button'); vrButton.textContent='Enter VR';
    vrButton.style.cssText='position:fixed;right:12px;top:12px;z-index:1001;padding:12px 20px;background:#2875db;color:white;border:0;border-radius:6px;font:600 16px sans-serif;cursor:pointer';
    document.body.appendChild(vrButton);
    const vrError=error=>{vrButton.disabled=false;vrButton.textContent='Enter VR';
        show(`VR could not start: ${error.name||'Error'}: ${error.message||error}. SteamVR must be running and selected as the OpenXR runtime. If Chrome was opened first, restart Chrome.`);
        diagnostic('xr-error',`${error.name}: ${error.message}`);console.error('VR Editor session error',error);};
    app.xr.on('error',vrError);
    vrButton.onclick=()=>{
        if(app.xr.active){app.xr.end();return;}
        if(!ready){show('Scene is still loading. Wait for Ready, then click Enter VR.');return;}
        diagnostic('xr-request',`secure=${window.isSecureContext}, navigator.xr=${!!navigator.xr}, engineAvailable=${app.xr.isAvailable('immersive-vr')}`);
        if(!navigator.xr){vrError(new Error('WebXR is unavailable in this browser'));return;}
        vrButton.disabled=true;vrButton.textContent='Requesting VR…';
        show('Requesting the headset session. Check Chrome and the headset for a permission prompt.');
        app.xr.start(camera.camera,'immersive-vr','local-floor',{callback:error=>{
            if(error)vrError(error);
            else diagnostic('xr-request-accepted');
        }});
    };
    if(navigator.xr)navigator.xr.isSessionSupported('immersive-vr').then(supported=>diagnostic('xr-supported',supported)).catch(vrError);
    else diagnostic('xr-supported','WebXR API absent');
    app.xr.on('start',async()=>{
        console.info('VR Editor: immersive session started');
        vrButton.disabled=false;vrButton.textContent='Exit VR';diagnostic('xr-start');show('VR session active. Put on the headset and use the controllers.');
        previous={};grabbing=null;lastFrame=0;reference=null;
        try {reference=await app.xr.session.requestReferenceSpace('local-floor');}
        catch(e) {show(`Tracking unavailable: ${e.message}`);}
    });
    app.xr.on('end',()=>{finish();grabbing=null;reference=null;previous={};vrButton.disabled=false;vrButton.textContent='Enter VR';diagnostic('xr-end');show('VR session ended. Click Enter VR to return.');console.info('VR Editor: immersive session ended');});
    app.xr.on('update',frame=>{
        if(!ready || fault || !reference) return;
        const now=performance.now(), dt=Math.min(.05,lastFrame?(now-lastFrame)/1000:0);lastFrame=now;
        const sources=Array.from(app.xr.session.inputSources), left=sources.find(s=>s.handedness==='left'),right=sources.find(s=>s.handedness==='right');
        const l=buttons(left),r=buttons(right);
        if(left) rig.translate(new Vec3(0,-l.y*1.5*dt,0));
        // Turn about the headset rather than orbiting the tracking-space origin.
        if(right) {
            const yaw=new Quat().setFromEulerAngles(0,-r.x*90*dt,0);
            const head=camera.getPosition().clone();
            rig.setPosition(yaw.transformVector(rig.getPosition().clone().sub(head)).add(head));
            rig.setRotation(new Quat().mul2(yaw,rig.getRotation()));
            const forward=camera.forward.clone();forward.y=0;
            if(forward.lengthSq()>1e-6) rig.translate(forward.normalize().mulScalar(-r.y*1.5*dt));
        }
        function grip(source) {
            const pose=source?.gripSpace&&frame.getPose(source.gripSpace,reference);
            if(!pose) return null;
            const p=pose.transform.position;
            return rig.getWorldTransform().transformPoint(new Vec3(p.x,p.y,p.z));
        }
        const lp=grip(left),rp=grip(right);
        const tracking=`left=${!!lp}, right=${!!rp}`;
        if(tracking!==lastTracking){lastTracking=tracking;diagnostic('tracking',tracking);console.info(`VR Editor tracking: ${tracking}`);}
        const edge=(name,value)=>value&&!previous[name];
        const command=edge('y',l.upper)?'clear':edge('x',l.lower)?'delete':edge('b',r.upper)?'undo':edge('a',r.lower)?'redo':null;
        if(command) {finish();send({op:command});}
        if(edge('shape',l.trigger)) {finish();shape=shape==='sphere'?'box':'sphere';}
        const mode=l.grip&&lp?(r.grip&&rp?'both':'left'):(r.grip&&rp?'right':null);
        if(mode) {
            finish();
            const a=lp&&[lp.x,lp.y,lp.z],b=rp&&[rp.x,rp.y,rp.z];
            const anchor=mode==='both'?midpoint(a,b):mode==='left'?a:b;
            // Rebase on every one-hand/two-hand transition so releasing a grip never jumps.
            if(!grabbing || grabbing.mode!==mode) grabbing={mode,left:a,right:b,anchor,
                rotation:root.getRotation().clone(),position:root.getPosition().clone(),scale:root.getLocalScale().x};
            let delta=mode==='both'?gripDelta(grabbing.left,grabbing.right,a,b):null;
            const rotation=delta?.rotation||[0,0,0,1];
            const scale=Math.max(.01,Math.min(100,grabbing.scale*(delta?.scale||1)));
            root.setRotation(new Quat().mul2(new Quat(...rotation),grabbing.rotation));
            root.setLocalScale(scale,scale,scale);
            const start=grabbing.position;
            root.setPosition(new Vec3(...grabPosition([start.x,start.y,start.z],grabbing.anchor,anchor,rotation,scale/grabbing.scale)));
            if(mode==='both'&&!delta) {
                // Coincident hands still pan; reset before a usable separation returns.
                grabbing.left=a;grabbing.right=b;
                grabbing.anchor=anchor;grabbing.position=root.getPosition().clone();
                grabbing.rotation=root.getRotation().clone();grabbing.scale=root.getLocalScale().x;
            }
        } else grabbing=null;
        {
            radius=Math.max(.005,Math.min(3,radius*Math.exp(l.x*dt*1.5)));
            if(rp) {
                // Selector is attached just ahead of the right controller, not a remote raycast.
                const rayPose=right?.targetRaySpace&&frame.getPose(right.targetRaySpace,reference);
                let center=rp.clone();
                let orientation=rig.getRotation().clone();
                if(rayPose) {
                    const o=rayPose.transform.orientation;
                    orientation.mul2(rig.getRotation(),new Quat(o.x,o.y,o.z,o.w));
                    center.add(orientation.transformVector(new Vec3(0,0,-.15)));
                }
                drawSelector(center,radius,shape,r.trigger&&!mode,orientation);
                if(r.trigger&&!mode&&!command&&!l.trigger) {
                    if(!inFlight&&now-lastPaint>=100) {
                        lastPaint=now;inFlight=true;painting=true;
                        const indices=hitIndices(center,radius,shape,orientation);
                        send({op:'paint',indices}).finally(()=>{inFlight=false;});
                    }
                } else finish();
            } else finish(true);
        }
        previous={y:l.upper,x:l.lower,b:r.upper,a:r.lower,shape:l.trigger};
        if(now-lastTelemetry>3000){lastTelemetry=now;console.info(`VR Editor input: grips=${l.grip}/${r.grip}, sticks=${r.x.toFixed(2)},${r.y.toFixed(2)} left=${l.x.toFixed(2)},${l.y.toFixed(2)}, selector=${shape}/${radius.toFixed(3)}, painting=${painting}`);}
    });

    function hitIndices(center,radius,shape,orientation) {
        const hits=[],p=new Vec3(),inverse=orientation.clone().invert(),q=new Quat();
        for(const n of nodes) {
            const transform=n.entity.getWorldTransform(),m=transform.data,[x,y,z]=n.xyz;
            const worldScale=Math.max(Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10]));
            for(let i=0;i<n.count;i++) {
                if(n.deleted[i]) continue;
                p.set(m[0]*x[i]+m[4]*y[i]+m[8]*z[i]+m[12]-center.x,
                      m[1]*x[i]+m[5]*y[i]+m[9]*z[i]+m[13]-center.y,
                      m[2]*x[i]+m[6]*y[i]+m[10]*z[i]+m[14]-center.z);
                if(shape==='box'||selectionMode==='edge') inverse.transformVector(p,p);
                let hit=shape==='box'?Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))<=radius:p.lengthSq()<=radius*radius;
                if(!hit&&selectionMode==='edge') {
                    const bound=n.bounds[i]*worldScale;
                    const nearby=shape==='box'?Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))<=radius+bound:p.lengthSq()<=(radius+bound)**2;
                    if(nearby) {
                        q.set(...n.rotations.map(r=>r[i])).normalize();
                        const axes=n.scales.map((values,axis)=>{
                            const v=new Vec3();v[['x','y','z'][axis]]=3*Math.exp(values[i]);
                            q.transformVector(v,v);transform.transformVector(v,v);inverse.transformVector(v,v);
                            return [v.x,v.y,v.z];
                        });
                        hit=overlapsEllipsoid([p.x,p.y,p.z],axes,radius,shape);
                    }
                }
                if(hit) hits.push(n.offset+i);
            }
        }
        return hits;
    }
    function drawSelector(center,radius,shape,active,orientation) {
        const color=active?new Color(0,1,.3):new Color(.2,.8,1);
        const p=v=>orientation.transformVector(new Vec3(...v).mulScalar(radius)).add(center);
        if(shape==='box') {
            for(let axis=0;axis<3;axis++) for(const a of [-1,1]) for(const b of [-1,1]) {
                const v=[0,0,0];v[(axis+1)%3]=a;v[(axis+2)%3]=b;v[axis]=-1;const w=v.slice();w[axis]=1;
                app.drawLine(p(v),p(w),color,false);
            }
        } else for(let axis=0;axis<3;axis++) for(let i=0;i<48;i++) {
            const point=t=>{const v=[0,0,0];v[(axis+1)%3]=Math.cos(t);v[(axis+2)%3]=Math.sin(t);return p(v);};
            app.drawLine(point(i*Math.PI/24),point((i+1)*Math.PI/24),color,false);
        }
    }
    const timer=setInterval(()=>{
        if(ready&&!fault&&!painting&&!polling&&!inFlight) {
            polling=true;send({op:'state'}).finally(()=>{polling=false;});
        }
    },500);
    window.addEventListener('pagehide',()=>{clearInterval(timer);fetch('/command',{method:'POST',headers:{'Content-Type':'application/json','X-VR-Token':token},body:JSON.stringify({op:'cancel'}),keepalive:true}).catch(()=>{});});
}
