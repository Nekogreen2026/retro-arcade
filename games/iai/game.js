/*
 * 居合 — 負けるまで鬼を斬り続ける勝ち抜き戦。
 *
 * 静かな画面でしばらく待つと「鬼」か「猫天使」が現れる。
 *   鬼を猶予内に斬る      … 成功。反応時間を見せて次の待ちへ
 *   鬼を斬れない          … 負け「遅い」
 *   猫天使を斬る          … 負け「天罰」
 *   猫天使を斬らずに耐える … 猫天使が去り、また待ちへ
 *   現れる前に斬る        … 負け「早まったな」
 * 反応時間は「絵が画面に出たフレーム」から、入力イベントの時刻までで測る。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);

  // ===== 決まりごと（時間はミリ秒） =====
  const READY_TIME = 1000; // 「いざ」の間
  const SHOW_TIME = 800; // 鬼を斬ったあと反応時間を見せる長さ
  const NEKO_STAY = 600; // 猫天使を斬らずに耐える長さ
  const GRACE_START = 1000; // 鬼の猶予（はじめ）
  const GRACE_MIN = 600; // 鬼の猶予（最短）
  const NEKO_START = 0.3; // 猫天使が出る割合（はじめ）
  const NEKO_MAX = 0.4; // 猫天使が出る割合（最大）
  const WAIT_MID = 4000; // 待ち時間の中心。揺れ幅は ±1秒（3〜5秒）から ±2秒（2〜6秒）へ広がる
  const SPREAD_START = 1000;
  const SPREAD_MAX = 2000;
  const RAMP_KILLS = 50; // この撃破数で難易度が最大になる
  const RESULT_LOCK = 700; // 終了画面に切り替わった直後の誤操作よけ
  const LOSE_TIME = { early: 1400, slow: 1500, tenbatsu: 2000 };
  const REASON = { early: '早まったな', slow: '遅い', tenbatsu: '天罰' };
  const RANKS = [
    [100, '百鬼斬り'],
    [30, '剣豪'],
    [10, '十人斬り'],
    [5, '見習い'],
  ];

  // ===== 部（PC／スマホ）ごとの記録 =====
  const DIV = RA.isMobile() ? 'sp' : 'pc';
  const DIV_NAME = DIV === 'sp' ? 'スマホの部' : 'PCの部';
  const BEST_COUNT = ['iai', DIV, 'best-count'];
  const BEST_MS = ['iai', DIV, 'best-ms'];

  const difficulty = (kills) => Math.min(1, kills / RAMP_KILLS);
  const graceOf = (kills) => Math.round(GRACE_START - (GRACE_START - GRACE_MIN) * difficulty(kills));
  const nekoRateOf = (kills) => NEKO_START + (NEKO_MAX - NEKO_START) * difficulty(kills);
  function waitOf(kills) {
    const spread = SPREAD_START + (SPREAD_MAX - SPREAD_START) * difficulty(kills);
    return WAIT_MID - spread + Math.random() * spread * 2;
  }
  function rankOf(kills) {
    const r = RANKS.find(([n]) => kills >= n);
    return r ? r[1] : null;
  }

  // ===== 鬼・猫天使の表示枠（大きさ・位置は両者共通） =====
  // 32×32 の絵なら3倍の96ドット。差し替えた絵の大きさが違っても、この枠に収まる最大の整数倍で描く
  const BOX = { x: 80, y: 72, size: 96 };

  function place(im, x, y, size) {
    let s = Math.floor(Math.min(size / im.width, size / im.height));
    if (s < 1) s = Math.min(size / im.width, size / im.height);
    const w = Math.round(im.width * s);
    const h = Math.round(im.height * s);
    return { s, w, h, x: x + Math.round((size - w) / 2), y: y + size - h };
  }

  // ===== 効果音 =====
  const A = RA.Audio;
  const snd = {
    start() {
      RA.sfx.coin();
    },
    // 出現音（鬼・猫天使で共通）: 拍子木のような「カンッ」
    appear() {
      A.tone({ f: 1760, dur: 0.09, type: 'square', vol: 0.16 });
      A.tone({ f: 2637, dur: 0.14, type: 'triangle', vol: 0.2 });
      A.noise({ dur: 0.03, vol: 0.35, filter: 'highpass', f: 3000 });
    },
    // 斬撃音: 空を切る音＋手応え＋刃の鳴り
    slash() {
      A.noise({ dur: 0.22, vol: 0.55, filter: 'bandpass', f: 7000, f2: 700, q: 1.4 });
      A.noise({ dur: 0.14, vol: 0.4, filter: 'lowpass', f: 500, at: 0.02 });
      A.tone({ f: 260, f2: 60, dur: 0.16, type: 'square', vol: 0.16, at: 0.01 });
      A.tone({ f: 3520, dur: 0.35, type: 'sine', vol: 0.05, at: 0.02 });
    },
    swish() {
      A.noise({ dur: 0.2, vol: 0.45, filter: 'bandpass', f: 6000, f2: 900, q: 1.2 });
    },
    // 「にゃ」: こもった「ん」から口が開いて「ゃ」へ
    nya(at) {
      const c = A.ctx;
      if (!c) return;
      const t = c.currentTime + (at || 0);
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(560, t);
      osc.frequency.linearRampToValueAtTime(900, t + 0.07);
      osc.frequency.linearRampToValueAtTime(780, t + 0.2);
      osc.frequency.linearRampToValueAtTime(520, t + 0.36);
      const vib = c.createOscillator();
      const vibAmt = c.createGain();
      vib.frequency.value = 28;
      vibAmt.gain.value = 14;
      vib.connect(vibAmt).connect(osc.frequency);
      const mouth = c.createBiquadFilter();
      mouth.type = 'lowpass';
      mouth.Q.value = 9;
      mouth.frequency.setValueAtTime(480, t);
      mouth.frequency.exponentialRampToValueAtTime(2600, t + 0.08);
      mouth.frequency.exponentialRampToValueAtTime(1300, t + 0.36);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
      g.gain.setValueAtTime(0.3, t + 0.17);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      osc.connect(mouth).connect(g).connect(A.out);
      osc.start(t);
      vib.start(t);
      osc.stop(t + 0.4);
      vib.stop(t + 0.4);
    },
    buzz() {
      A.tone({ f: 110, f2: 82, dur: 0.42, type: 'square', vol: 0.16 });
      A.tone({ f: 117, f2: 87, dur: 0.42, type: 'square', vol: 0.12 });
    },
    hit() {
      A.noise({ dur: 0.45, vol: 0.7, filter: 'lowpass', f: 1400, f2: 80 });
      A.tone({ f: 150, f2: 40, dur: 0.4, type: 'square', vol: 0.22 });
    },
    thunder(at) {
      A.noise({ dur: 0.12, vol: 0.6, filter: 'highpass', f: 2000, at });
      A.noise({ dur: 1.6, vol: 0.75, filter: 'lowpass', f: 1600, f2: 110, attack: 0.01, at: at + 0.04 });
      A.tone({ f: 55, f2: 30, dur: 0.9, type: 'square', vol: 0.1, at });
    },
    saved() {
      A.melody(
        [
          [1047, 0.045],
          [1319, 0.045],
          [1568, 0.045],
          [2093, 0.12],
        ],
        { type: 'triangle', vol: 0.12 }
      );
    },
    rank() {
      A.melody(
        [
          [784, 0.08],
          [1047, 0.08],
          [1319, 0.08],
          [1568, 0.26],
        ],
        { vol: 0.11, at: 0.14 }
      );
    },
    record() {
      const lead = [
        [523, 0.1],
        [659, 0.1],
        [784, 0.1],
        [1047, 0.2],
        [0, 0.06],
        [784, 0.1],
        [1047, 0.5],
      ];
      A.melody(lead, { vol: 0.12 });
      A.melody(
        [
          [262, 0.3],
          [392, 0.26],
          [0, 0.1],
          [523, 0.6],
        ],
        { type: 'triangle', vol: 0.16 }
      );
    },
    over() {
      A.melody(
        [
          [392, 0.16],
          [330, 0.16],
          [262, 0.4],
        ],
        { type: 'triangle', vol: 0.16 }
      );
    },
  };

  // ===== 背景（夜の野原）。一度だけ描いて使い回す =====
  const MOON = { x: 44, y: 46 };
  const GROUND_Y = 152;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function disc(g, cx, cy, r, color) {
    g.fillStyle = P[color];
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt((r + 0.5) ** 2 - dy * dy));
      g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
    }
  }

  // すすき（地面から生えて穂が垂れる影絵）
  function susuki(g, x0, y0, h, lean) {
    g.fillStyle = P.ink;
    for (let i = 0; i < h; i++) {
      const k = i / h;
      const x = x0 + Math.round(lean * k * k * 14);
      g.fillRect(x, y0 - i, 1, 1);
      if (k > 0.62 && i % 2 === 0) {
        const side = (i / 2) % 2 === 0 ? 1 : -1;
        const len = 2 + Math.round((1 - k) * 6);
        for (let j = 1; j <= len; j++) g.fillRect(x + side * j, y0 - i + Math.floor(j / 2), 1, 1);
      }
    }
  }

  function paintScene() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const rnd = seeded(2026);
    g.fillStyle = P.night;
    g.fillRect(0, 0, W, H);
    // 地平線に近いほど宵闇の色へ（ディザで混ぜる）
    g.fillStyle = P.dusk;
    for (let y = 88; y < GROUND_Y; y++) {
      const lv = (y - 88) / 44;
      for (let x = 0; x < W; x++) if (bayer(x, y) < lv) g.fillRect(x, y, 1, 1);
    }
    // 星
    for (let i = 0; i < 48; i++) {
      const x = Math.floor(rnd() * W);
      const y = Math.floor(rnd() * 96);
      const bright = rnd() < 0.3;
      if ((x - MOON.x) ** 2 + (y - MOON.y) ** 2 < 24 * 24) continue;
      g.fillStyle = bright ? P.white : P.silver;
      g.fillRect(x, y, 1, 1);
    }
    // 月
    disc(g, MOON.x, MOON.y, 15, 'cream');
    g.fillStyle = P.silver;
    [
      [-6, -5, 3, 2],
      [3, 2, 4, 3],
      [-3, 7, 2, 2],
      [6, -8, 2, 1],
      [-9, 3, 2, 2],
    ].forEach(([dx, dy, w, h]) => g.fillRect(MOON.x + dx, MOON.y + dy, w, h));
    // 遠くの山なみ
    g.fillStyle = P.night;
    for (let x = 0; x < W; x++) {
      const top = 134 + Math.round(6 * Math.sin(x / 23) + 4 * Math.sin(x / 9 + 1) + 3 * Math.sin(x / 41 + 2));
      g.fillRect(x, top, 1, GROUND_Y - top);
    }
    // 地面と草
    g.fillStyle = P.ink;
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle = P.night;
    for (let i = 0; i < 70; i++) {
      const y = GROUND_Y + 3 + Math.floor(rnd() * (H - GROUND_Y - 4));
      const near = (y - GROUND_Y) / (H - GROUND_Y);
      g.fillRect(Math.floor(rnd() * W), y, 2 + Math.floor(near * 7), 1);
    }
    // すすき
    [
      [8, 46, 1],
      [13, 58, 1.4],
      [19, 40, 0.8],
      [24, 52, 1.6],
      [234, 50, -1.2],
      [240, 62, -1.5],
      [246, 44, -0.9],
    ].forEach(([x, h, lean]) => susuki(g, x, GROUND_Y + 10, h, lean));
    return c;
  }
  const scene = paintScene();

  // ===== 状態 =====
  const img = { oni: null, neko: null };
  let phase = 'loading'; // loading, error, title, ready, wait, appear, show, lose, result
  let since = null; // その場面が始まった時刻（null なら次のフレームの時刻）
  let errorText = '';
  let titleBest = '';

  // 1回の挑戦
  let kills = 0;
  let saved = 0;
  let times = [];
  let bestCountAtStart = 0;
  let bestMsAtStart = null;
  // 待ち・出現
  let waitFor = 0;
  let waitFrom = 'ready'; // どの場面から待ちに入ったか
  let kind = 'oni';
  let drawnAt = 0; // 絵を描いたフレームの時刻
  let shownAt = null; // その絵が画面に出たフレームの時刻（計測の起点）
  let sparkleAt = -1e9;
  // 斬った直後
  let lastMs = 0;
  let rankUp = null;
  let fastestUp = false;
  // 負け
  let reason = 'early';
  let bolt = [];
  // 終了画面
  let result = null;
  let confetti = [];
  let toastText = '';
  let toastUntil = 0;
  let lastTs = 0;

  const backBtn = RA.backButton();
  const retryBtn = new RA.Button({ x: 16, y: 178, w: 108, h: 24, label: 'もういちど', tone: 'primary' });
  const shareBtn = new RA.Button({ x: 132, y: 178, w: 108, h: 24, label: '結果を送る' });

  function setPhase(p, t) {
    phase = p;
    since = t;
  }

  function bestText(count, ms) {
    if (!count && ms == null) return '記録なし';
    return RA.kanjiNum(count) + '体・' + (ms != null ? ms + 'ms' : '－');
  }

  function enterTitle() {
    titleBest = bestText(RA.Store.getNumber(BEST_COUNT, 0), RA.Store.getNumber(BEST_MS, null));
    setPhase('title', null);
  }

  function startRun(t) {
    kills = 0;
    saved = 0;
    times = [];
    result = null;
    confetti = [];
    bestCountAtStart = RA.Store.getNumber(BEST_COUNT, 0);
    bestMsAtStart = RA.Store.getNumber(BEST_MS, null);
    snd.start();
    setPhase('ready', t);
  }

  function enterWait(ts, from) {
    waitFrom = from;
    waitFor = waitOf(kills);
    setPhase('wait', ts);
  }

  function appear(ts) {
    kind = Math.random() < nekoRateOf(kills) ? 'neko' : 'oni';
    drawnAt = ts;
    shownAt = null;
    setPhase('appear', ts);
    snd.appear();
  }

  function success(rt, t) {
    lastMs = Math.round(rt);
    const runBest = times.length ? Math.min(...times) : Infinity;
    // 自己ベストがあるときだけ、それを破った一太刀に「自己最速」を出す
    fastestUp = bestMsAtStart != null && lastMs < Math.min(bestMsAtStart, runBest);
    times.push(lastMs);
    kills++;
    const hit = RANKS.find(([n]) => n === kills);
    rankUp = hit ? hit[1] : null;
    setPhase('show', t);
    snd.slash();
    if (rankUp) snd.rank();
  }

  function lose(why, t) {
    reason = why;
    setPhase('lose', t);
    if (why === 'early') {
      snd.swish();
      snd.buzz();
    } else if (why === 'slow') {
      snd.hit();
    } else {
      snd.swish();
      snd.nya(0.04);
      snd.thunder(0.3);
      bolt = makeBolt();
    }
  }

  // 一太刀。t は入力イベントの時刻
  function slash(t) {
    if (phase === 'wait') {
      if (t >= since) return lose('early', t);
      // この待ちが始まる前の入力（イベントの届くのがフレームより遅れた分）
      if (waitFrom === 'neko') return lose(shownAt != null && t >= shownAt ? 'tenbatsu' : 'early', t);
      return; // 「いざ」や反応表示のあいだの入力は数えない
    }
    if (phase === 'appear') {
      if (shownAt == null || t < shownAt) return lose('early', t); // まだ画面に出ていない
      const rt = t - shownAt;
      if (kind === 'oni') return rt <= graceOf(kills) ? success(rt, t) : lose('slow', t);
      return lose(rt < NEKO_STAY ? 'tenbatsu' : 'early', t);
    }
  }

  function showResult(ts) {
    const fastest = times.length ? Math.min(...times) : null;
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    const prevCount = RA.Store.getNumber(BEST_COUNT, 0);
    const prevMs = RA.Store.getNumber(BEST_MS, null);
    const newCount = kills > prevCount;
    const newMs = fastest != null && (prevMs == null || fastest < prevMs);
    if (newCount) RA.Store.set(BEST_COUNT, kills);
    if (newMs) RA.Store.set(BEST_MS, fastest);
    result = {
      kills,
      saved,
      fastest,
      avg,
      reason,
      rank: rankOf(kills),
      newCount,
      newMs,
      bestCount: newCount ? kills : prevCount,
      bestMs: newMs ? fastest : prevMs,
    };
    toastUntil = 0;
    setPhase('result', ts);
    if (newCount || newMs) {
      spawnConfetti();
      snd.record();
    } else {
      snd.over();
    }
  }

  function update(ts) {
    if (since == null) since = ts;
    const el = ts - since;
    if (phase === 'ready') {
      if (el >= READY_TIME) enterWait(ts, 'ready');
    } else if (phase === 'wait') {
      if (el >= waitFor) appear(ts);
    } else if (phase === 'appear') {
      if (shownAt == null) {
        // 前のフレームで描いた絵は、このフレームの時刻に画面へ出ている
        if (ts > drawnAt) shownAt = ts;
      } else if (kind === 'oni' && ts - shownAt > graceOf(kills)) {
        lose('slow', ts);
      } else if (kind === 'neko' && ts - shownAt >= NEKO_STAY) {
        saved++;
        sparkleAt = ts;
        snd.saved();
        enterWait(ts, 'neko');
      }
    } else if (phase === 'show') {
      if (el >= SHOW_TIME) enterWait(ts, 'show');
    } else if (phase === 'lose') {
      if (el >= LOSE_TIME[reason]) showResult(ts);
    }
  }

  // ===== 結果の共有 =====
  function shareText() {
    const r = result;
    const rank = r.rank ? '【' + r.rank + '】' : '';
    const ms = r.fastest != null ? r.fastest + 'ms' : '記録なし';
    return '居合 ' + RA.kanjiNum(r.kills) + '体斬り' + rank + '／最速 ' + ms + '／救った猫天使 ' + r.saved + '匹\n' + RA.topUrl();
  }

  function toast(text) {
    toastText = text;
    toastUntil = performance.now() + 1800;
  }

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  function copy(text) {
    const done = () => toast('コピーしました');
    const fallback = () => toast(legacyCopy(text) ? 'コピーしました' : 'コピーできませんでした');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function share(ev) {
    const text = shareText();
    RA.withActivation(ev, () => {
      if (navigator.share) {
        navigator.share({ text }).catch((err) => {
          if (!err || err.name !== 'AbortError') copy(text);
        });
      } else {
        copy(text);
      }
    });
  }

  // ===== 入力 =====
  function onPress(ev) {
    const t = ev.t;
    if (phase === 'title') {
      if (backBtn.hit(ev.x, ev.y)) return RA.goTop();
      return startRun(t);
    }
    if (phase === 'result') {
      if (t - since < RESULT_LOCK) return;
      if (backBtn.hit(ev.x, ev.y)) return RA.goTop();
      if (retryBtn.hit(ev.x, ev.y)) {
        retryBtn.flash(t);
        return startRun(t);
      }
      if (shareBtn.hit(ev.x, ev.y)) {
        shareBtn.flash(t);
        return share(ev);
      }
      return;
    }
    if (phase === 'error') return location.reload();
    slash(t);
  }

  function onKey(ev) {
    const c = ev.code;
    const back = c === 'Escape' || c === 'Backspace';
    if (phase === 'title') {
      if (back) RA.goTop();
      else if (c === 'Space' || c === 'Enter') startRun(ev.t);
    } else if (phase === 'result') {
      if (ev.t - since < RESULT_LOCK) return;
      if (back) RA.goTop();
      else if (c === 'Space' || c === 'Enter' || c === 'KeyR') {
        retryBtn.flash(ev.t);
        startRun(ev.t);
      } else if (c === 'KeyS') {
        shareBtn.flash(ev.t);
        share(ev);
      }
    } else if (c === 'Space') {
      slash(ev.t);
    }
  }

  RA.bindInput(canvas, { press: onPress, key: onKey });

  // 別のタブに移ったら、その勝負は仕切り直し（戻った瞬間に負けにならないように）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (phase === 'ready' || phase === 'wait' || phase === 'appear')) setPhase('ready', null);
  });

  // ===== 描画 =====
  function drawIn(im, x, y, size, dx, dy) {
    const L = place(im, x, y, size);
    ctx.drawImage(im, L.x + (dx || 0), L.y + (dy || 0), L.w, L.h);
  }

  // 「/」の向きに斬った鬼。左上の切れ端が切り口に沿って左下へずり落ちる
  function drawCut(im, off) {
    const L = place(im, BOX.x, BOX.y, BOX.size);
    for (let r = 0; r < im.height; r++) {
      const cut = Math.max(0, Math.min(im.width, Math.ceil(im.width * (1 - (r + 0.5) / im.height) - 0.5)));
      const y = Math.round(L.y + r * L.s);
      const h = Math.round(L.y + (r + 1) * L.s) - y;
      if (cut > 0) ctx.drawImage(im, 0, r, cut, 1, L.x - off, y + off, Math.round(cut * L.s), h);
      if (cut < im.width) {
        const x = L.x + Math.round(cut * L.s);
        ctx.drawImage(im, cut, r, im.width - cut, 1, x, y, L.x + L.w - x, h);
      }
    }
  }

  // 斬撃の軌跡（切り口の直線 x + y = 一定 に沿って左下から右上へ）
  function drawStreak(progress) {
    const L = place(img.oni, BOX.x, BOX.y, BOX.size);
    const x0 = L.x - 20;
    const y0 = L.y + L.h + 20;
    const n = Math.round((L.w + 40) * Math.min(1, progress));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = P.cream;
      ctx.fillRect(x0 + i, y0 - i - 2, 1, 5);
      ctx.fillStyle = P.white;
      ctx.fillRect(x0 + i, y0 - i - 1, 1, 3);
    }
  }

  function makeBolt() {
    const pts = [];
    let x = 150 + Math.floor(Math.random() * 30);
    for (let y = -4; y < H + 20; y += 14 + Math.floor(Math.random() * 14)) {
      pts.push([x, y]);
      x += Math.floor(Math.random() * 25) - 12 - Math.round((x - 128) * 0.2);
    }
    return pts;
  }

  function pixelLine(x0, y0, x1, y1, w, color) {
    ctx.fillStyle = P[color];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      ctx.fillRect(x - (w >> 1), y, w, 1);
    }
  }

  function drawBolt() {
    for (let i = 1; i < bolt.length; i++) pixelLine(bolt[i - 1][0], bolt[i - 1][1], bolt[i][0], bolt[i][1], 5, 'gold');
    for (let i = 1; i < bolt.length; i++) pixelLine(bolt[i - 1][0], bolt[i - 1][1], bolt[i][0], bolt[i][1], 1, 'white');
  }

  function star(x, y, color) {
    ctx.fillStyle = P[color];
    ctx.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
    ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
  }

  // 猫天使が去ったあとの小さなきらめき
  function drawSparkle(el) {
    if (el < 0 || el > 320) return;
    const r = 12 + el * 0.12;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      star(128 + Math.cos(a) * r, BOX.y + 40 + Math.sin(a) * r - el * 0.06, el < 160 ? 'white' : 'gold');
    }
  }

  function drawHud() {
    const over = bestCountAtStart > 0 && kills > bestCountAtStart;
    RA.text(ctx, RA.kanjiNum(kills) + '体斬り', 250, 6, { align: 'right', color: over ? 'gold' : 'cream', outline: 'ink' });
    const rank = rankOf(kills);
    if (rank) RA.text(ctx, '【' + rank + '】', 254, 24, { align: 'right', color: 'gold', outline: 'ink' });
  }

  function flashColor(el) {
    if (phase !== 'lose') return null;
    if (reason === 'slow' && (el < 60 || (el >= 120 && el < 180))) return 'red';
    if (reason === 'tenbatsu' && ((el >= 300 && el < 340) || (el >= 420 && el < 460))) return 'cream';
    return null;
  }

  function drawBattle(ts) {
    const el = ts - since;
    let ox = 0;
    let oy = 0;
    if (phase === 'lose' && reason !== 'tenbatsu' && el < 260) {
      ox = Math.floor(Math.random() * 5) - 2;
      oy = Math.floor(Math.random() * 5) - 2;
    }
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, ox, oy);
    const flash = flashColor(el);
    if (flash) {
      ctx.fillStyle = P[flash];
      ctx.fillRect(-4, -4, W + 8, H + 8);
    } else {
      ctx.drawImage(scene, 0, 0);
    }

    if (phase === 'ready') {
      if (el < 700) RA.text(ctx, 'いざ', 128, 100, { size: 32, color: 'cream', align: 'center', outline: 'ink' });
    } else if (phase === 'wait') {
      if (waitFrom === 'neko') drawSparkle(ts - sparkleAt);
    } else if (phase === 'appear') {
      drawIn(img[kind], BOX.x, BOX.y, BOX.size);
    } else if (phase === 'show') {
      if (el < 520 || (el < 680 && Math.floor(el / 50) % 2 === 0)) {
        drawCut(img.oni, Math.min(14, Math.floor(Math.max(0, el - 60) / 18)));
      }
      if (el < 160) drawStreak(el / 60);
      if (rankUp) RA.text(ctx, '称号【' + rankUp + '】', 128, 48, { color: 'gold', align: 'center', outline: 'ink' });
      RA.text(ctx, lastMs + 'ms', 128, 184, { size: 32, color: 'gold', align: 'center', outline: 'ink' });
      if (fastestUp) RA.text(ctx, '自己最速！', 128, 220, { color: 'pink', align: 'center', outline: 'ink' });
    } else if (phase === 'lose') {
      drawLose(el);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (phase !== 'lose') drawHud();
  }

  function drawLose(el) {
    if (reason === 'early') {
      if (el < 160) drawStreak(el / 60);
      if (el >= 160) RA.text(ctx, REASON.early, 128, 188, { size: 32, color: 'red', align: 'center', outline: 'ink' });
    } else if (reason === 'slow') {
      drawIn(img.oni, 64, 48, 128); // 間合いを詰められた
      if (el >= 300) RA.text(ctx, REASON.slow, 128, 182, { size: 48, color: 'red', align: 'center', outline: 'ink' });
    } else {
      const rise = el > 700 ? Math.floor((el - 700) / 12) : 0; // 猫天使は無傷で天へ帰る
      drawIn(img.neko, BOX.x, BOX.y, BOX.size, 0, -rise);
      if (el < 160) drawStreak(el / 60);
      if (el >= 300 && el < 800 && Math.floor(el / 40) % 2 === 0) drawBolt();
      if (el >= 800) RA.text(ctx, REASON.tenbatsu, 128, 182, { size: 48, color: 'gold', align: 'center', outline: 'ink' });
    }
  }

  function drawTitle(ts) {
    ctx.drawImage(scene, 0, 0);
    backBtn.draw(ctx, ts);
    RA.text(ctx, DIV_NAME, 250, 6, { align: 'right', color: 'silver', outline: 'ink' });
    RA.text(ctx, '居合', 130, 30, { size: 48, color: 'maroon', align: 'center' });
    RA.text(ctx, '居合', 128, 28, { size: 48, color: 'cream', align: 'center', outline: 'ink', shadow: 'red' });
    RA.text(ctx, '鬼斬り勝ち抜き戦', 128, 82, { color: 'gold', align: 'center', outline: 'ink' });
    drawIn(img.oni, 56, 102, 64);
    drawIn(img.neko, 136, 102, 64);
    RA.text(ctx, '斬れ', 88, 168, { color: 'red', align: 'center' });
    RA.text(ctx, '斬るな', 168, 168, { color: 'cyan', align: 'center' });
    RA.text(ctx, 'ベスト ' + titleBest, 128, 190, { color: 'silver', align: 'center' });
    if (Math.floor(ts / 500) % 2 === 0) {
      RA.text(ctx, DIV === 'sp' ? 'タップではじめる' : 'クリック／スペースで開始', 128, 214, { color: 'cream', align: 'center' });
    }
  }

  function spawnConfetti() {
    const colors = ['red', 'orange', 'gold', 'green', 'cyan', 'pink', 'white'];
    confetti = [];
    for (let i = 0; i < 90; i++) {
      confetti.push({
        x: Math.random() * W,
        y: -Math.random() * H,
        vy: 35 + Math.random() * 55,
        sway: 2 + Math.random() * 5,
        ph: Math.random() * 6.28,
        color: colors[i % colors.length],
      });
    }
  }

  function drawConfetti(ts, el) {
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    for (const p of confetti) {
      p.y += p.vy * dt;
      if (p.y > H && el < 3500) p.y -= H + 8; // しばらくは降らせ続ける
      if (p.y > H) continue;
      const x = Math.round(p.x + Math.sin(ts / 300 + p.ph) * p.sway);
      const flip = Math.floor(ts / 120 + p.ph) % 2 === 0;
      ctx.fillStyle = P[p.color];
      ctx.fillRect(x, Math.round(p.y), flip ? 2 : 1, 2);
    }
  }

  function row(y, label, value, opts) {
    opts = opts || {};
    RA.text(ctx, label, 24, y, { color: 'silver' });
    RA.text(ctx, value, 208, y, { color: opts.color || 'cream', align: 'right' });
    if (opts.isNew) RA.text(ctx, 'NEW!', 214, y + 5, { font: 'en', color: 'gold' });
  }

  function drawResult(ts) {
    const el = ts - since;
    const r = result;
    ctx.fillStyle = P.night;
    ctx.fillRect(0, 0, W, H);
    drawConfetti(ts, el);
    backBtn.draw(ctx, ts);
    RA.text(ctx, DIV_NAME, 250, 6, { align: 'right', color: 'silver', outline: 'ink' });
    RA.text(ctx, REASON[r.reason], 128, 26, { size: 32, color: r.reason === 'tenbatsu' ? 'gold' : 'red', align: 'center', outline: 'ink' });
    ctx.fillStyle = P.dusk;
    ctx.fillRect(16, 62, W - 32, 1);
    const blink = Math.floor(ts / 250) % 2 === 0;
    row(66, '撃破', RA.kanjiNum(r.kills) + '体斬り', { isNew: r.newCount && blink });
    row(84, '称号', r.rank || 'なし', { color: r.rank ? 'gold' : 'mist' });
    row(102, '最速', r.fastest != null ? r.fastest + 'ms' : '－', { isNew: r.newMs && blink });
    row(120, '平均', r.avg != null ? r.avg + 'ms' : '－');
    row(138, '救った猫天使', r.saved + '匹');
    row(156, 'ベスト', bestText(r.bestCount, r.bestMs), { color: 'silver' });
    retryBtn.draw(ctx, ts);
    shareBtn.draw(ctx, ts);
    if (performance.now() < toastUntil) {
      const w = RA.textWidth(toastText) + 16;
      const x = Math.round((W - w) / 2);
      ctx.fillStyle = P.cream;
      ctx.fillRect(x, 205, w, 20);
      ctx.fillStyle = P.ink;
      ctx.fillRect(x + 1, 206, w - 2, 18);
      RA.text(ctx, toastText, 128, 207, { color: 'cream', align: 'center' });
    } else if (r.newCount || r.newMs) {
      const hues = ['gold', 'pink', 'cyan', 'orange', 'green', 'white'];
      RA.text(ctx, '自己ベスト更新！', 128, 207, { color: hues[Math.floor(ts / 90) % hues.length], align: 'center', outline: 'ink' });
    }
    if (DIV === 'pc') RA.text(ctx, 'SPACE:RETRY  S:SHARE  ESC:TOP', 128, 230, { font: 'en', color: 'mist', align: 'center' });
  }

  function drawLoading(ts) {
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, 0, W, H);
    const dots = '...'.slice(0, Math.floor(ts / 300) % 4);
    RA.text(ctx, 'よみこみちゅう' + dots, 72, 112, { color: 'silver' });
  }

  function drawError() {
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, 0, W, H);
    RA.text(ctx, '絵を読み込めませんでした', 128, 96, { color: 'red', align: 'center' });
    RA.text(ctx, errorText, 128, 120, { font: 'en', color: 'silver', align: 'center' });
    RA.text(ctx, 'タップで読み込み直す', 128, 140, { color: 'cream', align: 'center' });
  }

  function draw(ts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (phase === 'loading') drawLoading(ts);
    else if (phase === 'error') drawError();
    else if (phase === 'title') drawTitle(ts);
    else if (phase === 'result') drawResult(ts);
    else drawBattle(ts);
  }

  RA.loop((ts) => {
    update(ts);
    draw(ts);
    lastTs = ts;
  });

  // ===== 読み込み（画像は開始前に読み終えておく） =====
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const decoded = im.decode ? im.decode().catch(() => {}) : Promise.resolve();
        decoded.then(() => resolve(im));
      };
      im.onerror = () => reject(new Error(src));
      im.src = src;
    });
  }

  const CHARS =
    '居合鬼斬り勝ち抜き戦れるなベスト記録体・ms－タップではじめるクリック／スペースで開始いざ称号【】' +
    '見習十人剣豪百斬〇一二三四五六七八九千万自己最速更新！早まったな遅い天罰撃破平均救った猫使匹もういちど結果を送るどPCの部スマホ' +
    'よみこちゅう絵を読み込めませんでしたタップで直すコピーしました';

  Promise.all([loadImage('assets/oni.png'), loadImage('assets/neko.png'), RA.textReady(CHARS)])
    .then(([oni, neko]) => {
      img.oni = oni;
      img.neko = neko;
      enterTitle();
    })
    .catch((err) => {
      errorText = err.message;
      setPhase('error', null);
    });
})();
