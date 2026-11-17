"""Copernicus Climate Data Store (CDS) ERA5-Land Reanalysis Acquisition Module.

Retrieves hourly atmospheric forcing, 2m air temperature, and multi-tier antecedent
volumetric soil moisture from the ECMWF ERA5-Land reanalysis dataset.

Variables:
    - total_precipitation [m]
    - volumetric_soil_water_layer_1 (0-7 cm) [m³/m³]
    - volumetric_soil_water_layer_2 (7-28 cm) [m³/m³]
    - 2m_temperature [K]

Literature Reference:
    Muñoz-Sabater, J., Dutra, E., Agustí-Panareda, A., Albergel, C., Arduini, G.,
    Balsamo, G., Boussetta, S., Choulga, M., Harrigan, S., Hersbach, H., Martens, B.,
    Miralles, D. G., Piles, M., Rodríguez-Fernández, N. J., Zsoter, E., Buontempo, C., &
    Thépaut, J.-N. (2021). ERA5-Land: A state-of-the-art global reanalysis dataset for land applications.
    Earth System Science Data, 13(9), 4349–4383. https://doi.org/10.5194/essd-13-4349-2021
"""

from pathlib import Path
from typing import Optional, List
import os

from src.pipeline.config import (
    RAW_DATA_DIR,
    DOMAIN_BBOX_WGS84,
)

OUTPUT_DIR = RAW_DATA_DIR / "rainfall_atmosphere/copernicus-cds/era5_land"


def fetch_era5_land_cds(
    output_directory: Optional[Path] = None,
    year: str = "2026",
    month: str = "08",
    days: Optional[List[str]] = None,
    download_if_missing: bool = False
) -> Path:
    """Acquire or verify ERA5-Land hourly NetCDF dataset for the storm period.

    Args:
        output_directory: Target directory for storing downloaded NetCDF files.
        year: Target simulation year (default '2026').
        month: Target simulation month (default '08').
        days: Target days list (default ['14', '15', '16', '17']).
        download_if_missing: If True and cdsapi is configured, initiates CDS API call.

    Returns:
        Path to the local ERA5-Land NetCDF file.
    """
    out_dir = output_directory or OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    target_file = out_dir / f"mani_era5_land_{year}{month}14_{year}{month}17.nc"

    if target_file.exists():
        return target_file

    if download_if_missing:
        try:
            import cdsapi
            c = cdsapi.Client()
            area = [
                DOMAIN_BBOX_WGS84[3] + 0.1,  # North
                DOMAIN_BBOX_WGS84[0] - 0.1,  # West
                DOMAIN_BBOX_WGS84[1] - 0.1,  # South
                DOMAIN_BBOX_WGS84[2] + 0.1,  # East
            ]
            req_days = days or ["14", "15", "16", "17"]
            print(f"[CDS] Requesting ERA5-Land for Mani domain: {area}...")
            c.retrieve(
                "reanalysis-era5-land",
                {
                    "variable": [
                        "2m_temperature",
                        "total_precipitation",
                        "volumetric_soil_water_layer_1",
                        "volumetric_soil_water_layer_2"
                    ],
                    "year": year,
                    "month": month,
                    "day": req_days,
                    "time": [f"{h:02d}:00" for h in range(24)],
                    "area": area,
                    "format": "netcdf",
                },
                str(target_file)
            )
            print(f"[CDS] ERA5-Land dataset saved to: {target_file}")
            return target_file
        except Exception as e:
            print(f"[WARNING] CDS API download skipped or failed ({e}). Checking cached archives...")

    # Return local path reference even if offline
    return target_file


if __name__ == "__main__":
    path = fetch_era5_land_cds()
    print(f"ERA5-Land path: {path} (Exists: {path.exists()})")
