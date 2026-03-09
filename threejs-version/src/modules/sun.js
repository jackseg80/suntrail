import SunCalc from 'suncalc';
import { state } from './state.js';

export function updateSunPosition(minutes) {
    if (!state.sunLight) return;
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    document.getElementById('time-disp').textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    
    const now = new Date();
    // Calcul de l'heure solaire locale exacte basée sur la longitude de la montagne regardée (1h = 15 degrés)
    const offsetHours = state.TARGET_LON / 15;
    const utcTimestamp = (hours - offsetHours) * 3600000 + (mins * 60000);
    
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    date.setTime(date.getTime() + utcTimestamp);
    
    const pos = SunCalc.getPosition(date, state.TARGET_LAT, state.TARGET_LON);
    const az = pos.azimuth; // 0 = Sud, Positif = Ouest, Négatif = Est
    const alt = pos.altitude;
    
    document.getElementById('az-disp').textContent = ((az * 180 / Math.PI) + 180).toFixed(1);
    document.getElementById('alt-disp').textContent = (alt * 180 / Math.PI).toFixed(1);
    
    if (alt < 0) {
        state.sunLight.intensity = 0;
        state.scene.background.setHex(0x050510);
        state.scene.fog.color.setHex(0x050510);
    } else {
        state.sunLight.intensity = Math.max(0, Math.sin(alt) * 2.5);
        
        if (alt < 0.2) {
            state.scene.background.setHex(0xff7b00);
            state.scene.fog.color.setHex(0xff7b00);
            state.sunLight.color.setHex(0xffa500);
        } else {
            state.scene.background.setHex(0x87CEEB);
            state.scene.fog.color.setHex(0x87CEEB);
            state.sunLight.color.setHex(0xffffff);
        }
        
        const distance = 20000;
        const phi = alt;
        
        // Correction des axes Three.js: +Z = Sud, -Z = Nord, +X = Est, -X = Ouest
        state.sunLight.position.x = distance * Math.cos(phi) * -Math.sin(az);
        state.sunLight.position.y = distance * Math.sin(phi);
        state.sunLight.position.z = distance * Math.cos(phi) * Math.cos(az);
    }
}
