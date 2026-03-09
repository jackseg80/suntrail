import { state } from './config.js';
import SunCalc from 'suncalc';
import shaderWgsl from '../shaders/shadow.wgsl?raw';

// --- Utilitaires de projection Web Mercator ---
function lat2mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
function mercY2lat(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

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

async function gpuCastShadows(elevGrid, gridSize, sunAz, sunAlt, maxSteps, baseMpcX, baseMpcY, gridNorthMercY, gridSouthMercY) {
    const totalPixels = gridSize * gridSize;
    const packedLength = totalPixels / 4; 
    
    const elevBuf = state.gpuDevice.createBuffer({ size: totalPixels * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    state.gpuDevice.queue.writeBuffer(elevBuf, 0, elevGrid);
    
    const shadowBuf = state.gpuDevice.createBuffer({ size: packedLength * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readBuf = state.gpuDevice.createBuffer({ size: packedLength * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    
    const paramsData = new ArrayBuffer(32);
    new Uint32Array(paramsData, 0, 1)[0] = gridSize;
    new Float32Array(paramsData, 4, 1)[0] = sunAz;
    new Float32Array(paramsData, 8, 1)[0] = sunAlt;
    new Uint32Array(paramsData, 12, 1)[0] = maxSteps;
    new Float32Array(paramsData, 16, 1)[0] = baseMpcX;
    new Float32Array(paramsData, 20, 1)[0] = baseMpcY;
    new Float32Array(paramsData, 24, 1)[0] = gridNorthMercY;
    new Float32Array(paramsData, 28, 1)[0] = gridSouthMercY;
    
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
    const intensity = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    elevBuf.destroy(); shadowBuf.destroy(); readBuf.destroy(); paramBuf.destroy();
    
    return intensity;
}

function createCpuWorker() {
    const code = `self.onmessage=function(e){
    const{elevGrid,gridSize,sunAzDeg,sunAltDeg,maxSteps,baseMpcX,baseMpcY,gridNorthMercY,gridSouthMercY}=e.data;
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
        const mercY = gridNorthMercY - (y/gs)*(gridNorthMercY - gridSouthMercY);
        const latRad = 2.0*Math.atan(Math.exp(mercY)) - Math.PI/2;
        const cosLat = Math.cos(latRad);
        const mpcX = baseMpcX * cosLat;
        const mpcY = baseMpcY * cosLat;
        
        const rawDx=Math.sin(sunAzRad)/mpcX,rawDy=-Math.cos(sunAzRad)/mpcY;
        const mc=Math.max(Math.abs(rawDx),Math.abs(rawDy));
        const dx=rawDx/mc,dy=rawDy/mc;
        const stepDist=Math.sqrt(dx*dx*mpcX*mpcX + dy*dy*mpcY*mpcY);
        
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
                if(slopeMag<0.02)continue;
                const nx=-dzdx,ny=-dzdy,nz=1;
                const nLen=Math.sqrt(nx*nx+ny*ny+nz*nz);
                const cosA=(nx*sdx+ny*sdy+nz*sdz)/nLen;
                let sh=Math.max(0, Math.min(1, 0.5 - (cosA / 0.05)));
                if(sh>bestSelf)bestSelf=sh;
                if(bestSelf>=1.0)break;
            }
            
            intensity[idx]=Math.round(Math.max(val,bestSelf)*255);
        }
    }
    self.postMessage({intensity},[intensity.buffer]);};`;
    return new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
}

function cpuCast(gs, sunAz, sunAlt, maxSteps, baseMpcX, baseMpcY, gridNorthMercY, gridSouthMercY) {
    return new Promise(resolve => {
        if (!state.cpuWorker) state.cpuWorker = createCpuWorker();
        state.cpuWorker.onmessage = e => { resolve(e.data.intensity); };
        const copy = new Float32Array(state.cachedGrid);
        state.cpuWorker.postMessage({ elevGrid: copy, gridSize: gs, sunAzDeg: sunAz, sunAltDeg: sunAlt, maxSteps, baseMpcX, baseMpcY, gridNorthMercY, gridSouthMercY }, [copy.buffer]);
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
    
    const st = document.getElementById('sst'); st.className = 'ss cp';
    const c = state.map.getCenter();
    const sp = SunCalc.getPosition(state.curDate, c.lat, c.lng);
    const sunAz = ((sp.azimuth * 180 / Math.PI) + 180) % 360;
    const sunAlt = sp.altitude * 180 / Math.PI;
    
    const b = state.cachedBounds;
    const gs = state.cachedGS;
    
    // --- Correction Exacte de l'Échelle Mercator ---
    const R_earth = 6371000;
    const spanX = (b.east - b.west) * Math.PI / 180;
    const spanY = lat2mercY(b.north) - lat2mercY(b.south);
    
    // Taille physique d'un pixel projeté à l'équateur
    const baseMpcX = spanX * R_earth / gs;
    const baseMpcY = spanY * R_earth / gs;
    const gridNorthMercY = lat2mercY(b.north);
    const gridSouthMercY = lat2mercY(b.south);
    
    // Détermination conservatrice du maxSteps global
    const midCosLat = Math.cos(c.lat * Math.PI / 180);
    const midMpcX = baseMpcX * midCosLat;
    const midMpcY = baseMpcY * midCosLat;
    const rawDx = Math.sin(sunAz * Math.PI / 180) / midMpcX;
    const rawDy = -Math.cos(sunAz * Math.PI / 180) / midMpcY;
    const maxComp = Math.max(Math.abs(rawDx), Math.abs(rawDy));
    const stepDist = Math.sqrt(((rawDx / maxComp) * midMpcX) ** 2 + ((rawDy / maxComp) * midMpcY) ** 2);
    const maxSteps = Math.min(Math.ceil(70000 / stepDist), gs * 2); // 70km max shadow length

    const t0 = performance.now();
    let intensity;
    
    if (state.gpuAvailable) {
        st.textContent = `⚡ GPU ray-casting (${gs}px)...`;
        try { intensity = await gpuCastShadows(state.cachedGrid, gs, sunAz, sunAlt, maxSteps, baseMpcX, baseMpcY, gridNorthMercY, gridSouthMercY); }
        catch (e) { console.error('GPU error, falling back to CPU:', e); intensity = await cpuCast(gs, sunAz, sunAlt, maxSteps, baseMpcX, baseMpcY, gridNorthMercY, gridSouthMercY); }
    } else {
        st.textContent = `🖥️ CPU ray-casting (${gs}px)...`;
        intensity = await cpuCast(gs, sunAz, sunAlt, maxSteps, baseMpcX, baseMpcY, gridNorthMercY, gridSouthMercY);
    }

    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    
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
            const mg = 0.35; // Énorme marge de 35-40km pour attraper les montagnes éloignées
            const west = vWest - mg, east = vEast + mg, north = vNorth + mg, south = vSouth - mg;
            let zoom = 12;
            const spanKm = ((east - west) * 111320 * Math.cos(c.lat * Math.PI / 180)) / 1000;
            if (spanKm > 80) zoom = 10;
            else if (spanKm > 40) zoom = 11;
            
            let tiles = getTiles(west, south, east, north, zoom);
            if (tiles.length > 250 && zoom > 10) { zoom--; tiles = getTiles(west, south, east, north, zoom); }
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
//... (je garde cette partie intacte)
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
    
    // Remplissage de la grille en espace Web Mercator uniforme
    const yN = lat2mercY(north), yS = lat2mercY(south);
    const lonS = (east - west) / gs;
    
    for (let gy = 0; gy < gs; gy++) {
        const mercY = yN - (gy / gs) * (yN - yS);
        const lat = mercY2lat(mercY);
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

let shadowLayerCount = 0;

function renderShadow(intensity, gs, west, south, east, north) {
    const vp = state.cachedViewport || { west, south, east, north };
    const gridW = east - west;
    
    // Découpage parfait dans l'espace Web Mercator pour éviter les décalages (slippage)
    const yN = lat2mercY(north), yS = lat2mercY(south);
    const vpYN = lat2mercY(vp.north), vpYS = lat2mercY(vp.south);
    
    const vpx0 = Math.max(0, Math.round((vp.west - west) / gridW * gs));
    const vpx1 = Math.min(gs, Math.round((vp.east - west) / gridW * gs));
    const vpy0 = Math.max(0, Math.round((yN - vpYN) / (yN - yS) * gs));
    const vpy1 = Math.min(gs, Math.round((yN - vpYS) / (yN - yS) * gs));
    
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
    
    // Calcul des coordonnées d'ancrage EXACTES du calque découpé
    const actualVpWest = west + (vpx0 / gs) * gridW;
    const actualVpEast = west + (vpx1 / gs) * gridW;
    const actualVpNorth = mercY2lat(yN - (vpy0 / gs) * (yN - yS));
    const actualVpSouth = mercY2lat(yN - (vpy1 / gs) * (yN - yS));
    
    const newId = `sh-ov-${shadowLayerCount++}`;
    const newSrcId = `sh-src-${newId}`;
    
    state.map.addSource(newSrcId, { type: 'image', url: cv2.toDataURL(), coordinates: [[actualVpWest, actualVpNorth], [actualVpEast, actualVpNorth], [actualVpEast, actualVpSouth], [actualVpWest, actualVpSouth]] });
    const op = parseFloat(document.getElementById('sop').value);
    const before = state.map.getLayer('sun-path') ? 'sun-path' : undefined;
    
    // On ajoute la nouvelle ombre
    state.map.addLayer({ id: newId, type: 'raster', source: newSrcId, paint: { 'raster-opacity': op, 'raster-fade-duration': 300 } }, before);
    
    // On supprime les anciennes ombres de manière propre après un petit délai pour la transition
    setTimeout(() => {
        const layers = state.map.getStyle().layers;
        layers.forEach(layer => {
            if (layer.id.startsWith('sh-ov-') && layer.id !== newId) {
                state.map.removeLayer(layer.id);
                state.map.removeSource(`sh-src-${layer.id}`);
            }
        });
    }, 350);
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
