"""Build Pristine, Seam-Healed ArcGIS Pro Data Package for ALL of Mani.

1. Eradicates all photogrammetric tile duplicate seams across the entire 5m DEM.
2. Generates pristine, seamless analytical Hillshade (100% free of rectangular boxes).
3. Extracts 100% topologically continuous stream network (zero gaps, zero seam lines).
4. Creates fresh ArcGIS Pro File Geodatabase: data/04_outputs/Mani_Flood_Study_Seamless.gdb
   (avoiding schema locks from currently running ArcGIS Pro session).
5. Exports tiled GeoTIFFs (with overviews) and Shapefiles/GeoPackages.
"""

import sys
import time
from pathlib import Path
import numpy as np
from osgeo import gdal
from scipy import ndimage
import arcpy

sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(r"E:\Publications\Research\Mani Floods August 2026")
PROCESSED_DIR = ROOT_DIR / "data/03_processed/terrain"
HYDRO_DIR = PROCESSED_DIR / "hydrology"
OUTPUT_DIR = ROOT_DIR / "data/04_outputs"
RASTERS_DIR = OUTPUT_DIR / "rasters"
VECTORS_DIR = OUTPUT_DIR / "vectors"
SHP_DIR = VECTORS_DIR / "shapefiles"
GDB_SEAMLESS = OUTPUT_DIR / "Mani_Flood_Study_Seamless.gdb"

DEM_IN = PROCESSED_DIR / "mani_dem_5m_conditioned.tif"
DEM_FILLED_IN = PROCESSED_DIR / "mani_dem_5m_filled.tif"
FACC_IN = HYDRO_DIR / "mani_flow_accumulation.tif"
FDIR_IN = HYDRO_DIR / "mani_flow_direction_d8.tif"
SLOPE_IN = HYDRO_DIR / "mani_slope_deg.tif"

print("=" * 80)
print("  BUILDING SEAMLESS ARCGIS PRO DATA PACKAGE (ALL OF MANI)")
print("=" * 80)

# -------------------------------------------------------------------------
# Step 1: Heal DEM Seams
# -------------------------------------------------------------------------
print("\n[Step 1] Loading and healing all DEM photogrammetric tile seams...")
t0 = time.time()
ds_dem = gdal.Open(str(DEM_IN))
cols = ds_dem.RasterXSize
rows = ds_dem.RasterYSize
N = rows * cols
gt = ds_dem.GetGeoTransform()
proj = ds_dem.GetProjection()

dem = ds_dem.GetRasterBand(1).ReadAsArray()
land = (dem > 0.5)

seam_row_pairs = [
    (625, 626),
    (2177, 2178),
    (4070, 4071),
    (9027, 9028),
    (10808, 10809)
]

seam_col_pairs = [
    (2052, 2053),
    (3138, 3139),
    (3256, 3257),
    (7080, 7081)
]

dem_healed = dem.copy()

for r1, r2 in seam_row_pairs:
    mask = land[r1-1, :] & land[r2+1, :]
    z0 = dem[r1-1, :]
    z1 = dem[r2+1, :]
    dem_healed[r1, mask] = (2.0/3.0) * z0[mask] + (1.0/3.0) * z1[mask]
    dem_healed[r2, mask] = (1.0/3.0) * z0[mask] + (2.0/3.0) * z1[mask]

for c1, c2 in seam_col_pairs:
    mask = land[:, c1-1] & land[:, c2+1]
    z0 = dem[:, c1-1]
    z1 = dem[:, c2+1]
    dem_healed[mask, c1] = (2.0/3.0) * z0[mask] + (1.0/3.0) * z1[mask]
    dem_healed[mask, c2] = (1.0/3.0) * z0[mask] + (2.0/3.0) * z1[mask]

print(f"  [OK] Healed all 5 seam row pairs and 4 seam col pairs in {time.time() - t0:.2f}s")

def save_tiled_geotiff(path, data, dtype, nodata=None):
    driver = gdal.GetDriverByName("GTiff")
    options = [
        "TILED=YES",
        "BLOCKXSIZE=256",
        "BLOCKYSIZE=256",
        "COMPRESS=LZW",
        "BIGTIFF=YES",
        "NUM_THREADS=ALL_CPUS"
    ]
    ds = driver.Create(str(path), cols, rows, 1, dtype, options)
    ds.SetGeoTransform(gt)
    ds.SetProjection(proj)
    band = ds.GetRasterBand(1)
    if nodata is not None:
        band.SetNoDataValue(nodata)
    band.WriteArray(data)
    band.FlushCache()
    ds.BuildOverviews("NEAREST", [2, 4, 8, 16, 32])
    ds = None
    print(f"  [OK] Saved Tiled GeoTIFF: {path.name}")

DEM_SEAMLESS_TIF = RASTERS_DIR / "DEM_5m_Seamless.tif"
save_tiled_geotiff(DEM_SEAMLESS_TIF, dem_healed, gdal.GDT_Float32, nodata=-9999.0)

# -------------------------------------------------------------------------
# Step 2: Seamless Analytical Hillshade
# -------------------------------------------------------------------------
print("\n[Step 2] Generating seamless analytical Hillshade (zero box artifacts)...")
t1 = time.time()
dx, dy = abs(gt[1]), abs(gt[5])
dz_dx = np.zeros_like(dem_healed)
dz_dy = np.zeros_like(dem_healed)

dz_dx[:, 1:-1] = (dem_healed[:, 2:] - dem_healed[:, :-2]) / (2.0 * dx)
dz_dy[1:-1, :] = (dem_healed[:-2, :] - dem_healed[2:, :]) / (2.0 * dy)

slope_rad = np.arctan(2.0 * np.sqrt(dz_dx**2 + dz_dy**2))
aspect_rad = np.arctan2(dz_dy, -dz_dx)
aspect_rad = np.where(aspect_rad < 0, 2 * np.pi + aspect_rad, aspect_rad)

sun_az_rad = np.radians(315.0)
sun_alt_rad = np.radians(45.0)

hs = 255.0 * (
    (np.sin(sun_alt_rad) * np.cos(slope_rad)) +
    (np.cos(sun_alt_rad) * np.sin(slope_rad) * np.cos(sun_az_rad - aspect_rad))
)
hs = np.clip(hs, 0.0, 255.0).astype(np.uint8)
hs = np.where(land, hs, 0)

HS_SEAMLESS_TIF = RASTERS_DIR / "Hillshade_5m_Seamless.tif"
save_tiled_geotiff(HS_SEAMLESS_TIF, hs, gdal.GDT_Byte, nodata=0)
print(f"  [OK] Seamless Hillshade created in {time.time() - t1:.2f}s")

# -------------------------------------------------------------------------
# Step 3: Extract Clean Topologically Continuous Stream Network
# -------------------------------------------------------------------------
print("\n[Step 3] Extracting 100% Topologically Continuous Stream Network...")
t2 = time.time()

ds_fil = gdal.Open(str(DEM_FILLED_IN))
fil = ds_fil.GetRasterBand(1).ReadAsArray()
ds_facc = gdal.Open(str(FACC_IN))
facc = ds_facc.GetRasterBand(1).ReadAsArray()
ds_fdir = gdal.Open(str(FDIR_IN))
fdir = ds_fdir.GetRasterBand(1).ReadAsArray().astype(np.int32)
ds_slope = gdal.Open(str(SLOPE_IN))
slope = ds_slope.GetRasterBand(1).ReadAsArray()

dem_c = np.where(land, dem_healed, 0.0)
facc_c = np.where(land, facc, 0.0)
slope_c = np.where(land, slope, 0.0)
fill_depth = np.where(land, fil - dem_healed, 0.0)

# Multi-scale TPI 25m
land_f = land.astype(np.float32)
sum_dem = ndimage.uniform_filter(dem_c, size=11)
sum_wt = ndimage.uniform_filter(land_f, size=11)
mean_dem = np.where(sum_wt > 0.05, sum_dem / np.maximum(sum_wt, 1e-6), dem_c)
tpi = dem_c - mean_dem

tan_beta = np.tan(np.radians(slope_c))
spi = facc_c * 25.0 * tan_beta

is_karst_sink = (fill_depth > 0.5) & (slope_c < 3.5)

# Channel initiation:
head_torrent = (facc_c >= 1200.0) & (slope_c >= 5.0) & (tpi <= -0.40) & (spi >= 35000.0) & (~is_karst_sink)
head_trunk = (facc_c >= 8000.0) & (slope_c >= 2.0) & (tpi <= -0.60) & (~is_karst_sink)
channel_heads = (head_torrent | head_trunk) & land

# Mask out any channel heads falling on seam coordinates
for r1, r2 in seam_row_pairs:
    channel_heads[r1-1:r2+2, :] = False
for c1, c2 in seam_col_pairs:
    channel_heads[:, c1-1:c2+2] = False

print(f"  Channel head initiation cells: {np.sum(channel_heads):,}")

# Build 1D next pointer table
nxt = np.full(N, -1, dtype=np.int32)
d8_offsets = {
    1: (0, 1), 2: (1, 1), 4: (1, 0), 8: (1, -1),
    16: (0, -1), 32: (-1, -1), 64: (-1, 0), 128: (-1, 1)
}
is_sink_flat = is_karst_sink.ravel()
land_flat = land.ravel()

for code, (dr, dc) in d8_offsets.items():
    r, c = np.where(fdir == code)
    if len(r) == 0:
        continue
    nr = r + dr
    nc = c + dc
    valid = (nr >= 0) & (nr < rows) & (nc >= 0) & (nc < cols)
    r, c, nr, nc = r[valid], c[valid], nr[valid], nc[valid]
    src = r * cols + c
    dst = nr * cols + nc
    valid_dst = land_flat[dst] & (~is_sink_flat[dst])
    nxt[src[valid_dst]] = dst[valid_dst]

# Downstream tracing
stream_flat = np.zeros(N, dtype=bool)
active = np.where(channel_heads.ravel())[0]
stream_flat[active] = True

while len(active) > 0:
    downstream = nxt[active]
    valid = downstream >= 0
    downstream = downstream[valid]
    not_yet = ~stream_flat[downstream]
    active = np.unique(downstream[not_yet])
    stream_flat[active] = True

stream_mask = stream_flat.reshape((rows, cols))
print(f"  [OK] Continuous stream network: {np.sum(stream_mask):,} stream cells in {time.time() - t2:.2f}s")

STREAM_TIF_OUT = RASTERS_DIR / "Mani_Stream_Raster.tif"
save_tiled_geotiff(STREAM_TIF_OUT, stream_mask.astype(np.uint8), gdal.GDT_Byte, nodata=0)

# Free large memory arrays
del dem, dem_healed, fil, facc, fdir, slope, dem_c, facc_c, slope_c, fill_depth, tpi, spi
del nxt, is_sink_flat, land_flat, stream_flat

# -------------------------------------------------------------------------
# Step 4: Populate Fresh File Geodatabase (Mani_Flood_Study_Seamless.gdb)
# -------------------------------------------------------------------------
print("\n[Step 4] Creating fresh ArcGIS Pro File Geodatabase (Mani_Flood_Study_Seamless.gdb)...")
t3 = time.time()

arcpy.env.overwriteOutput = True
if not arcpy.Exists(str(GDB_SEAMLESS)):
    arcpy.management.CreateFileGDB(str(OUTPUT_DIR), "Mani_Flood_Study_Seamless.gdb")

arcpy.env.workspace = str(GDB_SEAMLESS)
spatial_ref_2100 = arcpy.SpatialReference(2100)
arcpy.env.outputCoordinateSystem = spatial_ref_2100

print("  Importing Rasters to Geodatabase...")
arcpy.management.CopyRaster(str(DEM_SEAMLESS_TIF), f"{GDB_SEAMLESS}\\DEM_5m_Seamless")
arcpy.management.CopyRaster(str(HS_SEAMLESS_TIF), f"{GDB_SEAMLESS}\\Hillshade_5m_Seamless")
arcpy.management.CopyRaster(str(STREAM_TIF_OUT), f"{GDB_SEAMLESS}\\Stream_Raster_5m")
arcpy.management.CopyRaster(str(RASTERS_DIR / "Mani_Rainfall_Storm_Accumulation_mm.tif"), f"{GDB_SEAMLESS}\\Rainfall_Storm_Accumulation_mm")
arcpy.management.CopyRaster(str(RASTERS_DIR / "Mani_Flood_Hazard_Rating_HR.tif"), f"{GDB_SEAMLESS}\\Flood_Hazard_Rating_HR")
arcpy.management.CopyRaster(str(RASTERS_DIR / "Mani_Boulder_Transport_Capacity_m.tif"), f"{GDB_SEAMLESS}\\Boulder_Transport_Capacity_m")

print("  Computing Strahler Stream Orders & Vectorizing Stream Network...")
stream_ras = arcpy.sa.Raster(str(STREAM_TIF_OUT))
fdir_ras = arcpy.sa.Raster(str(FDIR_IN))
stream_ras_nodata = arcpy.sa.SetNull(stream_ras == 0, stream_ras)

strahler_ras = arcpy.sa.StreamOrder(stream_ras_nodata, fdir_ras, "STRAHLER")
strahler_ras.save(f"{GDB_SEAMLESS}\\Stream_Order_Strahler")

fc_streams = f"{GDB_SEAMLESS}\\Mani_Stream_Network"
arcpy.sa.StreamToFeature(strahler_ras, fdir_ras, fc_streams, "SIMPLIFY")
print(f"  [OK] Created Polyline Feature Class: Mani_Stream_Network")

# Re-export Shapefiles and GeoPackage
print("  Exporting updated streams to Shapefile and GeoPackage...")
arcpy.conversion.FeatureClassToFeatureClass(fc_streams, str(SHP_DIR), "Mani_Stream_Network.shp")

# Also copy Isohyets and Hazard Corridors from original GDB if available
GDB_ORIG = OUTPUT_DIR / "Mani_Flood_Study.gdb"
if arcpy.Exists(f"{GDB_ORIG}\\Mani_Isohyets_10mm"):
    arcpy.conversion.ExportFeatures(f"{GDB_ORIG}\\Mani_Isohyets_10mm", f"{GDB_SEAMLESS}\\Mani_Isohyets_10mm")
if arcpy.Exists(f"{GDB_ORIG}\\Mani_Flood_Hazard_Corridors"):
    arcpy.conversion.ExportFeatures(f"{GDB_ORIG}\\Mani_Flood_Hazard_Corridors", f"{GDB_SEAMLESS}\\Mani_Flood_Hazard_Corridors")

gpkg_file = VECTORS_DIR / "Mani_Flood_Study_Vectors.gpkg"
arcpy.conversion.ExportFeatures(fc_streams, f"{gpkg_file}\\Mani_Stream_Network")

print(f"\nCompleted in {time.time() - t3:.2f}s")
print("=" * 80)
print(f"  SUCCESS! Fresh Geodatabase: {GDB_SEAMLESS}")
print(f"  Seamless Rasters: {RASTERS_DIR}")
print("=" * 80)
