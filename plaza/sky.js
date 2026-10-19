/*
 * にゃらゲームプラザ — 大須の空。
 * 天気は名古屋の実際の天気（shared/weather.js。菌糸ライフと同じ記録・同じ取得の回数を使う）、
 * 時間帯は日本時間の時刻で決まる。朝・昼・夕・夜の境目は、名古屋のおおよその日の出・日の入りから出す。
 * 空模様の決め方（台風・長雨・猛暑・初霜・雨）は菌糸ライフの窓の空とそろえてある。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const WX = RA.Weather;
  const Plaza = window.Plaza;
  const { bayer, seeded, makeCanvas, pix, clamp, jstNow } = Plaza.kit;

  const SKY_H = 140; // 空の色をつなぐ高さ（その下は地平の色のまま）

  // ===== 名古屋の天気 =====
  let wx = WX.load();
  let fetching = null;

  // 1時間たっていれば取りに行く（菌糸ライフと記録を共有しているので、どちらで取っても数は1回）
  function check() {
    if (!fetching && WX.due(wx, Date.now())) {
      fetching = WX.update(Date.now()).then((rec) => {
        wx = rec;
        fetching = null;
      });
    }
    return fetching;
  }

  // 確認用（?debug=1）に固定する時間帯・空模様。null は実際のまま
  const TODS = ['morning', 'day', 'evening', 'night'];
  const TOD_NAME = { morning: '朝', day: '昼', evening: '夕', night: '夜' };
  const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm', 'heat', 'frost'];
  const debug = { tod: null, weather: null };

  // 名古屋のおおよその日の出・日の入り（時）。夏至に 4.45時・19.15時、冬至に 6.75時・16.65時
  function sunHours(doy) {
    const c = Math.cos((2 * Math.PI * (doy - 172)) / 365);
    return { rise: 5.6 - 1.15 * c, set: 17.9 + 1.25 * c };
  }

  /*
   * いまの空。
   *   tod    … 'morning' | 'day' | 'evening' | 'night'（日の出の30分前〜2.5時間後が朝、日の入りの1時間前〜35分後が夕）
   *   mood   … 'clear' | 'cloudy' | 'storm' | 'heat' | 'frost'
   *   fall   … 降るもの（'rain' | 'storm' | 'snow' | null）
   *   drift  … 舞うもの（'gust' | 'twinkle' | 'petal' | 'leaf' | null）
   *   sunK   … 日の出から日の入りまでの進み（0〜1）、moonK は夜の進み
   *   lit    … 店や街の灯りがつく時間か（夕と夜）
   */
  function state(ms) {
    const t = jstNow(ms);
    const sun = sunHours(t.doy);
    const h = t.h;
    let tod = h < sun.rise - 0.5 || h >= sun.set + 0.6 ? 'night' : h < sun.rise + 2.5 ? 'morning' : h < sun.set - 1 ? 'day' : 'evening';
    if (debug.tod) tod = debug.tod;

    const rec = wx && wx.at <= ms && ms < wx.at + WX.VALID ? wx : null;
    const day = (wx && WX.dayEvents(wx, WX.jst(ms).date)) || {};
    const now = rec ? WX.nowEvents(rec) : {};
    const season = WX.SEASONS[WX.seasonAt(ms)].id;
    const raining = !!(rec && rec.now.p > 0);
    // 天候イベントの優先順は菌糸ライフと同じ（台風・猛暑・長雨・初霜）
    const ev = now.typhoon ? 'typhoon' : now.heat ? 'heat' : day.rain3 ? 'rain3' : day.frost ? 'frost' : null;
    let mood = 'clear';
    let fall = null;
    let drift = null;
    if (ev === 'typhoon') {
      mood = 'storm';
      fall = 'storm';
      drift = 'gust';
    } else if (ev === 'rain3' || raining) {
      mood = 'cloudy';
      fall = rec && rec.now.t <= 1 ? 'snow' : 'rain';
    } else if (ev === 'heat') {
      mood = 'heat';
    } else if (ev === 'frost') {
      mood = 'frost';
      drift = 'twinkle';
    } else if (season === 'rainy') {
      mood = 'cloudy';
    }
    if (debug.weather) {
      const k = debug.weather;
      mood = { rain: 'cloudy', snow: 'cloudy', storm: 'storm' }[k] || k;
      fall = { rain: 'rain', snow: 'snow', storm: 'storm' }[k] || null;
      drift = { storm: 'gust', frost: 'twinkle' }[k] || null;
    }
    if (!fall && !drift) drift = { spring: 'petal', autumn: 'leaf' }[season] || null;

    const span = sun.set - sun.rise;
    const sunK = clamp((h - sun.rise) / span, 0, 1);
    const moonK = clamp((((h - sun.set) % 24) + 24) % 24 / (24 - span), 0, 1);
    return { tod, mood, fall, drift, sunK, moonK, lit: tod === 'evening' || tod === 'night', season, ev, rec };
  }

  // ===== 空の素材 =====
  // 時間帯と空模様ごとの、上・中・下の色（あいだはディザでつなぐ）。夕と夜は菌糸ライフの窓と同じ
  const SKY_COLORS = {
    clear: { morning: ['blue', 'cyan', 'gold'], day: ['blue', 'blue', 'cyan'], evening: ['night', 'maroon', 'orange'], night: ['ink', 'night', 'dusk'] },
    cloudy: { morning: ['mist', 'silver', 'cream'], day: ['mist', 'silver', 'silver'], evening: ['night', 'dusk', 'mist'], night: ['ink', 'night', 'night'] },
    storm: { morning: ['night', 'dusk', 'mist'], day: ['night', 'dusk', 'mist'], evening: ['ink', 'night', 'dusk'], night: ['ink', 'ink', 'night'] },
    heat: { morning: ['cyan', 'cyan', 'gold'], day: ['cyan', 'cyan', 'white'], evening: ['maroon', 'red', 'orange'], night: ['night', 'dusk', 'maroon'] },
    frost: { morning: ['blue', 'cyan', 'white'], day: ['blue', 'cyan', 'white'], evening: ['night', 'blue', 'cyan'], night: ['ink', 'night', 'blue'] },
  };
  const skyCache = {};

  function skyBase(mood, tod) {
    const key = mood + tod;
    if (skyCache[key]) return skyCache[key];
    const stops = SKY_COLORS[mood][tod];
    const c = makeCanvas(W, SKY_H);
    const g = c.getContext('2d');
    for (let y = 0; y < SKY_H; y++) {
      const pos = (y / (SKY_H - 1)) * 2;
      const seg = Math.min(1, Math.floor(pos));
      for (let x = 0; x < W; x++) {
        g.fillStyle = P[bayer(x, y) < pos - seg ? stops[seg + 1] : stops[seg]];
        g.fillRect(x, y, 1, 1);
      }
    }
    return (skyCache[key] = c);
  }

  // 丸を重ねた雲（上を top、下の影を shade で塗る）
  function paintCloud(w, h, seed, top, shade) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const rnd = seeded(seed);
    const blobs = Array.from({ length: 4 }, (_, i) => ({ x: w * (0.2 + (0.6 * i) / 3), y: h * (0.6 + rnd() * 0.15), r: h * (0.32 + rnd() * 0.22) }));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!blobs.some((b) => (x - b.x) ** 2 + ((y - b.y) * 1.5) ** 2 < b.r * b.r)) continue;
        g.fillStyle = P[y > h * 0.62 ? shade : top];
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  const CLOUDS = {
    cloudy: { morning: ['cream', 'silver'], day: ['silver', 'mist'], evening: ['mist', 'dusk'], night: ['dusk', 'night'] },
    storm: { morning: ['mist', 'dusk'], day: ['mist', 'dusk'], evening: ['dusk', 'night'], night: ['night', 'ink'] },
  };
  const cloudCache = {};

  function cloudsOf(mood, tod) {
    const key = mood + tod;
    if (!cloudCache[key]) {
      const [top, shade] = CLOUDS[mood][tod];
      cloudCache[key] = [
        [52, 16, 3],
        [70, 20, 4],
        [40, 13, 5],
      ].map(([w, h, s]) => paintCloud(w, h, s, top, shade));
    }
    return cloudCache[key];
  }

  // 夏の昼の入道雲
  const THUNDERHEAD = (() => {
    const c = makeCanvas(48, 36);
    const g = c.getContext('2d');
    [
      [24, 10, 10],
      [14, 18, 10],
      [34, 17, 11],
      [24, 26, 15],
    ].forEach(([cx, cy, r]) => {
      for (let y = 0; y < 36; y++) {
        for (let x = 0; x < 48; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 >= r * r) continue;
          g.fillStyle = P[x > cx + r * 0.35 || y > 29 ? 'silver' : 'white'];
          g.fillRect(x, y, 1, 1);
        }
      }
    });
    return c;
  })();

  const STARS = (() => {
    const rnd = seeded(21);
    return Array.from({ length: 30 }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 80), p: 500 + Math.floor(rnd() * 900) }));
  })();

  // 降る・舞う粒の置き場所（0〜1）
  const PARTS = (() => {
    const rnd = seeded(13);
    return Array.from({ length: 90 }, () => ({ x: rnd(), y: rnd(), v: rnd(), ph: rnd() * 6.28 }));
  })();

  // 太陽（色を変えて猛暑・朝夕にも使う）
  function sun(g, x, y, core, ray, ts) {
    pix(g, ['.ooo.', 'ooooo', 'ooooo', 'ooooo', '.ooo.'], x - 2, y - 2, { o: core });
    if (Math.floor(ts / 400) % 2) {
      g.fillStyle = P[ray];
      [
        [-4, 0],
        [4, 0],
        [0, -4],
        [0, 4],
        [-3, -3],
        [3, -3],
        [-3, 3],
        [3, 3],
      ].forEach(([dx, dy]) => g.fillRect(x + dx, y + dy, 1, 1));
    }
  }

  // 日・月の高さ（k は 0〜1。真ん中がいちばん高い）
  const arcY = (k) => 12 + Math.round(44 * (k * 2 - 1) ** 2);
  const arcX = (k) => 16 + Math.round(k * 224);

  let thunderAt = -1;

  // 空を描く。返り値の thunder が true の瞬間に雷を鳴らす
  function draw(g, st, ts) {
    const clear = st.mood !== 'cloudy' && st.mood !== 'storm';
    g.drawImage(skyBase(st.mood, st.tod), 0, 0);
    g.fillStyle = P[SKY_COLORS[st.mood][st.tod][2]];
    g.fillRect(0, SKY_H, W, RA.H - SKY_H);
    let flash = false;
    let thunder = false;
    if (st.mood === 'storm') {
      const n = Math.floor(ts / 7000);
      const ph = ts % 7000;
      flash = ph < 200 && Math.floor(ph / 70) !== 1;
      if (ph < 200 && n !== thunderAt) {
        thunderAt = n;
        thunder = true;
      }
      if (flash) {
        g.fillStyle = P.mist;
        g.fillRect(0, 0, W, RA.H);
      }
    }
    if (clear && st.tod === 'night') {
      STARS.forEach((s, i) => {
        if (!(Math.floor(ts / s.p + i) % 4)) return;
        g.fillStyle = P[i % 3 ? 'silver' : 'white'];
        g.fillRect(s.x, s.y, 1, 1);
      });
      pix(g, ['..ccc', '.cc..', 'cc...', 'cc...', 'cc...', '.cc..', '..ccc'], arcX(st.moonK) - 2, arcY(st.moonK) - 3, { c: 'cream' });
    } else if (clear) {
      const x = arcX(st.sunK);
      const y = arcY(st.sunK);
      if (st.mood === 'heat') sun(g, x, y, 'white', 'gold', ts);
      else if (st.tod === 'day') sun(g, x, y, 'gold', 'gold', ts);
      else sun(g, x, y, 'orange', 'gold', ts);
    }
    if (!clear) {
      const set = cloudsOf(st.mood, st.tod);
      const speed = st.mood === 'storm' ? 34 : 3;
      for (let i = 0; i < 7; i++) {
        const c = set[i % 3];
        const span = W + c.width;
        const x = Math.round((((i * 97 + (ts / 1000) * speed * (1 + (i % 3) * 0.3)) % span) + span) % span) - c.width;
        g.drawImage(c, x, ((i * 11) % 34) - 4);
      }
    }
    if (flash) {
      const bx = 50 + ((Math.floor(ts / 7000) * 53) % 150);
      g.fillStyle = P.white;
      for (let y = 0, x = bx; y < 96; y += 3, x += ((y * 7) % 5) - 2) g.fillRect(x, y, 1, 3);
    }
    if (st.mood === 'clear' && st.tod === 'day' && st.season === 'summer') g.drawImage(THUNDERHEAD, 150, 34);
    return { flash, thunder };
  }

  /*
   * 降る・舞う粒を、範囲 (x0, y0, w, h) に n 個描く。
   * skip(x, y) が true の点は描かない（アーケードや軒の下には雨が降らない）
   */
  function particles(g, kind, x0, y0, w, h, ts, n, skip) {
    const s = ts / 1000;
    const wrap = (v, m) => ((v % m) + m) % m;
    const dot = (color, x, y, dw, dh) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < x0 || y < y0 || x + (dw || 1) > x0 + w || y + (dh || 1) > y0 + h) return;
      if (skip && skip(x, y)) return;
      g.fillStyle = P[color];
      g.fillRect(x, y, dw || 1, dh || 1);
    };
    for (let i = 0; i < Math.min(n, PARTS.length); i++) {
      const p = PARTS[i];
      if (kind === 'rain') {
        dot(i % 3 ? 'cyan' : 'silver', x0 + p.x * w, y0 + wrap(p.y * h + s * (130 + p.v * 70), h + 4) - 4, 1, 3);
      } else if (kind === 'storm') {
        const y = wrap(p.y * h + s * (170 + p.v * 70), h + 6) - 6;
        const x = x0 + wrap(p.x * w + y * 1.2 + s * 40, w);
        for (let k = 0; k < 3; k++) dot(i % 3 ? 'silver' : 'cyan', x - k, y0 + y + k * 1.2);
      } else if (kind === 'snow') {
        dot(i % 2 ? 'white' : 'cream', x0 + wrap(p.x * w + Math.sin(s + p.ph) * 3, w), y0 + wrap(p.y * h + s * (10 + p.v * 10), h));
      } else if (kind === 'petal') {
        if (i % 3) continue;
        dot('pink', x0 + wrap(p.x * w + s * (10 + p.v * 6), w), y0 + wrap(p.y * h + s * (6 + p.v * 5) + Math.sin(s * 2 + p.ph) * 2, h), 2, 1);
      } else if (kind === 'leaf') {
        if (i % 3) continue;
        const color = ['orange', 'red', 'gold'][(i / 3) % 3];
        const y = y0 + wrap(p.y * h + s * (7 + p.v * 6), h);
        dot(color, x0 + wrap(p.x * w + Math.sin(s * 1.5 + p.ph) * 4, w), y, 2, Math.floor(s * 3 + p.ph) % 2 ? 1 : 2);
      } else if (kind === 'gust') {
        if (i % 2) continue;
        const color = ['cream', 'green', 'brown', 'cyan'][(i / 2) % 4];
        dot(color, x0 + wrap(p.x * w + s * (90 + p.v * 70), w + 8) - 8, y0 + wrap(p.y * h + Math.sin(s * 3 + p.ph) * 4 + s * 6, h), 2, 1);
      } else if (kind === 'twinkle') {
        if (i % 4 || Math.floor(s * 2 + p.ph) % 3) continue;
        const x = x0 + Math.round(p.x * (w - 4)) + 2;
        const y = y0 + Math.round(p.y * (h - 4)) + 2;
        dot('white', x, y);
        dot('cyan', x - 1, y);
        dot('cyan', x + 1, y);
        dot('cyan', x, y - 1);
        dot('cyan', x, y + 1);
      }
    }
  }

  // ===== 札に出す名古屋の天気 =====
  // 9×9 ドットの天気の絵（菌糸ライフの札と同じ絵）
  const ICONS = {
    sun: ['....g....', '.g.....g.', '...ggg...', '..ggggg..', 'g.ggggg.g', '..ggggg..', '...ggg...', '.g.....g.', '....g....'],
    moon: ['..ccc....', '.cc......', 'cc.......', 'cc.......', 'cc.......', 'cc.......', '.cc...c..', '..ccccc..', '.........'],
    cloud: ['.........', '...sss...', '.sssssss.', 'sssssssss', 'sssssssss', '.sssssss.', '.........', '.........', '.........'],
    rain: ['...sss...', '.sssssss.', 'sssssssss', '.sssssss.', '.........', '.C..C..C.', 'C..C..C..', '.........', '.........'],
    snow: ['...sss...', '.sssssss.', 'sssssssss', '.sssssss.', '.........', '.W..W..W.', '...W..W..', '.........', '.........'],
    storm: ['..CCCC...', '.C....C..', 'C..CC..C.', 'C.C..C.C.', 'C.C.CC.C.', 'C..C...C.', '.C....C..', '..CCCC...', '.........'],
    heat: ['....r....', '.r.....r.', '...ooo...', '..oWWoo..', 'r.oWooo.r', '..ooooo..', '...ooo...', '.r.....r.', '....r....'],
    frost: ['....W....', '.W..W..W.', '..W.W.W..', '...WWW...', 'WWWWCWWWW', '...WWW...', '..W.W.W..', '.W..W..W.', '....W....'],
  };
  const ICON_COLORS = { g: 'gold', c: 'cream', s: 'silver', C: 'cyan', W: 'white', o: 'orange', r: 'red' };

  function icon(g, x, y, st) {
    let name = st.tod === 'night' ? 'moon' : 'sun';
    if (st.fall) name = st.fall;
    else if (st.mood !== 'clear') name = st.mood === 'cloudy' ? 'cloud' : st.mood;
    g.fillStyle = P.ink;
    g.fillRect(x - 1, y - 1, 11, 11);
    pix(g, ICONS[name], x, y, ICON_COLORS);
  }

  // 「名古屋 18°C」。取れずに代用しているあいだは灰色にする
  function readout() {
    return { text: '名古屋 ' + (wx ? Math.round(wx.now.t) + '°C' : '--°C'), real: !!(wx && wx.src === 'api') };
  }

  Plaza.sky = {
    SKY_H,
    TODS,
    TOD_NAME,
    WEATHERS,
    debug,
    check,
    state,
    draw,
    particles,
    icon,
    readout,
    get record() {
      return wx;
    },
  };
})();
