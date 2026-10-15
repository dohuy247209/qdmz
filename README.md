# Quad Maze – JS Clone

Clone web tĩnh (HTML/CSS/JS thuần, **không cần build/bundler**) của game platformer dính tường
"Quad Maze": di chuyển khối vuông trắng, nhảy đa đoạn dính tường, né saw xoay, về checkpoint.

## Chạy

```bash
# Cách 1: mở trực tiếp
start index.html

# Cách 2: serve bằng http (khuyên dùng để test file import/export)
npx serve .        # hoặc: python -m http.server 8000
```

- `index.html` – trang game (menu, chọn level, import/export pack)
- `editor.html` – level editor
- Chạy test logic: `node test/run-tests.js` (24 test: parser, vật lý, SAT, gameplay)

## Điều khiển

| Phím | Hành động |
|---|---|
| A/D hoặc ←/→ | Đi trái/phải |
| Backspace, Space, W, ↑ hoặc click chuột | Nhảy |
| R | Chơi lại level |
| Esc / P | Tạm dừng |
| Enter | Level tiếp theo (khi thắng) |

**Multijump**: được nhảy khi đang đứng trên sàn, đang chạm tường, hoặc tâm square cách
wall ≤ ½ ô (đo theo bề rộng square). Nhảy xa khỏi tường ở giữa không trung = không có tác dụng.

## Mechanics (khớp mô tả game gốc)

- Gravity thấp (60 ô/s²), nhảy ~3.7 ô, tốc độ ngang 10 ô/s, timestep cố định 1/120s
- Saw trúng -> chết -> respawn tại checkpoint đã chạm (hoặc spawn); timer **không** reset
- Spawn / goal / checkpoint = khối vuông đen cùng cỡ player; wall = trắng; saw = đen
- Saw = 2 hình vuông chồng nhau (8 khía), luôn xoay, chỉnh tốc độ/chiều/size
- 4 tường sandbox vô hạn bao quanh box – không bao giờ rơi ra ngoài
- Nền: 2 sắc đỏ sọc chéo xen kẽ; không viền; HUD "TIME: …" và "LEVEL …" viền đậm

## Cấu trúc file

```
index.html        trang game
editor.html       level editor
css/style.css     style chung
js/render.js      renderer: sọc chéo, gear saw, grid, text HUD
js/format.js      JSON format + parser/validator (QMFormat)
js/levels.js      6 level built-in
js/game.js        engine: vật lý SAT, multijump, saw/checkpoint/goal, HUD
js/main.js        menu, chọn level, import/export pack (localStorage)
js/editor.js      editor: palette, snap lưới, properties, undo, test, export/import
test/run-tests.js test Node (chạy: node test/run-tests.js)
```

## JSON format

Level đơn (`*.quadmaze.json`):

```json
{
  "format": "quadmaze-level",
  "version": 1,
  "name": "6-5",
  "box": { "w": 36, "h": 20 },
  "spawn":   { "x": 4,  "y": 17 },
  "goal":    { "x": 32, "y": 17 },
  "checkpoints": [ { "x": 18, "y": 16 } ],
  "walls": [
    { "x": 0, "y": 18, "w": 36, "h": 2, "rot": 0,
      "motion": { "type": "static", "distance": 0, "speed": 2, "phase": 0 } },
    { "x": 2, "y": 6, "w": 14, "h": 1.6, "rot": 45,
      "motion": { "type": "static", "distance": 0, "speed": 2, "phase": 0 } }
  ],
  "saws": [
    { "x": 13.5, "y": 11.5, "size": 2, "spin": 160,
      "motion": { "type": "horizontal", "distance": 3, "speed": 0.5, "phase": 0 } }
  ]
}
```

- **Đơn vị**: ô lưới (cell) – 1 cell = cạnh player; gốc trên-trái, y xuống dưới
- **wall.rot**: độ xoay quanh tâm rect (ví dụ 45 để làm dải chéo như ảnh game)
- **motion.type**: `static` | `horizontal` | `vertical` | `circle`
  - `distance`: quãng đường (ô); `speed`: chu kỳ/giây; `phase`: pha (0..1)
- **saw.spin**: độ/giây, âm = ngược chiều (bắt buộc ≠ 0, parser tự sửa nếu = 0)
- Pack nhiều level: `{ "format": "quadmaze-pack", "name": "...", "levels": [ … ] }`

Parser (`QMFormat.parse/parseAny`) **validate + normalize**: clamp toạ độ, fallback motion
sai về `static`, báo lỗi/warning qua mảng `errors` – import file lỗi vẫn nhận phần hợp lệ.

## Editor

- **Công cụ** (phím 1..7): Chọn/di chuyển, Vường (kéo để vẽ), Saw (kéo = to), Spawn, Goal,
  Checkpoint, Xóa
- **Shift** = không snap lưới; **Ctrl+Z** = undo (60 bước); **Del** = xóa đang chọn
- Panel phải: sửa toạ độ, kích cỡ, độ xoay, loại/chỉ số chuyển động trực tiếp
- **Export JSON** (tải file), **Import JSON** (file hoặc kéo-thả vào trang game),
  **▶ Test** (mở tab game với level hiện tại), undo, đếm thành phần

## Điểm khác biệt / giả định

- Bản gốc (anqa-game) đóng cửa – không lấy được tài liệu chính thức; mechanics dựa trên mô tả
  của bạn + ảnh screenshot. Tune lại hằng số trong `js/game.js` (`PHYS`) nếu muốn đúng手感 hơn.
- Chưa có âm thanh, hiệu ứng particle, mobile touch controls (chưa yêu cầu).
- Entity mở rộng: format hỗ trợ sẵn `motion` cho mọi object – sau này thêm entity mới
  (cửa, đòn bẩy, spike…) chỉ cần đăng ký trong parser + render + editor palette.
