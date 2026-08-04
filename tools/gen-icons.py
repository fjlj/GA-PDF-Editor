"""Generate GA PDF Editor icons in Give Academy brand style."""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Icons ship in app/ (manifest + desktop shortcut paths)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app")
OUT = os.path.normpath(OUT)

# Brand palette from give.academy
BLUE = (61, 169, 252)  # Give. blue
ORANGE = (255, 154, 26)  # Academy orange
FILL = (232, 250, 250)  # pale cyan fill
RIM = (242, 196, 154)  # soft peach rim
DOC_WHITE = (255, 255, 255)
DOC_EDGE = (210, 228, 235)
LINE = (180, 210, 220)


def make_icon(size: int, for_favicon: bool = False) -> Image.Image:
    """Render icon at target size with supersampled antialiasing."""
    scale = 4 if size >= 64 else 8
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cx = cy = S // 2
    # Smaller circle badge so the paper can sit in front and break out
    pad = int(S * 0.13)
    r_outer = S // 2 - pad
    rim_w = max(int(S * 0.032), 2 * scale)
    r_inner = r_outer - rim_w

    # Soft drop shadow under the circle only
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sh_off = int(S * 0.022)
    sd.ellipse(
        [
            cx - r_outer + sh_off,
            cy - r_outer + sh_off,
            cx + r_outer + sh_off,
            cy + r_outer + sh_off,
        ],
        fill=(0, 0, 0, 80),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(S * 0.028, 2)))
    img = Image.alpha_composite(img, shadow)
    d = ImageDraw.Draw(img)

    # Peach rim + pale fill (Give Academy badge) — behind the paper
    d.ellipse(
        [cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer],
        fill=RIM + (255,),
    )
    d.ellipse(
        [cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner],
        fill=FILL + (255,),
    )

    # Larger PDF document, nudged up so top/fold peeks past the circle a touch
    doc_w = int(S * 0.48)
    doc_h = int(S * 0.60)
    doc_x0 = cx - doc_w // 2
    doc_y0 = cy - doc_h // 2 - int(S * 0.03)  # slightly on top / breaking out
    doc_x1 = doc_x0 + doc_w
    doc_y1 = doc_y0 + doc_h
    corner = int(S * 0.04)
    fold = int(doc_w * 0.26)

    # Soft document shadow (helps the "pop out" read)
    doc_shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dsd = ImageDraw.Draw(doc_shadow)
    off = max(int(S * 0.014), 1)
    dsd.rounded_rectangle(
        [doc_x0 + off, doc_y0 + off, doc_x1 + off, doc_y1 + off],
        radius=corner,
        fill=(0, 0, 0, 85),
    )
    doc_shadow = doc_shadow.filter(
        ImageFilter.GaussianBlur(radius=max(S * 0.018, 1))
    )
    img = Image.alpha_composite(img, doc_shadow)
    d = ImageDraw.Draw(img)

    # Document body with cut corner
    body_pts = [
        (doc_x0, doc_y0),
        (doc_x1 - fold, doc_y0),
        (doc_x1, doc_y0 + fold),
        (doc_x1, doc_y1),
        (doc_x0, doc_y1),
    ]
    d.polygon(body_pts, fill=DOC_WHITE + (255,))
    d.line(body_pts + [body_pts[0]], fill=DOC_EDGE + (255,), width=max(scale, 1))

    # Fold triangle
    fold_pts = [
        (doc_x1 - fold, doc_y0),
        (doc_x1, doc_y0 + fold),
        (doc_x1 - fold, doc_y0 + fold),
    ]
    d.polygon(fold_pts, fill=(255, 236, 214, 255))
    d.line(fold_pts + [fold_pts[0]], fill=RIM + (255,), width=max(scale, 1))
    d.line(
        [
            (doc_x1 - fold, doc_y0),
            (doc_x1 - fold, doc_y0 + fold),
            (doc_x1, doc_y0 + fold),
        ],
        fill=ORANGE + (200,),
        width=max(scale, 1),
    )

    # Blue header bar (brand blue instead of classic PDF red)
    bar_top = doc_y0 + int(doc_h * 0.08)
    bar_bot = bar_top + int(doc_h * 0.12)
    bar_left = doc_x0 + int(doc_w * 0.10)
    bar_right = doc_x1 - fold - int(doc_w * 0.06)
    d.rounded_rectangle(
        [bar_left, bar_top, bar_right, bar_bot],
        radius=max(int(S * 0.01), 1),
        fill=BLUE + (255,),
    )

    # Text lines
    line_left = doc_x0 + int(doc_w * 0.12)
    line_right_full = doc_x1 - int(doc_w * 0.12)
    y = bar_bot + int(doc_h * 0.10)
    gap = int(doc_h * 0.075)
    lw = max(int(S * 0.012), scale)
    widths = [1.0, 0.92, 0.78, 0.88, 0.55]
    for i, w in enumerate(widths):
        if for_favicon and i > 2:
            break
        x1 = line_left + int((line_right_full - line_left) * w)
        color = ORANGE if i == len(widths) - 1 else LINE
        alpha = 255 if i == len(widths) - 1 else 230
        d.rounded_rectangle(
            [line_left, y, x1, y + lw],
            radius=max(lw // 2, 1),
            fill=color + (alpha,),
        )
        y += gap

    # Diagonal edit pen accent
    if not for_favicon or size >= 32:
        pen_x = doc_x1 - int(doc_w * 0.07)
        pen_y = doc_y1 - int(doc_h * 0.09)
        pen_len = int(S * 0.10)
        thick = max(int(S * 0.016), scale)
        ang = math.radians(-45)
        dx, dy = math.cos(ang), math.sin(ang)
        px, py = pen_x, pen_y
        qx = pen_x - pen_len * dx
        qy = pen_y - pen_len * dy
        nx, ny = -dy, dx
        hw = thick / 2
        pen_poly = [
            (px + nx * hw, py + ny * hw),
            (px - nx * hw, py - ny * hw),
            (qx - nx * hw, qy - ny * hw),
            (qx + nx * hw, qy + ny * hw),
        ]
        d.polygon(pen_poly, fill=ORANGE + (255,))
        tip = int(pen_len * 0.22)
        d.polygon(
            [
                (px, py),
                (
                    px - dx * tip + nx * hw * 0.3,
                    py - dy * tip + ny * hw * 0.3,
                ),
                (
                    px - dx * tip - nx * hw * 0.3,
                    py - dy * tip - ny * hw * 0.3,
                ),
            ],
            fill=BLUE + (255,),
        )

    # GA monogram badge on larger icons
    if size >= 128:
        br = int(S * 0.06)
        bx = doc_x0 + int(doc_w * 0.20)
        by = doc_y1 - int(doc_h * 0.16)
        d.ellipse([bx - br, by - br, bx + br, by + br], fill=BLUE + (255,))
        font = None
        for fp in [
            r"C:\Windows\Fonts\segoeuib.ttf",
            r"C:\Windows\Fonts\arialbd.ttf",
            r"C:\Windows\Fonts\calibrib.ttf",
        ]:
            if os.path.exists(fp):
                try:
                    font = ImageFont.truetype(fp, int(br * 1.15))
                    break
                except OSError:
                    pass
        label = "GA"
        if font:
            bbox = d.textbbox((0, 0), label, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            d.text(
                (
                    bx - tw / 2 - bbox[0],
                    by - th / 2 - bbox[1] - int(S * 0.004),
                ),
                label,
                font=font,
                fill=(255, 255, 255, 255),
            )
        else:
            d.text(
                (bx - br * 0.6, by - br * 0.5),
                label,
                fill=(255, 255, 255, 255),
            )

    return img.resize((size, size), Image.Resampling.LANCZOS)


def write_ico(path: str, frames: list[tuple[int, Image.Image]]) -> None:
    """Write a multi-size PNG-compressed ICO (Vista+)."""
    import io
    import struct

    blobs: list[bytes] = []
    entries: list[tuple[int, int, int, int]] = []
    offset = 6 + 16 * len(frames)
    for s, im in frames:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        data = buf.getvalue()
        w = 0 if s >= 256 else s
        h = 0 if s >= 256 else s
        entries.append((w, h, len(data), offset))
        blobs.append(data)
        offset += len(data)

    parts = [struct.pack("<HHH", 0, 1, len(frames))]
    for w, h, size_b, off in entries:
        parts.append(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, size_b, off))
    parts.extend(blobs)
    with open(path, "wb") as f:
        f.write(b"".join(parts))


def main() -> None:
    icon_512 = make_icon(512)
    icon_192 = make_icon(192)

    sizes_ico = [16, 24, 32, 48, 64, 128, 256]
    ico_frames = [
        (s, make_icon(s, for_favicon=(s <= 32))) for s in sizes_ico
    ]

    path_512 = os.path.join(OUT, "GAPDF-Edit_PRO512.png")
    path_192 = os.path.join(OUT, "GAPDF-Edit_PRO192.png")
    path_ico = os.path.join(OUT, "favicon.ico")

    icon_512.save(path_512, "PNG", optimize=True)
    icon_192.save(path_192, "PNG", optimize=True)
    write_ico(path_ico, ico_frames)

    for p in [path_512, path_192, path_ico]:
        print(f"{os.path.basename(p)}: {os.path.getsize(p)} bytes")
    print("done")


if __name__ == "__main__":
    main()
