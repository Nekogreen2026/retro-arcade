/*
 * トップページ — にゃらゲームプラザ（1996年、名古屋・大須のゲームセンター）。
 * 場面の流れ:
 *   title  … 現在の大須。店はシャッターが下り、ネオンも消えている（最初のタップで音声を有効化）
 *   slip   … 年が1996年まで巻き戻り、店に灯りが戻る
 *   street … 画面1 街並み。壁のポスターからは、そのゲームへ直接入れる
 *   talk   … 街のまま、ういろう屋のお姉さんと話す（名古屋っ子クイズ。plaza/ane.js）
 *   enter  … 画面2 入店。自動ドアが左右に開き、商店街の音が店内のゲーム音に入れ替わる
 *   inside … 画面3 店内。筐体からゲームへ入る。「外に出る」で exit を通って street へ
 *   leave  … ゲームへ入るときの暗転
 * ゲームから戻ってきたときは、出たところ（店内か街）から始まる（タイトルと巻き戻しは省く）。
 * 街・店内・空・音・お姉さんはそれぞれ plaza/ のファイルにあり、ここは場面の切り替えと入力をまとめる。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;
  const Plaza = window.Plaza;
  const { seeded, makeCanvas, ease, clamp, jstNow } = Plaza.kit;
  const { street, inside, sky, sound, ane, quiz } = Plaza;

  const canvas = document.getElementById('screen');
  const ctx = RA.setupScreen(canvas);
  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
  const MOBILE = RA.isMobile();

  // ===== 時間（ミリ秒） =====
  const ROLL = 1800; // 年が巻き戻る
  const FLASH = 160; // 着いた瞬間の白い光
  const REVEAL = 700; // 光が引いて1996年の街が見えてくる
  const DOOR_OPEN = 700; // 自動ドアが開ききるまで
  const ZOOM = 520; // ドアの向こうが画面いっぱいに広がるまで
  const WALK_MAX = 900; // 入店の前にプラザの正面へ戻る上限
  const LEAVE_TIME = 420;
  const RETURN_KEY = ['top', 'return'];
  const RETURN_MAX = 12 * 3600 * 1000; // これより前に出たきりなら、タイトルから
  const PEEK_Y = 80; // ドアのすきまから見える店内を、これだけ上から持ってくる（筐体が見えるように）

  // ===== 状態 =====
  let scene = 'loading';
  let sceneAt = 0;
  let doorAt = 0; // 入店で扉が開きはじめた時刻（0 はまだ）
  let closing = false; // 外に出るとき、扉が閉まりはじめたか
  let arrived = false; // 巻き戻しが1996年に着いたか（着いてから商店街の音を出す）
  let leaving = null; // { url, from }
  let lastTs = 0;
  const yearNow = jstNow(Date.now()).y;

  const buf = makeCanvas(W, H);
  const bctx = buf.getContext('2d');
  bctx.imageSmoothingEnabled = false;

  function go(s) {
    scene = s;
    sceneAt = performance.now();
  }

  function rect(color, x, y, w, h) {
    ctx.fillStyle = P[color];
    ctx.fillRect(x, y, w, h);
  }

  // ゲームから戻ってきたなら、出たところから（記録は読んだら消す）
  function readReturn() {
    let r = null;
    try {
      r = JSON.parse(RA.Store.get(RETURN_KEY, 'null'));
    } catch (e) {
      r = null;
    }
    RA.Store.set(RETURN_KEY, 'null');
    if (!r || (r.scene !== 'inside' && r.scene !== 'street')) return null;
    const age = Date.now() - r.at;
    return age >= 0 && age < RETURN_MAX ? r.scene : null;
  }
  const back = readReturn();
  if (back) arrived = true;

  // ===== 白い光が引いていくディザ（4×4 の升目のうち、k 個が白いまま） =====
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const veils = Array.from({ length: 17 }, (_, k) => {
    const c = makeCanvas(4, 4);
    const g = c.getContext('2d');
    g.fillStyle = P.white;
    BAYER.forEach((v, i) => v < k && g.fillRect(i % 4, Math.floor(i / 4), 1, 1));
    return ctx.createPattern(c, 'repeat');
  });

  function veil(k) {
    k = clamp(Math.round(k * 16), 0, 16);
    if (!k) return;
    ctx.fillStyle = veils[k];
    ctx.fillRect(0, 0, W, H);
  }

  // ===== 各場面 =====
  function drawStreet(ts, st, o) {
    const r = street.draw(ctx, ts, Object.assign({ st }, o));
    if (r.thunder) sound.sfx.thunder();
  }

  // 札（墨の地に宵闇の縁）
  function plate(x, y, w, h) {
    rect('dusk', x, y, w, h);
    rect('ink', x + 1, y + 1, w - 2, h - 2);
  }

  function drawTitle(ts, st) {
    drawStreet(ts, st, { era: 'now', hud: true });
    plate(28, 80, 200, 20);
    RA.text(ctx, 'まだ、光っていたころへ。', 128, 81, { color: 'cream', align: 'center' });
    if (Math.floor(ts / 500) % 2 === 0) {
      RA.text(ctx, MOBILE ? 'タップで1996年へ' : 'クリック／スペースで1996年へ', 128, street.VIEW_H + 5, { color: 'gold', align: 'center' });
    }
  }

  // 画面の行を左右にずらし、色の線を走らせる（巻き戻し中のノイズ）
  function glitch(t, p) {
    const rnd = seeded(Math.floor(t / 45) + 1);
    const n = 2 + Math.floor(p * 10);
    for (let i = 0; i < n; i++) {
      const y = Math.floor(rnd() * street.VIEW_H);
      const h = 1 + Math.floor(rnd() * 6);
      const dx = Math.round((rnd() * 2 - 1) * (2 + p * 14));
      ctx.drawImage(canvas, 0, y, W, h, dx, y, W, h);
    }
    const COLORS = ['cyan', 'pink', 'white', 'gold'];
    for (let i = 0; i < Math.floor(p * 5); i++) rect(COLORS[i % COLORS.length], 0, Math.floor(rnd() * street.VIEW_H), W, 1);
  }

  function drawSlip(ts, st) {
    const t = performance.now() - sceneAt;
    const p = clamp(t / ROLL, 0, 1);
    // 終わりに近づくほど、灯りのともった1996年の姿がちらちらと混ざる
    let era = 'now';
    if (t >= ROLL) era = '1996';
    else if (p > 0.55) era = Math.floor(t / (p > 0.85 ? 40 : 90)) % 2 ? '1996' : 'now';
    const year = Math.round(yearNow - (yearNow - Plaza.YEAR) * ease(p));
    drawStreet(ts, st, { era, hud: true, year, ui: t >= ROLL });
    if (t < ROLL) glitch(t, p);
    if (t < ROLL + FLASH) {
      plate(40, 86, 176, 44);
      RA.text(ctx, String(year), 52, 92, { font: 'en', size: 32, color: 'gold' });
      RA.text(ctx, '年', 184, 89, { size: 32, color: 'gold' });
    }
    if (t >= ROLL && !arrived) {
      arrived = true;
      sound.sfx.arrive();
    }
    if (t >= ROLL && t < ROLL + FLASH) rect('white', 0, 0, W, H);
    else if (t >= ROLL + FLASH) veil(1 - (t - ROLL - FLASH) / REVEAL);
    if (t >= ROLL + FLASH + REVEAL) go('street');
  }

  // ドアのすきま（k＝0）から画面いっぱい（k＝1）までの窓と、そこに映す店内の位置
  function opening(k) {
    const d = street.doorRect();
    const lerp = (a, b) => Math.round((a + (b - a) * k) / 2) * 2;
    const x0 = lerp(d.x, 0);
    const y0 = lerp(d.y, 0);
    const x1 = lerp(d.x + d.w, W);
    const y1 = lerp(d.y + d.h, H);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, dy: Math.round(PEEK_Y * (1 - k)) };
  }

  function peek(r) {
    if (r.w <= 0 || r.h <= 0) return;
    ctx.drawImage(buf, r.x, r.y - r.dy, r.w, r.h, r.x, r.y, r.w, r.h);
  }

  // 入店。プラザの正面に戻ってから扉が開き、すきまの向こうの店内が画面いっぱいに広がる。返り値は音の mix
  function drawEnter(ts, st) {
    const now = performance.now();
    if (!doorAt && (street.home() || now - sceneAt > WALK_MAX)) {
      street.home(true);
      doorAt = now;
      sound.sfx.door();
    }
    const td = doorAt ? now - doorAt : 0;
    const open = doorAt ? ease(td / DOOR_OPEN) : 0;
    drawStreet(ts, st, { era: '1996', door: open });
    if (!doorAt) return 0;
    inside.draw(bctx, ts, { hud: false });
    const k = ease((td - DOOR_OPEN) / ZOOM);
    if (td < DOOR_OPEN) {
      const g = street.doorGap(open);
      peek(Object.assign(g, { dy: PEEK_Y }));
    } else {
      peek(opening(k));
    }
    if (td >= DOOR_OPEN + ZOOM) go('inside');
    return 0.7 * open + 0.3 * k;
  }

  // 外に出る。店内が扉の大きさまで縮み、扉が閉まる
  function drawExit(ts, st) {
    const t = performance.now() - sceneAt;
    const k = 1 - ease(t / ZOOM);
    const open = t < ZOOM ? 1 : 1 - ease((t - ZOOM) / DOOR_OPEN);
    if (t >= ZOOM && !closing) {
      closing = true;
      sound.sfx.door();
    }
    drawStreet(ts, st, { era: '1996', door: open });
    inside.draw(bctx, ts, { hud: false });
    if (t < ZOOM) peek(opening(k));
    else peek(Object.assign(street.doorGap(open), { dy: PEEK_Y }));
    if (t >= ZOOM + DOOR_OPEN) go('street');
    return t < ZOOM ? 0.7 + 0.3 * k : 0.7 * open;
  }

  function drawLeave(ts, st) {
    if (leaving.from === 'inside') inside.draw(ctx, ts, { hud: true });
    else drawStreet(ts, st, { era: '1996', hud: true, ui: true });
    // シャッターが下りるように暗転
    const p = Math.min(1, (performance.now() - sceneAt) / LEAVE_TIME);
    const h = Math.ceil(((H / 2) * p) / 4) * 4;
    rect('ink', 0, 0, W, h);
    rect('ink', 0, H - h, W, h);
  }

  function drawDebug() {
    const rec = sky.record;
    const s = 'T:' + (sky.debug.tod || 'AUTO') + ' W:' + (sky.debug.weather || 'AUTO') + ' ' + (rec ? rec.src.toUpperCase() : '-');
    RA.text(ctx, s.toUpperCase(), 4, 26, { font: 'en', color: 'pink', outline: 'ink' });
  }

  // ===== 操作 =====
  function startSlip() {
    go('slip');
    sound.sfx.slip();
  }

  function startEnter() {
    doorAt = 0;
    go('enter');
  }

  function startExit() {
    closing = false;
    street.home(true);
    go('exit');
  }

  function leaveTo(game, from) {
    if (leaving) return;
    RA.Store.set(['top', 'last-game'], game.id);
    RA.Store.set(RETURN_KEY, JSON.stringify({ scene: from, at: Date.now() }));
    RA.sfx.coin();
    leaving = { url: 'games/' + game.id + '/index.html', from };
    go('leave');
    setTimeout(() => {
      if (leaving) location.href = leaving.url;
    }, LEAVE_TIME);
  }

  function onStreet(a) {
    if (!a) return;
    if (a.type === 'enter') startEnter();
    else if (a.type === 'poster') leaveTo(a.game, 'street');
    else if (a.type === 'ane') {
      ane.open(performance.now());
      go('talk');
    }
  }

  function onTalk(r) {
    if (r === 'close') go('street');
  }

  function onInside(a) {
    if (!a) return;
    if (a.type === 'exit') startExit();
    else if (a.type === 'game') leaveTo(a.game, 'inside');
  }

  // 巻き戻しの途中で押したら、すぐ着いたことにする
  function skipSlip() {
    const t = performance.now() - sceneAt;
    if (t < ROLL) sceneAt = performance.now() - ROLL;
  }

  // 確認用（?debug=1）: T で時間帯、W で空模様を切り替える。Q で今日のクイズの記録を消す
  function debugKey(code) {
    const cycle = (list, v) => {
      const i = list.indexOf(v);
      return i + 1 < list.length ? list[i + 1] : null;
    };
    if (code === 'KeyT') sky.debug.tod = cycle(sky.TODS, sky.debug.tod);
    else if (code === 'KeyW') sky.debug.weather = cycle(sky.WEATHERS, sky.debug.weather);
    else if (code === 'KeyQ' && scene !== 'talk') quiz.reset();
    else return false;
    RA.sfx.blip();
    return true;
  }

  RA.bindInput(canvas, {
    press(ev) {
      const now = performance.now();
      if (scene === 'title') startSlip();
      else if (scene === 'slip') skipSlip();
      else if (scene === 'street') onStreet(street.press(ev.x, ev.y, now));
      else if (scene === 'talk') onTalk(ane.press(ev.x, ev.y, now));
      else if (scene === 'inside') onInside(inside.press(ev.x, ev.y, now));
    },
    move(p) {
      if (scene === 'street') street.move(p.x, p.y);
      else if (scene === 'talk') ane.move(p.x, p.y);
      else if (scene === 'inside') inside.move(p.x, p.y);
    },
    key(ev) {
      if (DEBUG && debugKey(ev.code)) return;
      const now = performance.now();
      const ok = ev.code === 'Space' || ev.code === 'Enter';
      if (scene === 'title' && ok) startSlip();
      else if (scene === 'slip' && ok) skipSlip();
      else if (scene === 'street') onStreet(street.key(ev.code, now));
      else if (scene === 'talk') onTalk(ane.key(ev.code, now));
      else if (scene === 'inside') onInside(inside.key(ev.code, now));
    },
  });

  // ブラウザの「戻る」でこのページに帰ってきたら、暗転を解いて出たところへ
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && leaving) {
      const from = leaving.from;
      leaving = null;
      go(from);
    }
  });

  // 字形が届き直したら、文字を焼き込んだ背景を描き直す
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => {
      street.repaint();
      inside.repaint();
    });
  }

  RA.loop((ts) => {
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    sky.check();
    if (scene === 'loading') {
      rect('ink', 0, 0, W, H);
      return;
    }
    const st = sky.state(Date.now());
    street.update(dt);
    inside.update(dt);
    let mix = 0;
    if (scene === 'title') drawTitle(ts, st);
    else if (scene === 'slip') drawSlip(ts, st);
    else if (scene === 'street') drawStreet(ts, st, { era: '1996', hud: true, ui: true });
    else if (scene === 'talk') {
      drawStreet(ts, st, { era: '1996', hud: true, ui: true });
      ane.draw(ctx, ts);
    } else if (scene === 'enter') mix = drawEnter(ts, st);
    else if (scene === 'inside') {
      inside.draw(ctx, ts, { hud: true });
      mix = 1;
    } else if (scene === 'exit') mix = drawExit(ts, st);
    else if (scene === 'leave') {
      drawLeave(ts, st);
      mix = leaving.from === 'inside' ? 1 : 0;
    }
    if (DEBUG) drawDebug();
    const near = street.nearness();
    sound.frame({ street: arrived ? 1 : 0, mix, door: near.door, sando: near.sando, day: st.tod !== 'night', sky: st });
  });

  // ===== 読み込み =====
  const CHARS = street.CHARS + inside.CHARS + ane.CHARS + 'まだ、光っていたころへ。タップで1996年へクリック／スペース年';
  // 天気は待ちすぎない（届かなければ手元の記録か、季節なりの空で始め、届いたらそこから変わる）
  const weatherReady = Promise.race([sky.check() || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 2500))]);
  Promise.all([RA.textReady(CHARS), weatherReady]).then(() => go(back || 'title'));
})();
