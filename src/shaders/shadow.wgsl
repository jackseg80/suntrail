struct Params { 
    gridSize: u32, 
    sunAzDeg: f32, 
    sunAltDeg: f32, 
    mpcY: f32, 
    maxSteps: u32, 
    gridWidthLon: f32,
    gridNorthLat: f32,
    gridSouthLat: f32,
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

// Optimization #3 : Dispatch 4x fewer threads. Each thread computes 4 pixels and packs them.
@compute @workgroup_size(256) 
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let baseIdx = gid.x * 4u;
    let gs = params.gridSize;
    if (baseIdx >= gs * gs) { return; }
    
    let PI: f32 = 3.14159265;
    let sunAzRad = params.sunAzDeg * PI / 180.0;
    let sunAltRad = params.sunAltDeg * PI / 180.0;
    let sunRadius: f32 = 0.00465;
    let effectiveR: f32 = 7433000.0;
    
    let cosAltD = cos(sunAltRad);
    let sinAltD = sin(sunAltRad);
    let sdx = sin(sunAzRad) * cosAltD;
    let sdy = -cos(sunAzRad) * cosAltD;
    let sdz = sinAltD;
    let radii = array<u32, 3>(4u, 8u, 14u);

    var packed: u32 = 0u;
    
    // Process 4 pixels per thread
    for (var pIdx: u32 = 0u; pIdx < 4u; pIdx = pIdx + 1u) {
        let idx = baseIdx + pIdx;
        let y = idx / gs;
        let x = idx % gs;
        
        let baseElev = elevGrid[idx];
        if (baseElev < -9000.0) { 
            continue; // Leaves the byte as 0u (sunlight / no shadow)
        }
        
        // Optimization #2 : Dynamic Mercator Scale per latitude row
        let latDeg = params.gridNorthLat - (f32(y) / f32(gs)) * (params.gridNorthLat - params.gridSouthLat);
        let mpcX = (params.gridWidthLon * 111320.0 * cos(latDeg * PI / 180.0)) / f32(gs);
        
        let rawDx = sin(sunAzRad) / mpcX;
        let rawDy = -cos(sunAzRad) / params.mpcY;
        let mc = max(abs(rawDx), abs(rawDy));
        let dx = rawDx / mc;
        let dy = rawDy / mc;
        let stepDist = sqrt((dx * mpcX) * (dx * mpcX) + (dy * params.mpcY) * (dy * params.mpcY));
        
        var maxHA: f32 = -1.5708;
        let sunTop = sunAltRad + sunRadius;
        
        // 1. Ray Marching (Global shadows from mountains)
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
        
        // 2. Optimization #1 : Self-Shadowing natively in WGSL
        var bestSelf: f32 = 0.0;
        for (var i: u32 = 0u; i < 3u; i = i + 1u) {
            let r = radii[i];
            if (x < r || x >= gs - r || y < r || y >= gs - r) { continue; }
            
            let eL = elevGrid[y * gs + (x - r)];
            let eR = elevGrid[y * gs + (x + r)];
            let eU = elevGrid[(y - r) * gs + x];
            let eD = elevGrid[(y + r) * gs + x];
            
            if (eL < -9000.0 || eR < -9000.0 || eU < -9000.0 || eD < -9000.0) { continue; }
            
            let dzdx = (eR - eL) / (f32(r) * 2.0 * mpcX);
            let dzdy = (eD - eU) / (f32(r) * 2.0 * params.mpcY);
            let slopeMag = sqrt(dzdx * dzdx + dzdy * dzdy);
            if (slopeMag < 0.12) { continue; } // Flat enough, skip
            
            let nx = -dzdx;
            let ny = -dzdy;
            let nz = 1.0;
            let nLen = sqrt(nx * nx + ny * ny + nz * nz);
            let cosA = (nx * sdx + ny * sdy + nz * sdz) / nLen;
            
            var sh: f32 = 0.0;
            if (cosA <= 0.0) { sh = 1.0; }
            else if (cosA >= 0.35) { sh = 0.0; }
            else if (cosA <= 0.15) { sh = 1.0; }
            else { sh = (0.35 - cosA) / 0.20; }
            
            if (sh > bestSelf) { bestSelf = sh; }
            if (bestSelf >= 1.0) { break; }
        }
        
        // Final composite and binary packing
        let finalVal = max(val, bestSelf);
        let shadowByte = u32(round(finalVal * 255.0));
        
        // Shift bits into correct byte slot (0, 8, 16, 24)
        packed = packed | (shadowByte << (pIdx * 8u));
    }
    
    shadowMap[gid.x] = packed;
}