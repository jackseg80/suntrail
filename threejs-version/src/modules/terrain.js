import * as THREE from 'three';
import { state } from './state.js';

const EARTH_CIRCUMFERENCE = 40075016.68;
const RESOLUTION = 128; // 128x128 segments par tuile
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

export async function updateVisibleTiles() {
    if (!state.mapCenter) {
        state.mapCenter = { lat: state.TARGET_LAT, lon: state.TARGET_LON };
    }

    const centerTile = lngLatToTile(state.TARGET_LON, state.TARGET_LAT, state.ZOOM);
    const range = 2; // Zone de 5x5 tuiles autour du centre
    
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

    // Nettoyage des tuiles lointaines
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
        colorTex.flipY = false; // CORRECTION 1: Remet les textes à l'endroit et aligne la texture avec la 3D !
        if (state.renderer) colorTex.anisotropy = state.renderer.capabilities.getMaxAnisotropy();

        const tileSizeMeters = EARTH_CIRCUMFERENCE / Math.pow(2, zoom);
        
        const dx = (tx - originTile.x) * tileSizeMeters;
        const dz = (ty - originTile.y) * tileSizeMeters;

        // CORRECTION 2: On agrandit la géométrie de 1% pour forcer le chevauchement et boucher les "vides" (Seams)
        const overlapSize = tileSizeMeters * 1.01;
        const geometry = new THREE.PlaneGeometry(overlapSize, overlapSize, RESOLUTION, RESOLUTION);
        geometry.rotateX(-Math.PI / 2);

        const lat = tileToLat(ty + 0.5, zoom);
        const heightScale = 1 / Math.cos(lat * Math.PI / 180);

        const vertices = geometry.attributes.position.array;
        
        function getElevationBilinear(u, v) {
            let x = u * 255;
            let y = v * 255;
            if (x < 0) x = 0; if (x >= 255) x = 254.999;
            if (y < 0) y = 0; if (y >= 255) y = 254.999;

            const x0 = Math.floor(x);
            const y0 = Math.floor(y);
            const x1 = x0 + 1;
            const y1 = y0 + 1;

            const wx = x - x0;
            const wy = y - y0;

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

        // Élévation des sommets de la tuile
        for (let i = 0; i < vertices.length; i += 3) {
            const u = (vertices[i] / tileSizeMeters) + 0.5;
            const v = (vertices[i+2] / tileSizeMeters) + 0.5;
            
            const h = getElevationBilinear(u, v);
            vertices[i+1] = (h > -9000 ? h : minH) * heightScale;
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
