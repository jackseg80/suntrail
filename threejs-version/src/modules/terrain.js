import * as THREE from 'three';
import { state } from './state.js';

const EARTH_CIRCUMFERENCE = 40075016.68;
const RESOLUTION = 256; // 256x256 segments par tuile pour un maillage HD
export const activeTiles = new Map(); 

export function lngLatToTile(lon, lat, zoom) {
    const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    return { x, y, z: zoom };
}

function tileToLat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
}

export async function updateVisibleTiles(camLat, camLon, camAltitude) {
    if (!state.mapCenter) {
        state.mapCenter = { lat: state.TARGET_LAT, lon: state.TARGET_LON };
    }

    const currentLat = camLat || state.TARGET_LAT;
    const currentLon = camLon || state.TARGET_LON;

    const centerTile = lngLatToTile(currentLon, currentLat, state.ZOOM);
    
    // Range dynamique : si la caméra est très haute (dézoom), on charge plus loin !
    // Altitude de base ~3000 unités. Si altitude = 8000, on charge 3 tuiles (7x7), etc.
    let range = 2; // Par défaut : 5x5 tuiles
    if (camAltitude) {
        if (camAltitude > 12000) range = 4; // 9x9 = 81 tuiles (Très large vue)
        else if (camAltitude > 6000) range = 3; // 7x7 = 49 tuiles
    }
    
    const neededTiles = new Set();

    for (let dy = -range; dy <= range; dy++) {
        for (let dx = -range; dx <= range; dx++) {
            const tx = centerTile.x + dx;
            const ty = centerTile.y + dy;
            const key = `${tx}_${ty}_${state.ZOOM}`;
            neededTiles.add(key);

            if (!activeTiles.has(key)) {
                loadSingleTile(tx, ty, state.ZOOM, centerTile, key);
            }
        }
    }

    // Nettoyage des tuiles lointaines (hors du nouveau range)
    for (const [key, mesh] of activeTiles.entries()) {
        if (!neededTiles.has(key)) {
            if (mesh) {
                state.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.map.dispose();
                mesh.material.dispose();
            }
            activeTiles.delete(key);
        }
    }
}

async function loadSingleTile(tx, ty, zoom, originTile, key) {
    activeTiles.set(key, null); // Marque comme "en cours de chargement"

    try {
        const pElev = fetch(`https://api.maptiler.com/tiles/terrain-rgb-v2/${zoom}/${tx}/${ty}.png?key=${state.MK}`)
            .then(r => r.blob()).then(b => createImageBitmap(b));
            
        const pColor = fetch(`https://api.maptiler.com/maps/outdoor-v2/256/${zoom}/${tx}/${ty}@2x.png?key=${state.MK}`)
            .then(r => r.ok ? r.blob() : fetch(`https://api.maptiler.com/maps/outdoor-v2/256/${zoom}/${tx}/${ty}.png?key=${state.MK}`).then(r2 => r2.blob()))
            .then(b => createImageBitmap(b));

        const [imgElev, imgColor] = await Promise.all([pElev, pColor]);

        if (!activeTiles.has(key)) return; // Si la tuile a été annulée pendant le fetch

        // Décodage de l'élévation RGB
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imgElev, 0, 0, 256, 256);
        const data = ctx.getImageData(0, 0, 256, 256).data;

        const heights = new Float32Array(256 * 256);
        let minH = Infinity;
        for (let i = 0; i < data.length; i += 4) {
            // CORRECTION DE LA FAUTE DE FRAPPE ICI (data[i+2] au lieu de data[data[i+2]])
            const h = -10000 + ((data[i] * 65536 + data[i+1] * 256 + data[i+2]) * 0.1);
            heights[i/4] = h;
            if (h < minH && h > -9000) minH = h;
        }

        const colorTex = new THREE.CanvasTexture(imgColor);
        colorTex.colorSpace = THREE.SRGBColorSpace;
        colorTex.flipY = false; // VITAL : Maintient les textes lisibles et l'image à l'endroit
        if (state.renderer) colorTex.anisotropy = state.renderer.capabilities.getMaxAnisotropy();

        const tileSizeMeters = EARTH_CIRCUMFERENCE / Math.pow(2, zoom);
        const dx = (tx - originTile.x) * tileSizeMeters;
        const dz = (ty - originTile.y) * tileSizeMeters;

        const overlapSize = tileSizeMeters * 1.005;
        const geometry = new THREE.PlaneGeometry(overlapSize, overlapSize, RESOLUTION, RESOLUTION);
        geometry.rotateX(-Math.PI / 2);

        const lat = tileToLat(ty + 0.5, zoom);
        const heightScale = 1 / Math.cos(lat * Math.PI / 180);

        const vertices = geometry.attributes.position.array;
        const uvs = geometry.attributes.uv.array;
        
        // Inversion absolue de l'axe V de la géométrie pour correspondre à flipY = false
        // Cela garantit que la physique (montagnes) s'aligne 1:1 avec la peinture (texture)
        for (let i = 1; i < uvs.length; i += 2) {
            uvs[i] = 1.0 - uvs[i];
        }

        function getElevationBilinear(px, py) {
            if (px < 0) px = 0; if (px >= 255) px = 254.999;
            if (py < 0) py = 0; if (py >= 255) py = 254.999;

            const x0 = Math.floor(px);
            const y0 = Math.floor(py);
            const x1 = x0 + 1;
            const y1 = y0 + 1;

            const wx = px - x0;
            const wy = py - y0;

            const h00 = heights[y0 * 256 + x0];
            const h10 = heights[y0 * 256 + x1];
            const h01 = heights[y1 * 256 + x0];
            const h11 = heights[y1 * 256 + x1];

            if (h00 < -9000 || h10 < -9000 || h01 < -9000 || h11 < -9000) return h00;

            return h00 * (1 - wx) * (1 - wy) +
                   h10 * wx * (1 - wy) +
                   h01 * (1 - wx) * wy +
                   h11 * wx * wy;
        }

        // On soulève les sommets en lisant les UV modifiés
        for (let i = 0; i < vertices.length / 3; i++) {
            const u = uvs[i * 2];
            const v = uvs[i * 2 + 1];
            
            const canvasX = u * 255;
            const canvasY = v * 255; 
            
            const h = getElevationBilinear(canvasX, canvasY);
            vertices[i * 3 + 1] = (h > -9000 ? h : minH) * heightScale;
        }
        
        // Lissage des ombres
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({ 
            map: colorTex, 
            roughness: 0.9,
            metalness: 0.0,
            flatShading: false 
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        // On place la tuile exactement à côté de sa voisine
        mesh.position.set(dx, 0, dz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        state.scene.add(mesh);
        activeTiles.set(key, mesh);

        const btn = document.getElementById('bgo');
        if (btn) btn.textContent = "Recharger le relief";

    } catch (e) {
        console.error("Erreur chargement tuile", key, e);
        activeTiles.delete(key);
    }
}

export async function loadTerrain() {
    await updateVisibleTiles();
}
