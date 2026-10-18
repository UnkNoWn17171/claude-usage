// Üst bara Claude hesabının kullanım limitlerini gösteren gösterge ekler: Clawd maskotu,
// 5 saatlik oturum + haftalık çubuk ve yüzde. Menüde her limit için ayrıntı ve sıfırlanma zamanı.
// Veri, Claude Code CLI'ın OAuth tokenıyla api.anthropic.com/api/oauth/usage'dan okunur
// (CLI'ın /usage komutunun kullandığı uç; resmî olarak belgelenmemiş).
// Token bitmeye yakınsa CLI'ın yaptığı gibi refresh token ile yenilenir ve aynı dosyaya geri yazılır
// (yazmadan hemen önce dosya yeniden okunur, diğer alanlar korunur). Tokenlar asla loglanmaz.
// Yenileme olmazsa Clawd uyur; CLI tokenı yenileyince dosya izlendiği için gösterge hemen uyanır.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {THEMES, paintBar, paintSeg} from './bars.js';
import {ClawdDirector, paintScene, setTheme} from './clawd.js';

const CREDS_PATH = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
const SETTINGS_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'claude-usage', 'ayarlar.json']);
// Son API yanıtı (yalnızca kullanım verisi, token içermez) — sorun giderme için.
const DUMP_PATH = GLib.build_filenamev([GLib.get_user_cache_dir(), 'claude-usage', 'son-yanit.json']);
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const USAGE_PAGE = 'https://claude.ai/settings/usage';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code CLI'ın açık OAuth istemcisi

const POLL_SEC = 180;          // 3 dk'da bir; 429 gelirse 15 dk geri çekilir
const BACKOFF_SEC = 900;       // 429 sonrası bekleme
const STALE_ON_OPEN_SEC = 60;  // menü açılınca veri bundan eskiyse yenile
const CREDS_DEBOUNCE_MS = 1500;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;  // bitişe bundan az kaldıysa yenile
const REFRESH_RETRY_MS = 30 * 60 * 1000;  // başarısız yenilemeden sonra tekrar deneme aralığı

const AWAY_MS = 5 * 60 * 1000;
// Yanıttaki iç kod adlı limitler (iguana_necktie vb.): ne oldukları belirsiz, menüde gösterilmez.
// Veri yine son-yanit.json dökümünde durur; göstermek için true yap.
const SHOW_OTHER_LIMITS = false;  // bu kadar dokunulmazsa Clawd şekerleme yapar (2 fps)

// Clawd bunların hemen soluna yerleşir (ağ/ses/pil menüsü ve yanındaki sistem simgeleri)
const SYSTEM_ROLES = ['screenRecording', 'screenSharing', 'dwellClick', 'a11y', 'keyboard', 'quickSettings'];
// Gizlenen tepsi simgesi: Claude masaüstü uygulamasınınki (bu gösterge onun yerini tutuyor)
const HIDE_TRAY = /Claude_status_icon/;

const PANEL_BAR_W = 40;
const MENU_BAR_W = 292;

// Bilinen limit anahtarları (sıra = menüdeki sıra). Bilinmeyen anahtarlar sona eklenir.
const LIMITS = [
    ['five_hour', 'Oturum', '5 saatlik pencere'],
    ['seven_day', 'Haftalık', 'tüm modeller'],
    ['seven_day_opus', 'Haftalık', 'Opus'],
    ['seven_day_sonnet', 'Haftalık', 'Sonnet'],
    ['seven_day_oauth_apps', 'Haftalık', 'OAuth uygulamaları'],
    ['seven_day_cowork', 'Haftalık', 'Cowork'],
];
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

// seven_day_breakdown: haftalık kullanımın ürünlere göre payı
const BREAKDOWN_NAMES = {claude_code: 'Claude Code', chat: 'Sohbet', cowork: 'Cowork', other: 'Diğer'};
const BREAKDOWN_COLORS = ['#D97757', '#8FB8DE', '#E8C9A0', '#A8A49B', '#B7A3D9'];
let theme = 'turuncu';  // bars.js'teki THEMES anahtarlarından biri

const levelOf = pct => pct >= 80 ? 'crit' : pct >= 50 ? 'warn' : 'ok';
const pad = n => String(n).padStart(2, '0');
const esc = s => GLib.markup_escape_text(s, -1);
const usd = n => `$${n.toFixed(2).replace('.', ',')}`;

function parseTime(iso) {
    if (!iso)
        return null;
    const dt = GLib.DateTime.new_from_iso8601(iso, null);
    return dt ? new Date(dt.to_unix() * 1000 + Math.floor(dt.get_microsecond() / 1000)) : null;
}

function fmtLeft(ms) {
    if (ms <= 0)
        return 'şimdi';
    const m = Math.ceil(ms / 60000);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d)
        return `${d} g ${h} sa`;
    if (h)
        return `${h} sa ${mm} dk`;
    return `${mm} dk`;
}

// Panel sayacı için kısa biçim: "2sa 14dk", bir saatin altında "47 dk"
function fmtShort(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return m < 60 ? `${m} dk` : `${Math.floor(m / 60)}sa ${pad(m % 60)}dk`;
}

const fmtClock = (date, withDay) =>
    `${withDay ? `${DAYS[date.getDay()]} ` : ''}${pad(date.getHours())}:${pad(date.getMinutes())}`;

function planName(oauth) {
    const tier = oauth?.rateLimitTier ?? '';
    const mult = tier.match(/(\d+)x/);
    const base = oauth?.subscriptionType ?? '';
    const name = base ? base[0].toUpperCase() + base.slice(1) : 'Claude';
    return mult ? `${name} ${mult[1]}x` : name;
}

// API yanıtından gösterilecek limitleri çıkarır:
// [{key, title, sub, pct, resetsAt, usedUsd, limitUsd, other}]
function extractLimits(data) {
    const out = [];
    const seen = new Set();
    const push = (key, title, sub, other = false) => {
        const v = data?.[key];
        seen.add(key);
        if (!v || typeof v.utilization !== 'number') {
            // Oturum penceresi hiç başlamamışsa API null dönebilir; satır yine görünsün
            if (key === 'five_hour' && data && key in data)
                out.push({key, title, sub, other, pct: 0, resetsAt: null, usedUsd: null, limitUsd: null});
            return;
        }
        let pct = v.utilization;
        let resetsAt = parseTime(v.resets_at);
        // Sıfırlanma anı geçtiyse (bir sonraki sorguya kadar) pencere bitmiş sayılır
        if (resetsAt && resetsAt.getTime() <= Date.now()) {
            pct = 0;
            resetsAt = null;
        }
        out.push({
            key, title, sub, other, pct, resetsAt,
            usedUsd: typeof v.used_dollars === 'number' ? v.used_dollars : null,
            limitUsd: typeof v.limit_dollars === 'number' ? v.limit_dollars : null,
        });
    };
    for (const [key, title, sub] of LIMITS)
        push(key, title, sub);
    for (const key of Object.keys(data ?? {})) {
        if (seen.has(key) || !key.startsWith('seven_day_'))
            continue;
        const name = key.slice('seven_day_'.length).replace(/_/g, ' ');
        push(key, 'Haftalık', name[0].toUpperCase() + name.slice(1));
    }
    // Yanıtta iç kod adlı limitler de var (tangelo, iguana_necktie…). Ne oldukları bilinmediği için
    // "Diğer" altında soluk gösterilir; Clawd'ın ruh hâlini ve panel çubuklarını etkilemez.
    for (const key of Object.keys(data ?? {})) {
        if (!seen.has(key) && key !== 'extra_usage')
            push(key, 'Diğer', key.replace(/_/g, ' '), true);
    }
    const extra = data?.extra_usage;
    if (extra?.is_enabled && typeof extra.utilization === 'number')
        out.push({key: 'extra_usage', title: 'Ek kullanım', sub: 'aylık', pct: extra.utilization, resetsAt: null});
    return out;
}

function extractBreakdown(data) {
    const rows = data?.seven_day_breakdown?.rows;
    if (!Array.isArray(rows))
        return [];
    return rows
        .filter(r => typeof r?.percent === 'number' && r.percent > 0)
        .map((r, i) => ({
            name: BREAKDOWN_NAMES[r.key] ?? r.display_name ?? r.key,
            pct: r.percent,
            color: i === 0 ? THEMES[theme].first : BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length],
        }));
}

function moodFor(state, peak) {
    if (state === 'loading')
        return 'happy';
    if (state !== 'ok' && peak === null)
        return 'sleep';
    if (state === 'expired' || state === 'nocreds')
        return 'sleep';
    if (peak >= 100)
        return 'maxed';
    if (peak >= 80)
        return 'sweat';
    return 'happy';
}

function statusText(state, peak) {
    switch (state) {
    case 'expired': return 'Terminal oturumunun tokenı dolmuş, uyuyorum.';
    case 'nocreds': return 'Claude Code CLI girişi bulunamadı.';
    case 'loading': return 'Kullanım okunuyor…';
    }
    if (peak === null)
        return 'Bağlantı kurulamadı.';
    if (peak >= 100)
        return 'Limit doldu — sıfırlanmayı bekliyoruz.';
    if (peak >= 80)
        return 'Az kaldı! Dikkatli harca.';
    if (peak >= 50)
        return 'Yarıyı geçtik, tempoyu ayarla.';
    if (peak >= 25)
        return 'Rahat rahat çalışabilirsin.';
    return 'Bol bol hakkın var, keyfine bak.';
}

const ClawdArea = GObject.registerClass(
class ClawdArea extends St.DrawingArea {
    _init(styleClass) {
        super._init({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
        this._scene = {sleeping: true, mood: 'happy', gf: 0, cx: 0};
        this.connect('repaint', () => {
            const cr = this.get_context();
            const [w, h] = this.get_surface_size();
            paintScene(cr, w, h, this._scene);
            cr.$dispose();
        });
    }

    setScene(scene) {
        this._scene = scene;
        this.queue_repaint();
    }
});

// Kullanım çubuğu; çizim bars.js'te
const BarArea = GObject.registerClass(
class BarArea extends St.DrawingArea {
    // radius: köşe yarıçapı (CSS px); verilmezse hap biçimi
    _init(width, height, radius = null) {
        super._init({style: `width: ${width}px; height: ${height}px;`, y_align: Clutter.ActorAlign.CENTER});
        this._pct = 0;
        this._level = 'off';
        this.connect('repaint', () => {
            const cr = this.get_context();
            const [w, h] = this.get_surface_size();
            const k = h / height;   // HiDPI ölçeği
            paintBar(cr, w, h, this._pct, this._level, theme, radius === null ? h / 2 : radius * k);
            cr.$dispose();
        });
    }

    set(pct, level) {
        this._pct = Math.max(0, Math.min(100, pct ?? 0));
        this._level = level;
        this.queue_repaint();
    }
});

// Haftalık dağılım çubuğu
const SegArea = GObject.registerClass(
class SegArea extends St.DrawingArea {
    _init(width, height, parts) {
        super._init({style: `width: ${width}px; height: ${height}px;`});
        this.connect('repaint', () => {
            const cr = this.get_context();
            const [w, h] = this.get_surface_size();
            paintSeg(cr, w, h, parts);
            cr.$dispose();
        });
    }
});

function loadTheme() {
    try {
        const [ok, bytes] = GLib.file_get_contents(SETTINGS_PATH);
        const t = ok ? JSON.parse(new TextDecoder().decode(bytes)).tema : null;
        return THEMES[t] ? t : 'turuncu';
    } catch {
        return 'turuncu';
    }
}

function saveTheme(t) {
    const file = Gio.File.new_for_path(SETTINGS_PATH);
    try {
        file.get_parent().make_directory_with_parents(null);
    } catch {}
    const bytes = new GLib.Bytes(new TextEncoder().encode(`${JSON.stringify({tema: t}, null, 2)}\n`));
    file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (f, res) => {
        try {
            f.replace_contents_finish(res);
        } catch (e) {
            console.warn(`[claude-usage] ayar yazılamadı: ${e.message}`);
        }
    });
}

const UsageIndicator = GObject.registerClass(
class UsageIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Claude Kullanım');
        this.add_style_class_name('cu-button');

        this._state = 'loading';
        this._data = null;
        this._oauth = null;
        this._updated = null;
        this._error = null;
        this._busy = false;
        this._sources = new Set();
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 20});

        const box = new St.BoxLayout({style_class: 'cu-panel'});
        this._clawd = new ClawdArea('cu-clawd-small');
        const bars = new St.BoxLayout({vertical: true, style_class: 'cu-panel-bars', y_align: Clutter.ActorAlign.CENTER});
        this._pSession = new BarArea(PANEL_BAR_W, 6, 2);
        this._pWeek = new BarArea(PANEL_BAR_W, 4, 2);
        bars.add_child(this._pSession);
        bars.add_child(this._pWeek);
        const texts = new St.BoxLayout({vertical: true, style_class: 'cu-panel-texts', y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({text: '…', style_class: 'cu-panel-label'});
        this._timer = new St.Label({text: '', style_class: 'cu-panel-timer'});
        texts.add_child(this._label);
        texts.add_child(this._timer);
        box.add_child(this._clawd);
        box.add_child(bars);
        box.add_child(texts);
        this.add_child(box);

        this._buildMenu();
        this._watchCreds();
        this._director = new ClawdDirector();
        this._applyTheme(loadTheme());
        this._awayCheck = 0;
        this._animate();

        this._pollId = this._addTimeout(POLL_SEC * 1000, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this._refresh();
    }

    _applyTheme(t) {
        theme = THEMES[t] ? t : 'turuncu';
        setTheme(theme);
        if (theme === 'mor')
            this.menu.actor.add_style_class_name('cu-purple');
        else
            this.menu.actor.remove_style_class_name('cu-purple');
        for (const [key, b] of Object.entries(this._swatches)) {
            if (key === theme)
                b.add_style_class_name('cu-swatch-on');
            else
                b.remove_style_class_name('cu-swatch-on');
        }
        this._pSession.queue_repaint();
        this._pWeek.queue_repaint();
        this._render();
    }

    _buildMenu() {
        this.menu.actor.add_style_class_name('cu-menu');

        const header = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'cu-header-item'});
        const hbox = new St.BoxLayout({style_class: 'cu-header', x_expand: true});
        this._bigClawd = new ClawdArea('cu-clawd-big');
        const titles = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        const titleRow = new St.BoxLayout({style_class: 'cu-title-row', x_expand: true});
        titleRow.add_child(new St.Label({text: 'Claude', style_class: 'cu-title'}));
        this._chip = new St.Label({text: '', style_class: 'cu-chip', y_align: Clutter.ActorAlign.CENTER});
        titleRow.add_child(this._chip);
        titleRow.add_child(new St.Widget({x_expand: true}));
        // Tema seçici: renk noktaları (menü kapanmadan anında uygulanır, ayarlar.json'a yazılır)
        this._swatches = {};
        for (const [key, th] of Object.entries(THEMES)) {
            const b = new St.Button({
                style_class: `cu-swatch cu-swatch-${key}`,
                can_focus: true,
                accessible_name: th.label,
                y_align: Clutter.ActorAlign.CENTER,
            });
            b.connect('clicked', () => {
                this._applyTheme(key);
                saveTheme(key);
            });
            titleRow.add_child(b);
            this._swatches[key] = b;
        }
        this._status = new St.Label({text: '', style_class: 'cu-status'});
        this._status.clutter_text.line_wrap = true;
        titles.add_child(titleRow);
        titles.add_child(this._status);
        hbox.add_child(this._bigClawd);
        hbox.add_child(titles);
        header.add_child(hbox);
        this.menu.addMenuItem(header);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const limitsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._limitsBox = new St.BoxLayout({vertical: true, style_class: 'cu-limits', x_expand: true});
        limitsItem.add_child(this._limitsBox);
        this.menu.addMenuItem(limitsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const footItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const foot = new St.BoxLayout({style_class: 'cu-foot-row', x_expand: true});
        this._foot = new St.Label({text: '', style_class: 'cu-foot', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const btnBox = new St.BoxLayout({style_class: 'cu-btn-box'});
        btnBox.add_child(new St.Icon({icon_name: 'view-refresh-symbolic', style_class: 'cu-btn-icon'}));
        btnBox.add_child(new St.Label({text: 'Yenile', y_align: Clutter.ActorAlign.CENTER}));
        const refreshBtn = new St.Button({style_class: 'cu-btn', can_focus: true, child: btnBox});
        refreshBtn.connect('clicked', () => {
            this._director.play('loading');
            this._refresh();
        });
        foot.add_child(this._foot);
        foot.add_child(refreshBtn);
        footItem.add_child(foot);
        this.menu.addMenuItem(footItem);

        const open = new PopupMenu.PopupMenuItem('claude.ai’de kullanım sayfasını aç');
        open.add_style_class_name('cu-link');
        open.connect('activate', () => Gio.AppInfo.launch_default_for_uri_async(USAGE_PAGE, null, null, null));
        this.menu.addMenuItem(open);

        this.menu.connect('open-state-changed', (_m, isOpen) => {
            if (!isOpen)
                return;
            this._render();
            const age = this._updated ? (Date.now() - this._updated.getTime()) / 1000 : Infinity;
            if (age > STALE_ON_OPEN_SEC)
                this._refresh();
        });
    }

    _addTimeout(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            const ret = fn();
            if (ret !== GLib.SOURCE_CONTINUE)
                this._sources.delete(id);
            return ret;
        });
        this._sources.add(id);
        return id;
    }

    _removeTimeout(id) {
        if (id && this._sources.delete(id))
            GLib.source_remove(id);
    }

    // Clawd'ın kareleri: 8 fps, uyurken 2 fps. Büyük Clawd yalnızca menü açıkken çizilir.
    // Ekran kilitlenince GNOME eklentiyi kapatır; o sırada hiç çalışmaz.
    _animate() {
        this._addTimeout(this._director.interval, () => {
            const now = Date.now();
            if (now - this._awayCheck > 2000) {
                this._awayCheck = now;
                this._updateTimer();
                this._director.away = global.backend.get_core_idle_monitor().get_idletime() > AWAY_MS;
            }
            const scene = this._director.update(now);
            this._clawd.setScene(scene);
            if (this.menu.isOpen)
                this._bigClawd.setScene(scene);
            this._animate();
            return GLib.SOURCE_REMOVE;
        });
    }

    // CLI tokenı yenileyince dosya değişir → hemen tekrar dene.
    _watchCreds() {
        const file = Gio.File.new_for_path(CREDS_PATH);
        this._monitor = file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connect('changed', () => {
            // Yeni giriş/yenileme gelmiş olabilir: eski başarısızlığı unut.
            this._refreshFailedAt = 0;
            this._needLogin = false;
            this._removeTimeout(this._credsDebounce);
            this._credsDebounce = this._addTimeout(CREDS_DEBOUNCE_MS, () => {
                this._credsDebounce = null;
                if (this._state !== 'ok')
                    this._refresh();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _readCredsFile() {
        const file = Gio.File.new_for_path(CREDS_PATH);
        return new Promise((resolve, reject) => {
            file.load_contents_async(this._cancellable, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    resolve(JSON.parse(new TextDecoder().decode(contents)));
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                        resolve(null);
                    else
                        reject(e);
                }
            });
        });
    }

    // Geçici dosyaya yazıp yerine taşır; GIO mevcut dosyanın 0600 iznini korur.
    _writeCredsFile(doc) {
        const file = Gio.File.new_for_path(CREDS_PATH);
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(doc)));
        return new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.PRIVATE,
                this._cancellable, (f, res) => {
                    try {
                        f.replace_contents_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    // Kullanılabilir access token döndürür (gerekirse yeniler); yoksa null.
    // force: sunucu tokenı reddettiyse süresine bakmadan yenile.
    async _validToken(force = false) {
        const oauth = (await this._readCredsFile())?.claudeAiOauth ?? null;
        this._oauth = oauth;
        if (!oauth?.accessToken)
            return null;
        const left = (oauth.expiresAt ?? Infinity) - Date.now();
        if (!force && left > REFRESH_MARGIN_MS)
            return oauth.accessToken;
        const usable = !force && left > 0 ? oauth.accessToken : null;
        if (!oauth.refreshToken ||
            (oauth.refreshTokenExpiresAt && oauth.refreshTokenExpiresAt < Date.now())) {
            this._needLogin = true;
            return usable;
        }
        if (this._refreshFailedAt && Date.now() - this._refreshFailedAt < REFRESH_RETRY_MS)
            return usable;
        try {
            const token = await this._refreshToken(oauth);
            this._refreshFailedAt = 0;
            this._refreshError = null;
            this._needLogin = false;
            return token;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            this._refreshFailedAt = Date.now();
            this._refreshError = e.message;
            console.warn(`[claude-usage] token yenilenemedi: ${e.message}`);
            return usable;
        }
    }

    async _refreshToken(oauth) {
        const {status, text} = await this._send('POST', TOKEN_URL, {json: {
            grant_type: 'refresh_token',
            refresh_token: oauth.refreshToken,
            client_id: CLIENT_ID,
        }});
        let res = null;
        try {
            res = JSON.parse(text);
        } catch {}
        if (status !== 200 || typeof res?.access_token !== 'string') {
            if (status === 400 || status === 401)
                this._needLogin = true;
            throw new Error(`HTTP ${status}${typeof res?.error === 'string' ? ` (${res.error})` : ''}`);
        }

        // Yazmadan hemen önce yeniden oku: CLI bu arada başka alanları (MCP girişleri vb.) değiştirmiş olabilir.
        const doc = (await this._readCredsFile()) ?? {};
        const cur = doc.claudeAiOauth ?? oauth;
        const next = {
            ...cur,
            accessToken: res.access_token,
            refreshToken: res.refresh_token ?? cur.refreshToken,
            expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
        };
        if (typeof res.scope === 'string' && res.scope.trim())
            next.scopes = res.scope.trim().split(/\s+/);
        if (typeof res.refresh_token_expires_in === 'number')
            next.refreshTokenExpiresAt = Date.now() + res.refresh_token_expires_in * 1000;
        doc.claudeAiOauth = next;
        await this._writeCredsFile(doc);
        this._oauth = next;
        console.log(`[claude-usage] token yenilendi, ${Math.round((res.expires_in ?? 3600) / 60)} dk geçerli`);
        return res.access_token;
    }

    _send(method, url, {token = null, json = null} = {}) {
        const msg = Soup.Message.new(method, url);
        const h = msg.get_request_headers();
        if (token) {
            h.append('Authorization', `Bearer ${token}`);
            h.append('anthropic-beta', 'oauth-2025-04-20');
        }
        h.append('Accept', 'application/json');
        h.append('User-Agent', 'claude-usage-gnome/1');
        if (json)
            msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify(json))));
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    resolve({status: msg.get_status(), text: new TextDecoder().decode(bytes.get_data() ?? new Uint8Array())});
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _dump(text) {
        const file = Gio.File.new_for_path(DUMP_PATH);
        try {
            file.get_parent().make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                return;
        }
        const pretty = JSON.stringify(JSON.parse(text), null, 2);
        file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(pretty)), null, false,
            Gio.FileCreateFlags.PRIVATE, null, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                } catch (e) {
                    console.warn(`[claude-usage] yanıt dökümü yazılamadı: ${e.message}`);
                }
            });
    }

    async _refresh() {
        if (this._busy || this._cancellable.is_cancelled())
            return;
        this._busy = true;
        try {
            const token = await this._validToken();
            if (!this._oauth?.accessToken) {
                this._state = 'nocreds';
            } else if (!token) {
                this._state = 'expired';
            } else {
                let {status, text} = await this._send('GET', USAGE_URL, {token});
                if (status === 401) {
                    const again = await this._validToken(true);
                    if (again)
                        ({status, text} = await this._send('GET', USAGE_URL, {token: again}));
                }
                if (status === 200) {
                    const data = JSON.parse(text);
                    this._dump(text);
                    if (!this._data)
                        console.log(`[claude-usage] ilk veri, anahtarlar: ${Object.keys(data).join(', ')}`);
                    this._data = data;
                    this._updated = new Date();
                    this._state = 'ok';
                    this._error = null;
                } else if (status === 401) {
                    this._state = 'expired';
                } else {
                    this._state = 'error';
                    this._error = status === 429 ? 'Çok sık sorgu (429), biraz bekliyorum' : `HTTP ${status}`;
                    console.warn(`[claude-usage] ${USAGE_URL} → HTTP ${status}`);
                    if (status === 429)
                        this._backoff();
                }
            }
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            this._state = 'error';
            this._error = e.message;
            console.warn(`[claude-usage] ${e.message}`);
        } finally {
            this._busy = false;
            if (!this._cancellable.is_cancelled())
                this._render();
        }
    }

    _backoff() {
        this._removeTimeout(this._pollId);
        this._pollId = this._addTimeout(BACKOFF_SEC * 1000, () => {
            this._pollId = this._addTimeout(POLL_SEC * 1000, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // 5 saatlik pencere: başladıysa sıfırlanmaya kalan süre, başlamadıysa "başlamadı"
    _updateTimer() {
        let text = '', idle = false;
        if (this._data && this._state !== 'expired' && this._state !== 'nocreds') {
            const s = extractLimits(this._data).find(l => l.key === 'five_hour');
            const left = s?.resetsAt ? s.resetsAt.getTime() - Date.now() : 0;
            if (left > 0) {
                text = fmtShort(left);
            } else {
                text = 'başlamadı';
                idle = true;
            }
        }
        if (this._timer.text !== text)
            this._timer.text = text;
        this._timer.visible = text !== '';
        const cls = idle ? 'cu-panel-timer cu-timer-idle' : 'cu-panel-timer';
        if (this._timer.style_class !== cls)
            this._timer.style_class = cls;
    }

    // Pencere sıfırlandığı anda (30 sn payla) veriyi tazele: yüzde ve sayaç beklemeden düzelsin
    _scheduleResetRefresh(resetsAt) {
        this._removeTimeout(this._resetId);
        this._resetId = null;
        const wait = resetsAt ? resetsAt.getTime() - Date.now() + 30000 : 0;
        if (wait <= 0 || wait > 6 * 3600 * 1000)
            return;
        this._resetId = this._addTimeout(wait, () => {
            this._resetId = null;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        const limits = this._data ? extractLimits(this._data) : [];
        const byKey = Object.fromEntries(limits.map(l => [l.key, l]));
        const session = byKey.five_hour ?? limits[0] ?? null;
        this._updateTimer();
        if (session?.resetsAt?.getTime() !== this._resetAt) {
            this._resetAt = session?.resetsAt?.getTime();
            this._scheduleResetRefresh(session?.resetsAt);
        }
        const week = byKey.seven_day ?? null;
        const fresh = this._state === 'ok';
        const peaks = [session, week].filter(Boolean).map(l => l.pct);
        const peak = peaks.length && (fresh || this._state === 'error') ? Math.max(...peaks) : null;

        this._director.setMood(moodFor(this._state, peak));

        // Panel
        const dim = !fresh;
        this._pSession.set(session?.pct, dim ? 'off' : levelOf(session?.pct ?? 0));
        this._pWeek.set(week?.pct, dim ? 'off' : levelOf(week?.pct ?? 0));
        if (this._state === 'expired' || this._state === 'nocreds')
            this._label.text = 'zZ';
        else
            this._label.text = session ? `${Math.round(session.pct)}%` : '…';
        this._label.opacity = dim ? 150 : 255;

        // Menü başlığı
        this._chip.text = planName(this._oauth);
        this._chip.visible = !!this._oauth;
        this._status.text = statusText(this._state === 'error' && peak !== null ? 'ok' : this._state, peak);

        // Limit satırları
        this._limitsBox.destroy_all_children();
        if (this._state === 'expired' || this._state === 'nocreds') {
            let text;
            if (this._state === 'nocreds')
                text = '~/.claude/.credentials.json bulunamadı.\nTerminalde `claude` ile giriş yap.';
            else if (this._needLogin)
                text = 'Claude Code oturumu yenilenemiyor.\nTerminalde `claude` → `/login` ile yeniden giriş yap; Clawd kendiliğinden uyanır.';
            else
                text = `Token yenilenemedi${this._refreshError ? ` (${this._refreshError})` : ''}; 30 dk sonra tekrar denenecek.\n` +
                    'Beklemek istemezsen terminalde `claude` → `/usage` yeterli.';
            const note = new St.Label({style_class: 'cu-note', text});
            note.clutter_text.line_wrap = true;
            this._limitsBox.add_child(note);
        }
        const main = limits.filter(l => !l.other);
        const others = limits.filter(l => l.other);
        for (const l of main)
            this._limitsBox.add_child(this._limitRow(l, dim));
        const parts = this._data ? extractBreakdown(this._data) : [];
        if (parts.length)
            this._limitsBox.add_child(this._breakdownRow(parts));
        if (SHOW_OTHER_LIMITS && others.length) {
            this._limitsBox.add_child(new St.Label({text: 'DİĞER LİMİTLER · iç adlar, ne oldukları belirsiz', style_class: 'cu-section'}));
            for (const l of others)
                this._limitsBox.add_child(this._limitRow(l, true));
        }
        if (!limits.length && this._state !== 'expired' && this._state !== 'nocreds')
            this._limitsBox.add_child(new St.Label({text: 'Henüz veri yok.', style_class: 'cu-limit-reset'}));

        // Alt satır
        const when = this._updated ? `Güncellendi ${fmtClock(this._updated)}` : 'Henüz güncellenmedi';
        this._foot.text = this._error ? `⚠ ${this._error} · ${when}` : `${when} · 3 dk’da bir`;
    }

    _limitRow(l, dim) {
        const row = new St.BoxLayout({vertical: true, style_class: 'cu-limit'});
        const top = new St.BoxLayout({style_class: 'cu-limit-top'});
        const name = new St.Label({style_class: 'cu-limit-name', x_expand: true});
        name.clutter_text.set_markup(l.sub
            ? `<b>${esc(l.title)}</b>  <span alpha="55%">${esc(l.sub)}</span>`
            : `<b>${esc(l.title)}</b>`);
        const level = levelOf(l.pct);
        const pct = new St.Label({text: `${Math.round(l.pct)}%`, style_class: `cu-limit-pct cu-text-${dim ? 'off' : level}`});
        top.add_child(name);
        top.add_child(pct);
        row.add_child(top);

        const bar = new BarArea(MENU_BAR_W, 9);
        bar.set(l.pct, dim ? 'off' : level);
        row.add_child(bar);

        let reset = '';
        if (l.resetsAt) {
            const left = l.resetsAt.getTime() - Date.now();
            const withDay = left > 20 * 3600 * 1000;
            const date = left > 6 * 86400 * 1000
                ? `${l.resetsAt.getDate()}.${pad(l.resetsAt.getMonth() + 1)} ${fmtClock(l.resetsAt)}`
                : fmtClock(l.resetsAt, withDay);
            reset = `${fmtLeft(left)} sonra sıfırlanır · ${date}`;
        } else if (l.key === 'extra_usage') {
            reset = 'Aylık ek kullanım bütçesi';
        } else if (l.key === 'five_hour') {
            reset = 'Başlamadı · ilk mesajla 5 saatlik süre başlar';
        } else if (l.pct === 0) {
            reset = 'Pencere henüz başlamadı';
        }
        if (l.limitUsd !== null)
            reset = `${usd(l.usedUsd ?? 0)} / ${usd(l.limitUsd)}${reset ? ` · ${reset}` : ''}`;
        if (reset)
            row.add_child(new St.Label({text: reset, style_class: 'cu-limit-reset'}));
        return row;
    }

    // Haftalık kullanımın ürünlere göre payı: parçalı çubuk + renkli açıklama
    _breakdownRow(parts) {
        const row = new St.BoxLayout({vertical: true, style_class: 'cu-limit'});
        const title = new St.Label({style_class: 'cu-limit-name'});
        title.clutter_text.set_markup('<b>Bu hafta nereye gitti</b>');
        row.add_child(title);

        row.add_child(new SegArea(MENU_BAR_W, 9, parts));

        // Renkli nokta ayrı widget: tek etikette Pango renk etiketi satır başında uygulanmıyor.
        const legend = new St.BoxLayout({style_class: 'cu-legend'});
        for (const p of parts) {
            const item = new St.BoxLayout({style_class: 'cu-legend-item'});
            item.add_child(new St.Widget({
                style_class: 'cu-legend-dot',
                style: `background-color: ${p.color};`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const label = new St.Label({style_class: 'cu-limit-reset', y_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.set_markup(`${esc(p.name)} <b>${Math.round(p.pct)}%</b>`);
            item.add_child(label);
            legend.add_child(item);
        }
        row.add_child(legend);
        return row;
    }

    _onDestroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._monitor?.cancel();
        for (const id of this._sources)
            GLib.source_remove(id);
        this._sources.clear();
        super._onDestroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new UsageIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        this._hidden = new Map();
        // Sonradan eklenen simgeler (uygulama yeniden açılınca tepsi simgesi gibi) için tekrar düzenle
        this._boxSignals = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]
            .map(box => [box, box.connect('child-added', () => this._tidyLater())]);
        this._tidy();
    }

    disable() {
        for (const [box, id] of this._boxSignals ?? [])
            box.disconnect(id);
        this._boxSignals = null;
        if (this._tidyId)
            GLib.source_remove(this._tidyId);
        this._tidyId = 0;
        for (const [c, ids] of this._hidden ?? []) {
            ids.forEach(id => c.disconnect(id));
            c.show();
        }
        this._hidden = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    _tidyLater() {
        if (this._tidyId)
            return;
        this._tidyId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._tidyId = 0;
            this._tidy();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Clawd'ı sistem simgelerinin hemen soluna al; Claude masaüstü uygulamasının tepsi simgesini gizle.
    _tidy() {
        const box = Main.panel._rightBox;
        const mine = this._indicator?.container;
        if (mine?.get_parent() === box) {
            const kids = box.get_children();
            const first = SYSTEM_ROLES
                .map(r => Main.panel.statusArea[r]?.container)
                .filter(c => c && c.get_parent() === box)
                .sort((a, b) => kids.indexOf(a) - kids.indexOf(b))[0];
            if (first && mine.get_next_sibling() !== first)
                box.set_child_below_sibling(mine, first);
        }
        for (const [role, ind] of Object.entries(Main.panel.statusArea)) {
            const c = ind?.container;
            if (!c || !role.startsWith('appindicator-') || this._hidden.has(c))
                continue;
            if (!HIDE_TRAY.test(`${role} ${ind._indicator?.id ?? ''}`))
                continue;
            c.hide();
            console.log(`[claude-usage] tepsi simgesi gizlendi: ${ind._indicator?.id ?? role}`);
            this._hidden.set(c, [
                c.connect('notify::visible', () => {
                    if (c.visible)
                        c.hide();
                }),
                c.connect('destroy', () => this._hidden?.delete(c)),
            ]);
        }
    }
}
