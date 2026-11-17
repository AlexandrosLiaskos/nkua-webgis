"""Vector Catchment Basins and Stream Network Extraction via ArcPy.

Converts raster hydrological grids into high-performance, publication-ready
OGC GeoPackages (mani_catchment_basins.gpkg and mani_stream_network.gpkg):
1. RasterToPolygon on mani_drainage_basins.tif, filtering slivers (< 0.5 km^2).
2. Computes geometric properties: Area (km^2), Perimeter (km), Centroid (X, Y).
3. Assigns target catchment identities and simulation results:
   - Kokkala (East Mani)
   - Kotronas / Flomochori (East Mani)
   - Oitylo / Limeni (West Mani)
   - Areopoli Torrent (West Mani)
4. Stream order and vector line extraction from Flow Accumulation (>= 400 cells)
   and D8 Flow Direction, exporting to GeoPackage.

Executed via ArcGIS Pro Python environment.
"""

import sys
from pathlib import Path
import json

# Enforce UTF-8 console output on Windows
sys.stdout.reconfigure(encoding="utf-8")

import arcpy
from arcpy.sa import (
    Raster,
    Con,
    StreamLink,
    StreamOrder,
    StreamToFeature,
)

from src.pipeline.config import WORKSPACE_ROOT

# Workspace paths
ROOT_DIR = WORKSPACE_ROOT
PROCESSED_DIR = ROOT_DIR / "data/03_processed/terrain"
HYDRO_DIR = PROCESSED_DIR / "hydrology"
OUTPUTS_DIR = ROOT_DIR / "data/04_outputs/hydrodynamics"

BASINS_TIF = HYDRO_DIR / "mani_drainage_basins.tif"
FACC_TIF = HYDRO_DIR / "mani_flow_accumulation.tif"
FDIR_TIF = HYDRO_DIR / "mani_flow_direction_d8.tif"
DEM_TIF = PROCESSED_DIR / "mani_dem_5m_conditioned.tif"

OUTPUT_BASINS_GPKG = PROCESSED_DIR / "mani_catchment_basins.gpkg"
OUTPUT_STREAMS_GPKG = PROCESSED_DIR / "mani_stream_network.gpkg"
RECON_JSON = OUTPUTS_DIR / "target_catchments_flood_reconstruction.json"


def export_vector_layers(channel_threshold_cells: int = 1000):
    """Extract and attribute vector catchment basins and stream networks.
    
    Args:
        channel_threshold_cells: Minimum upstream accumulation cells for channel
            initiation. Default 1000 cells (25,000 m^2 = 2.5 ha) filters out
            dry-stone terrace wall micro-rills while preserving all genuine
            first-order mountain torrent tributaries.
    """
    print("================================================================================")
    print("  MANI FLASH FLOOD 2026: VECTOR HYDROLOGY & STREAM NETWORK EXTRACTOR")
    print("================================================================================")

    print("[1/5] Checking out ArcPy Spatial Analyst...")
    arcpy.CheckOutExtension("Spatial")
    arcpy.env.overwriteOutput = True
    arcpy.env.outputCoordinateSystem = arcpy.SpatialReference(2100)  # Greek Grid EPSG:2100

    scratch_gdb = str(arcpy.env.scratchGDB)
    print(f"      Using scratch GDB: {scratch_gdb}")

    # 1. Delineate Stream Network Lines
    thresh_ha = (channel_threshold_cells * 25.0) / 10000.0
    print(f"[2/5] Extracting Stream Network from Flow Accumulation (>={channel_threshold_cells} cells / {thresh_ha:.2f} ha)...")
    facc = Raster(str(FACC_TIF))
    fdir = Raster(str(FDIR_TIF))

    # Channel threshold: >= 1000 cells = 25,000 m^2 = 2.5 ha
    stream_raster = Con(facc >= channel_threshold_cells, 1)

    print("      Calculating Strahler Stream Order...")
    out_stream_order = StreamOrder(stream_raster, fdir, "STRAHLER")

    temp_streams_fc = f"{scratch_gdb}\\temp_streams"
    print("      Vectorizing stream channels to polyline...")
    StreamToFeature(out_stream_order, fdir, temp_streams_fc, "SIMPLIFY")

    # Export stream lines to GeoPackage
    streams_gpkg_path = str(OUTPUT_STREAMS_GPKG)
    if Path(streams_gpkg_path).exists():
        Path(streams_gpkg_path).unlink(missing_ok=True)
    arcpy.management.CreateSQLiteDatabase(streams_gpkg_path, "GEOPACKAGE")
    print(f"      Exporting streams to GeoPackage: {streams_gpkg_path}...")
    arcpy.conversion.ExportFeatures(
        in_features=temp_streams_fc,
        out_features=f"{streams_gpkg_path}\\mani_stream_network"
    )
    print(f"      [OK] Stream network exported successfully.")

    # 2. Vectorize Catchment Basins
    print("[3/5] Vectorizing raster drainage basins...")
    temp_basins_fc = f"{scratch_gdb}\\temp_basins"
    in_basins = Raster(str(BASINS_TIF))
    arcpy.conversion.RasterToPolygon(in_basins, temp_basins_fc, "SIMPLIFY", "Value")

    # Add geometric fields
    print("[4/5] Computing morphometric basin attributes...")
    arcpy.management.AddField(temp_basins_fc, "area_km2", "DOUBLE")
    arcpy.management.AddField(temp_basins_fc, "perimeter_km", "DOUBLE")
    arcpy.management.AddField(temp_basins_fc, "catchment_name", "TEXT", field_length=60)
    arcpy.management.AddField(temp_basins_fc, "flank", "TEXT", field_length=10)
    arcpy.management.AddField(temp_basins_fc, "peak_q_m3_s", "DOUBLE")
    arcpy.management.AddField(temp_basins_fc, "tc_design_hr", "DOUBLE")
    arcpy.management.AddField(temp_basins_fc, "hazard_tier", "TEXT", field_length=20)
    arcpy.management.AddField(temp_basins_fc, "unit_power_w_m2", "DOUBLE")
    arcpy.management.AddField(temp_basins_fc, "boulder_dmax_cm", "DOUBLE")

    # Calculate area and perimeter
    arcpy.management.CalculateGeometryAttributes(
        temp_basins_fc,
        [["area_km2", "AREA_GEODESIC"], ["perimeter_km", "PERIMETER_LENGTH_GEODESIC"]],
        area_unit="SQUARE_KILOMETERS",
        length_unit="KILOMETERS"
    )

    # Load simulation reconstruction metadata
    recon_data = {}
    if RECON_JSON.exists():
        with open(RECON_JSON, "r", encoding="utf-8") as f:
            r_list = json.load(f)
            for r in r_list:
                key = r["name"].split(" (")[0]
                recon_data[key] = r

    # Assign target catchment metadata based on spatial coordinates or grid IDs
    print("      Matching simulation parameters to target catchments...")
    with arcpy.da.UpdateCursor(temp_basins_fc, ["SHAPE@XY", "area_km2", "catchment_name", "flank",
                                                "peak_q_m3_s", "tc_design_hr", "hazard_tier",
                                                "unit_power_w_m2", "boulder_dmax_cm"]) as cursor:
        for row in cursor:
            x, y = row[0]
            area = row[1]
            # Spatial identification within Mani domain (EPSG:2100):
            # East Mani: Kokkala (X ~ 363000, Y ~ 4043000)
            # East Mani: Kotronas (X ~ 362000, Y ~ 4054000)
            # West Mani: Oitylo / Limeni (X ~ 354000, Y ~ 4060000)
            # West Mani: Areopoli (X ~ 355000, Y ~ 4057000)
            c_name = "Ungauged Mani Torrent"
            flank = "East" if x > 358000 else "West"
            peak_q = 0.0
            tc_val = 1.0
            h_tier = "Low"
            power = 0.0
            dmax = 0.0

            if 360000 <= x <= 366000 and 4038000 <= y <= 4048000 and area >= 5.0:
                c_name = "Kokkala Gorge"
                flank = "East"
                if "Kokkala" in recon_data:
                    k = recon_data["Kokkala"]
                    peak_q = k["peak_discharge_m3_s"]
                    tc_val = k["tc_design_hr"]
                    h_tier = "Extreme"
                    power = k["unit_stream_power_w_m2"]
                    dmax = k["max_mobile_boulder_m"] * 100.0
            elif 359000 <= x <= 365000 and 4049000 <= y <= 4059000 and area >= 5.0:
                c_name = "Kotronas / Flomochori"
                flank = "East"
                if "Kotronas / Flomochori" in recon_data:
                    k = recon_data["Kotronas / Flomochori"]
                    peak_q = k["peak_discharge_m3_s"]
                    tc_val = k["tc_design_hr"]
                    h_tier = "Extreme"
                    power = k["unit_stream_power_w_m2"]
                    dmax = k["max_mobile_boulder_m"] * 100.0
            elif 350000 <= x <= 358000 and 4058000 <= y <= 4068000 and area >= 5.0:
                c_name = "Oitylo / Limeni"
                flank = "West"
                h_tier = "Low"
            elif 351000 <= x <= 358000 and 4052000 <= y <= 4058000 and area >= 3.0:
                c_name = "Areopoli Torrent"
                flank = "West"
                h_tier = "Low"

            row[2] = c_name
            row[3] = flank
            row[4] = peak_q
            row[5] = tc_val
            row[6] = h_tier
            row[7] = power
            row[8] = dmax
            cursor.updateRow(row)

    # Filter out slivers (< 0.2 km^2) and export to GeoPackage
    print("[5/5] Exporting filtered basins to GeoPackage...")
    basins_gpkg_path = str(OUTPUT_BASINS_GPKG)
    if Path(basins_gpkg_path).exists():
        Path(basins_gpkg_path).unlink(missing_ok=True)
    arcpy.management.CreateSQLiteDatabase(basins_gpkg_path, "GEOPACKAGE")

    temp_filtered_fc = f"{scratch_gdb}\\temp_basins_filtered"
    arcpy.analysis.Select(temp_basins_fc, temp_filtered_fc, "area_km2 >= 0.2")

    arcpy.conversion.ExportFeatures(
        in_features=temp_filtered_fc,
        out_features=f"{basins_gpkg_path}\\mani_catchment_basins"
    )

    arcpy.CheckInExtension("Spatial")

    print("\n================================================================================")
    print("  [SUCCESS] Vector Hydrological Layers Exported:")
    print(f"  Basins GeoPackage:  {OUTPUT_BASINS_GPKG}")
    print(f"  Streams GeoPackage: {OUTPUT_STREAMS_GPKG}")
    print("================================================================================")


if __name__ == "__main__":
    export_vector_layers()
