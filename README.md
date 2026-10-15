# Claude Kullanım (GNOME 46)

Üst bara Claude hesabının kullanım limitlerini ekler: Clawd maskotu, 5 saatlik oturum (kalın) ve
haftalık (ince) çubuk, oturum yüzdesi. Tıklayınca her limit için yüzde, çubuk ve sıfırlanma zamanı.

Clawd hiç boş durmaz: 29 bilgisayar/kod/yapay zekâ hareketi (laptop, kod, terminal, böcek avı, derleme,
kahve, klavye, fare, git, sinir ağı, düşünme, ikilik yağmur, bulut, kaydet, wifi, yükleniyor, çökme,
yeniden başlatma, müzik, grafik, ampul, drone, sunucu, roket/deploy, sohbet, lastik ördek, token, pil,
büyüteç) torbadan karışık sırayla, aralarda yürüme/el sallama/zıplama. Eşyalar zotero-hoca'daki
`clawd.js` ile aynı koordinatlarda (gövde x 3…15, y 0…8). Önizleme: `gjs -m` ile `paintScene` çağrılabilir.
- Kullanıma göre: ≥80 terler, 100 kızarır ve yalnızca yorgun hareketler (kahve, pil, yükleniyor…) yapar.
- 5 dk dokunulmazsa ya da token yoksa uyur (zZ, 2 fps). Ekran kilitliyken eklenti zaten kapalıdır.
- Yerleşim: sistem simgelerinin (ağ/ses/pil) hemen solunda. Claude masaüstü uygulamasının tepsi simgesi
  (`Claude_status_icon`) gizlenir; eklenti kapatılınca geri gelir.

## Veri nereden geliyor
- Token: `~/.claude/.credentials.json` (Claude Code CLI girişi). Tokenlar asla loglanmaz.
- Uç: `GET https://api.anthropic.com/api/oauth/usage` (CLI'ın `/usage` komutunun kullandığı, resmî olarak
  belgelenmemiş uç — ileride değişebilir). 3 dk'da bir + menü açılınca (veri 1 dk'dan eskiyse).
- Token yenileme: access token ~8 saatte bir biter. Bitişe 5 dk kala (ya da sunucu 401 verirse) eklenti
  CLI gibi `platform.claude.com/v1/oauth/token`'a refresh token gönderir ve yeni tokenları aynı dosyaya
  yazar (yazmadan önce dosyayı yeniden okur, diğer alanları korur, 0600 izni kalır).
  Başarısız olursa 30 dk bekler; refresh token geçersizse menü `claude` → `/login` der.
- İlk kurulumdan önce yedek önerilir: `cp -p ~/.claude/.credentials.json ~/.claude/.credentials.json.yedek`
  (geri dönerken eski token zaten yenilenmişse geçersiz olabilir; o durumda `claude` → `/login`).

## Gereksinimler
- GNOME Shell 46
- Claude Code CLI ile giriş yapılmış olmalı (`claude` → `/login`); `~/.claude/.credentials.json` oluşur.

## Kurulum / kaldırma
```bash
git clone git@github.com:UnkNoWn17171/claude-usage.git ~/.local/share/gnome-shell/extensions/claude-usage@mustafa
gnome-extensions enable claude-usage@mustafa     # X11: Alt+F2 → r ; Wayland: oturumu kapat-aç
gnome-extensions disable claude-usage@mustafa
rm -r ~/.local/share/gnome-shell/extensions/claude-usage@mustafa ~/.cache/claude-usage
```
Kod değişikliği ancak kabuk yeniden başlayınca yüklenir (GJS modülleri önbellekte kalır).

## Sorun giderme
```bash
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -iE 'claude-usage|clawd'
```
- Son API yanıtı (token içermez): `~/.cache/claude-usage/son-yanit.json`. Menüde yalnızca `five_hour` ve
  `seven_day*` limitleri gösterilir; iç kod adlı alanlar (`iguana_necktie` vb.) gizlenir (`SHOW_OTHER_LIMITS`).
- `HTTP 429`: çok sık sorgu; eklenti 15 dk bekleyip devam eder.
- `HTTP 401` / uyuyor: token süresi dolmuş (yukarıya bakın).
