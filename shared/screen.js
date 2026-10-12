/*
 * 256×240 の画面。端末のピクセル単位で整数倍に拡大し、比率を保って中央に置く。
 * あわせてゲーム画面でのダブルタップ拡大・長押しメニュー・スクロールを止める。
 */
(function () {
  'use strict';
  const RA = window.RA;
  const W = (RA.W = 256);
  const H = (RA.H = 240);

  let fitted = null;

  function fit() {
    if (!fitted) return;
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 端末ピクセルで整数倍にすると、拡大後のドットの大きさが全部そろう
    let k = Math.floor(Math.min((vw * dpr) / W, (vh * dpr) / H));
    if (k < 1) k = Math.min((vw * dpr) / W, (vh * dpr) / H); // 極端に小さい窓だけは収まる大きさで
    fitted.style.width = (W * k) / dpr + 'px';
    fitted.style.height = (H * k) / dpr + 'px';
  }

  function blockGestures() {
    const stop = (e) => e.preventDefault();
    document.addEventListener('contextmenu', stop);
    document.addEventListener('selectstart', (e) => {
      if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault(); // コピー用の textarea だけは選択を許す
    });
    document.addEventListener('dblclick', stop);
    document.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('gesturestart', stop); // iOS のピンチ
    document.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  }

  // canvas を 256×240 の画面として準備し、描画コンテキストを返す
  RA.setupScreen = function (canvas) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    fitted = canvas;
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
    blockGestures();
    return ctx;
  };

  // 毎フレーム fn(ts) を呼ぶ。ts は requestAnimationFrame の時刻（performance.now と同じ基準）
  RA.loop = function (fn) {
    const frame = (ts) => {
      fn(ts);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  // スマホ（指で操作する端末）かどうか。記録の「部」分けなどに使う
  RA.isMobile = function () {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  };
})();
