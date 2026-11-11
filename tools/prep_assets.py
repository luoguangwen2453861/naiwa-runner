import base64, io, json, os
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

SRC = os.path.join(os.path.dirname(ROOT), "asserts", "emotes")
OUT = os.path.join(ROOT, "assets")
os.makedirs(OUT, exist_ok=True)

def strip_white(path, tol=14, feather=1.2):
    img = Image.open(path).convert("RGBA")
    a = np.array(img)
    h, w = a.shape[:2]
    rgb = a[:, :, :3].astype(np.int16)
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)
    # near-white and low saturation
    cand = (mn > 255 - tol * 4) & ((mx - mn) < 18)

    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and cand[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    alpha = np.where(visited, 0, 255).astype(np.uint8)
    am = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(feather))
    alpha = np.array(am).astype(np.float32) / 255.0

    # 反预乘：去掉与白底混合产生的白边
    rgb_f = a[:, :, :3].astype(np.float32)
    af = alpha[..., None]
    denom = np.maximum(af, 0.08)
    recovered = (rgb_f - 255.0 * (1.0 - af)) / denom
    recovered = np.clip(recovered, 0, 255)
    edge = (alpha > 0.02) & (alpha < 0.995)
    rgb_f[edge] = recovered[edge]

    out = np.dstack([rgb_f, alpha * 255.0]).astype(np.uint8)
    out = Image.fromarray(out, "RGBA")
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    # 统一朝右（原素材均为左侧朝向）
    out = out.transpose(Image.FLIP_LEFT_RIGHT)
    # 裁掉贴地处的白色反光残留
    w, h = out.size
    out = out.crop((0, 0, w, max(1, h - 3)))
    return out

def export(name, target_h, quality_note=""):
    src = os.path.join(SRC, name)
    im = strip_white(src)
    w, h = im.size
    scale = target_h / h
    im = im.resize((max(1, int(w * scale)), target_h), Image.LANCZOS)
    p = os.path.join(OUT, name)
    im.save(p, "PNG", optimize=True)
    print(f"{name}: {im.size}, {os.path.getsize(p)//1024} KB {quality_note}")
    return p

files = [
    ("奶蛙-侧立.png", 260),
    ("奶蛙-气鼓鼓.png", 220),
    ("奶蛙-双V吐舌.png", 220),
    ("奶蛙-露齿大笑.png", 220),
]
for f, h in files:
    export(f, h)

print("\n--- base64 sizes ---")
for f, _ in files:
    p = os.path.join(OUT, f)
    b = base64.b64encode(open(p, "rb").read()).decode()
    print(f"{f}: {len(b)//1024} KB b64")
