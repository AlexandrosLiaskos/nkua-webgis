"""Import Anna Karkani's Field Photographs & Observation Stations into Mani Flood Datasets.

Source: the file geodatabase Mani_Field_Photographs.gdb. Its location is read from the environment
variable MANI_PHOTO_GDB (default: data/photographs/Mani_Field_Photographs.gdb in the project root).

Integrates:
- Field_Photographs_EGSA87 (118 points)
- Observation_Stations_EGSA87 (24 points)
- Field_Photographs_WGS84 (118 points)
- Observation_Stations_WGS84 (24 points)

Into:
1. File Geodatabase: data/04_outputs/Mani_Flood_Study_Seamless.gdb
2. Shapefiles: data/04_outputs/vectors/shapefiles/
3. OGC GeoPackage: data/04_outputs/vectors/Mani_Flood_Study_Vectors.gpkg
"""

import os
import sys
from pathlib import Path
import arcpy

sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(os.environ.get("MANI_PROJECT_ROOT", Path(__file__).resolve().parents[2]))
PHOTO_GDB = os.environ.get("MANI_PHOTO_GDB", str(ROOT_DIR / "data/photographs/Mani_Field_Photographs.gdb"))
OUTPUT_DIR = ROOT_DIR / "data/04_outputs"
GDB_SEAMLESS = OUTPUT_DIR / "Mani_Flood_Study_Seamless.gdb"
GDB_ORIG = OUTPUT_DIR / "Mani_Flood_Study.gdb"
VECTORS_DIR = OUTPUT_DIR / "vectors"
SHP_DIR = VECTORS_DIR / "shapefiles"
GPKG_FILE = VECTORS_DIR / "Mani_Flood_Study_Vectors.gpkg"

arcpy.env.overwriteOutput = True

print("=" * 80)
print("  INTEGRATING FIELD PHOTOGRAPHS & OBSERVATION STATIONS")
print("=" * 80)

fcs_to_import = [
    "Field_Photographs_EGSA87",
    "Observation_Stations_EGSA87",
    "Field_Photographs_WGS84",
    "Observation_Stations_WGS84"
]

# 1. Import into Mani_Flood_Study_Seamless.gdb
print("\n[1/3] Copying into Mani_Flood_Study_Seamless.gdb...")
for fc_name in fcs_to_import:
    src_fc = f"{PHOTO_GDB}\\{fc_name}"
    dst_fc = f"{GDB_SEAMLESS}\\{fc_name}"
    arcpy.conversion.ExportFeatures(src_fc, dst_fc)
    count = arcpy.management.GetCount(dst_fc)[0]
    print(f"  [OK] Exported {fc_name} ({count} features) -> {dst_fc}")

# Also try original GDB if unlocked
try:
    for fc_name in fcs_to_import:
        src_fc = f"{PHOTO_GDB}\\{fc_name}"
        dst_fc = f"{GDB_ORIG}\\{fc_name}"
        arcpy.conversion.ExportFeatures(src_fc, dst_fc)
        print(f"  [OK] Exported {fc_name} -> {dst_fc}")
except Exception as e:
    print(f"  (Note: original GDB held locked by active ArcGIS Pro session, skipping: {e})")

# 2. Export to Shapefiles
print("\n[2/3] Exporting to Shapefiles...")
for fc_name in ["Field_Photographs_EGSA87", "Observation_Stations_EGSA87"]:
    src_fc = f"{PHOTO_GDB}\\{fc_name}"
    arcpy.conversion.FeatureClassToFeatureClass(src_fc, str(SHP_DIR), f"{fc_name}.shp")
    print(f"  [OK] Saved Shapefile: {SHP_DIR}\\{fc_name}.shp")

# 3. Export to GeoPackage
print("\n[3/3] Exporting to OGC GeoPackage...")
for fc_name in ["Field_Photographs_EGSA87", "Observation_Stations_EGSA87"]:
    src_fc = f"{PHOTO_GDB}\\{fc_name}"
    arcpy.conversion.ExportFeatures(src_fc, f"{GPKG_FILE}\\{fc_name}")
    print(f"  [OK] Added to GeoPackage: {GPKG_FILE}\\{fc_name}")

print("\n" + "=" * 80)
print("  FIELD PHOTOGRAPHS & STATIONS INTEGRATED SUCCESSFULLY!")
print("=" * 80)
