/*
 * 入力。タップ／クリックは pointerdown で即時に判定する（click は使わない）。
 * 座標は 256×240 の画面座標に直して渡す。キーボードは押した瞬間だけ（押しっぱなしの連射は無視）。
 */
(function () {
  'use strict';
  const RA = window.RA;

  // 既定動作（スクロールなど）を止めるキー
  const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace']);

  // 入力が起きた時刻。requestAnimationFrame の ts と同じ基準（performance.now）にそろえる
  RA.eventTime = function (e) {
    const now = performance.now();
    const t = e.timeStamp;
    return t > 0 && t <= now + 1 && now - t < 1000 ? t : now;
  };

  /*
   * handlers:
   *   press(ev) … 押した瞬間。ev = { kind: 'pointer', x, y, t, pointerType, pointerId }
   *   move(ev)  … マウスの移動（ホバー用）。ev = { x, y }
   *   key(ev)   … キーを押した瞬間。ev = { kind: 'key', code, key, t }
   */
  RA.bindInput = function (canvas, handlers) {
    const toScreen = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) * RA.W) / r.width,
        y: ((e.clientY - r.top) * RA.H) / r.height,
      };
    };

    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = toScreen(e);
      if (handlers.press) {
        handlers.press({
          kind: 'pointer',
          x: p.x,
          y: p.y,
          t: RA.eventTime(e),
          pointerType: e.pointerType,
          pointerId: e.pointerId,
        });
      }
    });

    if (handlers.move) {
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        handlers.move(toScreen(e));
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat || e.isComposing) return;
      if (handlers.key) handlers.key({ kind: 'key', code: e.code, key: e.key, t: RA.eventTime(e) });
    });
  };

  /*
   * Web Share・クリップボードなど「ユーザー操作による有効化」が要るAPIを呼ぶ。
   * 判定は pointerdown で済ませ、実行だけを有効化が得られる時点に合わせる:
   *   キー入力・マウス … その場で実行
   *   タッチ          … 同じ操作の touchend で実行（タッチの pointerdown は有効化にならない）
   *   ペンなど        … 同じポインタの pointerup で実行
   */
  const pending = [];
  const hasTouchEvents = 'ontouchend' in window;

  RA.withActivation = function (ev, fn) {
    if (ev.kind === 'key' || ev.pointerType === 'mouse') {
      fn();
      return;
    }
    pending.push({ id: ev.pointerId, touch: ev.pointerType === 'touch', fn });
  };

  function run(match) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (match(pending[i])) {
        const p = pending.splice(i, 1)[0];
        p.fn();
      }
    }
  }

  window.addEventListener('pointerup', (e) => {
    run((p) => p.id === e.pointerId && (!p.touch || !hasTouchEvents));
  });
  window.addEventListener('touchend', () => run((p) => p.touch));
  window.addEventListener('pointercancel', (e) => {
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].id === e.pointerId) pending.splice(i, 1);
  });
})();
