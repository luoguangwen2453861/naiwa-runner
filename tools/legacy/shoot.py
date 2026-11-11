# 早期原型，已被 shoot3/4/5 等专用脚本取代，仅作历史参考
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

inject = """
<script>
(function(){
  function K(code){ window.dispatchEvent(new KeyboardEvent('keydown',{code:code})); }
  function U(code){ window.dispatchEvent(new KeyboardEvent('keyup',{code:code})); }
  var jumpAt = [900, 1700, 2500, 3400, 4300, 5200, 6100, 7000, 8000, 9000, 10000];
  setTimeout(function(){ document.getElementById('startBtn').click(); }, 250);
  jumpAt.forEach(function(t){
    setTimeout(function(){ K('Space'); setTimeout(function(){ U('Space'); }, 80); }, t);
  });
})();
</script>
"""

test = src.replace("</body>", inject + "</body>")
p = os.path.join(ROOT, "shots", "test.html")
open(p, "w", encoding="utf-8").write(test)

budgets = [1500, 3000, 5200, 8000]
for b in budgets:
    out = os.path.join(ROOT, "shots", f"play_{b}.png")
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1280,720",
        f"--virtual-time-budget={b}",
        f"--screenshot={out}",
        "file:///" + p.replace("\\", "/"),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    print(b, "->", os.path.basename(out), os.path.getsize(out) if os.path.exists(out) else "FAILED")
