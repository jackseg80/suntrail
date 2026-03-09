export const state = {
    MK: localStorage.getItem('maptiler_key_3d') || '',
    TARGET_LAT: 45.8326, // Mont Blanc par défaut
    TARGET_LON: 6.8652,
    ZOOM: 13, // HD Zoom
    
    // Three.js instances
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    sunLight: null,
    terrainMesh: null
};
