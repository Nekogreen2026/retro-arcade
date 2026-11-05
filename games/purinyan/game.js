/*
 * ぷりにゃん — にゃらゲームプラザのプリクラ機。
 *
 * 本物のカメラで撮った写真を、店の16色パレットのドット絵に変換してシールにする。
 *   フレーム … 猫天使／きのこ／ういろう から選ぶ
 *   あの子   … ライトブラウンのツインテール、白い楕円のサングラス、右の頭に黒い角。名前はわからない（N…？）
 * カメラが使えない端末では、猫のぬいぐるみが代わりに写る。
 * 撮ったシールは画像として保存できる。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);

  // シール（フレームの外枠）と写真の位置
  const STICKER = { x: 16, y: 6, w: 224, h: 184 };
  const PHOTO = { x: 32, y: 22, w: 192, h: 144 };
  const COUNT = 3; // 撮るまでの秒読み
  const SAVE_SCALE = 4; // 保存する画像の倍率

  // ===== 状態 =====
  let phase = 'loading'; // loading, title, live, count, flash, shot
  let since = 0;
  let frameIdx = 0;
  let withHer = true;
  let camState = 'off'; // off, asking, on, none
  let video = null;
  let shotCanvas = null; // 撮った写真（ドット化済み、フレーム抜き）
  let sticker = null; // 完成したシール
  let toast = '';
  let toastUntil = 0;
  const img = {};

  const backBtn = RA.backButton();
  const frameBtn = new RA.Button({ x: 4, y: 214, w: 78, h: 22, label: 'フレーム' });
  const herBtn = new RA.Button({ x: 86, y: 214, w: 82, h: 22, label: 'あの子' });
  const shootBtn = new RA.Button({ x: 172, y: 214, w: 80, h: 22, label: '撮る！', tone: 'primary' });
  const saveBtn = new RA.Button({ x: 4, y: 214, w: 78, h: 22, label: '保存', tone: 'primary' });
  const againBtn = new RA.Button({ x: 86, y: 214, w: 82, h: 22, label: 'もういちど' });
  const topBtn = new RA.Button({ x: 172, y: 214, w: 80, h: 22, label: 'もどる' });

  function setPhase(p) {
    phase = p;
    since = performance.now();
  }

  function showToast(t) {
    toast = t;
    toastUntil = performance.now() + 1800;
  }

  // ===== 音 =====
  const A = RA.Audio;
  const snd = {
    beep(hi) {
      A.tone({ f: hi ? 1568 : 988, dur: hi ? 0.3 : 0.1, type: 'square', vol: 0.12 });
    },
    shutter() {
      A.noise({ dur: 0.05, vol: 0.5, filter: 'highpass', f: 2500 });
      A.noise({ dur: 0.09, vol: 0.4, filter: 'bandpass', f: 1200, at: 0.06 });
    },
    jingle() {
      A.melody([[1047, 0.08], [1319, 0.08], [1568, 0.08], [2093, 0.24]], { vol: 0.12 });
    },
    voice() {
      // 「はい、ちーず！」の代わりのきらきら音
      A.melody([[1319, 0.06], [1760, 0.06], [2637, 0.12]], { vol: 0.1, type: 'triangle' });
    },
  };

  // ===== カメラ =====
  function startCamera() {
    if (camState === 'on' || camState === 'asking') return;
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      camState = 'none';
      return;
    }
    camState = 'asking';
    md.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.srcObject = stream;
        return video.play().then(() => {
          camState = 'on';
        });
      })
      .catch(() => {
        camState = 'none';
        showToast('カメラなしで撮るよ');
      });
  }

  function stopCamera() {
    if (video && video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
    video = null;
    camState = 'off';
  }

  // ===== 16色に落とす（ディザ付き） =====
  const PAL = RA.PAL_NAMES.map((n) => RA.rgb(n));
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const work = document.createElement('canvas');
  work.width = PHOTO.w;
  work.height = PHOTO.h;
  const wctx = work.getContext('2d', { willReadFrequently: true });

  function nearest(r, g, b) {
    let best = 0;
    let bd = 1e9;
    for (let i = 0; i < PAL.length; i++) {
      const c = PAL[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      // 人の目は緑に敏感なので重みを付ける
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // カメラの映像を写真の枠に合わせて切り抜き（鏡写し）、パレットの色に置き換える
  function grabPhoto() {
    if (camState !== 'on' || !video || !video.videoWidth) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const want = PHOTO.w / PHOTO.h;
    let sw = vw;
    let sh = vw / want;
    if (sh > vh) {
      sh = vh;
      sw = vh * want;
    }
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    wctx.save();
    wctx.setTransform(-1, 0, 0, 1, PHOTO.w, 0);
    wctx.imageSmoothingEnabled = true; // 縮小の下ごしらえだけ。画面に出るのは下で色を置き換えたもの
    wctx.drawImage(video, sx, sy, sw, sh, 0, 0, PHOTO.w, PHOTO.h);
    wctx.restore();
    const im = wctx.getImageData(0, 0, PHOTO.w, PHOTO.h);
    const d = im.data;
    for (let y = 0; y < PHOTO.h; y++) {
      for (let x = 0; x < PHOTO.w; x++) {
        const i = (y * PHOTO.w + x) * 4;
        const t = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 4.5;
        // 少し明るく、色を濃いめに（プリクラの美白っぽさ）
        const r = d[i] * 1.12 + 10 + t;
        const g = d[i + 1] * 1.08 + 10 + t;
        const b = d[i + 2] * 1.05 + 12 + t;
        const c = PAL[nearest(r, g, b)];
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = 255;
      }
    }
    wctx.putImageData(im, 0, 0);
    return work;
  }

  // カメラがないときの写真：猫のぬいぐるみが写る
  function drawNoCam(g, x, y, ts) {
    g.fillStyle = P.dusk;
    g.fillRect(x, y, PHOTO.w, PHOTO.h);
    g.fillStyle = P.night;
    for (let yy = 0; yy < PHOTO.h; yy += 2) for (let xx = (yy / 2) % 2 ? 1 : 0; xx < PHOTO.w; xx += 2) g.fillRect(x + xx, y + yy, 1, 1);
    if (img.neko) g.drawImage(img.neko, x + 48, y + 24 + (Math.floor(ts / 500) % 2), 96, 96);
  }

  // ===== フレーム =====
  // 縁の飾り。どれも写真の角に少しかぶせる（本物のプリクラと同じく）
  const FRAMES = [
    { id: 'neko', name: '猫天使', base: 'pink', edge: 'white', dot: 'gold', deco: 'neko' },
    { id: 'kinoko', name: 'きのこ', base: 'green', edge: 'cream', dot: 'red', deco: 'kinoko' },
    { id: 'uiro', name: 'ういろう', base: 'cream', edge: 'pink', dot: 'green', deco: 'uiro' },
  ];

  function rect(g, x, y, w, h, color) {
    g.fillStyle = P[color];
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // 猫天使の輪（楕円の輪をドットで）
  function halo(g, cx, cy, color) {
    rect(g, cx - 5, cy, 11, 1, color);
    rect(g, cx - 5, cy + 3, 11, 1, color);
    rect(g, cx - 7, cy + 1, 2, 2, color);
    rect(g, cx + 6, cy + 1, 2, 2, color);
  }

  function heart(g, x, y, color) {
    rect(g, x, y, 2, 1, color);
    rect(g, x + 3, y, 2, 1, color);
    rect(g, x - 1, y + 1, 7, 2, color);
    rect(g, x, y + 3, 5, 1, color);
    rect(g, x + 1, y + 4, 3, 1, color);
    rect(g, x + 2, y + 5, 1, 1, color);
  }

  // フレームを g に描く（ox, oy はシール左上の位置）。写真の上にかぶさる飾りも含む
  function drawFrame(g, f, ox, oy, ts, photoDrawn) {
    const sx = ox;
    const sy = oy;
    const px = ox + (PHOTO.x - STICKER.x);
    const py = oy + (PHOTO.y - STICKER.y);
    // 外枠（写真の部分は描かない）
    rect(g, sx, sy, STICKER.w, py - sy, f.base);
    rect(g, sx, py + PHOTO.h, STICKER.w, sy + STICKER.h - py - PHOTO.h, f.base);
    rect(g, sx, py, px - sx, PHOTO.h, f.base);
    rect(g, px + PHOTO.w, py, sx + STICKER.w - px - PHOTO.w, PHOTO.h, f.base);
    // 縁取り
    rect(g, sx, sy, STICKER.w, 1, 'ink');
    rect(g, sx, sy + STICKER.h - 1, STICKER.w, 1, 'ink');
    rect(g, sx, sy, 1, STICKER.h, 'ink');
    rect(g, sx + STICKER.w - 1, sy, 1, STICKER.h, 'ink');
    rect(g, px - 1, py - 1, PHOTO.w + 2, 1, f.edge);
    rect(g, px - 1, py + PHOTO.h, PHOTO.w + 2, 1, f.edge);
    rect(g, px - 1, py, 1, PHOTO.h, f.edge);
    rect(g, px + PHOTO.w, py, 1, PHOTO.h, f.edge);
    // 枠の水玉
    for (let x = sx + 6; x < sx + STICKER.w - 4; x += 10) {
      rect(g, x, sy + 6, 2, 2, f.dot);
      rect(g, x + 5, py + PHOTO.h + 6, 2, 2, f.dot);
    }
    for (let y = py + 8; y < py + PHOTO.h - 4; y += 12) {
      rect(g, sx + 6, y, 2, 2, f.dot);
      rect(g, sx + STICKER.w - 8, y, 2, 2, f.dot);
    }
    // 角の飾り
    const corners = [
      [px - 14, py - 14],
      [px + PHOTO.w - 18, py - 14],
      [px - 14, py + PHOTO.h - 18],
      [px + PHOTO.w - 18, py + PHOTO.h - 18],
    ];
    const bob = Math.floor(ts / 400) % 2;
    corners.forEach(([x, y], k) => {
      const yy = y + (k % 2 === bob ? 1 : 0);
      if (f.deco === 'neko' && img.neko) {
        g.drawImage(img.neko, x, yy);
        halo(g, x + 16, yy - 3, 'gold');
      } else if (f.deco === 'kinoko' && img.kinoko) {
        g.drawImage(img.kinoko, x, yy);
      } else if (f.deco === 'uiro' && img.uiro[k % img.uiro.length]) {
        g.drawImage(img.uiro[k % img.uiro.length], x, yy);
      }
    });
    // 下の帯の文字：機械の名前と日付（1996年の今日）
    const now = new Date();
    const md = (now.getMonth() + 1) + '.' + now.getDate();
    RA.text(g, 'ぷりにゃん', sx + STICKER.w / 2, py + PHOTO.h + 2, { color: f.base === 'cream' ? 'pink' : 'white', outline: 'ink', align: 'center' });
    RA.text(g, '1996.' + md, sx + STICKER.w - 40, sy + 5, { font: 'en', color: f.base === 'cream' ? 'ink' : 'white', align: 'right' });
    // 上の帯：ハートときらきら
    // あの子と撮ったときだけ、名前の手がかりが残る
    if (withHer) RA.text(g, 'N...?', sx + 40, sy + 5, { font: 'en', color: f.base === 'cream' ? 'mist' : 'white' });
    [-62, 56].forEach((dx, k) => heart(g, sx + STICKER.w / 2 + dx, py + PHOTO.h + 9 + ((k + bob) % 2), 'red'));
  }

  // ===== あの子（ライトブラウンのツインテール、白い楕円のサングラス、右の頭に黒い角が1本） =====
  // 服は季節で替わる（日本時間）：夏（6〜9月）＝サメの絵のTシャツ、冬（12〜2月）＝もふもふの服（羊さんの絵、
  // もこもこのイヤーマフ、手袋）、それ以外（春・秋）＝フードをかぶったパーカー（正面に大きなきのこ1つ）
  // 差し替え用の絵 assets/chara/nazo-peace.png（64×96）があればそれを使う。なければドットで描く
  function seasonOfHer() {
    const q = new URLSearchParams(location.search).get('season'); // 確認用: ?season=summer|autumn|winter
    if (q === 'summer' || q === 'autumn' || q === 'winter') return q;
    const m = new Date(Date.now() + 9 * 3600e3).getUTCMonth() + 1;
    if (m >= 6 && m <= 9) return 'summer';
    if (m === 12 || m <= 2) return 'winter';
    return 'autumn';
  }

  // 2色の市松でパレット外の中間色（ライトブラウンなど）を作る
  function dith(g, x, y, w, h, a, b) {
    rect(g, x, y, w, h, a);
    g.fillStyle = P[b];
    for (let yy = 0; yy < h; yy++) for (let xx = (x + y + yy) % 2; xx < w; xx += 2) g.fillRect(x + xx, y + yy, 1, 1);
  }

  function drawHer(g, x, y, ts) {
    if (img.her) {
      g.drawImage(img.her, x, y);
      return;
    }
    const hair = (hx, hy, w, h) => dith(g, hx, hy, w, h, 'orange', 'brown');
    const sway = Math.floor(ts / 600) % 2;
    const season = seasonOfHer();
    // ツインテール
    hair(x + 6 - sway, y + 18, 8, 34);
    hair(x + 4 - sway, y + 30, 8, 26);
    hair(x + 50 + sway, y + 18, 8, 34);
    hair(x + 52 + sway, y + 30, 8, 26);
    rect(g, x + 7 - sway, y + 20, 1, 28, 'gold');
    rect(g, x + 53 + sway, y + 20, 1, 28, 'gold');
    rect(g, x + 10, y + 16, 6, 4, 'ink');
    rect(g, x + 48, y + 16, 6, 4, 'ink');
    // 頭
    hair(x + 16, y + 6, 32, 10);
    hair(x + 14, y + 12, 36, 24);
    rect(g, x + 20, y + 7, 12, 1, 'gold');
    const horn = () => {
      rect(g, x + 38, y + 4, 6, 4, 'ink');
      rect(g, x + 41, y + 1, 5, 4, 'ink');
      rect(g, x + 44, y - 2, 4, 4, 'ink');
      rect(g, x + 47, y - 5, 3, 4, 'ink');
      rect(g, x + 49, y - 7, 2, 3, 'ink');
      rect(g, x + 50, y - 8, 1, 1, 'ink');
      rect(g, x + 42, y + 2, 1, 2, 'mist');
      rect(g, x + 45, y - 1, 1, 2, 'mist');
    };
    // 右の頭の黒い角（外へ反って上を向く）
    horn();
    // 顔
    rect(g, x + 18, y + 18, 28, 22, 'cream');
    hair(x + 18, y + 16, 28, 5);
    hair(x + 22, y + 21, 4, 2);
    hair(x + 34, y + 21, 5, 2);
    // 白い楕円フレームのサングラス
    [[x + 19, y + 24], [x + 33, y + 24]].forEach(([gx, gy]) => {
      rect(g, gx + 1, gy, 10, 1, 'white');
      rect(g, gx + 1, gy + 7, 10, 1, 'white');
      rect(g, gx, gy + 1, 1, 6, 'white');
      rect(g, gx + 11, gy + 1, 1, 6, 'white');
      rect(g, gx + 1, gy + 1, 10, 6, 'ink');
      rect(g, gx + 2, gy + 2, 3, 1, 'mist');
    });
    rect(g, x + 31, y + 26, 2, 1, 'white');
    rect(g, x + 29, y + 35, 6, 1, 'maroon');
    rect(g, x + 28, y + 40, 8, 4, 'cream');
    if (season === 'autumn') {
      // パーカーのフードをかぶる（顔のまわりだけ開いていて、角はフードの穴から出ている）
      rect(g, x + 13, y + 4, 38, 12, 'blue');
      rect(g, x + 11, y + 10, 6, 32, 'blue');
      rect(g, x + 47, y + 10, 6, 32, 'blue');
      rect(g, x + 15, y + 2, 34, 3, 'blue');
      rect(g, x + 17, y + 15, 30, 1, 'night'); // フードのふち
      rect(g, x + 17, y + 15, 1, 26, 'night');
      rect(g, x + 46, y + 15, 1, 26, 'night');
      rect(g, x + 18, y + 3, 10, 1, 'cyan');
      horn();
      // ひも
      rect(g, x + 24, y + 40, 1, 9, 'white');
      rect(g, x + 39, y + 40, 1, 9, 'white');
      rect(g, x + 23, y + 49, 3, 2, 'white');
      rect(g, x + 38, y + 49, 3, 2, 'white');
    } else if (season === 'winter') {
      // もこもこのイヤーマフ
      rect(g, x + 16, y + 3, 32, 2, 'pink');
      rect(g, x + 14, y + 5, 3, 14, 'pink');
      rect(g, x + 47, y + 5, 3, 14, 'pink');
      [[x + 8, y + 18], [x + 45, y + 18]].forEach(([mx, my]) => {
        rect(g, mx + 2, my, 7, 14, 'pink');
        rect(g, mx, my + 2, 11, 10, 'pink');
        dith(g, mx + 2, my + 2, 7, 10, 'pink', 'white');
        rect(g, mx + 3, my + 1, 2, 1, 'white');
      });
    }
    // 服
    if (season === 'summer') {
      // 白いTシャツ（半袖）。胸に、口を開けて牙をむくサメ
      rect(g, x + 14, y + 44, 36, 40, 'white');
      rect(g, x + 8, y + 44, 8, 8, 'white');
      rect(g, x + 48, y + 44, 8, 8, 'white');
      rect(g, x + 9, y + 52, 6, 14, 'cream'); // 腕
      const sx = x + 20;
      const sy = y + 52;
      rect(g, sx + 10, sy, 4, 4, 'mist'); // 背びれ
      rect(g, sx + 11, sy - 2, 2, 2, 'mist');
      rect(g, sx, sy + 4, 24, 14, 'mist');
      rect(g, sx + 2, sy + 12, 20, 6, 'silver'); // 腹
      rect(g, sx + 3, sy + 9, 18, 6, 'red'); // 開いた口
      for (let k = 0; k < 6; k++) {
        rect(g, sx + 4 + k * 3, sy + 9, 2, 2, 'white'); // 上の牙
        rect(g, sx + 4 + k * 3, sy + 13, 2, 2, 'white'); // 下の牙
      }
      rect(g, sx + 5, sy + 6, 2, 2, 'ink'); // 目
      rect(g, sx - 3, sy + 18, 30, 3, 'blue'); // 波
      rect(g, sx - 1, sy + 17, 4, 1, 'cyan');
      rect(g, sx + 12, sy + 17, 4, 1, 'cyan');
    } else if (season === 'winter') {
      // もふもふの服（ふちが丸く波打つ）。正面に羊さん、手には手袋
      rect(g, x + 10, y + 46, 44, 38, 'mist');
      for (let k = 0; k < 11; k++) {
        rect(g, x + 9 + k * 4, y + 44 + (k % 2), 4, 3, 'white');
        rect(g, x + 7, y + 48 + k * 3, 4, 2, 'white');
        rect(g, x + 53, y + 48 + k * 3, 4, 2, 'white');
      }
      dith(g, x + 12, y + 48, 40, 34, 'mist', 'silver');
      rect(g, x + 6, y + 64, 7, 7, 'red'); // 左の手袋
      rect(g, x + 6, y + 63, 7, 1, 'white');
      // 羊さん
      const hx = x + 19;
      const hy = y + 54;
      [[0, 4], [4, 1], [9, 0], [14, 1], [18, 4], [2, 9], [16, 9]].forEach(([dx, dy]) => rect(g, hx + dx, hy + dy, 6, 6, 'white'));
      rect(g, hx + 2, hy + 4, 20, 10, 'white');
      dith(g, hx + 3, hy + 5, 18, 8, 'white', 'cream');
      rect(g, hx + 19, hy + 5, 7, 8, 'ink'); // 顔
      rect(g, hx + 18, hy + 6, 2, 2, 'ink'); // 耳
      rect(g, hx + 25, hy + 6, 2, 2, 'ink');
      rect(g, hx + 21, hy + 8, 1, 1, 'white'); // 目
      rect(g, hx + 24, hy + 8, 1, 1, 'white');
      [4, 8, 14, 18].forEach((dx) => rect(g, hx + dx, hy + 14, 2, 4, 'ink')); // 足
    } else {
      // パーカー。正面に大きなきのこが1つ
      rect(g, x + 10, y + 44, 44, 40, 'blue');
      rect(g, x + 6, y + 46, 6, 22, 'blue'); // 左の袖
      rect(g, x + 6, y + 66, 6, 2, 'night');
      const kx = x + 18;
      const ky = y + 50;
      rect(g, kx + 4, ky, 20, 2, 'red'); // 傘
      rect(g, kx + 1, ky + 2, 26, 4, 'red');
      rect(g, kx, ky + 6, 28, 5, 'red');
      rect(g, kx, ky + 11, 28, 1, 'maroon');
      rect(g, kx + 5, ky + 3, 4, 3, 'white'); // 水玉
      rect(g, kx + 15, ky + 1, 4, 3, 'white');
      rect(g, kx + 21, ky + 6, 3, 3, 'white');
      rect(g, kx + 10, ky + 7, 3, 2, 'white');
      rect(g, kx + 9, ky + 12, 10, 12, 'cream'); // 柄
      rect(g, kx + 8, ky + 22, 12, 2, 'cream');
      rect(g, kx + 11, ky + 14, 1, 7, 'silver');
      rect(g, x + 14, y + 76, 36, 1, 'night'); // ポケット
      rect(g, x + 14, y + 76, 1, 8, 'night');
      rect(g, x + 49, y + 76, 1, 8, 'night');
      rect(g, x + 50, y + 50, 6, 8, 'blue'); // 右の袖口
    }
    // ピースの手（冬は赤い手袋）
    const hand = season === 'winter' ? 'red' : 'cream';
    rect(g, x + 50, y + 50, 8, 8, hand);
    rect(g, x + 51, y + 42, 2, 8, hand);
    rect(g, x + 55, y + 42, 2, 8, hand);
    if (season === 'winter') rect(g, x + 50, y + 57, 8, 1, 'white');
  }

  // 写真の中身（ライブ映像 or 撮ったもの）を描く
  function drawPhotoContent(g, ox, oy, ts, shot) {
    const px = ox + (PHOTO.x - STICKER.x);
    const py = oy + (PHOTO.y - STICKER.y);
    const src = shot || grabPhoto();
    if (src) g.drawImage(src, px, py);
    else drawNoCam(g, px, py, ts);
    if (withHer) {
      g.save();
      g.beginPath();
      g.rect(px, py, PHOTO.w, PHOTO.h);
      g.clip();
      drawHer(g, px + PHOTO.w - 70, py + PHOTO.h - 96 + 12, shot ? 0 : ts);
      g.restore();
    }
  }

  // ===== 撮影 =====
  function shoot() {
    if (phase !== 'live') return;
    setPhase('count');
  }

  function capture(ts) {
    // 写真だけを確定させる（あの子はシールに合成するときに描く）
    const c = document.createElement('canvas');
    c.width = PHOTO.w;
    c.height = PHOTO.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const src = grabPhoto();
    if (src) g.drawImage(src, 0, 0);
    else drawNoCam(g, 0, 0, ts);
    shotCanvas = c;
    // シールを作る
    const s = document.createElement('canvas');
    s.width = STICKER.w;
    s.height = STICKER.h;
    const sg = s.getContext('2d');
    sg.imageSmoothingEnabled = false;
    drawPhotoContent(sg, 0, 0, 0, shotCanvas);
    drawFrame(sg, FRAMES[frameIdx], 0, 0, 0, true);
    sticker = s;
    prepareSave();
  }

  // ===== 保存 =====
  // スマホは端末の共有メニュー（「画像を保存」で写真アプリへ）、PCと共有メニューのない端末はダウンロード。
  // 共有はユーザー操作の直後にしか呼べないので、画像のファイルは撮った時点で先に作っておく
  let saveFile = null; // 共有用の File
  let saveUrl = null; // ダウンロード用の URL
  let saveName = '';

  function bigSticker() {
    const big = document.createElement('canvas');
    big.width = STICKER.w * SAVE_SCALE;
    big.height = STICKER.h * SAVE_SCALE;
    const bg = big.getContext('2d');
    bg.imageSmoothingEnabled = false;
    bg.drawImage(sticker, 0, 0, big.width, big.height);
    return big;
  }

  function prepareSave() {
    const d = new Date();
    const two = (n) => String(n).padStart(2, '0');
    saveName = 'purinyan-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + '.png';
    if (saveUrl) URL.revokeObjectURL(saveUrl);
    saveFile = null;
    saveUrl = null;
    const big = bigSticker();
    const forSticker = sticker;
    big.toBlob((blob) => {
      if (!blob || sticker !== forSticker) return; // 撮り直したあとに届いた古い画像は捨てる
      saveUrl = URL.createObjectURL(blob);
      try {
        saveFile = new File([blob], saveName, { type: 'image/png' });
      } catch (e) {
        saveFile = null; // File を作れない古いブラウザ
      }
    }, 'image/png');
  }

  function canShareFile() {
    if (!RA.isMobile() || !saveFile || !navigator.share || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [saveFile] });
    } catch (e) {
      return false;
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = saveUrl || bigSticker().toDataURL('image/png');
    a.download = saveName || 'purinyan.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('保存したよ');
  }

  function save(ev) {
    if (!sticker) return;
    if (!saveUrl) {
      showToast('ちょっと待ってね');
      return;
    }
    const share = canShareFile();
    RA.withActivation(ev, () => {
      if (!share) {
        download();
        return;
      }
      navigator
        .share({ files: [saveFile], title: 'ぷりにゃん' })
        .then(() => showToast('シールを渡したよ'))
        .catch((err) => {
          if (err && err.name === 'AbortError') return; // 共有メニューを閉じただけ
          download();
        });
    });
  }

  // ===== 入力 =====
  function onPress(ev) {
    const now = performance.now();
    const pointer = ev.kind === 'pointer';
    const code = ev.code;
    if (phase === 'loading') return;
    if ((pointer && phase !== 'shot' && backBtn.hit(ev.x, ev.y)) || code === 'Escape') {
      backBtn.flash(now);
      stopCamera();
      setTimeout(RA.goTop, 120);
      return;
    }
    if (phase === 'title') {
      if (pointer || code === 'Space' || code === 'Enter') {
        snd.jingle();
        startCamera();
        setPhase('live');
      }
      return;
    }
    if (phase === 'live') {
      const hit = (b) => pointer && b.hit(ev.x, ev.y);
      if (hit(frameBtn) || code === 'KeyF' || code === 'ArrowRight') {
        frameBtn.flash(now);
        frameIdx = (frameIdx + 1) % FRAMES.length;
        RA.sfx.blip();
      } else if (code === 'ArrowLeft') {
        frameIdx = (frameIdx + FRAMES.length - 1) % FRAMES.length;
        RA.sfx.blip();
      } else if (hit(herBtn) || code === 'KeyN') {
        herBtn.flash(now);
        withHer = !withHer;
        RA.sfx.blip();
      } else if (hit(shootBtn) || code === 'Space' || code === 'Enter') {
        shootBtn.flash(now);
        shoot();
      }
      return;
    }
    if (phase === 'shot') {
      if (now - since < 600) return;
      const hit = (b) => pointer && b.hit(ev.x, ev.y);
      if (hit(saveBtn) || code === 'KeyS') {
        saveBtn.flash(now);
        save(ev);
      } else if (hit(againBtn) || code === 'Space' || code === 'Enter' || code === 'KeyR') {
        againBtn.flash(now);
        sticker = null;
        setPhase('live');
      } else if (hit(topBtn)) {
        topBtn.flash(now);
        stopCamera();
        setTimeout(RA.goTop, 120);
      }
    }
  }

  RA.bindInput(canvas, { press: onPress, key: onPress });

  // ===== 描画 =====
  let lastBeep = -1;

  function drawBooth(ts) {
    // プリクラ機の中：カーテンの縞とラメ
    rect(ctx, 0, 0, W, H, 'night');
    for (let x = 0; x < W; x += 16) rect(ctx, x, 0, 8, 200, 'dusk');
    for (let k = 0; k < 24; k++) {
      const x = (k * 53 + Math.floor(ts / 300) * 7) % W;
      const y = (k * 31) % 196;
      if ((k + Math.floor(ts / 200)) % 3 === 0) rect(ctx, x, y, 1, 1, 'white');
    }
    rect(ctx, 0, 200, W, 40, 'ink');
  }

  function drawTitle(ts) {
    drawBooth(ts);
    RA.text(ctx, 'ぷりにゃん', 128, 40, { size: 32, color: 'pink', align: 'center', outline: 'white' });
    RA.text(ctx, '1996年の色で、きみを撮る', 128, 84, { color: 'cream', align: 'center', outline: 'ink' });
    if (img.neko) ctx.drawImage(img.neko, 0, 0, 32, 32, 40, 108, 64, 64);
    drawHer(ctx, 140, 112, ts);
    RA.text(ctx, '？？？', 206, 140, { color: 'silver' });
    if (Math.floor(ts / 500) % 2 === 0) {
      RA.text(ctx, DIV_PC ? 'クリック／スペースで入る' : 'タップで入る', 128, 206, { color: 'gold', align: 'center', outline: 'ink' });
    }
    RA.text(ctx, 'カメラを使うよ', 128, 222, { color: 'mist', align: 'center' });
    backBtn.draw(ctx, ts);
  }

  function drawLive(ts) {
    drawBooth(ts);
    drawPhotoContent(ctx, STICKER.x, STICKER.y, ts, null);
    drawFrame(ctx, FRAMES[frameIdx], STICKER.x, STICKER.y, ts, true);
    if (camState === 'asking') RA.text(ctx, 'カメラを準備中…', 128, 80, { color: 'cream', align: 'center', outline: 'ink' });
    frameBtn.label = FRAMES[frameIdx].name;
    herBtn.label = withHer ? 'あの子：あり' : 'あの子：なし';
    frameBtn.draw(ctx, ts);
    herBtn.draw(ctx, ts);
    shootBtn.draw(ctx, ts);
    RA.text(ctx, 'フレーム', 43, 196, { color: 'silver', align: 'center' });
    backBtn.draw(ctx, ts);
  }

  function drawCount(ts) {
    drawLive(ts);
    const el = (ts - since) / 1000;
    const n = COUNT - Math.floor(el);
    if (n !== lastBeep && n >= 1) {
      lastBeep = n;
      snd.beep(false);
    }
    if (n >= 1) {
      RA.text(ctx, String(n), 128, 70, { size: 48, color: 'white', align: 'center', outline: 'pink' });
      if (n === 1) RA.text(ctx, 'はい、にゃーず！', 128, 130, { color: 'gold', align: 'center', outline: 'ink' });
    } else {
      lastBeep = -1;
      snd.shutter();
      capture(ts);
      setPhase('flash');
      setTimeout(snd.voice, 250);
    }
  }

  function drawFlash(ts) {
    const el = ts - since;
    if (el < 120) {
      rect(ctx, 0, 0, W, H, 'white');
      return;
    }
    if (el < 220) {
      // ディザで白から戻す
      drawShot(ts);
      ctx.fillStyle = P.white;
      for (let y = 0; y < H; y++) for (let x = y % 2; x < W; x += 2) ctx.fillRect(x, y, 1, 1);
      return;
    }
    setPhase('shot');
  }

  function drawShot(ts) {
    drawBooth(ts);
    if (sticker) ctx.drawImage(sticker, STICKER.x, STICKER.y);
    saveBtn.draw(ctx, ts);
    againBtn.draw(ctx, ts);
    topBtn.draw(ctx, ts);
    RA.text(ctx, 'できあがり！', 128, 194, { color: 'gold', align: 'center', outline: 'ink' });
  }

  function drawLoading(ts) {
    rect(ctx, 0, 0, W, H, 'ink');
    RA.text(ctx, 'よみこみちゅう' + '...'.slice(0, Math.floor(ts / 300) % 4), 72, 112, { color: 'silver' });
  }

  function drawToast() {
    if (performance.now() >= toastUntil) return;
    const w = RA.textWidth(toast) + 16;
    const x = Math.round((W - w) / 2);
    rect(ctx, x, 150, w, 20, 'cream');
    rect(ctx, x + 1, 151, w - 2, 18, 'ink');
    RA.text(ctx, toast, 128, 152, { color: 'cream', align: 'center' });
  }

  const DIV_PC = !RA.isMobile();

  RA.loop((ts) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (phase === 'loading') drawLoading(ts);
    else if (phase === 'title') drawTitle(ts);
    else if (phase === 'live') drawLive(ts);
    else if (phase === 'count') drawCount(ts);
    else if (phase === 'flash') drawFlash(ts);
    else if (phase === 'shot') drawShot(ts);
    drawToast();
  });

  // ===== 読み込み =====
  function loadImage(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }

  const CHARS = '×—…、。「」〜あいうえおかがきくぐけこごさしじすずせそただちっつてでとどなにぬねのはばひびふぶぷへべぽまみむめもゃゅょよらりるれろわをんァアィイウカガクグケゲゴサザシスズタダッツテデトドニハパピフブプペホポマムメャヤュユラリルレロン・ー上下中丸人今付代以位体作使保倍傘備像先入共円写冬出分切前力化半反取口古右合同名向含呼垂変夏外大天女子字存季完定射小少届左差市帯年店影待後感態成戻手打抜捨描換撮操敏文日明映春時替月有服末本松枠柄械楕機正残水波済渡準濃灰点牙物状猫率玉用画白目直真確秋秒穴端節結絵緑縁縞縮置羊美耳背胸腕腹色落袋袖角認読赤足身輪込選部重鏡閉開間面音頭顔飾首髪黒！（）／：＝？';

  Promise.all([
    loadImage('assets/neko.png'),
    loadImage('assets/kinoko.png'),
    loadImage('assets/sakura.png'),
    loadImage('assets/matcha.png'),
    loadImage('assets/yuzu.png'),
    loadImage('../../assets/chara/nazo-peace.png'),
    RA.textReady(CHARS),
  ]).then(([neko, kinoko, u1, u2, u3, her]) => {
    img.neko = neko;
    img.kinoko = kinoko;
    img.uiro = [u1, u2, u3].filter(Boolean);
    img.her = her;
    setPhase('title');
  });

  window.addEventListener('pagehide', stopCamera);
})();
