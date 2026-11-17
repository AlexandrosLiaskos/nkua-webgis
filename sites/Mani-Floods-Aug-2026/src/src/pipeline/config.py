"""Pipeline Configuration and Master Domain Specifications.

Defines spatial references, standard paths conforming to the 4-tier data
pipeline, physical constants, and submodel configuration parameters for the
Mani August 15, 2026 flood reconstruction.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

# Base Directories
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = WORKSPACE_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "01_raw"
INTERMEDIATE_DATA_DIR = DATA_DIR / "02_intermediate"
PROCESSED_DATA_DIR = DATA_DIR / "03_processed"
OUTPUTS_DIR = DATA_DIR / "04_outputs"
MODELS_DIR = WORKSPACE_ROOT / "models"
PUBLICATION_DIR = WORKSPACE_ROOT / "publication"

# Spatial Reference System: Greek Grid (EPSG:2100)
CRS_EPSG = 2100
CRS_WKT_NAME = "GCS_GRS_1980 / GRS_1980_Transverse_Mercator"

# Domain Bounding Box (EPSG:2100 Metres)
# Matching the native 5m DEM extent across Mani Peninsula
DOMAIN_BBOX_EPSG2100: Tuple[float, float, float, float] = (
    340150.834418,  # West X_min
    4015797.918714, # South Y_min
    379768.016144,  # East X_max
    4104146.633793  # North Y_max
)

# Geographic Extent (WGS84 Degrees)
DOMAIN_BBOX_WGS84: Tuple[float, float, float, float] = (
    22.201891,  # West Longitude
    36.273902,  # South Latitude
    22.661275,  # East Longitude
    37.075888   # North Latitude
)

# Physical Constants
GRAVITY_ACCEL: float = 9.80665      # m/s^2
WATER_DENSITY_FRESH: float = 1000.0 # kg/m^3
WATER_DENSITY_SEA: float = 1025.0   # kg/m^3
SEDIMENT_DENSITY_QUARTZ_LIMESTONE: float = 2650.0 # kg/m^3
SPECIFIC_WEIGHT_WATER: float = 9810.0 # N/m^3

# Simulation Event Timings (UTC)
EVENT_START_UTC = "2026-08-14T00:00:00Z"
EVENT_PEAK_UTC = "2026-08-15T12:00:00Z"
EVENT_END_UTC = "2026-08-17T00:00:00Z"

@dataclass(frozen=True)
class TerrainConfig:
    """Terrain and elevation specifications."""
    raw_dem_path: Path = RAW_DATA_DIR / "terrain/local_5m/dem"
    processed_dem_cog: Path = PROCESSED_DATA_DIR / "terrain/mani_dem_5m_conditioned.tif"
    cell_size_meters: float = 5.0
    nodata_value: float = -9999.0
    min_elevation_limit: float = -15.0
    max_elevation_limit: float = 2500.0

@dataclass(frozen=True)
class InfiltrationConfig:
    """Green-Ampt-Mein-Larson (GAML) and pedology settings."""
    soilgrids_dir: Path = RAW_DATA_DIR / "soils_land_cover/isric"
    worldcover_dir: Path = RAW_DATA_DIR / "soils_land_cover/worldcover_2021"
    fire_perimeter_dir: Path = RAW_DATA_DIR / "soils_land_cover/copernicus-effis"
    depth_tiers: Tuple[str, ...] = ("0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm")
    # Post-fire conductivity reduction factor (hydrophobic layer)
    fire_ks_reduction_factor: float = 0.25
    # Karst loss rate over carbonate formations (mm/hr)
    karst_percolation_rate_mm_h: float = 12.0

@dataclass(frozen=True)
class HydrodynamicsConfig:
    """2D hydrodynamic mesh and solver settings."""
    engine: str = "hec-ras-2d"  # "hec-ras-2d" | "iber-plus"
    mesh_cell_size: float = 10.0  # adaptive computation cell size in meters
    time_step_sec: float = 1.0     # adaptive time stepping
    max_courant_number: float = 1.0
    wetting_drying_threshold_m: float = 0.02
    eddy_viscosity_smagorinsky: float = 0.15

@dataclass(frozen=True)
class PowerGeomorphologyConfig:
    """Stream power, bed shear stress, and geomorphic threshold parameters."""
    shields_critical_gravel: float = 0.045
    shields_critical_boulder: float = 0.060
    stream_power_erosion_threshold_w_m2: float = 35.0
    stream_power_catastrophic_threshold_w_m2: float = 300.0
    debris_factor_mountain: float = 1.0

