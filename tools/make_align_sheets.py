"""Make the sheets for lining up two headsets by touch: docs/sheets/align-sheets.html and align-sheets.pdf.

    py -3 tools/make_align_sheets.py

Three A4 pages with a cross on each (and a fourth, with four printed markers, for measuring a webcam's field of view: see fov_page). Sheets 1 and 2 line the two rooms up: each player presses Line up on their
panel and holds an index fingertip still on cross 1, then on cross 2. Sheet 3 checks it: one player puts a check
mark on it, and the other sees whether the drawn mark sits on the cross (see engine/client/align.js for why sheets 1 and 2
cannot show an error by themselves). The HTML is written here; the PDF is printed from it by headless Edge or
Chrome, as docs/export_pdfs.py does.
"""
import os
import subprocess
import sys

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "sheets")
BROWSERS = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe"]


def page(n, title, lines, colour):
    notes = "\n".join(f'    <text x="105" y="{252 + 8 * i}" text-anchor="middle" font-size="4" fill="#444">{t}</text>' for i, t in enumerate(lines))
    return f"""<section>
  <svg viewBox="0 0 210 297" xmlns="http://www.w3.org/2000/svg">
    <text x="105" y="34" text-anchor="middle" font-size="9" font-weight="700">MUMR mixed reality: {title}</text>
    <circle cx="105" cy="150" r="60" fill="none" stroke="#000" stroke-width="0.6"/>
    <circle cx="105" cy="150" r="30" fill="none" stroke="#000" stroke-width="0.6"/>
    <circle cx="105" cy="150" r="10" fill="none" stroke="#000" stroke-width="0.6"/>
    <line x1="25" y1="150" x2="185" y2="150" stroke="#000" stroke-width="1.2"/>
    <line x1="105" y1="70" x2="105" y2="230" stroke="#000" stroke-width="1.2"/>
    <circle cx="105" cy="150" r="1.6" fill="{colour}"/>
    <text x="150" y="118" font-size="46" font-weight="700" fill="{colour}">{n}</text>
{notes}
    <text x="105" y="286" text-anchor="middle" font-size="3.4" fill="#888">Tape the sheet down: it must not move between the two players. Any marked spot on the floor works as well.</text>
  </svg>
</section>"""


PAGES = [
    (1, "line-up spot 1", ["Press Line up on your panel. Put an index fingertip on the dot and hold it still", "until the ring is full. Both players do this, here first."], "#c0392b"),
    (2, "line-up spot 2", ["Lay this sheet 1.5 to 2 m from sheet 1: the further, the better the two rooms agree.", "Both players hold a fingertip still on the dot, after spot 1."], "#c0392b"),
    (3, "check spot 3", ["Lay this sheet anywhere else, a metre or more from sheets 1 and 2.", "One player presses Line up again and holds a fingertip on the dot: a mark appears.", "The other player looks: the mark should sit on this cross. If it does not, pinch one of", "your own marks at spot 1 or 2 and move it until it does."], "#2f6fc8"),
]

# The field-of-view sheet (page 4): four printed markers that the webcam page finds by itself (engine/client/webcam/markers.js). The codes, the marker size and the
# places are the ones in engine/client/webcam/markers.js (FOV_CODES, SHEET); a test keeps the two files in step. Millimetres on an A4 page, ids 0 to 3 = top left, top
# right, bottom right, bottom left.
FOV_CODES = [14858, 39031, 50870, 56793]
FOV_MARKER_MM = 44
FOV_MARKER_POS_MM = [(8, 8), (158, 8), (158, 245), (8, 245)]
FOV_BAR_MM = 100                       # the length of each of the two bars (horizontal and vertical), between the lines at their ends


def marker_svg(code, x, y, side):
    """One marker: a black square, a white 4 x 4 inside it, and the black cells of the code (bit r * 4 + c is the cell in row r, column c)."""
    cell = side / 6
    out = [f'<rect x="{x}" y="{y}" width="{side}" height="{side}" fill="#000"/>',
           f'<rect x="{x + cell:.4f}" y="{y + cell:.4f}" width="{cell * 4:.4f}" height="{cell * 4:.4f}" fill="#fff"/>']
    for r in range(4):
        for c in range(4):
            if code >> (r * 4 + c) & 1:
                out.append(f'<rect x="{x + cell * (c + 1):.4f}" y="{y + cell * (r + 1):.4f}" width="{cell:.4f}" height="{cell:.4f}" fill="#000"/>')
    return "\n      ".join(out)


def fov_page():
    """Page 4: the field-of-view sheet. The webcam page finds the four markers in the camera's picture, takes a picture when the sheet is still, and
    works the camera's field of view out of the sixteen corners."""
    s = FOV_MARKER_MM
    marks = []
    for k, (x, y) in enumerate(FOV_MARKER_POS_MM):
        left, top = x < 105, y < 148
        marks.append(f'''    <g shape-rendering="crispEdges">
      {marker_svg(FOV_CODES[k], x, y, s)}
    </g>
    <text x="{x + s + 3 if left else x - 3}" y="{y + 7 if top else y + s - 1}" text-anchor="{'start' if left else 'end'}" font-size="7" font-weight="700" fill="#2f6fc8">{k + 1}</text>''')
    lines = ["Field-of-view sheet for the webcam page.",
             "Print it at 100 % (no fit to page) and check that the bars are 100 mm long.",
             "",
             "In the webcam panel press Measure field of view.",
             "Hold this sheet 0.4 to 0.8 m in front of the camera, leaning back",
             "(its top edge further from the camera than its bottom edge), and keep it still:",
             "the page takes a picture of it by itself.",
             "",
             "A yellow outline on the screen shows where to put the sheet next.",
             "Do this at three to five places.",
             "",
             "Hold the sheet by the middle of the long edges, or lean it on something:",
             "the four black squares must stay uncovered.",
             "",
             "If the page cannot find the squares, press Measure by clicking",
             "and click their centres in the order of their numbers.",
             "",
             "Showing this sheet on a screen (a phone) instead of printing it?",
             "Measure each 100 mm bar as it is shown, between its two end lines,",
             "and enter the two numbers in the webcam panel (Bar shown as).",
             "The outline then fits the screen: hold it close to the lens."]
    text = "\n".join(f'    <text x="105" y="{82 + 5.0 * k:.1f}" text-anchor="middle" font-size="3.7" fill="#444">{t}</text>' for k, t in enumerate(lines) if t)
    w = FOV_MARKER_POS_MM[1][0] - FOV_MARKER_POS_MM[0][0]
    h = FOV_MARKER_POS_MM[3][1] - FOV_MARKER_POS_MM[0][1]
    bar = FOV_BAR_MM
    hx0, hx1, hy = 105 - bar / 2, 105 + bar / 2, 208                 # the horizontal bar, with a line at each end
    vx, vy0, vy1 = 196, 100, 100 + bar                                  # the vertical bar, on the right edge
    return f"""<section>
  <svg viewBox="0 0 210 297" xmlns="http://www.w3.org/2000/svg">
{chr(10).join(marks)}
    <text x="105" y="68" text-anchor="middle" font-size="8" font-weight="700">MUMR mixed reality: field of view</text>
{text}
    <line x1="{hx0}" y1="{hy}" x2="{hx1}" y2="{hy}" stroke="#000" stroke-width="0.8"/>
    <line x1="{hx0}" y1="{hy - 4}" x2="{hx0}" y2="{hy + 4}" stroke="#000" stroke-width="0.5"/>
    <line x1="{hx1}" y1="{hy - 4}" x2="{hx1}" y2="{hy + 4}" stroke="#000" stroke-width="0.5"/>
    <text x="105" y="{hy + 11}" text-anchor="middle" font-size="4" fill="#444">{bar} mm</text>
    <line x1="{vx}" y1="{vy0}" x2="{vx}" y2="{vy1}" stroke="#000" stroke-width="0.8"/>
    <line x1="{vx - 4}" y1="{vy0}" x2="{vx + 4}" y2="{vy0}" stroke="#000" stroke-width="0.5"/>
    <line x1="{vx - 4}" y1="{vy1}" x2="{vx + 4}" y2="{vy1}" stroke="#000" stroke-width="0.5"/>
    <text x="{vx - 7}" y="{(vy0 + vy1) / 2}" text-anchor="middle" font-size="4" fill="#444" transform="rotate(-90 {vx - 7} {(vy0 + vy1) / 2})">{bar} mm</text>
    <text x="105" y="237" text-anchor="middle" font-size="3.4" fill="#888">The squares are {s} mm. Squares 1 and 2 are {w} mm apart (centre to centre), 1 and 4 are {h} mm apart.</text>
  </svg>
</section>"""


HTML = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MUMR: line-up sheets</title>
<style>
  @page {{ size: A4; margin: 0; }}
  html, body {{ margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }}
  section {{ width: 210mm; height: 297mm; page-break-after: always; }}
  svg {{ width: 210mm; height: 297mm; display: block; }}
</style></head><body>
{"".join(page(*p) for p in PAGES)}{fov_page()}
</body></html>
"""


def main():
    html = os.path.join(HERE, "align-sheets.html"); pdf = os.path.join(HERE, "align-sheets.pdf")
    with open(html, "w", encoding="utf-8") as f:
        f.write(HTML)
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        print("wrote", html, "(no Edge or Chrome found: print it to PDF by hand)")
        return 0
    subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", "file:///" + html.replace("\\", "/")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    print("wrote", html, "and", pdf, f"({os.path.getsize(pdf)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
