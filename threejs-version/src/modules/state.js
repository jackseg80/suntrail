export const state = {
    MK: localStorage.getItem('maptiler_key_3d') || '',
    TARGET_LAT: 45.8326, // Mont Blanc par défaut
    TARGET_LON: 6.8652,
    ZOOM: 13, // HD Zoom
    
    // Position initiale pour le repère 3D (évite les superpositions)
    initialLat: 45.8326,
    initialLon: 6.8652,
    originTile: { x: 0, y: 0 },
    
    // Three.js instances
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    sunLight: null,
    terrainMesh: null
};
