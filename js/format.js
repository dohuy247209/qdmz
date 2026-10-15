/*
 * Quad Maze clone – Level format & parser.
 * Đơn vị toạ độ: "ô lưới" (cell) – 1 cell = cạnh của player square.
 * Gốc toạ độ: góc trên-trái của box, y tăng xuống dưới.
 */
(function (global) {
  'use strict';

  const LEVEL_FORMAT = 'quadmaze-level';
  const PACK_FORMAT = 'quadmaze-pack';
  const VERSION = 2;
  // Motion chuẩn hóa (v2): static | path (đường polyline, tốc độ không đổi) |
  // spin (quay quanh pivot, vận tốc góc không đổi).
  const MOTION_TYPES = ['static', 'path', 'spin'];
  const PATH_MODES = ['pingpong', 'loop'];

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clampNum(v, lo, hi, def) {
    if (!isNum(v)) return def;
    return Math.min(hi, Math.max(lo, v));
  }

  // Motion "nghỉ" – không di chuyển.
  function staticMotion() {
    return { type: 'static', points: null, mode: 'pingpong', speed: 0, phase: 0, pivot: null };
  }

  function isPair(v) {
    return Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);
  }

  // Tạo bộ points dạng vòng tròn N đoạn (chuyển đổi legacy 'circle' -> path loop).
  function circlePoints(cx, cy, r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  /**
   * Chuẩn hóa motion về dạng v2. (cx,cy) = tâm rest của object – cần cho
   * các type legacy v1 (horizontal/vertical/circle) tự chuyển thành path.
   * Tốc độ path: cell/giây; spin: độ/giây; KHÔNG gia tốc (đổi hướng tức thì).
   */
  function normalizeMotion(raw, errors, path, cx, cy) {
    if (raw == null) return staticMotion();
    if (typeof raw !== 'object') {
      errors.push(path + '.motion phải là object');
      return staticMotion();
    }
    let type = typeof raw.type === 'string' ? raw.type.toLowerCase() : 'static';

    // ---- Legacy v1 -> v2 ----
    if (type === 'horizontal' || type === 'vertical') {
      const d = clampNum(raw.distance, 0, 200, 0);
      const f = clampNum(raw.speed, 0, 50, 1);
      const p = isNum(raw.phase) ? raw.phase : 0;
      if (d <= 0 || !isNum(cx)) return staticMotion();
      // sin(2pi(f t+p)) có chu kỳ 1/f, quãng 2d mỗi nửa chu kỳ -> tam giác
      // cùng quãng & tần số: tốc độ = 4*d*f (đảo ngay tại 2 đầu).
      const pts = type === 'horizontal'
        ? [[cx - d, cy], [cx + d, cy]]
        : [[cx, cy - d], [cx, cy + d]];
      return {
        type: 'path',
        points: pts,
        mode: 'pingpong',
        speed: 4 * d * f,
        phase: clampNum((Math.sin(Math.PI * 2 * p) + 1) / 2, 0, 1, 0),
        pivot: null
      };
    }
    if (type === 'circle') {
      const d = clampNum(raw.distance, 0, 200, 0);
      const f = clampNum(raw.speed, 0, 50, 1);
      const p = isNum(raw.phase) ? raw.phase : 0;
      if (d <= 0 || !isNum(cx)) return staticMotion();
      return {
        type: 'path',
        points: circlePoints(cx, cy, d, 20),
        mode: 'loop',
        speed: Math.PI * 2 * d * f, // chu vi * tần số
        phase: p - Math.floor(p),
        pivot: null
      };
    }

    if (MOTION_TYPES.indexOf(type) === -1) {
      errors.push(path + '.motion.type không hợp lệ: "' + raw.type + '" (chấp nhận: ' + MOTION_TYPES.join(', ') + ')');
      type = 'static';
    }

    if (type === 'path') {
      let points = null;
      if (raw.points != null) {
        if (!Array.isArray(raw.points)) {
          errors.push(path + '.motion.points phải là mảng [[x,y],...]');
        } else {
          points = [];
          for (let i = 0; i < raw.points.length; i++) {
            const p = raw.points[i];
            if (!isPair(p)) {
              errors.push(path + '.motion.points[' + i + '] không phải [x,y]');
              points = null;
              break;
            }
            points.push([p[0], p[1]]);
          }
          if (points && points.length < 2) {
            errors.push(path + '.motion.points cần ít nhất 2 điểm');
            points = null;
          }
        }
      }
      if (!points) {
        // Fallback: đường ngang +/-2 ô qua tâm (để level vẫn chơi được).
        if (!isNum(cx)) return staticMotion();
        points = [[cx - 2, cy], [cx + 2, cy]];
      }
      const mode = PATH_MODES.indexOf(raw.mode) !== -1 ? raw.mode : 'pingpong';
      if (raw.mode != null && mode !== raw.mode) {
        errors.push(path + '.motion.mode không hợp lệ (chấp nhận: ' + PATH_MODES.join(', ') + ')');
      }
      return {
        type: 'path',
        points: points,
        mode: mode,
        speed: clampNum(raw.speed, -200, 200, 4), // cell/giây (âm = đi ngược)
        phase: clampNum(raw.phase, -10, 10, 0),
        pivot: null
      };
    }

    if (type === 'spin') {
      return {
        type: 'spin',
        points: null,
        mode: 'pingpong',
        speed: clampNum(raw.speed, -1080, 1080, 90), // độ/giây (âm = ngược)
        phase: clampNum(raw.phase, -36000, 36000, 0), // độ
        pivot: isPair(raw.pivot) ? [raw.pivot[0], raw.pivot[1]] : null // null = tâm rect
      };
    }

    return staticMotion();
  }

  // Attach: số nguyên index của wall cha (phải < index của object – chống vòng).
  function normalizeAttach(raw, errors, path) {
    if (raw == null) return null;
    if (typeof raw !== 'number' || !isFinite(raw) || Math.floor(raw) !== raw || raw < 0) {
      errors.push(path + '.attach phải là số nguyên >= 0 (index wall cha)');
      return null;
    }
    return raw;
  }

  function normalizeRect(raw, errors, path) {
    if (!raw || typeof raw !== 'object') {
      errors.push(path + ' phải là object {x,y,w,h}');
      return null;
    }
    return {
      x: clampNum(raw.x, -1000, 1000, 0),
      y: clampNum(raw.y, -1000, 1000, 0),
      w: clampNum(raw.w, 0.1, 1000, 1),
      h: clampNum(raw.h, 0.1, 1000, 1),
      rot: clampNum(raw.rot, -360, 360, 0), // rotate TĨNH, độ, quay quanh tâm rect
      motion: normalizeMotion(raw.motion, errors, path,
        clampNum(raw.x, -1000, 1000, 0) + clampNum(raw.w, 0.1, 1000, 1) / 2,
        clampNum(raw.y, -1000, 1000, 0) + clampNum(raw.h, 0.1, 1000, 1) / 2),
      attach: normalizeAttach(raw.attach, errors, path) // index wall cha (null = độc lập)
    };
  }

  // Square 1x1 (spawn/goal/checkpoint): {x,y} là góc trên-trái.
  function normalizeSquare(raw, errors, path) {
    if (!raw || typeof raw !== 'object') {
      errors.push(path + ' phải là object {x,y}');
      return null;
    }
    return {
      x: clampNum(raw.x, -500, 500, 0),
      y: clampNum(raw.y, -500, 500, 0)
    };
  }

  function normalizeSaw(raw, errors, path) {
    if (!raw || typeof raw !== 'object') {
      errors.push(path + ' phải là object {x,y,size,spin?}');
      return null;
    }
    let spin = isNum(raw.spin) ? raw.spin : 90; // độ/giây, luôn != 0
    if (spin === 0) {
      errors.push(path + '.spin = 0 -> đặt lại 90 (saw luôn xoay)');
      spin = 90;
    }
    const x = clampNum(raw.x, -1000, 1000, 0);
    const y = clampNum(raw.y, -1000, 1000, 0);
    const size = clampNum(raw.size, 0.25, 100, 1);
    return {
      x: x,
      y: y,
      size: size,
      spin: clampNum(spin, -1080, 1080, 90), // xoay răng cưa, độ/giây (visual)
      motion: normalizeMotion(raw.motion, errors, path, x + size / 2, y + size / 2),
      attach: normalizeAttach(raw.attach, errors, path) // index wall cha (null = độc lập)
    };
  }

  function normalizeLevel(raw, errors) {
    if (!raw || typeof raw !== 'object') {
      errors.push('Level phải là một object JSON');
      return null;
    }
    if (raw.format !== undefined && raw.format !== LEVEL_FORMAT) {
      errors.push('format không khớp "' + LEVEL_FORMAT + '" (nhận: "' + raw.format + '") – vẫn thử parse');
    }
    const boxRaw = (raw.box && typeof raw.box === 'object') ? raw.box : {};
    const level = {
      format: LEVEL_FORMAT,
      version: VERSION,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Untitled',
      box: {
        w: Math.round(clampNum(boxRaw.w, 8, 600, 64)), // sandbox lớn: tới 600 ô
        h: Math.round(clampNum(boxRaw.h, 6, 400, 36))
      },
      spawn: null,
      goal: null,
      checkpoints: [],
      walls: [],
      saws: []
    };

    level.spawn = normalizeSquare(raw.spawn, errors, 'spawn') || { x: 2, y: level.box.h - 3 };
    level.goal = normalizeSquare(raw.goal, errors, 'goal') || { x: level.box.w - 3, y: level.box.h - 3 };

    [['checkpoints', normalizeSquare], ['walls', normalizeRect], ['saws', normalizeSaw]]
      .forEach(function (pair) {
        const key = pair[0], fn = pair[1];
        const arr = raw[key];
        if (arr == null) return;
        if (!Array.isArray(arr)) { errors.push(key + ' phải là mảng'); return; }
        arr.forEach(function (item, i) {
          const norm = fn(item, errors, key + '[' + i + ']');
          if (norm) level[key].push(norm);
        });
      });

    if (!level.walls.length) {
      errors.push('Level không có wall nào – thêm tường nền/đường đi trong editor');
    }

    // ---- Validate attach (sau khi đã build xong 2 mảng; walls trước saws) ----
    level.walls.forEach(function (w, i) {
      if (w.attach == null) return;
      // Chặn vòng: wall chỉ được attach vào wall index nhỏ hơn mình.
      if (w.attach >= i) {
        errors.push('walls[' + i + '].attach=' + w.attach + ' phải trỏ tới wall có index nhỏ hơn (chống vòng lặp)');
        w.attach = null;
      }
    });
    level.saws.forEach(function (s, i) {
      if (s.attach == null) return;
      if (s.attach >= level.walls.length) {
        errors.push('saws[' + i + '].attach=' + s.attach + ' không tồn tại (walls có ' + level.walls.length + ')');
        s.attach = null;
      }
    });

    return level;
  }

  function tryParseJSON(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  /** Parse một chuỗi JSON thành MỘT level. Trả về {ok, level, errors}. */
  function parse(text) {
    const j = tryParseJSON(text);
    if (!j.ok) return { ok: false, level: null, errors: ['JSON lỗi: ' + j.error] };
    const errors = [];
    let raw = j.value;
    if (raw && raw.format === PACK_FORMAT && Array.isArray(raw.levels) && raw.levels.length) {
      raw = raw.levels[0];
    }
    const level = normalizeLevel(raw, errors);
    return { ok: !!level, level: level, errors: errors };
  }

  /**
   * Parse chuỗi JSON thành MỘT hoặc NHIỀU level (hỗ trợ single & pack).
   * Trả về {ok, levels, errors}.
   */
  function parseAny(text) {
    const j = tryParseJSON(text);
    if (!j.ok) return { ok: false, levels: [], errors: ['JSON lỗi: ' + j.error] };
    const errors = [];
    const raws = (j.value && j.value.format === PACK_FORMAT && Array.isArray(j.value.levels))
      ? j.value.levels : [j.value];
    if (!raws.length) return { ok: false, levels: [], errors: ['Pack rỗng – không có level nào'] };
    const levels = [];
    raws.forEach(function (raw, i) {
      const prefixErrors = [];
      const level = normalizeLevel(raw, prefixErrors);
      prefixErrors.forEach(function (e) { errors.push('level ' + (i + 1) + ': ' + e); });
      if (level) levels.push(level);
    });
    return { ok: levels.length > 0, levels: levels, errors: errors };
  }

  /** Serialize một level ra chuỗi JSON (pretty). */
  function stringify(level, pretty) {
    const norm = normalizeLevel(level, []);
    return JSON.stringify(norm, null, pretty === false ? 0 : 2);
  }

  /** Serialize nhiều level thành pack. */
  function stringifyPack(levels, name, pretty) {
    const errors = [];
    const norms = levels.map(function (lv) { return normalizeLevel(lv, errors); }).filter(Boolean);
    return JSON.stringify({
      format: PACK_FORMAT,
      version: VERSION,
      name: typeof name === 'string' ? name : 'My Pack',
      levels: norms
    }, null, pretty === false ? 0 : 2);
  }

  /**
   * Level rỗng mặc định cho editor – sandbox RỘNG 512x288 (custom, ~8x cũ:
   * đủ chỗ xây level lớn; ô grid/viewport vẫn fit bằng phím 0).
   */
  function makeDefaultLevel() {
    return {
      format: LEVEL_FORMAT,
      version: VERSION,
      name: 'Level mới',
      box: { w: 512, h: 288 },
      spawn: { x: 2, y: 283 },
      goal: { x: 506, y: 283 },
      checkpoints: [],
      walls: [
        { x: 0, y: 284, w: 512, h: 4, rot: 0, motion: staticMotion(), attach: null }
      ],
      saws: []
    };
  }

  global.QMFormat = {
    LEVEL_FORMAT: LEVEL_FORMAT,
    PACK_FORMAT: PACK_FORMAT,
    VERSION: VERSION,
    MOTION_TYPES: MOTION_TYPES,
    PATH_MODES: PATH_MODES,
    staticMotion: staticMotion,
    parse: parse,
    parseAny: parseAny,
    stringify: stringify,
    stringifyPack: stringifyPack,
    normalizeLevel: normalizeLevel,
    makeDefaultLevel: makeDefaultLevel
  };
})(window);
