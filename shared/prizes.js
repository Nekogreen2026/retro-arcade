/*
 * UFOキャッチャー（にゃんキャッチャー）の景品。ゲームと店内の景品棚で共通。
 *   RA.Prizes.TYPES       … 景品の種類（9×8 のドット絵、重さ、出やすさ）
 *   RA.Prizes.load()      … 取った数 { 種類ID: 数 }
 *   RA.Prizes.save(counts)
 *   RA.Prizes.draw(ctx, id, cx, cy, scale, silhouette) … (cx, cy) を中心に描く。silhouette なら影の色だけで
 */
(function () {
  'use strict';
  const RA = window.RA;
  const P = RA.P;
  const KEY = ['ufo', 'prizes'];

  // weight が重いほどつかみにくく、落としやすい。rate は山に出てくる割合
  const TYPES = [
    {
      id: 'neko', name: '猫天使', weight: 0.25, rate: 3,
      art: ['..ggggg..', '.o.....o.', '.oo...oo.', '.ooooooo.', 'ookoookoo', 'oooopoooo', '.ooooooo.', '..ooooo..'],
      colors: { o: 'cream', k: 'ink', p: 'pink', g: 'gold' },
    },
    {
      id: 'kinoko', name: '茶きのこ', weight: 0.4, rate: 3,
      art: ['.........', '..rrrrr..', '.rrwrrrr.', 'rrrrrrwrr', 'rwrrrrrrr', '..ccccc..', '..c.c.c..', '..ccccc..'],
      colors: { r: 'brown', w: 'cream', c: 'cream' },
    },
    {
      id: 'midori', name: '緑きのこ', weight: 0.4, rate: 2,
      art: ['.........', '..rrrrr..', '.rrwrrrr.', 'rrrrrrwrr', 'rwrrrrrrr', '..ccccc..', '..c.c.c..', '..ccccc..'],
      colors: { r: 'green', w: 'white', c: 'cream' },
    },
    {
      id: 'same', name: 'サメ', weight: 0.6, rate: 2,
      art: ['....s....', '...ss....', '.sssssss.', 'sksssssss', 'srwrwrwss', 'swrwrwrss', '.sssssss.', '..s...s..'],
      colors: { s: 'mist', k: 'ink', r: 'red', w: 'white' },
    },
    {
      id: 'nazo', name: 'あの子', weight: 0.75, rate: 1,
      art: ['......k..', '.onononk.', 'onccccnon', 'nwkwcwkwn', 'nccccccco', 'onccrccno', '.o.bbb.n.', '...bbb...'],
      colors: { o: 'orange', n: 'brown', c: 'cream', w: 'white', k: 'ink', r: 'maroon', b: 'blue' },
    },
  ];
  const BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  function load() {
    try {
      const v = JSON.parse(RA.Store.get(KEY, '{}'));
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }

  function save(counts) {
    RA.Store.set(KEY, JSON.stringify(counts));
  }

  function draw(ctx, id, cx, cy, s, silhouette) {
    const t = BY_ID[id];
    if (!t) return;
    const w = t.art[0].length;
    const h = t.art.length;
    const x0 = Math.round(cx - (w * s) / 2);
    const y0 = Math.round(cy - (h * s) / 2);
    t.art.forEach((row, yy) => {
      for (let xx = 0; xx < w; xx++) {
        const c = t.colors[row[xx]];
        if (!c) continue;
        ctx.fillStyle = P[silhouette || c];
        ctx.fillRect(x0 + xx * s, y0 + yy * s, s, s);
      }
    });
  }

  RA.Prizes = { TYPES, BY_ID, load, save, draw };
})();
