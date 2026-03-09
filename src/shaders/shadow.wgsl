struct Params { 
    gridSize: u32, 
    sunAzDeg: f32, 
    sunAltDeg: f32, 
    maxSteps: u32, 
    baseMpcX: f32,
    baseMpcY: f32,
    gridNorthMercY: f32,
    gridSouthMercY: f32,
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
    
    for (var pIdx: u32 = 0u; pIdx < 4u; pIdx = pIdx + 1u) {
        let idx = baseIdx + pIdx;
        let y = idx / gs;
        let x = idx % gs;
        
        let baseElev = elevGrid[idx];
        if (baseElev < -9000.0) { continue; }
        
        // Exact physical distances taking aspect ratio into account
        let mercY = params.gridNorthMercY - (f32(y) / f32(gs)) * (params.gridNorthMercY - params.gridSouthMercY);
        let latRad = 2.0 * atan(exp(mercY)) - 1.57079632679;
        let cosLat = cos(latRad);
        
        let mpcX = params.baseMpcX * cosLat;
        let mpcY = params.baseMpcY * cosLat;
        
        let rawDx = sin(sunAzRad) / mpcX;
        let rawDy = -cos(sunAzRad) / mpcY;
        let mc = max(abs(rawDx), abs(rawDy));
        let dx = rawDx / mc;
        let dy = rawDy / mc;
        let stepDist = sqrt((dx * mpcX) * (dx * mpcX) + (dy * mpcY) * (dy * mpcY));
        
        var maxHA: f32 = -1.5708;
        let sunTop = sunAltRad + sunRadius;
        
        // 1. Ray-Marching (Ombres portées lointaines)
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
        
        // 2. Self-Shadowing (Ombrage propre des pentes opposées)
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
            let dzdy = (eD - eU) / (f32(r) * 2.0 * mpcY);
            let slopeMag = sqrt(dzdx * dzdx + dzdy * dzdy);
            
            // On traite toutes les pentes supérieures à 1 degré
            if (slopeMag < 0.02) { continue; }
            
            let nx = -dzdx;
            let ny = -dzdy;
            let nz = 1.0;
            let nLen = sqrt(nx * nx + ny * ny + nz * nz);
            let cosA = (nx * sdx + ny * sdy + nz * sdz) / nLen;
            
            // Modèle de décrochage de lumière (Soft Terminator)
            var sh: f32 = clamp(0.5 - (cosA / 0.05), 0.0, 1.0);
            
            if (sh > bestSelf) { bestSelf = sh; }
            if (bestSelf >= 1.0) { break; }
        }
        
        let finalVal = max(val, bestSelf);
        let shadowByte = u32(round(finalVal * 255.0));
        packed = packed | (shadowByte << (pIdx * 8u));
    }
    
    shadowMap[gid.x] = packed;
}