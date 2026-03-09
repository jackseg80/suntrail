export function throttle(fn, ms) {
    let last = 0, t = null;
    return (...a) => {
        const now = Date.now();
        clearTimeout(t);
        if (now - last >= ms) {
            last = now;
            fn(...a);
        } else {
            t = setTimeout(() => {
                last = Date.now();
                fn(...a);
            }, ms - (now - last));
        }
    }
}

// Calcule la destination à partir d'un point (lat, lng), d'un azimut (b) et d'une distance (d)
export function dest(lat, lng, b, d) {
    const R = 6371000, dr = d / R, br = b * Math.PI / 180, la = lat * Math.PI / 180, lo = lng * Math.PI / 180;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
    const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return [lo2 * 180 / Math.PI, la2 * 180 / Math.PI];
}

// Interpolation linéaire entre deux couleurs hex ou rgb
export function lerp(a, b, t) {
    const p = c => {
        if (c[0] === '#') {
            const h = parseInt(c.slice(1), 16);
            return [(h >> 16) & 0xFF, (h >> 8) & 0xFF, h & 0xFF];
        }
        const m = c.match(/\d+/g);
        return m ? [+m[0], +m[1], +m[2]] : [255, 255, 255];
    };
    const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
    return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

export function fmtT(d) {
    return d && !isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
}

export function fmtISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
