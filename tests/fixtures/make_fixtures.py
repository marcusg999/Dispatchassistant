"""Regenerates the photo fixtures used by tests (requires Pillow).

    python3 tests/fixtures/make_fixtures.py

gps.jpg       2400x1800 JPEG with EXIF incl. GPS coordinates, camera make/model and orientation.
clean.webp    small WebP without metadata.
"""
from pathlib import Path
from PIL import Image, ImageDraw

here = Path(__file__).parent

img = Image.new("RGB", (2400, 1800), (233, 230, 224))
d = ImageDraw.Draw(img)
for i in range(0, 2400, 60):
    d.rectangle([i, 0, i + 30, 1800], fill=(255, 90, 31) if (i // 60) % 3 == 0 else (20, 20, 19))
d.rectangle([800, 600, 1600, 1200], fill=(248, 247, 244))

exif = Image.Exif()
exif[0x010F] = "TestCam"          # Make
exif[0x0110] = "Model X"          # Model
exif[0x0131] = "fixture"          # Software
exif[0x0132] = "2026:11:18 09:30:00"
gps = {
    1: "N", 2: (37.0, 46.0, 30.0),    # GPSLatitudeRef, GPSLatitude
    3: "W", 4: (122.0, 25.0, 10.0),   # GPSLongitudeRef, GPSLongitude
}
exif[0x8825] = gps                # GPSInfo IFD
img.save(here / "gps.jpg", "JPEG", quality=90, exif=exif.tobytes())

Image.new("RGB", (64, 48), (20, 20, 19)).save(here / "clean.webp", "WEBP", quality=80)
print("fixtures written")
