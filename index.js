/*
 * トップページ — 夜のゲームセンターの店内。
 * games.js の一覧どおりに筐体を横に並べ、選んだ筐体のゲームへ入る。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;
  const GAMES = (window.GAMES || []).filter((g) => g && g.id);

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);

  // ===== 配置 =====
  const CAB_W = 48;
  const PITCH = 62; // 筐体の間隔
  const EDGE = 11; // 左右の余白
  const CAB_TOP = 50;
  const FLOOR_Y = 152;
  const STRIP_Y = 186; // 操作説明の帯
  const PANEL_Y = 198; // 説明パネル
  const MIN_SLOTS = 4; // 台数が少ないときは調整中の筐体で埋める
  const SLOTS = Math.max(MIN_SLOTS, GAMES.length);
  const MAX_CAM = Math.max(0, EDGE * 2 + (SLOTS - 1) * PITCH + CAB_W - W);
  const LEAVE_TIME = 420;
  const MOBILE = RA.isMobile();

  const slotX = (i) => EDGE + i * PITCH;
  const urlOf = (g) => 'games/' + g.id + '/index.html';

  // ===== 状態 =====
  const lastId = RA.Store.get(['top', 'last-game'], null);
  let sel = Math.max(0, GAMES.findIndex((g) => g.id === lastId));
  let cam = 0;
  let camTarget = 0;
  let leaving = null; // { at, url }
  let lastTs = 0;

  function follow() {
    const x = slotX(sel);
    if (x - camTarget < EDGE) camTarget = x - EDGE;
    if (x + CAB_W - camTarget > W - EDGE) camTarget = x + CAB_W - (W - EDGE);
    camTarget = Math.max(0, Math.min(MAX_CAM, camTarget));
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

  // ===== 背景（天井・壁・床）を一度だけ描く =====
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function paintRoom() {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    // 壁
    g.fillStyle = P.night;
    g.fillRect(0, 0, W, FLOOR_Y);
    // 腰板
    g.fillStyle = P.dusk;
    g.fillRect(0, 128, W, 1);
    g.fillStyle = P.ink;
    for (let x = 0; x < W; x += 16) g.fillRect(x, 129, 1, FLOOR_Y - 129);
    // 天井
    g.fillStyle = P.ink;
    g.fillRect(0, 0, W, 6);
    // 床（ゲーセンの派手なじゅうたん）
    g.fillStyle = P.ink;
    g.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    const rnd = seeded(77);
    const marks = ['pink', 'cyan', 'gold', 'blue'];
    for (let ty = FLOOR_Y + 2; ty < STRIP_Y - 2; ty += 8) {
      for (let tx = (ty / 8) % 2 ? 0 : 6; tx < W; tx += 12) {
        const color = marks[Math.floor(rnd() * marks.length)];
        const shape = Math.floor(rnd() * 3);
        g.fillStyle = P[color];
        if (shape === 0) {
          g.fillRect(tx, ty, 1, 1);
          g.fillRect(tx + 1, ty + 1, 1, 1);
          g.fillRect(tx + 2, ty + 2, 1, 1);
        } else if (shape === 1) {
          g.fillRect(tx + 1, ty, 1, 3);
          g.fillRect(tx, ty + 1, 3, 1);
        } else {
          g.fillRect(tx, ty + 1, 2, 1);
        }
      }
    }
    // 床の手前の帯（操作説明）と説明パネルの台
    g.fillStyle = P.ink;
    g.fillRect(0, STRIP_Y, W, H - STRIP_Y);
    g.fillStyle = P.dusk;
    g.fillRect(0, STRIP_Y, W, 1);
    return c;
  }

  // 天井灯から落ちる光（ディザで薄く）
  function paintCone() {
    const c = makeCanvas(76, FLOOR_Y);
    const g = c.getContext('2d');
    g.fillStyle = P.dusk;
    for (let y = 6; y < FLOOR_Y; y++) {
      const half = 6 + ((y - 6) / (FLOOR_Y - 6)) * 32;
      for (let x = Math.ceil(38 - half); x < 38 + half; x++) {
        if (bayer(x, y) < 0.32) g.fillRect(x, y, 1, 1);
      }
    }
    g.fillStyle = P.silver;
    g.fillRect(30, 3, 16, 2);
    g.fillStyle = P.cream;
    g.fillRect(32, 5, 12, 1);
    return c;
  }

  // 選んだ筐体の足もとの照り返し
  function paintGlow() {
    const c = makeCanvas(72, 14);
    const g = c.getContext('2d');
    g.fillStyle = P.dusk;
    for (let y = 0; y < 14; y++) {
      const half = 36 * Math.sqrt(1 - (y / 14) ** 2);
      for (let x = Math.ceil(36 - half); x < 36 + half; x++) if (bayer(x, y) < 0.5) g.fillRect(x, y, 1, 1);
    }
    return c;
  }

  const room = paintRoom();
  const cone = paintCone();
  const glow = paintGlow();

  // ===== 筐体 =====
  function rect(color, x, y, w, h) {
    ctx.fillStyle = P[color];
    ctx.fillRect(x, y, w, h);
  }

  function drawThumb(game, i, x, y, ts) {
    const list = thumbs[i].filter((im) => im.complete && im.naturalWidth);
    if (!list.length) {
      RA.text(ctx, Array.from(game.title)[0] || '?', x + 20, y + 9, { color: game.color || 'cream', align: 'center' });
      return;
    }
    const im = list[Math.floor(ts / 1600) % list.length];
    let s = Math.floor(Math.min(32 / im.naturalWidth, 32 / im.naturalHeight));
    if (s < 1) s = Math.min(32 / im.naturalWidth, 32 / im.naturalHeight);
    const w = Math.round(im.naturalWidth * s);
    const h = Math.round(im.naturalHeight * s);
    ctx.drawImage(im, x + 4 + Math.round((32 - w) / 2), y + 1 + (32 - h), w, h);
  }

  // 看板の文字。入りきらなければ流す
  function drawMarquee(text, x, y, w, color, ts) {
    const tw = RA.textWidth(text);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, 18);
    ctx.clip();
    if (tw <= w) {
      RA.text(ctx, text, x + w / 2, y, { color, align: 'center' });
    } else {
      const loop = tw + 24;
      const off = Math.floor(ts / 40) % loop;
      RA.text(ctx, text, x + w - off, y, { color });
      RA.text(ctx, text, x + w - off + loop, y, { color });
    }
    ctx.restore();
  }

  function drawCabinet(i, x, ts) {
    const game = GAMES[i];
    const y = CAB_TOP;
    const lit = !!game;
    const body = lit ? 'silver' : 'mist';
    const shade = lit ? 'mist' : 'dusk';

    // 外形
    rect('ink', x, y, CAB_W, FLOOR_Y - y);
    // 看板
    rect(body, x + 1, y + 1, CAB_W - 2, 2);
    rect(lit ? game.color || 'red' : 'dusk', x + 2, y + 3, CAB_W - 4, 17);
    if (lit) drawMarquee(game.title, x + 2, y + 2, CAB_W - 4, 'cream', ts);
    // 画面まわり
    rect(body, x + 1, y + 21, CAB_W - 2, 37);
    rect(shade, x + 1, y + 21, 2, 37);
    rect(shade, x + CAB_W - 3, y + 21, 2, 37);
    rect('ink', x + 4, y + 23, 40, 34);
    if (lit) {
      rect('night', x + 5, y + 24, 38, 32);
      drawThumb(game, i, x + 4, y + 23, ts);
      rect('white', x + 6, y + 25, 2, 1); // 画面の映り込み
    }
    // 操作盤（手前に少し張り出す）
    rect('ink', x - 2, y + 57, CAB_W + 4, 11);
    rect(shade, x - 1, y + 58, CAB_W + 2, 9);
    rect(body, x - 1, y + 58, CAB_W + 2, 2);
    rect('ink', x + 11, y + 57, 1, 3); // レバー
    rect(lit ? 'red' : 'maroon', x + 10, y + 55, 3, 3);
    rect(lit ? 'gold' : 'dusk', x + 26, y + 61, 3, 2);
    rect(lit ? 'cyan' : 'dusk', x + 32, y + 61, 3, 2);
    rect(lit ? 'pink' : 'dusk', x + 38, y + 61, 3, 2);
    // 下の胴
    rect(body, x + 1, y + 68, CAB_W - 2, FLOOR_Y - y - 72);
    rect(shade, x + 1, y + 68, 2, FLOOR_Y - y - 72);
    rect(shade, x + CAB_W - 3, y + 68, 2, FLOOR_Y - y - 72);
    if (lit) rect(game.color || 'red', x + 5, y + 72, 2, 24); // 側面の色帯
    // コインドア
    rect('ink', x + 16, y + 74, 16, 20);
    rect('dusk', x + 17, y + 75, 14, 18);
    rect(lit ? 'orange' : 'night', x + 20, y + 78, 1, 4);
    rect(lit ? 'orange' : 'night', x + 27, y + 78, 1, 4);
    rect('ink', x + 20, y + 87, 8, 3);
    // 蹴込み
    rect('ink', x, FLOOR_Y - 4, CAB_W, 4);

    if (!lit) {
      // 調整中の貼り紙
      rect('cream', x - 1, y + 30, CAB_W + 2, 20);
      rect('silver', x + 3, y + 29, 4, 2);
      rect('silver', x + CAB_W - 7, y + 29, 4, 2);
      RA.text(ctx, '調整中', x + CAB_W / 2, y + 31, { color: 'ink', align: 'center' });
    }
  }

  function drawArrowDown(x, y, color) {
    ctx.fillStyle = P[color];
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 3 + i, y + i, 7 - i * 2, 1);
  }

  function drawSideArrow(x, y, dir, color) {
    ctx.fillStyle = P[color];
    for (let i = 0; i < 5; i++) {
      const h = 9 - i * 2;
      ctx.fillRect(dir < 0 ? x + 4 - i : x + i, y + i, 1, h); // 先端の列が1ドット
    }
  }

  function drawSign(ts) {
    // ときどき瞬くネオン
    const r = ((Math.floor(ts / 70) * 2654435761) >>> 0) % 100;
    const on = r >= 3;
    RA.text(ctx, 'RETRO ARCADE', 128, 14, { font: 'en', size: 16, color: on ? 'pink' : 'dusk', outline: on ? 'maroon' : null, align: 'center' });
    rect(on ? 'cyan' : 'dusk', 40, 34, 176, 1);
    rect(on ? 'blue' : 'night', 40, 35, 176, 1);
  }

  function drawPanel(ts) {
    rect('dusk', 2, PANEL_Y, W - 4, H - PANEL_Y - 2);
    rect('ink', 3, PANEL_Y + 1, W - 6, H - PANEL_Y - 4);
    const game = GAMES[sel];
    if (!game) {
      RA.text(ctx, '筐体がありません', 128, PANEL_Y + 11, { color: 'silver', align: 'center' });
      return;
    }
    RA.text(ctx, game.title, 10, PANEL_Y + 2, { color: game.color || 'gold' });
    if (Math.floor(ts / 400) % 2 === 0) RA.text(ctx, 'PLAY', 246, PANEL_Y + 6, { font: 'en', color: 'gold', align: 'right' });
    if (game.desc) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(8, PANEL_Y + 20, W - 16, 18);
      ctx.clip();
      const tw = RA.textWidth(game.desc);
      if (tw <= W - 20) {
        RA.text(ctx, game.desc, 10, PANEL_Y + 20, { color: 'cream' });
      } else {
        const loop = tw + 32;
        const off = Math.floor(ts / 40) % loop;
        RA.text(ctx, game.desc, W - 8 - off, PANEL_Y + 20, { color: 'cream' });
        RA.text(ctx, game.desc, W - 8 - off + loop, PANEL_Y + 20, { color: 'cream' });
      }
      ctx.restore();
    }
  }

  function draw(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    cam += (camTarget - cam) * Math.min(1, dt * 12);
    if (Math.abs(camTarget - cam) < 0.5) cam = camTarget;
    const camX = Math.round(cam);

    ctx.drawImage(room, 0, 0);
    for (let i = 0; i < SLOTS; i++) ctx.drawImage(cone, slotX(i) - camX + CAB_W / 2 - 38, 0);
    drawSign(ts);
    if (GAMES[sel]) ctx.drawImage(glow, slotX(sel) - camX + CAB_W / 2 - 36, FLOOR_Y);
    for (let i = 0; i < SLOTS; i++) {
      const x = slotX(i) - camX;
      if (x > -CAB_W - 4 && x < W + 4) drawCabinet(i, x, ts);
    }
    if (GAMES[sel]) {
      const bob = Math.floor(ts / 300) % 2;
      drawArrowDown(slotX(sel) - camX + CAB_W / 2, 41 + bob, 'gold');
    }
    if (camX > 0) drawSideArrow(1, 96, -1, 'gold');
    if (camX < MAX_CAM) drawSideArrow(W - 6, 96, 1, 'gold');

    const hint = MOBILE ? 'TAP A CABINET TO PLAY' : '<- -> SELECT   ENTER PLAY';
    RA.text(ctx, hint, 128, STRIP_Y + 3, { font: 'en', color: 'silver', align: 'center' });
    drawPanel(ts);

    if (leaving) {
      // シャッターが下りるように暗転
      const p = Math.min(1, (performance.now() - leaving.at) / LEAVE_TIME);
      const h = Math.ceil((H / 2) * p / 4) * 4;
      rect('ink', 0, 0, W, h);
      rect('ink', 0, H - h, W, h);
    }
  }

  // ===== 操作 =====
  function select(i) {
    if (i === sel || !GAMES[i]) return;
    sel = i;
    follow();
    RA.sfx.blip();
  }

  function enter(i) {
    const game = GAMES[i];
    if (!game || leaving) return;
    sel = i;
    follow();
    RA.Store.set(['top', 'last-game'], game.id);
    RA.sfx.coin();
    leaving = { at: performance.now(), url: urlOf(game) };
    setTimeout(() => {
      location.href = leaving.url;
    }, LEAVE_TIME);
  }

  function slotAt(x, y) {
    if (y < 38 || y >= FLOOR_Y) return -1;
    const camX = Math.round(cam);
    for (let i = 0; i < SLOTS; i++) {
      const sx = slotX(i) - camX;
      if (x >= sx - 3 && x < sx + CAB_W + 3) return i;
    }
    return -1;
  }

  RA.bindInput(canvas, {
    press(ev) {
      if (leaving) return;
      if (ev.y >= 80 && ev.y < 120) {
        if (ev.x < EDGE - 1 && Math.round(cam) > 0) return select(sel - 1);
        if (ev.x >= W - EDGE + 1 && Math.round(cam) < MAX_CAM) return select(sel + 1);
      }
      if (ev.y >= PANEL_Y && ev.y < H && ev.x >= 0 && ev.x < W) return enter(sel);
      const i = slotAt(ev.x, ev.y);
      if (i < 0) return;
      if (GAMES[i]) enter(i);
      else RA.Audio.tone({ f: 140, dur: 0.12, vol: 0.12 }); // 調整中
    },
    move(p) {
      if (leaving) return;
      const i = slotAt(p.x, p.y);
      if (i >= 0 && GAMES[i]) select(i);
    },
    key(ev) {
      if (leaving) return;
      if (ev.code === 'ArrowLeft') select(sel - 1);
      else if (ev.code === 'ArrowRight') select(sel + 1);
      else if (ev.code === 'Enter' || ev.code === 'Space') enter(sel);
    },
  });

  // ブラウザの「戻る」でこのページに帰ってきたら、暗転を解く
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) leaving = null;
  });

  const chars = GAMES.map((g) => g.title + (g.desc || '')).join('') + '調整中筐体がありません';
  let ready = false;
  RA.textReady(chars).then(() => {
    ready = true;
  });

  RA.loop((ts) => {
    if (ready) {
      draw(ts);
    } else {
      rect('ink', 0, 0, W, H);
    }
    lastTs = ts;
  });
})();
