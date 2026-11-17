"""Unit and contract tests for the Public Data Acquisition modules."""

import pytest
from pathlib import Path

from src.acquisition import (
    fetch_copernicus_dem,
    fetch_era5_land_cds,
    fetch_cmems_marine_boundary,
    fetch_soilgrids_properties,
    fetch_effis_burn_perimeters,
    fetch_noa_ground_stations,
)


def test_copernicus_dem_staging():
    """Verify DEM staging identifies a valid elevation surface."""
    dem_path = fetch_copernicus_dem()
    assert dem_path.exists()
    assert dem_path.stat().st_size > 1000000  # > 1 MB
    assert dem_path.suffix.lower() == ".tif"


def test_era5_land_staging():
    """Verify ERA5-Land staging identifies the atmospheric forcing dataset."""
    era5_path = fetch_era5_land_cds()
    assert era5_path.exists()
    assert era5_path.stat().st_size > 50000  # > 50 KB
    assert era5_path.suffix.lower() in (".nc", ".nc4")


def test_cmems_marine_staging():
    """Verify Copernicus Marine Service staging identifies SSH and wave datasets."""
    cmems = fetch_cmems_marine_boundary()
    assert "ssh" in cmems and "waves" in cmems
    assert cmems["ssh"].exists()
    assert cmems["waves"].exists()
    assert cmems["ssh"].suffix.lower() == ".nc"
    assert cmems["waves"].suffix.lower() == ".nc"


def test_soilgrids_staging():
    """Verify ISRIC SoilGrids staging identifies key soil physical fractions."""
    soils = fetch_soilgrids_properties()
    for required_prop in ("sand", "clay", "soc", "bdod"):
        assert required_prop in soils, f"Missing soil property: {required_prop}"
        assert soils[required_prop].exists()


def test_effis_fire_staging():
    """Verify EFFIS wildfire burn perimeters are discoverable."""
    burn_assets = fetch_effis_burn_perimeters()
    assert len(burn_assets) > 0, "No EFFIS burn scar assets discovered."


def test_noa_ground_stations_staging():
    """Verify National Observatory of Athens ground station records and hyetographs."""
    data = fetch_noa_ground_stations()
    df_catalog = data["catalog"]
    df_hyeto = data["hyetographs"]

    assert len(df_catalog) >= 4
    assert "station_code" in df_catalog.columns or "Station_ID" in df_catalog.columns or "station_name" in df_catalog.columns
    assert len(df_hyeto) > 50
