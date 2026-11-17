"""Copernicus Marine Service (CMEMS) Boundary Data Fetcher.

Retrieves hourly sea surface height (SSH / storm surge) and wave dynamics
(significant wave height Hs, peak period Tp) for the coastal boundaries
surrounding the Mani Peninsula (Messenian and Laconian Gulfs) for the
August 14-17, 2026 event.
"""

import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
import copernicusmarine

from src.pipeline.config import (
    RAW_DATA_DIR,
    DOMAIN_BBOX_WGS84,
    EVENT_START_UTC,
    EVENT_END_UTC,
)

# Load environment variables
load_dotenv(Path("e:/Publications/Research/Mani Floods August 2026/.env"))

OUTPUT_DIR = RAW_DATA_DIR / "flood_sea_level_observations/cmems"


def fetch_med_sea_physics(
    output_directory: Optional[Path] = None,
    start_datetime: str = EVENT_START_UTC,
    end_datetime: str = EVENT_END_UTC
) -> Path:
    """Fetch Mediterranean Sea physics reanalysis/analysis (sea surface height).
    
    Args:
        output_directory: Target storage directory.
        start_datetime: ISO format UTC start string.
        end_datetime: ISO format UTC end string.
        
    Returns:
        Path to downloaded NetCDF dataset.
    """
    out_dir = output_directory or OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    # Mediterranean physical analysis & forecast product ID (exact CMEMS catalogue ID)
    dataset_id = "cmems_mod_med_phy-ssh_anfc_4.2km-2D_PT1H-m"

    # Domain bounds (WGS84) with 0.1 degree buffer
    lon_min = DOMAIN_BBOX_WGS84[0] - 0.1
    lat_min = DOMAIN_BBOX_WGS84[1] - 0.1
    lon_max = DOMAIN_BBOX_WGS84[2] + 0.1
    lat_max = DOMAIN_BBOX_WGS84[3] + 0.1

    print(f"Subsetting CMEMS Sea Surface Height for Mani [{lon_min:.2f}, {lat_min:.2f}, {lon_max:.2f}, {lat_max:.2f}]...")
    
    output_file = out_dir / "mani_cmems_ssh_20260814_20260817.nc"
    
    copernicusmarine.subset(
        dataset_id=dataset_id,
        variables=["zos"], # Sea surface height above geoid
        minimum_longitude=lon_min,
        maximum_longitude=lon_max,
        minimum_latitude=lat_min,
        maximum_latitude=lat_max,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        output_filename=output_file.name,
        output_directory=str(out_dir),
        overwrite=True
    )
    
    print(f"CMEMS SSH successfully saved to: {output_file}")
    return output_file


def fetch_med_waves(
    output_directory: Optional[Path] = None,
    start_datetime: str = EVENT_START_UTC,
    end_datetime: str = EVENT_END_UTC
) -> Path:
    """Fetch Mediterranean Sea wave dynamics (Hs, Tp, wave direction).
    
    Args:
        output_directory: Target storage directory.
        start_datetime: ISO format UTC start string.
        end_datetime: ISO format UTC end string.
        
    Returns:
        Path to downloaded NetCDF dataset.
    """
    out_dir = output_directory or OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    dataset_id = "cmems_mod_med_wav_anfc_4.2km_PT1H-i"

    lon_min = DOMAIN_BBOX_WGS84[0] - 0.1
    lat_min = DOMAIN_BBOX_WGS84[1] - 0.1
    lon_max = DOMAIN_BBOX_WGS84[2] + 0.1
    lat_max = DOMAIN_BBOX_WGS84[3] + 0.1

    print(f"Subsetting CMEMS Wave Dynamics for Mani [{lon_min:.2f}, {lat_min:.2f}, {lon_max:.2f}, {lat_max:.2f}]...")
    output_file = out_dir / "mani_cmems_waves_20260814_20260817.nc"

    copernicusmarine.subset(
        dataset_id=dataset_id,
        variables=["VHM0", "VTPK", "VMDR"], # Significant wave height, peak period, mean direction
        minimum_longitude=lon_min,
        maximum_longitude=lon_max,
        minimum_latitude=lat_min,
        maximum_latitude=lat_max,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        output_filename=output_file.name,
        output_directory=str(out_dir),
        overwrite=True
    )

    print(f"CMEMS Waves successfully saved to: {output_file}")
    return output_file


if __name__ == "__main__":
    fetch_med_sea_physics()
    fetch_med_waves()


