import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/OrbitControls.js';
import { state } from './state.js';
import { updateSunPosition } from './sun.js';
import { loadTerrain, updateVisibleTiles } from './terrain.js';
import { throttle } from './utils.js';

export async function initScene() {
    const container = document.getElementById('canvas-container');
    
    // 1. Scène et Brouillard
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x87CEEB);
    state.scene.fog = new THREE.FogExp2(0x87CEEB, 0.00004); 

    // 2. Moteur de rendu
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(state.renderer.domElement);

    // 3. Caméra et Contrôles "Type Carte" (MapControls)
    state.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 10, 100000);
    state.camera.position.set(0, 5000, 5000); // Départ un peu plus haut

    // MapControls inverse les boutons : Clic gauche = Déplacement (Pan), Clic droit = Rotation
    state.controls = new MapControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.05;
    state.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    state.controls.screenSpacePanning = false; // Mouvement de pan parallèle au sol (essentiel pour les cartes)
    state.controls.minDistance = 500; // Bloque le zoom avant pour ne pas traverser le sol
    state.controls.maxDistance = 40000; // Limite le dézoom

    // Constantes pour la conversion Mètres <-> Degrés
    state.initialLat = state.TARGET_LAT;
    state.initialLon = state.TARGET_LON;

    // Mise à jour des tuiles lors du mouvement panoramique
    const throttledUpdate = throttle(() => {
        const dx = state.controls.target.x;
        const dz = state.controls.target.z;

        const dLon = (dx / (111320 * Math.cos(state.initialLat * Math.PI / 180)));
        const dLat = -(dz / 111320); 

        state.TARGET_LON = state.initialLon + dLon;
        state.TARGET_LAT = state.initialLat + dLat;

        // Passe la distance de la caméra au sol pour adapter le rayon de chargement
        updateVisibleTiles(state.TARGET_LAT, state.TARGET_LON, state.controls.getDistance());
    }, 500);
    
    state.controls.addEventListener('change', throttledUpdate);

    // 4. Éclairage
    const ambientLight = new THREE.AmbientLight(0x404050, 0.4);
    state.scene.add(ambientLight);

    state.sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
    state.sunLight.castShadow = true;
    
    state.sunLight.shadow.mapSize.width = 4096;
    state.sunLight.shadow.mapSize.height = 4096;
    const d = 20000; // Étendu pour couvrir plus de tuiles
    state.sunLight.shadow.camera.left = -d;
    state.sunLight.shadow.camera.right = d;
    state.sunLight.shadow.camera.top = d;
    state.sunLight.shadow.camera.bottom = -d;
    state.sunLight.shadow.camera.near = 100;
    state.sunLight.shadow.camera.far = 50000;
    state.sunLight.shadow.bias = -0.0005;
    
    state.scene.add(state.sunLight);

    // 5. Chargement initial
    await loadTerrain();
    updateSunPosition(720); 

    // 6. Boucle d'animation
    window.addEventListener('resize', onWindowResize);
    state.renderer.setAnimationLoop(() => {
        state.controls.update();
        state.renderer.render(state.scene, state.camera);
    });
}

function onWindowResize() {
    if (state.camera && state.renderer) {
        state.camera.aspect = window.innerWidth / window.innerHeight;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
