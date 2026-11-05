/*
 * にゃんキャッチャー — にゃらゲームプラザのクレーンゲーム。真上から見下ろす。
 *
 * 本物と同じ2ボタン方式。
 *   「→」を押しているあいだアームが右へ動く（離したらもう戻せない）
 *   「↑」を押しているあいだアームが奥へ動く。離した位置でアームが降りる
 * つかめるかどうかは、景品の重さと、アームの真ん中からのずれで決まる。持ち上げたあと、
 * 取り出し口へ運ぶ途中で落とすこともある。取り出し口に落ちたら GET。
 * 取った景品は種類ごとに数えて保存し、店内の景品棚に並ぶ（retro-arcade:ufo:prizes）。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);

  // ===== ケースの中（真上から） =====
  const BOX = { x: 12, y: 30, w: 232, h: 136 };
  const CHUTE = { x: 16, y: 128, w: 38, h: 34 }; // 取り出し口（手前の左）
  const HOME = { x: CHUTE.x + CHUTE.w / 2, y: CHUTE.y + CHUTE.h / 2 }; // アームの待機位置
  const LIMIT = { x0: HOME.x, x1: BOX.x + BOX.w - 12, y0: BOX.y + 14, y1: HOME.y };
  const MOVE_SPEED = 52; // アームの横・奥の速さ（ドット/秒）
  const CARRY_SPEED = 80; // 取り出し口へ戻る速さ
  const DROP_TIME = 0.9; // 降りる時間（秒）
  const GRAB_TIME = 0.45; // 閉じる時間
  const LIFT_TIME = 0.9; // 上がる時間
  const REACH = 12; // つかめる範囲（アームの真ん中からの距離）
  const PILE = 8; // ケースの中の景品の数
  const LIFT_PX = 22; // 一番上にいるとき、アームが画面上で浮いて見える高さ

  // ===== 景品（種類と絵は shared/prizes.js） =====
  const PRIZE_TYPES = RA.Prizes.TYPES;
  const TYPE = RA.Prizes.BY_ID;
  let counts = RA.Prizes.load();

  // ===== 状態 =====
  // ready(→待ち) → right(→を押している) → wait2(↑待ち) → back(↑を押している)
  // → drop → grab → lift → carry → open → result → ready
  let phase = 'loading';
  let since = 0;
  const claw = { x: HOME.x, y: HOME.y, h: 1, open: false };
  let held = null; // つかんでいる景品
  let heldP = 0; // つかみの強さ（0〜1）
  let slipAt = -1; // 運んでいる途中で落とす位置（0〜1、-1 は落とさない）
  let carryFrom = null;
  let prizes = [];
  let falling = []; // 落ちている景品 { p, t0 }
  let gotType = null;
  let message = '';
  const pressing = { right: false, back: false };
  const ptrs = new Map(); // pointerId → 'right' | 'back'

  const backBtn = RA.backButton();
  const rightBtn = { x: 16, y: 186, w: 108, h: 46 };
  const upBtn = { x: 132, y: 186, w: 108, h: 46 };

  function setPhase(p) {
    phase = p;
    since = performance.now();
  }

  // ===== 音 =====
  const A = RA.Audio;
  const snd = {
    move() {
      A.tone({ f: 330, dur: 0.05, type: 'triangle', vol: 0.06 });
    },
    drop() {
      A.tone({ f: 660, f2: 220, dur: DROP_TIME, type: 'triangle', vol: 0.08 });
    },
    clunk() {
      A.noise({ dur: 0.08, vol: 0.3, filter: 'lowpass', f: 800 });
      A.tone({ f: 180, dur: 0.08, type: 'square', vol: 0.08 });
    },
    lift() {
      A.tone({ f: 220, f2: 660, dur: LIFT_TIME, type: 'triangle', vol: 0.08 });
    },
    slip() {
      A.tone({ f: 523, f2: 196, dur: 0.35, type: 'square', vol: 0.1 });
    },
    get() {
      A.melody([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.12], [0, 0.04], [1568, 0.08], [2093, 0.36]], { vol: 0.13 });
    },
    miss() {
      A.melody([[392, 0.12], [370, 0.12], [349, 0.3]], { vol: 0.1, type: 'triangle' });
    },
    bgm(t) {
      // ゲーセンの台らしい、短いループのピコピコ音（ボタンを押しているあいだだけ）
      const notes = [523, 659, 784, 659, 587, 698, 880, 698];
      A.tone({ f: notes[Math.floor(t * 6) % notes.length], dur: 0.08, vol: 0.05 });
    },
  };

  // ===== 景品の山 =====
  function pickType() {
    const total = PRIZE_TYPES.reduce((s, t) => s + t.rate, 0);
    let r = Math.random() * total;
    for (const t of PRIZE_TYPES) {
      r -= t.rate;
      if (r < 0) return t.id;
    }
    return 'neko';
  }

  // 取り出し口と、ほかの景品から離れた場所に置く
  function placeNew(type) {
    let best = null;
    for (let k = 0; k < 40; k++) {
      const p = {
        type,
        x: Math.round(BOX.x + 60 + Math.random() * (BOX.w - 76)),
        y: Math.round(BOX.y + 20 + Math.random() * (BOX.h - 34)),
      };
      const d = Math.min(...prizes.map((q) => Math.hypot(q.x - p.x, q.y - p.y)), 99);
      if (!best || d > best.d) best = { p, d };
      if (d > 26) break;
    }
    return best.p;
  }

  function fillPile() {
    while (prizes.length < PILE) prizes.push(placeNew(pickType()));
  }

  // ===== 入力 =====
  function inBox(b, x, y) {
    return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  }

  function down(which) {
    if (which === 'right' && phase === 'ready') {
      pressing.right = true;
      setPhase('right');
    } else if (which === 'back' && phase === 'wait2') {
      pressing.back = true;
      setPhase('back');
    }
  }

  function up(which) {
    if (which === 'right' && phase === 'right') {
      pressing.right = false;
      setPhase('wait2');
    } else if (which === 'back' && phase === 'back') {
      pressing.back = false;
      startDrop();
    }
  }

  RA.bindInput(canvas, {
    press(ev) {
      if (phase === 'loading') return;
      if (backBtn.hit(ev.x, ev.y)) {
        backBtn.flash(performance.now());
        setTimeout(RA.goTop, 120);
        return;
      }
      if (inBox(rightBtn, ev.x, ev.y)) {
        ptrs.set(ev.pointerId, 'right');
        down('right');
      } else if (inBox(upBtn, ev.x, ev.y)) {
        ptrs.set(ev.pointerId, 'back');
        down('back');
      }
    },
    key(ev) {
      if (ev.code === 'Escape') RA.goTop();
      else if (ev.code === 'ArrowRight' || ev.code === 'KeyD' || ev.code === 'Digit1') down('right');
      else if (ev.code === 'ArrowUp' || ev.code === 'KeyW' || ev.code === 'Digit2') down('back');
    },
  });
  const release = (e) => {
    const w = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (w) up(w);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Digit1') up('right');
    else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Digit2') up('back');
  });
  window.addEventListener('blur', () => {
    up('right');
    up('back');
  });

  // ===== 動き =====
  function startDrop() {
    claw.open = true;
    snd.drop();
    setPhase('drop');
  }

  function tryGrab() {
    let best = null;
    for (const p of prizes) {
      const d = Math.hypot(p.x - claw.x, p.y - claw.y);
      if (d <= REACH && (!best || d < best.d)) best = { p, d };
    }
    if (!best) return;
    const t = TYPE[best.p.type];
    // 真ん中ほど、軽いほど、しっかりつかめる
    const p = Math.max(0, 1 - best.d / (REACH + 2)) * (1 - t.weight * 0.85);
    if (Math.random() < 0.25 + p) {
      held = best.p;
      heldP = p;
      prizes = prizes.filter((q) => q !== best.p);
      // 運んでいる途中で落とすかどうかを、ここで決めておく
      slipAt = Math.random() < (1 - p) * 0.55 ? 0.15 + Math.random() * 0.7 : -1;
    }
  }

  function dropHeld(atX, atY) {
    if (!held) return;
    const p = held;
    held = null;
    p.x = Math.round(Math.max(BOX.x + 10, Math.min(BOX.x + BOX.w - 10, atX + (Math.random() * 12 - 6))));
    p.y = Math.round(Math.max(BOX.y + 10, Math.min(BOX.y + BOX.h - 10, atY + (Math.random() * 10 - 2))));
    falling.push({ p, t0: performance.now(), h: claw.h });
    snd.slip();
  }

  function update(ts, dt) {
    const el = (ts - since) / 1000;
    if (phase === 'right') {
      claw.x = Math.min(LIMIT.x1, claw.x + MOVE_SPEED * dt);
      if (Math.floor(el * 6) !== Math.floor((el - dt) * 6)) snd.bgm(el);
      if (claw.x >= LIMIT.x1) up('right');
    } else if (phase === 'back') {
      claw.y = Math.max(LIMIT.y0, claw.y - MOVE_SPEED * dt);
      if (Math.floor(el * 6) !== Math.floor((el - dt) * 6)) snd.bgm(el);
      if (claw.y <= LIMIT.y0) up('back');
    } else if (phase === 'drop') {
      claw.h = Math.max(0, 1 - el / DROP_TIME);
      if (el >= DROP_TIME) {
        claw.h = 0;
        setPhase('grab');
      }
    } else if (phase === 'grab') {
      if (el >= GRAB_TIME * 0.6 && claw.open) {
        claw.open = false;
        snd.clunk();
        tryGrab();
      }
      if (el >= GRAB_TIME) {
        snd.lift();
        setPhase('lift');
      }
    } else if (phase === 'lift') {
      claw.h = Math.min(1, el / LIFT_TIME);
      // 重いものは上がる途中でずり落ちることがある
      if (held && el > LIFT_TIME * 0.5 && slipAt >= 0 && slipAt < 0.2) {
        slipAt = -1;
        dropHeld(claw.x, claw.y);
      }
      if (el >= LIFT_TIME) {
        carryFrom = { x: claw.x, y: claw.y };
        setPhase('carry');
      }
    } else if (phase === 'carry') {
      const dist = Math.hypot(carryFrom.x - HOME.x, carryFrom.y - HOME.y);
      const k = dist < 1 ? 1 : Math.min(1, (el * CARRY_SPEED) / dist);
      claw.x = carryFrom.x + (HOME.x - carryFrom.x) * k;
      claw.y = carryFrom.y + (HOME.y - carryFrom.y) * k;
      if (held && slipAt >= 0.2 && k >= slipAt) {
        slipAt = -1;
        dropHeld(claw.x, claw.y);
      }
      if (k >= 1) {
        claw.open = true;
        snd.clunk();
        setPhase('open');
      }
    } else if (phase === 'open') {
      if (el > 0.35) {
        if (held) {
          gotType = held.type;
          counts[gotType] = (counts[gotType] || 0) + 1;
          RA.Prizes.save(counts);
          held = null;
          message = 'GET!';
          snd.get();
          prizes.push(placeNew(pickType()));
        } else {
          gotType = null;
          message = 'ざんねん';
          snd.miss();
        }
        setPhase('result');
      }
    } else if (phase === 'result') {
      if (el > (gotType ? 2.2 : 1.2)) {
        claw.open = false;
        setPhase('ready');
      }
    }
    falling = falling.filter((f) => ts - f.t0 < 350);
    fillPile();
  }

  // ===== 描画 =====
  function rect(x, y, w, h, color) {
    ctx.fillStyle = P[color];
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function sprite(type, cx, cy, s) {
    RA.Prizes.draw(ctx, type, cx, cy, s);
  }

  // ディザの影（パレット外の半透明を使わない）
  function shadow(cx, cy, rx, ry) {
    ctx.fillStyle = P.ink;
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
        if ((x + y) % 2 === 0) ctx.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
      }
    }
  }

  function drawBox(ts) {
    rect(0, 0, W, H, 'maroon');
    // 看板
    rect(72, 4, 180, 22, 'ink');
    rect(73, 5, 178, 20, 'pink');
    for (let k = 0; k < 22; k++) {
      const on = (k + Math.floor(ts / 200)) % 2 === 0;
      rect(74 + k * 8, 5, 3, 1, on ? 'gold' : 'maroon');
      rect(78 + k * 8, 24, 3, 1, on ? 'maroon' : 'gold');
    }
    RA.text(ctx, 'にゃんキャッチャー', 162, 7, { color: 'white', align: 'center', outline: 'maroon' });
    // ケース
    rect(BOX.x - 3, BOX.y - 3, BOX.w + 6, BOX.h + 6, 'silver');
    rect(BOX.x - 1, BOX.y - 1, BOX.w + 2, BOX.h + 2, 'ink');
    rect(BOX.x, BOX.y, BOX.w, BOX.h, 'night');
    for (let y = BOX.y; y < BOX.y + BOX.h; y += 4) for (let x = BOX.x + ((y >> 2) % 2) * 4; x < BOX.x + BOX.w; x += 8) rect(x, y, 2, 2, 'dusk');
    // 取り出し口
    rect(CHUTE.x - 1, CHUTE.y - 1, CHUTE.w + 2, CHUTE.h + 2, 'gold');
    rect(CHUTE.x, CHUTE.y, CHUTE.w, CHUTE.h, 'ink');
    for (let k = 0; k < 5; k++) rect(CHUTE.x + 4, CHUTE.y + 6 + k * 6, CHUTE.w - 8, 1, 'night');
    RA.text(ctx, 'GET', CHUTE.x + CHUTE.w / 2, CHUTE.y + 14, { font: 'en', color: Math.floor(ts / 400) % 2 ? 'gold' : 'orange', align: 'center' });
    // ガラスの映り込み
    for (let k = 0; k < 14; k++) rect(BOX.x + BOX.w - 40 + k, BOX.y + 6 + k * 2, 1, 1, 'mist');
  }

  function drawClaw(ts) {
    const lift = Math.round(claw.h * LIFT_PX);
    const cx = Math.round(claw.x);
    const cy = Math.round(claw.y) - lift;
    // 床の影（アームが下りるほど小さく濃くなる）
    shadow(cx, Math.round(claw.y) + 2, 5 + Math.round(claw.h * 3), 2 + Math.round(claw.h));
    // ワイヤーと台車（ケースの上辺のレールから）
    rect(cx, BOX.y, 1, cy - BOX.y - 4, 'silver');
    rect(cx - 5, BOX.y, 11, 3, 'mist');
    // つかんだ景品
    if (held) sprite(held.type, cx, cy + 9, 2);
    // アーム（3本爪）
    const o = claw.open ? 3 : 0;
    rect(cx - 3, cy - 5, 7, 4, 'gold');
    rect(cx - 1, cy - 6, 3, 1, 'orange');
    rect(cx - 5 - o, cy - 1, 2, 6, 'silver');
    rect(cx + 4 + o, cy - 1, 2, 6, 'silver');
    rect(cx, cy, 1, 6, 'silver');
    rect(cx - 5 - o, cy + 5, 3, 1, 'white');
    rect(cx + 3 + o, cy + 5, 3, 1, 'white');
  }

  function drawButtons(ts) {
    const draw = (b, label, active, on, color) => {
      const y = b.y + (on ? 2 : 0);
      rect(b.x, y, b.w, b.h - (on ? 2 : 0), 'ink');
      rect(b.x + 1, y + 1, b.w - 2, b.h - 2 - (on ? 2 : 0), active ? color : 'dusk');
      if (!on) rect(b.x + 2, y + b.h - 4, b.w - 4, 2, active ? 'maroon' : 'night');
      // 大きな矢印
      const cx = b.x + b.w / 2;
      const cy = y + 18;
      ctx.fillStyle = P[active ? 'cream' : 'mist'];
      if (label === 'right') {
        for (let i = 0; i < 9; i++) ctx.fillRect(cx - 2 + i, cy - 8 + i, 1, 17 - i * 2);
        ctx.fillRect(cx - 16, cy - 3, 14, 7);
      } else {
        for (let i = 0; i < 9; i++) ctx.fillRect(cx - 8 + i, cy - 2 - i + 8 - 8, 17 - i * 2, 1);
        ctx.fillRect(cx - 3, cy - 2, 7, 14);
      }
      if (active && !on && Math.floor(ts / 300) % 2 === 0) rect(b.x + 4, b.y + 4, 4, 4, 'gold');
    };
    draw(rightBtn, 'right', phase === 'ready' || phase === 'right', pressing.right, 'red');
    draw(upBtn, 'up', phase === 'wait2' || phase === 'back', pressing.back, 'blue');
    RA.text(ctx, '1', rightBtn.x + 8, rightBtn.y + 30, { font: 'en', color: 'cream' });
    RA.text(ctx, '2', upBtn.x + 8, upBtn.y + 30, { font: 'en', color: 'cream' });
  }

  function drawCounts() {
    // 取った数（看板の下の帯）
    let x = 16;
    PRIZE_TYPES.forEach((t) => {
      const n = counts[t.id] || 0;
      sprite(t.id, x + 5, 177, 1);
      RA.text(ctx, 'x' + n, x + 11, 174, { font: 'en', color: n ? 'cream' : 'mist' });
      x += 46;
    });
  }

  function drawHint(ts) {
    let hint = '';
    if (phase === 'ready') hint = '「→」を押して右へ';
    else if (phase === 'right') hint = '離すと止まるよ';
    else if (phase === 'wait2') hint = '「↑」を押して奥へ';
    else if (phase === 'back') hint = '離すと下りるよ';
    if (hint) {
      const w = RA.textWidth(hint) + 12;
      rect(128 - w / 2, BOX.y + 4, w, 20, 'ink');
      RA.text(ctx, hint, 128, BOX.y + 6, { color: 'cream', align: 'center' });
    }
  }

  function draw(ts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (phase === 'loading') {
      rect(0, 0, W, H, 'ink');
      RA.text(ctx, 'よみこみちゅう', 72, 112, { color: 'silver' });
      return;
    }
    drawBox(ts);
    // 景品（奥から手前へ）
    const list = prizes.slice().sort((a, b) => a.y - b.y);
    for (const p of list) {
      shadow(p.x, p.y + 7, 7, 2);
      const f = falling.find((q) => q.p === p);
      const off = f ? Math.round((1 - (ts - f.t0) / 350) * f.h * LIFT_PX) : 0;
      sprite(p.type, p.x, p.y - off, 2);
    }
    drawClaw(ts);
    drawHint(ts);
    if (phase === 'result') {
      const el = ts - since;
      if (gotType) {
        rect(40, 70, 176, 70, 'ink');
        rect(42, 72, 172, 66, 'pink');
        RA.text(ctx, 'GET!', 128, 76, { font: 'en', size: 16, color: Math.floor(el / 120) % 2 ? 'gold' : 'white', align: 'center' });
        sprite(gotType, 92, 112, 3);
        RA.text(ctx, TYPE[gotType].name, 160, 100, { color: 'white', align: 'center', outline: 'maroon' });
        RA.text(ctx, '棚に飾ったよ', 160, 118, { color: 'cream', align: 'center' });
      } else {
        RA.text(ctx, message, 128, 90, { size: 32, color: 'silver', align: 'center', outline: 'ink' });
      }
    }
    drawCounts();
    drawButtons(ts);
    backBtn.draw(ctx, ts);
  }

  let lastTs = 0;
  RA.loop((ts) => {
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    if (phase !== 'loading') update(ts, dt);
    draw(ts);
  });

  const CHARS = '×—↑→、。「」〜あいうえおかがきくけげこごさざしじすずせただちっつてでとどなにねのはぶへほまみめもゃやゅよらりるれろわをんアィイガキクケゲコサザスセタチッデトドパピプボムメャヤラルレワン・ー一上下並中位使保倍入内出前力動半印取口台右同品囲場外大天奥子存小山左帯床店式強影待態戻所手押持描数方明映時景本板棚横機止決浮濃爪物状猫画番看真矢短秒種範絵緑置茶落見距車軽辺込透途速運重閉間降離面音類飾高（）';
  RA.textReady(CHARS).then(() => {
    fillPile();
    setPhase('ready');
  });
})();
