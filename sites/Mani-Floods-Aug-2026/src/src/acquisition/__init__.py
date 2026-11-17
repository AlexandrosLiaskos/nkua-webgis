"""Public Data Acquisition Modules for the Mani August 2026 Flood Reconstruction.

Provides standalone, modular downloaders and format readers for open Earth observation
and meteorological data:
- fetch_copernicus_dem: Copernicus 30m Global DEM (GLO-30) and 5m high-resolution DEM.
- fetch_era5_cds: Copernicus Climate Data Store (CDS) ERA5-Land reanalysis.
- fetch_cmems_marine: Copernicus Marine Service (CMEMS) sea surface height and waves.
- fetch_soilgrids: ISRIC SoilGrids REST/WCS soil physical property tiers.
- fetch_effis_fire: Copernicus EFFIS wildfire burn perimeters and severity.
- fetch_ground_stations: National Observatory of Athens (NOA) weather station records.
"""

from src.acquisition.fetch_copernicus_dem import fetch_copernicus_dem
from src.acquisition.fetch_era5_cds import fetch_era5_land_cds
from src.acquisition.fetch_cmems_marine import fetch_cmems_marine_boundary
from src.acquisition.fetch_soilgrids import fetch_soilgrids_properties
from src.acquisition.fetch_effis_fire import fetch_effis_burn_perimeters
from src.acquisition.fetch_ground_stations import fetch_noa_ground_stations

__all__ = [
    "fetch_copernicus_dem",
    "fetch_era5_land_cds",
    "fetch_cmems_marine_boundary",
    "fetch_soilgrids_properties",
    "fetch_effis_burn_perimeters",
    "fetch_noa_ground_stations",
]
