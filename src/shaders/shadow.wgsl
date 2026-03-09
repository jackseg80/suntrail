struct Params { 
    gridSize: u32, 
    sunAzDeg: f32, 
    sunAltDeg: f32, 
    metersPerCellX: f32, 
    metersPerCellY: f32, 
    maxSteps: u32, 
}

@group(0) @binding(0) var<storage,read> elevGrid: array<f32>;
@group(0) @binding(1) var<storage,read_write> shadowMap: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn sampleBilinear(fx: f32, fy: f32, gs: u32) -> f32 {
    let x0 = u32(max(0.0, floor(fx)));
    let y0 = u32(max(0.0, floor(fy)));
    let x1 = min(x0 + 1u, gs - 1u);
    let y1 = min(y0 + 1u, gs - 1u);
    let wx = fx - floor(fx);
    let wy = fy - floor(fy);
    let e00 = elevGrid[y0 * gs + x0];
    let e10 = elevGrid[y0 * gs + x1];
    let e01 = elevGrid[y1 * gs + x0];
    let e11 = elevGrid[y1 * gs + x1];
    if (e00 < -9000.0 || e10 < -9000.0 || e01 < -9000.0 || e11 < -9000.0) {
        return elevGrid[u32(round(fy)) * gs + u32(round(fx))];
    }
    return e00 * (1.0 - wx) * (1.0 - wy) + e10 * wx * (1.0 - wy) + e01 * (1.0 - wx) * wy + e11 * wx * wy;
}

@compute @workgroup_size(256) 
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let gs = params.gridSize;
    if (idx >= gs * gs) { return; }
    
    let y = idx / gs;
    let x = idx % gs;
    let baseElev = elevGrid[idx];
    if (baseElev < -9000.0) { shadowMap[idx] = 0u; return; }
    
    let PI: f32 = 3.14159265;
    let sunAzRad = params.sunAzDeg * PI / 180.0;
    let sunAltRad = params.sunAltDeg * PI / 180.0;
    let sunRadius: f32 = 0.00465;
    
    let rawDx = sin(sunAzRad) / params.metersPerCellX;
    let rawDy = -cos(sunAzRad) / params.metersPerCellY;
    let mc = max(abs(rawDx), abs(rawDy));
    let dx = rawDx / mc;
    let dy = rawDy / mc;
    let stepDist = sqrt((dx * params.metersPerCellX) * (dx * params.metersPerCellX) + (dy * params.metersPerCellY) * (dy * params.metersPerCellY));
    let effectiveR: f32 = 7433000.0;
    
    var maxHA: f32 = -1.5708;
    let sunTop = sunAltRad + sunRadius;
    
    for (var s: u32 = 1u; s <= params.maxSteps; s = s + 1u) {
        let sf = f32(s);
        let fx = f32(x) + dx * sf;
        let fy = f32(y) + dy * sf;
        if (fx < 0.0 || fx >= f32(gs) - 1.0 || fy < 0.0 || fy >= f32(gs) - 1.0) { break; }
        let se = sampleBilinear(fx, fy, gs);
        if (se < -9000.0) { continue; }
        let dist = sf * stepDist;
        let cd = (dist * dist) / (2.0 * effectiveR);
        let angle = atan2(se - cd - baseElev, dist);
        if (angle > maxHA) { maxHA = angle; }
        if (maxHA > sunTop + 0.02) { break; }
    }
    
    let sunBot = sunAltRad - sunRadius;
    var val: f32 = 0.0;
    if (maxHA >= sunTop) { 
        val = 1.0; 
    } else if (maxHA > sunBot) { 
        val = (maxHA - sunBot) / (sunTop - sunBot); 
    }
    
    shadowMap[idx] = u32(round(val * 255.0));
}
