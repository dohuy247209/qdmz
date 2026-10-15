/*
 * Quad Maze clone – Level format & parser.
 * Đơn vị toạ độ: "ô lưới" (cell) – 1 cell = cạnh của player square.
 * Gốc toạ độ: góc trên-trái của box, y tăng xuống dưới.
 */
(function (global) {
  'use strict';

  const LEVEL_FORMAT = 'quadmaze-level';
  const PACK_FORMAT = 'quadmaze-pack';
  const VERSION = 1;
  const MOTION_TYPES = ['static', 'horizontal', 'vertical', 'circle'];

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clampNum(v, lo, hi, def) {
    if (!isNum(v)) return def;
    return Math.min(hi, Math.max(lo, v));
  }

  function normalizeMotion(raw, errors, path) {
    const def = { type: 'static', distance: 0, speed: 2, phase: 0 };
    if (raw == null) return def;
    if (typeof raw !== 'object') {
      errors.push(path + '.motion phải là object');
      return def;
    }
    let type = typeof raw.type === 'string' ? raw.type.toLowerCase() : 'static';
    if (MOTION_TYPES.indexOf(type) === -1) {
      errors.push(path + '.motion.type không hợp lệ: "' + raw.type + '" (chấp nhận: ' + MOTION_TYPES.join(', ') + ')');
      type = 'static';
    }
    return {
      type: type,
      distance: clampNum(raw.distance, 0, 200, 0),
      speed: clampNum(raw.speed, 0, 50, 2),
      phase: isNum(raw.phase) ? raw.phase : 0
    };
  }

  function normalizeRect(raw, errors, path) {
    if (!raw || typeof raw !== 'object') {
      errors.push(path + ' phải là object {x,y,w,h}');
      return null;
    }
    return {
      x: clampNum(raw.x, -500, 500, 0),
      y: clampNum(raw.y, -500, 500, 0),
      w: clampNum(raw.w, 0.1, 500, 1),
      h: clampNum(raw.h, 0.1, 500, 1),
      rot: clampNum(raw.rot, -360, 360, 0), // độ, quay quanh tâm rect
      motion: normalizeMotion(raw.motion, errors, path)
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
    return {
      x: clampNum(raw.x, -500, 500, 0),
      y: clampNum(raw.y, -500, 500, 0),
      size: clampNum(raw.size, 0.25, 50, 1),
      spin: clampNum(spin, -720, 720, 90),
      motion: normalizeMotion(raw.motion, errors, path)
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
        w: Math.round(clampNum(boxRaw.w, 8, 300, 36)),
        h: Math.round(clampNum(boxRaw.h, 6, 200, 20))
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

  /** Level rỗng mặc định cho editor. */
  function makeDefaultLevel() {
    return {
      format: LEVEL_FORMAT,
      version: VERSION,
      name: 'Level mới',
      box: { w: 36, h: 20 },
      spawn: { x: 2, y: 17 },
      goal: { x: 32, y: 17 },
      checkpoints: [],
      walls: [
        { x: 0, y: 19, w: 36, h: 1, rot: 0, motion: { type: 'static', distance: 0, speed: 2, phase: 0 } }
      ],
      saws: []
    };
  }

  global.QMFormat = {
    LEVEL_FORMAT: LEVEL_FORMAT,
    PACK_FORMAT: PACK_FORMAT,
    VERSION: VERSION,
    MOTION_TYPES: MOTION_TYPES,
    parse: parse,
    parseAny: parseAny,
    stringify: stringify,
    stringifyPack: stringifyPack,
    normalizeLevel: normalizeLevel,
    makeDefaultLevel: makeDefaultLevel
  };
})(window);
