/*
 * ういろう肥料の所持数と、肥料袋の絵（トップページのういろう屋のクイズでもらい、菌糸ライフで使う）。
 * 保存は retro-arcade:kinshi:fertilizer。別のタブで増減しても食い違わないよう、毎回保存から読む。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const KEY = ['kinshi', 'fertilizer'];
  const MAX = 99;

  function count() {
    const n = RA.Store.getNumber(KEY, 0);
    return Number.isInteger(n) && n > 0 ? Math.min(MAX, n) : 0;
  }

  // 肥料袋の絵（12×14 ドット。紐で口を縛った袋に、ういろうの渦の札）
  const ICON = [
    '....kkkk....',
    '...kcwcck...',
    '....krrk....',
    '...kcccck...',
    '..kcccccck..',
    '.kcccccccck.',
    '.kccppppcck.',
    'kccpwwwppcsk',
    'kccpwppwpcsk',
    'kccpwpwwpcsk',
    'kcccppppccsk',
    'kscccccccssk',
    '.kssccccssk.',
    '..kkkkkkkk..',
  ];
  const ICON_COLORS = { k: 'ink', c: 'cream', w: 'white', r: 'red', p: 'pink', s: 'silver' };

  // (x, y) を左上に、s 倍で描く
  function icon(ctx, x, y, s) {
    s = s || 1;
    ICON.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = ICON_COLORS[row[i]];
        if (!c) continue;
        ctx.fillStyle = RA.P[c];
        ctx.fillRect(x + i * s, y + j * s, s, s);
      }
    });
  }

  RA.Fertilizer = {
    MAX,
    ICON_W: 12,
    ICON_H: 14,
    icon,
    count,
    // n 個増やして、増えたあとの数を返す
    add(n) {
      const v = Math.min(MAX, count() + (n || 1));
      RA.Store.set(KEY, v);
      return v;
    },
    // 1個使う。なければ false
    take() {
      const v = count();
      if (v <= 0) return false;
      RA.Store.set(KEY, v - 1);
      return true;
    },
  };
})();
