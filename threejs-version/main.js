import { state } from './src/modules/state.js';
import { initScene } from './src/modules/scene.js';
import { updateSunPosition } from './src/modules/sun.js';

initUI();

function initUI() {
    if (state.MK) document.getElementById('k1').value = state.MK;
    
    document.getElementById('bgo').addEventListener('click', () => {
        state.MK = document.getElementById('k1').value.trim();
        if (state.MK) {
            localStorage.setItem('maptiler_key_3d', state.MK);
            document.getElementById('setup-screen').style.display = 'none';
            document.getElementById('panel').style.display = 'block';
            initScene();
        }
    });

    const timeSlider = document.getElementById('time-slider');
    timeSlider.addEventListener('input', (e) => {
        updateSunPosition(e.target.value);
    });
}
