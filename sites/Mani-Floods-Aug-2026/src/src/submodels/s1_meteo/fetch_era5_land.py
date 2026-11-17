"""Copernicus Climate Data Store (CDS) ERA5-Land Fetcher.

Retrieves hourly atmospheric forcing and antecedent soil moisture from ERA5-Land:
- total_precipitation (m)
- volumetric_soil_water_layer_1 (0-7 cm)
- volumetric_soil_water_layer_2 (7-28 cm)
- 2m_temperature (K)

For the Mani Peninsula domain across August 14-17, 2026.
"""

from pathlib import Path
import cdsapi

from src.pipeline.config import (
    RAW_DATA_DIR,
    DOMAIN_BBOX_WGS84,
)

OUTPUT_DIR = RAW_DATA_DIR / "rainfall_atmosphere/copernicus-cds/era5_land"


def fetch_era5_land_mani(output_directory: Path = None) -> Path:
    """Fetch hourly ERA5-Land parameters for Mani August 2026 event.
    
    Args:
        output_directory: Target storage directory.
        
    Returns:
        Path to downloaded NetCDF/GRIB file.
    """
    out_dir = output_directory or OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    c = cdsapi.Client()

    output_file = out_dir / "mani_era5_land_20260814_20260817.nc"

    # Bounding box in North, West, South, East format (CDS convention)
    # [North, West, South, East]
    area = [
        DOMAIN_BBOX_WGS84[3] + 0.1, # North 37.18
        DOMAIN_BBOX_WGS84[0] - 0.1, # West 22.10
        DOMAIN_BBOX_WGS84[1] - 0.1, # South 36.17
        DOMAIN_BBOX_WGS84[2] + 0.1  # East 22.76
    ]

    print(f"Requesting ERA5-Land from CDS for Mani area: {area}...")

    request_payload = {
        "variable": [
            "2m_temperature",
            "total_precipitation",
            "volumetric_soil_water_layer_1",
            "volumetric_soil_water_layer_2"
        ],
        "year": "2026",
        "month": "08",
        "day": ["14", "15", "16", "17"],
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": area,
        "format": "netcdf"
    }

    c.retrieve(
        "reanalysis-era5-land",
        request_payload,
        str(output_file)
    )

    print(f"[SUCCESS] ERA5-Land data saved to: {output_file}")
    return output_file


if __name__ == "__main__":
    fetch_era5_land_mani()

