// Kullanım çubukları (Cairo). Hap biçimli zemin; dolgu bu biçime kırpılır, böylece düşük yüzde
// sol başta yuvarlak bir top değil ince bir dilim olarak görünür. Kabukta (St.DrawingArea) ve
// düz gjs önizlemede aynı kod çalışır.

import Cairo from 'cairo';

// Temalar: "ok" bar rengi ve vurgu temaya göre; uyarı/kritik her temada aynı (anlamları değişmesin)
export const THEMES = {
    turuncu: {ok: ['#E8A383', '#D97757'], first: '#D97757', label: 'Turuncu tema'},
    mor: {ok: ['#C9B2FF', '#9D7BEA'], first: '#9D7BEA', label: 'Mor tema'},
};
export const LEVEL_COLORS = {warn: ['#F2C25B', '#E0912E'], crit: ['#F27D6E', '#D9433B']};

export const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

// Yuvarlatılmış dikdörtgen; r = h/2 ise hap biçimi
function pill(cr, w, h, r = h / 2) {
    r = Math.min(r, h / 2);
    cr.newSubPath();
    cr.arc(w - r, r, r, -Math.PI / 2, 0);
    cr.arc(w - r, h - r, r, 0, Math.PI / 2);
    cr.arc(r, h - r, r, Math.PI / 2, Math.PI);
    cr.arc(r, r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

// level: ok | warn | crit | off (veri bayatken soluk). radius: köşe yarıçapı (px), verilmezse hap biçimi.
// Panelde küçük yarıçap kullanılır: dar barda düşük yüzde yuvarlak uçta kaybolup nokta gibi görünmesin.
export function paintBar(cr, w, h, pct, level, theme, radius = h / 2) {
    pill(cr, w, h, radius);
    cr.setSourceRGBA(0.94, 0.93, 0.9, 0.13);
    if (!(pct > 0)) {
        cr.fill();
        return;
    }
    cr.fillPreserve();
    cr.clip();
    if (level === 'off') {
        cr.setSourceRGBA(0.94, 0.93, 0.9, 0.32);
    } else {
        const [a, b] = LEVEL_COLORS[level] ?? (THEMES[theme] ?? THEMES.turuncu).ok;
        const g = new Cairo.LinearGradient(0, 0, w, 0);
        g.addColorStopRGB(0, ...hexRgb(a));
        g.addColorStopRGB(1, ...hexRgb(b));
        cr.setSource(g);
    }
    cr.rectangle(0, 0, Math.max(1, Math.round(w * Math.min(100, pct) / 100)), h);
    cr.fill();
    cr.resetClip();
}

// parts: [{pct, color}] — parçalar arasında ince boşluk, uçlar hap biçiminde
export function paintSeg(cr, w, h, parts) {
    pill(cr, w, h);
    cr.clip();
    const total = parts.reduce((a, p) => a + p.pct, 0) || 1;
    const gap = Math.max(1, Math.round(h / 4.5));
    let x = 0;
    parts.forEach((p, i) => {
        const last = i === parts.length - 1;
        const sw = last ? w - x : Math.max(3, Math.round(p.pct / total * w));
        cr.setSourceRGB(...hexRgb(p.color));
        cr.rectangle(x, 0, Math.max(1, sw - (last ? 0 : gap)), h);
        cr.fill();
        x += sw;
    });
    cr.resetClip();
}
