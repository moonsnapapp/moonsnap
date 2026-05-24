import os
from PIL import Image

dirs = [
    r"E:\moonsnap\apps\desktop\src-tauri\icons",
    r"E:\moonsnap\apps\web\public",
    r"E:\moonsnap\apps\web\src\app",
]
for d in dirs:
    if not os.path.isdir(d):
        continue
    for f in sorted(os.listdir(d)):
        p = os.path.join(d, f)
        if f.lower().endswith((".png", ".ico", ".icns")):
            try:
                im = Image.open(p)
                print(f"{p}: {im.size} mode={im.mode}")
            except Exception as e:
                print(f"{p}: ERR {e}")
