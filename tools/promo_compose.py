# -*- coding: utf-8 -*-
"""宣传图后期：去水印 + 叠加标题"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMO = os.path.join(ROOT, "promo")
SRC = os.path.join(PROMO, "raw", "Put_the_yellow_character_from__2026-11-11T07-15-15.png")
OUT = os.path.join(PROMO, "奶蛙跑酷-宣传图.png")

ZH = "C:/Windows/Fonts/STHUPO.TTF"      # 华文琥珀：圆厚展示体，适合游戏 Logo
EN = "C:/Windows/Fonts/msyhbd.ttc"      # 微软雅黑 粗体

base = Image.open(SRC).convert("RGBA")
bw, bh = base.size
print("原图:", (bw, bh))

# ---------- 1. 盖掉右下角水印（取它左边同高度的草丛） ----------
wm_w, wm_h = int(bw * 0.20), int(bh * 0.075)
px, py = bw - wm_w, bh - wm_h
patch = base.crop((px - wm_w - 10, py, px - 10, bh))
base.paste(patch, (px, py))

# ---------- 2. 标题 ----------
def draw_fancy(base, cx, cy, text, font_path, size, tracking,
               stroke, grad_top, grad_bot, shadow_alpha=150):
    font = ImageFont.truetype(font_path, size)
    probe = ImageDraw.Draw(Image.new("L", (10, 10)))
    xs, x = [], 0
    for ch in text:
        cb = probe.textbbox((0, 0), ch, font=font)
        xs.append((x, cb[2] - cb[0]))
        x += (cb[2] - cb[0]) + tracking
    total = int(xs[-1][0] + xs[-1][1])
    asc, desc = font.getmetrics()
    th = asc + desc
    pad = stroke * 3 + 30
    w, h = int(total + pad * 2), int(th + pad * 2)

    # 阴影（含描边一起模糊）
    sm = Image.new("L", (w, h), 0)
    smd = ImageDraw.Draw(sm)
    for i, (dx, _) in enumerate(xs):
        smd.text((pad + dx, pad), text[i], font=font, fill=255,
                 stroke_width=stroke, stroke_fill=255)
    sm = sm.filter(ImageFilter.GaussianBlur(9))
    shl = Image.new("RGBA", (w, h), (35, 55, 30, shadow_alpha))
    layer = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    layer.paste(shl, (int(cx - w/2 + 10), int(cy - h/2 + 14)), sm)

    # 白描边
    ol = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(ol)
    for i, (dx, _) in enumerate(xs):
        od.text((pad + dx, pad), text[i], font=font, fill=(255, 255, 255, 255),
                stroke_width=stroke, stroke_fill=(255, 255, 255, 255))
    layer.alpha_composite(ol, (int(cx - w/2), int(cy - h/2)))

    # 渐变填字
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for i, (dx, _) in enumerate(xs):
        md.text((pad + dx, pad), text[i], font=font, fill=255)
    g = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    for i in range(h):
        t = i / max(1, h - 1)
        c = tuple(int(grad_top[j] + (grad_bot[j] - grad_top[j]) * t) for j in range(3)) + (255,)
        gd.line((0, i, w, i), fill=c)
    layer.paste(g, (0, 0), mask)
    base.alpha_composite(layer, (0, 0))
    return w, h

# 标题放在右上方的开阔天空
tcx, tcy = int(bw * 0.5), int(bh * 0.185)
draw_fancy(base, tcx, tcy, "奶蛙跑酷", ZH, int(bh * 0.195), int(bh * 0.006),
           max(6, int(bh * 0.016)), (255, 240, 130), (245, 130, 40), 160)

# 副标题
sub = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
sd = ImageDraw.Draw(sub)
f2 = ImageFont.truetype(EN, int(bh * 0.055))
txt = "N A I W A   R U N N E R"
bb = sd.textbbox((0, 0), txt, font=f2)
sx = tcx - (bb[2] - bb[0]) // 2
sy = tcy + int(bh * 0.155)
sd.text((sx, sy), txt, font=f2, fill=(255, 255, 255, 240),
        stroke_width=max(3, int(bh*0.006)), stroke_fill=(120, 80, 30, 225))
base.alpha_composite(sub)

# 小标语
tag = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
td = ImageDraw.Draw(tag)
f3 = ImageFont.truetype(EN, int(bh * 0.042))
tt = "收集奶瓶 · 冲刺起飞"
bb3 = td.textbbox((0, 0), tt, font=f3)
tx = bw // 2 - (bb3[2] - bb3[0]) // 2
ty = bh - int(bh * 0.10)
td.text((tx, ty), tt, font=f3, fill=(255, 255, 255, 235),
        stroke_width=max(3, int(bh*0.005)), stroke_fill=(50, 100, 65, 220))
base.alpha_composite(tag)

base.convert("RGB").save(OUT, "PNG", optimize=True)
print("已生成:", OUT, os.path.getsize(OUT) // 1024, "KB")
