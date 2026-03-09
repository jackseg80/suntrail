import { state } from './state.js';
import { updateSunPosition } from './sun.js';
import { initScene } from './scene.js';
import { loadTerrain } from './terrain.js';

export function initUI() {
    const s1 = localStorage.getItem('maptiler_key_3d');
    if (s1) document.getElementById('k1').value = s1;
    
    document.getElementById('bgo').addEventListener('click', go);
    document.getElementById('k1').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    
    const timeSlider = document.getElementById('time-slider');
    timeSlider.addEventListener('input', (e) => {
        updateSunPosition(e.target.value);
    });

    initGeocoding();
}

function go() {
    state.MK = document.getElementById('k1').value.trim();
    if (!state.MK || state.MK.length < 5) {
        document.getElementById('serr').textContent = 'Clé MapTiler invalide.';
        return;
    }
    localStorage.setItem('maptiler_key_3d', state.MK);
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('panel').style.display = 'block';
    initScene();
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
                // Utilisation de l'API Geocoding de MapTiler
                const r = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${state.MK}&language=fr&limit=6`);
                if (!r.ok) return;
                const data = await r.json();
                if (!data.features || !data.features.length) { geoResults.style.display = 'none'; return; }
                
                geoResults.innerHTML = '';
                data.features.forEach(f => {
                    const item = document.createElement('div');
                    item.style.cssText = 'padding:0.6rem 0.75rem; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.8rem;';
                    const name = f.text || f.place_name || '';
                    item.innerHTML = `<div style="color:white; font-weight:500">${name}</div><div style="color:#8b8d98; font-size:0.7rem;">${f.place_name || ''}</div>`;
                    
                    item.addEventListener('click', async () => {
                        const [lng, lat] = f.center || f.geometry.coordinates;
                        geoResults.style.display = 'none';
                        geoInput.value = name;
                        
                        // Action : Changer de position et recharger le monde
                        state.TARGET_LAT = lat;
                        state.TARGET_LON = lng;
                        
                        // On réinitialise la position de la caméra au-dessus du nouveau lieu
                        // Note : Dans un Tile Manager, le point (0,0,0) est toujours le centre du chargement initial
                        // Pour une navigation fluide, on va simplement forcer le rechargement des tuiles
                        await updateVisibleTiles();
                        updateSunPosition(document.getElementById('time-slider').value);
                    });
                    geoResults.appendChild(item);
                });
                geoResults.style.display = 'block';
            } catch (e) { console.warn('Geocoding error:', e); }
        }, 300);
    });
}
