/*
 * 巻き巻きういろう — ういろう屋「巻き巻きういろー」の厨房で、注文どおりのういろうを巻く。
 *
 * 客は3人。1人ごとに4つの工程がある。
 *   注文 … 客が生地の色と順番を指定する
 *   流す … 色のボタンを押しているあいだ生地が流れる。目安の線で離すほど厚みがそろう
 *   巻く … 押しているあいだ巻く速さが上がり、離すと下がる。速すぎると裂け、遅すぎると冷えて固まる
 *   切る … 行き来する包丁を、真ん中の印で止めて切る。断面の渦が出来ばえを語る
 * 1人100点満点（流す40・巻く40・切る20）。3人の合計が得点。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);

  // ===== 決まりごと =====
  const CUSTOMERS = 3; // 1回の営業で来る客の数
  const LAYER_TARGET = 10; // 生地1層の目安の厚み（ドット）
  const LAYER_MAX = 22; // これ以上は流れない
  const POUR_RATE = 15; // 流れる速さ（ドット/秒）
  const ROLL_ACCEL = 95; // 押しているあいだの加速（/秒）
  const ROLL_DECEL = 60; // 離しているあいだの減速（/秒）
  const ROLL_COLD = 30; // これより遅いと冷える
  const ROLL_TEAR = 76; // これより速いと裂けそうになる
  const TEAR_TIME = 0.45; // 速すぎる状態がこれだけ続くと裂ける（秒）
  const ROLL_GRACE = 1.2; // 巻きはじめの、冷えを数えない時間（秒）
  const ROLL_PROGRESS = 0.36; // 速さ1あたり、1秒に進む巻き（%）
  const KNIFE_SPEED = [70, 95, 125]; // 客ごとの包丁の速さ（ドット/秒）

  // ===== 生地 =====
  // 味ごとのクセ：rate＝流れる速さの倍率、cold／tear＝巻くときの冷え・裂けの境目のずれ、
  // heavy＝巻きの加速の倍率、speck＝断面と生地に散る粒の色（衣・泡）
  const DOUGH = [
    { id: 'shiro', name: '白', color: 'cream', dark: 'silver', label: 'ink', rate: 1, hint: '素直な生地' },
    { id: 'sakura', name: '桜', color: 'pink', dark: 'maroon', label: 'white', rate: 1, tear: -10, hint: '裂けやすいよ' },
    { id: 'matcha', name: '抹茶', color: 'green', dark: 'ink', label: 'white', rate: 1, cold: 8, hint: '冷めやすいよ' },
    { id: 'kuro', name: '黒糖', color: 'maroon', dark: 'ink', label: 'white', rate: 0.6, hint: 'どろっと重い' },
    { id: 'yuzu', name: '柚子', color: 'gold', dark: 'orange', label: 'ink', rate: 1.7, hint: 'さらさら速い' },
    { id: 'ramune', name: 'ラムネ', color: 'cyan', dark: 'blue', label: 'ink', rate: 1.25, speck: 'white', hint: 'しゅわしゅわ' },
    { id: 'misokatsu', name: '味噌カツ', color: 'brown', dark: 'ink', label: 'white', rate: 0.8, heavy: 0.75, speck: 'orange', hint: '衣入りで重いがね' },
  ];
  const D = Object.fromEntries(DOUGH.map((d, i) => [d.id, i]));

  // ===== 客と注文（左から順に流す） =====
  const GUESTS = [
    { who: '平成女児', hair: 'brown', ribbon: 'pink', say: 'ぜんぶパステルにして〜！', order: ['sakura', 'shiro', 'yuzu'] },
    { who: '平成女児', hair: 'ink', ribbon: 'cyan', say: '桜と白を交互にね！', order: ['sakura', 'shiro', 'sakura', 'shiro'] },
    { who: 'ご隠居', hair: 'silver', ribbon: null, say: '抹茶多めでたのむわ', order: ['matcha', 'matcha', 'shiro'] },
    { who: 'ご隠居', hair: 'white', ribbon: null, say: '黒糖と抹茶で渋くしてちょう', order: ['kuro', 'matcha', 'kuro'] },
    { who: 'OL', hair: 'brown', ribbon: 'gold', say: '柚子と白でさっぱりね', order: ['yuzu', 'shiro', 'yuzu'] },
    { who: 'OL', hair: 'ink', ribbon: 'red', say: '五色ぜんぶ入れてちょ', order: ['shiro', 'sakura', 'matcha', 'kuro', 'yuzu'] },
    { who: '高校生', hair: 'orange', ribbon: 'green', say: '抹茶と桜でかわいく！', order: ['matcha', 'sakura', 'matcha'] },
    { who: '大工さん', hair: 'ink', ribbon: null, say: '味噌カツ味、どえりゃあ頼むわ', order: ['misokatsu', 'shiro', 'misokatsu'] },
    { who: '大工さん', hair: 'brown', ribbon: null, say: '黒糖と味噌カツで腹にたまるやつ', order: ['kuro', 'misokatsu', 'kuro', 'misokatsu'] },
    { who: '平成女児', hair: 'orange', ribbon: 'pink', say: 'ラムネと桜でしゅわっと！', order: ['ramune', 'sakura', 'ramune'] },
    { who: '高校生', hair: 'ink', ribbon: 'cyan', say: '味噌カツとラムネ…まじで？', order: ['misokatsu', 'ramune', 'misokatsu'] },
  ];

  const REACTION = [
    [90, 'でら上手いがね！また来るわ'],
    [70, 'ええがね〜、ありがとね'],
    [50, 'まあ食べれりゃええわ'],
    [0, 'なんだこりゃ…えらいわ'],
  ];
  const RANKS = [
    [270, '大須の名人'],
    [220, '巻き職人'],
    [160, '一人前'],
    [100, '見習い'],
    [0, '修業中'],
  ];

  // ===== 部ごとの記録 =====
  const DIV = RA.isMobile() ? 'sp' : 'pc';
  const DIV_NAME = DIV === 'sp' ? 'スマホの部' : 'PCの部';
  const BEST = ['uiro', DIV, 'best-score'];

  // ===== 状態 =====
  let phase = 'loading'; // loading, title, order, pour, roll, cut, reveal, result
  let since = 0; // その場面に入った時刻（ms）
  let lastTs = 0;
  let guests = []; // この営業で来る客
  let gi = 0; // いま何人目か（0始まり）
  let round = null; // いまの客の作業記録
  let total = 0;
  let scores = [];
  let result = null;
  const img = {};

  // 押しっぱなしの入力（指ごと・キーごと）
  const holdPointers = new Map(); // pointerId → 対象（'dough:i' | 'roll'）
  const holdKeys = new Map(); // code → 対象

  const backBtn = RA.backButton();
  const retryBtn = new RA.Button({ x: 48, y: 196, w: 76, h: 22, label: 'もういちど', tone: 'primary' });
  const topBtn = new RA.Button({ x: 132, y: 196, w: 76, h: 22, label: 'もどる' });

  // 色のボタン（下の段に5つ）
  // 上の段に4つ、下の段に3つ
  const doughBtns = DOUGH.map((d, i) =>
    i < 4 ? { x: 2 + i * 63, y: 196, w: 61, h: 21, i } : { x: 2 + (i - 4) * 84, y: 218, w: 82, h: 21, i }
  );

  function setPhase(p, ts) {
    phase = p;
    since = ts == null ? performance.now() : ts;
  }

  // ===== 効果音 =====
  const A = RA.Audio;
  const snd = {
    bell() {
      A.tone({ f: 1568, dur: 0.12, type: 'triangle', vol: 0.18 });
      A.tone({ f: 2093, dur: 0.4, type: 'triangle', vol: 0.16, at: 0.1 });
    },
    pourStart() {
      A.noise({ dur: 0.12, vol: 0.12, filter: 'lowpass', f: 900 });
    },
    pourTick() {
      A.noise({ dur: 0.06, vol: 0.06, filter: 'bandpass', f: 600 + Math.random() * 300, q: 3 });
    },
    good() {
      A.melody([[1047, 0.06], [1319, 0.1]], { vol: 0.12 });
    },
    meh() {
      A.tone({ f: 523, dur: 0.12, vol: 0.1 });
    },
    roll(speed) {
      A.tone({ f: 90 + speed * 2, dur: 0.05, type: 'triangle', vol: 0.08 });
    },
    tear() {
      A.noise({ dur: 0.3, vol: 0.5, filter: 'highpass', f: 1500 });
      A.tone({ f: 330, f2: 110, dur: 0.25, type: 'square', vol: 0.12 });
    },
    cold() {
      A.tone({ f: 220, f2: 180, dur: 0.2, type: 'sine', vol: 0.12 });
    },
    chop() {
      A.noise({ dur: 0.08, vol: 0.5, filter: 'lowpass', f: 1200 });
      A.tone({ f: 200, f2: 70, dur: 0.12, type: 'square', vol: 0.18 });
    },
    reveal(score) {
      if (score >= 90) A.melody([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.3]], { vol: 0.13 });
      else if (score >= 70) A.melody([[784, 0.08], [988, 0.08], [1175, 0.22]], { vol: 0.12 });
      else if (score >= 50) A.melody([[659, 0.1], [784, 0.2]], { vol: 0.1 });
      else A.melody([[392, 0.15], [330, 0.15], [262, 0.3]], { vol: 0.1, type: 'triangle' });
    },
    fanfare() {
      A.melody([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.2], [0, 0.05], [784, 0.1], [1047, 0.4]], { vol: 0.13 });
    },
  };

  // ===== 1営業の始まり =====
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame(ts) {
    guests = shuffle(GUESTS.slice()).slice(0, CUSTOMERS);
    // 最後の客ほど層が多い注文になるよう並べる
    guests.sort((a, b) => a.order.length - b.order.length);
    gi = 0;
    total = 0;
    scores = [];
    result = null;
    RA.sfx.coin();
    startGuest(ts);
  }

  function startGuest(ts) {
    const g = guests[gi];
    const used = g.order.map((id) => DOUGH[D[id]]);
    round = {
      guest: g,
      cold: ROLL_COLD + Math.max(0, ...used.map((d) => d.cold || 0)),
      tear: ROLL_TEAR + Math.min(0, ...used.map((d) => d.tear || 0)),
      heavy: Math.min(1, ...used.map((d) => d.heavy || 1)),
      layers: [], // { d: 生地番号, h: 厚み }
      pouring: -1, // 流している生地（-1 は流していない）
      pourLevel: 0,
      lastTick: 0,
      pourScore: 0,
      // 巻く
      speed: 0,
      progress: 0,
      rollTime: 0,
      goodTime: 0,
      countTime: 0,
      overTime: 0,
      coldTime: 0,
      tears: 0,
      tearFlash: 0,
      lastRollSnd: 0,
      rollScore: 0,
      // 切る
      knifeX: 0,
      knifeDir: 1,
      cutAt: 0,
      cutX: null,
      cutScore: 0,
      score: 0,
      swirl: null,
    };
    snd.bell();
    setPhase('order', ts);
  }

  // ===== 流す =====
  function startPour(i, ts) {
    const r = round;
    if (phase !== 'pour' || r.pouring >= 0 || r.layers.length >= r.guest.order.length) return;
    r.pouring = i;
    r.pourLevel = 0;
    r.lastTick = ts;
    snd.pourStart();
  }

  function stopPour(ts) {
    const r = round;
    if (phase !== 'pour' || r.pouring < 0) return;
    const h = Math.max(1, Math.round(r.pourLevel));
    r.layers.push({ d: r.pouring, h });
    r.pouring = -1;
    const err = Math.abs(h - LAYER_TARGET) / LAYER_TARGET;
    const want = D[r.guest.order[r.layers.length - 1]];
    if (err <= 0.2 && r.layers[r.layers.length - 1].d === want) snd.good();
    else snd.meh();
    if (r.layers.length >= r.guest.order.length) {
      r.pourScore = scorePour(r);
      setPhase('roll', ts + 500); // 少し見せてから巻きへ
    }
  }

  // 1層ごとに、厚みのそろい方と色の正しさで点をつける。40点満点
  function scorePour(r) {
    let sum = 0;
    r.layers.forEach((l, k) => {
      const err = Math.abs(l.h - LAYER_TARGET) / LAYER_TARGET;
      let s = Math.max(0, 1 - err * 1.6);
      if (l.d !== D[r.guest.order[k]]) s *= 0.25;
      sum += s;
    });
    return Math.round((sum / r.layers.length) * 40);
  }

  // ===== 巻く =====
  function rolling() {
    for (const v of holdPointers.values()) if (v === 'roll') return true;
    for (const v of holdKeys.values()) if (v === 'roll') return true;
    return false;
  }

  function updateRoll(ts, dt) {
    const r = round;
    if (ts < since) return; // 流し終わりの余韻
    const el = (ts - since) / 1000;
    if (rolling()) r.speed = Math.min(100, r.speed + ROLL_ACCEL * r.heavy * dt);
    else r.speed = Math.max(0, r.speed - ROLL_DECEL * dt);
    r.progress = Math.min(100, r.progress + r.speed * ROLL_PROGRESS * dt);
    r.rollTime += dt;
    if (el > ROLL_GRACE) {
      r.countTime += dt;
      if (r.speed < r.cold) {
        const before = r.coldTime;
        r.coldTime += dt;
        if (Math.floor(before / 0.7) !== Math.floor(r.coldTime / 0.7)) snd.cold();
      } else if (r.speed <= r.tear) r.goodTime += dt;
    }
    if (r.speed > r.tear) {
      r.overTime += dt;
      if (r.overTime >= TEAR_TIME) {
        r.tears++;
        r.overTime = 0;
        r.speed = 35; // 裂けて手が止まる
        r.tearFlash = ts + 600;
        snd.tear();
      }
    } else r.overTime = Math.max(0, r.overTime - dt * 2);
    if (r.speed > 5 && ts - r.lastRollSnd > 220 - r.speed) {
      snd.roll(r.speed);
      r.lastRollSnd = ts;
    }
    if (r.progress >= 100) {
      const frac = r.countTime > 0 ? r.goodTime / r.countTime : 1;
      let s = frac * 40 - r.tears * 7 - Math.max(0, r.coldTime - 0.6) * 6;
      r.rollScore = Math.max(0, Math.min(40, Math.round(s)));
      r.knifeX = 40;
      r.knifeDir = 1;
      holdPointers.clear();
      holdKeys.clear();
      setPhase('cut', ts + 400);
    }
  }

  // ===== 切る =====
  const LOG = { x: 40, y: 118, w: 176, h: 36 };
  const CUT_MID = LOG.x + LOG.w / 2;

  function updateCut(ts, dt) {
    const r = round;
    if (ts < since || r.cutX != null) return;
    const v = KNIFE_SPEED[Math.min(gi, KNIFE_SPEED.length - 1)];
    r.knifeX += r.knifeDir * v * dt;
    if (r.knifeX > LOG.x + LOG.w - 4) {
      r.knifeX = LOG.x + LOG.w - 4;
      r.knifeDir = -1;
    } else if (r.knifeX < LOG.x + 4) {
      r.knifeX = LOG.x + 4;
      r.knifeDir = 1;
    }
  }

  function cut(ts) {
    const r = round;
    if (phase !== 'cut' || ts < since || r.cutX != null) return;
    r.cutX = Math.round(r.knifeX);
    r.cutAt = ts;
    const dx = Math.abs(r.cutX - CUT_MID);
    r.cutScore = Math.max(0, Math.round(20 - dx * 0.5));
    snd.chop();
    r.score = r.pourScore + r.rollScore + r.cutScore;
    r.swirl = makeSwirl(r, dx);
    setPhase('reveal', ts + 450);
    setTimeout(() => snd.reveal(r.score), 450);
  }

  function nextGuest(ts) {
    const r = round;
    if (ts - since < 900) return;
    scores.push(r.score);
    total += r.score;
    gi++;
    if (gi < CUSTOMERS) startGuest(ts);
    else finish(ts);
  }

  function finish(ts) {
    const best = RA.Store.getNumber(BEST, 0);
    const isNew = total > best;
    if (isNew) RA.Store.set(BEST, total);
    const rank = RANKS.find(([n]) => total >= n)[1];
    result = { total, rank, best: Math.max(best, total), isNew, scores: scores.slice() };
    if (isNew) setTimeout(() => snd.fanfare(), 200);
    setPhase('result', ts);
  }

  // ===== 断面の渦を作る =====
  // 層の厚みどおりに巻いた渦を、1ドットずつ塗る。巻きの乱れは揺らぎ、裂けは欠け、冷えは周りのひびになる
  function makeSwirl(r, cutErr) {
    const R = 30;
    const size = R * 2 + 2;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const im = g.createImageData(size, size);
    const layers = r.layers;
    const totalH = layers.reduce((s, l) => s + l.h, 0);
    const turns = 3;
    const pitch = (R - 3) / turns; // 1巻きあたりの厚み
    const cum = [];
    let acc = 0;
    layers.forEach((l) => {
      acc += l.h / totalH;
      cum.push(acc);
    });
    const rollQ = r.rollScore / 40; // 1で整った巻き
    const wobble = (1 - rollQ) * 3.2;
    const seed = Math.random() * 10;
    const tearAngles = [];
    for (let k = 0; k < r.tears; k++) tearAngles.push(Math.random() * Math.PI * 2);
    const squash = 1 + Math.min(0.35, cutErr / 120); // 切り口が斜めだと楕円にずれる
    const rgb = {};
    const put = (x, y, name) => {
      const rgbv = rgb[name] || (rgb[name] = RA.rgb(name));
      const i = (y * size + x) * 4;
      im.data[i] = rgbv[0];
      im.data[i + 1] = rgbv[1];
      im.data[i + 2] = rgbv[2];
      im.data[i + 3] = 255;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - R - 0.5) * squash;
        const dy = y - R - 0.5;
        const rr = Math.hypot(dx, dy);
        if (rr > R) continue;
        if (rr > R - 1.2) {
          put(x, y, 'ink');
          continue;
        }
        let th = Math.atan2(dy, dx);
        if (th < 0) th += Math.PI * 2;
        const s = rr - (pitch * th) / (Math.PI * 2) + wobble * Math.sin(th * 4 + seed) + wobble * 0.5 * Math.sin(th * 9 + seed * 2);
        let u = (((s % pitch) + pitch) % pitch) / pitch;
        let li = cum.findIndex((v) => u < v);
        if (li < 0) li = layers.length - 1;
        const dl = DOUGH[layers[li].d];
        let col = dl.color;
        if (dl.speck && ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 6 === 0) col = dl.speck;
        if (rr < 2.2) col = DOUGH[layers[0].d].color;
        // 裂け目
        for (const ta of tearAngles) {
          let d = Math.abs(th - ta);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < 0.14 && rr > R * 0.35) col = 'ink';
        }
        // 冷えて固まったひび
        if (r.coldTime > 1.5 && rr > R - 5 && (x * 7 + y * 3) % 5 === 0) col = 'silver';
        put(x, y, col);
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  // ===== 入力 =====
  function inBox(b, x, y) {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  }

  function onPress(ev) {
    const ts = ev.t;
    const pointer = ev.kind === 'pointer';
    const x = ev.x;
    const y = ev.y;
    if (phase === 'error') {
      location.reload();
      return;
    }
    if (pointer && phase !== 'loading' && backBtn.hit(x, y)) {
      backBtn.flash(performance.now());
      setTimeout(RA.goTop, 120);
      return;
    }
    const code = ev.code;
    if (code === 'Escape') {
      RA.goTop();
      return;
    }
    if (phase === 'title') {
      if (pointer || code === 'Space' || code === 'Enter') startGame(performance.now());
      return;
    }
    if (phase === 'order') {
      if (performance.now() - since < 500) return;
      if (pointer || code === 'Space' || code === 'Enter') {
        RA.sfx.blip();
        setPhase('pour');
      }
      return;
    }
    if (phase === 'pour') {
      if (pointer) {
        const b = doughBtns.find((bb) => inBox(bb, x, y));
        if (b) {
          holdPointers.set(ev.pointerId, 'dough:' + b.i);
          startPour(b.i, performance.now());
        }
      } else {
        const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(code);
        if (n >= 0) {
          holdKeys.set(code, 'dough:' + n);
          startPour(n, performance.now());
        }
      }
      return;
    }
    if (phase === 'roll') {
      if (pointer ? y > 28 : code === 'Space' || code === 'Enter') {
        if (pointer) holdPointers.set(ev.pointerId, 'roll');
        else holdKeys.set(code, 'roll');
      }
      return;
    }
    if (phase === 'cut') {
      if (pointer || code === 'Space' || code === 'Enter') cut(performance.now());
      return;
    }
    if (phase === 'reveal') {
      if (pointer || code === 'Space' || code === 'Enter') nextGuest(performance.now());
      return;
    }
    if (phase === 'result') {
      if (performance.now() - since < 700) return;
      if (pointer) {
        if (retryBtn.hit(x, y)) {
          retryBtn.flash(performance.now());
          startGame(performance.now());
        } else if (topBtn.hit(x, y)) {
          topBtn.flash(performance.now());
          setTimeout(RA.goTop, 120);
        }
      } else if (code === 'Space' || code === 'Enter' || code === 'KeyR') startGame(performance.now());
    }
  }

  function release(target) {
    if (target && target.startsWith('dough:')) {
      const i = Number(target.slice(6));
      if (round && round.pouring === i) stopPour(performance.now());
    }
  }

  RA.bindInput(canvas, {
    press: onPress,
    key: (ev) => onPress(ev),
  });
  const up = (e) => {
    const t = holdPointers.get(e.pointerId);
    holdPointers.delete(e.pointerId);
    release(t);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('keyup', (e) => {
    const t = holdKeys.get(e.code);
    holdKeys.delete(e.code);
    release(t);
  });
  window.addEventListener('blur', () => {
    for (const t of holdPointers.values()) release(t);
    for (const t of holdKeys.values()) release(t);
    holdPointers.clear();
    holdKeys.clear();
  });

  // ===== 更新 =====
  function update(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    if (!round) return;
    if (phase === 'pour' && round.pouring >= 0) {
      round.pourLevel = Math.min(LAYER_MAX, round.pourLevel + POUR_RATE * DOUGH[round.pouring].rate * dt);
      if (ts - round.lastTick > 120) {
        snd.pourTick();
        round.lastTick = ts;
      }
      if (round.pourLevel >= LAYER_MAX) stopPour(ts);
    } else if (phase === 'roll') updateRoll(ts, dt);
    else if (phase === 'cut') updateCut(ts, dt);
  }

  // ===== 描画の小道具 =====
  function rect(x, y, w, h, color) {
    ctx.fillStyle = P[color];
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function frame(x, y, w, h, fill, edge) {
    rect(x + 1, y, w - 2, h, edge || 'ink');
    rect(x, y + 1, w, h - 2, edge || 'ink');
    rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  // 厨房の背景：のれん、壁、作業台
  function drawKitchen(ts) {
    rect(0, 0, W, H, 'night');
    // 壁の格子
    rect(0, 28, W, 120, 'dusk');
    for (let x = 0; x < W; x += 32) rect(x, 28, 1, 120, 'night');
    rect(0, 60, W, 1, 'night');
    // のれん
    for (let i = 0; i < 4; i++) {
      const x = 72 + i * 32;
      rect(x, 0, 30, 26, 'red');
      rect(x, 24, 30, 2, 'maroon');
    }
    RA.text(ctx, '巻き巻きういろー', 136, 4, { color: 'cream', align: 'center', outline: 'maroon' });
    // 作業台
    rect(0, 148, W, 46, 'brown');
    rect(0, 148, W, 2, 'orange');
    for (let x = 8; x < W; x += 40) rect(x, 156, 20, 1, 'maroon');
    rect(0, 194, W, H - 194, 'ink');
  }

  // 客の顔（小さなドット絵）
  function drawGuest(g, x, y, ts) {
    const bob = Math.floor(ts / 400) % 2;
    y += bob;
    // 髪
    rect(x + 2, y, 16, 8, g.hair);
    rect(x, y + 4, 20, 10, g.hair);
    // 顔
    rect(x + 3, y + 6, 14, 12, 'cream');
    rect(x + 6, y + 10, 2, 2, 'ink');
    rect(x + 12, y + 10, 2, 2, 'ink');
    rect(x + 8, y + 15, 4, 1, 'red');
    if (g.who === 'ご隠居') {
      rect(x + 4, y + 9, 5, 1, 'silver');
      rect(x + 11, y + 9, 5, 1, 'silver');
    }
    if (g.ribbon) {
      rect(x + 14, y - 2, 4, 4, g.ribbon);
      rect(x + 18, y - 1, 3, 2, g.ribbon);
    }
    // 体
    rect(x + 2, y + 18, 16, 8, g.ribbon || 'blue');
  }

  // 注文の札（色の並び）
  function drawOrderChips(x, y, order, current) {
    order.forEach((id, k) => {
      const d = DOUGH[D[id]];
      const cx = x + k * 14;
      frame(cx, y, 12, 12, d.color);
      if (k === current) {
        const blink = Math.floor(performance.now() / 250) % 2 === 0;
        if (blink) rect(cx + 3, y + 13, 6, 2, 'gold');
      }
    });
  }

  function drawHud(ts) {
    backBtn.draw(ctx, ts);
    RA.text(ctx, (gi + 1) + '/' + CUSTOMERS + '人', 250, 6, { align: 'right', color: 'cream', outline: 'ink' });
  }

  function drawBubble(text, ts) {
    const g = round.guest;
    drawGuest(g, 12, 38, ts);
    const w = 210;
    frame(40, 36, w, 24, 'cream');
    rect(37, 46, 4, 4, 'cream');
    rect(36, 47, 1, 2, 'ink');
    RA.text(ctx, text, 46, 40, { color: 'ink' });
  }

  // 流し台（横から見た生地の層）
  const TRAY = { x: 48, w: 160, base: 146 };

  function drawTray(ts) {
    const r = round;
    rect(TRAY.x - 4, TRAY.base, TRAY.w + 8, 3, 'silver');
    rect(TRAY.x - 4, TRAY.base - 60, 2, 63, 'silver');
    rect(TRAY.x + TRAY.w + 2, TRAY.base - 60, 2, 63, 'silver');
    let top = TRAY.base;
    r.layers.forEach((l) => {
      const d = DOUGH[l.d];
      layerRect(TRAY.x, top - l.h, TRAY.w, l.h, d, ts);
      rect(TRAY.x, top - l.h, TRAY.w, 1, d.dark);
      top -= l.h;
    });
    if (r.pouring >= 0) {
      const d = DOUGH[r.pouring];
      const h = Math.round(r.pourLevel);
      // 流れ落ちる生地
      const sx = TRAY.x + TRAY.w / 2 - 3;
      const wig = Math.floor(ts / 80) % 2;
      rect(sx + wig, 70, 6, top - h - 70, d.color);
      layerRect(TRAY.x, top - h, TRAY.w, h, d, ts);
      // 杓子
      rect(sx - 8, 64, 22, 6, 'silver');
      rect(sx + 12, 62, 20, 3, 'brown');
    }
    // 目安の線（いまの層の上端）
    if (r.layers.length < r.guest.order.length) {
      const gy = top - LAYER_TARGET;
      const dash = Math.floor(ts / 120) % 4;
      for (let x = TRAY.x - 10; x < TRAY.x + TRAY.w + 10; x += 4) if (((x >> 2) + dash) % 2 === 0) rect(x, gy, 2, 1, 'gold');
      RA.text(ctx, 'ここ', TRAY.x - 12, gy - 8, { color: 'gold', align: 'right' });
    }
  }

  function drawDoughButtons(ts) {
    doughBtns.forEach((b) => {
      const d = DOUGH[b.i];
      const on = round && round.pouring === b.i;
      const y = b.y + (on ? 1 : 0);
      frame(b.x, y, b.w, b.h - (on ? 1 : 0), d.color);
      if (d.speck) for (let k = 0; k < 6; k++) rect(b.x + 4 + ((k * 23) % (b.w - 8)), y + 3 + ((k * 7) % (b.h - 6)), 1, 1, d.speck);
      if (!on) rect(b.x + 2, y + b.h - 3, b.w - 4, 1, d.dark);
      const nx = DIV === 'pc' ? b.x + b.w / 2 + 4 : b.x + b.w / 2;
      RA.text(ctx, d.name, nx, y + 1, { color: d.label, align: 'center' });
      if (DIV === 'pc') RA.text(ctx, String(b.i + 1), b.x + 4, y + 7, { font: 'en', color: d.label });
    });
  }

  // 生地の層を塗る。衣や泡のある味は粒を散らす（泡はちらちら動く）
  function layerRect(x, y, w, h, d, ts) {
    rect(x, y, w, h, d.color);
    if (!d.speck || h < 1) return;
    const shift = d.id === 'ramune' ? Math.floor(ts / 200) : 0;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = (yy * 5 + shift) % 7; xx < w; xx += 7) {
        if ((xx * 3 + yy * 11 + shift) % 4 === 0) rect(x + xx, y + yy, 1, 1, d.speck);
      }
    }
  }

  // 巻いている最中の絵：右へ伸びる生地の板と、左で太っていく巻き
  function drawRolling(ts) {
    const r = round;
    const totalH = r.layers.reduce((s, l) => s + l.h, 0);
    const sheetH = Math.max(6, Math.round(totalH / 4));
    const p = r.progress / 100;
    const rr = Math.round(6 + p * 18);
    const cy = TRAY.base - rr;
    const left = TRAY.x + rr;
    const sheetLeft = Math.round(left + (TRAY.w - rr) * p);
    // 板（層の縞）
    let y = TRAY.base;
    r.layers.forEach((l) => {
      const d = DOUGH[l.d];
      const h = Math.max(1, Math.round((l.h / totalH) * sheetH));
      layerRect(sheetLeft, y - h, TRAY.x + TRAY.w - sheetLeft, h, d, ts);
      y -= h;
    });
    rect(TRAY.x - 4, TRAY.base, TRAY.w + 8, 3, 'silver');
    // 巻き（転がる位置）
    const cx = Math.round(TRAY.x + rr + (TRAY.w - rr * 2) * p * 0.85);
    const outer = DOUGH[r.layers[r.layers.length - 1].d];
    for (let dy = -rr; dy <= rr; dy++) {
      const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
      rect(cx - half, cy + dy, half * 2 + 1, 1, outer.color);
    }
    // 回っている印
    const ang = (r.progress * 0.6) % (Math.PI * 2);
    for (let k = 0; k < 3; k++) {
      const a = ang + (k * Math.PI * 2) / 3;
      rect(cx + Math.round(Math.cos(a) * (rr - 3)) - 1, cy + Math.round(Math.sin(a) * (rr - 3)) - 1, 2, 2, outer.dark);
    }
    if (ts < r.tearFlash && Math.floor(ts / 80) % 2 === 0) {
      rect(cx - 2, cy - rr, 4, rr * 2, 'ink');
    }
  }

  // 速さのゲージ（右端、縦）
  function drawSpeedGauge(ts) {
    const r = round;
    const x = 226;
    const top = 66;
    const h = 100;
    frame(x - 2, top - 2, 20, h + 4, 'ink', 'silver');
    const yOf = (v) => top + h - Math.round((v / 100) * h);
    rect(x, yOf(r.cold), 16, yOf(0) - yOf(r.cold), 'blue');
    rect(x, yOf(r.tear), 16, yOf(r.cold) - yOf(r.tear), 'green');
    rect(x, yOf(100), 16, yOf(r.tear) - yOf(100), 'red');
    const vy = yOf(r.speed);
    rect(x - 4, vy - 1, 24, 3, 'white');
    rect(x - 6, vy - 2, 3, 5, 'gold');
    RA.text(ctx, '速さ', x + 8, top - 20, { color: 'silver', align: 'center' });
  }

  function drawRollBar() {
    const r = round;
    frame(48, 172, 160, 10, 'ink', 'silver');
    rect(49, 173, Math.round(158 * (r.progress / 100)), 8, 'gold');
  }

  function drawLog(ts) {
    const r = round;
    const outer = DOUGH[r.layers[r.layers.length - 1].d];
    frame(LOG.x, LOG.y, LOG.w, LOG.h, outer.color);
    rect(LOG.x + 2, LOG.y + 4, LOG.w - 4, 2, 'white');
    rect(LOG.x + 2, LOG.y + LOG.h - 5, LOG.w - 4, 2, outer.dark);
    // 両端の渦の気配
    r.layers.forEach((l, k) => {
      rect(LOG.x + 2, LOG.y + 8 + k * 5, 3, 3, DOUGH[l.d].color);
      rect(LOG.x + LOG.w - 5, LOG.y + 8 + k * 5, 3, 3, DOUGH[l.d].color);
    });
    // 真ん中の印
    rect(CUT_MID - 3, LOG.y - 10, 7, 2, 'gold');
    rect(CUT_MID - 2, LOG.y - 8, 5, 2, 'gold');
    rect(CUT_MID - 1, LOG.y - 6, 3, 2, 'gold');
    rect(CUT_MID - 1, LOG.y + LOG.h + 2, 3, 4, 'gold');
  }

  function drawKnife(x, down) {
    const y = down ? LOG.y - 4 : LOG.y - 44;
    rect(x - 1, y, 3, 38, 'silver');
    rect(x - 1, y, 1, 38, 'white');
    rect(x - 2, y - 14, 5, 14, 'brown');
    rect(x - 2, y - 2, 5, 2, 'ink');
  }

  // ===== 場面ごとの描画 =====
  function drawTitle(ts) {
    drawKitchen(ts);
    RA.text(ctx, '巻き巻き', 128, 40, { size: 32, color: 'pink', align: 'center', outline: 'ink' });
    RA.text(ctx, 'ういろう', 128, 76, { size: 32, color: 'cream', align: 'center', outline: 'ink' });
    if (img.ane) ctx.drawImage(img.ane, 0, 0, 64, 96, 8, 98, 64, 96);
    // 見本の渦
    if (!img.sample) {
      img.sample = makeSwirl(
        { layers: [{ d: 1, h: 10 }, { d: 0, h: 10 }, { d: 2, h: 10 }], rollScore: 40, tears: 0, coldTime: 0 },
        0
      );
    }
    ctx.drawImage(img.sample, 188, 116);
    frame(76, 112, 106, 56, 'cream');
    rect(72, 124, 5, 4, 'cream');
    RA.text(ctx, 'お客さん', 82, 116, { color: 'ink' });
    RA.text(ctx, '来とるで〜', 82, 132, { color: 'ink' });
    RA.text(ctx, '手伝ってちょ', 82, 148, { color: 'pink' });
    const best = RA.Store.getNumber(BEST, 0);
    RA.text(ctx, DIV_NAME + ' ベスト ' + best + '点', 156, 198, { color: 'silver', align: 'center' });
    if (Math.floor(ts / 500) % 2 === 0) {
      RA.text(ctx, DIV === 'pc' ? 'クリック／スペースで開店' : 'タップで開店', 128, 214, { color: 'gold', align: 'center', outline: 'ink' });
    }
    backBtn.draw(ctx, ts);
  }

  function drawOrder(ts) {
    drawKitchen(ts);
    drawHud(ts);
    drawBubble(round.guest.say, ts);
    RA.text(ctx, 'ご注文', 128, 76, { color: 'gold', align: 'center', outline: 'ink' });
    const order = round.guest.order;
    const w = order.length * 14 - 2;
    drawOrderChips(Math.round(128 - w / 2), 98, order, -1);
    RA.text(ctx, '左から順に流してね', 128, 120, { color: 'cream', align: 'center', outline: 'ink' });
    if (ts - since > 500 && Math.floor(ts / 500) % 2 === 0) {
      RA.text(ctx, DIV === 'pc' ? 'スペースで受ける' : 'タップで受ける', 128, 210, { color: 'gold', align: 'center', outline: 'ink' });
    }
  }

  function drawPour(ts) {
    drawKitchen(ts);
    drawHud(ts);
    const r = round;
    drawGuest(r.guest, 12, 38, ts);
    frame(40, 36, 150, 24, 'cream');
    RA.text(ctx, '流す', 46, 40, { color: 'ink' });
    drawOrderChips(80, 42, r.guest.order, r.layers.length);
    drawTray(ts);
    drawDoughButtons(ts);
    if (r.layers.length === 0 && r.pouring < 0) {
      RA.text(ctx, '押してるあいだ流れるよ', 128, 160, { color: 'cream', align: 'center', outline: 'ink' });
    } else if (r.pouring >= 0) {
      const d = DOUGH[r.pouring];
      RA.text(ctx, d.name + '：' + d.hint, 128, 160, { color: 'cream', align: 'center', outline: 'ink' });
    }
  }

  function drawRoll(ts) {
    drawKitchen(ts);
    drawHud(ts);
    const r = round;
    drawGuest(r.guest, 12, 38, ts);
    frame(40, 36, 150, 24, 'cream');
    RA.text(ctx, '巻く', 46, 40, { color: 'ink' });
    RA.text(ctx, '緑を保って！', 80, 40, { color: 'green' });
    drawRolling(ts);
    drawSpeedGauge(ts);
    drawRollBar();
    // 声
    let msg = null;
    if (ts < r.tearFlash) msg = ['裂けた！', 'red'];
    else if (r.speed > r.tear) msg = ['速すぎ！裂けるよ', 'red'];
    else if (ts - since > ROLL_GRACE * 1000 && r.speed < r.cold) msg = ['冷えてまう…', 'cyan'];
    if (msg) RA.text(ctx, msg[0], 112, 70, { color: msg[1], align: 'center', outline: 'ink' });
    // 押す場所
    const pressing = rolling();
    const by = 200 + (pressing ? 2 : 0);
    frame(64, by, 128, 30 - (pressing ? 2 : 0), pressing ? 'gold' : 'orange');
    RA.text(ctx, DIV === 'pc' ? 'スペース長押し' : '長押しで巻く', 128, by + 6, { color: 'ink', align: 'center' });
    if (r.tears) RA.text(ctx, '裂け ' + r.tears, 8, 176, { color: 'red' });
  }

  function drawCut(ts) {
    drawKitchen(ts);
    drawHud(ts);
    const r = round;
    drawGuest(r.guest, 12, 38, ts);
    frame(40, 36, 150, 24, 'cream');
    RA.text(ctx, '切る', 46, 40, { color: 'ink' });
    RA.text(ctx, '印で止めて！', 80, 40, { color: 'red' });
    drawLog(ts);
    drawKnife(Math.round(r.cutX != null ? r.cutX : r.knifeX), r.cutX != null);
    if (Math.floor(ts / 400) % 2 === 0) {
      RA.text(ctx, DIV === 'pc' ? 'スペースで切る' : 'タップで切る', 128, 210, { color: 'gold', align: 'center', outline: 'ink' });
    }
  }

  function drawReveal(ts) {
    drawKitchen(ts);
    drawHud(ts);
    const r = round;
    const el = ts - since;
    if (el < 0) {
      drawCut(ts);
      return;
    }
    // 断面（2倍で中央に）
    const s = 2;
    const sw = r.swirl.width * s;
    const pop = Math.min(1, el / 250);
    const x = Math.round(128 - sw / 2);
    const y = Math.round(32 + (1 - pop) * 20);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(r.swirl, x, y, sw, sw);
    const react = REACTION.find(([n]) => r.score >= n)[1];
    if (r.score >= 90 && Math.floor(ts / 150) % 2 === 0) {
      RA.text(ctx, 'パーフェクト！', 128, 30, { color: 'gold', align: 'center', outline: 'ink' });
    }
    // 点数の札
    frame(8, 184, 240, 54, 'night', 'silver');
    RA.text(ctx, '流す ' + r.pourScore + '/40', 16, 186, { color: 'cream' });
    RA.text(ctx, '巻く ' + r.rollScore + '/40', 16, 201, { color: 'cream' });
    RA.text(ctx, '切る ' + r.cutScore + '/20', 16, 216, { color: 'cream' });
    RA.text(ctx, r.score + '点', 240, 190, { size: 32, color: r.score >= 70 ? 'gold' : 'silver', align: 'right' });
    // 客のひとこと
    if (el > 400) {
      drawGuest(r.guest, 6, 156, ts);
      frame(30, 158, 220, 22, 'cream');
      RA.text(ctx, react, 36, 161, { color: 'ink' });
    }
  }

  function drawResult(ts) {
    rect(0, 0, W, H, 'night');
    backBtn.draw(ctx, ts);
    RA.text(ctx, DIV_NAME, 250, 6, { align: 'right', color: 'silver', outline: 'ink' });
    const r = result;
    RA.text(ctx, '本日の売上', 128, 28, { color: 'silver', align: 'center' });
    RA.text(ctx, r.total + '点', 128, 46, { size: 32, color: 'gold', align: 'center', outline: 'ink' });
    RA.text(ctx, '称号【' + r.rank + '】', 128, 84, { color: 'pink', align: 'center' });
    r.scores.forEach((s, k) => {
      RA.text(ctx, (k + 1) + '人目  ' + guests[k].who, 24, 108 + k * 18, { color: 'cream' });
      RA.text(ctx, s + '点', 184, 108 + k * 18, { color: s >= 70 ? 'gold' : 'silver', align: 'right' });
    });
    RA.text(ctx, 'ベスト ' + r.best + '点', 104, 164, { color: 'silver', align: 'center' });
    const face = r.total >= 220 ? img.aneHappy : r.total < 150 ? img.aneSad : img.ane;
    if (face) ctx.drawImage(face, 0, 0, 64, 96, 194, 96, 64, 96);
    if (r.isNew && Math.floor(ts / 200) % 2 === 0) {
      RA.text(ctx, '自己ベスト更新！', 104, 178, { color: 'gold', align: 'center', outline: 'ink' });
    }
    retryBtn.draw(ctx, ts);
    topBtn.draw(ctx, ts);
    if (DIV === 'pc') RA.text(ctx, 'SPACE:RETRY  ESC:TOP', 128, 228, { font: 'en', color: 'mist', align: 'center' });
  }

  function drawLoading(ts) {
    rect(0, 0, W, H, 'ink');
    const dots = '...'.slice(0, Math.floor(ts / 300) % 4);
    RA.text(ctx, 'よみこみちゅう' + dots, 72, 112, { color: 'silver' });
  }

  function draw(ts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (phase === 'loading') drawLoading(ts);
    else if (phase === 'title') drawTitle(ts);
    else if (phase === 'order') drawOrder(ts);
    else if (phase === 'pour') drawPour(ts);
    else if (phase === 'roll') drawRoll(ts);
    else if (phase === 'cut') drawCut(ts);
    else if (phase === 'reveal') drawReveal(ts);
    else if (phase === 'result') drawResult(ts);
  }

  RA.loop((ts) => {
    update(ts);
    draw(ts);
    lastTs = ts;
  });

  // ===== 読み込み =====
  function loadImage(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null); // お姉さんの絵がなくても遊べる
      im.src = src;
    });
  }

  const CHARS = '—…→、。「」【】〜あいうえおかがきぎくけこごさしじすずせぜそただちっつてでとどなにねのはばぱひびぶへべほまみむめもゃやゅょよらりるれろわをんェカキクゲジスセタッツテトドネパフプベペホボマムラリルン・ー一丁上下両並中乱互五交人以伝伸位体何余作保修倍児入具円冷出切刻前力加効動包印厚厨受口台右号合名周味営噌回固地場塗境壁声売多大太央女姉始子安定客対小少居屋層工左己巻平店後得態成房所手抹押指描揺散数整文斜断新方日時景更最本札杓来板果柚校格桜楕業横欠止正段気決泡注流渋減渦満点状率生画番白目直真秒称程端粒糖素終絵続緑線縞縦置習職背腹自色茶落行衣裂見計記語読象転込速進遅遊道部配重録長開間隠離面音韻順須頼顔食高髪黒！（）／：＝？';

  Promise.all([
    loadImage('../../assets/chara/ane-idle.png'),
    loadImage('../../assets/chara/ane-happy.png'),
    loadImage('../../assets/chara/ane-sad.png'),
    RA.textReady(CHARS),
  ]).then(([idle, happy, sad]) => {
    img.ane = idle;
    img.aneHappy = happy || idle;
    img.aneSad = sad || idle;
    setPhase('title');
  });
})();
