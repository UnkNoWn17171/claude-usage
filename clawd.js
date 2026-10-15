// Clawd — Claude Code'un maskotu, sürekli bir şeylerle uğraşan hâli.
// Koordinatlar zotero-hoca'daki clawd.js ile aynı: gövde x 3…15, y 0…8; kollar y 4…6; bacaklar y 8…10
// (terminal pikseli dikdörtgen olduğu için bir ızgara satırı 2 birim). Sahne x 0…34, y −3.5…10.5:
// Clawd solda, eşyalar sağında (x 18…33). Panelde 1 birim = 2 px (68×28), menüde 4 px.
// Gözler gövdeden delinir (CLEAR), arkadaki panel/menü rengi gözlerden görünür.
// Hem kabukta (St.DrawingArea) hem düz gjs önizleme betiğinde çalışır.

import Cairo from 'cairo';

export const STAGE = {w: 34, top: -3.5, h: 14};
export const FRAME_MS = 125;
const SLEEP_FRAME_MS = 500;

const COL = {
    body: '#D97757', hot: '#E0614F', sleepy: '#B98A78',
    ink: '#2A2725', metal: '#AEB4BC', metal2: '#6E747C', screen: '#15222F',
    paper: '#F0EEE6', print: '#77726B', accent: '#EE9A74',
    blue: '#6FA8DC', green: '#7CC67C', yellow: '#F2C25B', red: '#E5534B',
    cloud: '#CFD8E3', coffee: '#7A4B2A', steam: '#E8E8E8', glow: '#9CC8FF',
    glass: '#BFE3FF', duck: '#F7D348', duckDark: '#E2B92C', duckBill: '#F08A24',
    flame: '#F7A541', drop: '#8EC5FF', zzz: '#D6D0C4',
};
const RGB = {};
for (const [k, hex] of Object.entries(COL))
    RGB[k] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

const FONT = {
    0: ['###', '#.#', '#.#', '#.#', '###'],
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    Z: ['#####', '...#.', '..#..', '.#...', '#####'],
    X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};
const GLASS = ['.###.', '#####', '#####', '#####', '.###.'];

// Kare bazlı tekrarlanabilir rastgelelik (aynı karede aynı tuş yanar)
function hash(a, b = 0) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hop = (p, a, b, h = 1.5) => p > a && p < b ? -h * Math.sin(Math.PI * (p - a) / (b - a)) : 0;
const typing = f => ({armL: f % 2 ? -0.6 : 0, armR: f % 2 ? 0 : -0.6});
const clamp01 = v => Math.max(0, Math.min(1, v));

// Birim koordinatlarla çizer; kenarlar piksele yuvarlanır ki küçükken de keskin kalsın.
class Painter {
    constructor(cr, u, ox, oy) {
        this.cr = cr;
        this.u = u;
        this.ox = ox;
        this.oy = oy;
        this._t = {dx: 0, dy: 0, s: 1};
        this._stack = [];
    }

    push(dx, dy, s = 1) {
        this._stack.push(this._t);
        const t = this._t;
        this._t = {dx: t.dx + dx * t.s, dy: t.dy + dy * t.s, s: t.s * s};
    }

    pop() {
        this._t = this._stack.pop();
    }

    _px(x, y) {
        const t = this._t;
        return [this.ox + (t.dx + x * t.s) * this.u, this.oy + (t.dy + y * t.s) * this.u];
    }

    _color(c, a) {
        const [r, g, b] = RGB[c] ?? RGB.paper;
        this.cr.setSourceRGBA(r, g, b, a);
    }

    rect(x, y, w, h, c, a = 1) {
        if (a <= 0)
            return;
        const [x0, y0] = this._px(x, y).map(Math.round);
        const [x1, y1] = this._px(x + w, y + h).map(Math.round);
        this._color(c, a);
        this.cr.rectangle(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        this.cr.fill();
    }

    rs(list, c, a = 1) {
        for (const [x, y, w, h] of list)
            this.rect(x, y, w, h, c, a);
    }

    clear(x, y, w, h) {
        this.cr.setOperator(Cairo.Operator.CLEAR);
        this.rect(x, y, w, h, 'paper');
        this.cr.setOperator(Cairo.Operator.OVER);
    }

    line(x1, y1, x2, y2, c, a = 1, w = 0.3) {
        const [ax, ay] = this._px(x1, y1);
        const [bx, by] = this._px(x2, y2);
        this._color(c, a);
        this.cr.setLineWidth(Math.max(1, w * this.u * this._t.s));
        this.cr.setLineCap(Cairo.LineCap.BUTT);
        this.cr.moveTo(ax, ay);
        this.cr.lineTo(bx, by);
        this.cr.stroke();
    }

    bits(rows, x, y, s, c, a = 1) {
        rows.forEach((row, j) => {
            for (let i = 0; i < row.length;) {
                if (row[i] !== '#') {
                    i++;
                    continue;
                }
                let k = i;
                while (row[k] === '#')
                    k++;
                this.rect(x + i * s, y + j * s, (k - i) * s, s, c, a);
                i = k;
            }
        });
    }
}

// ---- Ortak eşyalar
function check(P, x, y) {
    P.rs([[x, y + 1, 0.8, 0.8], [x + 0.8, y + 1.8, 0.8, 0.8], [x + 1.6, y + 1, 0.8, 0.8],
        [x + 2.4, y + 0.2, 0.8, 0.8], [x + 3.2, y - 0.6, 0.8, 0.8]], 'green');
}

function monitor(P) {
    P.rect(18.6, -1.2, 9.4, 7.2, 'metal2');
    P.rect(19.2, -0.6, 8.2, 6, 'screen');
    P.rect(22.7, 6, 1.4, 2.8, 'metal2');
    P.rect(21.2, 8.8, 4.4, 1.2, 'metal2');
}

function cursor(P, x, y) {
    P.rs([[x, y, 0.7, 3.2], [x + 0.7, y + 0.7, 0.7, 2.2], [x + 1.4, y + 1.4, 0.7, 1.2],
        [x + 2.1, y + 2.1, 0.7, 0.5], [x + 1.1, y + 2.9, 0.6, 1.2]], 'paper');
}

function ring(P, x, y, s, c) {
    P.rs([[x, y, s, 0.3], [x, y + s - 0.3, s, 0.3], [x, y, 0.3, s], [x + s - 0.3, y, 0.3, s]], c);
}

function bug(P, x, f, flipped) {
    const legY = flipped ? 8.1 : 9.7;
    const step = flipped ? 0 : (f % 2) * 0.3;
    P.rs([[x + 0.1 + step, legY, 0.3, 0.3], [x + 0.9 + step, legY, 0.3, 0.3], [x + 1.7 + step, legY, 0.3, 0.3]], 'metal');
    P.rect(x, 8.4, 2.4, 1.3, 'red');
    P.rect(x - 0.6, 8.7, 0.7, 0.8, 'metal2');
    P.rs([[x + 0.6, 8.6, 0.5, 0.4], [x + 1.5, 8.9, 0.5, 0.4]], 'ink');
}

function bolt(P, x, y) {
    P.rs([[x + 1, y, 1, 1], [x + 0.5, y + 1, 1, 1], [x, y + 2, 2.2, 0.7], [x + 1, y + 2.7, 1, 1], [x + 0.5, y + 3.7, 1, 0.8]], 'yellow');
}

function note(P, x, y) {
    P.rect(x + 0.9, y - 2.4, 0.5, 2.4, 'accent');
    P.rect(x, y - 0.6, 1.3, 1, 'accent');
    P.rect(x + 0.9, y - 2.4, 1, 0.6, 'accent');
}

function gear(P, cx, cy, f, spinning) {
    P.rect(cx - 1.3, cy - 1.3, 2.6, 2.6, 'metal');
    if (!spinning || f % 2 === 0)
        P.rs([[cx - 0.5, cy - 2.1, 1, 0.8], [cx - 0.5, cy + 1.3, 1, 0.8], [cx - 2.1, cy - 0.5, 0.8, 1], [cx + 1.3, cy - 0.5, 0.8, 1]], 'metal');
    else
        P.rs([[cx - 2, cy - 2, 0.9, 0.9], [cx + 1.1, cy - 2, 0.9, 0.9], [cx - 2, cy + 1.1, 0.9, 0.9], [cx + 1.1, cy + 1.1, 0.9, 0.9]], 'metal');
    P.rect(cx - 0.4, cy - 0.4, 0.8, 0.8, 'screen');
}

// Claude'un yıldız logosu: dönen ışınlar
function spark(P, cx, cy, r, f, c) {
    for (let k = 0; k < 8; k++) {
        const a = (k * 45 + f * 11.25) * Math.PI / 180;
        const len = k % 2 ? r * 0.65 : r;
        P.line(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, c, 1, 0.9);
    }
}

const GIT = [
    [2, -3, 14, 0.5, 'blue', 0], [1.3, -3.45, 1.4, 1.4, 'blue', 0], [4.3, -3.45, 1.4, 1.4, 'blue', 1],
    [4.75, -5.85, 0.5, 2.9, 'accent', 2], [5, -5.85, 3, 0.5, 'accent', 3], [7.3, -6.3, 1.4, 1.4, 'accent', 3],
    [8, -5.85, 2.5, 0.5, 'accent', 4], [9.8, -6.3, 1.4, 1.4, 'accent', 4], [10.5, -5.85, 2.75, 0.5, 'accent', 5],
    [12.75, -5.85, 0.5, 2.9, 'accent', 5], [12.2, -3.65, 1.8, 1.8, 'green', 6], [15.3, -3.45, 1.4, 1.4, 'blue', 7],
];
const WIFI = [
    [[8.5, -2.4, 1, 1]],
    [[7, -3.8, 1, 0.8], [8, -4.4, 2, 0.8], [10, -3.8, 1, 0.8]],
    [[5.4, -4.8, 1, 0.8], [6.4, -5.6, 1.2, 0.8], [7.6, -6.1, 2.8, 0.8], [10.4, -5.6, 1.2, 0.8], [11.6, -4.8, 1, 0.8]],
    [[3.8, -5.8, 1, 0.8], [4.8, -6.8, 1.4, 0.8], [6.2, -7.5, 1.6, 0.8], [7.8, -7.8, 2.4, 0.8],
        [10.2, -7.5, 1.6, 0.8], [11.8, -6.8, 1.4, 0.8], [13.2, -5.8, 1, 0.8]],
];
const POWER = [[7.6, -6.2, 0.8, 0.6], [9.6, -6.2, 0.8, 0.6], [6.8, -5.6, 0.8, 0.8], [10.4, -5.6, 0.8, 0.8],
    [6.4, -4.8, 0.7, 1.4], [10.9, -4.8, 0.7, 1.4], [6.8, -3.4, 0.8, 0.8], [10.4, -3.4, 0.8, 0.8],
    [7.6, -2.6, 2.8, 0.6], [8.6, -7, 0.8, 2.6]];

/*
 * Hareketler (29, hepsi bilgisayar / kod / yapay zekâ). side: eşya sağda → Clawd sahnenin solunda durur.
 * pose(t, f, p): Clawd'ın duruşu; back/front: gövdenin arkasına/önüne çizilenler.
 * t = hareketin başından beri ms, f = kare (125 ms), p = 0…1 ilerleme.
 */
export const ACTS = {
    laptop: {
        ms: 4200,
        pose: (t, f) => ({eyes: 'down', glow: true, ...typing(f)}),
        front: (P, t, f) => {
            P.rect(3.5, 4.4, 11, 4.6, 'metal');
            P.rect(3.5, 4.4, 11, 0.5, 'metal2');
            P.rs([[8.6, 5.9, 0.8, 2], [7.9, 6.5, 2.2, 0.8]], f % 8 < 6 ? 'accent' : 'paper');
            P.rect(2, 9, 14, 1, 'metal2');
            for (let i = 0; i < 3; i++) {
                if (hash(f, i) > 0.5)
                    P.rect(4.5 + i * 3.5, 9.3, 1.2, 0.4, 'paper');
            }
        },
    },
    code: {
        ms: 4400, side: true,
        pose: (t, f) => ({eyes: 'right', ...typing(f)}),
        back: (P, t, f, p) => {
            monitor(P);
            const lines = [[19.8, 0.1, 3.6, 'accent'], [20.6, 1.2, 4.6, 'blue'], [20.6, 2.3, 2.8, 'green'],
                [19.8, 3.4, 5.4, 'yellow'], [20.6, 4.5, 3.2, 'paper']];
            const typed = Math.floor(Math.min(1, p * 1.25) * 24.5) * 0.8;
            let acc = 0, cx = 19.8, cy = 0.1;
            for (const [x, y, w, c] of lines) {
                const lw = Math.max(0, Math.min(w, typed - acc));
                if (lw > 0) {
                    P.rect(x, y, lw, 0.7, c);
                    cx = x + lw;
                    cy = y;
                }
                acc += w;
            }
            if (f % 4 < 2)
                P.rect(cx + 0.2, cy - 0.1, 0.5, 0.9, 'paper');
        },
    },
    terminal: {
        ms: 4600, side: true,
        pose: (t, f, p) => ({eyes: 'right', ...(p < 0.5 ? typing(f) : {})}),
        back: (P, t, f, p) => {
            P.rect(18.4, -3, 14.2, 8.8, 'metal2');
            P.rect(18.8, -1.6, 13.4, 7, 'screen');
            P.rect(19.1, -2.6, 0.6, 0.6, 'red');
            P.rect(20, -2.6, 0.6, 0.6, 'yellow');
            P.rect(20.9, -2.6, 0.6, 0.6, 'green');
            P.rs([[19.3, -1, 0.5, 0.5], [19.8, -0.5, 0.5, 0.5], [19.3, 0, 0.5, 0.5]], 'green');
            const w = Math.min(8, Math.floor(p / 0.5 * 10) * 0.8);
            if (w > 0)
                P.rect(20.8, -0.9, w, 0.7, 'paper');
            if (p < 0.55 && f % 4 < 2)
                P.rect(21 + w, -1, 0.6, 0.9, 'paper');
            [[19.3, 1.2, 9.5, 'metal'], [19.3, 2.3, 6.5, 'metal'], [19.3, 3.4, 8, 'green']].forEach(([x, y, ow, c], i) => {
                if (p > 0.55 + i * 0.1)
                    P.rect(x, y, ow, 0.6, c);
            });
            if (p > 0.9 && f % 4 < 2)
                P.rect(19.3, 4.5, 0.6, 0.8, 'paper');
        },
    },
    debug: {
        ms: 4400, side: true,
        pose: (t, f, p) => p < 0.45 ? {eyes: 'right'}
            : p < 0.62 ? {eyes: 'wide', raiseR: true}
                : {eyes: 'happy', dy: hop(p, 0.68, 0.84, 1.4)},
        back: (P, t, f, p) => {
            const bx = p < 0.45 ? 31 - p / 0.45 * 10 : 21;
            if (p < 0.85)
                bug(P, bx, f, p >= 0.6);
            if (p >= 0.45 && p < 0.6 && f % 2) {
                const z = [[17, -2.4], [19, 1.5], [18.2, 2.6], [20.4, 5.8], [19.6, 6.4], [21.2, 8.4]];
                for (let i = 0; i < z.length - 1; i++)
                    P.line(z[i][0], z[i][1], z[i + 1][0], z[i + 1][1], 'yellow', 1, 0.5);
            }
            if (p >= 0.66)
                check(P, 21, 3.5);
        },
    },
    compile: {
        ms: 4000, side: true,
        pose: (t, f, p) => p < 0.8 ? {eyes: 'right'} : {eyes: 'happy', dy: hop(p, 0.82, 0.96, 1.2)},
        back: (P, t, f, p) => {
            gear(P, 20.8, 2.4, f, p < 0.8);
            P.rect(23.6, 1.2, 9.4, 2.6, 'metal2');
            P.rect(24, 1.6, 8.6, 1.8, 'screen');
            const fill = Math.min(1, p / 0.78);
            const fw = Math.floor(fill * 10) / 10 * 8.6;
            if (fw > 0)
                P.rect(24, 1.6, fw, 1.8, fill >= 1 ? 'green' : 'accent');
            if (p > 0.8)
                check(P, 26.6, -2.6);
        },
    },
    coffee: {
        ms: 4200,
        pose: (t, f, p) => {
            const sip = p > 0.4 && p < 0.72;
            return {eyes: sip ? 'closed' : 'open', armR: sip ? -3 : -1};
        },
        front: (P, t, f, p) => {
            const sip = p > 0.4 && p < 0.72;
            const y = 2.4 + (sip ? -1.6 : 0);
            P.rect(15.8, y, 2.8, 3.2, 'paper');
            P.rect(15.8, y, 2.8, 0.6, 'coffee');
            P.rs([[18.6, y + 0.8, 0.8, 0.4], [19.0, y + 0.8, 0.4, 1.6], [18.6, y + 2, 0.8, 0.4]], 'paper');
            if (!sip) {
                P.rect(16.3, y - 1.4 - (f % 3) * 0.4, 0.5, 1.1, 'steam', 0.6);
                P.rect(17.4, y - 2.2 + (f % 3) * 0.3, 0.5, 1.1, 'steam', 0.45);
            }
        },
    },
    keyboard: {
        ms: 3800,
        pose: (t, f) => ({eyes: 'down', ...typing(f)}),
        front: (P, t, f) => {
            P.rect(0.6, 8.4, 16.8, 1.8, 'metal2');
            P.rect(0.9, 8.6, 16.2, 1.2, 'metal');
            for (let i = 0; i < 8; i++)
                P.rect(1.4 + i * 2, 8.8, 1.2, 0.5, hash(f, i) > 0.72 ? 'accent' : 'paper');
        },
    },
    mouse: {
        ms: 4000, side: true,
        pose: () => ({eyes: 'right', armR: 1.6}),
        back: (P, t, f, p) => {
            const pts = [[22, 0], [29, 2], [24.5, 5], [30, -1.5], [22, 0]];
            const pos = p * (pts.length - 1);
            const seg = Math.min(pts.length - 2, Math.floor(pos));
            const lp = pos - seg;
            const k = Math.min(1, lp / 0.6);
            const [x0, y0] = pts[seg], [x1, y1] = pts[seg + 1];
            const mx = x0 + (x1 - x0) * k, my = y0 + (y1 - y0) * k;
            const clicking = lp > 0.7;
            if (clicking)
                ring(P, mx - 1, my - 1, 2.2, 'accent');
            cursor(P, mx, my);
            P.rect(17.6, 8.2, 2.8, 1.8, 'metal2');
            P.rect(17.9, 8.5, 2.2, 1.5, 'paper');
            P.rect(18.9, 8.5, 0.25, 0.8, 'metal2');
            if (clicking)
                P.rect(17.9, 8.5, 1, 0.8, 'accent');
            P.rect(20.4, 9.2, 1.6, 0.3, 'metal2');
        },
    },
    git: {
        ms: 4400, side: true,
        pose: (t, f, p) => ({eyes: p > 0.85 ? 'happy' : 'right', dy: hop(p, 0.86, 0.98, 1)}),
        back: (P, t, f, p) => {
            P.push(17, 8.4);
            for (const [x, y, w, h, c, i] of GIT) {
                if (p * 9.5 > i)
                    P.rect(x, y, w, h, c);
            }
            P.pop();
        },
    },
    neural: {
        ms: 4400, side: true,
        pose: () => ({eyes: 'upright'}),
        back: (P, t, f, p) => {
            const L = [[20, [1.4, 4.4, 7.4]], [25.6, [0, 3, 6, 9]], [31.2, [2.6, 5.8]]];
            for (let a = 0; a < 2; a++) {
                for (const y1 of L[a][1]) {
                    for (const y2 of L[a + 1][1])
                        P.line(L[a][0], y1, L[a + 1][0], y2, 'metal2', 0.5, 0.22);
                }
            }
            const lit = Math.floor(p * 9) % 4;
            L.forEach(([x, ys], i) => ys.forEach(y =>
                P.rect(x - 0.7, y - 0.7, 1.4, 1.4, i === lit || (lit === 3 && i === 2) ? 'accent' : 'metal2')));
        },
    },
    think: {
        ms: 4000, side: true,
        pose: () => ({eyes: 'up'}),
        back: (P, t, f) => {
            spark(P, 25.5, 3.5, 3.2 + (f % 4 === 0 ? 0.4 : 0), f, 'accent');
            for (let i = 0; i < 3; i++) {
                if ((f >> 1) % 4 > i)
                    P.rect(6 + i * 3, -2.6, 1, 1, 'paper');
            }
        },
    },
    binary: {
        ms: 3800, side: true,
        pose: () => ({eyes: 'right'}),
        back: (P, t, f) => {
            [19, 22, 25, 28, 31].forEach((x, c) => {
                const speed = 0.6 + hash(c, 7) * 0.6;
                for (let k = 0; k < 3; k++) {
                    const run = f * speed + k * 5 + hash(c, 3) * 14;
                    const y = (run % 15) - 3.5;
                    const d = hash(c * 31 + k, Math.floor(run / 15)) > 0.5 ? '1' : '0';
                    P.bits(FONT[d], x, y, 0.45, k === 0 ? 'paper' : 'green', k === 0 ? 1 : 0.8);
                }
            });
        },
    },
    upload: {
        ms: 3800, side: true,
        pose: () => ({eyes: 'upright'}),
        back: (P, t, f, p) => {
            P.rs([[20.6, -1.4, 10, 2.6], [22, -2.8, 3.8, 1.4], [25.8, -2.2, 2.8, 0.8], [19.8, -0.2, 11.6, 1.6]], 'cloud');
            const ay = 8 - ((f * 0.7) % 7);
            if (ay > 1.8) {
                P.rect(25.2, ay, 0.9, 2.2, 'accent');
                P.rect(24.6, ay - 0.5, 2.1, 0.6, 'accent');
                P.rect(25.2, ay - 1, 0.9, 0.5, 'accent');
            }
            for (let i = 0; i < 4; i++) {
                if (p * 5 > i + 1)
                    P.rect(21.5 + i * 2.6, 9, 1.2, 0.8, 'green');
            }
        },
    },
    save: {
        ms: 3000, side: true,
        pose: (t, f, p) => ({eyes: p > 0.6 ? 'happy' : 'right', dy: hop(p, 0.62, 0.8, 1.2)}),
        back: (P, t, f, p) => {
            const a = p < 0.5 ? (f % 2 ? 1 : 0.55) : 1;
            P.rect(20, 0.5, 7, 7, 'blue', a);
            P.rect(21.5, 0.5, 3.8, 2.4, 'metal', a);
            P.rect(23.8, 0.8, 0.8, 1.6, 'blue', a);
            P.rect(21, 4.2, 5, 2.8, 'paper', a);
            P.rs([[21.6, 5, 3.6, 0.4], [21.6, 5.9, 2.6, 0.4]], 'print', a);
            if (p > 0.55)
                check(P, 28, -1.5);
        },
    },
    wifi: {
        ms: 3200, side: true,
        pose: (t, f, p) => ({eyes: Math.floor(p * 10) % 5 === 4 ? 'happy' : 'upright'}),
        back: (P, t, f, p) => {
            const level = Math.floor(p * 10) % 5;
            P.push(14.5, 10.8, 1.25);
            WIFI.forEach((arc, i) => P.rs(arc, i < level ? 'accent' : 'metal2', i < level ? 1 : 0.35));
            P.pop();
        },
    },
    loading: {
        ms: 3400, side: true,
        pose: (t, f) => ({eyes: 'right', legs: (f >> 1) % 2}),
        back: (P, t, f) => {
            for (let k = 0; k < 8; k++) {
                const a = (-90 + k * 45) * Math.PI / 180;
                const d = (f % 8 - k + 8) % 8;
                P.rect(25.5 + 3.2 * Math.cos(a) - 0.7, 3.5 + 3.2 * Math.sin(a) - 0.7, 1.4, 1.4,
                    d === 0 ? 'accent' : 'paper', d === 0 ? 1 : Math.max(0.2, 0.8 - d * 0.1));
            }
        },
    },
    crash: {
        ms: 3800, side: true,
        pose: (t, f, p) => p < 0.55
            ? {eyes: 'wide', dy: hop(p, 0.02, 0.18, 1.6), sweat: true}
            : {eyes: 'closed', dy: 0.3, sweat: true},
        back: (P, t, f, p) => {
            if (p < 0.08)
                return;
            P.push(p < 0.45 ? (f % 2 ? 0.4 : -0.4) : 0, 0);
            P.rect(19, -2.6, 13.6, 8.6, 'metal2');
            P.rect(19.4, -2.2, 12.8, 7.8, 'paper');
            P.rect(19.4, -2.2, 12.8, 1.4, 'red');
            P.rect(30.8, -1.9, 0.8, 0.8, 'paper');
            P.bits(FONT.X, 23.6, 0.2, 0.9, 'red');
            P.pop();
        },
    },
    reboot: {
        ms: 4000, side: true,
        pose: (t, f, p) => ({
            alpha: p < 0.25 ? 1 - p / 0.25 * 0.8 : p < 0.6 ? 0.2 : Math.min(1, 0.2 + (p - 0.6) / 0.15 * 0.8),
            eyes: p < 0.7 ? 'closed' : p < 0.78 ? 'wide' : 'open',
        }),
        back: (P, t, f, p) => {
            const on = p < 0.25 || p >= 0.6 || f % 4 < 2;
            P.push(15.5, 7.6, 1.2);
            P.rs(POWER, p >= 0.6 ? 'green' : 'accent', on ? 1 : 0.25);
            P.pop();
        },
    },
    music: {
        ms: 4400, side: true,
        pose: (t, f) => {
            const b = (f >> 1) % 2;
            return {eyes: 'happy', dy: b ? -0.5 : 0, legs: b ? 1 : 2, armL: b ? -0.5 : 0, armR: b ? 0 : -0.5};
        },
        front: (P, t, f) => {
            P.rs([[3.4, -1.6, 11.2, 0.8], [2.6, -1, 0.8, 2.8], [14.6, -1, 0.8, 2.8]], 'metal2');
            P.rs([[1.8, 1.4, 1.8, 2.6], [14.4, 1.4, 1.8, 2.6]], 'accent');
        },
        back: (P, t, f) => {
            [[19, 0], [23.5, 5], [28, 2.5]].forEach(([x, ph]) =>
                note(P, x + Math.sin((f + ph) / 2) * 0.6, 9 - ((f * 0.5 + ph) % 11)));
        },
    },
    chart: {
        ms: 4200, side: true,
        pose: (t, f, p) => ({eyes: p > 0.75 ? 'happy' : 'right', dy: hop(p, 0.78, 0.92, 1)}),
        back: (P, t, f, p) => {
            P.rect(18.6, -2.4, 0.5, 12, 'metal');
            P.rect(18.6, 9.2, 14.4, 0.5, 'metal');
            [[20, 3, 'blue'], [23, 5.2, 'green'], [26, 4.2, 'yellow'], [29, 8.6, 'accent']].forEach(([x, h, c], i) => {
                const hh = Math.round(h * clamp01(p * 5 - i) * 2) / 2;
                if (hh > 0)
                    P.rect(x, 9.2 - hh, 2, hh, c);
            });
            if (p > 0.8)
                P.rs([[30.6, -3, 0.5, 0.5], [30.1, -2.5, 1.5, 0.5], [29.6, -2, 2.5, 0.5], [30.6, -1.5, 0.5, 1.8]], 'green');
        },
    },
    idea: {
        ms: 3000, side: true,
        pose: (t, f, p) => p < 0.35 ? {eyes: 'upright'}
            : p < 0.5 ? {eyes: 'wide'} : {eyes: 'happy', dy: hop(p, 0.5, 0.66, 1.3)},
        back: (P, t, f, p) => {
            const on = p >= 0.35;
            P.bits(GLASS, 19.4, -3, 0.9, on ? 'yellow' : 'metal2');
            if (on)
                P.rect(20.3, -2.1, 0.9, 0.9, 'paper');
            P.bits(['.###.', '..#..'], 19.4, 1.5, 0.9, 'metal');
            if (on && f % 2)
                P.rs([[17.6, -1.2, 1.2, 0.5], [24.4, -1.2, 1.2, 0.5], [18.4, -3.4, 0.6, 0.6], [24.2, -3.4, 0.6, 0.6], [25, 1, 1, 0.5]], 'yellow');
        },
    },
    drone: {
        ms: 5000, side: true,
        pose: (t, f, p) => ({eyes: p > 0.2 && p < 0.9 ? 'upright' : 'right', raiseR: p > 0.3 && p < 0.8 && (f >> 1) % 2 === 0}),
        back: (P, t, f, p) => {
            let lift = 0;
            if (p > 0.2 && p < 0.4)
                lift = (p - 0.2) / 0.2 * 10;
            else if (p >= 0.4 && p < 0.75)
                lift = 10 + Math.sin((p - 0.4) * 30) * 0.6;
            else if (p >= 0.75 && p < 0.95)
                lift = 10 * (1 - (p - 0.75) / 0.2);
            const hx = p >= 0.4 && p < 0.75 ? Math.sin((p - 0.4) * 18) * 2.5 : 0;
            P.push(17 + hx, 13.2 - lift);
            P.rs([[5, -4.8, 8, 0.5], [4.6, -5.4, 0.8, 0.9], [12.6, -5.4, 0.8, 0.9], [7.6, -5.2, 2.8, 1.3],
                [7.8, -3.9, 0.4, 0.7], [9.8, -3.9, 0.4, 0.7]], 'metal2');
            const spinning = p > 0.12 && p < 0.97;
            P.rs(spinning && f % 2 ? [[4.4, -5.9, 1.2, 0.4], [12.4, -5.9, 1.2, 0.4]]
                : [[3.4, -5.9, 3.2, 0.4], [11.4, -5.9, 3.2, 0.4]], 'metal');
            P.rect(8, -4.8, 0.5, 0.4, 'red', f % 2 ? 1 : 0.3);
            P.rect(9.5, -4.8, 0.5, 0.4, 'green', f % 2 ? 0.3 : 1);
            P.pop();
        },
    },
    server: {
        ms: 3800, side: true,
        pose: (t, f) => ({eyes: 'right', armR: f % 8 < 4 ? -0.6 : 0}),
        back: (P, t, f) => {
            P.rect(21, -3, 8, 13, 'metal2');
            for (let i = 0; i < 4; i++) {
                const y = -2.4 + i * 3.1;
                P.rect(21.6, y, 6.8, 2.5, 'screen');
                P.rs([[22.2, y + 0.9, 2.6, 0.3], [22.2, y + 1.5, 2.6, 0.3]], 'metal2');
                for (let j = 0; j < 3; j++) {
                    const on = hash(f >> 1, i * 3 + j) > 0.45;
                    P.rect(25.4 + j * 0.9, y + 0.9, 0.6, 0.6, on ? (j === 2 && hash(f, i) > 0.8 ? 'accent' : 'green') : 'metal2');
                }
            }
        },
    },
    deploy: {
        ms: 4400, side: true,
        pose: (t, f, p) => ({eyes: p > 0.3 ? 'upright' : 'right', raiseR: p > 0.35 && p < 0.85, dy: hop(p, 0.86, 0.98, 1)}),
        back: (P, t, f, p) => {
            const rise = p < 0.3 ? 0 : Math.pow((p - 0.3) / 0.5, 2) * 18;
            const shake = p > 0.12 && p < 0.3 ? (f % 2 ? 0.2 : -0.2) : 0;
            if (p > 0.15)
                P.rs([[21.2, 8.6, 2.4, 1.4], [26.4, 8.8, 2.2, 1.2], [23, 9, 3.6, 1]], 'cloud', 0.5 + 0.2 * (f % 2));
            P.push(shake, -rise);
            P.rect(23.4, 1.6, 3, 5.4, 'paper');
            P.rect(23.9, 0.6, 2, 1, 'accent');
            P.rect(24.4, -0.2, 1, 0.8, 'accent');
            P.rect(24.4, 2.6, 1, 1, 'blue');
            P.rect(22.4, 5.4, 1, 2, 'red');
            P.rect(26.4, 5.4, 1, 2, 'red');
            if (p > 0.12) {
                P.rect(23.9, 7, 2, 1 + (f % 2) * 0.8, 'flame');
                P.rect(24.4, 7.6, 1, 1.4 + (f % 3) * 0.5, 'yellow');
            }
            P.pop();
        },
    },
    chat: {
        ms: 4600, side: true,
        pose: (t, f, p) => ({eyes: 'right', ...(p > 0.15 && p < 0.4 ? typing(f) : {})}),
        back: (P, t, f, p) => {
            P.rect(19.4, -2.8, 13.2, 7.6, 'paper');
            P.rect(19, -2.4, 14, 6.8, 'paper');
            P.rect(18.2, 2.6, 1.2, 1, 'paper');
            P.rect(17.6, 3.4, 0.8, 0.8, 'paper');
            if (p < 0.42) {
                for (let i = 0; i < 3; i++)
                    P.rect(23.2 + i * 2, 0.4, 1.2, 1.2, (f >> 1) % 3 === i ? 'accent' : 'print');
            } else {
                [[20.2, -1.6, 10.6], [20.2, -0.2, 8.2], [20.2, 1.2, 11], [20.2, 2.6, 6]].forEach(([x, y, w], i) => {
                    const g = clamp01((p - 0.42) * 7 - i);
                    if (g > 0)
                        P.rect(x, y, Math.round(w * g), 0.7, i === 0 ? 'accent' : 'print');
                });
            }
        },
    },
    duck: {
        ms: 4400, side: true,
        pose: () => ({eyes: 'right'}),
        back: (P, t, f, p) => {
            const nod = f % 6 < 2 && p > 0.3 ? 0.5 : 0;
            P.rect(21.6, 7, 5.4, 3, 'duck');
            P.rect(26.8, 7.6, 1, 1.4, 'duck');
            P.rect(22, 4.4 + nod, 3, 3, 'duck');
            P.rect(22.6, 5.2 + nod, 0.6, 0.6, 'ink');
            P.rect(20.6, 5.8 + nod, 1.6, 0.8, 'duckBill');
            P.rect(23.6, 7.8, 2.4, 1, 'duckDark');
            const talk = (f >> 1) % 3;
            for (let i = 0; i < 3; i++) {
                if (talk >= i)
                    P.rect(17.6 + i * 1, 2.6, 0.6, 0.6, 'paper');
            }
        },
    },
    tokens: {
        ms: 4000, side: true,
        pose: (t, f) => ({eyes: f % 4 < 2 ? 'happy' : 'open', dy: f % 4 === 1 ? -0.5 : 0}),
        back: (P, t, f) => {
            for (let k = 0; k < 6; k++) {
                const x = 33 - ((f * 1.6 + k * 3.2) % 17);
                const y = 3.2 + Math.sin((x + k) * 0.8) * 1.6;
                if (x > 16.4)
                    P.rect(x, y, 1.2, 1.2, k % 3 === 0 ? 'paper' : 'accent');
            }
            P.rect(19, 9, 14, 0.8, 'metal2');
            P.rect(19, 9, 14 * ((f % 32) / 32), 0.8, 'accent');
        },
    },
    battery: {
        ms: 3600, side: true,
        pose: (t, f, p) => ({eyes: p > 0.75 ? 'happy' : 'right', dy: hop(p, 0.78, 0.92, 1)}),
        back: (P, t, f, p) => {
            P.push(15, 9, 1.3);
            P.rs([[4.6, -6.4, 8.6, 0.5], [4.6, -3.4, 8.6, 0.5], [4.6, -6.4, 0.5, 3.5], [12.7, -6.4, 0.5, 3.5], [13.2, -5.4, 0.7, 1.5]], 'metal');
            const n = Math.min(4, Math.floor(p * 5.5));
            [5.4, 7.3, 9.2, 11.1].forEach((x, i) => P.rect(x, -5.6, 1.5, 1.9, i < n ? 'green' : 'metal2', i < n ? 1 : 0.4));
            P.pop();
            if (p < 0.75 && f % 2)
                bolt(P, 25, -2.8);
        },
    },
    search: {
        ms: 3400,
        pose: (t, f, p) => ({eyes: p < 0.5 ? 'right' : 'left'}),
        front: (P, t, f, p) => {
            const dx = Math.round((p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5) * 14) / 2;
            P.push(dx, 0);
            P.rect(4.1, 1.6, 2.8, 2.8, 'glass', 0.35);
            P.rs([[4.3, 1, 2.4, 0.6], [4.3, 4.4, 2.4, 0.6], [3.5, 1.8, 0.6, 2.4], [6.9, 1.8, 0.6, 2.4],
                [3.9, 1.4, 0.6, 0.6], [6.5, 1.4, 0.6, 0.6], [3.9, 4, 0.6, 0.6], [6.5, 4, 0.6, 0.6]], 'metal');
            P.rs([[7.3, 4.8, 0.8, 0.8], [8, 5.5, 0.8, 0.8], [8.7, 6.2, 1, 1]], 'metal2');
            P.pop();
        },
    },
};

// Hareketlerin arasındaki kısa dolgu hareketleri
const FILLERS = {
    look: {ms: 1600, pose: (t, f) => ({eyes: f < 4 ? 'left' : f < 9 ? 'right' : 'open'})},
    wave: {ms: 1400, pose: (t, f) => (f % 4 < 2 ? {raiseR: true, eyes: 'happy'} : {armR: -1, eyes: 'happy'})},
    hop: {ms: 900, pose: (t, f, p) => ({dy: hop(p, 0.1, 0.8, 2), eyes: 'happy'})},
    stretch: {ms: 1300, pose: (t, f, p) => (p > 0.15 && p < 0.8 ? {raiseR: true, raiseL: true, eyes: 'closed', dy: -0.5} : {})},
};

// Limit dolunca yalnızca "yorgun" hareketler
const TIRED = ['coffee', 'battery', 'loading', 'reboot', 'crash', 'search'];

const EYES = {
    open: [[5, 2, 1, 2], [12, 2, 1, 2]],
    closed: [[5, 3.3, 1, 0.7], [12, 3.3, 1, 0.7]],
    happy: [[5, 2, 1, 0.8], [12, 2, 1, 0.8]],
    wide: [[4.6, 1.6, 1.8, 2.6], [11.6, 1.6, 1.8, 2.6]],
    right: [[5.7, 2, 1, 2], [12.7, 2, 1, 2]],
    left: [[4.3, 2, 1, 2], [11.3, 2, 1, 2]],
    down: [[5, 2.8, 1, 1.2], [12, 2.8, 1, 1.2]],
    up: [[5, 1.4, 1, 1.4], [12, 1.4, 1, 1.4]],
    upright: [[5.7, 1.4, 1, 1.4], [12.7, 1.4, 1, 1.4]],
};
const BLINKABLE = new Set(['open', 'right', 'left', 'down', 'up', 'upright']);

function drawClawd(P, pose, color) {
    const a = pose.alpha ?? 1;
    const lifted = pose.legs ? (pose.legs % 2 ? [4, 11] : [6, 13]) : [];
    for (const x of [4, 6, 11, 13])
        P.rect(x, 8, 1, lifted.includes(x) ? 1 : 2, color, a);
    P.rect(3, 0, 12, 8, color, a);
    if (pose.raiseL)
        P.rect(1, -2.6, 2, 6.6, color, a);
    else
        P.rect(1, 4 + (pose.armL ?? 0), 2, 2, color, a);
    if (pose.raiseR)
        P.rect(15, -2.6, 2, 6.6, color, a);
    else
        P.rect(15, 4 + (pose.armR ?? 0), 2, 2, color, a);
    if (pose.glow)
        P.rect(3, 0, 12, 4.4, 'glow', 0.22);
    for (const [x, y, w, h] of EYES[pose.eyes] ?? EYES.open)
        P.clear(x, y, w, h);
}

/*
 * Sahneyi çizer. scene: ClawdDirector.update() çıktısı.
 */
export function paintScene(cr, w, h, scene) {
    const u = Math.min(w / STAGE.w, h / STAGE.h);
    const ox = (w - STAGE.w * u) / 2;
    const oy = (h - STAGE.h * u) / 2 - STAGE.top * u;
    const P = new Painter(cr, u, ox, oy);
    const {mood = 'happy', sleeping = false, act = null, t = 0, gf = 0} = scene;
    const f = Math.floor(t / FRAME_MS);
    const p = act ? clamp01(t / act.ms) : 0;

    let pose = {eyes: 'open'};
    if (sleeping)
        pose = {eyes: 'closed', dy: gf % 2 ? 0.5 : 0};
    else if (scene.walking)
        pose = {eyes: scene.walking > 0 ? 'right' : 'left', legs: (gf % 2) + 1, dy: gf % 2 ? -0.5 : 0};
    else if (act?.pose)
        Object.assign(pose, act.pose(t, f, p));
    if (scene.blink && BLINKABLE.has(pose.eyes))
        pose.eyes = 'closed';

    const color = sleeping && mood === 'sleep' ? 'sleepy' : mood === 'maxed' ? 'hot' : 'body';

    P.push(scene.cx ?? 0, 0);
    if (!sleeping && !scene.walking)
        act?.back?.(P, t, f, p);
    P.push(0, pose.dy ?? 0);
    drawClawd(P, pose, color);
    if (!sleeping && !scene.walking)
        act?.front?.(P, t, f, p);

    if (pose.sweat || mood === 'sweat' || mood === 'maxed') {
        const dy = (gf % 4) * 0.35;
        P.rs([[16.2, -1.2 + dy, 1, 1.4], [16.45, -1.8 + dy, 0.5, 0.6]], 'drop');
        if (mood === 'maxed')
            P.rs([[1, -1.2 + dy, 1, 1.4], [1.25, -1.8 + dy, 0.5, 0.6]], 'drop');
    }
    P.pop();

    if (sleeping) {
        const k = gf % 4;
        P.bits(FONT.Z, 16.4, -1.4 - k * 0.3, 0.42, 'zzz', 0.9);
        if (k >= 2)
            P.bits(FONT.Z, 19.2, -3.3, 0.3, 'zzz', 0.7);
    }
    P.pop();
}

/*
 * Ne zaman ne yapacağına karar verir: torbadan hareket çeker (hepsi oynamadan tekrar yok),
 * yanda eşyası olan hareketler için sola yürür, aralarda kısa dolgu hareketleri yapar,
 * kullanıcı uzaktayken ya da token yokken uyur.
 */
export class ClawdDirector {
    constructor(now = Date.now(), rand = Math.random) {
        this._rand = rand;
        this.mood = 'happy';
        this.away = false;
        this.cx = 0;
        this._target = 0;
        this._mode = 'idle';
        this._act = null;
        this._actName = null;
        this._start = now;
        this._until = now + 800;
        this._next = null;
        this._bag = [];
        this._last = null;
        this._gf = 0;
        this._blinkAt = now + 2500;
        this._blinkUntil = 0;
    }

    get sleeping() {
        return this.mood === 'sleep' || this.away;
    }

    get interval() {
        return this.sleeping ? SLEEP_FRAME_MS : FRAME_MS;
    }

    setMood(mood) {
        if (mood === this.mood)
            return;
        const wasTired = this.mood === 'maxed';
        this.mood = mood;
        if (wasTired !== (mood === 'maxed'))
            this._bag = [];
    }

    // Belirli bir hareketi hemen başlat (ör. elle yenilemede "loading")
    play(name, now = Date.now()) {
        if (!ACTS[name] || this.sleeping)
            return;
        this._queue(name, now);
    }

    _pool() {
        const names = this.mood === 'maxed' ? TIRED : Object.keys(ACTS);
        return names.filter(n => n !== this._last || names.length < 2);
    }

    _draw() {
        if (!this._bag.length) {
            this._bag = this._pool();
            for (let i = this._bag.length - 1; i > 0; i--) {
                const j = Math.floor(this._rand() * (i + 1));
                [this._bag[i], this._bag[j]] = [this._bag[j], this._bag[i]];
            }
        }
        return this._bag.pop();
    }

    // Hareketi sıraya al: önce yerine yürü, sonra başlat
    _queue(name, now) {
        const act = ACTS[name];
        this._next = name;
        this._target = act.side ? 0 : Math.round(this._rand() * 15);
        this._mode = 'walk';
        this._act = null;
        this._start = now;
    }

    _begin(name, now, table = ACTS) {
        this._mode = 'act';
        this._act = table[name];
        this._actName = name;
        this._start = now;
        this._until = now + this._act.ms;
        if (table === ACTS)
            this._last = name;
    }

    update(now = Date.now()) {
        this._gf++;
        if (this.sleeping) {
            this._mode = 'idle';
            this._act = null;
            this._next = null;
            this._until = now + 600;
            return {cx: this.cx, sleeping: true, mood: this.mood, gf: this._gf, name: 'sleep'};
        }

        if (this._mode === 'walk') {
            const d = this._target - this.cx;
            if (Math.abs(d) <= 0.8) {
                this.cx = this._target;
                this._begin(this._next, now);
                this._next = null;
            } else {
                this.cx += Math.sign(d) * 0.8;
                return this._scene(now, Math.sign(d));
            }
        } else if (now >= this._until) {
            if (this._mode === 'act' && this._act && !FILLERS[this._actName]) {
                // hareket bitti: kısa mola, bazen dolgu hareketi
                this._mode = 'idle';
                this._act = null;
                this._until = now + 400 + this._rand() * 900;
            } else if (this._mode === 'idle' && this._rand() < 0.3) {
                const names = Object.keys(FILLERS);
                this._begin(names[Math.floor(this._rand() * names.length)], now, FILLERS);
            } else {
                this._queue(this._draw(), now);
                return this._scene(now, 0);
            }
        }
        return this._scene(now, 0);
    }

    _scene(now, walking) {
        let blink = false;
        if (now >= this._blinkAt) {
            this._blinkUntil = now + 140;
            this._blinkAt = now + 2500 + this._rand() * 3500;
        }
        if (now < this._blinkUntil)
            blink = true;
        const act = this._mode === 'act' ? this._act : null;
        return {
            cx: this.cx, walking, blink, mood: this.mood, gf: this._gf,
            act, t: act ? now - this._start : 0,
            name: walking ? 'walk' : act ? this._actName : 'idle',
        };
    }
}
