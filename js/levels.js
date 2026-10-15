/*
 * Quad Maze clone – Level built-in.
 * Mỗi level là object theo QMFormat (xem format.js).
 * Mẹo thiết kế: độ cao nhảy ~3.7 ô, bay ngang ~7 ô, multijump khi gần wall.
 */
(function (global) {
  'use strict';

  function wall(x, y, w, h, rot, motion) {
    return { x: x, y: y, w: w, h: h, rot: rot || 0, motion: motion || { type: 'static', distance: 0, speed: 2, phase: 0 } };
  }
  function saw(x, y, size, spin, motion) {
    return { x: x, y: y, size: size || 1.4, spin: spin || 90, motion: motion || { type: 'static', distance: 0, speed: 2, phase: 0 } };
  }
  function mot(type, distance, speed, phase) {
    return { type: type, distance: distance, speed: speed || 0.5, phase: phase || 0 };
  }

  const LEVELS = [
    // 1-1: làm quen – đi thẳng, nhảy qua khe saw.
    {
      name: '1-1',
      box: { w: 36, h: 20 },
      spawn: { x: 2, y: 17 },
      goal: { x: 32, y: 17 },
      checkpoints: [{ x: 18, y: 17 }],
      walls: [
        wall(0, 18, 36, 2),        // sàn
        wall(10, 15, 4, 1),        // bậc nhảy
        wall(24, 14, 5, 1)
      ],
      saws: [
        saw(15.5, 17, 1.6, 120)
      ]
    },

    // 1-2:平台 – trèo lên bằng nhiều nhảy, có wall dọc để multijump.
    {
      name: '1-2',
      box: { w: 36, h: 20 },
      spawn: { x: 2, y: 17 },
      goal: { x: 30, y: 4 },
      checkpoints: [{ x: 16, y: 12 }],
      walls: [
        wall(0, 18, 36, 2),
        wall(8, 14, 5, 1),
        wall(14, 8, 1, 6),         // tường dọc – multijump dính tường
        wall(20, 11, 6, 1),
        wall(27, 6, 6, 1),
        wall(33, 0, 1, 20)         // tường phải
      ],
      saws: [
        saw(25, 17, 1.6, 90),
        saw(31.5, 5.2, 1.4, -120)
      ]
    },

    // 2-1: tường xoay 45° – hình chữ V như ảnh.
    {
      name: '2-1',
      box: { w: 36, h: 20 },
      spawn: { x: 3, y: 17 },
      goal: { x: 32, y: 17 },
      checkpoints: [{ x: 17, y: 17 }],
      walls: [
        wall(0, 18, 36, 2),
        wall(6, 10, 12, 1.4, 45),   // vệt chéo xuống
        wall(14, 14.5, 12, 1.4, -45), // vệt chéo lên – tạo V
        wall(27, 9, 8, 1.4, 45),
        wall(33, 0, 1, 20)
      ],
      saws: [
        saw(14.2, 13.1, 1.8, 150),
        saw(8, 16.8, 1.5, -90)
      ]
    },

    // 3-1: wall chuyển động – platform trượt ngang.
    {
      name: '3-1',
      box: { w: 36, h: 20 },
      spawn: { x: 2, y: 17 },
      goal: { x: 32, y: 4 },
      checkpoints: [{ x: 17, y: 9 }],
      walls: [
        wall(0, 18, 8, 2),
        wall(28, 18, 8, 2),
        wall(10, 14, 5, 1, 0, mot('horizontal', 3, 0.4)),
        wall(18, 10, 5, 1, 0, mot('horizontal', 4, 0.3, 0.25)),
        wall(26, 6, 5, 1, 0, mot('vertical', 2, 0.5)),
        wall(31, 3, 5, 1)
      ],
      saws: [
        saw(17, 17, 1.8, 120, mot('horizontal', 5, 0.35)),
        saw(8, 8, 1.6, 90, mot('circle', 3, 0.3))
      ]
    },

    // 4-1: saw tròn – saw chuyển động theo quỹ đạo.
    {
      name: '4-1',
      box: { w: 36, h: 20 },
      spawn: { x: 2, y: 17 },
      goal: { x: 32, y: 17 },
      checkpoints: [{ x: 12, y: 17 }, { x: 24, y: 17 }],
      walls: [
        wall(0, 18, 36, 2),
        wall(6, 13, 6, 1),
        wall(16, 11, 5, 1),
        wall(24, 13, 6, 1),
        wall(18, 0, 1, 6)
      ],
      saws: [
        saw(9, 16, 1.7, 180, mot('vertical', 2.5, 0.6)),
        saw(20, 15.5, 2, -140, mot('horizontal', 4, 0.5)),
        saw(29, 15, 1.6, 200, mot('vertical', 3, 0.4, 0.5))
      ]
    },

    // 6-5: tổng hợp – như ảnh: khe chữ V hẹp, saw lớn giữa đường.
    {
      name: '6-5',
      box: { w: 36, h: 20 },
      spawn: { x: 4, y: 17 },
      goal: { x: 32, y: 17 },
      checkpoints: [{ x: 18, y: 16 }],
      walls: [
        wall(0, 18, 36, 2),
        wall(2, 6, 14, 1.6, 45),      // chéo dài bên trái
        wall(12, 12, 14, 1.6, -45),   // tạo chân chữ V
        wall(24, 5, 14, 1.6, 45),
        wall(30, 10, 10, 1.4, -45),
        wall(35, 0, 1, 20)
      ],
      saws: [
        saw(13.5, 11.5, 2, 160),
        saw(6, 16.8, 1.5, -120),
        saw(27, 16.7, 1.7, 130)
      ]
    }
  ];

  // Chuẩn hóa qua parser để chắc chắn đúng format.
  global.QMLevels = {
    list: LEVELS.map(function (lv) { return global.QMFormat.parse(JSON.stringify(lv)).level; }),
    raw: LEVELS
  };
})(window);
