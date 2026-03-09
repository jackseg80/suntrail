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

export function dest(lat, lng, b, d) {
    const R = 6371000, dr = d / R, br = b * Math.PI / 180, la = lat * Math.PI / 180, lo = lng * Math.PI / 180;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
    const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return [lo2 * 180 / Math.PI, la2 * 180 / Math.PI];
}

export function fmtT(d) {
    return d && !isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
}

export function fmtISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
