import { initUI } from './modules/ui.js';
import { initWeather } from './modules/weather.js';
import { initWebGPU } from './modules/shadows.js';
import './style.css'; // S'assure que Vite charge le CSS

window.addEventListener('load', async function() {
    // Initialisation asynchrone du WebGPU avant tout le reste
    await initWebGPU();
    
    // Initialisation du canvas météo
    initWeather();
    
    // Initialisation de l'interface et de la carte
    initUI();
});
