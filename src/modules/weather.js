import { state } from './config.js';
import { setLighting } from './sun.js';

let pAnim = null;
const wxCv = document.getElementById('wx-particles');
const wxCx = wxCv ? wxCv.getContext('2d') : null;
let pts = [];

export function initWeather() {
    if(!wxCv) return;
    window.addEventListener('resize', rsCv);
    rsCv();
}

function rsCv() {
    if(wxCv) {
        wxCv.width = innerWidth;
        wxCv.height = innerHeight;
    }
}

export function fetchWx() {
    if (!state.WK) {
        document.getElementById('wxc').innerHTML = '<div class="wnk">Ajoutez une clé <a href="https://home.openweathermap.org/api_keys" target="_blank">OWM</a> pour la météo.</div>';
        state.weatherData = null;
        clearWxFx();
        return;
    }
    clearTimeout(state.wxTimer);
    state.wxTimer = setTimeout(async () => {
        if(!state.map) return;
        const c = state.map.getCenter();
        try {
            const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&units=metric&lang=fr&appid=${state.WK}`);
            if (!r.ok) throw new Error(r.status);
            state.weatherData = await r.json();
            renderWx();
        } catch (e) {
            document.getElementById('wxc').innerHTML = `<div class="wnk">Erreur météo (${e.message}).</div>`;
        }
    }, 600);
}

function renderWx() {
    if (!state.weatherData) return;
    const w = state.weatherData;
    const cl = w.clouds?.all ?? 0;
    const tp = Math.round(w.main?.temp ?? 0);
    const fl = Math.round(w.main?.feels_like ?? 0);
    const hm = w.main?.humidity ?? 0;
    const wn = w.wind?.speed ? (w.wind.speed * 3.6).toFixed(0) : '—';
    const ds = w.weather?.[0]?.description ?? '';
    const ic = wxEm(w.weather?.[0]?.id, w.weather?.[0]?.icon);
    const vs = w.visibility ? (w.visibility / 1000).toFixed(0) : '—';
    
    document.getElementById('wxc').innerHTML = `
        <div class="wc">
            <div class="wi">${ic}</div>
            <div class="wn"><div class="wt">${tp}°C</div><div class="wd">${ds}</div></div>
        </div>
        <div class="wds">
            <div class="wdi">🌡️ Ressenti <span class="wv">${fl}°C</span></div>
            <div class="wdi">💧 Humidité <span class="wv">${hm}%</span></div>
            <div class="wdi">💨 Vent <span class="wv">${wn} km/h</span></div>
            <div class="wdi">👁️ Visibilité <span class="wv">${vs} km</span></div>
        </div>
        <div class="cbc"><div class="cb" style="width:${cl}%"></div></div><div class="cl">☁️ Nuages: ${cl}%</div>
    `;
    applyWxFx();
    setLighting();
}

function wxEm(c, i) {
    if (!c) return '🌡️';
    const n = i?.endsWith('n');
    if (c >= 200 && c < 300) return '⛈️';
    if (c >= 300 && c < 600) return '🌧️';
    if (c >= 600 && c < 700) return '🌨️';
    if (c >= 700 && c < 800) return '🌫️';
    if (c === 800) return n ? '🌙' : '☀️';
    if (c === 801) return n ? '🌙' : '🌤️';
    if (c === 802) return '⛅';
    if (c >= 803) return '☁️';
    return '🌡️';
}

function applyWxFx() {
    if (!state.weatherData) { clearWxFx(); return; }
    const cd = state.weatherData.weather?.[0]?.id ?? 800;
    const cl = state.weatherData.clouds?.all ?? 0;
    const ov = document.getElementById('wx-overlay');
    const bg = document.getElementById('wx-badge');
    const ml = document.getElementById('map');
    
    ov.className = '';
    bg.style.display = 'none';
    ml.style.filter = '';
    cancelAnimationFrame(pAnim);
    pts = [];
    
    if (cd >= 700 && cd < 800) {
        ov.className = state.weatherData.visibility < 1000 ? 'fog-heavy' : 'fog';
        ml.style.filter = state.weatherData.visibility < 1000 ? 'saturate(0.4) brightness(0.85)' : 'saturate(0.6) brightness(0.9)';
        showBg(state.weatherData.visibility < 1000 ? '🌫️ Brouillard épais' : '🌫️ Brume');
    } else if (cd >= 200 && cd < 300) {
        ov.className = 'storm';
        ml.style.filter = 'saturate(0.35) brightness(0.7)';
        initPt('rain', 250);
        showBg('⛈️ Orage');
    } else if (cd >= 300 && cd < 600) {
        const h = cd >= 502;
        ov.className = 'rain';
        ml.style.filter = h ? 'saturate(0.4) brightness(0.75)' : 'saturate(0.55) brightness(0.85)';
        initPt('rain', h ? 200 : 120);
        showBg(h ? '🌧️ Pluie forte' : '🌧️ Pluie');
    } else if (cd >= 600 && cd < 700) {
        ov.className = 'snow';
        ml.style.filter = 'saturate(0.4) brightness(1.0)';
        initPt('snow', 100);
        showBg('🌨️ Neige');
    } else if (cd >= 803) {
        ov.className = 'overcast';
        ml.style.filter = `saturate(${0.9 - cl / 100 * 0.4}) brightness(${1 - cl / 100 * 0.15})`;
        showBg(`☁️ Couvert (${cl}%)`);
    } else if (cd >= 801) {
        ml.style.filter = `saturate(${0.95 - cl / 100 * 0.2})`;
    }
}

export function clearWxFx() {
    const ov = document.getElementById('wx-overlay');
    if(ov) ov.className = '';
    const bg = document.getElementById('wx-badge');
    if(bg) bg.style.display = 'none';
    const ml = document.getElementById('map');
    if(ml) ml.style.filter = '';
    cancelAnimationFrame(pAnim);
    pts = [];
    if(wxCx && wxCv) wxCx.clearRect(0, 0, wxCv.width, wxCv.height);
}

function showBg(t) {
    const b = document.getElementById('wx-badge');
    b.textContent = t;
    b.style.display = 'block';
}

function initPt(type, n) {
    pts = [];
    if(!wxCv) return;
    for (let i = 0; i < n; i++) {
        if (type === 'rain') {
            pts.push({ x: Math.random() * wxCv.width, y: Math.random() * wxCv.height, l: 12 + Math.random() * 18, sp: 8 + Math.random() * 12, dr: -1.5 - Math.random() * 2, op: 0.15 + Math.random() * 0.25, t: 'r' });
        } else {
            pts.push({ x: Math.random() * wxCv.width, y: Math.random() * wxCv.height, r: 1.5 + Math.random() * 3, sp: 0.5 + Math.random() * 1.5, dr: Math.sin(Math.random() * 6.28) * 0.8, w: Math.random() * 6.28, ws: 0.01 + Math.random() * 0.02, op: 0.3 + Math.random() * 0.5, t: 's' });
        }
    }
    animPt();
}

function animPt() {
    if(!wxCx || !wxCv) return;
    wxCx.clearRect(0, 0, wxCv.width, wxCv.height);
    const w = wxCv.width, h = wxCv.height;
    for (const p of pts) {
        if (p.t === 'r') {
            p.y += p.sp; p.x += p.dr;
            if (p.y > h) { p.y = -p.l; p.x = Math.random() * w; }
            wxCx.beginPath(); wxCx.moveTo(p.x, p.y); wxCx.lineTo(p.x + p.dr * 0.6, p.y + p.l);
            wxCx.strokeStyle = `rgba(170, 185, 210, ${p.op})`; wxCx.lineWidth = 1; wxCx.stroke();
        } else {
            p.w += p.ws; p.y += p.sp; p.x += p.dr + Math.sin(p.w) * 0.5;
            if (p.y > h) { p.y = -p.r * 2; p.x = Math.random() * w; }
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            wxCx.beginPath(); wxCx.arc(p.x, p.y, p.r, 0, 6.28);
            wxCx.fillStyle = `rgba(230, 235, 245, ${p.op})`; wxCx.fill();
        }
    }
    if (pts.length) pAnim = requestAnimationFrame(animPt);
}
