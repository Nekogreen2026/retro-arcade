/*
 * にゃらゲームプラザ — 画面3 店内（1996年）。
 * 左から クレーンゲーム／筐体（games.js の一覧どおり。空き台は「調整中」）／両替機（上に1996年のカレンダー）／プリクラ機。
 * 筐体を選ぶとそのゲームへ入る。ほかの機械は、押すと少しだけ動いて音が鳴る。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;
  const Plaza = window.Plaza;
  const { bayer, seeded, makeCanvas, painter, pix, clamp, jstNow } = Plaza.kit;
  const GAMES = (window.GAMES || []).filter((g) => g && g.id);
  const MOBILE = RA.isMobile();

  // ===== 配置 =====
  const CAB_W = 48;
  const PITCH = 62; // 筐体の間隔
  const EDGE = 11; // 選んだものを画面の端からこれだけ離す
  const CAB_TOP = 50;
  const FLOOR_Y = 152;
  const STRIP_Y = 186; // 操作説明の帯
  const PANEL_Y = 198; // 説明パネル
  const MIN_SLOTS = 4; // 台数が少ないときは調整中の筐体で埋める
  const SLOTS = Math.max(MIN_SLOTS, GAMES.length);
  const UFO = { x: 8, w: 64 };
  const CAB0 = 84;
  const slotX = (i) => CAB0 + i * PITCH;
  const CHANGER = { x: slotX(SLOTS - 1) + CAB_W + 18, w: 40 };
  const CAL = { x: CHANGER.x - 6, y: 14, w: 52, h: 70 };
  const PHOTO = { x: CHANGER.x + CHANGER.w + 12, w: 88 };
  const ROOM_W = PHOTO.x + PHOTO.w + 8;
  const MAX_CAM = Math.max(0, ROOM_W - W);

  const ITEMS = [
    { kind: 'ufo', x: UFO.x, w: UFO.w, top: 40, title: 'クレーンゲーム', desc: '景品は猫ときのこのぬいぐるみ。', color: 'pink' },
    ...Array.from({ length: SLOTS }, (_, i) => {
      const g = GAMES[i];
      if (g) return { kind: 'game', game: g, i, x: slotX(i), w: CAB_W, top: CAB_TOP, title: g.title, desc: g.desc, color: g.color || 'gold' };
      return { kind: 'empty', i, x: slotX(i), w: CAB_W, top: CAB_TOP, title: '調整中', desc: '新しい台が入る予定。', color: 'silver' };
    }),
    { kind: 'changer', x: CHANGER.x, w: CHANGER.w, top: 88, title: '両替機', desc: '千円札を百円玉にくずせる。', color: 'gold' },
    { kind: 'photo', x: PHOTO.x, w: PHOTO.w, top: 36, title: 'ぷりにゃん', desc: '撮って貼れる、写真のシール。', color: 'pink' },
  ];

  // ===== 状態 =====
  const lastId = RA.Store.get(['top', 'last-game'], null);
  let sel = Math.max(0, ITEMS.findIndex((it) => it.kind === 'game' && it.game.id === lastId));
  if (ITEMS[sel].kind !== 'game') sel = Math.max(0, ITEMS.findIndex((it) => it.kind === 'game'));
  let cam = 0;
  let camTarget = 0;
  let clawAt = -1e9; // クレーンが降りはじめた時刻
  let coinsAt = -1e9;
  let photoAt = -1e9;

  const exitBtn = new RA.Button({ x: 4, y: 4, w: 84, h: 20, label: '外に出る', icon: 'back' });

  function follow() {
    const it = ITEMS[sel];
    if (it.x - camTarget < EDGE) camTarget = it.x - EDGE;
    if (it.x + it.w - camTarget > W - EDGE) camTarget = it.x + it.w - (W - EDGE);
    camTarget = clamp(camTarget, 0, MAX_CAM);
  }
  follow();
  cam = camTarget;

  // ===== 筐体の画面に映す絵 =====
  const thumbs = GAMES.map((g) => {
    const list = g.thumb ? (Array.isArray(g.thumb) ? g.thumb : [g.thumb]) : [];
    return list.map((src) => {
      const im = new Image();
      im.src = 'games/' + g.id + '/' + src;
      return im;
    });
  });

  // ===== 店の中（壁・床・据え置きの機械）を一度だけ描く =====
  let room = null;
  let roomDay = '';

  function roomOf() {
    const t = jstNow(Date.now());
    const day = t.m + '/' + t.d; // カレンダーの「今日」が変わったら描き直す
    if (!room || roomDay !== day) {
      room = paintRoom(t);
      roomDay = day;
    }
    return room;
  }

  function repaint() {
    room = null;
  }

  function paintRoom(t) {
    const c = makeCanvas(ROOM_W, H);
    const g = c.getContext('2d');
    const R = painter(g);
    // 壁と腰板
    R('night', 0, 0, ROOM_W, FLOOR_Y);
    R('dusk', 0, 128, ROOM_W, 1);
    for (let x = 0; x < ROOM_W; x += 16) R('ink', x, 129, 1, FLOOR_Y - 129);
    R('ink', 0, 0, ROOM_W, 6);
    // 床（ゲーセンの派手なじゅうたん）
    R('ink', 0, FLOOR_Y, ROOM_W, H - FLOOR_Y);
    const rnd = seeded(77);
    const marks = ['pink', 'cyan', 'gold', 'blue'];
    for (let ty = FLOOR_Y + 2; ty < STRIP_Y - 2; ty += 8) {
      for (let tx = (ty / 8) % 2 ? 0 : 6; tx < ROOM_W; tx += 12) {
        const color = marks[Math.floor(rnd() * marks.length)];
        const shape = Math.floor(rnd() * 3);
        if (shape === 0) {
          R(color, tx, ty, 1, 1);
          R(color, tx + 1, ty + 1, 1, 1);
          R(color, tx + 2, ty + 2, 1, 1);
        } else if (shape === 1) {
          R(color, tx + 1, ty, 1, 3);
          R(color, tx, ty + 1, 3, 1);
        } else {
          R(color, tx, ty + 1, 2, 1);
        }
      }
    }
    // 天井灯から落ちる光（ディザで薄く）
    ITEMS.forEach((it) => cone(g, R, it.x + it.w / 2));
    // 天井から吊った「1PLAY 50円」
    for (let i = 0; i + 1 < SLOTS; i += 2) pop(g, R, slotX(i) + CAB_W + (PITCH - CAB_W) / 2);
    paintUfo(g, R);
    paintCalendar(g, R, t);
    paintChanger(g, R);
    paintPhoto(g, R);
    // 床の手前の帯（操作説明）
    R('ink', 0, STRIP_Y, ROOM_W, H - STRIP_Y);
    R('dusk', 0, STRIP_Y, ROOM_W, 1);
    return c;
  }

  function cone(g, R, cx) {
    for (let y = 6; y < FLOOR_Y; y++) {
      const half = 6 + ((y - 6) / (FLOOR_Y - 6)) * 32;
      for (let x = Math.ceil(cx - half); x < cx + half; x++) if (bayer(x, y) < 0.32) R('dusk', x, y, 1, 1);
    }
    R('silver', cx - 8, 3, 16, 2);
    R('cream', cx - 6, 5, 12, 1);
  }

  function pop(g, R, cx) {
    const x = Math.round(cx - 23);
    R('silver', x + 6, 6, 1, 14);
    R('silver', x + 39, 6, 1, 14);
    R('ink', x, 20, 46, 29);
    R('gold', x + 1, 21, 44, 27);
    R('red', x + 1, 21, 44, 10);
    RA.text(g, '1PLAY', cx, 22, { font: 'en', color: 'cream', align: 'center' });
    RA.text(g, '50円', cx, 30, { color: 'red', align: 'center' });
  }

  // 景品のぬいぐるみ（猫ときのこ）
  const CAT = ['.o.....o.', '.oo...oo.', '.ooooooo.', 'oo.ooo.oo', 'oooopoooo', '.ooooooo.', '..ooooo..'];
  const MUSH = ['..rrrrr..', '.rrwrrrr.', 'rrrrrrwrr', 'rwrrrrrrr', '..ccccc..', '..c.c.c..', '..ccccc..'];
  const PRIZES = [
    ['cat', 'orange', 30, 110],
    ['mush', 'red', 40, 111],
    ['cat', 'cream', 50, 110],
    ['mush', 'gold', 59, 111],
    ['cat', 'silver', 34, 104],
    ['mush', 'brown', 44, 104],
    ['cat', 'orange', 53, 103],
    ['mush', 'pink', 39, 98],
    ['cat', 'cream', 48, 97],
    ['mush', 'green', 58, 98],
  ];

  function plush(g, kind, color, x, y) {
    if (kind === 'cat') pix(g, CAT, x, y, { o: color, p: 'pink' });
    else pix(g, MUSH, x, y, { r: color, w: 'white', c: 'cream' });
  }

  function paintUfo(g, R) {
    const x = UFO.x;
    // 看板
    R('ink', x, 40, UFO.w, 14);
    R('pink', x + 1, 41, UFO.w - 2, 12);
    RA.text(g, 'CATCHER', x + UFO.w / 2, 43, { font: 'en', color: 'cream', align: 'center' });
    // ガラスの箱
    R('ink', x, 54, UFO.w, 66);
    R('silver', x + 1, 54, 3, 66);
    R('silver', x + UFO.w - 4, 54, 3, 66);
    R('night', x + 4, 55, UFO.w - 8, 64);
    for (let y = 58; y < 118; y += 6) for (let k = 0; k < UFO.w - 8; k += 9) R('dusk', x + 5 + k + (Math.floor(y / 6) % 2) * 4, y, 1, 1);
    R('silver', x + 4, 57, UFO.w - 8, 1); // レール
    // 景品の取り出し口の囲い
    R('silver', x + 5, 100, 14, 1);
    R('silver', x + 18, 100, 1, 19);
    PRIZES.forEach(([kind, color, px, py]) => plush(g, kind, color, px, py));
    for (let k = 0; k < 10; k++) R('white', x + 50 + k, 64 + k * 2, 1, 1); // ガラスの映り込み
    // 台
    R('ink', x - 2, 120, UFO.w + 4, 32);
    R('pink', x - 1, 121, UFO.w + 2, 30);
    R('silver', x - 1, 121, UFO.w + 2, 4);
    R('ink', x + 26, 127, 8, 6);
    R('ink', x + 38, 127, 8, 6);
    R('red', x + 27, 128, 6, 4);
    R('cyan', x + 39, 128, 6, 4);
    pix(g, ['..c..', '.ccc.', 'ccccc'], x + 28, 128, { c: 'cream' });
    pix(g, ['c.', 'cc', 'ccc', 'cc', 'c.'].map((r) => r.padEnd(3, '.')), x + 40, 128, { c: 'cream' });
    R('ink', x + 54, 128, 2, 6); // 硬貨の口
    R('ink', x + 4, 132, 16, 15); // 景品の取り出し口
    R('dusk', x + 5, 133, 14, 13);
    R('ink', x - 2, FLOOR_Y - 4, UFO.w + 4, 4);
  }

  function paintCalendar(g, R, t) {
    const { x, y, w, h } = CAL;
    R('silver', x + w / 2, y - 2, 1, 2);
    R('ink', x, y, w, h);
    R('cream', x + 1, y + 1, w - 2, h - 2);
    R('red', x + 1, y + 1, w - 2, 17);
    RA.text(g, Plaza.YEAR + '年', x + w / 2, y + 1, { color: 'cream', align: 'center' });
    RA.text(g, t.m + '月', x + w / 2, y + 18, { color: 'ink', align: 'center' });
    // 1996年の、今日と同じ月の暦（日曜は朱、土曜は瑠璃。今日に丸）
    const first = new Date(Date.UTC(Plaza.YEAR, t.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(Plaza.YEAR, t.m, 0)).getUTCDate();
    for (let dd = 1; dd <= days; dd++) {
      const col = (first + dd - 1) % 7;
      const row = Math.floor((first + dd - 1) / 7);
      const cx = x + 5 + col * 6;
      const cy = y + 38 + row * 5;
      R(col === 0 ? 'red' : col === 6 ? 'blue' : 'ink', cx, cy, 3, 2);
      if (dd === t.d) {
        R('red', cx - 1, cy - 2, 5, 1);
        R('red', cx - 1, cy + 3, 5, 1);
        R('red', cx - 2, cy - 1, 1, 4);
        R('red', cx + 4, cy - 1, 1, 4);
      }
    }
  }

  function paintChanger(g, R) {
    const x = CHANGER.x;
    const w = CHANGER.w;
    R('ink', x, 88, w, FLOOR_Y - 88);
    R('silver', x + 1, 89, w - 2, FLOOR_Y - 90);
    R('mist', x + w - 5, 89, 4, FLOOR_Y - 90);
    R('ink', x + 3, 91, 34, 18);
    R('cream', x + 4, 92, 32, 16);
    RA.text(g, '両替', x + w / 2, 91, { color: 'red', align: 'center' });
    R('ink', x + 8, 114, 24, 3); // お札の入れ口
    R('ink', x + 6, 124, 8, 5);
    R('ink', x + 16, 124, 8, 5);
    R('ink', x + 26, 124, 8, 5);
    R('cream', x + 7, 125, 6, 3);
    R('cream', x + 17, 125, 6, 3);
    R('cream', x + 27, 125, 6, 3);
    R('ink', x + 8, 136, 24, 10); // 受け皿
    R('dusk', x + 9, 137, 22, 8);
    R('ink', x, FLOOR_Y - 4, w, 4);
  }

  function paintPhoto(g, R) {
    const x = PHOTO.x;
    const w = PHOTO.w;
    R('ink', x, 36, w, 20);
    R('pink', x + 1, 37, w - 2, 18);
    RA.text(g, 'ぷりにゃん', x + w / 2, 37, { color: 'cream', align: 'center', outline: 'maroon' });
    R('ink', x, 56, w, FLOOR_Y - 56);
    // 左: 写真の見本と撮影の窓
    R('cream', x + 1, 57, 39, FLOOR_Y - 58);
    const SAMPLE = ['pink', 'cyan', 'gold', 'green', 'orange', 'blue'];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 3; i++) {
        const sx = x + 4 + i * 12;
        const sy = 61 + j * 12;
        R('ink', sx, sy, 11, 11);
        R(SAMPLE[(i + j * 2) % SAMPLE.length], sx + 1, sy + 1, 9, 9);
        pix(g, ['c...c', 'ccccc', 'ckckc', 'ccccc', '.ccc.'], sx + 3, sy + 3, { c: 'cream', k: 'ink' });
      }
    }
    R('ink', x + 5, 112, 30, 18);
    R('night', x + 6, 113, 28, 16);
    R('cyan', x + 7, 114, 26, 1);
    R('ink', x + 18, 136, 4, 6); // 硬貨の口
    // 右: カーテン
    R('pink', x + 41, 57, w - 42, 83);
    for (let cx = x + 44; cx < x + w - 1; cx += 4) R('maroon', cx, 57, 1, 83);
    [
      [x + 50, 76],
      [x + 66, 96],
      [x + 54, 116],
      [x + 74, 70],
    ].forEach(([hx, hy]) => pix(g, ['c.c', 'ccc', '.c.'], hx, hy, { c: 'cream' }));
    R('maroon', x + 41, 138, w - 42, 2);
    R('ink', x + 41, 140, w - 42, FLOOR_Y - 140);
  }

  // ===== 毎フレーム重ねるもの =====
  function rect(g, color, x, y, w, h) {
    g.fillStyle = P[color];
    g.fillRect(x, y, w, h);
  }

  function drawThumb(g, i, x, y, ts) {
    const game = GAMES[i];
    const list = thumbs[i].filter((im) => im.complete && im.naturalWidth);
    if (!list.length) {
      RA.text(g, Array.from(game.title)[0] || '?', x + 20, y + 9, { color: game.color || 'cream', align: 'center' });
      return;
    }
    const im = list[Math.floor(ts / 1600) % list.length];
    let s = Math.floor(Math.min(32 / im.naturalWidth, 32 / im.naturalHeight));
    if (s < 1) s = Math.min(32 / im.naturalWidth, 32 / im.naturalHeight);
    const w = Math.round(im.naturalWidth * s);
    const h = Math.round(im.naturalHeight * s);
    g.drawImage(im, x + 4 + Math.round((32 - w) / 2), y + 1 + (32 - h), w, h);
  }

  // 看板の文字。入りきらなければ流す
  function drawMarquee(g, text, x, y, w, color, ts) {
    const tw = RA.textWidth(text);
    g.save();
    g.beginPath();
    g.rect(x, y, w, 18);
    g.clip();
    if (tw <= w) {
      RA.text(g, text, x + w / 2, y, { color, align: 'center' });
    } else {
      const loop = tw + 24;
      const off = Math.floor(ts / 40) % loop;
      RA.text(g, text, x + w - off, y, { color });
      RA.text(g, text, x + w - off + loop, y, { color });
    }
    g.restore();
  }

  function drawCabinet(g, i, x, ts) {
    const game = GAMES[i];
    const y = CAB_TOP;
    const lit = !!game;
    const body = lit ? 'silver' : 'mist';
    const shade = lit ? 'mist' : 'dusk';
    const R = (color, rx, ry, rw, rh) => rect(g, color, rx, ry, rw, rh);

    R('ink', x, y, CAB_W, FLOOR_Y - y);
    R(body, x + 1, y + 1, CAB_W - 2, 2);
    R(lit ? game.color || 'red' : 'dusk', x + 2, y + 3, CAB_W - 4, 17);
    if (lit) drawMarquee(g, game.title, x + 2, y + 2, CAB_W - 4, 'cream', ts);
    R(body, x + 1, y + 21, CAB_W - 2, 37);
    R(shade, x + 1, y + 21, 2, 37);
    R(shade, x + CAB_W - 3, y + 21, 2, 37);
    R('ink', x + 4, y + 23, 40, 34);
    if (lit) {
      R('night', x + 5, y + 24, 38, 32);
      drawThumb(g, i, x + 4, y + 23, ts);
      R('white', x + 6, y + 25, 2, 1);
    }
    R('ink', x - 2, y + 57, CAB_W + 4, 11);
    R(shade, x - 1, y + 58, CAB_W + 2, 9);
    R(body, x - 1, y + 58, CAB_W + 2, 2);
    R('ink', x + 11, y + 57, 1, 3);
    R(lit ? 'red' : 'maroon', x + 10, y + 55, 3, 3);
    R(lit ? 'gold' : 'dusk', x + 26, y + 61, 3, 2);
    R(lit ? 'cyan' : 'dusk', x + 32, y + 61, 3, 2);
    R(lit ? 'pink' : 'dusk', x + 38, y + 61, 3, 2);
    R(body, x + 1, y + 68, CAB_W - 2, FLOOR_Y - y - 72);
    R(shade, x + 1, y + 68, 2, FLOOR_Y - y - 72);
    R(shade, x + CAB_W - 3, y + 68, 2, FLOOR_Y - y - 72);
    if (lit) R(game.color || 'red', x + 5, y + 72, 2, 24);
    R('ink', x + 16, y + 74, 16, 20);
    R('dusk', x + 17, y + 75, 14, 18);
    R(lit ? 'orange' : 'night', x + 20, y + 78, 1, 4);
    R(lit ? 'orange' : 'night', x + 27, y + 78, 1, 4);
    R('ink', x + 20, y + 87, 8, 3);
    R('ink', x, FLOOR_Y - 4, CAB_W, 4);

    if (!lit) {
      // 調整中の札
      R('cream', x - 1, y + 30, CAB_W + 2, 20);
      R('silver', x + 3, y + 29, 4, 2);
      R('silver', x + CAB_W - 7, y + 29, 4, 2);
      RA.text(g, '調整中', x + CAB_W / 2, y + 31, { color: 'ink', align: 'center' });
    }
  }

  // クレーン（ふだんは左右に行き来し、押すと降りて、つかんで、空のまま戻る）
  function drawUfo(g, x, ts, now) {
    const s = (now - clawAt) / 1000;
    const busy = s >= 0 && s < 2.6;
    // 看板のまわりの電飾
    for (let k = 0; k < 16; k++) {
      const on = (k + Math.floor(ts / (busy ? 70 : 220))) % 2 === 0;
      rect(g, on ? 'gold' : 'maroon', x + 1 + k * 4, 40, 2, 1);
      rect(g, on ? 'maroon' : 'gold', x + 1 + k * 4, 53, 2, 1);
    }
    let cx = x + 32 + Math.round(Math.sin(ts / 1700) * 18);
    let drop = 0;
    let closed = false;
    if (busy) {
      cx = x + 44;
      if (s < 0.9) drop = s / 0.9;
      else if (s < 1.3) {
        drop = 1;
        closed = s > 1.05;
      } else if (s < 2.2) {
        drop = 1 - (s - 1.3) / 0.9;
        closed = true;
      }
    }
    const cy = 60 + Math.round(drop * 30);
    rect(g, 'mist', cx - 3, 56, 7, 3); // 台車
    rect(g, 'silver', cx, 59, 1, cy - 59); // ワイヤー
    pix(g, closed ? ['.gsg.', '.sss.', '..s..', '.s.s.', '.s.s.', '..s..'] : ['.gsg.', 'sssss', 's.s.s', 's...s', 's...s', '.s.s.'], cx - 2, cy, { s: 'silver', g: 'gold' });
  }

  function drawChanger(g, x, ts, now) {
    const on = Math.floor(ts / 500) % 2 === 0;
    rect(g, on ? 'green' : 'night', x + 16, 118, 8, 2); // お札の入れ口の灯り
    const s = (now - coinsAt) / 1000;
    if (s >= 0 && s < 1.2) {
      // 受け皿に百円玉が落ちてくる
      for (let k = 0; k < Math.min(10, Math.floor(s * 14)); k++) rect(g, k % 3 ? 'silver' : 'white', x + 10 + ((k * 7) % 19), 142 - (k % 3), 3, 2);
    } else if (Math.floor(ts / 1300) % 4 === 0) {
      rect(g, 'white', x + 22, 141, 1, 1);
    }
  }

  function drawPhoto(g, x, ts, now) {
    const s = now - photoAt;
    // 看板の星
    [
      [3, 39],
      [84, 50],
      [80, 39],
      [6, 50],
    ].forEach(([sx, sy], k) => Math.floor(ts / 350 + k) % 2 && rect(g, k % 2 ? 'gold' : 'white', x + sx, sy, 1, 1));
    // 撮影の光（カーテンのすきまから漏れる）
    if (s >= 0 && s < 900 && (s < 120 || (s > 600 && s < 720))) {
      rect(g, 'white', x + 41, 140, PHOTO.w - 42, FLOOR_Y - 140);
      rect(g, 'white', x + 41, 57, PHOTO.w - 42, 1);
      rect(g, 'white', x + 6, 113, 28, 16);
    }
  }

  function drawGlow(g, cx) {
    for (let y = 0; y < 14; y++) {
      const half = 36 * Math.sqrt(1 - (y / 14) ** 2);
      for (let x = Math.ceil(-half); x < half; x++) if (bayer(cx + x, y) < 0.5) rect(g, 'dusk', cx + x, FLOOR_Y + y, 1, 1);
    }
  }

  function drawArrowDown(g, x, y, color) {
    g.fillStyle = P[color];
    for (let i = 0; i < 4; i++) g.fillRect(x - 3 + i, y + i, 7 - i * 2, 1);
  }

  function drawPanel(g, ts) {
    rect(g, 'dusk', 2, PANEL_Y, W - 4, H - PANEL_Y - 2);
    rect(g, 'ink', 3, PANEL_Y + 1, W - 6, H - PANEL_Y - 4);
    const it = ITEMS[sel];
    RA.text(g, it.title, 10, PANEL_Y + 2, { color: it.color });
    if (it.kind === 'game' && Math.floor(ts / 400) % 2 === 0) RA.text(g, 'PLAY', 246, PANEL_Y + 6, { font: 'en', color: 'gold', align: 'right' });
    g.save();
    g.beginPath();
    g.rect(8, PANEL_Y + 20, W - 16, 18);
    g.clip();
    const tw = RA.textWidth(it.desc);
    if (tw <= W - 20) {
      RA.text(g, it.desc, 10, PANEL_Y + 20, { color: 'cream' });
    } else {
      const loop = tw + 32;
      const off = Math.floor(ts / 40) % loop;
      RA.text(g, it.desc, W - 8 - off, PANEL_Y + 20, { color: 'cream' });
      RA.text(g, it.desc, W - 8 - off + loop, PANEL_Y + 20, { color: 'cream' });
    }
    g.restore();
  }

  function drawSideArrow(g, x, y, dir, color) {
    g.fillStyle = P[color];
    for (let i = 0; i < 5; i++) g.fillRect(dir < 0 ? x + 4 - i : x + i, y + i, 1, 9 - i * 2);
  }

  // 店内を描く。o.hud が true なら「外に出る」・操作説明・説明パネルも
  function draw(g, ts, o) {
    const now = performance.now();
    const c = Math.round(cam);
    g.drawImage(roomOf(), c, 0, W, H, 0, 0, W, H);
    const it = ITEMS[sel];
    drawGlow(g, it.x - c + it.w / 2);
    drawUfo(g, UFO.x - c, ts, now);
    for (let i = 0; i < SLOTS; i++) {
      const x = slotX(i) - c;
      if (x > -CAB_W - 4 && x < W + 4) drawCabinet(g, i, x, ts);
    }
    drawChanger(g, CHANGER.x - c, ts, now);
    drawPhoto(g, PHOTO.x - c, ts, now);
    drawArrowDown(g, it.x - c + it.w / 2, it.top - 9 + (Math.floor(ts / 300) % 2), 'gold');
    if (!o.hud) return;
    if (c > 0) drawSideArrow(g, 1, 96, -1, 'gold');
    if (c < MAX_CAM) drawSideArrow(g, W - 6, 96, 1, 'gold');
    exitBtn.draw(g, ts);
    const hint = MOBILE ? 'TAP A CABINET TO PLAY' : '<- -> SELECT ENTER PLAY ESC OUT';
    RA.text(g, hint, 128, STRIP_Y + 3, { font: 'en', color: 'silver', align: 'center' });
    drawPanel(g, ts);
  }

  function update(dt) {
    cam += (camTarget - cam) * Math.min(1, dt * 12);
    if (Math.abs(camTarget - cam) < 0.5) cam = camTarget;
  }

  // ===== 操作 =====
  function select(i) {
    if (i === sel || !ITEMS[i]) return;
    sel = i;
    follow();
    RA.sfx.blip();
  }

  // 選んだものを使う。ゲームなら { type: 'game', game } を返す
  function activate(i, now) {
    const it = ITEMS[i];
    if (!it) return null;
    sel = i;
    follow();
    if (it.kind === 'game') return { type: 'game', game: it.game };
    if (it.kind === 'empty') RA.Audio.tone({ f: 140, dur: 0.12, vol: 0.12 });
    else if (it.kind === 'ufo') {
      if (now - clawAt > 2600) {
        clawAt = now;
        Plaza.sound.sfx.ufo();
      }
    } else if (it.kind === 'changer') {
      if (now - coinsAt > 1200) {
        coinsAt = now;
        Plaza.sound.sfx.coins();
      }
    } else if (it.kind === 'photo') {
      if (now - photoAt > 900) {
        photoAt = now;
        Plaza.sound.sfx.photo();
      }
    }
    return null;
  }

  function itemAt(x, y) {
    const c = Math.round(cam);
    return ITEMS.findIndex((it) => y >= it.top - 4 && y < FLOOR_Y && x >= it.x - c - 3 && x < it.x - c + it.w + 3);
  }

  function press(x, y, now) {
    if (exitBtn.hit(x, y)) {
      exitBtn.flash(now);
      return { type: 'exit' };
    }
    if (y >= 80 && y < 120) {
      if (x < EDGE - 1 && Math.round(cam) > 0) {
        select(sel - 1);
        return null;
      }
      if (x >= W - EDGE + 1 && Math.round(cam) < MAX_CAM) {
        select(sel + 1);
        return null;
      }
    }
    if (y >= PANEL_Y && y < H) return activate(sel, now);
    const i = itemAt(x, y);
    return i >= 0 ? activate(i, now) : null;
  }

  function move(x, y) {
    if (exitBtn.hit(x, y)) return;
    const i = itemAt(x, y);
    if (i >= 0) select(i);
  }

  function key(code, now) {
    if (code === 'ArrowLeft') select(sel - 1);
    else if (code === 'ArrowRight') select(sel + 1);
    else if (code === 'Enter' || code === 'Space') return activate(sel, now);
    else if (code === 'Escape' || code === 'Backspace') {
      exitBtn.flash(now);
      return { type: 'exit' };
    }
    return null;
  }

  const CHARS = ITEMS.map((it) => it.title + it.desc).join('') + '外に出る調整中年月円' + GAMES.map((g) => g.title).join('');

  Plaza.inside = { CHARS, draw, update, press, move, key, repaint };
})();
