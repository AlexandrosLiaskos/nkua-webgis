"""Catchment Hydrology, Flow Accumulation, and Morphometric Indices via ArcPy.

Executes terrain morphometric and hydrological delineation on the hydro-conditioned
5m DEM using ArcGIS Pro Spatial Analyst:
1. Computes continuous Slope (degrees) and Aspect.
2. Generates Flow Direction (D8) and Flow Accumulation grids.
3. Delineates contributing catchment basins discharging to the Mani coastlines.
4. Computes Topographic Wetness Index (TWI) and Stream Power Index (SPI).
"""

import sys
from pathlib import Path

# Enforce UTF-8 encoding on Windows and add repository root to sys.path
sys.stdout.reconfigure(encoding="utf-8")
REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from osgeo import gdal

# Note: This module is executed via ArcGIS Pro Python environment
import arcpy
from arcpy.sa import (
    Raster,
    Fill,
    Slope,
    Aspect,
    FlowDirection,
    FlowAccumulation,
    Basin,
    StreamOrder,
    Ln,
    Tan,
    Sin,
    Con,
    IsNull
)

from src.pipeline.config import (
    PROCESSED_DATA_DIR,
    OUTPUTS_DIR,
)

DEM_CONDITIONED_TIF = PROCESSED_DATA_DIR / "terrain/mani_dem_5m_conditioned.tif"
DEM_FILLED_TIF = PROCESSED_DATA_DIR / "terrain/mani_dem_5m_filled.tif"
OUTPUT_DIR = PROCESSED_DATA_DIR / "terrain/hydrology"


def run_catchment_morphometry(
    dem_path: Path = None,
    output_directory: Path = None
) -> dict:
    """Run flow routing and catchment morphometry on the 5m DEM.
    
    Args:
        dem_path: Path to conditioned 5m DEM GeoTIFF.
        output_directory: Output directory for hydrological rasters.
        
    Returns:
        Dictionary of generated raster paths.
    """
    dem_file = str(dem_path or DEM_CONDITIONED_TIF)
    out_dir = Path(output_directory or OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Checking out ArcPy Spatial Analyst...")
    arcpy.CheckOutExtension("Spatial")
    arcpy.env.overwriteOutput = True
    arcpy.env.parallelProcessingFactor = "100%"

    print(f"[2/4] Loading elevation surface: {dem_file}")
    in_dem = Raster(dem_file)

    # 1. Slope in degrees
    print("      Calculating Slope (degrees)...")
    out_slope = Slope(in_dem, "DEGREE")
    slope_path = out_dir / "mani_slope_deg.tif"
    out_slope.save(str(slope_path))

    # 2. Hydrologic conditioning: Fill sinks and micro-depressions
    filled_tif_path = DEM_FILLED_TIF
    if not filled_tif_path.exists():
        print("      Running hydrologic sink filling (Fill)...")
        filled_dem = Fill(in_dem)
        filled_dem.save(str(filled_tif_path))
    else:
        print(f"      Loading pre-conditioned filled DEM: {filled_tif_path}")
        filled_dem = Raster(str(filled_tif_path))

    # 3. Flow Direction (D8) on filled surface
    print("      Calculating Flow Direction (D8) on depression-filled DEM...")
    out_flow_dir = FlowDirection(filled_dem, "NORMAL")
    fdir_path = out_dir / "mani_flow_direction_d8.tif"
    out_flow_dir.save(str(fdir_path))

    # 4. Flow Accumulation
    print("      Calculating Flow Accumulation...")
    out_flow_acc = FlowAccumulation(out_flow_dir, data_type="FLOAT")
    facc_path = out_dir / "mani_flow_accumulation.tif"
    out_flow_acc.save(str(facc_path))

    # 5. Drainage Basins
    print("[3/4] Delineating contributing catchment basins...")
    out_basins = Basin(out_flow_dir)
    basins_path = out_dir / "mani_drainage_basins.tif"
    out_basins.save(str(basins_path))

    # 5. Stream Power Index (SPI = As * tan(beta))
    # As = (FlowAccumulation + 1) * cell_area (m^2 / m contour width)
    # beta = slope in radians = slope_deg * pi / 180
    print("[4/4] Computing Stream Power Index (SPI) and Topographic Wetness Index (TWI)...")
    cell_size = 5.0
    slope_rad = out_slope * (3.141592653589793 / 180.0)
    tan_beta = Tan(slope_rad)
    tan_beta_safe = Con(tan_beta < 0.001, 0.001, tan_beta)
    spec_catchment_area = (out_flow_acc + 1.0) * cell_size

    # SPI = As * tan(beta)
    out_spi = spec_catchment_area * tan_beta_safe
    spi_path = out_dir / "mani_stream_power_index.tif"
    out_spi.save(str(spi_path))

    # TWI = ln(As / tan(beta))
    out_twi = Ln(spec_catchment_area / tan_beta_safe)
    twi_path = out_dir / "mani_topographic_wetness_index.tif"
    out_twi.save(str(twi_path))

    arcpy.CheckInExtension("Spatial")

    print(f"[SUCCESS] Hydrological rasters generated in: {out_dir}")
    print(f"          Slope: {slope_path}")
    print(f"          Flow Direction: {fdir_path}")
    print(f"          Flow Accumulation: {facc_path}")
    print(f"          Basins: {basins_path}")
    print(f"          SPI: {spi_path}")
    print(f"          TWI: {twi_path}")

    return {
        "slope": slope_path,
        "flow_dir": fdir_path,
        "flow_acc": facc_path,
        "basins": basins_path,
        "spi": spi_path,
        "twi": twi_path
    }


if __name__ == "__main__":
    run_catchment_morphometry()
