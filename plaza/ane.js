/*
 * にゃらゲームプラザ — ういろう屋「巻き巻きういろー」のお姉さん。
 * 街では店先に立っている（その日のクイズがまだなら、ときどき跳ねて頭の上に「！」）。
 * 押すと会話の画面になり、立ち絵を出して名古屋っ子クイズ（plaza/quiz.js）を1問出す。
 * 絵は assets/chara/ane-<表情>.png（idle・happy・sad。64×96）。街の姿は同じ絵を半分に縮めて作るので、
 * PNG を差し替えるだけで、会話にも街にも反映される。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const W = RA.W;
  const H = RA.H;
  const Plaza = window.Plaza;
  const { makeCanvas, pix } = Plaza.kit;
  const MOBILE = RA.isMobile();

  const FACES = ['idle', 'happy', 'sad'];
  const NAME = 'お姉さん';

  // ===== 会話の画面の配置 =====
  const SLOT = { x: 8, w: 64 }; // 立ち絵の枠（絵は下端中央を窓の上端にそろえる）
  const BOX = { x: 4, y: 148, w: 248, h: 88 }; // 文字の窓
  const TEXT_X = 14;
  const TEXT_Y = 154;
  const LINE_H = 18;
  const WRAP_W = 208; // 1行の幅（行頭に来られない字は、そのぶんはみ出して置く）
  const NO_HEAD = '、。！？!?」』）〜ーっゃゅょぁぃぅぇぉッャュョァィゥェォ…';
  const CHOICE = { x: 78, y: 52, w: 172, h: 22, gap: 4 };
  const TYPE_MS = 28; // 1字が出る間隔
  const PICK_MS = 1000; // 答えを選んでから、お姉さんが返事をするまで
  const HOP_MS = 3200; // 街で跳ねる周期（クイズがまだのとき）

  // ===== 絵 =====
  const imgs = {};
  const minis = {};
  FACES.forEach((f) => {
    const im = new Image();
    im.onload = () => (minis[f] = shrink(im));
    im.src = 'assets/chara/ane-' + f + '.png';
    imgs[f] = im;
  });
  const ready = (im) => im && im.complete && im.naturalWidth > 0;

  // 街に立たせる姿。絵を半分に縮める（2×2 の点のうちいちばん多い色。同じ数なら暗いほう。半分より多く透けていれば透明）
  function shrink(im) {
    const sw = im.naturalWidth;
    const sh = im.naturalHeight;
    const w = Math.max(1, Math.floor(sw / 2));
    const h = Math.max(1, Math.floor(sh / 2));
    const out = makeCanvas(w, h);
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    try {
      const src = makeCanvas(sw, sh);
      const sg = src.getContext('2d');
      sg.drawImage(im, 0, 0);
      const d = sg.getImageData(0, 0, sw, sh).data;
      const o = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const seen = [];
          for (let k = 0; k < 4; k++) {
            const i = ((2 * y + (k >> 1)) * sw + 2 * x + (k & 1)) * 4;
            if (d[i + 3] < 128) continue;
            const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
            const hit = seen.find((s) => s.rgb === rgb);
            if (hit) hit.n++;
            else seen.push({ rgb, n: 1, lum: d[i] * 3 + d[i + 1] * 6 + d[i + 2] });
          }
          if (seen.reduce((s, c) => s + c.n, 0) < 2) continue;
          const best = seen.reduce((a, b) => (b.n > a.n || (b.n === a.n && b.lum < a.lum) ? b : a));
          const j = (y * w + x) * 4;
          o.data[j] = best.rgb >> 16;
          o.data[j + 1] = (best.rgb >> 8) & 255;
          o.data[j + 2] = best.rgb & 255;
          o.data[j + 3] = 255;
        }
      }
      g.putImageData(o, 0, 0);
    } catch (e) {
      // file:// で開いたときなど、絵の画素を読めない環境では、点を間引いて縮める
      g.drawImage(im, 0, 0, w, h);
    }
    return out;
  }

  // ===== 描画の小道具 =====
  function rect(g, color, x, y, w, h) {
    g.fillStyle = P[color];
    g.fillRect(x, y, w, h);
  }

  function frame(g, color, x, y, w, h) {
    rect(g, color, x, y, w, 1);
    rect(g, color, x, y + h - 1, w, 1);
    rect(g, color, x, y, 1, h);
    rect(g, color, x + w - 1, y, 1, h);
  }

  // 墨の地にクリーム色の縁（会話の窓と名札）
  function panel(g, x, y, w, h) {
    rect(g, 'ink', x, y, w, h);
    frame(g, 'cream', x + 1, y + 1, w - 2, h - 2);
  }

  // 後ろの街を暗くする（4×4 のうち12点を墨で塗る）
  let veilPat = null;
  function veil(g) {
    if (!veilPat) {
      const c = makeCanvas(2, 2);
      const cg = c.getContext('2d');
      cg.fillStyle = P.ink;
      cg.fillRect(0, 0, 2, 1);
      cg.fillRect(0, 1, 1, 1);
      veilPat = g.createPattern(c, 'repeat');
    }
    g.fillStyle = veilPat;
    g.fillRect(0, 0, W, H);
  }

  // ===== 街の姿 =====
  let openCache = { at: -1e9, v: false };
  // 今日のクイズがまだか（保存を毎フレーム読まないよう、1秒ごとに確かめる）
  function quizOpen(now) {
    if (now - openCache.at > 1000) openCache = { at: now, v: !Plaza.quiz.result(Plaza.quiz.today()) };
    return openCache.v;
  }

  // 吹き出しの「！」（9×12 ドット。しっぽは左下）
  const BUBBLE = [
    '.kkkkkkk.',
    'kccccccck',
    'kcccrccck',
    'kcccrccck',
    'kcccrccck',
    'kccccccck',
    'kcccrccck',
    'kccccccck',
    '.kcckkkk.',
    '.kck.....',
    '.kk......',
    '.k.......',
  ];

  // 街の店先に立つ姿。(x, foot) は足もとの中央（画面の座標）
  function drawStreet(g, x, foot, ts) {
    const open = quizOpen(performance.now());
    const ph = ts % HOP_MS;
    const cheer = open && ph < 480;
    const mini = (cheer && minis.happy) || minis.idle;
    if (!mini) return;
    const top = foot - mini.height - (cheer && ph < 240 ? 2 : 0);
    const left = Math.round(x - mini.width / 2);
    g.drawImage(mini, left, top);
    if (open && Math.floor(ts / 400) % 3 < 2) {
      pix(g, BUBBLE, left + mini.width - 6, top - 12, { k: 'ink', c: 'cream', r: 'red' });
      if (!MOBILE) RA.text(g, 'U', left + mini.width + 5, top - 11, { font: 'en', color: 'cream', outline: 'ink' });
    }
  }

  // ===== 会話 =====
  // talk = { date, q（その日の問題）, steps: [{ face, text, quiz, gift }], i（いまの段）, at（その段が始まった時刻）,
  //          lines（折り返した文）, picked（選んだ選択肢。まだなら -1）, pickedAt, focus, kbd, hover, voiced }
  let talk = null;
  const closeBtn = new RA.Button({ x: 4, y: 4, w: 64, h: 20, label: 'もどる', icon: 'back' });
  const choiceBtns = [0, 1, 2].map((k) => new RA.Button({ x: CHOICE.x, y: CHOICE.y + k * (CHOICE.h + CHOICE.gap), w: CHOICE.w, h: CHOICE.h, label: '' }));

  // 文を窓の幅で折り返す（\n でも改行）
  function wrap(text) {
    const lines = [];
    let line = '';
    for (const ch of Array.from(text)) {
      if (ch === '\n') {
        lines.push(line);
        line = '';
        continue;
      }
      if (line && RA.textWidth(line + ch) > WRAP_W && NO_HEAD.indexOf(ch) < 0) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }

  const lengthOf = (lines) => lines.reduce((s, l) => s + Array.from(l).length, 0);
  const shown = (now) => Math.max(0, Math.floor((now - talk.at) / TYPE_MS));
  const typed = (now) => shown(now) >= lengthOf(talk.lines);
  const step = () => talk.steps[talk.i];
  const waiting = () => step().quiz && talk.picked < 0; // 答えを待っている

  function begin(i, now) {
    talk.i = i;
    talk.at = now;
    talk.voiced = 0;
    talk.lines = wrap(step().text);
    if (step().gift != null) Plaza.sound.sfx.gift();
  }

  function open(now) {
    const date = Plaza.quiz.today();
    const done = Plaza.quiz.result(date);
    const q = Plaza.quiz.question(date);
    let steps;
    if (!done) {
      steps = [
        { face: 'idle', text: 'いらっしゃ〜い！\nでらかわいい子来たがね〜' },
        { face: 'idle', text: '名古屋っ子クイズは1日1問！\n当たったら、ういろう肥料\nあげるがや〜' },
        { face: 'idle', text: '問題！' + q.q, quiz: true },
      ];
    } else if (done.ok) {
      steps = [
        { face: 'happy', text: '今日はもう正解したがね〜。\nちょーやるがや〜！' },
        { face: 'idle', text: 'また明日おいでよ〜。\n肥料は菌糸ライフで\n使ってちょ〜' },
      ];
    } else {
      steps = [
        { face: 'sad', text: '今日のクイズは、\nもうおしまいだがね〜' },
        { face: 'idle', text: 'また明日、リベンジしよまい！' },
      ];
    }
    talk = { date, q, steps, i: 0, at: now, lines: [], picked: -1, pickedAt: 0, focus: 0, kbd: false, hover: -1, voiced: 0 };
    begin(0, now);
  }

  function close() {
    talk = null;
    openCache.at = -1e9;
    RA.sfx.blip();
    return 'close';
  }

  function pick(k, now) {
    const c = talk.q.choices[k];
    talk.picked = k;
    talk.pickedAt = now;
    const count = Plaza.quiz.answer(talk.date, c.ok);
    if (c.ok) {
      Plaza.sound.sfx.right();
      talk.steps.push({ face: 'happy', text: 'ちょー正解！やるがや〜！' }, { face: 'happy', text: 'ごほうびに、ういろう肥料を\n1個あげるがね〜。\n菌糸ライフで使ってちょ〜', gift: count });
    } else {
      Plaza.sound.sfx.wrong();
      talk.steps.push({ face: 'sad', text: 'みゃー、ちがうがね。\n正解は「' + talk.q.answer + '」だがや〜' }, { face: 'sad', text: 'まだまだだがや〜。\nまた明日おいでよ〜' });
    }
  }

  // 先へ進める。字が出きっていなければ出しきる。最後の段なら閉じて 'close' を返す
  function advance(now) {
    if (!typed(now)) {
      talk.at = now - lengthOf(talk.lines) * TYPE_MS;
      return null;
    }
    if (waiting()) return null;
    if (step().quiz && now - talk.pickedAt < PICK_MS) return null;
    if (talk.i + 1 < talk.steps.length) {
      begin(talk.i + 1, now);
      return null;
    }
    return close();
  }

  const choiceAt = (x, y) => choiceBtns.findIndex((b) => b.hit(x, y));

  // 押したとき。閉じたら 'close'
  function press(x, y, now) {
    if (!talk) return 'close';
    if (closeBtn.hit(x, y)) {
      closeBtn.flash(now);
      return close();
    }
    talk.kbd = false;
    if (waiting() && typed(now)) {
      const k = choiceAt(x, y);
      if (k >= 0) {
        choiceBtns[k].flash(now);
        pick(k, now);
      }
      return null;
    }
    return advance(now);
  }

  function key(code, now) {
    if (!talk) return 'close';
    if (code === 'Escape' || code === 'Backspace') return close();
    const ok = code === 'Space' || code === 'Enter';
    if (waiting() && typed(now)) {
      const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(code);
      if (n >= 0) {
        talk.focus = n;
        choiceBtns[n].flash(now);
        pick(n, now);
      } else if (code === 'ArrowUp' || code === 'ArrowDown') {
        if (talk.kbd) talk.focus = (talk.focus + (code === 'ArrowUp' ? 2 : 1)) % 3;
        talk.kbd = true; // 最初の1回は選択枠を出すだけ
        RA.sfx.blip();
      } else if (ok) {
        if (talk.kbd) {
          choiceBtns[talk.focus].flash(now);
          pick(talk.focus, now);
        }
        talk.kbd = true;
      }
      return null;
    }
    return ok ? advance(now) : null;
  }

  function move(x, y) {
    if (talk) talk.hover = choiceAt(x, y);
  }

  // 答えを選んだら、少し待ってお姉さんの返事へ。字が出るたびに小さな声
  function update(now) {
    if (step().quiz && talk.picked >= 0 && now - talk.pickedAt >= PICK_MS) {
      begin(talk.i + 1, now);
    }
    const n = Math.min(shown(now), lengthOf(talk.lines));
    if (n > talk.voiced) {
      const ch = Array.from(talk.lines.join(''))[n - 1];
      if (Math.floor(n / 2) > Math.floor(talk.voiced / 2) && NO_HEAD.indexOf(ch) < 0) Plaza.sound.sfx.voice();
      talk.voiced = n;
    }
  }

  function drawPortrait(g, now) {
    const im = imgs[step().face];
    if (!ready(im)) return;
    const hop = step().face === 'happy' && now - talk.at < 160 ? 2 : 0;
    g.drawImage(im, SLOT.x + Math.round((SLOT.w - im.naturalWidth) / 2), BOX.y - im.naturalHeight - hop);
  }

  function drawText(g, now, ts) {
    let left = shown(now);
    talk.lines.forEach((line, k) => {
      if (left <= 0) return;
      const chars = Array.from(line);
      RA.text(g, chars.slice(0, left).join(''), TEXT_X, TEXT_Y + k * LINE_H, { color: 'cream' });
      left -= chars.length;
    });
    // 続きがある合図（▼）
    if (typed(now) && !waiting() && !(step().quiz && now - talk.pickedAt < PICK_MS) && Math.floor(ts / 400) % 2 === 0) {
      const x = BOX.x + BOX.w - 16;
      const y = BOX.y + BOX.h - 11;
      for (let i = 0; i < 4; i++) rect(g, 'gold', x + i, y + i, 7 - i * 2, 1);
    }
  }

  function drawChoices(g, now, ts) {
    const blink = Math.floor(ts / 160) % 2 === 0;
    talk.q.choices.forEach((c, k) => {
      const b = choiceBtns[k];
      b.label = c.text;
      if (talk.picked < 0) b.tone = 'normal';
      else if (c.ok) b.tone = k === talk.picked || blink ? 'lit' : 'normal';
      else b.tone = k === talk.picked ? 'primary' : 'normal';
      b.draw(g, ts);
      if (talk.picked >= 0) return;
      if (!MOBILE) RA.text(g, String(k + 1), b.x + 5, b.y + 7, { font: 'en', color: 'mist' });
      if ((talk.kbd && talk.focus === k && Math.floor(ts / 300) % 3 < 2) || (!talk.kbd && talk.hover === k)) frame(g, 'gold', b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    });
  }

  // ういろう肥料をもらった札
  function drawGift(g, count, ts) {
    const x = CHOICE.x;
    const y = 56;
    panel(g, x, y, CHOICE.w, 64);
    RA.Fertilizer.icon(g, x + 12, y + 18, 2);
    [
      [x + 6, y + 12],
      [x + 36, y + 10],
      [x + 8, y + 52],
      [x + 38, y + 48],
    ].forEach(([sx, sy], k) => {
      if (Math.floor(ts / 200 + k) % 3 === 0) return;
      const c = k % 2 ? 'gold' : 'white';
      rect(g, c, sx - 1, sy, 3, 1);
      rect(g, c, sx, sy - 1, 1, 3);
    });
    RA.text(g, 'もらった！', x + 48, y + 6, { color: 'gold' });
    RA.text(g, 'ういろう肥料', x + 48, y + 24, { color: 'cream' });
    RA.text(g, '手持ち ' + count + '個', x + 48, y + 42, { color: 'silver' });
  }

  function draw(g, ts) {
    if (!talk) return;
    const now = performance.now();
    update(now);
    veil(g);
    drawPortrait(g, now);
    panel(g, BOX.x, BOX.y, BOX.w, BOX.h);
    const nw = RA.textWidth(NAME) + 12;
    panel(g, CHOICE.x, BOX.y - 19, nw, 20);
    RA.text(g, NAME, CHOICE.x + 6, BOX.y - 18, { color: 'pink' });
    drawText(g, now, ts);
    if (step().quiz && typed(now)) drawChoices(g, now, ts);
    if (step().gift != null) drawGift(g, step().gift, ts);
    closeBtn.draw(g, ts);
  }

  const CHARS =
    NAME +
    'いらっしゃ〜い！でらかわいい子来たがね〜名古屋っ子クイズは1日1問！当たったら、ういろう肥料あげるがや〜問題！' +
    '今日はもう正解したがね〜。ちょーやるがや〜！また明日おいでよ〜。肥料は菌糸ライフで使ってちょ〜' +
    '今日のクイズは、もうおしまいだがね〜また明日、リベンジしよまい！' +
    'ちょー正解！やるがや〜！ごほうびに、ういろう肥料を1個あげるがね〜。菌糸ライフで使ってちょ〜' +
    'みゃー、ちがうがね。正解は「」だがや〜まだまだだがや〜。また明日おいでよ〜' +
    'もらった！ういろう肥料手持ち個もどる0123456789' +
    Plaza.quiz.CHARS;

  Plaza.ane = { CHARS, drawStreet, open, draw, press, key, move };
})();
