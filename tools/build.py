# -*- coding: utf-8 -*-
"""把 index.template.html 里的图片占位符替换成 base64，产出单文件 index.html

用法:
    python tools/build.py            # 只产出 index.html
    python tools/build.py --dist     # 同时写一份到 dist/index.html（发布用）
"""
import os, re, sys, base64

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def data_uri(name):
    p = os.path.join(ROOT, "assets", name)
    b = base64.b64encode(open(p, "rb").read()).decode()
    return "data:image/png;base64," + b

mapping = {
    "__IMG_BODY__":  data_uri("奶蛙-身.png"),
    "__IMG_LEGF__":  data_uri("奶蛙-左腿.png"),
    "__IMG_LEGB__":  data_uri("奶蛙-右腿.png"),
    "__IMG_HAPPY__": data_uri("奶蛙-露齿大笑.png"),
    "__IMG_ANGRY__": data_uri("奶蛙-气鼓鼓.png"),
}

with open(os.path.join(ROOT, "index.template.html"), encoding="utf-8") as f:
    out = f.read()
for k, v in mapping.items():
    assert k in out, "placeholder missing: " + k
    out = out.replace(k, v)

def write(path):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print("written:", path, "%.1f KB" % (os.path.getsize(path) / 1024))

write(os.path.join(ROOT, "index.html"))
if "--dist" in sys.argv:
    write(os.path.join(ROOT, "dist", "index.html"))

print("remaining placeholders:", re.findall(r"__IMG_\w+__", out))
