#!/usr/bin/env python3
"""
Generate Tauri-required icons from a source PNG.
On macOS: produces a real .icns via iconutil.
On other platforms: produces a PNG stub (macOS builds should run on macOS CI).
Usage: python3 scripts/gen_icons.py [source.png]
"""

import os
import sys
import shutil
import subprocess
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "src-tauri/icons/source.png"
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


def gen_png_icons():
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "tray.png": 32,
    }
    for name, size in sizes.items():
        make_icon(size).save(os.path.join(ICONS_DIR, name))
        print(f"  {name} ({size}px)")


def gen_ico():
    imgs = [make_icon(s) for s in [16, 32, 48, 64, 128, 256]]
    path = os.path.join(ICONS_DIR, "icon.ico")
    imgs[0].save(
        path,
        format="ICO",
        append_images=imgs[1:],
        sizes=[(s, s) for s in [16, 32, 48, 64, 128, 256]],
    )
    print(f"  icon.ico")


def gen_icns_macos():
    """Use macOS iconutil to create a proper .icns file."""
    iconset = os.path.join(ICONS_DIR, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)

    # Required sizes for macOS iconset
    required = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]

    for name, size in required:
        make_icon(size).save(os.path.join(iconset, name))

    out = os.path.join(ICONS_DIR, "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
    shutil.rmtree(iconset)
    print(f"  icon.icns (real, via iconutil)")


def gen_icns_fallback():
    """Non-macOS: save a 1024px PNG stub. CI should run on macOS for .icns."""
    make_icon(1024).save(os.path.join(ICONS_DIR, "icon.icns"))
    print("  icon.icns (PNG stub — real ICNS requires macOS)")


os.makedirs(ICONS_DIR, exist_ok=True)
ensure_source()

print("Generating PNG icons...")
gen_png_icons()

print("Generating icon.ico...")
gen_ico()

print("Generating icon.icns...")
if sys.platform == "darwin" and shutil.which("iconutil"):
    gen_icns_macos()
else:
    gen_icns_fallback()

print("Done.")
