import * as THREE from 'three';
import { state } from './state.js';

function lngLatToTile(lon, lat, zoom) {
    const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    return { x, y, z: zoom };
}

export async function loadTerrain() {
    const btn = document.getElementById('bgo');
    btn.textContent = "Téléchargement et décodage HD...";
    
    const centerTile = lngLatToTile(state.TARGET_LON, state.TARGET_LAT, state.ZOOM);
    const gridSize = 3; 
    const offset = Math.floor(gridSize / 2);
    
    const tileSize = 256;
    const canvasSize = tileSize * gridSize;
    
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = canvasSize; colorCanvas.height = canvasSize;
    const colorCtx = colorCanvas.getContext('2d');
    
    const elevCanvas = document.createElement('canvas');
    elevCanvas.width = canvasSize; elevCanvas.height = canvasSize;
    const elevCtx = elevCanvas.getContext('2d', { willReadFrequently: true });

    const promises = [];
    for (let dy = -offset; dy <= offset; dy++) {
        for (let dx = -offset; dx <= offset; dx++) {
            const tx = centerTile.x + dx;
            const ty = centerTile.y + dy;
            const px = (dx + offset) * tileSize;
            const py = (dy + offset) * tileSize;

            const pElev = fetch(`https://api.maptiler.com/tiles/terrain-rgb-v2/${state.ZOOM}/${tx}/${ty}.png?key=${state.MK}`)
                .then(r => r.blob()).then(b => createImageBitmap(b))
                .then(img => elevCtx.drawImage(img, px, py, tileSize, tileSize));
                
            const pColor = fetch(`https://api.maptiler.com/maps/outdoor-v2/256/${state.ZOOM}/${tx}/${ty}@2x.png?key=${state.MK}`)
                .then(r => r.ok ? r.blob() : fetch(`https://api.maptiler.com/maps/outdoor-v2/256/${state.ZOOM}/${tx}/${ty}.png?key=${state.MK}`).then(r2 => r2.blob()))
                .then(b => createImageBitmap(b))
                .then(img => colorCtx.drawImage(img, px, py, tileSize, tileSize));
                
            promises.push(pElev, pColor);
        }
    }
    
    await Promise.all(promises);

    const imgData = elevCtx.getImageData(0, 0, canvasSize, canvasSize);
    const data = imgData.data;
    
    const heights = new Float32Array(canvasSize * canvasSize);
    let minH = Infinity;
    
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const h = -10000 + ((r * 65536 + g * 256 + b) * 0.1);
        heights[i / 4] = h;
        if (h < minH && h > -9000) minH = h;
    }

    const colorTex = new THREE.CanvasTexture(colorCanvas);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    if(state.renderer) colorTex.anisotropy = state.renderer.capabilities.getMaxAnisotropy();

    const planeSize = 20000; 
    const segments = 1024; 
    const geometry = new THREE.PlaneGeometry(planeSize, planeSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    
    // Fonction d'interpolation bilinéaire pour lisser les jointures de tuiles et les pentes
    function getElevationBilinear(u, v) {
        let x = u * (canvasSize - 1);
        let y = v * (canvasSize - 1);
        // Évite de sortir du tableau
        if (x < 0) x = 0; if (x >= canvasSize - 1) x = canvasSize - 1.001;
        if (y < 0) y = 0; if (y >= canvasSize - 1) y = canvasSize - 1.001;

        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        const wx = x - x0;
        const wy = y - y0;

        const h00 = heights[y0 * canvasSize + x0];
        const h10 = heights[y0 * canvasSize + x1];
        const h01 = heights[y1 * canvasSize + x0];
        const h11 = heights[y1 * canvasSize + x1];

        // Gérer les pixels manquants (océan/nodata)
        if (h00 < -9000 || h10 < -9000 || h01 < -9000 || h11 < -9000) return h00;

        // Interpolation
        return h00 * (1 - wx) * (1 - wy) +
               h10 * wx * (1 - wy) +
               h01 * (1 - wx) * wy +
               h11 * wx * wy;
    }

    for (let i = 0; i < positions.length; i += 3) {
        const u = (positions[i] / planeSize) + 0.5;
        const v = 1.0 - ((positions[i+2] / planeSize) + 0.5);
        
        const h = getElevationBilinear(u, v);
        positions[i+1] = h > -9000 ? h : minH; 
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        map: colorTex,
        roughness: 0.9,
        metalness: 0.0,
        flatShading: false
    });

    if (state.terrainMesh) state.scene.remove(state.terrainMesh);

    state.terrainMesh = new THREE.Mesh(geometry, material);
    state.terrainMesh.castShadow = true;
    state.terrainMesh.receiveShadow = true;
    state.terrainMesh.position.y = -minH;
    
    state.scene.add(state.terrainMesh);
    
    btn.textContent = "Recharger le relief";
}
