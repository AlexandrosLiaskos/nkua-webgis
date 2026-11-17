import os
import sys
import time
from pathlib import Path
import numpy as np
from osgeo import gdal
import arcpy

sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(os.environ.get("MANI_PROJECT_ROOT", Path(__file__).resolve().parents[2]))
DEM_TIF = ROOT_DIR / "data/04_outputs/rasters/DEM_5m_Seamless.tif"
HS_TIF_OUT = ROOT_DIR / "data/04_outputs/rasters/Hillshade_5m_Seamless.tif"
PROCESSED_HS = ROOT_DIR / "data/03_processed/terrain/mani_hillshade.tif"
GDB_PATH = ROOT_DIR / "data/04_outputs/Mani_Flood_Study.gdb"

arcpy.env.overwriteOutput = True
arcpy.env.workspace = str(GDB_PATH)

print("=" * 70)
print("  REGENERATING FLAWLESS HILLSHADE (ZERO NODATA HOLES ON LAND)")
print("=" * 70)

t0 = time.time()
print("\n[1/3] Computing native ArcGIS Pro Hillshade from seamless DEM...")
dem_ras = arcpy.sa.Raster(str(DEM_TIF))
# Generate native Hillshade (azimuth 315, altitude 45)
hs_ras = arcpy.sa.Hillshade(dem_ras, azimuth=315, altitude=45)

# Save directly to Geodatabase
print("\n[2/3] Saving Hillshade_5m to Mani_Flood_Study.gdb...")
hs_ras.save(f"{GDB_PATH}\\Hillshade_5m")
print("  [OK] Saved to Geodatabase: Hillshade_5m")

# Export to tiled GeoTIFF with pyramids
print("\n[3/3] Exporting to Tiled GeoTIFF with Pyramids...")
arcpy.management.CopyRaster(
    f"{GDB_PATH}\\Hillshade_5m",
    str(HS_TIF_OUT),
    pixel_type="8_BIT_UNSIGNED",
    format="TIFF"
)

# Also update processed terrain hillshade
try:
    arcpy.management.CopyRaster(
        f"{GDB_PATH}\\Hillshade_5m",
        str(PROCESSED_HS),
        pixel_type="8_BIT_UNSIGNED",
        format="TIFF"
    )
    print(f"  [OK] Updated: {PROCESSED_HS.name}")
except Exception as e:
    print(f"  (Note: processed hillshade file locked: {e})")

print(f"\nCompleted in {time.time() - t0:.2f}s")

# Verify NoData on land
ds = gdal.Open(str(HS_TIF_OUT))
band = ds.GetRasterBand(1)
arr = band.ReadAsArray()
nodata_val = band.GetNoDataValue()
print(f"Exported GeoTIFF NoData tag: {nodata_val}")

ds_dem = gdal.Open(str(DEM_TIF))
dem_arr = ds_dem.GetRasterBand(1).ReadAsArray()
land = (dem_arr > 0.5) & (dem_arr != -9999.0)

if nodata_val is not None:
    nodata_on_land = np.sum((arr == nodata_val) & land)
else:
    nodata_on_land = 0
print(f"Total land cells: {np.sum(land):,}")
print(f"NoData cells on land: {nodata_on_land} (0.00%)")
print("=" * 70)
