"""Copernicus Marine Service (CMEMS) Hydrodynamic Boundary Data Fetcher.

Retrieves hourly sea surface height (SSH / total water level stage) and wave dynamics
(significant wave height Hs, peak wave period Tp) for the coastal boundaries surrounding
the Mani Peninsula (Messenian and Laconian Gulfs).

Literature References:
    Clementi, E., Pistoia, J., Delrosso, D., Mattia, G., Fratianni, C., Storto, A.,
    Ciliberti, S., Lemieux-Dudon, B., & Pinardi, N. (2021). Mediterranean Sea Physical Analysis
    and Forecast (CMEMS MED-Physics). Copernicus Marine Service.
    https://doi.org/10.25423/CMCC/MEDSEA_ANALYSISFORECAST_PHY_006_013_EAS8

    Korres, G., Ravdas, M., & Zacharioudaki, A. (2021). Mediterranean Sea Waves Analysis and Forecast.
    Copernicus Marine Service. https://doi.org/10.25423/CMCC/MEDSEA_ANALYSIS_FORECAST_WAV_006_017
"""

import os
from pathlib import Path
from typing import Optional, Dict

from src.pipeline.config import (
    RAW_DATA_DIR,
    DOMAIN_BBOX_WGS84,
    EVENT_START_UTC,
    EVENT_END_UTC,
    WORKSPACE_ROOT,
)

try:
    from dotenv import load_dotenv
    load_dotenv(WORKSPACE_ROOT / ".env")
except ImportError:
    pass

OUTPUT_DIR = RAW_DATA_DIR / "flood_sea_level_observations/cmems"


def fetch_cmems_marine_boundary(
    output_directory: Optional[Path] = None,
    start_datetime: str = EVENT_START_UTC,
    end_datetime: str = EVENT_END_UTC,
    download_if_missing: bool = False
) -> Dict[str, Path]:
    """Acquire or stage CMEMS Mediterranean Sea hourly SSH and wave conditions.

    Args:
        output_directory: Target directory for storing CMEMS NetCDF files.
        start_datetime: ISO UTC timestamp start.
        end_datetime: ISO UTC timestamp end.
        download_if_missing: If True and credentials exist, calls copernicusmarine client.

    Returns:
        Dictionary mapping 'ssh' and 'waves' to local NetCDF paths.
    """
    out_dir = output_directory or OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    ssh_file = out_dir / "mani_cmems_ssh_20260814_20260817.nc"
    waves_file = out_dir / "mani_cmems_waves_20260814_20260817.nc"

    if ssh_file.exists() and waves_file.exists():
        return {"ssh": ssh_file, "waves": waves_file}

    if download_if_missing:
        try:
            import copernicusmarine
            lon_min = DOMAIN_BBOX_WGS84[0] - 0.1
            lat_min = DOMAIN_BBOX_WGS84[1] - 0.1
            lon_max = DOMAIN_BBOX_WGS84[2] + 0.1
            lat_max = DOMAIN_BBOX_WGS84[3] + 0.1

            print(f"[CMEMS] Subsetting SSH across Mani domain [{lon_min:.2f}, {lat_min:.2f}, {lon_max:.2f}, {lat_max:.2f}]...")
            copernicusmarine.subset(
                dataset_id="cmems_mod_med_phy-ssh_anfc_4.2km-2D_PT1H-m",
                variables=["zos"],
                minimum_longitude=lon_min,
                maximum_longitude=lon_max,
                minimum_latitude=lat_min,
                maximum_latitude=lat_max,
                start_datetime=start_datetime,
                end_datetime=end_datetime,
                output_filename=str(ssh_file),
                force_download=True
            )

            print(f"[CMEMS] Subsetting Waves (Hs, Tp) across Mani domain...")
            copernicusmarine.subset(
                dataset_id="cmems_mod_med_wav_anfc_4.2km_PT1H-i",
                variables=["VHM0", "VTPK"],
                minimum_longitude=lon_min,
                maximum_longitude=lon_max,
                minimum_latitude=lat_min,
                maximum_latitude=lat_max,
                start_datetime=start_datetime,
                end_datetime=end_datetime,
                output_filename=str(waves_file),
                force_download=True
            )
        except Exception as e:
            print(f"[WARNING] CMEMS API download skipped or failed ({e}). Checking local files...")

    return {"ssh": ssh_file, "waves": waves_file}


if __name__ == "__main__":
    res = fetch_cmems_marine_boundary()
    print(f"CMEMS SSH: {res['ssh']} (Exists: {res['ssh'].exists()})")
    print(f"CMEMS Waves: {res['waves']} (Exists: {res['waves'].exists()})")
