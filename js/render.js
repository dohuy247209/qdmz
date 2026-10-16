/*
 * Quad Maze clone – Rendering helpers (canvas 2D).
 * Bao gồm: nền sọc đỏ chéo, wall trắng, gear saw (2 vuông chồng xoay),
 * square marker (spawn/goal/checkpoint), HUD text viền đậm.
 */
(function (global) {
  'use strict';

  const COLORS = {
    bgA: '#e8483f',      // đỏ đậm – sọc chéo
    bgB: '#f2635b',      // đỏ nhạt – sọc chéo xen kẽ
    wall: '#ffffff',
    player: '#ffffff',
    marker: '#26262a',   // spawn / goal / checkpoint (dark square)
    saw: '#1d1d20',      // saw đen
    editorBg: '#232327',
    grid: 'rgba(255,255,255,0.07)',
    gridMajor: 'rgba(255,255,255,0.16)',
    select: '#ffd54a'
  };

  /**
   * Tính transform vừa khít (letterbox) cho 1 box (đơn vị cell) trong vùng (vw x vh).
   * Trả về {scale, ox, oy} – pixel = ox + cell * scale.
   */
  function viewTransform(vw, vh, boxW, boxH) {
    const scale = Math.min(vw / boxW, vh / boxH);
    return {
      scale: scale,
      ox: Math.round((vw - boxW * scale) / 2),
      oy: Math.round((vh - boxH * scale) / 2)
    };
  }

  /** Vẽ nền sọc đỏ chéo 45° (↗) lấp đầy rect pixel đã cho. */
  function drawStripes(ctx, x, y, w, h, cellPx) {
    if (w <= 0 || h <= 0) return;
    const band = Math.max(10, cellPx * 1.5); // bề rộng mỗi cặp sọc
    const diag = Math.hypot(w, h) + band;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = COLORS.bgA;
    ctx.fillRect(-diag, -diag, diag * 2, diag * 2);
    ctx.fillStyle = COLORS.bgB;
    for (let vx = -diag; vx < diag; vx += band) {
      ctx.fillRect(vx, -diag, band / 2, diag * 2);
    }
    ctx.restore();
  }

  /** Rect (đơn vị cell, có thể xoay quanh tâm) -> fill trắng. */
  function drawWallRect(ctx, r, vt) {
    drawWallXf(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h,
               (r.rot || 0) * Math.PI / 180, vt);
  }

  /**
   * Vẽ wall theo transform WORLD: tâm (cx,cy) đơn vị cell + góc (radian).
   * Dùng cho wall có motion/attach (game) và pose t=0 (editor).
   */
  function drawWallXf(ctx, cx, cy, w, h, angleRad, vt) {
    const px = vt.ox + cx * vt.scale;
    const py = vt.oy + cy * vt.scale;
    ctx.save();
    ctx.translate(px, py);
    if (angleRad) ctx.rotate(angleRad);
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(-w * vt.scale / 2, -h * vt.scale / 2,
      Math.max(1, w * vt.scale), Math.max(1, h * vt.scale));
    ctx.restore();
  }

  /** Gear saw: 2 hình vuông chồng lên nhau (một xoay thêm 45°), luôn xoay. */
  function drawSaw(ctx, cx, cy, sizePx, angle) {
    const h = sizePx / 2;
    ctx.fillStyle = COLORS.saw;
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle + i * Math.PI / 4);
      ctx.fillRect(-h, -h, sizePx, sizePx);
      ctx.restore();
    }
  }

  /** Square marker đặc (spawn/goal/checkpoint). */
  function drawMarker(ctx, x, y, sizePx, color) {
    ctx.fillStyle = color || COLORS.marker;
    ctx.fillRect(x, y, sizePx, sizePx);
  }

  /** Text HUD kiểu game: fill trắng + viền đậm. */
  function drawLabel(ctx, text, x, y, sizePx, align, baseline) {
    ctx.font = 'bold ' + Math.round(sizePx) + 'px "Arial Black", "Segoe UI", Impact, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = baseline || 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, sizePx * 0.16);
    ctx.strokeStyle = '#33333a';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  }

  /** Vẽ lưới editor (cellPx = px/1cell, w/h theo cell).
   *  Khi fit sandbox rất lớn (cellPx < 6) chỉ vẽ đường major (25 ô) cho khỏi nhiễu. */
  function drawGrid(ctx, x, y, w, h, cellPx) {
    const showMinor = cellPx >= 6;
    const major = cellPx < 6 ? 25 : 5;
    ctx.save();
    ctx.lineWidth = 1;
    for (let vx = 0; vx <= w; vx++) {
      if (!showMinor && vx % major !== 0) continue;
      ctx.strokeStyle = (vx % major === 0) ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x + vx * cellPx) + 0.5, y);
      ctx.lineTo(Math.round(x + vx * cellPx) + 0.5, y + h * cellPx);
      ctx.stroke();
    }
    for (let vy = 0; vy <= h; vy++) {
      if (!showMinor && vy % major !== 0) continue;
      ctx.strokeStyle = (vy % major === 0) ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(y + vy * cellPx) + 0.5);
      ctx.lineTo(x + w * cellPx, Math.round(y + vy * cellPx) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  global.QMRender = {
    COLORS: COLORS,
    viewTransform: viewTransform,
    drawStripes: drawStripes,
    drawWallRect: drawWallRect,
    drawWallXf: drawWallXf,
    drawSaw: drawSaw,
    drawMarker: drawMarker,
    drawLabel: drawLabel,
    drawGrid: drawGrid
  };
})(window);
// __APPEND__
