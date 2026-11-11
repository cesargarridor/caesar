"""Genera las imágenes del instalador de Windows (NSIS) con el gatito y los colores del tema Caesar.
Uso: python scripts/installer-art.py   (necesita Pillow)"""
import random
from PIL import Image, ImageDraw, ImageFont

BG, KELP, IRIS, MIST, SLATE = "#130f30", "#2a2563", "#8052ff", "#f4f0ff", "#9f9bd0"
PAL = {"o": "#f28c2e", "d": "#c9621a", "w": "#fff0d4", "k": "#2b1a12", "p": "#ff9aa8"}
CAT = [
    "oo............oo", "ooo..........ooo", "oopo........opoo", "oopooooddoooopoo",
    "oooooooddooooooo", "oookkoooooookkoo", "oookkoooooookkoo", "oowwwwoppowwwwoo",
    "oowwwwowwowwwwoo", "ooowwwwwwwwwwooo", ".oooowwwwwwoooo.", "..oooooooooooo..",
]

def font(size, bold=False):
    for name in ("segoeuib.ttf" if bold else "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()

def stars(img, n, seed):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = rnd.randrange(img.width), rnd.randrange(img.height)
        c = rnd.choice([KELP, "#4a42a0", SLATE])
        d.point((x, y), fill=c)

def cat(img, x, y, px):
    d = ImageDraw.Draw(img)
    for r, row in enumerate(CAT):
        for c, ch in enumerate(row):
            if ch in PAL:
                d.rectangle([x + c * px, y + r * px, x + (c + 1) * px - 1, y + (r + 1) * px - 1], fill=PAL[ch])

# Lateral de bienvenida / fin: 164x314
side = Image.new("RGB", (164, 314), BG)
stars(side, 70, 7)
cat(side, 18, 70, 8)  # 128x96
d = ImageDraw.Draw(side)
d.text((82, 196), "Caesar", font=font(30, True), fill=MIST, anchor="mm")
d.text((82, 224), "Cliente API", font=font(13), fill=SLATE, anchor="mm")
side.save("src-tauri/installer/sidebar.bmp")

# Cabecera de las páginas interiores: 150x57
head = Image.new("RGB", (150, 57), BG)
stars(head, 25, 3)
cat(head, 12, 12, 2)  # 32x24 -> centrado vertical aprox
head = head.copy()
d = ImageDraw.Draw(head)
d.text((56, 28), "Caesar", font=font(20, True), fill=MIST, anchor="lm")
head.save("src-tauri/installer/header.bmp")
print("ok")
