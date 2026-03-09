import SunCalc from 'suncalc';
import { state } from './config.js';
import { dest, lerp, fmtT, fmtISO } from './utils.js';

export function updateSun() {
    if(!state.map) return;
    const c = state.map.getCenter();
    const sp = SunCalc.getPosition(state.curDate, c.lat, c.lng);
    const az = ((sp.azimuth * 180 / Math.PI) + 180) % 360;
    const alt = sp.altitude * 180 / Math.PI;
    
    state.sunTimes = SunCalc.getTimes(state.curDate, c.lat, c.lng);
    
    document.getElementById('tdisp').textContent = `${String(state.curDate.getHours()).padStart(2, '0')}:${String(state.curDate.getMinutes()).padStart(2, '0')}`;
    document.getElementById('daz').textContent = `${az.toFixed(1)}°`;
    document.getElementById('del').textContent = `${alt.toFixed(1)}°`;
    document.getElementById('dph').textContent = sunPh(alt);
    
    if (state.sunTimes.sunrise && state.sunTimes.sunset) {
        const d = state.sunTimes.sunset - state.sunTimes.sunrise;
        document.getElementById('ddl').textContent = `${Math.floor(d / 3600000)}h${String(Math.floor((d % 3600000) / 60000)).padStart(2, '0')}`;
    }
    
    const n = Math.max(0, Math.min(1, (alt + 10) / 80));
    const bar = document.getElementById('ebar');
    bar.style.width = `${n * 100}%`;
    bar.style.background = alt < 0 ? 'linear-gradient(90deg,#312e81,#4338ca)' : alt < 6 ? 'linear-gradient(90deg,#e8590c,#f0b429)' : alt < 20 ? 'linear-gradient(90deg,#f0b429,#fcc419)' : 'linear-gradient(90deg,#fcc419,#fff3bf)';
    
    document.getElementById('elab').textContent = alt < 0 ? `Sous l'horizon (${alt.toFixed(1)}°)` : `Élévation: ${alt.toFixed(1)}°`;
    document.getElementById('tsr').textContent = state.sunTimes.sunrise ? fmtT(state.sunTimes.sunrise) : '—';
    document.getElementById('tsn').textContent = state.sunTimes.solarNoon ? fmtT(state.sunTimes.solarNoon) : '—';
    document.getElementById('tss').textContent = state.sunTimes.sunset ? fmtT(state.sunTimes.sunset) : '—';
    
    updateComp(az, alt);
    setHS(az);
    setLighting(az, alt);
    updateSky(alt);
    document.getElementById('night-indicator').style.display = alt < -0.83 ? 'block' : 'none';
}

function sunPh(a) {
    if (a < -18) return '🌑 Nuit';
    if (a < -12) return '🌌 Astro.';
    if (a < -6) return '🌃 Nautique';
    if (a < -0.83) return '🌆 Crépuscule';
    if (a < 6) return '🌅 Golden Hour';
    if (a < 20) return '🌤️ Matin/Soir';
    return '☀️ Plein jour';
}

export function updateComp(az, alt) {
    const svg = document.getElementById('csv'), cx = 100, cy = 100, r = 80;
    if(!state.map || !svg) return;
    const c = state.map.getCenter();
    const dk = fmtISO(state.curDate) + `_${c.lat.toFixed(2)}_${c.lng.toFixed(2)}`;
    
    if (state.compCK !== dk) {
        state.compCD = [];
        const d = new Date(state.curDate);
        for (let m = 0; m < 1440; m += 15) {
            d.setHours(Math.floor(m / 60), m % 60, 0, 0);
            const sp = SunCalc.getPosition(d, c.lat, c.lng);
            const a2 = ((sp.azimuth * 180 / Math.PI) + 180) % 360;
            const al = sp.altitude * 180 / Math.PI;
            if (al > -5) {
                const di = r * (1 - Math.max(0, al) / 90) * 0.85;
                const rd = (a2 - 90) * Math.PI / 180;
                state.compCD.push({ x: cx + di * Math.cos(rd), y: cy + di * Math.sin(rd) });
            }
        }
        state.compCK = dk;
    }
    
    const sd = r * (1 - Math.max(0, alt) / 90) * 0.85;
    const sr = (az - 90) * Math.PI / 180;
    const sx = cx + sd * Math.cos(sr);
    const sy = cy + sd * Math.sin(sr);
    const sc = alt > 0 ? '#f0b429' : alt > -6 ? '#e8590c' : '#4338ca';
    
    let h = `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    for (const e of [0, 30, 60]) {
        const er = r * (1 - e / 90) * 0.85;
        h += `<circle cx="${cx}" cy="${cy}" r="${er}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="0.5" stroke-dasharray="2,3"/>`;
    }
    for (const d of [{ l: 'N', a: 0 }, { l: 'E', a: 90 }, { l: 'S', a: 180 }, { l: 'O', a: 270 }]) {
        const rd = (d.a - 90) * Math.PI / 180;
        h += `<line x1="${cx}" y1="${cy}" x2="${cx + (r + 1) * Math.cos(rd)}" y2="${cy + (r + 1) * Math.sin(rd)}" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>`;
        h += `<text x="${cx + (r + 14) * Math.cos(rd)}" y="${cy + (r + 14) * Math.sin(rd)}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,0.4)" font-size="10">${d.l}</text>`;
    }
    
    if (state.compCD.length > 1) {
        let p = `M ${state.compCD[0].x} ${state.compCD[0].y}`;
        for (let i = 1; i < state.compCD.length; i++) p += ` L ${state.compCD[i].x} ${state.compCD[i].y}`;
        h += `<path d="${p}" fill="none" stroke="rgba(240,180,41,0.25)" stroke-width="2"/>`;
    }
    
    if (alt > 0) {
        h += `<circle cx="${sx}" cy="${sy}" r="16" fill="rgba(240,180,41,0.1)"/>`;
        h += `<circle cx="${sx}" cy="${sy}" r="10" fill="rgba(240,180,41,0.2)"/>`;
    }
    
    h += `<line x1="${cx}" y1="${cy}" x2="${sx}" y2="${sy}" stroke="${sc}" stroke-width="1" stroke-opacity="0.5" stroke-dasharray="3,3"/>`;
    h += `<circle cx="${sx}" cy="${sy}" r="6" fill="${sc}" stroke="white" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="rgba(255,255,255,0.5)"/>`;
    svg.innerHTML = h;
}

export function setHS(az) {
    if (!state.map || !state.map.isStyleLoaded()) return;
    const input = document.getElementById('thi');
    const v = input ? parseFloat(input.value) : 0.85;
    state.map.getStyle().layers.forEach(l => {
        if (l.type === 'hillshade') {
            if (az !== undefined) {
                state.map.setPaintProperty(l.id, 'hillshade-illumination-direction', az);
                state.map.setPaintProperty(l.id, 'hillshade-illumination-anchor', 'map');
            }
            state.map.setPaintProperty(l.id, 'hillshade-exaggeration', v);
            state.map.setPaintProperty(l.id, 'hillshade-shadow-color', 'rgba(0,0,20,0.55)');
            state.map.setPaintProperty(l.id, 'hillshade-highlight-color', 'rgba(255,255,245,0.30)');
        }
    });
}

export function setLighting(az, alt) {
    if (!state.map) return;
    if (az === undefined || alt === undefined) {
        const c = state.map.getCenter();
        const sp = SunCalc.getPosition(state.curDate, c.lat, c.lng);
        az = ((sp.azimuth * 180 / Math.PI) + 180) % 360;
        alt = sp.altitude * 180 / Math.PI;
    }
    
    const cf = state.weatherData ? (state.weatherData.clouds?.all ?? 0) / 100 : 0;
    let col, int;
    
    if (alt < -6) { col = '#1a1a3e'; int = 0.05; } 
    else if (alt < -0.83) { const t = (alt + 6) / 5.17; col = lerp('#2a2050', '#c06030', t); int = 0.1 + t * 0.25; }
    else if (alt < 3) { const t = alt / 3; col = lerp('#d06020', '#e8a030', t); int = 0.35 + t * 0.2; } 
    else if (alt < 10) { const t = (alt - 3) / 7; col = lerp('#e8a030', '#f5d080', t); int = 0.55 + t * 0.15; }
    else if (alt < 25) { const t = (alt - 10) / 15; col = lerp('#f5d080', '#ffffff', t); int = 0.7 + t * 0.15; } 
    else { col = '#ffffff'; int = 0.85; }
    
    if (cf > 0 && alt > 0) {
        col = lerp(col, '#b0b5c0', cf * 0.75);
        int *= (1 - cf * 0.45);
    }
    state.map.setLight({ anchor: 'map', position: [1.5, az, alt <= 0 ? 88 : Math.max(15, 90 - alt * 0.9)], color: col, intensity: int });
}

export function updateSky(alt) {
    const sky = document.getElementById('sky-overlay');
    const ml = document.getElementById('map');
    if(!sky || !ml) return;
    let bg, op, mf;
    
    if (alt < -18) { bg = 'linear-gradient(180deg,rgba(8,10,28,0.85) 0%,rgba(18,20,45,0.65) 100%)'; op = 1; mf = 'brightness(0.25) saturate(0.2)'; }
    else if (alt < -6) { bg = 'linear-gradient(180deg,rgba(20,24,60,0.6) 0%,rgba(60,50,78,0.3) 100%)'; op = 1; mf = 'brightness(0.45) saturate(0.3)'; }
    else if (alt < -0.83) { const t = (alt + 6) / 5.17; bg = `linear-gradient(180deg,rgba(40,45,90,${0.35 - t * 0.2}) 0%,rgba(200,120,50,${0.1 + t * 0.15}) 100%)`; op = 1; mf = `brightness(${0.5 + t * 0.25}) saturate(${0.4 + t * 0.3})`; }
    else if (alt < 3) { const t = alt / 3; bg = `linear-gradient(180deg,rgba(180,100,40,${0.15 - t * 0.1}) 0%,rgba(240,180,80,${0.08 - t * 0.06}) 100%)`; op = 1; mf = `brightness(${0.75 + t * 0.15}) saturate(${0.7 + t * 0.2})`; }
    else if (alt < 10) { const t = (alt - 3) / 7; bg = `linear-gradient(180deg,rgba(240,200,100,${0.05 - t * 0.05}) 0%,transparent 100%)`; op = 1; mf = `brightness(${0.9 + t * 0.1}) saturate(${0.9 + t * 0.1})`; }
    else { bg = 'none'; op = 0; mf = 'brightness(1) saturate(1)'; }
    
    sky.style.background = bg;
    sky.style.opacity = op;
    
    if (!state.weatherData || (state.weatherData.weather?.[0]?.id <= 801)) {
        ml.style.filter = mf;
    } else if (alt < 0) {
        ml.style.filter += ` brightness(${Math.max(0.25, (alt + 18) / 18)})`;
    }
}
