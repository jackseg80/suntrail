import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { state } from './config.js';
import { updateSun } from './sun.js';
import { fetchWx } from './weather.js';
import { throttle } from './utils.js';
import { clearShadows, clearDebugLayer, recompute } from './shadows.js';
import { updateOverlay } from './ui.js';

export function initMap() {
    state.map = new maplibregl.Map({
        container: 'map',
        style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${state.MK}`,
        center: state.SWISS,
        zoom: 10,
        pitch: 55,
        bearing: -15,
        maxPitch: 75,
        antialias: true
    });

    state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    state.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    state.map.on('load', () => {
        const ts = findDEM();
        if (ts) state.map.setTerrain({ source: ts, exaggeration: 1.5 });
        else {
            state.map.addSource('t-dem', { type: 'raster-dem', url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${state.MK}`, tileSize: 256 });
            state.map.setTerrain({ source: 't-dem', exaggeration: 1.5 });
        }
        
        state.map.addSource('sun-dir', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        state.map.addLayer({ id: 'sun-path', type: 'line', source: 'sun-dir', filter: ['==', ['get', 't'], 'path'], paint: { 'line-color': '#f0b429', 'line-width': 1.5, 'line-opacity': 0.35, 'line-dasharray': [4, 4] } });
        state.map.addLayer({ id: 'sun-rs', type: 'line', source: 'sun-dir', filter: ['in', ['get', 't'], ['literal', ['sr', 'ss']]], paint: { 'line-color': ['case', ['==', ['get', 't'], 'sr'], '#ff922b', '#e8590c'], 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [2, 3] } });
        state.map.addLayer({ id: 'sun-cur', type: 'line', source: 'sun-dir', filter: ['==', ['get', 't'], 'cur'], paint: { 'line-color': '#f0b429', 'line-width': 3, 'line-opacity': 0.85 } });
        state.map.addLayer({ id: 'sun-hm', type: 'circle', source: 'sun-dir', filter: ['==', ['get', 't'], 'hm'], paint: { 'circle-radius': 4, 'circle-color': 'rgba(240,180,41,0.5)', 'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(240,180,41,0.8)' } });
        state.map.addLayer({ id: 'sun-hl', type: 'symbol', source: 'sun-dir', filter: ['==', ['get', 't'], 'hm'], layout: { 'text-field': ['get', 'l'], 'text-size': 11, 'text-offset': [0, -1.2] }, paint: { 'text-color': 'rgba(240,180,41,0.9)', 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1.5 } });
        state.map.addLayer({ id: 'sun-dot', type: 'circle', source: 'sun-dir', filter: ['==', ['get', 't'], 'sun'], paint: { 'circle-radius': 10, 'circle-color': '#f0b429', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 } });
        
        document.getElementById('panel').style.display = 'block';
        updateSun();
        fetchWx();
        
        const onMv = throttle(() => {
            state.pathCK = ''; state.compCK = ''; state.cachedGrid = null;
            updateOverlay();
            fetchWx();
        }, 300);
        state.map.on('moveend', onMv);
        
        state.map.on('click', e => {
            const lat = e.lngLat.lat, lon = e.lngLat.lng;
            const directElev = state.map.queryTerrainElevation?.(e.lngLat);
            const directStr = directElev !== null && directElev !== undefined ? directElev.toFixed(1) + 'm' : 'N/A';
            
            let gridStr = '(pas de grille)';
            if (state.cachedGrid && state.cachedBounds) {
                const b = state.cachedBounds, gs = state.cachedGS;
                const gx = Math.round((lon - b.west) / (b.east - b.west) * gs);
                const gy = Math.round((b.north - lat) / (b.north - b.south) * gs);
                if (gx >= 0 && gx < gs && gy >= 0 && gy < gs) {
                    const elev = state.cachedGrid[gy * gs + gx];
                    gridStr = elev < -9000 ? 'MANQUANT' : elev.toFixed(1) + 'm';
                }
            }
            new maplibregl.Popup({ closeOnClick: true, maxWidth: '280px' })
                .setLngLat(e.lngLat)
                .setHTML(`<div style="font-size:12px;font-family:monospace;padding:2px">
                    <b>📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}</b><br>
                    ⛰️ Terrain: <b>${directStr}</b><br>
                    📐 Grille ombres: <b>${gridStr}</b>
                </div>`)
                .addTo(state.map);
        });
    });

    state.map.on('error', e => {
        if (e.error && e.error.status === 403) {
            document.getElementById('setup-screen').style.display = 'flex';
            const err = document.getElementById('serr');
            err.textContent = '⚠️ Clé MapTiler invalide ou expirée.';
            err.style.display = 'block';
        }
    });
}

export function findDEM() {
    if(!state.map) return null;
    for (const [i, s] of Object.entries(state.map.getStyle().sources)) {
        if (s.type === 'raster-dem') return i;
    }
    return null;
}

export async function loadTrails() {
    const btn = document.getElementById('btl'), st = document.getElementById('tst');
    if (!state.map || state.map.getZoom() < 12) {
        st.className = 'ss er';
        st.textContent = '❌ Zoomez davantage (zoom ≥ 12).';
        return;
    }
    btn.disabled = true; st.className = 'ss cp'; st.textContent = '⏳ Requête OSM...';
    const b = state.map.getBounds();
    const s = b.getSouth().toFixed(5), w = b.getWest().toFixed(5), n = b.getNorth().toFixed(5), e = b.getEast().toFixed(5);
    const q = `[out:json][timeout:30];(way["highway"="path"]["sac_scale"](${s},${w},${n},${e});way["highway"="footway"]["sac_scale"](${s},${w},${n},${e});relation["route"="hiking"](${s},${w},${n},${e});way["highway"="path"]["trail_visibility"](${s},${w},${n},${e}););out geom;`;
    
    try {
        const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        
        const feats = [];
        for (const el of data.elements) {
            if (el.type === 'way' && el.geometry) {
                feats.push({ type: 'Feature', properties: { name: el.tags?.name || '', diff: el.tags?.sac_scale || 'unknown' }, geometry: { type: 'LineString', coordinates: el.geometry.map(p => [p.lon, p.lat]) } });
            } else if (el.type === 'relation' && el.members) {
                for (const m of el.members) {
                    if (m.type === 'way' && m.geometry) {
                        feats.push({ type: 'Feature', properties: { name: el.tags?.name || '', diff: el.tags?.sac_scale || 'unknown' }, geometry: { type: 'LineString', coordinates: m.geometry.map(p => [p.lon, p.lat]) } });
                    }
                }
            }
        }
        
        ['hiking-trails', 'hiking-trails-glow'].forEach(l => { if (state.map.getLayer(l)) state.map.removeLayer(l); });
        if (state.map.getSource('hiking-trails')) state.map.removeSource('hiking-trails');
        
        state.map.addSource('hiking-trails', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
        state.map.addLayer({ id: 'hiking-trails-glow', type: 'line', source: 'hiking-trails', paint: { 'line-color': 'rgba(255,255,255,0.4)', 'line-width': 4, 'line-blur': 2 } });
        state.map.addLayer({
            id: 'hiking-trails', type: 'line', source: 'hiking-trails', paint: {
                'line-color': ['match', ['get', 'diff'], 'hiking', '#22b8cf', 'mountain_hiking', '#f59f00', 'demanding_mountain_hiking', '#e8590c', 'alpine_hiking', '#e03131', 'demanding_alpine_hiking', '#9c36b5', 'difficult_alpine_hiking', '#1a1a1a', '#e03131'],
                'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 18, 5],
                'line-opacity': 0.85
            }
        });
        
        st.className = 'ss dn'; st.textContent = `✅ ${feats.length} sentiers`;
        document.getElementById('ttr').style.display = 'flex';
        btn.textContent = '🔄 Recharger';
    } catch (e) {
        st.className = 'ss er'; st.textContent = `❌ ${e.message}`;
    }
    btn.disabled = false;
}
