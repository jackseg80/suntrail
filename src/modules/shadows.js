import { state } from './config.js';
import SunCalc from 'suncalc';
import shaderWgsl from '../shaders/shadow.wgsl?raw';

export async function initWebGPU() {
    try {
        if (!navigator.gpu) throw new Error('API navigator.gpu absente');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('requestAdapter() a retourné null');
        
        state.gpuDevice = await adapter.requestDevice();
        
        try {
            const info = await adapter.requestAdapterInfo();
            state.gpuName = info.device || info.description || info.vendor || 'GPU détecté';
        } catch (e) {
            state.gpuName = 'GPU (info non disponible)';
        }
        
        const testBuf = state.gpuDevice.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
        testBuf.destroy();
        
        state.gpuAvailable = true;
        document.getElementById('gpu-badge-slot').innerHTML = `<span class="gpu-badge webgpu">⚡ WebGPU</span>`;
        document.getElementById('shadow-desc').textContent = `GPU: ${state.gpuName}. Ray-casting + Self-shadowing natif.`;
        document.getElementById('srs').value = '1024';
    } catch (e) {
        state.gpuAvailable = false;
        const reason = e.message || 'Erreur inconnue';
        console.warn('WebGPU init failed:', reason);
        document.getElementById('gpu-badge-slot').innerHTML = `<span class="gpu-badge cpu">🖥️ CPU</span>`;
        document.getElementById('shadow-desc').innerHTML = `WebGPU indisponible: ${reason}<br><span style="font-size:0.65rem;color:var(--t3)">Activez WebGPU dans votre navigateur</span>`;
        document.getElementById('srs').value = '512';
        const opt2k = document.querySelector('#srs option[value="2048"]');
        if (opt2k) opt2k.disabled = true;
    }
}

async function gpuCastShadows(elevGrid, gridSize, sunAz, sunAlt, mpcY, maxSteps, gridWidthLon, gridNorthLat, gridSouthLat) {
    const totalPixels = gridSize * gridSize;
    const packedLength = totalPixels / 4; // Compression par 4 (4 valeurs d'ombre 8-bit dans 1 u32)
    
    const elevBuf = state.gpuDevice.createBuffer({ size: totalPixels * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    state.gpuDevice.queue.writeBuffer(elevBuf, 0, elevGrid);
    
    const shadowBuf = state.gpuDevice.createBuffer({ size: packedLength * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readBuf = state.gpuDevice.createBuffer({ size: packedLength * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    
    const paramsData = new ArrayBuffer(32);
    new Uint32Array(paramsData, 0, 1)[0] = gridSize;
    new Float32Array(paramsData, 4, 1)[0] = sunAz;
    new Float32Array(paramsData, 8, 1)[0] = sunAlt;
    new Float32Array(paramsData, 12, 1)[0] = mpcY;
    new Uint32Array(paramsData, 16, 1)[0] = maxSteps;
    new Float32Array(paramsData, 20, 1)[0] = gridWidthLon;
    new Float32Array(paramsData, 24, 1)[0] = gridNorthLat;
    new Float32Array(paramsData, 28, 1)[0] = gridSouthLat;
    
    const paramBuf = state.gpuDevice.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    state.gpuDevice.queue.writeBuffer(paramBuf, 0, paramsData);
    
    const module = state.gpuDevice.createShaderModule({ code: shaderWgsl });
    const pipeline = state.gpuDevice.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const bindGroup = state.gpuDevice.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: elevBuf } },
            { binding: 1, resource: { buffer: shadowBuf } },
            { binding: 2, resource: { buffer: paramBuf } }
        ]
    });
    
    const wgSize = 256;
    const numWG = Math.ceil(packedLength / wgSize);
    const encoder = state.gpuDevice.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(numWG);
    pass.end();
    encoder.copyBufferToBuffer(shadowBuf, 0, readBuf, 0, packedLength * 4);
    state.gpuDevice.queue.submit([encoder.finish()]);
    
    await readBuf.mapAsync(GPUMapMode.READ);
    // Grâce au format Little Endian, le ArrayBuffer compressé peut être lu directement
    // comme un tableau classique de pixels (1 octet par pixel) ! Zéro traitement CPU.
    const intensity = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    elevBuf.destroy(); shadowBuf.destroy(); readBuf.destroy(); paramBuf.destroy();
    
    return intensity;
}

function createCpuWorker() {
    const code = `self.onmessage=function(e){
    const{elevGrid,gridSize,sunAzDeg,sunAltDeg,mpcY,maxSteps,gridWidthLon,gridNorthLat,gridSouthLat}=e.data;
    const gs=gridSize;
    const intensity=new Uint8Array(gs*gs);
    const PI=Math.PI,sunAzRad=sunAzDeg*PI/180,sunAltRad=sunAltDeg*PI/180;
    const sunRadius=0.00465,effectiveR=7433000;
    const sunTop=sunAltRad+sunRadius,sunBot=sunAltRad-sunRadius,sunDiam=sunTop-sunBot;
    const cosAltD=Math.cos(sunAltRad),sinAltD=Math.sin(sunAltRad);
    const sdx=Math.sin(sunAzRad)*cosAltD,sdy=-Math.cos(sunAzRad)*cosAltD,sdz=sinAltD;
    const radii=[4,8,14];
    
    function samp(fx,fy){
        const x0=Math.max(0,Math.floor(fx)),y0=Math.max(0,Math.floor(fy));
        const x1=Math.min(x0+1,gs-1),y1=Math.min(y0+1,gs-1);
        const e00=elevGrid[y0*gs+x0],e10=elevGrid[y0*gs+x1];
        const e01=elevGrid[y1*gs+x0],e11=elevGrid[y1*gs+x1];
        if(e00<-9000||e10<-9000||e01<-9000||e11<-9000)return elevGrid[Math.round(fy)*gs+Math.round(fx)];
        const wx=fx-Math.floor(fx),wy=fy-Math.floor(fy);
        return e00*(1-wx)*(1-wy)+e10*wx*(1-wy)+e01*(1-wx)*wy+e11*wx*wy;
    }
    
    for(let y=0;y<gs;y++){
        const latDeg=gridNorthLat-(y/gs)*(gridNorthLat-gridSouthLat);
        const mpcX=(gridWidthLon*111320*Math.cos(latDeg*PI/180))/gs;
        const rawDx=Math.sin(sunAzRad)/mpcX,rawDy=-Math.cos(sunAzRad)/mpcY;
        const mc=Math.max(Math.abs(rawDx),Math.abs(rawDy));
        const dx=rawDx/mc,dy=rawDy/mc;
        const stepDist=Math.sqrt((dx*mpcX)**2+(dy*mpcY)**2);
        
        for(let x=0;x<gs;x++){
            const idx=y*gs+x,base=elevGrid[idx];
            if(base<-9000){intensity[idx]=0;continue;}
            
            let maxAngle=-1.5708;
            for(let s=1;s<=maxSteps;s++){
                const fx=x+dx*s,fy=y+dy*s;
                if(fx<0||fx>=gs-1||fy<0||fy>=gs-1)break;
                const se=samp(fx,fy);if(se<-9000)continue;
                const d=s*stepDist,curv=d*d/(2*effectiveR);
                const angle=Math.atan2(se-curv-base,d);
                if(angle>maxAngle)maxAngle=angle;
                if(maxAngle>sunTop+0.02)break;
            }
            
            let val=0;
            if(maxAngle>=sunTop)val=1.0;
            else if(maxAngle>sunBot)val=(maxAngle-sunBot)/sunDiam;
            
            let bestSelf=0;
            for(const r of radii){
                if(x<r||x>=gs-r||y<r||y>=gs-r)continue;
                const eL=elevGrid[y*gs+(x-r)],eR=elevGrid[y*gs+(x+r)];
                const eU=elevGrid[(y-r)*gs+x],eD=elevGrid[(y+r)*gs+x];
                if(eL<-9000||eR<-9000||eU<-9000||eD<-9000)continue;
                const dzdx=(eR-eL)/(r*2*mpcX),dzdy=(eD-eU)/(r*2*mpcY);
                const slopeMag=Math.sqrt(dzdx*dzdx+dzdy*dzdy);
                if(slopeMag<0.12)continue;
                const nx=-dzdx,ny=-dzdy,nz=1;
                const nLen=Math.sqrt(nx*nx+ny*ny+nz*nz);
                const cosA=(nx*sdx+ny*sdy+nz*sdz)/nLen;
                let sh=0;
                if(cosA<=0)sh=1.0;
                else if(cosA>=0.35)sh=0;
                else if(cosA<=0.15)sh=1.0;
                else sh=(0.35-cosA)/0.20;
                if(sh>bestSelf)bestSelf=sh;
                if(bestSelf>=1.0)break;
            }
            
            intensity[idx]=Math.round(Math.max(val,bestSelf)*255);
        }
    }
    self.postMessage({intensity},[intensity.buffer]);};`;
    return new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
}

function cpuCast(gs, sunAz, sunAlt, mpcY, maxSteps, gridWidthLon, gridNorthLat, gridSouthLat) {
    return new Promise(resolve => {
        if (!state.cpuWorker) state.cpuWorker = createCpuWorker();
        state.cpuWorker.onmessage = e => { resolve(e.data.intensity); };
        const copy = new Float32Array(state.cachedGrid);
        state.cpuWorker.postMessage({ elevGrid: copy, gridSize: gs, sunAzDeg: sunAz, sunAltDeg: sunAlt, mpcY, maxSteps, gridWidthLon, gridNorthLat, gridSouthLat }, [copy.buffer]);
    });
}

function smoothElevGrid(grid, gs, passes) {
    let src = new Float32Array(grid);
    let dst = new Float32Array(gs * gs);
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const idx = y * gs + x;
                const c = src[idx];
                if (c < -9000) { dst[idx] = c; continue; }
                let sum = c, cnt = 1;
                if (x > 0 && src[idx - 1] > -9000) { sum += src[idx - 1]; cnt++; }
                if (x < gs - 1 && src[idx + 1] > -9000) { sum += src[idx + 1]; cnt++; }
                dst[idx] = sum / cnt;
            }
        }
        let tmp = src; src = dst; dst = tmp;
        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const idx = y * gs + x;
                const c = src[idx];
                if (c < -9000) { dst[idx] = c; continue; }
                let sum = c, cnt = 1;
                if (y > 0 && src[idx - gs] > -9000) { sum += src[idx - gs]; cnt++; }
                if (y < gs - 1 && src[idx + gs] > -9000) { sum += src[idx + gs]; cnt++; }
                dst[idx] = sum / cnt;
            }
        }
        tmp = src; src = dst; dst = tmp;
    }
    return src;
}

export async function recompute() {
    if (!state.cachedGrid || state.shadowPending || !state.map) return;
    state.shadowPending = true;
    clearDebugLayer();
    const st = document.getElementById('sst'); st.className = 'ss cp';
    const c = state.map.getCenter();
    const sp = SunCalc.getPosition(state.curDate, c.lat, c.lng);
    const sunAz = ((sp.azimuth * 180 / Math.PI) + 180) % 360;
    const sunAlt = sp.altitude * 180 / Math.PI;
    
    const b = state.cachedBounds;
    const gs = state.cachedGS;
    
    // Nouveaux paramètres pour calcul dynamique selon la latitude (correction Web Mercator)
    const gridWidthLon = b.east - b.west;
    const gridNorthLat = b.north;
    const gridSouthLat = b.south;
    const mpcY = ((b.north - b.south) * 111320) / gs;
    
    // Détermination conservatrice du maxSteps global
    const midMpcX = (gridWidthLon * 111320 * Math.cos(c.lat * Math.PI / 180)) / gs;
    const rawDx = Math.sin(sunAz * Math.PI / 180) / midMpcX;
    const rawDy = -Math.cos(sunAz * Math.PI / 180) / mpcY;
    const maxComp = Math.max(Math.abs(rawDx), Math.abs(rawDy));
    const stepDist = Math.sqrt(((rawDx / maxComp) * midMpcX) ** 2 + ((rawDy / maxComp) * mpcY) ** 2);
    const maxSteps = Math.min(Math.ceil(50000 / stepDist), gs * 2);

    const t0 = performance.now();
    let intensity;
    
    if (state.gpuAvailable) {
        st.textContent = `⚡ GPU ray-casting (${gs}px)...`;
        try { intensity = await gpuCastShadows(state.cachedGrid, gs, sunAz, sunAlt, mpcY, maxSteps, gridWidthLon, gridNorthLat, gridSouthLat); }
        catch (e) { console.error('GPU error, falling back to CPU:', e); intensity = await cpuCast(gs, sunAz, sunAlt, mpcY, maxSteps, gridWidthLon, gridNorthLat, gridSouthLat); }
    } else {
        st.textContent = `🖥️ CPU ray-casting (${gs}px)...`;
        intensity = await cpuCast(gs, sunAz, sunAlt, mpcY, maxSteps, gridWidthLon, gridNorthLat, gridSouthLat);
    }

    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    
    // Le Post-processing est maintenant fait nativement par le Shader !
    
    renderShadow(intensity, gs, b.west, b.south, b.east, b.north);
    st.className = 'ss dn';
    let shFull = 0, shPartial = 0;
    for (let i = 0; i < intensity.length; i++) { if (intensity[i] === 255) shFull++; else if (intensity[i] > 0) shPartial++; }
    const shPct = ((shFull + shPartial) * 100 / intensity.length).toFixed(1);
    
    st.innerHTML = `✅ ${gs}px en ${dt}s ${state.gpuAvailable ? '(GPU⚡)' : '(CPU🖥️)'} — ${shPct}% ombre<br>`;
    document.getElementById('bdbg').style.display = 'block';
    state.shadowPending = false;
}

export async function loadAndCompute() {
    const btn = document.getElementById('bsh'), st = document.getElementById('sst');
    if (state.map.isMoving()) { st.className = 'ss er'; st.textContent = '⏳ Attendez la fin du déplacement...'; return; }
    btn.disabled = true; st.className = 'ss cp';
    const c = state.map.getCenter();
    const sp = SunCalc.getPosition(state.curDate, c.lat, c.lng);
    const sunAlt = sp.altitude * 180 / Math.PI;
    
    if (sunAlt < 0) { st.className = 'ss er'; st.textContent = '🌙 Soleil sous l\'horizon.'; btn.disabled = false; return; }
    
    let res = parseInt(document.getElementById('srs').value);
    
    if (!state.cachedGrid) {
        st.textContent = '⏳ Chargement tuiles d\'élévation...';
        try {
            const b = state.map.getBounds();
            const vWest = b.getWest(), vEast = b.getEast(), vNorth = b.getNorth(), vSouth = b.getSouth();
            const mg = 0.20;
            const west = vWest - mg, east = vEast + mg, north = vNorth + mg, south = vSouth - mg;
            let zoom = 12;
            const spanKm = ((east - west) * 111320 * Math.cos(c.lat * Math.PI / 180)) / 1000;
            if (spanKm > 40) zoom = 11;
            
            let tiles = getTiles(west, south, east, north, zoom);
            if (tiles.length > 300 && zoom > 11) { zoom = 11; tiles = getTiles(west, south, east, north, zoom); }
            if (tiles.length > 500) throw new Error(`Trop de tuiles (${tiles.length})`);
            
            st.textContent = `⏳ ${tiles.length} tuiles (z${zoom})...`;
            const grid = await fetchElevCanvas(tiles, zoom, west, south, east, north, res);
            if (!grid) throw new Error('Pas de données');
            
            let eMin = Infinity, eMax = -Infinity;
            for (let i = 0; i < grid.length; i++) { if (grid[i] > -9000) { if (grid[i] < eMin) eMin = grid[i]; if (grid[i] > eMax) eMax = grid[i]; } }
            
            state.cachedElevRange = [Math.round(eMin), Math.round(eMax)];
            state.cachedGrid = smoothElevGrid(grid, res, 3);
            state.cachedBounds = { west, south, east, north };
            state.cachedViewport = { west: vWest, south: vSouth, east: vEast, north: vNorth };
            state.cachedGS = res;
        } catch (e) {
            st.className = 'ss er'; st.textContent = `❌ ${e.message}`; btn.disabled = false; return;
        }
    }
    await recompute();
    document.getElementById('asr').style.display = 'flex';
    document.getElementById('sor').style.display = 'flex';
    document.getElementById('bsc').style.display = 'block';
    btn.textContent = '🔄 Recharger le relief';
    btn.disabled = false;
}

function getTiles(w, s, e, n, z) {
    const lng2t = (l, z) => Math.floor((l + 180) / 360 * (1 << z));
    const lat2t = (l, z) => Math.floor((1 - Math.log(Math.tan(l * Math.PI / 180) + 1 / Math.cos(l * Math.PI / 180)) / Math.PI) / 2 * (1 << z));
    const mx = lng2t(w, z), Mx = lng2t(e, z), my = lat2t(n, z), My = lat2t(s, z), t = [];
    for (let x = mx; x <= Mx; x++) for (let y = my; y <= My; y++) t.push({ x, y, z });
    return t;
}

async function fetchElevCanvas(tiles, zoom, west, south, east, north, gs) {
    const ts = 256, tc = document.createElement('canvas'); tc.width = ts; tc.height = ts;
    const ctx = tc.getContext('2d', { willReadFrequently: true });
    const td = new Map();
    
    for (let i = 0; i < tiles.length; i += 12) {
        const batch = tiles.slice(i, i + 12);
        const res = await Promise.allSettled(batch.map(async t => {
            const r = await fetch(`https://api.maptiler.com/tiles/terrain-rgb-v2/${t.z}/${t.x}/${t.y}.png?key=${state.MK}`);
            if (!r.ok) return null;
            const blob = await r.blob();
            const img = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
            return { tile: t, img };
        }));
        res.forEach(r => {
            if (r.status === 'fulfilled' && r.value) {
                const { tile, img } = r.value;
                ctx.clearRect(0, 0, ts, ts); ctx.drawImage(img, 0, 0);
                td.set(`${tile.x}_${tile.y}`, new Uint8Array(ctx.getImageData(0, 0, ts, ts).data));
            }
        });
    }
    if (!td.size) return null;
    
    const nt = 1 << zoom;
    function readElev(tx, ty, px, py) {
        const d = td.get(`${tx}_${ty}`);
        if (!d) return NaN;
        const cpx = Math.max(0, Math.min(ts - 1, px)), cpy = Math.max(0, Math.min(ts - 1, py));
        const off = (cpy * ts + cpx) * 4;
        return -10000 + ((d[off] * 65536 + d[off + 1] * 256 + d[off + 2]) * 0.1);
    }
    
    const grid = new Float32Array(gs * gs);
    const lonS = (east - west) / gs, latS = (north - south) / gs;
    
    for (let gy = 0; gy < gs; gy++) {
        const lat = north - gy * latS;
        const lr = lat * Math.PI / 180;
        const tyf = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * nt;
        for (let gx = 0; gx < gs; gx++) {
            const lon = west + gx * lonS;
            const txf = (lon + 180) / 360 * nt;
            const tx = Math.floor(txf), ty = Math.floor(tyf);
            const pxf = (txf - tx) * ts, pyf = (tyf - ty) * ts;
            const px0 = Math.floor(pxf), py0 = Math.floor(pyf);
            const h = readElev(tx, ty, px0, py0);
            grid[gy * gs + gx] = isNaN(h) ? -9999.0 : h;
        }
    }
    return grid;
}

function renderShadow(intensity, gs, west, south, east, north) {
    clearShadowLayer();
    const vp = state.cachedViewport || { west, south, east, north };
    const gridW = east - west, gridH = north - south;
    const vpx0 = Math.max(0, Math.round((vp.west - west) / gridW * gs));
    const vpx1 = Math.min(gs, Math.round((vp.east - west) / gridW * gs));
    const vpy0 = Math.max(0, Math.round((north - vp.north) / gridH * gs));
    const vpy1 = Math.min(gs, Math.round((north - vp.south) / gridH * gs));
    const vpW = vpx1 - vpx0, vpH = vpy1 - vpy0;
    if (vpW <= 0 || vpH <= 0) return;

    const cv = document.createElement('canvas'); cv.width = vpW; cv.height = vpH;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(vpW, vpH);
    const edgeFade = Math.round(Math.min(vpW, vpH) * 0.04);
    
    for (let vy = 0; vy < vpH; vy++) {
        const gy = vpy0 + vy;
        for (let vx = 0; vx < vpW; vx++) {
            const gx = vpx0 + vx;
            const val = intensity[gy * gs + gx];
            if (val > 0) {
                const p = (vy * vpW + vx) * 4;
                let alpha = val;
                const edgeDist = Math.min(vx, vy, vpW - 1 - vx, vpH - 1 - vy);
                if (edgeDist < edgeFade) alpha = (alpha * edgeDist / edgeFade) | 0;
                img.data[p] = 8; img.data[p + 1] = 8; img.data[p + 2] = 35; img.data[p + 3] = alpha;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    const cv2 = document.createElement('canvas'); cv2.width = vpW; cv2.height = vpH;
    const ctx2 = cv2.getContext('2d');
    ctx2.filter = 'blur(1.5px)'; ctx2.drawImage(cv, 0, 0);
    
    state.map.addSource('sh-src', { type: 'image', url: cv2.toDataURL(), coordinates: [[vp.west, vp.north], [vp.east, vp.north], [vp.east, vp.south], [vp.west, vp.south]] });
    const op = parseFloat(document.getElementById('sop').value);
    const before = state.map.getLayer('sun-path') ? 'sun-path' : undefined;
    state.map.addLayer({ id: 'sh-ov', type: 'raster', source: 'sh-src', paint: { 'raster-opacity': op, 'raster-fade-duration': 0 } }, before);
}

export function clearShadows() {
    clearShadowLayer();
    clearDebugLayer();
    state.cachedGrid = null; state.cachedBounds = null; state.cachedViewport = null; state.cachedElevRange = null;
    if (state.cpuWorker) { state.cpuWorker.terminate(); state.cpuWorker = null; }
    document.getElementById('bsc').style.display = 'none'; document.getElementById('bdbg').style.display = 'none';
    document.getElementById('asr').style.display = 'none'; document.getElementById('sor').style.display = 'none';
    document.getElementById('sst').textContent = ''; document.getElementById('sst').className = 'ss';
    document.getElementById('bsh').textContent = '☀️ Charger le relief & calculer';
}

function clearShadowLayer() { if (state.map.getLayer('sh-ov')) state.map.removeLayer('sh-ov'); if (state.map.getSource('sh-src')) state.map.removeSource('sh-src'); }
export function clearDebugLayer() { if (state.map.getLayer('elev-dbg')) state.map.removeLayer('elev-dbg'); if (state.map.getSource('elev-dbg-src')) state.map.removeSource('elev-dbg-src'); }

export function showElevDebug() {
    try {
        if (!state.cachedGrid || !state.cachedBounds) return;
        clearDebugLayer(); clearShadowLayer();
        const gs = state.cachedGS, b = state.cachedBounds;
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < state.cachedGrid.length; i++) { const v = state.cachedGrid[i]; if (v > -9000) { if (v < mn) mn = v; if (v > mx) mx = v; } }
        const range = mx - mn || 1;
        const cv = document.createElement('canvas'); cv.width = gs; cv.height = gs;
        const ctx = cv.getContext('2d'); const img = ctx.createImageData(gs, gs);
        for (let i = 0; i < gs * gs; i++) {
            const v = state.cachedGrid[i], p = i * 4;
            if (v < -9000) { img.data[p] = 255; img.data[p + 1] = 0; img.data[p + 2] = 255; img.data[p + 3] = 200; continue; }
            const t = Math.max(0, Math.min(1, (v - mn) / range));
            let r, g, bl;
            if (t < 0.25) { const s = t / 0.25; r = 0; g = Math.round(100 * s); bl = Math.round(200 * (1 - s)); }
            else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = Math.round(180 * s); g = Math.round(100 + 80 * s); bl = 0; }
            else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = Math.round(180 + 60 * s); g = Math.round(180 - 80 * s); bl = 0; }
            else { const s = (t - 0.75) / 0.25; r = Math.round(240 + 15 * s); g = Math.round(100 + 155 * s); bl = Math.round(255 * s); }
            img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = bl; img.data[p + 3] = 200;
        }
        ctx.putImageData(img, 0, 0);
        state.map.addSource('elev-dbg-src', { type: 'image', url: cv.toDataURL(), coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]] });
        state.map.addLayer({ id: 'elev-dbg', type: 'raster', source: 'elev-dbg-src', paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } });
        document.getElementById('sst').innerHTML = `<span style="color:var(--t3)">🔍 Élévation: ${mn.toFixed(0)}-${mx.toFixed(0)}m</span>`;
    } catch (e) { document.getElementById('sst').textContent = '❌ Debug error'; }
}
