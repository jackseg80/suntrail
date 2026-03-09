import * as THREE from 'three';
import { state } from './state.js';

const TILE_SIZE_METERS = 5000; // Chaque tuile fera 5km de côté
const RESOLUTION = 128; // 128x128 segments par tuile pour garder la fluidité
const activeTiles = new Map(); // Stocke les meshes par clé "x_y_z"

export function lngLatToTile(lon, lat, zoom) {
    const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    return { x, y, z: zoom };
}

function tileToLng(x, z) {
    return (x / Math.pow(2, z) * 360 - 180);
}

function tileToLat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
}

// Calcule la position 3D (X, Z) d'une tuile par rapport à un point d'origine
function getTilePosition(tx, ty, zoom, originTile) {
    const lon = tileToLng(tx, zoom);
    const lat = tileToLat(ty, zoom);
    const originLon = tileToLng(originTile.x, zoom);
    const originLat = tileToLat(originTile.y, zoom);

    const dx = (lon - originLon) * 111320 * Math.cos(lat * Math.PI / 180);
    const dz = (originLat - lat) * 111320;
    return { x: dx, z: dz };
}

export async function updateVisibleTiles() {
    if (!state.mapCenter) {
        state.mapCenter = { lat: state.TARGET_LAT, lon: state.TARGET_LON };
    }

    const centerTile = lngLatToTile(state.TARGET_LON, state.TARGET_LAT, state.ZOOM);
    const range = 2; // On charge 2 tuiles autour du centre (total 5x5)
    
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

    // Nettoyage des tuiles trop lointaines
    for (const [key, mesh] of activeTiles.entries()) {
        if (!neededTiles.has(key)) {
            state.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            activeTiles.delete(key);
        }
    }
}

async function loadSingleTile(tx, ty, zoom, originTile, key) {
    // On marque la tuile comme "en cours" pour éviter les doublons
    activeTiles.set(key, null);

    try {
        const pElev = fetch(`https://api.maptiler.com/tiles/terrain-rgb-v2/${zoom}/${tx}/${ty}.png?key=${state.MK}`)
            .then(r => r.blob()).then(b => createImageBitmap(b));
            
        const pColor = fetch(`https://api.maptiler.com/maps/outdoor-v2/256/${zoom}/${tx}/${ty}@2x.png?key=${state.MK}`)
            .then(r => r.ok ? r.blob() : fetch(`https://api.maptiler.com/maps/outdoor-v2/256/${zoom}/${tx}/${ty}.png?key=${state.MK}`).then(r2 => r2.blob()))
            .then(b => createImageBitmap(b));

        const [imgElev, imgColor] = await Promise.all([pElev, pColor]);

        // Décodage élévation
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(imgElev, 0, 0);
        const data = ctx.getImageData(0, 0, 256, 256).data;

        const heights = new Float32Array(256 * 256);
        let minH = Infinity;
        for (let i = 0; i < data.length; i += 4) {
            const h = -10000 + ((data[i] * 65536 + data[i+1] * 256 + data[data[i+2]]) * 0.1);
            heights[i/4] = h;
            if (h < minH && h > -9000) minH = h;
        }

        // Texture couleur
        const colorTex = new THREE.CanvasTexture(imgColor);
        colorTex.colorSpace = THREE.SRGBColorSpace;

        // Géométrie
        const pos = getTilePosition(tx, ty, zoom, originTile);
        const w = (tileToLng(tx + 1, zoom) - tileToLng(tx, zoom)) * 111320 * Math.cos(tileToLat(ty, zoom) * Math.PI / 180);
        const h = (tileToLat(ty, zoom) - tileToLat(ty + 1, zoom)) * 111320;

        const geometry = new THREE.PlaneGeometry(w, h, RESOLUTION, RESOLUTION);
        geometry.rotateX(-Math.PI / 2);

        const vertices = geometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            const u = (vertices[i] / w) + 0.5;
            const v = (vertices[i+2] / h) + 0.5;
            const px = Math.floor(u * 255);
            const py = Math.floor(v * 255);
            vertices[i+1] = heights[py * 256 + px] || 0;
        }
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: colorTex, roughness: 0.9 }));
        mesh.position.set(pos.x + w/2, 0, pos.z + h/2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        state.scene.add(mesh);
        activeTiles.set(key, mesh);

    } catch (e) {
        console.error("Erreur chargement tuile", key, e);
        activeTiles.delete(key);
    }
}

// Fonction legacy pour garder la compatibilité avec le bouton de démarrage
export async function loadTerrain() {
    await updateVisibleTiles();
}
