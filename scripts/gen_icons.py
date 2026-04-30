#!/usr/bin/env python3
"""
Generate the Tauri app icon from a source PNG.
Usage: python3 scripts/gen_icons.py [icon.png]
"""

import os
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/icons/icon.png"
ICONS_DIR = "src-tauri/icons"


def make_icon(size: int) -> Image.Image:
    img = Image.open(SRC).convert("RGBA").resize((size, size), Image.LANCZOS)
    return img


def ensure_source():
    if not os.path.exists(SRC):
        # Generate a simple placeholder
        img = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        from PIL import ImageDraw
        draw = ImageDraw.Draw(img)
        draw.ellipse([50, 50, 974, 974], fill=(26, 26, 46, 255))
        draw.ellipse([200, 200, 824, 824], fill=(79, 195, 247, 255))
        img.save(SRC)
        print(f"Generated placeholder source icon: {SRC}")


def gen_app_icon():
    make_icon(1024).save(os.path.join(ICONS_DIR, "icon.png"))
    print("  icon.png (1024px)")


os.makedirs(ICONS_DIR, exist_ok=True)
ensure_source()

print("Generating app icon...")
gen_app_icon()

print("Done.")
