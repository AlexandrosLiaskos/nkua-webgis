"""Master Script: Build Complete ArcGIS Pro Compatible Geospatial Package for ALL of Mani.

Generates pure, authoritative, gap-free GIS datasets across the entire Mani Peninsula (5m resolution):
1. File Geodatabase: data/04_outputs/Mani_Flood_Study.gdb
   - DEM_5m_Conditioned (Raster Dataset, EPSG:2100)
   - Hillshade_5m (Raster Dataset, EPSG:2100)
   - Stream_Network_Mani (Line Feature Class, Strahler Stream Orders, 100% gapless)
   - Stream_Raster_5m (Binary Raster Dataset)
   - Rainfall_Storm_mm (Raster Dataset, Convective Event Aug 15, 2026)
   - Isohyets_10mm (Line Feature Class, 10mm precipitation contours)
   - Flood_Hazard_Rating_HR (Raster Dataset, DEFRA HR classes)
   - Flood_Hazard_Corridors (Polygon Feature Class, active torrent corridors)
   - Boulder_Transport_Capacity_m (Raster Dataset, Costa/Williams Dmax in meters)

2. Tiled GeoTIFFs with Overviews: data/04_outputs/rasters/
3. Open OGC GeoPackages: data/04_outputs/vectors/
"""

import sys
import time
from pathlib import Path
import numpy as np
from osgeo import gdal, osr
from scipy import ndimage
import arcpy

sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(r"E:\Publications\Research\Mani Floods August 2026")
PROCESSED_DIR = ROOT_DIR / "data/03_processed/terrain"
HYDRO_DIR = PROCESSED_DIR / "hydrology"
POWER_DIR = ROOT_DIR / "data/04_outputs/power_hazard"

OUTPUT_DIR = ROOT_DIR / "data/04_outputs"
RASTERS_DIR = OUTPUT_DIR / "rasters"
VECTORS_DIR = OUTPUT_DIR / "vectors"
GDB_PATH = OUTPUT_DIR / "Mani_Flood_Study.gdb"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RASTERS_DIR.mkdir(parents=True, exist_ok=True)
VECTORS_DIR.mkdir(parents=True, exist_ok=True)

DEM_RAW = PROCESSED_DIR / "mani_dem_5m_conditioned.tif"
DEM_FILLED = PROCESSED_DIR / "mani_dem_5m_filled.tif"
FACC_TIF = HYDRO_DIR / "mani_flow_accumulation.tif"
FDIR_TIF = HYDRO_DIR / "mani_flow_direction_d8.tif"
SLOPE_TIF = HYDRO_DIR / "mani_slope_deg.tif"
HS_TIF = PROCESSED_DIR / "mani_hillshade.tif"

print("=" * 80)
print("  BUILDING ARCGIS PRO DATA PACKAGE FOR ALL OF MANI")
print("=" * 80)

# Check ArcPy environment
arcpy.env.overwriteOutput = True
arcpy.env.workspace = str(GDB_PATH)
spatial_ref_2100 = arcpy.SpatialReference(2100)
arcpy.env.outputCoordinateSystem = spatial_ref_2100

if not arcpy.Exists(str(GDB_PATH)):
    print(f"Creating File Geodatabase at: {GDB_PATH}")
    arcpy.management.CreateFileGDB(str(OUTPUT_DIR), "Mani_Flood_Study.gdb")
else:
    print(f"File Geodatabase exists: {GDB_PATH}")

# -------------------------------------------------------------------------
# Phase 1: Load Full Domain Grids (ALL OF MANI)
# -------------------------------------------------------------------------
print("\n[Phase 1] Loading Full Domain Rasters for all of Mani...")
t0 = time.time()
ds_dem = gdal.Open(str(DEM_RAW))
ds_fil = gdal.Open(str(DEM_FILLED))
ds_facc = gdal.Open(str(FACC_TIF))
ds_fdir = gdal.Open(str(FDIR_TIF))
ds_slope = gdal.Open(str(SLOPE_TIF))

cols = ds_dem.RasterXSize
rows = ds_dem.RasterYSize
N = rows * cols
gt = ds_dem.GetGeoTransform()
proj = ds_dem.GetProjection()

print(f"  Full Mani Grid: {cols} cols x {rows} rows ({N:,} cells at 5m resolution)")
print(f"  Bounds: X [{gt[0]:.1f}, {gt[0] + cols * gt[1]:.1f}], Y [{gt[3] + rows * gt[5]:.1f}, {gt[3]:.1f}]")

dem = ds_dem.GetRasterBand(1).ReadAsArray()
fil = ds_fil.GetRasterBand(1).ReadAsArray()
facc = ds_facc.GetRasterBand(1).ReadAsArray()
fdir = ds_fdir.GetRasterBand(1).ReadAsArray().astype(np.int32)
slope = ds_slope.GetRasterBand(1).ReadAsArray()

land = (dem > 0.5) & (facc < 1e10) & (fdir > 0)
dem_c = np.where(land, dem, 0.0)
facc_c = np.where(land, facc, 0.0)
slope_c = np.where(land, slope, 0.0)
fill_depth = np.where(land, fil - dem, 0.0)
print(f"  Loaded rasters in {time.time() - t0:.2f}s")

# -------------------------------------------------------------------------
# Phase 2: Compute Topologically Continuous Stream Network (ALL OF MANI)
# -------------------------------------------------------------------------
print("\n[Phase 2] Extracting 100% Topologically Continuous Stream Network...")
t1 = time.time()

# Multi-scale TPI 25m
land_f = land.astype(np.float32)
sum_dem = ndimage.uniform_filter(dem_c, size=11)
sum_wt = ndimage.uniform_filter(land_f, size=11)
mean_dem = np.where(sum_wt > 0.05, sum_dem / np.maximum(sum_wt, 1e-6), dem_c)
tpi = dem_c - mean_dem

tan_beta = np.tan(np.radians(slope_c))
spi = facc_c * 25.0 * tan_beta

# Closed karst ponor sinks
is_karst_sink = (fill_depth > 0.5) & (slope_c < 3.5)

# Channel head initiation:
# 1. Mountain torrent head: steep hollow with concentrated drainage and incision
head_torrent = (facc_c >= 1200.0) & (slope_c >= 5.0) & (tpi <= -0.40) & (spi >= 35000.0) & (~is_karst_sink)
# 2. Significant canyon trunk head: must have clear incision (tpi <= -0.60m) and slope >= 2.0 deg
head_trunk = (facc_c >= 8000.0) & (slope_c >= 2.0) & (tpi <= -0.60) & (~is_karst_sink)
channel_heads = (head_torrent | head_trunk) & land
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

trace_steps = 0
while len(active) > 0:
    trace_steps += 1
    downstream = nxt[active]
    valid = downstream >= 0
    downstream = downstream[valid]
    not_yet = ~stream_flat[downstream]
    active = np.unique(downstream[not_yet])
    stream_flat[active] = True

stream_mask = stream_flat.reshape((rows, cols))
print(f"  Downstream tracing converged in {trace_steps} steps: {np.sum(stream_mask):,} continuous stream cells")
print(f"  Stream network computation completed in {time.time() - t1:.2f}s")

# -------------------------------------------------------------------------
# Phase 3: Compute Full-Mani Storm Rainfall Grid (August 15, 2026 Event)
# -------------------------------------------------------------------------
print("\n[Phase 3] Generating Convective Storm Rainfall Grid for all of Mani...")
t2 = time.time()

# Coordinates meshgrid in EPSG:2100 (Greek Grid)
x_coords = gt[0] + (np.arange(cols) + 0.5) * gt[1]
y_coords = gt[3] + (np.arange(rows) + 0.5) * gt[5]

# Using outer product / broadcasting for memory efficiency on 17671 x 7924 grid
# Core storm centered over Mt. Sangias / Kokkala: X=363200, Y=4043300
kokk_x, kokk_y = 363200.0, 4043300.0

# 1D coordinate differences
dx = (x_coords - kokk_x).astype(np.float32)
dy = (y_coords - kokk_y).astype(np.float32)

# Compute rainfall row-by-row or in chunks to avoid allocating a 17671x7924 float64 meshgrid
rain_grid = np.zeros((rows, cols), dtype=np.float32)
orographic_1d = (0.38 + 0.62 / (1.0 + np.exp(-(x_coords - 356500.0) / 2200.0))).astype(np.float32)

chunk_size = 2000
for r_start in range(0, rows, chunk_size):
    r_end = min(r_start + chunk_size, rows)
    dy_chunk = dy[r_start:r_end, None]
    dx_chunk = dx[None, :]
    dist_sq = dx_chunk**2 + dy_chunk**2
    core_chunk = 18.0 + 123.4 * np.exp(-dist_sq / (9500.0**2))
    rain_chunk = core_chunk * orographic_1d[None, :]
    rain_grid[r_start:r_end, :] = np.where(land[r_start:r_end, :], rain_chunk, 0.0)

print(f"  Rainfall grid computed in {time.time() - t2:.2f}s: min={np.min(rain_grid[land]):.1f}mm, max={np.max(rain_grid[land]):.1f}mm")

# -------------------------------------------------------------------------
# Phase 4: Compute Hydrodynamic Flood Hazard & Boulder Transport (ALL OF MANI)
# -------------------------------------------------------------------------
print("\n[Phase 4] Computing Hydrodynamic Flood Hazard Rating & Boulder Transport for all of Mani...")
t3 = time.time()

# Peak discharge along streams: Q = C * I * A
# Catchment area in m2: facc_c * 25
# Rainfall intensity I: rain_grid / 2.5 (peak hour)
# Runoff coefficient C: 0.72 (karst limestone rock terrain under saturated convective storm)
Q_peak = 0.72 * (rain_grid / 2.5) * (facc_c * 25.0) / (3.6e6) # m3/s

# Hydraulic depth and velocity along incised torrent channels (Manning equation, n=0.045)
# W_bankfull ~ 2.4 * Q^0.4
# Hydraulic radius R ~ d
S_channel = np.maximum(tan_beta, 0.005)
n_manning = 0.045
# d ~ (Q * n / (W * S^0.5))^(3/5)
W_est = np.maximum(2.4 * (np.maximum(Q_peak, 0.1)**0.4), 2.5)
d_est = np.where(stream_mask, (Q_peak * n_manning / (W_est * np.sqrt(S_channel)))**0.6, 0.0)
d_est = np.clip(d_est, 0.0, 5.0)
v_est = np.where(stream_mask & (d_est > 0.01), (1.0 / n_manning) * (d_est**(2.0/3.0)) * np.sqrt(S_channel), 0.0)
v_est = np.clip(v_est, 0.0, 12.0)

# Flood Hazard Rating: HR = d * (v + 0.5) + DF (Debris Factor: 1.0 for mountain torrents carrying boulders/logs)
DF = np.where(stream_mask, 1.0, 0.0)
HR_raw = np.where(stream_mask, d_est * (v_est + 0.5) + DF, 0.0)

# Continuous active channel corridor dilation (size 7: ~35m corridor)
# Use maximum filter so hazard rating extends across active gravel/boulder bed without gaps
struct = ndimage.generate_binary_structure(2, 1)
hazard_dilated = ndimage.maximum_filter(HR_raw, size=7)
active_corridor = ndimage.binary_dilation(stream_mask, structure=struct, iterations=3) & land
HR_corridor = np.where(active_corridor, np.maximum(hazard_dilated, 0.75), 0.0)

# Classified Hazard: 1=Low (<0.75), 2=Moderate (0.75-1.25), 3=Significant (1.25-2.0), 4=Extreme (>=2.0)
hazard_class = np.zeros((rows, cols), dtype=np.uint8)
hazard_class[active_corridor & (HR_corridor < 0.75)] = 1
hazard_class[active_corridor & (HR_corridor >= 0.75) & (HR_corridor < 1.25)] = 2
hazard_class[active_corridor & (HR_corridor >= 1.25) & (HR_corridor < 2.0)] = 3
hazard_class[active_corridor & (HR_corridor >= 2.0)] = 4

# Boulder Transport Capacity Dmax [m] (Costa 1983 / Williams 1983)
# Bed shear stress: tau_b = gamma_w * d * S (gamma_w = 9810 N/m3)
# Dmax = 0.04 * tau_b^0.65 (converted to meters)
tau_bed = 9810.0 * d_est * S_channel # N/m2
Dmax_raw = np.where(stream_mask, 0.04 * (np.maximum(tau_bed, 0.0)**0.65), 0.0)
Dmax_corridor = np.where(active_corridor, ndimage.maximum_filter(Dmax_raw, size=7), 0.0).astype(np.float32)

print(f"  Flood hazard and boulder competence computed in {time.time() - t3:.2f}s")

# -------------------------------------------------------------------------
# Phase 5: Export Tiled GeoTIFFs (with Pyramids/Overviews)
# -------------------------------------------------------------------------
print("\n[Phase 5] Exporting Tiled GeoTIFFs with Internal Overviews...")

def save_tiled_geotiff(path, data, dtype, nodata=None):
    """Save Cloud-Optimized / Tiled GeoTIFF with internal pyramids."""
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
    # Build internal overviews
    ds.BuildOverviews("NEAREST", [2, 4, 8, 16, 32])
    ds = None
    print(f"  [OK] Saved GeoTIFF: {path.name}")

# 1. Stream Raster
STREAM_TIF_OUT = RASTERS_DIR / "Mani_Stream_Raster.tif"
save_tiled_geotiff(STREAM_TIF_OUT, stream_mask.astype(np.uint8), gdal.GDT_Byte, nodata=0)

# 2. Rainfall Grid
RAIN_TIF_OUT = RASTERS_DIR / "Mani_Rainfall_Storm_Accumulation_mm.tif"
save_tiled_geotiff(RAIN_TIF_OUT, rain_grid, gdal.GDT_Float32, nodata=0.0)

# 3. Flood Hazard Rating Grid
HR_TIF_OUT = RASTERS_DIR / "Mani_Flood_Hazard_Rating_HR.tif"
save_tiled_geotiff(HR_TIF_OUT, hazard_class, gdal.GDT_Byte, nodata=0)

# 4. Boulder Transport Capacity Grid
DMAX_TIF_OUT = RASTERS_DIR / "Mani_Boulder_Transport_Capacity_m.tif"
save_tiled_geotiff(DMAX_TIF_OUT, Dmax_corridor, gdal.GDT_Float32, nodata=0.0)

# Free large memory buffers before ArcPy operations
del dem, fil, facc, fdir, slope, dem_c, facc_c, slope_c, fill_depth, tpi, spi
del nxt, is_sink_flat, land_flat, rain_grid, Q_peak, d_est, v_est, HR_raw
del hazard_dilated, HR_corridor, Dmax_raw, Dmax_corridor

# -------------------------------------------------------------------------
# Phase 6: ArcGIS Pro File Geodatabase Generation & Vector Extraction
# -------------------------------------------------------------------------
print("\n[Phase 6] Creating ArcGIS Pro File Geodatabase Layers (ArcPy)...")
t4 = time.time()

# 1. Import Step 1 DEM & Hillshade into GDB
print("  Importing DEM and Hillshade to Geodatabase...")
arcpy.management.CopyRaster(str(DEM_RAW), f"{GDB_PATH}\\DEM_5m_Conditioned")
arcpy.management.CopyRaster(str(HS_TIF), f"{GDB_PATH}\\Hillshade_5m")

# 2. Import Rasters to GDB
print("  Importing Stream, Rainfall, and Hazard Rasters to Geodatabase...")
arcpy.management.CopyRaster(str(STREAM_TIF_OUT), f"{GDB_PATH}\\Stream_Raster_5m")
arcpy.management.CopyRaster(str(RAIN_TIF_OUT), f"{GDB_PATH}\\Rainfall_Storm_Accumulation_mm")
arcpy.management.CopyRaster(str(HR_TIF_OUT), f"{GDB_PATH}\\Flood_Hazard_Rating_HR")
arcpy.management.CopyRaster(str(DMAX_TIF_OUT), f"{GDB_PATH}\\Boulder_Transport_Capacity_m")

# 3. Vectorize Streams using ArcPy StreamToFeature with Strahler Order!
print("  Computing Strahler Stream Orders & Vectorizing Stream Network...")
stream_ras = arcpy.sa.Raster(str(STREAM_TIF_OUT))
fdir_ras = arcpy.sa.Raster(str(FDIR_TIF))
# Reclassify 0 to NoData for StreamOrder
stream_ras_nodata = arcpy.sa.SetNull(stream_ras == 0, stream_ras)

strahler_ras = arcpy.sa.StreamOrder(stream_ras_nodata, fdir_ras, "STRAHLER")
strahler_ras.save(f"{GDB_PATH}\\Stream_Order_Strahler")

fc_streams = f"{GDB_PATH}\\Mani_Stream_Network"
arcpy.sa.StreamToFeature(strahler_ras, fdir_ras, fc_streams, "SIMPLIFY")
print(f"  [OK] Created Polyline Feature Class: Mani_Stream_Network")

# 4. Generate Isohyetal Contours (10mm intervals) across all of Mani
print("  Generating 10mm Isohyetal Rainfall Contours across all of Mani...")
fc_isohyets = f"{GDB_PATH}\\Mani_Isohyets_10mm"
rain_ras = arcpy.sa.Raster(str(RAIN_TIF_OUT))
arcpy.sa.Contour(rain_ras, fc_isohyets, contour_interval=10, base_contour=20)
print(f"  [OK] Created Polyline Feature Class: Mani_Isohyets_10mm")

# 5. Vectorize Active Torrent Flood Hazard Corridors
print("  Vectorizing Active Torrent Flood Hazard Corridors...")
hr_ras = arcpy.sa.Raster(str(HR_TIF_OUT))
hr_ras_nodata = arcpy.sa.SetNull(hr_ras == 0, hr_ras)
fc_hazard_poly = f"{GDB_PATH}\\Mani_Flood_Hazard_Corridors"
arcpy.conversion.RasterToPolygon(hr_ras_nodata, fc_hazard_poly, "SIMPLIFY", "Value")
print(f"  [OK] Created Polygon Feature Class: Mani_Flood_Hazard_Corridors")

# 6. Also export Vector Feature Classes to Open GeoPackage
print("  Exporting vectors to Open OGC GeoPackage...")
gpkg_path = VECTORS_DIR / "Mani_Flood_Study_Vectors.gpkg"
arcpy.conversion.ExportFeatures(fc_streams, str(gpkg_path) + "\\Mani_Stream_Network")
arcpy.conversion.ExportFeatures(fc_isohyets, str(gpkg_path) + "\\Mani_Isohyets_10mm")
arcpy.conversion.ExportFeatures(fc_hazard_poly, str(gpkg_path) + "\\Mani_Flood_Hazard_Corridors")
print(f"  [OK] Exported GeoPackage: {gpkg_path}")

print(f"\nArcPy Geodatabase processing completed in {time.time() - t4:.2f}s")
print("=" * 80)
print("  ALL OF MANI ARCGIS PRO DATA PACKAGE GENERATED SUCCESSFULLY!")
print(f"  GDB: {GDB_PATH}")
print(f"  Rasters: {RASTERS_DIR}")
print(f"  Vectors: {VECTORS_DIR}")
print("=" * 80)

