# 临时验证：沙箱跑完是否留下产物（跑完即删）
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

PY = sys.executable
ROOT = r"D:/projects/checkin/CheckinApp/tools/pylab"
tmp = tempfile.gettempdir()

# 1) 造一个「被强杀」留下的超龄残骸
fake = tempfile.mkdtemp(prefix="pylab-fake-old-", dir=tmp)
old = time.time() - 3600
os.utime(fake, (old, old))
print("造残骸:", fake)

# 2) 模拟网页一次 run_source（带 tkinter，最容易留 __pycache__）
payload = json.dumps({
    "action": "run_source",
    "code": "import tkinter as tk\nr = tk.Tk()\ntk.Label(r, text='x').pack()\n"
            "tk.Button(r, text='b').pack()\nprint('done')"
})
proc = subprocess.run([PY, os.path.join(ROOT, "main.py"), "--json"],
                      input=payload, capture_output=True, text=True,
                      encoding="utf-8", cwd=ROOT)
resp = json.loads(proc.stdout)
run = resp["data"]["result"]["run"]
print("运行 ok:", run["ok"], "| 输出:", run["output"].strip(), "| UI:", bool(run["ui"]))

# 3) 结果
left = sorted(n for n in os.listdir(tmp)
              if n.startswith("pylab-") or n.startswith("lo-profile-"))
pycache = os.path.join(ROOT, "uishim", "tkinter", "__pycache__")
print("超龄残骸已回收:", not os.path.exists(fake))
print("临时目录残留:", left)
print("uishim __pycache__ 存在:", os.path.isdir(pycache))
