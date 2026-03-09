export const state = {
    MK: localStorage.getItem('maptiler_key') || '',
    WK: localStorage.getItem('owm_key') || '',
    SWISS: [7.45, 46.75],
    SUN_R: 5000,
    map: null,
    curDate: new Date(),
    sunTimes: {},
    weatherData: null,
    wxTimer: null,
    
    pathCK: '',
    pathCD: null,
    compCK: '',
    compCD: null,
    
    cachedGrid: null,
    cachedBounds: null,
    cachedViewport: null,
    cachedGS: 0,
    cachedElevRange: null,
    
    cpuWorker: null,
    shadowPending: false,
    
    gpuDevice: null,
    gpuAvailable: false,
    gpuName: ''
};
