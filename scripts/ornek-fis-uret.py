#!/usr/bin/env python3
"""Test için örnek bir banka dekontu görseli üretir (gerçek veri içermez)."""
import glob, sys
from PIL import Image, ImageDraw, ImageFont

def font(boyut, kalin=False):
    adaylar = [
        f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if kalin else ''}.ttf",
        f"/usr/share/fonts/truetype/liberation/LiberationSans{'-Bold' if kalin else ''}.ttf",
    ]
    for a in adaylar:
        if glob.glob(a):
            return ImageFont.truetype(a, boyut)
    raise SystemExit("Uygun TTF yazı tipi bulunamadı")

G, A = (11, 92, 63), (107, 118, 131)
img = Image.new("RGB", (640, 470), "white")
d = ImageDraw.Draw(img)
d.rounded_rectangle([16, 16, 624, 454], radius=14, outline=(216, 221, 227), width=2)

d.text((46, 46), "ZİRAAT BANKASI", font=font(26, True), fill=G)
d.text((360, 54), "Havale / EFT Dekontu", font=font(15), fill=A)
d.line([46, 92, 594, 92], fill=G, width=3)

satirlar = [
    ("İşlem Tarihi", "18.11.2026   14:32"),
    ("Gönderen", "Zeynep Demir"),
    ("Alıcı", "Üreten Çocuk Oyun Atölyesi"),
    ("Açıklama", "Can Demir - Kasım ayı ödemesi"),
    ("İşlem No", "2026111800394817"),
]
y = 112
for etiket, deger in satirlar:
    d.text((46, y), etiket, font=font(17), fill=A)
    d.text((230, y), deger, font=font(17, True), fill=(28, 37, 48))
    y += 40
    d.line([46, y - 8, 594, y - 8], fill=(227, 232, 237), width=1)

d.text((320, 330), "1.000,00 TL", font=font(38, True), fill=G, anchor="mm")
d.text((320, 400), "Bu belge bilgi amaçlıdır. Banka kayıtları esas alınır.", font=font(13), fill=(139, 149, 161), anchor="mm")
d.text((320, 422), "Ziraat Bankası A.Ş. — 0850 220 00 00", font=font(13), fill=(139, 149, 161), anchor="mm")

cikti = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fis-ornek-dekont.png"
img.save(cikti, "PNG")
print(cikti, img.size)
