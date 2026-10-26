"""Make two pictures to show a laptop's webcam from a phone, to try the webcam overlay (apps/cube/webcam.html) without printing anything:

    py -3 tools/make_phone_test_images.py

  apps/cube/phone-test/sheet4.png   page 4 of the line-up sheets (the field-of-view sheet with its four markers), as a picture. Press Measure field of
                                       view on the page and hold the phone in front of the webcam, leaning back (the top further away), keeping it still;
                                       follow the yellow outline. The field of view comes out right whatever the size of the picture on the phone: the maths
                                       only needs its shape (it must not be stretched).
  apps/cube/phone-test/floor.png    the three floor spots as the rehearsal (engine/client/webcam/rehearsal.js) has them: spot 1 at (0, 0), spot 2 1.5 m along the
                                       x axis, a check spot at (0.6, -1.2), as red dots with rings, drawn to scale (1 m = 700 pixels) on a plain background.
                                       Click the three dots in the webcam picture (Spot 1, Spot 2, Check spot): the white line that the page draws between the
                                       spots should lie over the dots, whatever their size on the screen.

The pictures are served by the same server as the pages: open https://<the PC address>:8443/phone-test/sheet4.png in the phone's browser (same Wi-Fi).
The PNGs are made by headless Edge or Chrome, as make_align_sheets.py does for the PDF.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "apps", "cube", "phone-test")
sys.path.insert(0, HERE)
import make_align_sheets as sheets  # noqa: E402

BROWSERS = sheets.BROWSERS


def shot(exe, html_path, png_path, w, h):
    subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", f"--window-size={w},{h}",
                    f"--screenshot={png_path}", "file:///" + html_path.replace("\\", "/")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


def main():
    os.makedirs(OUT, exist_ok=True)
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        print("no Edge or Chrome found")
        return 1
    # sheet 4: the page as an A4 picture, 1240 x 1754 (150 dpi)
    page = sheets.fov_page().replace('<svg viewBox="0 0 210 297"', '<svg width="1240" height="1754" viewBox="0 0 210 297"')
    html = os.path.join(OUT, "_sheet4.html")
    with open(html, "w", encoding="utf-8") as f:
        f.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;font-family:"Segoe UI",Arial,sans-serif}svg{display:block}</style></head><body>' + page + "</body></html>")
    shot(exe, html, os.path.join(OUT, "sheet4.png"), 1240, 1754)
    os.remove(html)
    # the floor spots: 1 m = 700 px; spot 1 at (200, 200); x to the right, y UP the picture as on a plan (so the check spot at y = -1.2 is lower)
    k, ox, oy = 700, 200, 200
    spots = [(0, 0, "1", "#d6482f"), (1.5, 0, "2", "#2f6fc8"), (0.6, -1.2, "3", "#2e8b57")]
    parts = []
    for x, y, label, col in spots:
        cx, cy = ox + x * k, oy - y * k
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="34" fill="none" stroke="{col}" stroke-width="5"/><circle cx="{cx}" cy="{cy}" r="9" fill="{col}"/>'
                     f'<line x1="{cx - 50}" y1="{cy}" x2="{cx + 50}" y2="{cy}" stroke="{col}" stroke-width="2"/><line x1="{cx}" y1="{cy - 50}" x2="{cx}" y2="{cy + 50}" stroke="{col}" stroke-width="2"/>'
                     f'<text x="{cx + 44}" y="{cy - 38}" font-size="46" font-weight="700" fill="{col}" font-family="Segoe UI,Arial,sans-serif">{label}</text>')
    w, h = 1500, 1300
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="#f4f1ea"/>'
           + "".join(parts) +
           f'<text x="40" y="{h - 40}" font-size="28" fill="#777" font-family="Segoe UI,Arial,sans-serif">Spots 1, 2 (1.5 m along the x axis) and 3 (the check spot at 0.6, -1.2 m). Do not stretch this picture.</text></svg>')
    html = os.path.join(OUT, "_floor.html")
    with open(html, "w", encoding="utf-8") as f:
        f.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}svg{display:block}</style></head><body>' + svg + "</body></html>")
    shot(exe, html, os.path.join(OUT, "floor.png"), w, h)
    os.remove(html)
    for n in ("sheet4.png", "floor.png"):
        print(n, os.path.getsize(os.path.join(OUT, n)), "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
