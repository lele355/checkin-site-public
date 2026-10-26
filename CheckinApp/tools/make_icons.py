# -*- coding: utf-8 -*-
"""生成 PWA 图标：圆角方块 + 主色底 + 白色「家」字（用系统微软雅黑）。"""
from PIL import Image, ImageDraw, ImageFont

OUT = "D:/checkin/site/CheckinApp/wwwroot/icons"
import os
os.makedirs(OUT, exist_ok=True)

def make(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size // 5
    # 圆角方块底（teal 主色）
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(15, 110, 86, 255))
    # 白色「家」字
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", int(size * 0.52))
    bbox = d.textbbox((0, 0), "家", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), "家", font=font, fill=(255, 255, 255, 255))
    img.save(f"{OUT}/icon-{size}.png")
    print("saved", f"{OUT}/icon-{size}.png")

make(192)
make(512)
