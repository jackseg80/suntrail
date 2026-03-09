import { state } from './config.js';
import { updateSun, setHS } from './sun.js';
import { clearShadows, loadAndCompute, showElevDebug, clearDebugLayer } from './shadows.js';
import { loadTrails, findDEM, initMap } from './map.js';
import { throttle, fmtISO, dest } from './utils.js';
import SunCalc from 'suncalc';

export function initUI() {
    // Écran de configuration (Setup)
    const s1 = localStorage.getItem('maptiler_key'), s2 = localStorage.getItem('owm_key');
    if (s1) document.getElementById('k1').value = s1;
    if (s2) document.getElementById('k2').value = s2;
    
    document.getElementById('bgo').addEventListener('click', go);
    document.getElementById('k1').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    
    // Contrôles du panneau
    const dp = document.getElementById('dp'), ts = document.getElementById('tsl');
    dp.value = fmtISO(state.curDate);
    ts.value = state.curDate.getHours() * 60 + state.curDate.getMinutes();
    
    dp.addEventListener('input', () => {
        const p = dp.value.split('-');
        state.curDate.setFullYear(+p[0], +p[1] - 1, +p[2]);
        state.pathCK = ''; state.compCK = '';
        updateSun();
    });
    
    const tSl = throttle(() => {
        const m = parseInt(ts.value);
        state.curDate.setHours(Math.floor(m / 60), m % 60, 0, 0);
        updateSun();
    }, 33);
    ts.addEventListener('input', tSl);
    ts.addEventListener('change', autoShadow);
    
    document.getElementById('bnow').addEventListener('click', () => {
        state.curDate = new Date();
        dp.value = fmtISO(state.curDate);
        ts.value = state.curDate.getHours() * 60 + state.curDate.getMinutes();
        state.pathCK = ''; state.compCK = '';
        updateSun(); autoShadow();
    });
    
    const jmp = d => {
        if (!d) return;
        state.curDate.setHours(d.getHours(), d.getMinutes(), 0, 0);
        ts.value = d.getHours() * 60 + d.getMinutes();
        updateSun(); autoShadow();
    };
    
    document.getElementById('bsr').addEventListener('click', () => jmp(state.sunTimes.sunrise));
    document.getElementById('bno').addEventListener('click', () => jmp(state.sunTimes.solarNoon));
    document.getElementById('bgh').addEventListener('click', () => jmp(state.sunTimes.goldenHour));
    document.getElementById('bss').addEventListener('click', () => jmp(state.sunTimes.sunset));
    
    document.getElementById('tex').addEventListener('input', e => {
        if(state.map) state.map.setTerrain({ source: findDEM() || 't-dem', exaggeration: parseFloat(e.target.value) });
    });
    document.getElementById('thi').addEventListener('input', () => setHS());
    
    document.getElementById('bsh').addEventListener('click', loadAndCompute);
    document.getElementById('bsc').addEventListener('click', clearShadows);
    document.getElementById('bdbg').addEventListener('click', showElevDebug);
    
    document.getElementById('sop').addEventListener('input', () => {
        if (state.map && state.map.getLayer('sh-ov')) {
            state.map.setPaintProperty('sh-ov', 'raster-opacity', parseFloat(document.getElementById('sop').value));
        }
    });
    
    document.getElementById('btl').addEventListener('click', loadTrails);
    document.getElementById('ttg').addEventListener('change', e => {
        ['hiking-trails', 'hiking-trails-glow'].forEach(l => {
            if (state.map && state.map.getLayer(l)) state.map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none');
        });
    });

    initGeocoding();
}

function go() {
    state.MK = document.getElementById('k1').value.trim();
    state.WK = document.getElementById('k2').value.trim();
    if (!state.MK || state.MK.length < 5) {
        const e = document.getElementById('serr');
        e.textContent = 'Clé MapTiler invalide.';
        e.style.display = 'block';
        return;
    }
    localStorage.setItem('maptiler_key', state.MK);
    if (state.WK) localStorage.setItem('owm_key', state.WK);
    document.getElementById('setup-screen').style.display = 'none';
    initMap();
}

function initGeocoding() {
    const geoInput = document.getElementById('geo-input');
    const geoResults = document.getElementById('geo-results');
    let geoTimer = null;
    
    geoInput.addEventListener('input', () => {
        clearTimeout(geoTimer);
        const q = geoInput.value.trim();
        if (q.length < 2) { geoResults.style.display = 'none'; return; }
        
        geoTimer = setTimeout(async () => {
            try {
                const c = state.map ? state.map.getCenter() : {lng: 0, lat: 0};
                const r = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${state.MK}&language=fr&proximity=${c.lng},${c.lat}&limit=6`);
                if (!r.ok) return;
                const data = await r.json();
                if (!data.features || !data.features.length) { geoResults.style.display = 'none'; return; }
                
                geoResults.innerHTML = '';
                data.features.forEach(f => {
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:0.6rem 0.75rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.8rem;transition:background 0.15s;';
                    const name = f.text || f.place_name || '';
                    const ctx = f.place_name ? f.place_name.replace(name + ', ', '') : '';
                    item.innerHTML = `<div style="color:var(--t1);font-weight:500">${name}</div>${ctx ? `<div style="color:var(--t3);font-size:0.7rem;margin-top:0.15rem">${ctx}</div>` : ''}`;
                    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.06)');
                    item.addEventListener('mouseleave', () => item.style.background = 'none');
                    item.addEventListener('click', () => {
                        const [lng, lat] = f.center || f.geometry?.coordinates || [];
                        if (lng && lat && state.map) {
                            state.cachedGrid = null; state.cachedBounds = null; state.cachedViewport = null; state.cachedElevRange = null;
                            clearShadows(); clearDebugLayer();
                            state.map.flyTo({ center: [lng, lat], zoom: Math.max(state.map.getZoom(), 12), duration: 2000 });
                            geoInput.value = name;
                            geoResults.style.display = 'none';
                        }
                    });
                    geoResults.appendChild(item);
                });
                geoResults.style.display = 'block';
            } catch (e) { console.warn('Geocoding error:', e); }
        }, 300);
    });
    
    geoInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') { geoResults.style.display = 'none'; geoInput.blur(); }
        if (e.key === 'Enter') {
            const first = geoResults.querySelector('div');
            if (first) first.click();
        }
    });
    
    document.addEventListener('click', e => {
        if (!geoInput.contains(e.target) && !geoResults.contains(e.target)) geoResults.style.display = 'none';
    });
}

function autoShadow() {
    if (!state.cachedGrid || !document.getElementById('ash').checked) return;
    if(!state.map) return;
    const c = state.map.getCenter();
    const sp = SunCalc.getPosition(state.curDate, c.lat, c.lng);
    if (sp.altitude * 180 / Math.PI < 0) {
        clearShadows();
        document.getElementById('sst').textContent = '🌙 Nuit';
        return;
    }
    import('./shadows.js').then(module => module.recompute());
}

export function updateOverlay() {
    if (!state.map || !state.map.getSource('sun-dir')) return;
    const c = state.map.getCenter(), lat = c.lat, lng = c.lng;
    const sp = SunCalc.getPosition(state.curDate, lat, lng);
    const az = ((sp.azimuth * 180 / Math.PI) + 180) % 360;
    const alt = sp.altitude * 180 / Math.PI;
    const R = state.SUN_R, f = [];

    if (alt > -6) {
        const e = dest(lat, lng, az, R);
        f.push({ type: 'Feature', properties: { t: 'cur' }, geometry: { type: 'LineString', coordinates: [[lng, lat], e] } });
        f.push({ type: 'Feature', properties: { t: 'sun' }, geometry: { type: 'Point', coordinates: e } });
    }

    if (state.sunTimes.sunrise && state.sunTimes.sunset) {
        const sra = ((SunCalc.getPosition(state.sunTimes.sunrise, lat, lng).azimuth * 180 / Math.PI) + 180) % 360;
        const ssa = ((SunCalc.getPosition(state.sunTimes.sunset, lat, lng).azimuth * 180 / Math.PI) + 180) % 360;
        f.push({ type: 'Feature', properties: { t: 'sr' }, geometry: { type: 'LineString', coordinates: [[lng, lat], dest(lat, lng, sra, R * 0.8)] } });
        f.push({ type: 'Feature', properties: { t: 'ss' }, geometry: { type: 'LineString', coordinates: [[lng, lat], dest(lat, lng, ssa, R * 0.8)] } });
    }

    const pk = fmtISO(state.curDate) + `_${lat.toFixed(3)}_${lng.toFixed(3)}`;
    if (state.pathCK !== pk) {
        state.pathCD = { c: [], m: [] };
        const d = new Date(state.curDate);
        for (let m = 0; m < 1440; m += 10) {
            d.setHours(Math.floor(m / 60), m % 60, 0, 0);
            const s2 = SunCalc.getPosition(d, lat, lng);
            const a2 = s2.altitude * 180 / Math.PI;
            if (a2 > 0) {
                const az2 = ((s2.azimuth * 180 / Math.PI) + 180) % 360;
                state.pathCD.c.push(dest(lat, lng, az2, R * 0.85));
                if (m % 60 === 0) {
                    const h = Math.floor(m / 60);
                    if (h >= 5 && h <= 22) state.pathCD.m.push({ c: dest(lat, lng, az2, R * 0.85), l: `${h}h` });
                }
            }
        }
        state.pathCK = pk;
    }

    if (state.pathCD && state.pathCD.c.length > 1) f.push({ type: 'Feature', properties: { t: 'path' }, geometry: { type: 'LineString', coordinates: state.pathCD.c } });
    if (state.pathCD) state.pathCD.m.forEach(m => f.push({ type: 'Feature', properties: { t: 'hm', l: m.l }, geometry: { type: 'Point', coordinates: m.c } }));

    state.map.getSource('sun-dir').setData({ type: 'FeatureCollection', features: f });
}
