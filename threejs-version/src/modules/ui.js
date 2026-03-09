import { state } from './state.js';
import { updateSunPosition } from './sun.js';
import { initScene } from './scene.js';
import { loadTerrain, updateVisibleTiles, activeTiles } from './terrain.js';

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
                        
                        // 1. Mise à jour des coordonnées globales
                        state.TARGET_LAT = lat;
                        state.TARGET_LON = lng;
                        
                        // 2. Réinitialisation de la caméra et du point d'origine du monde
                        if (state.controls) {
                            state.initialLat = lat;
                            state.initialLon = lng;
                            state.originTile = lngLatToTile(lng, lat, state.ZOOM);
                            state.controls.target.set(0, 0, 0);
                            state.camera.position.set(0, 3000, 8000);
                            state.controls.update(); // Validation vitale du déplacement
                        }
                        
                        // 3. Destruction absolue de toutes les anciennes montagnes (tuiles)
                        for (const [key, tileObj] of activeTiles.entries()) {
                            if (tileObj && tileObj.mesh) {
                                state.scene.remove(tileObj.mesh);
                                tileObj.mesh.geometry.dispose();
                                if (tileObj.mesh.material.map) tileObj.mesh.material.map.dispose();
                                tileObj.mesh.material.dispose();
                            }
                        }
                        activeTiles.clear();
                        
                        // 4. Reconstruction du nouveau monde et du soleil
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
