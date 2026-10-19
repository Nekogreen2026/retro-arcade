/*
 * にゃらゲームプラザ — 画面1 街並み（名古屋・大須）。
 * 左から 大須観音への参道／ういろう屋「巻き巻きういろー」／路地の公衆電話／にゃらゲームプラザ／
 * プリクラとガチャの軒先／アーケードの奥 が並ぶ。街は画面より広く、左右に見回せる（最初はプラザが真ん中）。
 * era が '1996' なら店は営業中、'now' なら現在（シャッターが下り、ネオンは消え、公衆電話もない）。
 * 建物は時間帯（昼・夕・夜）ごとに一度だけ描いて使い回し、看板の点滅や鳩などは毎フレーム重ねる。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;
  const Plaza = window.Plaza;
  const { bayer, seeded, makeCanvas, painter, pix, dither, line, clamp, jstNow, weekdayIn, dateText } = Plaza.kit;
  const GAMES = (window.GAMES || []).filter((g) => g && g.id);
  const MOBILE = RA.isMobile();

  // ===== 配置（街の座標。左端が0） =====
  const SW = 736; // 街の幅
  const VIEW_H = 214; // 街を描く高さ（その下は操作の帯）
  const GROUND = 200; // 歩道の上端
  const UIRO = 112; // ういろう屋の左端
  const ALLEY = 248; // 路地（公衆電話）
  const PLAZA = 280; // にゃらゲームプラザの左端
  const PLAZA_W = 240;
  const SHOP = 520; // プリクラとガチャの軒先
  const ARCADE = 624; // アーケード
  const VP = { x: 680, y: 152 }; // アーケードの奥の消失点
  const HOME = PLAZA + PLAZA_W / 2 - W / 2; // 最初の視点（プラザが真ん中）
  const MAX_CAM = SW - W;
  const PAN = 96; // 見回す1回ぶん
  const DOOR = { x: 382, y: 150, w: 36, h: 50 }; // 自動ドアの開口（扉2枚ぶん）
  const POSTER_W = 92;
  const POSTER_H = 68;
  const POSTER_XY = [
    [286, 130],
    [422, 130],
  ];
  const WINDOWS = [292, 368, 444]; // 2階の窓の左端（幅64）
  const BOOTH = { x: 254, y: 116, w: 24 }; // 公衆電話のボックス
  const PIGEON_AREA = { x: 24, y: 182, w: 76, h: 18 };
  const FAR_K = 0.4; // 遠くの街が動く割合
  const FAR_W = W + Math.ceil(MAX_CAM * FAR_K);
  const LED = { x: 292, y: 108, w: 216, h: 16 }; // 電光掲示板の文字の窓

  // 壁のポスターに出すゲーム（games.js の poster がある台を先頭から2つ）
  const POSTER_GAMES = GAMES.filter((g) => g.poster).slice(0, POSTER_XY.length);
  const posterImgs = POSTER_GAMES.map((g) =>
    (Array.isArray(g.poster) ? g.poster : [g.poster]).slice(0, 2).map((src) => {
      const im = new Image();
      im.src = 'games/' + g.id + '/' + src;
      return im;
    })
  );

  const LED_TEXT =
    'ようこそ にゃらゲームプラザへ ◆ 1PLAY 50円 ◆ ' + (GAMES.length ? GAMES.map((g) => g.title).join('・') + ' 好評稼働中 ◆ ' : '') + 'プリクラ・ガチャもあるよ ◆ ';

  // ===== 状態 =====
  let cam = HOME;
  let camTarget = HOME;
  let hover = -1; // マウスが乗っているポスター
  let flashPoster = -1;
  let flashUntil = 0;
  let pigeonsFlyAt = -1e9;
  let phoneAt = -1e9;

  const leftBtn = new RA.Button({ x: 4, y: VIEW_H + 2, w: 34, h: 22, label: '' });
  const rightBtn = new RA.Button({ x: W - 38, y: VIEW_H + 2, w: 34, h: 22, label: '' });
  const enterBtn = new RA.Button({ x: 88, y: VIEW_H + 2, w: 80, h: 22, label: '入店', tone: 'primary' });

  // ===== 建物（時間帯ごとに一度だけ描く） =====
  // v: 'day'（朝・昼） | 'eve'（夕。灯りがつく） | 'night'（夜。壁も暗い）
  const bases = {};
  const fars = {};

  function baseOf(v) {
    return bases[v] || (bases[v] = paintStreet(v));
  }

  function farOf(v) {
    return fars[v] || (fars[v] = paintFar(v));
  }

  // 文字を焼き込んでいるので、字形が届き直したら描き直す
  function repaint() {
    Object.keys(bases).forEach((k) => delete bases[k]);
  }

  function paintStreet(v) {
    const c = makeCanvas(SW, VIEW_H);
    const g = c.getContext('2d');
    const T = { lit: v !== 'day', dark: v === 'night' };
    const R = painter(g);
    const d = (day, night) => (T.dark ? night : day);
    paintSando(g, R, d, T);
    paintUiro(g, R, d, T);
    paintAlley(g, R, d);
    paintPlaza(g, R, d, T);
    paintShop(g, R, d, T);
    paintArcade(g, R, d, T);
    paintWalk(g, R, d);
    return c;
  }

  // 遠くのビル（ゆっくり動いて奥行きを出す）
  function paintFar(v) {
    const c = makeCanvas(FAR_W, 60);
    const g = c.getContext('2d');
    const R = painter(g);
    const rnd = seeded(41);
    const body = { day: 'mist', eve: 'dusk', night: 'night' }[v];
    const win = v === 'day' ? 'silver' : 'gold';
    for (let x = -4; x < FAR_W; ) {
      const w = 10 + Math.floor(rnd() * 18);
      const h = 14 + Math.floor(rnd() * 34);
      R(body, x, 60 - h, w, h);
      for (let y = 60 - h + 3; y < 58; y += 4) {
        for (let wx = x + 2; wx < x + w - 2; wx += 3) if (rnd() < (v === 'day' ? 0.25 : 0.35)) R(win, wx, y, 1, 1);
      }
      x += w + Math.floor(rnd() * 4);
    }
    return c;
  }

  // 歩道（石の敷きつめ）
  function paintWalk(g, R, d) {
    R(d('silver', 'mist'), 0, GROUND, SW, VIEW_H - GROUND);
    R(d('cream', 'silver'), 0, GROUND, SW, 1);
    R(d('mist', 'dusk'), 0, GROUND + 7, SW, 1);
    for (let x = 0; x < SW; x += 16) {
      R(d('mist', 'dusk'), x, GROUND + 1, 1, 6);
      R(d('mist', 'dusk'), x + 8, GROUND + 8, 1, 5);
    }
    R(d('mist', 'night'), 0, VIEW_H - 1, SW, 1);
  }

  // 大須観音への参道（奥に本堂と大提灯、手前に石畳・石灯籠・標柱）
  function paintSando(g, R, d, T) {
    // 木立
    [
      [6, 112, 16],
      [22, 104, 13],
      [94, 106, 14],
      [108, 116, 12],
    ].forEach(([cx, cy, r]) => {
      for (let y = cy - r; y < cy + r; y++) {
        for (let x = cx - r; x < cx + r; x++) {
          if ((x - cx) ** 2 + ((y - cy) * 1.2) ** 2 >= r * r || x < 0 || x >= UIRO) continue;
          const shade = y > cy + r * 0.2 && bayer(x, y) < 0.5;
          R(shade ? d('night', 'ink') : d('green', 'night'), x, y, 1, 1);
        }
      }
    });
    // 境内の地面（砂利）
    R(d('silver', 'mist'), 0, 174, UIRO, GROUND - 174);
    dither(g, d('mist', 'dusk'), 0, 174, UIRO, GROUND - 174, 0.22);
    // 本堂の屋根（反りのある大屋根）
    const cx = 56;
    for (let y = 112; y < 138; y++) {
      const half = Math.round(14 + 38 * Math.pow((y - 112) / 25, 1.6));
      R(d('dusk', 'night'), cx - half, y, half * 2, 1);
      if (y > 116) for (let x = cx - half + 1 + (y % 2); x < cx + half; x += 3) R(d('mist', 'dusk'), x, y, 1, 1);
    }
    R('ink', cx - 14, 110, 28, 2); // 棟
    R('gold', cx - 15, 109, 2, 2);
    R('gold', cx + 13, 109, 2, 2);
    R(d('dusk', 'night'), cx - 53, 135, 2, 2); // 軒先の反り
    R(d('dusk', 'night'), cx + 51, 135, 2, 2);
    R('ink', cx - 52, 138, 104, 2);
    // 本堂（朱塗り）
    R('ink', 14, 140, 84, 28);
    R(d('red', 'maroon'), 15, 140, 82, 28);
    [18, 30, 42, 68, 80, 92].forEach((x) => R(d('maroon', 'ink'), x, 140, 2, 28));
    R(T.lit ? 'dusk' : 'ink', 44, 144, 24, 24); // 正面の奥
    if (T.lit) [48, 54, 62].forEach((x) => R('gold', x, 162, 1, 2));
    // 大提灯
    R('ink', 50, 141, 12, 2);
    R('red', 49, 143, 14, 13);
    R('maroon', 49, 151, 14, 1);
    R('cream', 51, 145, 1, 7);
    R('ink', 54, 146, 4, 1);
    R('ink', 55, 147, 2, 6);
    R('ink', 53, 150, 6, 1);
    R('ink', 50, 156, 12, 2);
    // 基壇と石段
    R(d('silver', 'mist'), 10, 168, 92, 6);
    R(d('cream', 'silver'), 10, 168, 92, 1);
    for (let i = 0; i < 3; i++) R(d('mist', 'dusk'), 40 - i * 2, 170 + i * 2, 32 + i * 4, 1);
    // 参道の石畳（手前ほど広い）
    for (let y = 174; y < GROUND; y++) {
      const k = (y - 174) / (GROUND - 174);
      const half = Math.round(12 + k * 30);
      R(d('cream', 'silver'), cx - half, y, half * 2, 1);
      if ((y - 174) % 6 === 5) R(d('silver', 'mist'), cx - half, y, half * 2, 1);
    }
    // 石灯籠（灯りは夕方から）
    const lx = 97;
    R(d('silver', 'mist'), lx - 1, 160, 2, 2);
    R(d('silver', 'mist'), lx - 3, 162, 6, 1);
    R(d('silver', 'mist'), lx - 5, 163, 10, 1);
    R(d('mist', 'dusk'), lx - 7, 164, 14, 2);
    R(d('silver', 'mist'), lx - 4, 166, 8, 7);
    R(T.lit ? 'gold' : 'ink', lx - 2, 167, 4, 4);
    R(d('mist', 'dusk'), lx - 6, 173, 12, 2);
    R(d('silver', 'mist'), lx - 2, 175, 4, 15);
    R(d('mist', 'dusk'), lx + 1, 175, 1, 15);
    R(d('silver', 'mist'), lx - 5, 190, 10, 3);
    R(d('mist', 'dusk'), lx - 7, 193, 14, 7);
    // 標柱「大須観音」
    R('ink', 2, 118, 20, GROUND - 118);
    R(d('silver', 'mist'), 3, 120, 18, GROUND - 120);
    R(d('mist', 'dusk'), 18, 120, 3, GROUND - 120);
    R(d('cream', 'silver'), 3, 119, 18, 1);
    Array.from('大須観音').forEach((ch, i) => RA.text(g, ch, 11, 123 + i * 17, { color: 'ink', align: 'center' }));
  }

  // 渦を巻いた断面（巻きういろう）
  function roll(g, cx, cy, r, a, b) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const dist = Math.hypot(x, y);
        if (dist > r + 0.4) continue;
        const turn = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI);
        const band = Math.floor(dist / 1.5 + turn) % 2;
        g.fillStyle = P[dist > r - 0.6 || band ? a : b];
        g.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }

  // ういろう屋「巻き巻きういろー」（看板は街でいちばん大きい字）
  function paintUiro(g, R, d, T) {
    const x0 = UIRO;
    const x1 = ALLEY;
    // 屋上の大看板と脚
    [124, 178, 232].forEach((x) => R('ink', x, 98, 3, 12));
    R('ink', 124, 104, 111, 1);
    R('ink', x0, 21, x1 - x0, 78);
    R('red', x0 + 1, 22, x1 - x0 - 2, 76);
    R('cream', x0 + 3, 24, x1 - x0 - 6, 72);
    const mid = (x0 + x1) / 2;
    RA.text(g, '巻き巻き', mid + 1, 24, { size: 32, color: 'red', align: 'center' });
    RA.text(g, '巻き巻き', mid, 23, { size: 32, color: 'maroon', align: 'center' });
    RA.text(g, 'ういろー', mid + 1, 59, { size: 32, color: 'red', align: 'center' });
    RA.text(g, 'ういろー', mid, 58, { size: 32, color: 'maroon', align: 'center' });
    if (T.lit) {
      // 看板を照らすライト
      [136, 218].forEach((x) => {
        R('ink', x, 14, 8, 5);
        R('silver', x + 1, 15, 6, 2);
        R('white', x + 2, 18, 4, 1);
      });
      dither(g, 'gold', x0 + 3, 24, x1 - x0 - 6, 10, (x, y) => 0.28 * (1 - (y - 24) / 10));
    }
    // 瓦屋根
    R('ink', x0, 108, x1 - x0, 1);
    R(d('dusk', 'night'), x0, 109, x1 - x0, 15);
    for (let y = 110; y < 124; y += 3) for (let x = x0 + (Math.floor(y / 3) % 2) * 3; x < x1; x += 6) R(d('mist', 'dusk'), x, y, 2, 1);
    R('ink', x0, 124, x1 - x0, 2);
    for (let x = x0 + 1; x < x1; x += 4) R(d('mist', 'dusk'), x, 124, 2, 1);
    // 店の構え（木の格子と暖簾）
    R(d('brown', 'maroon'), x0, 126, x1 - x0, GROUND - 126);
    R('ink', x0, 126, 1, GROUND - 126);
    R('ink', x1 - 1, 126, 1, GROUND - 126);
    R('ink', 115, 131, 30, 46);
    R(T.lit ? 'gold' : 'ink', 116, 132, 28, 44);
    for (let x = 116; x < 144; x += 3) R(d('brown', 'maroon'), x, 132, 1, 44);
    // 「名物」の木札
    R('ink', 121, 136, 18, 38);
    R(d('cream', 'silver'), 122, 137, 16, 36);
    RA.text(g, '名', 130, 137, { color: 'ink', align: 'center' });
    RA.text(g, '物', 130, 154, { color: 'ink', align: 'center' });
    // 入口（暖簾の奥は店の中）
    R(T.lit ? 'dusk' : 'ink', 148, 128, 64, GROUND - 128);
    R('brown', 146, 127, 68, 2);
    Array.from('ういろう').forEach((ch, i) => {
      R('blue', 148 + i * 16, 129, 15, 26);
      R('night', 148 + i * 16, 154, 15, 1);
      RA.text(g, ch, 155 + i * 16, 133, { color: 'cream', align: 'center' });
    });
    // 陳列ケース（巻きういろうの断面が並ぶ）
    R('ink', 150, 170, 60, 30);
    R(d('silver', 'mist'), 151, 171, 58, 1);
    R(T.lit ? 'cream' : d('night', 'night'), 151, 172, 58, 16);
    [
      ['cream', 'white'],
      ['pink', 'cream'],
      ['green', 'cream'],
      ['brown', 'orange'],
      ['gold', 'orange'],
    ].forEach(([a, b], i) => roll(g, 157 + i * 11, 180, 4, a, b));
    R('white', 152, 173, 8, 1);
    R(d('brown', 'maroon'), 151, 189, 58, 11);
    R('ink', 151, 189, 58, 1);
    // 野点傘と縁台
    R('brown', 231, 140, 1, 46);
    for (let y = 136; y < 146; y++) {
      const half = 2 + Math.round((y - 136) * 1.3);
      R('red', 231 - half, y, half * 2 + 1, 1);
    }
    R('maroon', 217, 146, 29, 1);
    [-8, 0, 8].forEach((dx) => R('maroon', 231 + dx, 141 + Math.abs(dx) / 2, 1, 5 - Math.abs(dx) / 2));
    R('red', 216, 184, 30, 3);
    R('maroon', 216, 187, 30, 1);
    R(d('brown', 'maroon'), 218, 188, 2, 12);
    R(d('brown', 'maroon'), 242, 188, 2, 12);
  }

  // 路地（奥の壁と室外機。公衆電話は時代で変わるので毎フレーム描く）
  function paintAlley(g, R, d) {
    R(d('mist', 'night'), ALLEY, 96, PLAZA - ALLEY, GROUND - 96);
    dither(g, d('silver', 'dusk'), ALLEY, 96, PLAZA - ALLEY, GROUND - 96, 0.1);
    R(d('silver', 'mist'), ALLEY + 3, 96, 1, GROUND - 96);
    R('ink', ALLEY + 4, 96, 1, GROUND - 96);
    R(d('silver', 'mist'), ALLEY + 12, 100, 16, 11);
    R('ink', ALLEY + 12, 111, 16, 1);
    for (let y = 102; y < 110; y += 2) R(d('mist', 'dusk'), ALLEY + 14, y, 9, 1);
    R(d('dusk', 'ink'), ALLEY, GROUND - 4, PLAZA - ALLEY, 4);
  }

  // にゃらゲームプラザ（ネオン看板の枠、2階の窓、電光掲示板、1階の壁と入口）
  function paintPlaza(g, R, d, T) {
    const x0 = PLAZA;
    // 屋上のネオン看板（字は毎フレーム）
    [336, 399, 462].forEach((x) => R('ink', x, 60, 2, 6));
    R('ink', 320, 34, 160, 26);
    R(d('mist', 'dusk'), 320, 34, 160, 1);
    R(d('mist', 'dusk'), 320, 59, 160, 1);
    R(d('mist', 'dusk'), 320, 34, 1, 26);
    R(d('mist', 'dusk'), 479, 34, 1, 26);
    // 建物
    R('ink', x0, 66, PLAZA_W, GROUND - 66);
    R(d('mist', 'dusk'), x0 + 1, 67, PLAZA_W - 2, 3);
    R(d('silver', 'dusk'), x0 + 1, 70, PLAZA_W - 2, 36);
    for (let y = 73; y < 106; y += 4) R(d('mist', 'night'), x0 + 1, y, PLAZA_W - 2, 1);
    // 2階の窓。昼は空が映り、夕方からは店の灯りと筐体の影が見える
    WINDOWS.forEach((wx) => {
      R('ink', wx, 74, 64, 30);
      if (T.lit) {
        R('dusk', wx + 1, 75, 62, 28);
        R('cream', wx + 1, 75, 62, 1);
        for (let k = 0; k < 4; k++) R('ink', wx + 4 + k * 15, 86, 11, 17);
      } else {
        R('blue', wx + 1, 75, 62, 28);
        line(g, 'cyan', wx + 8, 102, wx + 34, 76);
        line(g, 'cyan', wx + 9, 102, wx + 35, 76);
        line(g, 'cyan', wx + 40, 102, wx + 52, 90);
      }
      R('ink', wx + 31, 74, 2, 30);
    });
    // 電光掲示板（字は毎フレーム流す）
    R('ink', x0 + 1, 106, PLAZA_W - 2, 20);
    R(d('mist', 'dusk'), LED.x - 2, LED.y - 2, LED.w + 4, 1);
    R(d('mist', 'dusk'), LED.x - 2, LED.y + LED.h + 1, LED.w + 4, 1);
    // 1階の壁
    R(d('cream', 'mist'), x0 + 1, 126, PLAZA_W - 2, GROUND - 126);
    R(d('silver', 'dusk'), x0 + 1, 126, PLAZA_W - 2, 2);
    R(d('mist', 'night'), x0 + 1, GROUND - 2, PLAZA_W - 2, 2);
    // 入口の看板とドアの枠
    R('ink', 381, 130, 38, 19);
    R('red', 382, 131, 36, 17);
    RA.text(g, '入口', 400, 131, { color: 'cream', align: 'center' });
    R(d('silver', 'mist'), DOOR.x - 2, DOOR.y - 1, DOOR.w + 4, GROUND - DOOR.y + 1);
    R('ink', DOOR.x - 1, DOOR.y, DOOR.w + 2, GROUND - DOOR.y);
    R(d('mist', 'dusk'), DOOR.x - 6, GROUND - 2, DOOR.w + 12, 2); // 足ふきマット
  }

  // プリクラとガチャの軒先（屋上にはポケベルの広告板）
  function paintShop(g, R, d, T) {
    const x0 = SHOP;
    const x1 = ARCADE;
    // 屋上の広告板（中身は時代で変わるので毎フレーム）
    [532, 570, 608].forEach((x) => R('ink', x, 120, 2, 12));
    R('ink', 522, 66, 100, 55);
    R(d('silver', 'mist'), 523, 67, 98, 53);
    // 建物と日よけ
    R('ink', x0, 132, x1 - x0, GROUND - 132);
    R(d('silver', 'dusk'), x0 + 1, 146, x1 - x0 - 2, GROUND - 146);
    for (let x = x0; x < x1; x++) {
      const stripe = Math.floor((x - x0) / 8) % 2 ? d('cream', 'silver') : d('red', 'maroon');
      R(stripe, x, 132, 1, 13);
      const k = (x - x0) % 8;
      R(stripe, x, 145, 1, k >= 1 && k <= 6 ? (k >= 2 && k <= 5 ? 3 : 2) : 1);
    }
    R('ink', x0, 131, x1 - x0, 1);
    if (T.lit) for (let x = x0 + 4; x < x1; x += 8) R('gold', x, 149, 1, 1);
    // プリクラ（写真の見本と、カーテン）
    R('ink', 524, 150, 42, GROUND - 150);
    R('pink', 525, 151, 40, GROUND - 151);
    R('maroon', 525, 151, 40, 10);
    RA.text(g, 'PHOTO', 545, 152, { font: 'en', color: 'cream', align: 'center' });
    const SAMPLE = ['cyan', 'gold', 'green', 'orange', 'blue', 'white'];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 2; i++) {
        const x = 527 + i * 9;
        const y = 164 + j * 10;
        R('ink', x, y, 8, 9);
        R(SAMPLE[j * 2 + i], x + 1, y + 1, 6, 7);
        R('cream', x + 2, y + 3, 4, 4);
        R('ink', x + 3, y + 4, 1, 1);
        R('ink', x + 5, y + 4, 1, 1);
      }
    }
    R(d('pink', 'maroon'), 546, 162, 19, 32);
    for (let x = 548; x < 565; x += 4) R('maroon', x, 162, 1, 32);
    R('ink', 546, 194, 19, GROUND - 194);
    // ガチャ（2台）
    gacha(g, R, d, 570, 'red', 7);
    gacha(g, R, d, 597, 'blue', 11);
  }

  function gacha(g, R, d, x, body, seed) {
    const rnd = seeded(seed);
    R('ink', x, 156, 24, GROUND - 156);
    R(body, x + 1, 157, 22, 3);
    R(d('cyan', 'dusk'), x + 2, 160, 20, 16);
    const COLORS = ['red', 'gold', 'green', 'pink', 'blue', 'orange', 'cyan', 'white'];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 4; i++) {
        const cx = x + 3 + i * 5 + (j % 2 ? 2 : 0);
        const cy = 171 - j * 5;
        if (cx > x + 17) continue;
        const color = COLORS[Math.floor(rnd() * COLORS.length)];
        R(color, cx + 1, cy, 3, 2);
        R(color, cx, cy + 1, 5, 1);
        R('cream', cx, cy + 2, 5, 1);
        R('cream', cx + 1, cy + 3, 3, 1);
      }
    }
    R('white', x + 3, 161, 1, 4);
    R(body, x + 1, 176, 22, 20);
    R('silver', x + 8, 179, 8, 8);
    R('ink', x + 11, 180, 2, 6);
    R('ink', x + 6, 190, 12, 4);
    R('ink', x + 1, 196, 22, 1);
  }

  // アーケードの奥（屋根の下を通りがずっと奥まで続く）
  const T_EDGE = 46; // 入口での通りの半分の幅
  const T_FAR = 8; // 奥での半分の幅
  const tunnel = (t) => ({
    hw: Math.round(T_EDGE - (T_EDGE - T_FAR) * t),
    top: Math.round(110 + (VP.y - 6 - 110) * t),
    bot: Math.round(GROUND - (GROUND - (VP.y + 6)) * t),
  });
  const archTop = (x) => {
    const u = (x - VP.x) / 54;
    return Math.round(96 - 26 * Math.sqrt(Math.max(0, 1 - u * u)));
  };

  function paintArcade(g, R, d, T) {
    const cx = VP.x;
    const SHOPS = ['red', 'gold', 'green', 'cyan', 'pink', 'orange', 'blue'];
    const BOUNDS = [0, 0.3, 0.52, 0.68, 0.8, 0.88, 1];
    // 両側の店（列ごとに奥行きを計算して描く）
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < T_EDGE - T_FAR; k++) {
        const t = k / (T_EDGE - T_FAR);
        const { hw, top, bot } = tunnel(t);
        const x = side < 0 ? cx - hw : cx + hw - 1;
        const seg = BOUNDS.findIndex((b) => b > t) - 1;
        const h = bot - top;
        R(d('silver', 'dusk'), x, top, 1, h);
        R(SHOPS[(seg * 3 + (side < 0 ? 0 : 2)) % SHOPS.length], x, top, 1, Math.max(1, Math.round(h * 0.12)));
        R(T.lit ? 'gold' : d('night', 'night'), x, top + Math.round(h * 0.28), 1, Math.round(h * 0.34));
        if (BOUNDS.some((b) => Math.abs(b - t) < 0.5 / (T_EDGE - T_FAR))) R(d('mist', 'night'), x, top, 1, h);
      }
    }
    // 天井と床
    for (let y = 110; y < VP.y - 6; y++) {
      const { hw } = tunnel((y - 110) / (VP.y - 6 - 110));
      R(d('mist', 'night'), cx - hw, y, hw * 2, 1);
    }
    for (let y = VP.y + 6; y < GROUND; y++) {
      const { hw } = tunnel((GROUND - y) / (GROUND - (VP.y + 6)));
      R(d('silver', 'mist'), cx - hw, y, hw * 2, 1);
    }
    for (let k = -3; k <= 3; k++) line(g, d('mist', 'dusk'), cx + k * 14, GROUND - 1, cx + Math.round(k * 2.4), VP.y + 6);
    // 天井の灯りと吊り旗
    [0.08, 0.3, 0.5, 0.66, 0.78].forEach((t, i) => {
      const { hw, top } = tunnel(t);
      R(T.lit ? 'white' : 'cream', cx - Math.round(hw * 0.5), top + 1, 2, 1);
      R(T.lit ? 'white' : 'cream', cx + Math.round(hw * 0.5) - 2, top + 1, 2, 1);
      const fh = Math.max(2, Math.round(8 * (1 - t)));
      R(SHOPS[(i * 2 + 1) % SHOPS.length], cx - Math.round(hw * 0.2), top + 2, Math.max(1, Math.round(fh * 0.6)), fh);
      R(SHOPS[(i * 2 + 4) % SHOPS.length], cx + Math.round(hw * 0.2), top + 2, Math.max(1, Math.round(fh * 0.6)), fh);
    });
    // 通りの突き当たり
    R(T.lit ? 'gold' : 'cream', cx - T_FAR, VP.y - 6, T_FAR * 2, 12);
    // 屋根（明かり取り）
    for (let x = ARCADE + 10; x < ARCADE + 102; x++) {
      const y0 = archTop(x) + 6;
      R(d('mist', 'night'), x, y0, 1, 110 - y0);
      if ((x - ARCADE) % 10 === 0) R(d('silver', 'dusk'), x, y0, 1, 110 - y0);
    }
    // 入口の柱とアーチ
    [ARCADE + 2, SW - 11].forEach((x) => {
      R('ink', x, 84, 9, GROUND - 84);
      R(d('silver', 'mist'), x + 1, 85, 7, GROUND - 85);
      R(d('mist', 'dusk'), x + 6, 85, 2, GROUND - 85);
    });
    for (let x = ARCADE + 2; x < SW - 2; x++) {
      const y = archTop(x);
      R('ink', x, y, 1, 7);
      R(d('silver', 'mist'), x, y + 1, 1, 5);
    }
    // 入口の看板
    R('ink', 638, 90, 84, 20);
    R('blue', 639, 91, 82, 18);
    RA.text(g, '大須商店街', cx, 91, { color: 'cream', align: 'center' });
  }

  // 屋根の下（雨や雪が降らないところ）か
  function covered(wx, y) {
    if (wx >= ARCADE + 10 && wx < SW - 10 && y >= archTop(wx) + 6) return true;
    if (wx >= SHOP && wx < ARCADE && y >= 146) return true; // 日よけの下
    return false;
  }

  // ===== 毎フレーム重ねるもの =====
  const PIGEON = ['.....ss..', '....sskO.', '.ssssgg..', 'sssssss..', '.sssss...', '..o.o....'];
  const PIGEON_PECK = ['.........', '.ssss....', 'ssssssg..', 'ssssssssk', '.sssss..O', '..o.o....'];
  const PIGEON_FLY = ['s.......s', 'ss.....ss', '.sssssss.', '..sssssk.', '...sss.O.', '.........'];
  const PIGEON_FLY2 = ['.........', '.........', 'sssssssss', 'ssssssssk', '...sss.O.', '.........'];
  const PIGEONS = [
    { x: 34, ph: 0.3 },
    { x: 52, ph: 1.9 },
    { x: 70, ph: 3.1 },
    { x: 86, ph: 4.6 },
  ];

  const WALKERS = (() => {
    const rnd = seeded(61);
    const COLORS = ['night', 'maroon', 'blue', 'brown', 'dusk', 'red'];
    return Array.from({ length: 7 }, (_, i) => ({ t: 0.25 + rnd() * 0.6, u: rnd() * 2 - 1, v: (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.08), color: COLORS[i % COLORS.length] }));
  })();

  function fitImage(g, im, x, y, box) {
    if (!im || !im.complete || !im.naturalWidth) return;
    let s = Math.floor(Math.min(box / im.naturalWidth, box / im.naturalHeight));
    if (s < 1) s = Math.min(box / im.naturalWidth, box / im.naturalHeight);
    const w = Math.round(im.naturalWidth * s);
    const h = Math.round(im.naturalHeight * s);
    g.drawImage(im, x + Math.round((box - w) / 2), y + (box - h), w, h);
  }

  function drawPoster(g, R, i, x, y, ts) {
    const game = POSTER_GAMES[i];
    R('ink', x, y, POSTER_W, POSTER_H);
    if (!game) {
      R('mist', x + 1, y + 1, POSTER_W - 2, POSTER_H - 2);
      RA.text(g, '近日入荷', x + POSTER_W / 2, y + 24, { color: 'cream', align: 'center' });
      return;
    }
    R(game.color || 'red', x + 1, y + 1, POSTER_W - 2, 17);
    RA.text(g, game.title, x + POSTER_W / 2, y + 1, { color: 'cream', align: 'center', shadow: 'ink' });
    R('night', x + 1, y + 18, POSTER_W - 2, 32);
    // 星のきらめき
    [
      [6, 22],
      [84, 26],
      [10, 44],
      [80, 45],
      [48, 21],
    ].forEach(([sx, sy], k) => Math.floor(ts / 300 + k) % 3 && R(k % 2 ? 'gold' : 'white', x + sx, y + sy, 1, 1));
    const list = posterImgs[i];
    const span = list.length * 32 + (list.length - 1) * 4;
    list.forEach((im, k) => fitImage(g, im, x + Math.round((POSTER_W - span) / 2) + k * 36, y + 18, 32));
    R('gold', x + 1, y + 50, POSTER_W - 2, 17);
    RA.text(g, '好評稼働中!', x + POSTER_W / 2, y + 50, { color: 'red', align: 'center' });
    if (i === hover || (i === flashPoster && performance.now() < flashUntil)) {
      const c = i === flashPoster && performance.now() < flashUntil ? 'white' : 'gold';
      R(c, x - 1, y - 1, POSTER_W + 2, 1);
      R(c, x - 1, y + POSTER_H, POSTER_W + 2, 1);
      R(c, x - 1, y, 1, POSTER_H);
      R(c, x + POSTER_W, y, 1, POSTER_H);
    }
  }

  // 扉1枚（ガラス）。範囲 [lo, hi) からはみ出たぶんは戸袋に隠れて見えない
  function drawPanel(R, d, x, y, w, h, lo, hi, lit) {
    const piece = (color, px, py, pw, ph) => {
      const a = Math.max(lo, px);
      const b = Math.min(hi, px + pw);
      if (b > a) R(color, a, py, b - a, ph);
    };
    piece(d('silver', 'mist'), x, y, w, h);
    piece(lit ? 'dusk' : 'blue', x + 1, y + 1, w - 2, h - 2);
    for (let k = 0; k < 10; k++) piece(lit ? 'mist' : 'cyan', x + 4 + k, y + 24 - k * 2, 1, 2);
    piece('red', x + Math.floor(w / 2) - 1, y + 26, 3, 3);
  }

  function drawPhoneBooth(g, R, d, x, st) {
    const y = BOOTH.y;
    const w = BOOTH.w;
    // 看板（受話器の絵）
    R('ink', x + 4, y, 16, 10);
    R('cream', x + 5, y + 1, 14, 8);
    pix(g, ['.gg....gg.', 'gggg..gggg', 'gg.gggg.gg', '...gggg...'], x + 7, y + 3, { g: 'green' });
    R('ink', x + 11, y + 10, 2, 2);
    // 屋根とガラス
    R('ink', x, y + 12, w, GROUND - y - 12);
    R('green', x + 1, y + 13, w - 2, 5);
    R(st.lit ? 'cream' : 'cyan', x + 2, y + 18, w - 4, GROUND - y - 22);
    if (st.lit) R('white', x + 2, y + 18, w - 4, 1);
    for (let k = 0; k < 8; k++) R('white', x + 4 + k, y + 40 - k * 2, 1, 1);
    // 緑の公衆電話
    const px = x + 6;
    const py = y + 30;
    R('ink', px, py, 12, 22);
    R('green', px + 1, py + 1, 10, 20);
    R('ink', px + 2, py + 3, 6, 3); // 表示窓
    R('cyan', px + 3, py + 4, 4, 1);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) R('cream', px + 2 + i * 2, py + 8 + j * 2, 1, 1);
    R('ink', px + 9, py + 3, 1, 8); // カードの差し込み口
    R('ink', px - 2, py + 2, 2, 12); // 受話器
    R('green', px - 2, py + 3, 1, 10);
    R(d('silver', 'mist'), x + 3, py + 22, w - 6, 2);
    R('ink', x + 1, GROUND - 4, w - 2, 4);
  }

  function drawPagerAd(g, R) {
    R('ink', 525, 69, 94, 49);
    R('blue', 526, 70, 92, 47);
    RA.text(g, 'ポケベル', 529, 70, { color: 'gold', outline: 'ink' });
    // 「0円」の札
    R('red', 597, 72, 19, 16);
    R('red', 595, 74, 23, 12);
    RA.text(g, '0円', 606, 71, { color: 'cream', align: 'center' });
    // ポケベルの絵（画面に「0840」）
    R('ink', 529, 91, 42, 21);
    R('silver', 530, 92, 40, 19);
    R('ink', 532, 94, 36, 11);
    R('green', 533, 95, 34, 9);
    RA.text(g, '0840', 550, 96, { font: 'en', color: 'ink', align: 'center' });
    R('ink', 534, 107, 5, 2);
    R('ink', 542, 107, 5, 2);
    RA.text(g, '=ｵﾊﾖｳ', 575, 93, { color: 'cream' });
  }

  function drawNow(g, R, d, cam) {
    // 2階の窓は暗く、看板は消えたまま
    WINDOWS.forEach((wx) => {
      R('night', wx + 1 - cam, 75, 30, 28);
      R('night', wx + 33 - cam, 75, 30, 28);
      R('dusk', wx + 4 - cam, 76, 1, 26);
    });
    // シャッター
    const x = PLAZA + 3 - cam;
    R('ink', x, 129, PLAZA_W - 6, GROUND - 129);
    for (let y = 130; y < GROUND - 3; y++) R((y - 130) % 3 === 0 ? d('mist', 'dusk') : d('silver', 'mist'), x + 1, y, PLAZA_W - 8, 1);
    R('ink', x, GROUND - 3, PLAZA_W - 6, 3);
    R('ink', 351 - cam, 152, 98, 20);
    R('cream', 352 - cam, 153, 96, 18);
    RA.text(g, 'テナント募集', 400 - cam, 153, { color: 'red', align: 'center' });
    // 屋上の広告板
    R(d('cream', 'silver'), 525 - cam, 69, 94, 49);
    RA.text(g, '広告募集', 572 - cam, 85, { color: 'mist', align: 'center' });
  }

  // 「にゃら」だけが桃色に点滅する。ときどき管がちらつく
  function drawNeon(g, x, ts, on) {
    const left = x - 72;
    if (!on) {
      RA.text(g, 'にゃらゲームプラザ', x, 38, { color: 'dusk', align: 'center' });
      return;
    }
    const r = ((Math.floor(ts / 60) * 2654435761) >>> 0) % 100;
    const pink = Math.floor(ts / 650) % 2 === 0 && r >= 6;
    RA.text(g, 'にゃら', left, 38, pink ? { color: 'pink', outline: 'maroon' } : { color: 'maroon' });
    RA.text(g, 'ゲームプラザ', left + 48, 38, { color: 'cyan', outline: 'blue' });
  }

  // 天井の電球（順に光が流れる）
  function drawChase(R, cam, ts) {
    const step = Math.floor(ts / 140);
    for (let i = 0, x = PLAZA + 6; x < PLAZA + PLAZA_W - 6; x += 6, i++) {
      const sx = x - cam;
      if (sx < -2 || sx > W) continue;
      R((i + step) % 3 === 0 ? 'white' : (i + step) % 3 === 1 ? 'gold' : 'brown', sx, 127, 2, 2);
    }
  }

  function drawLed(g, cam, ts) {
    const x = LED.x - cam;
    if (x > W || x + LED.w < 0) return;
    g.save();
    g.beginPath();
    g.rect(x, LED.y, LED.w, LED.h);
    g.clip();
    const tw = RA.textWidth(LED_TEXT);
    const off = Math.floor(ts / 30) % tw;
    RA.text(g, LED_TEXT, x + LED.w - off, LED.y - 1, { color: 'orange' });
    RA.text(g, LED_TEXT, x + LED.w - off - tw, LED.y - 1, { color: 'orange' });
    g.restore();
  }

  function drawScreens(R, cam, ts) {
    const COLORS = ['cyan', 'pink', 'gold', 'green', 'red', 'blue', 'white', 'orange'];
    WINDOWS.forEach((wx, w) => {
      for (let k = 0; k < 4; k++) {
        const n = Math.floor(ts / (260 + k * 90 + w * 40));
        R(COLORS[((n + k * 3 + w * 5) * 7) % COLORS.length], wx + 6 + k * 15 - cam, 88, 7, 5);
      }
    });
  }

  function drawPigeons(g, ts, cam, st) {
    if (st.tod === 'night') return; // 夜は鳩も寝ている
    const s = (ts - pigeonsFlyAt) / 1000;
    const map = { s: st.tod === 'evening' ? 'mist' : 'silver', k: 'ink', O: 'cream', g: 'green', o: 'orange' };
    PIGEONS.forEach((p, i) => {
      let x = p.x + Math.round(Math.sin(ts / 2600 + p.ph) * 6);
      let y = GROUND - 7;
      const dir = Math.cos(ts / 2600 + p.ph) >= 0;
      let rows = Math.floor(ts / (480 + i * 70) + p.ph) % 3 === 0 ? PIGEON_PECK : PIGEON;
      if (s >= 0 && s < 7) {
        if (s < 4) {
          // 飛び立つ
          rows = Math.floor(ts / 90 + i) % 2 ? PIGEON_FLY : PIGEON_FLY2;
          x += Math.round(s * (40 + i * 10) * (i % 2 ? 1 : -1));
          y -= Math.round(s * s * 30 + s * 20);
        } else if (s < 6) {
          return; // どこかへ行っている
        } else {
          // 舞い戻る
          const k = 7 - s;
          rows = Math.floor(ts / 90 + i) % 2 ? PIGEON_FLY : PIGEON_FLY2;
          y -= Math.round(k * 60);
        }
      }
      if (x - cam > -10 && x - cam < W + 10) pix(g, rows, x - cam, y, map, !dir);
    });
  }

  function drawWalkers(R, cam, ts, st) {
    const n = st.tod === 'night' ? 3 : WALKERS.length;
    for (let i = 0; i < n; i++) {
      const p = WALKERS[i];
      const { hw, bot } = tunnel(p.t);
      const u = ((((p.u + 1 + (ts / 1000) * p.v) % 2) + 2) % 2) - 1;
      const x = Math.round(VP.x + u * (hw - 2)) - cam;
      const h = Math.max(3, Math.round(14 * (1 - p.t) + 2));
      const y = bot - h - 1;
      const bob = Math.floor(ts / 200 + i) % 2;
      if (x < -4 || x > W + 4) continue;
      R('ink', x, y + bob, 2, Math.max(1, Math.round(h * 0.25)));
      R(p.color, x, y + bob + Math.max(1, Math.round(h * 0.25)), 2, h - Math.max(1, Math.round(h * 0.25)));
    }
  }

  // 濡れた歩道に映るネオン（雨の夜・夕方）
  function drawPuddles(R, cam, ts, st) {
    for (let i = 0; i < 18; i++) {
      const wx = (i * 97 + 13) % SW;
      const x = wx - cam;
      if (x < 0 || x >= W) continue;
      const on = Math.floor(ts / 400 + i * 1.7) % 3 === 0;
      if (on) R('cyan', x, GROUND + 3 + (i % 3) * 4, 3, 1);
    }
    if (st.lit) {
      for (let x = 320; x < 480; x += 2) {
        const sx = x - cam;
        if (sx < 0 || sx >= W) continue;
        if (bayer(x, Math.floor(ts / 250)) < 0.35) R(x < 368 ? 'pink' : 'cyan', sx, GROUND + 2 + ((x >> 1) % 9), 1, 1);
      }
    }
  }

  /*
   * 街を描く。o = { st（空の状態）, era: '1996' | 'now', door（扉の開き 0〜1）, hud（日付と天気の札）, ui（操作の帯）}
   * 返り値は空の結果（雷を鳴らす合図など）
   */
  function draw(g, ts, o) {
    const st = o.st;
    const era = o.era || '1996';
    const v = st.tod === 'night' ? 'night' : st.lit ? 'eve' : 'day';
    const R = painter(g);
    const d = (day, night) => (v === 'night' ? night : day);
    const c = Math.round(cam);
    const sky = Plaza.sky.draw(g, st, ts);
    g.drawImage(farOf(v), -Math.round(c * FAR_K), 96);
    g.drawImage(baseOf(v), c, 0, W, VIEW_H, 0, 0, W, VIEW_H);

    const on = era === '1996';
    drawNeon(g, 400 - c, ts, on);
    if (on) {
      if (st.lit) drawScreens(R, c, ts);
      drawLed(g, c, ts);
      drawChase(R, c, ts);
      POSTER_XY.forEach(([x, y], i) => x - c < W && x - c + POSTER_W > 0 && drawPoster(g, R, i, x - c, y, ts));
      const open = o.door || 0;
      const shift = Math.round(open * (DOOR.w / 2));
      const dx = DOOR.x - c;
      R(st.lit ? 'cream' : 'dusk', dx, DOOR.y, DOOR.w, DOOR.h);
      drawPanel(R, d, dx - shift, DOOR.y, DOOR.w / 2, DOOR.h, dx, dx + DOOR.w, st.lit);
      drawPanel(R, d, dx + DOOR.w / 2 + shift, DOOR.y, DOOR.w / 2, DOOR.h, dx, dx + DOOR.w, st.lit);
      if (BOOTH.x - c > -BOOTH.w && BOOTH.x - c < W) drawPhoneBooth(g, R, d, BOOTH.x - c, st);
      if (525 - c < W && 619 - c > 0) {
        g.save();
        g.translate(-c, 0);
        drawPagerAd(g, R);
        g.restore();
      }
    } else {
      drawNow(g, R, d, c);
    }
    drawWalkers(R, c, ts, st);
    drawPigeons(g, ts, c, st);

    // 天気（屋根や日よけの下には降らない）
    const skip = (x, y) => y >= GROUND || covered(x + c, y);
    if (st.fall === 'rain' || st.fall === 'storm') drawPuddles(R, c, ts, st);
    if (st.fall) Plaza.sky.particles(g, st.fall, 0, 0, W, VIEW_H, ts, st.fall === 'storm' ? 80 : st.fall === 'snow' ? 40 : 60, skip);
    if (st.drift) Plaza.sky.particles(g, st.drift, 0, 0, W, VIEW_H, ts, 70, skip);
    if (st.mood === 'heat') {
      // 陽炎（歩道の上の行を左右に揺らす）
      for (let y = GROUND - 14; y < GROUND + 4; y++) {
        const dx = Math.round(Math.sin(ts / 160 + y * 0.9));
        if (dx) g.drawImage(g.canvas, 0, y, W, 1, dx, y, W, 1);
      }
    }
    if (st.mood === 'frost') for (let x = 0; x < W; x++) if (bayer(x + c, 0) < 0.3) R(bayer(x + c, 1) < 0.5 ? 'white' : 'cyan', x, GROUND, 1, 1);

    if (o.hud) drawHud(g, R, st, era, o);
    R('ink', 0, VIEW_H, W, H - VIEW_H);
    R('dusk', 0, VIEW_H, W, 1);
    if (o.ui) drawUi(g, ts);
    return sky;
  }

  // 札（墨の地に宵闇の縁。空がどんな色でも読めるように）
  function plate(R, x, y, w) {
    R('dusk', x, y, w, 18);
    R('ink', x + 1, y + 1, w - 2, 16);
  }

  function drawHud(g, R, st, era, o) {
    const t = jstNow(Date.now());
    const y = era === '1996' ? Plaza.YEAR : t.y;
    const wd = era === '1996' ? weekdayIn(Plaza.YEAR, t.m, t.d) : t.wd;
    const date = dateText(o.year || y, t.m, t.d);
    const dw = RA.textWidth(date, { font: 'en' });
    plate(R, 4, 4, dw + 40);
    RA.text(g, date, 8, 9, { font: 'en', color: 'cream' });
    RA.text(g, '(' + (o.year ? weekdayIn(o.year, t.m, t.d) : wd) + ')', 8 + dw, 5, { color: 'cream' });
    const r = Plaza.sky.readout();
    const tw = RA.textWidth(r.text);
    plate(R, W - tw - 24, 4, tw + 20);
    Plaza.sky.icon(g, W - tw - 20, 9, st);
    RA.text(g, r.text, W - 7, 5, { color: r.real ? 'cream' : 'mist', align: 'right' });
  }

  function drawUi(g, ts) {
    leftBtn.draw(g, ts);
    rightBtn.draw(g, ts);
    enterBtn.draw(g, ts);
    const c = Math.round(cam);
    arrow(g, leftBtn.x + 14, leftBtn.y + 7, -1, c > 0 ? 'cream' : 'mist');
    arrow(g, rightBtn.x + 16, rightBtn.y + 7, 1, c < MAX_CAM ? 'cream' : 'mist');
    if (!MOBILE) {
      RA.text(g, '<- ->', 62, VIEW_H + 10, { font: 'en', color: 'mist', align: 'center' });
      RA.text(g, 'ENTER', 194, VIEW_H + 10, { font: 'en', color: 'mist', align: 'center' });
    }
  }

  // 左右の三角（先端が1ドット）
  function arrow(g, x, y, dir, color) {
    g.fillStyle = P[color];
    for (let i = 0; i < 5; i++) g.fillRect(dir < 0 ? x - 2 + i : x + 2 - i, y + 4 - i, 1, 1 + i * 2);
  }

  // ===== 視点 =====
  function update(dt) {
    cam += (camTarget - cam) * Math.min(1, dt * 10);
    if (Math.abs(camTarget - cam) < 0.5) cam = camTarget;
  }

  function pan(dir) {
    const before = camTarget;
    camTarget = clamp(camTarget + dir * PAN, 0, MAX_CAM);
    return camTarget !== before;
  }

  // プラザの正面に戻す（入店の前に）。戻り終わっていれば true。snap ならすぐに
  function home(snap) {
    camTarget = HOME;
    if (snap) cam = HOME;
    return Math.abs(cam - HOME) < 0.5;
  }

  // 自動ドアの開口のうち、扉のあいだに見えるところ（画面の座標）
  function doorGap(open) {
    const shift = Math.round(open * (DOOR.w / 2));
    return { x: DOOR.x - Math.round(cam) + DOOR.w / 2 - shift, y: DOOR.y, w: shift * 2, h: DOOR.h };
  }

  function doorRect() {
    return { x: DOOR.x - Math.round(cam), y: DOOR.y, w: DOOR.w, h: DOOR.h };
  }

  // ===== 入力 =====
  function posterAt(x, y) {
    const c = Math.round(cam);
    return POSTER_XY.findIndex(([px, py], i) => POSTER_GAMES[i] && x >= px - c && x < px - c + POSTER_W && y >= py && y < py + POSTER_H);
  }

  /*
   * 押したところに応じて { type: 'enter' } / { type: 'poster', game } / null を返す。
   * 鳩や公衆電話のような、その場で済むものはここで鳴らして null を返す
   */
  function press(x, y, now) {
    if (leftBtn.hit(x, y)) {
      leftBtn.flash(now);
      if (pan(-1)) RA.sfx.blip();
      return null;
    }
    if (rightBtn.hit(x, y)) {
      rightBtn.flash(now);
      if (pan(1)) RA.sfx.blip();
      return null;
    }
    if (enterBtn.hit(x, y)) {
      enterBtn.flash(now);
      return { type: 'enter' };
    }
    if (y >= VIEW_H) return null;
    const c = Math.round(cam);
    const wx = x + c;
    const i = posterAt(x, y);
    if (i >= 0) {
      flashPoster = i;
      flashUntil = now + 400;
      return { type: 'poster', game: POSTER_GAMES[i] };
    }
    if (wx >= DOOR.x - 4 && wx < DOOR.x + DOOR.w + 4 && y >= 128 && y < GROUND) return { type: 'enter' };
    if (wx >= BOOTH.x && wx < BOOTH.x + BOOTH.w && y >= BOOTH.y && y < GROUND) {
      if (now - phoneAt > 1600) {
        phoneAt = now;
        Plaza.sound.sfx.phone();
      }
      return null;
    }
    if (wx >= PIGEON_AREA.x && wx < PIGEON_AREA.x + PIGEON_AREA.w && y >= PIGEON_AREA.y && y < PIGEON_AREA.y + PIGEON_AREA.h) {
      if ((now - pigeonsFlyAt) / 1000 > 7) {
        pigeonsFlyAt = now;
        Plaza.sound.sfx.pigeons();
      }
    }
    return null;
  }

  function move(x, y) {
    hover = posterAt(x, y);
  }

  function key(code, now) {
    if (code === 'ArrowLeft') {
      leftBtn.flash(now);
      if (pan(-1)) RA.sfx.blip();
    } else if (code === 'ArrowRight') {
      rightBtn.flash(now);
      if (pan(1)) RA.sfx.blip();
    } else if (code === 'Enter' || code === 'Space') {
      enterBtn.flash(now);
      return { type: 'enter' };
    } else if (code === 'Digit1' || code === 'Digit2') {
      const i = code === 'Digit1' ? 0 : 1;
      if (!POSTER_GAMES[i]) return null;
      camTarget = clamp(POSTER_XY[i][0] + POSTER_W / 2 - W / 2, 0, MAX_CAM);
      flashPoster = i;
      flashUntil = now + 400;
      return { type: 'poster', game: POSTER_GAMES[i] };
    }
    return null;
  }

  // 店から聞こえる音の大きさ（入口に近いほど大きい）と、参道の近さ（鳩の声）
  function nearness() {
    const center = cam + W / 2;
    return {
      door: clamp(1 - Math.abs(center - (DOOR.x + DOOR.w / 2)) / 260, 0, 1),
      sando: clamp(1 - Math.abs(center - 56) / 220, 0, 1),
    };
  }

  const CHARS = '大須観音巻きういろー名物入口テナント募集広告ポケベル0円=ｵﾊﾖｳ近日入荷好評稼働中!大須商店街にゃらゲームプラザ名古屋°C()' + LED_TEXT + POSTER_GAMES.map((g) => g.title).join('') + '日月火水木金土';

  Plaza.street = { VIEW_H, CHARS, draw, update, pan, home, doorGap, doorRect, press, move, key, nearness, repaint };
})();
