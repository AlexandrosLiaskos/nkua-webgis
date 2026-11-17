"""Multi-Scenario Precipitation Synthesis Engine.

Produces multi-scenario NetCDF datasets representing deterministic physical realizations
of the August 15, 2026 Mani storm event:
1. Scenario A (Baseline Calibrated): Geostatistical Conditional Merging (Sinclair & Pegram 2005)
   anchored to NOA Kokkala (141.4 mm, 68 mm/h peak), NOA Kardamyli (10.4 mm), and HNMS controls.
2. Scenario B (Orographic Amplification / 100-Year Recurrence): Enhanced convective lift across
   the Taygetos mountain spine (+25% intensity on windward ridges).
3. Scenario C (Gauge-Only Ordinary Kriging Benchmark): Interpolation relying solely on sparse
   gauges without satellite texture, serving as a baseline to demonstrate the added value of remote sensing.
"""

from pathlib import Path
from typing import Optional
import numpy as np
import pandas as pd
import xarray as xr
from pyproj import Transformer

from src.pipeline.config import (
    OUTPUTS_DIR,
    PROCESSED_DATA_DIR,
    CRS_EPSG,
    DOMAIN_BBOX_EPSG2100,
)
from src.submodels.s1_meteo.precip_harmonizer import (
    OrdinaryKriging2D,
    generate_rain_on_grid,
)

BASE_RAIN_NC = PROCESSED_DATA_DIR / "rainfall/mani_rain_on_grid_20260815.nc"
STATION_CSV = PROCESSED_DATA_DIR / "rainfall/ground_stations_august2026.csv"
HYETOGRAPH_CSV = PROCESSED_DATA_DIR / "rainfall/ground_station_hyetographs_10min.csv"
DEM_COG_PATH = PROCESSED_DATA_DIR / "terrain/mani_dem_5m_conditioned.tif"
OUTPUT_TIMELINE_NC = OUTPUTS_DIR / "02_meteorology/Mani_Rainfall_Storm_Timeline.nc"


def generate_precipitation_scenarios(
    base_nc_path: Optional[Path] = None,
    output_nc_path: Optional[Path] = None,
) -> Path:
    """Generate multi-scenario precipitation NetCDF-4 dataset for publication and hydrodynamic modeling.
    
    Args:
        base_nc_path: Path to baseline calibrated Rain-on-Grid NetCDF.
        output_nc_path: Path to multi-scenario output NetCDF.
        
    Returns:
        Path to generated NetCDF file.
    """
    nc_in = Path(base_nc_path or BASE_RAIN_NC)
    nc_out = Path(output_nc_path or OUTPUT_TIMELINE_NC)
    nc_out.parent.mkdir(parents=True, exist_ok=True)

    if not nc_in.exists():
        print(f"[INIT] Base NetCDF not found at {nc_in}. Generating via precip_harmonizer...")
        generate_rain_on_grid(output_nc_path=nc_in)

    print(f"[1/4] Loading baseline calibrated precipitation from: {nc_in}")
    ds_base = xr.open_dataset(nc_in)

    time_vals = ds_base["time"].values
    y_vals = ds_base["y"].values
    x_vals = ds_base["x"].values
    ny, nx = len(y_vals), len(x_vals)
    n_times = len(time_vals)

    rain_rate_base = ds_base["rainfall_rate"].values  # Shape: (time, y, x)
    accum_base = ds_base["accumulated_rain"].values    # Shape: (y, x)

    # -------------------------------------------------------------------------
    # Scenario B: Orographic Amplification across Taygetos Mountain Crest
    # -------------------------------------------------------------------------
    print("[2/4] Synthesizing Scenario B (Orographic Amplification / Recurrence Sensitivity)...")
    # Load elevation or compute orographic ridge factor
    grid_x, grid_y = np.meshgrid(x_vals, y_vals)
    # Taygetos mountain spine runs N-S around X ~ 358,000m to 365,000m
    # Windward eastern slope facing convective inflow from Aegean / Mirtoo Sea
    ridge_center_x = 360000.0
    ridge_sigma_x = 7500.0
    orographic_ridge_profile = np.exp(-((grid_x - ridge_center_x) / ridge_sigma_x)**2)
    # North-South elongation along the peninsular spine (between Y=4030000 and 4075000)
    spine_y_mask = np.exp(-((grid_y - 4050000.0) / 22000.0)**2)
    orographic_enhancement = 1.0 + 0.25 * orographic_ridge_profile * spine_y_mask

    rain_rate_orographic = (rain_rate_base * orographic_enhancement[None, :, :]).astype(np.float32)
    accum_orographic = np.sum(rain_rate_orographic * (10.0 / 60.0), axis=0).astype(np.float32)

    # -------------------------------------------------------------------------
    # Scenario C: Gauge-Only Ordinary Kriging Benchmark (No Remote Sensing)
    # -------------------------------------------------------------------------
    print("[3/4] Synthesizing Scenario C (Gauge-Only Kriging Benchmark)...")
    stations_df = pd.read_csv(STATION_CSV)
    hyet_df = pd.read_csv(HYETOGRAPH_CSV)
    st_x = stations_df["x_epsg2100"].values.astype(np.float64)
    st_y = stations_df["y_epsg2100"].values.astype(np.float64)
    st_ids = stations_df["station_id"].tolist()
    n_st = len(st_ids)

    kriging_gauge_only = OrdinaryKriging2D(
        x_pts=st_x,
        y_pts=st_y,
        grid_xx=grid_x,
        grid_yy=grid_y,
        range_m=35000.0,
        sill=1.0,
        nugget=0.0,
    )

    rain_rate_krig_only = np.zeros((n_times, ny, nx), dtype=np.float32)
    all_timestamps = [pd.to_datetime(str(t)).strftime("%Y-%m-%dT%H:%M:%SZ") for t in time_vals]

    for t_idx, t_str in enumerate(all_timestamps):
        sub_hyet = hyet_df[hyet_df["timestamp_utc"] == t_str]
        g_obs = np.zeros(n_st, dtype=np.float64)
        for i, sid in enumerate(st_ids):
            match = sub_hyet[sub_hyet["station_id"] == sid]
            if not match.empty:
                g_obs[i] = match["rain_rate_mm_h"].values[0]
        g_pred = kriging_gauge_only.predict(g_obs)
        rain_rate_krig_only[t_idx] = np.maximum(0.0, g_pred).astype(np.float32)

    accum_krig_only = np.sum(rain_rate_krig_only * (10.0 / 60.0), axis=0).astype(np.float32)

    # -------------------------------------------------------------------------
    # Step 4: Assemble Multi-Scenario NetCDF-4
    # -------------------------------------------------------------------------
    print(f"[4/4] Writing Multi-Scenario NetCDF-4 to: {nc_out}")
    ds_scenarios = xr.Dataset(
        data_vars={
            # Baseline Calibrated Scenario (Scenario A)
            "rainfall_rate": (["time", "y", "x"], rain_rate_base, {
                "long_name": "Calibrated Precipitation Rate (Scenario A - Baseline Merged)",
                "units": "mm h-1",
                "standard_name": "rainfall_rate",
                "grid_mapping": "spatial_ref",
            }),
            "accumulated_rain": (["y", "x"], accum_base, {
                "long_name": "Storm Total Accumulated Precipitation (Scenario A)",
                "units": "mm",
                "standard_name": "precipitation_amount",
                "grid_mapping": "spatial_ref",
            }),
            # Orographic Amplified Scenario (Scenario B)
            "rainfall_rate_orographic": (["time", "y", "x"], rain_rate_orographic, {
                "long_name": "Precipitation Rate (Scenario B - Orographic Amplification)",
                "units": "mm h-1",
                "standard_name": "rainfall_rate",
                "grid_mapping": "spatial_ref",
            }),
            "accumulated_rain_orographic": (["y", "x"], accum_orographic, {
                "long_name": "Storm Total Precipitation (Scenario B - Orographic)",
                "units": "mm",
                "standard_name": "precipitation_amount",
                "grid_mapping": "spatial_ref",
            }),
            # Gauge-Only Kriging Benchmark (Scenario C)
            "rainfall_rate_gauge_kriging": (["time", "y", "x"], rain_rate_krig_only, {
                "long_name": "Precipitation Rate (Scenario C - Gauge-Only Kriging Benchmark)",
                "units": "mm h-1",
                "standard_name": "rainfall_rate",
                "grid_mapping": "spatial_ref",
            }),
            "accumulated_rain_gauge_kriging": (["y", "x"], accum_krig_only, {
                "long_name": "Storm Total Precipitation (Scenario C - Gauge-Only)",
                "units": "mm",
                "standard_name": "precipitation_amount",
                "grid_mapping": "spatial_ref",
            }),
            "spatial_ref": ([], 0, {
                "grid_mapping_name": "transverse_mercator",
                "semi_major_axis": 6378137.0,
                "inverse_flattening": 298.257222101,
                "latitude_of_projection_origin": 0.0,
                "central_meridian": 24.0,
                "scale_factor_at_central_meridian": 0.9996,
                "false_easting": 500000.0,
                "false_northing": 0.0,
                "epsg_code": CRS_EPSG,
            }),
        },
        coords={
            "time": ("time", time_vals),
            "y": ("y", y_vals, {"units": "m", "standard_name": "projection_y_coordinate"}),
            "x": ("x", x_vals, {"units": "m", "standard_name": "projection_x_coordinate"}),
        },
        attrs={
            "title": "Mani August 15 2026 Flood Reconstruction - Multi-Scenario Storm Timeline",
            "institution": "National Observatory of Athens (NOA) & Research Project",
            "methodology": "Geostatistical Conditional Merging (Sinclair & Pegram 2005) & Sensitivity Scenarios",
            "scenario_a": "Baseline Observed: Sinclair & Pegram Conditional Merging anchored to NOA Kokkala (141.4 mm)",
            "scenario_b": "Orographic Amplified: +25% enhancement along Taygetos spine (100-year recurrence surrogate)",
            "scenario_c": "Gauge-Only Kriging: Ordinary Kriging benchmark without satellite spatial texture",
            "crs": f"EPSG:{CRS_EPSG}",
            "conventions": "CF-1.8",
        },
    )

    encoding = {
        var: {"zlib": True, "complevel": 4, "dtype": "float32"}
        for var in [
            "rainfall_rate", "accumulated_rain",
            "rainfall_rate_orographic", "accumulated_rain_orographic",
            "rainfall_rate_gauge_kriging", "accumulated_rain_gauge_kriging",
        ]
    }

    ds_scenarios.to_netcdf(str(nc_out), format="NETCDF4", encoding=encoding)
    ds_base.close()

    print(f"[SUCCESS] Multi-Scenario Timeline written to: {nc_out} ({nc_out.stat().st_size / (1024**2):.2f} MB)")
    print(f"          Scenario A Peak Accumulation: {float(np.max(accum_base)):.2f} mm")
    print(f"          Scenario B Peak Accumulation: {float(np.max(accum_orographic)):.2f} mm")
    print(f"          Scenario C Peak Accumulation: {float(np.max(accum_krig_only)):.2f} mm")
    return nc_out


if __name__ == "__main__":
    generate_precipitation_scenarios()
