/*
 * Quad Maze – Cơ học dùng chung (game + editor) – QMMotion.
 *
 * ===== QUY TẮC VẬT LÝ (source of truth) =====
 * 1. Đơn vị: cell & giây; y tăng xuống dưới.
 * 2. "rotate" = góc TĨNH `rot` (độ) – đổi hướng, không tự dịch chuyển.
 *    "spin"   = quay THẬT theo thời gian quanh `pivot` (mặc định tâm rect,
 *               có thể đặt lệch/đầu mút). Vận tốc góc KHÔNG đổi (độ/giây),
 *               speed âm = ngược chiều. Đổi chiều TỨC THÌ, không gia tốc.
 * 3. "path"   = di chuyển trên polyline. Tốc độ KHÔNG đổi (cell/giây).
 *               mode pingpong: tới đầu đường ĐẢO NGAY (đổi vận tốc tức thì,
 *               không giảm dần). mode loop: khép kín (đoạn cuối nối đầu).
 *               phase (0..1) = vị trí ban đầu trên chu kỳ.
 *               points toạ độ trong frame REST của object chứa path
 *               (không attach = frame level; attach wall = frame rest của wall).
 * 4. "attach" = object con mang theo frame wall cha:
 *               world = parentWorld(t) ∘ local(t).
 *               Vì thế path của con di chuyển cùng wall cha (vd saw chạy trên
 *               cạnh của spinning wall). Luật chống vòng: chỉ attach wall có
 *               index < index của chính nó (parser đã enforce).
 * 5. Chỉ SQUARE (player) chịu trọng lực. Wall/saw là kinematic, KHÔNG rơi,
 *    KHÔNG chịu gia tốc trọng lực của player.
 * 6. Ma trận rigid {c,s,tx,ty}: p' = R(c,s)·p + t. mul(a,b) = a∘b (b chạy trước).
 */
(function (global) {
  'use strict';

  const DEG = Math.PI / 180;
  const STATIC = { type: 'static' };

  function mat(c, s, tx, ty) { return { c: c, s: s, tx: tx, ty: ty }; }
  function identity() { return mat(1, 0, 0, 0); }
  function translate(dx, dy) { return mat(1, 0, dx, dy); }

  // mul(a, b): áp b trước rồi a.
  function mul(a, b) {
    return mat(
      a.c * b.c - a.s * b.s,
      a.s * b.c + a.c * b.s,
      a.c * b.tx - a.s * b.ty + a.tx,
      a.s * b.tx + a.c * b.ty + a.ty
    );
  }

  // Quay `deg` quanh điểm (px, py).
  function rotAbout(deg, px, py) {
    const r = deg * DEG;
    const c = Math.cos(r), s = Math.sin(r);
    return mat(c, s, px - (c * px - s * py), py - (s * px + c * py));
  }

  function apply(m, x, y) {
    return { x: m.c * x - m.s * y + m.tx, y: m.s * x + m.c * y + m.ty };
  }

  // Nghịch đảo của ma trận rigid.
  function inv(m) {
    return mat(m.c, -m.s,
      -(m.c * m.tx + m.s * m.ty),
      m.s * m.tx - m.c * m.ty);
  }

  function angleOf(m) { return Math.atan2(m.s, m.c); }

  // -------- Path --------
  // Vị trí tâm object trên đường tại thời điểm t. (cx,cy) = tâm rest mặc định.
  function pathPos(m, t, cx, cy) {
    const pts = m.points;
    if (!pts || pts.length < 2) return { x: cx, y: cy };
    const loop = m.mode === 'loop';
    const n = pts.length;
    const segCount = loop ? n : n - 1;
    let total = 0;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (total <= 1e-9) return { x: cx, y: cy };
    const cycle = loop ? total : total * 2;
    let s = ((m.phase || 0) * cycle + (m.speed || 0) * t) % cycle;
    if (s < 0) s += cycle;
    if (!loop && s > total) s = cycle - s; // pingpong: phản xạ tại 2 đầu
    // Đi bộ trên đoạn tới param s (giả định quãng đường tiến về trước).
    let rem = s;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (rem <= len || i === segCount - 1) {
        const u = len > 1e-9 ? Math.min(rem / len, 1) : 0;
        return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u };
      }
      rem -= len;
    }
    return { x: pts[n - 1][0], y: pts[n - 1][1] };
  }

  // -------- Ma trận local của 1 object: rest -> frame cha --------
  // obj: {rot?, motion} ; (cx,cy) = tâm rest của object.
  function localMat(obj, cx, cy, t) {
    const m = obj.motion || STATIC;
    let theta = obj.rot || 0;
    let px = cx, py = cy;
    if (m.type === 'spin') {
      if (m.pivot) { px = m.pivot[0]; py = m.pivot[1]; }
      theta += (m.phase || 0) + (m.speed || 0) * t;
    }
    let out = rotAbout(theta, px, py);
    if (m.type === 'path') {
      const p = pathPos(m, t, cx, cy);
      const dx = p.x - cx, dy = p.y - cy;
      if (dx !== 0 || dy !== 0) out = mul(translate(dx, dy), out);
    }
    return out;
  }

  function parentMat(walls, idx) {
    if (idx === null || idx === undefined || !isFinite(idx)) return null;
    const i = idx | 0;
    if (i < 0 || i >= walls.length) return null;
    return walls[i];
  }

  // Ma trận WORLD cho mọi wall & saw tại thời điểm t.
  // Trả về {walls: [mat], saws: [mat]} – mat áp cho tâm/góc vẽ & va chạm.
  function resolve(level, t) {
    const walls = [], saws = [];
    for (let i = 0; i < level.walls.length; i++) {
      const w = level.walls[i];
      let m = localMat(w, w.x + w.w / 2, w.y + w.h / 2, t);
      const pm = parentMat(walls, w.attach);
      if (pm) m = mul(pm, m); // attach < i nên pm luôn có (parser enforce)
      walls.push(m);
    }
    for (let i = 0; i < level.saws.length; i++) {
      const s = level.saws[i];
      let m = localMat(s, s.x + s.size / 2, s.y + s.size / 2, t);
      const pm = parentMat(walls, s.attach);
      if (pm) m = mul(pm, m);
      saws.push(m);
    }
    return { walls: walls, saws: saws };
  }

  // Thế giới nghỉ (t = 0) – editor dùng để vẽ pose khởi điểm.
  function resolveRest(level) { return resolve(level, 0); }

  global.QMMotion = {
    DEG: DEG,
    mat: mat,
    identity: identity,
    translate: translate,
    mul: mul,
    rotAbout: rotAbout,
    apply: apply,
    inv: inv,
    angleOf: angleOf,
    pathPos: pathPos,
    localMat: localMat,
    resolve: resolve,
    resolveRest: resolveRest
  };
})(window);
