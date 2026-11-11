"""
把奶蛙全身照切成 body / legFront / legBack 三块，供 canvas 骨骼动画使用。

注意：源图奶蛙朝【左】，而游戏中向右跑，所以先水平镜像再切。
以下所有坐标都是【镜像后】的坐标系（宽 241）。
"""
import base64, json, math, os
from collections import deque
import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "奶蛙-全身.png")
OUT = os.path.join(ROOT, "assets")

# 切分参数（镜像后，241x447）
HIP_Y   = 306      # 髋部分界：以上为躯干，以下分成两条腿
# ★ 关键：腿必须深深插进躯干里（joint overlap），否则旋转时腿顶边下沉会露出躯干切边。
#   腿在 ±0.62rad 摆动时，远端转角下沉量 = dx_max * sin(0.62)，前腿 dx_max=59 → 34.3px
#   所以顶部至少要比髋线高 35px，这里取 42px。
LEG_TOP = HIP_Y - 42     # 264
FOOT_Y  = 412            # 脚底
BODY_H  = HIP_Y + 6      # 躯干裁到 312
# 原图 (52,140) 是左腿 → 镜像后 (101,189)，髋轴 240-110=130
FRONT   = dict(l=101, r=189, hip=130)
# 原图 (136,216) 是右腿 → 镜像后 (25,105)，髋轴 240-168=72
BACK    = dict(l= 25, r=105, hip= 72)
FEATHER = 2        # 只做 2 行抗锯齿羽化；之前 16 行会把腿顶画成半透明，反而露出浅色带


def cutout(img, drop_shadow=True):
    """去白底 + 去地面阴影，返回 RGBA"""
    a = np.array(img.convert("RGBA"))
    h, w = a.shape[:2]
    rgb = a[:, :, :3].astype(np.int16)
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)

    # 1) 从四角 flood fill 找白色背景
    cand = (mn > 232) & ((mx - mn) < 18)
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and cand[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))

    alpha = np.where(seen, 0.0, 1.0)

    # 1.5) 封闭白袋：两腿之间、手臂与身体之间等被包围的白底，边界 flood fill 够不到
    #      只清面积够大的连通块，避免误伤眼睛/身体的高光点
    pocket = cand & ~seen
    if pocket.any():
        lab = np.zeros((h, w), np.int32)
        cur = 0
        for sy, sx in zip(*np.where(pocket)):
            if lab[sy, sx]:
                continue
            cur += 1
            qq = deque([(sy, sx)])
            lab[sy, sx] = cur
            area = 0
            while qq:
                y, x = qq.popleft()
                area += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and pocket[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        qq.append((ny, nx))
            if area >= 120:
                alpha[lab == cur] = 0.0

    # 2) 地面阴影：低饱和 + 中高亮度 + 位于下方
    if drop_shadow:
        f = rgb.astype(np.float32) / 255.0
        mxF, mnF = f.max(axis=2), f.min(axis=2)
        sat = np.where(mxF > 0, (mxF - mnF) / np.maximum(mxF, 1e-6), 0)
        lum = f.mean(axis=2)
        yy = np.arange(h)[:, None]
        shadow = (sat < 0.22) & (lum > 0.42) & (lum < 0.96) & (yy > h * 0.74)
        alpha = np.where(shadow, 0.0, alpha)

    # 3) 羽化 + 反预乘去白边
    am = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1.0))
    alpha = np.array(am).astype(np.float32) / 255.0
    rgb_f = a[:, :, :3].astype(np.float32)
    af = alpha[..., None]
    rec = (rgb_f - 255.0 * (1.0 - af)) / np.maximum(af, 0.10)
    edge = (alpha > 0.02) & (alpha < 0.995)
    rgb_f[edge] = np.clip(rec, 0, 255)[edge]

    return Image.fromarray(np.dstack([rgb_f, alpha * 255]).astype(np.uint8), "RGBA")


def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p, "PNG", optimize=True)
    b = base64.b64encode(open(p, "rb").read()).decode()
    print(f"  {name}: {img.size}  {os.path.getsize(p)//1024} KB  (b64 {len(b)//1024} KB)")
    return b


print("切分奶蛙全身图")
full = cutout(ImageOps.mirror(Image.open(SRC)))     # 镜像 → 朝右
print("  原图:", full.size)

body = full.crop((0, 0, full.width, BODY_H))

def drop_specks(img, min_area=300):
    """去掉与主体不连通的小碎块——原图脚边的泥块/阴影残留会一直跟着角色跑"""
    a = np.array(img)
    al = a[:, :, 3]
    solid = al > 30
    seen = np.zeros(solid.shape, bool)
    hh, ww = solid.shape
    for sy, sx in zip(*np.where(solid)):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)]); seen[sy, sx] = True; comp = [(sy, sx)]
        while q:
            y, x = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < hh and 0 <= nx < ww and solid[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; q.append((ny, nx)); comp.append((ny, nx))
        if len(comp) < min_area:
            for y, x in comp:
                al[y, x] = 0
    return Image.fromarray(a, "RGBA")

body = drop_specks(body, 500)

def cut_leg(cfg):
    """切出腿，并把髋线以上重画成「以髋轴为圆心的实心圆盘」。

    原理：圆盘绕自身圆心旋转，形状完全不变 → 无论摆多少角度都不会撕裂，
    也不会甩出躯干轮廓。髋线以下保留原始轮廓，所以脚和腿型不受影响。
    这就是 2D cutout rig 里对 "unpainted overlap" 的标准补法。
    """
    leg = full.crop((cfg["l"], LEG_TOP, cfg["r"], FOOT_Y))
    w, h = leg.size
    a = np.array(leg).astype(np.float32)
    al = a[:, :, 3]

    row = HIP_Y - LEG_TOP                     # 髋线在裁切图里的行号
    seg = al[row] > 100
    xs = np.where(seg)[0]
    c = (xs.min() + xs.max()) / 2.0           # 髋轴（局部坐标）
    R = (xs.max() - xs.min()) / 2.0           # 圆盘半径
    hip_x = cfg["l"] + c

    # ---- 髋线以上：严格裁成「以髋轴为圆心的实心圆盘」----
    # 必须是【整圆】，且圆外的原始像素必须裁掉：否则圆外残留的腿像素
    # 仍会跟着旋转甩出去，形成尖刺。圆盘绕自身圆心转不变，所以永远无裂缝。
    base_row = a[row, :, :3].copy()           # 用髋线截面的配色，避免高光被横向铺开
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - c) ** 2 + (HIP_Y - (yy + LEG_TOP)) ** 2)
    disc_a = np.clip((R - d) / 1.4, 0.0, 1.0) * 255.0

    for y in range(0, h):
        if y + LEG_TOP >= HIP_Y:
            break                              # 髋线以下保留原始轮廓
        dy = HIP_Y - (y + LEG_TOP)
        al[y, :] = 0                           # 先清空整行
        if dy > R:
            continue                           # 圆盘上方不留任何像素
        half = math.sqrt(max(R * R - dy * dy, 0.0))
        lo = max(int(math.floor(c - half)), 0)
        hi = min(int(math.ceil(c + half)), w - 1)
        src = np.clip(np.arange(lo, hi + 1), 0, w - 1)
        a[y, lo:hi + 1, :3] = base_row[src, :3]
        al[y, :] = disc_a[y]                   # 圆盘形 alpha（已含 1.4px 抗锯齿）

    return drop_specks(Image.fromarray(a.astype(np.uint8), "RGBA")), hip_x

legF, hipF = cut_leg(FRONT)
legB, hipB = cut_leg(BACK)

b_body = save(body, "奶蛙-身.png")
b_legF = save(legF, "奶蛙-左腿.png")
b_legB = save(legB, "奶蛙-右腿.png")

meta = {
    "full": [full.width, full.height],
    "body": {"w": body.width, "h": body.height},
    "legFront": {"x": FRONT["l"], "y": LEG_TOP, "w": legF.width, "h": legF.height,
                 "hipX": hipF, "hipY": HIP_Y},
    "legBack":  {"x": BACK["l"],  "y": LEG_TOP, "w": legB.width, "h": legB.height,
                 "hipX": hipB,  "hipY": HIP_Y},
}
json.dump(meta, open(os.path.join(OUT, "rig.json"), "w"), indent=2)
print("\nrig:", json.dumps(meta, ensure_ascii=False))

# 拼一张预览：身体 + 两条腿按原始位置合成，检查接缝
prev = Image.new("RGBA", full.size, (255, 255, 255, 0))
prev.alpha_composite(legB, (BACK["l"], LEG_TOP))
prev.alpha_composite(legF, (FRONT["l"], LEG_TOP))
prev.alpha_composite(body, (0, 0))
prev.save(os.path.join(ROOT, "src", "preview_rig.png"))
print("\n预览已生成 src/preview_rig.png")
