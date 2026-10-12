/*
 * ドット文字の描画。
 * canvas にそのまま文字を描くと、ふちがにじんだうえ、DotGothic16 は字によってドットの升目が
 * 半ドットずれている（漢字・英数とかなで位置が違う）ため、どこに置いても欠ける字が出る。
 * そこで1字ずつ8倍の大きさで裏に描き、その字のドットの升目を割り出して、各ドットの中心が
 * 塗られているかどうかで1倍のドット絵に起こし直す。できた字はパレットの1色で塗って使い回す。
 *   日本語・数字 … DotGothic16（16px かその整数倍）
 *   英字         … Press Start 2P（8px かその整数倍）
 */
(function () {
  'use strict';
  const RA = window.RA;

  const N = 8; // 裏で描く倍率
  const FONTS = {
    jp: { family: '"DotGothic16", monospace', base: 16, rows: 20, pad: 1, ref: '居合鬼斬漢字アイウあいうABC123' },
    en: { family: '"Press Start 2P", monospace', base: 8, rows: 8, pad: 0, ref: 'ABCDEFG0123456789' },
  };
  const ORIGIN_X = 2 * N; // 裏の描画での字の原点
  const baseY = (f) => (f.base + 2) * N; // 裏の描画でのベースライン

  const work = document.createElement('canvas');
  const big = work.getContext('2d', { willReadFrequently: true });
  const glyphs = new Map(); // 'jp|字' → { adv, mask }
  const topLine = {}; // フォントごとの「1行目の上端」の位置（裏の描画の座標）
  const strings = new Map(); // 描き上がった文字列の画像
  const STRINGS_MAX = 400;
  const fontState = new Map(); // 'jp|字' → 'loading' | 'done'

  const bigFont = (f) => f.base * N + 'px ' + f.family;

  // 字形が読み込み済みか。未読み込みなら読み込みを始めて false を返す
  function glyphReady(fk, ch) {
    const fonts = document.fonts;
    if (!fonts || !fonts.check) return true;
    const key = fk + '|' + ch;
    const state = fontState.get(key);
    if (state === 'done') return true;
    const font = FONTS[fk].base + 'px ' + FONTS[fk].family;
    let ok = true;
    try {
      ok = fonts.check(font, ch);
    } catch (e) {
      ok = true;
    }
    if (ok) {
      fontState.set(key, 'done');
      return true;
    }
    if (!state) {
      fontState.set(key, 'loading');
      const done = () => fontState.set(key, 'done');
      fonts.load(font, ch).then(done, done);
      setTimeout(done, 4000); // 回線がなくても固まらないように
    }
    return false;
  }

  // 裏で8倍に描いて、アルファ値の配列を返す
  function paintBig(f, text, width) {
    work.width = width;
    work.height = (f.base + 8) * N;
    big.font = bigFont(f);
    big.textBaseline = 'alphabetic';
    big.fillStyle = '#000';
    big.fillText(text, ORIGIN_X, baseY(f));
    const w = work.width;
    const h = work.height;
    const d = big.getImageData(0, 0, w, h).data;
    return { w, h, a: (x, y) => d[(y * w + x) * 4 + 3] };
  }

  // ふちの位置の分布から、升目の線の位相（0〜N の実数）を求める
  function phaseOf(hist) {
    let s = 0;
    let c = 0;
    hist.forEach((v, k) => {
      const ang = (2 * Math.PI * k) / N;
      s += v * Math.sin(ang);
      c += v * Math.cos(ang);
    });
    if (!s && !c) return null;
    const p = (Math.atan2(s, c) * N) / (2 * Math.PI);
    return p < 0 ? p + N : p;
  }

  // 縦方向の升目はフォント全体で共通なので、見本の文字列から一度だけ求める
  function topLineOf(fk) {
    if (topLine[fk] != null) return topLine[fk];
    const f = FONTS[fk];
    big.font = bigFont(f);
    const width = Math.ceil(big.measureText(f.ref).width) + ORIGIN_X * 2;
    const img = paintBig(f, f.ref, width);
    const hist = new Array(N).fill(0);
    let top = img.h;
    for (let y = 1; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const v = img.a(x, y);
        hist[y % N] += Math.abs(v - img.a(x, y - 1));
        if (v >= 128 && y < top) top = y;
      }
    }
    const py = phaseOf(hist);
    const want = top - f.pad * N; // 字の上端の上に pad 行の余白
    const line = py == null ? want : py + N * Math.round((want - py) / N);
    if (glyphReady(fk, f.ref)) topLine[fk] = line;
    return line;
  }

  // 1字を1倍のドット（0/1 の配列）に起こす
  function glyph(fk, ch) {
    const key = fk + '|' + ch;
    const hit = glyphs.get(key);
    if (hit) return hit;
    const f = FONTS[fk];
    big.font = bigFont(f);
    const adv = Math.max(0, Math.round(big.measureText(ch).width / N));
    const img = paintBig(f, ch, (adv + 4) * N);
    const hist = new Array(N).fill(0);
    for (let y = 0; y < img.h; y++) for (let x = 1; x < img.w; x++) hist[x % N] += Math.abs(img.a(x, y) - img.a(x - 1, y));
    const px = phaseOf(hist);
    // 原点に近い升目の線を選ぶ。半ドットずれた字は、いつも左の線にそろえる
    const d = px == null ? 0 : (((px - ORIGIN_X) % N) + N) % N;
    const left = d < N / 4 ? ORIGIN_X + d : ORIGIN_X + d - N;
    const top = topLineOf(fk);
    const mask = new Uint8Array(adv * f.rows);
    for (let r = 0; r < f.rows; r++) {
      const y = Math.floor(top + r * N + N / 2);
      if (y < 0 || y >= img.h) continue;
      for (let c = 0; c < adv; c++) {
        const x = Math.floor(left + c * N + N / 2);
        if (x >= 0 && x < img.w && img.a(x, y) >= 128) mask[r * adv + c] = 1;
      }
    }
    const g = { adv, mask };
    if (glyphReady(fk, ch) && topLine[fk] != null) glyphs.set(key, g);
    return g;
  }

  function fontKey(opts) {
    return opts.font === 'en' ? 'en' : 'jp';
  }

  function scaleOf(fk, opts) {
    const f = FONTS[fk];
    return Math.max(1, Math.round((opts.size || f.base) / f.base));
  }

  // 文字列をパレットの1色で塗った画像にする
  function sprite(str, fk, scale, color) {
    const key = fk + '|' + scale + '|' + color + '|' + str;
    const hit = strings.get(key);
    if (hit) return hit;
    const f = FONTS[fk];
    const list = Array.from(str).map((ch) => glyph(fk, ch));
    const w = Math.max(1, list.reduce((s, g) => s + g.adv, 0));
    const one = document.createElement('canvas');
    one.width = w;
    one.height = f.rows;
    const g1 = one.getContext('2d');
    const img = g1.createImageData(w, f.rows);
    const [r, gr, b] = RA.rgb(color);
    let x0 = 0;
    for (const g of list) {
      for (let y = 0; y < f.rows; y++) {
        for (let x = 0; x < g.adv; x++) {
          if (!g.mask[y * g.adv + x]) continue;
          const i = (y * w + x0 + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = gr;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
      x0 += g.adv;
    }
    g1.putImageData(img, 0, 0);
    let canvas = one;
    if (scale > 1) {
      canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = f.rows * scale;
      const gs = canvas.getContext('2d');
      gs.imageSmoothingEnabled = false;
      gs.drawImage(one, 0, 0, canvas.width, canvas.height);
    }
    const s = { canvas, w: w * scale };
    const ready = Array.from(str).every((ch) => glyphs.has(fk + '|' + ch));
    if (ready) {
      if (strings.size >= STRINGS_MAX) strings.delete(strings.keys().next().value);
      strings.set(key, s);
    }
    return s;
  }

  function widthOf(str, fk, scale) {
    return Array.from(str).reduce((s, ch) => s + glyph(fk, ch).adv, 0) * scale;
  }

  // 文字列の幅（ドット）
  RA.textWidth = function (str, opts) {
    opts = opts || {};
    const fk = fontKey(opts);
    return widthOf(String(str), fk, scaleOf(fk, opts));
  };

  /*
   * 文字を描いて幅を返す。(x, y) は字の枠の左上（16px の日本語なら字は y+1 から始まる）。
   * opts: font('jp'|'en'), size(基準の整数倍), color(パレット名), align('left'|'center'|'right'),
   *       shadow(パレット名: 右下1ドットに影), outline(パレット名: 上下左右1ドットのふち)
   */
  RA.text = function (ctx, str, x, y, opts) {
    opts = opts || {};
    str = String(str);
    const fk = fontKey(opts);
    const scale = scaleOf(fk, opts);
    const main = sprite(str, fk, scale, opts.color || 'cream');
    let left = Math.round(x);
    if (opts.align === 'center') left = Math.round(x - main.w / 2);
    else if (opts.align === 'right') left = Math.round(x - main.w);
    const top = Math.round(y);
    if (opts.outline) {
      const o = sprite(str, fk, scale, opts.outline).canvas;
      ctx.drawImage(o, left - 1, top);
      ctx.drawImage(o, left + 1, top);
      ctx.drawImage(o, left, top - 1);
      ctx.drawImage(o, left, top + 1);
    }
    if (opts.shadow) ctx.drawImage(sprite(str, fk, scale, opts.shadow).canvas, left + 1, top + 1);
    ctx.drawImage(main.canvas, left, top);
    return main.w;
  };

  function clearAll() {
    glyphs.clear();
    strings.clear();
    delete topLine.jp;
    delete topLine.en;
  }

  // 使う文字を先に読み込む。回線がなくても timeout ミリ秒で先へ進む
  RA.textReady = function (chars, timeout) {
    const fonts = document.fonts;
    if (!fonts || !fonts.load) return Promise.resolve();
    const jp = String(chars || '') + FONTS.jp.ref + '0123456789';
    const jobs = [fonts.load('16px ' + FONTS.jp.family, jp), fonts.load('8px ' + FONTS.en.family, FONTS.en.ref + 'HIJKLMNOPQRSTUVWXYZ!:/-.')];
    const wait = Promise.all(jobs).catch(() => {});
    const limit = new Promise((resolve) => setTimeout(resolve, timeout || 4000));
    return Promise.race([wait, limit]).then(clearAll);
  };

  if (document.fonts && document.fonts.addEventListener) {
    // 字形が新しく届いたら、それまでの代わりの字形で描いたものを捨てる
    document.fonts.addEventListener('loadingdone', clearAll);
  }

  // 漢数字（0 → 〇, 12 → 十二, 105 → 百五, 2026 → 二千二十六, 10000 → 一万）
  RA.kanjiNum = function (n) {
    n = Math.max(0, Math.floor(n));
    if (n === 0) return '〇';
    const D = '〇一二三四五六七八九';
    const under10k = (m) => {
      let s = '';
      [
        [1000, '千'],
        [100, '百'],
        [10, '十'],
      ].forEach(([unit, ch]) => {
        const d = Math.floor(m / unit) % 10;
        if (d) s += (d === 1 ? '' : D[d]) + ch;
      });
      const d = m % 10;
      if (d) s += D[d];
      return s;
    };
    let s = '';
    const oku = Math.floor(n / 1e8);
    const man = Math.floor(n / 1e4) % 1e4;
    const rest = n % 1e4;
    if (oku) s += under10k(oku) + '億';
    if (man) s += under10k(man) + '万';
    if (rest) s += under10k(rest);
    return s;
  };
})();
