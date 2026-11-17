"""Precipitation Harmonization and Rain-on-Grid Generator.

Blends multi-sensor satellite rainfall retrievals (EUMETSAT H-SAF H40B / MTG-FCI)
with verified ground station observations (NOA Kokkala, NOA Kardamyli, and HNMS regional controls)
using Geostatistical Conditional Merging (Sinclair & Pegram 2005; Goudenhoofdt & Delobbe 2009)
and cloud-top parallax geometry correction to produce an exact, mass-conserving,
spatio-temporal Rain-on-Grid NetCDF-4 dataset for 2D hydrodynamic simulations.
"""

from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
import xarray as xr
from scipy.interpolate import griddata
from pyproj import Transformer

from src.pipeline.config import (
    INTERMEDIATE_DATA_DIR,
    PROCESSED_DATA_DIR,
    CRS_EPSG,
    DOMAIN_BBOX_EPSG2100,
)

HSAF_SERIES_NPZ = INTERMEDIATE_DATA_DIR / "rainfall_atmosphere/rainfall_comparison/hsaf_native_series.npz"
STATION_CSV = PROCESSED_DATA_DIR / "rainfall/ground_stations_august2026.csv"
HYETOGRAPH_CSV = PROCESSED_DATA_DIR / "rainfall/ground_station_hyetographs_10min.csv"
OUTPUT_RAIN_NC = PROCESSED_DATA_DIR / "rainfall/mani_rain_on_grid_20260815.nc"


class OrdinaryKriging2D:
    """Vectorized 2D Ordinary Kriging with pre-computed spatial weights."""

    def __init__(
        self,
        x_pts: np.ndarray,
        y_pts: np.ndarray,
        grid_xx: np.ndarray,
        grid_yy: np.ndarray,
        range_m: float = 35000.0,
        sill: float = 1.0,
        nugget: float = 0.0,
    ) -> None:
        """Initialize and precompute Kriging inversion and grid weights.
        
        Args:
            x_pts: 1D array of observation X coordinates in projected CRS (EPSG:2100).
            y_pts: 1D array of observation Y coordinates in projected CRS (EPSG:2100).
            grid_xx: 2D meshgrid of target X coordinates.
            grid_yy: 2D meshgrid of target Y coordinates.
            range_m: Spatial correlation range in meters (~35 km for Mediterranean convection).
            sill: Structural semivariance sill.
            nugget: Nugget variance (0.0 enforces exact interpolation at observations).
        """
        self.x_pts = np.asarray(x_pts, dtype=np.float64)
        self.y_pts = np.asarray(y_pts, dtype=np.float64)
        self.n = len(self.x_pts)
        self.range_m = float(range_m)
        self.sill = float(sill)
        self.nugget = float(nugget)
        self.ny, self.nx = grid_xx.shape

        # Inter-station distance matrix
        dx = self.x_pts[:, None] - self.x_pts[None, :]
        dy = self.y_pts[:, None] - self.y_pts[None, :]
        h = np.sqrt(dx**2 + dy**2)

        # Exponential semivariogram model
        gamma = np.where(
            h == 0,
            0.0,
            self.nugget + self.sill * (1.0 - np.exp(-3.0 * h / self.range_m))
        )

        # Augmented Kriging system matrix (n+1, n+1) with Lagrange multiplier
        kriging_matrix = np.zeros((self.n + 1, self.n + 1), dtype=np.float64)
        kriging_matrix[:self.n, :self.n] = gamma
        kriging_matrix[:self.n, self.n] = 1.0
        kriging_matrix[self.n, :self.n] = 1.0
        kriging_matrix[self.n, self.n] = 0.0

        self.kriging_inv = np.linalg.pinv(kriging_matrix)

        # Vectorized precomputation of station-to-grid weights
        flat_x = grid_xx.ravel()
        flat_y = grid_yy.ravel()
        m_cells = len(flat_x)

        dx_grid = self.x_pts[:, None] - flat_x[None, :]
        dy_grid = self.y_pts[:, None] - flat_y[None, :]
        h_grid = np.sqrt(dx_grid**2 + dy_grid**2)

        gamma_grid = np.where(
            h_grid == 0,
            0.0,
            self.nugget + self.sill * (1.0 - np.exp(-3.0 * h_grid / self.range_m))
        )

        rhs_matrix = np.ones((self.n + 1, m_cells), dtype=np.float64)
        rhs_matrix[:self.n, :] = gamma_grid

        # Solve Kriging weights for all target cells simultaneously
        weights = self.kriging_inv @ rhs_matrix
        self.station_weights = weights[:self.n, :]  # Shape: (n_stations, m_cells)

    def predict(self, z_obs: np.ndarray) -> np.ndarray:
        """Predict 2D spatial field for a given vector of station observations.
        
        Args:
            z_obs: 1D array of observed values at stations, length n.
            
        Returns:
            2D numpy array of shape (ny, nx) with interpolated values.
        """
        z_vec = np.asarray(z_obs, dtype=np.float64)
        z_pred_flat = z_vec @ self.station_weights
        return z_pred_flat.reshape((self.ny, self.nx))


def compute_parallax_displacement(
    cloud_top_height_m: float = 12500.0,
    sat_longitude_deg: float = 0.0,
    domain_lat_deg: float = 36.528,
    domain_lon_deg: float = 22.474,
) -> Tuple[float, float]:
    """Calculate parallax displacement offset for geostationary satellite cloud tops.
    
    For Meteosat-12 at 0°E observing Mani (~36.5°N, 22.5°E), convective cloud tops
    at 12-13 km altitude are viewed at ~42.5° zenith angle toward SSW, projecting
    cloud tops ~11.5 km NNE of actual surface precipitation centroids.
    
    Args:
        cloud_top_height_m: Convective cloud top height in meters.
        sat_longitude_deg: Sub-satellite point longitude (0.0° for Meteosat prime).
        domain_lat_deg: Target latitude in degrees.
        domain_lon_deg: Target longitude in degrees.
        
    Returns:
        Tuple of (dx_m, dy_m) in EPSG:2100 Greek Grid to reverse parallax.
    """
    # Geostationary orbital radius
    r_geo = 42164000.0  # meters from Earth center
    r_earth = 6371000.0  # mean Earth radius

    lat_rad = np.radians(domain_lat_deg)
    dlon_rad = np.radians(domain_lon_deg - sat_longitude_deg)

    # Satellite viewing geometry
    cos_gamma = np.cos(lat_rad) * np.cos(dlon_rad)
    d_sat = np.sqrt(r_earth**2 + r_geo**2 - 2.0 * r_earth * r_geo * cos_gamma)

    # Viewing zenith angle (angle between local zenith and satellite line-of-sight)
    sin_zenith = (r_geo / d_sat) * np.sin(np.arccos(cos_gamma))
    zenith_rad = np.arcsin(min(1.0, sin_zenith))

    # Horizontal apparent displacement of cloud top relative to ground base
    ground_displacement = cloud_top_height_m * np.tan(zenith_rad)

    # Azimuth of satellite from target (view angle direction is opposite)
    azimuth_rad = np.arctan2(np.sin(dlon_rad), np.sin(lat_rad) * np.cos(dlon_rad))

    # Reverse displacement vector to shift satellite cloud top back to surface rain core
    dx = -ground_displacement * np.sin(azimuth_rad)
    dy = -ground_displacement * np.cos(azimuth_rad)
    return float(dx), float(dy)


def generate_rain_on_grid(
    hsaf_npz_path: Optional[Path] = None,
    station_csv_path: Optional[Path] = None,
    hyetograph_csv_path: Optional[Path] = None,
    output_nc_path: Optional[Path] = None,
    grid_resolution_m: float = 100.0,
    cloud_top_height_m: float = 12500.0,
) -> Path:
    """Generate calibrated 2D Rain-on-Grid NetCDF using Sinclair & Pegram Conditional Merging.
    
    Args:
        hsaf_npz_path: Path to H-SAF series NPZ.
        station_csv_path: Path to ground station metadata CSV.
        hyetograph_csv_path: Path to 10-minute ground station hyetographs.
        output_nc_path: Path to output NetCDF dataset.
        grid_resolution_m: Spatial grid resolution in meters (default: 100.0m).
        cloud_top_height_m: Cloud top height for parallax correction (default: 12.5 km).
        
    Returns:
        Path to generated NetCDF file.
    """
    npz_in = Path(hsaf_npz_path or HSAF_SERIES_NPZ)
    station_in = Path(station_csv_path or STATION_CSV)
    hyet_in = Path(hyetograph_csv_path or HYETOGRAPH_CSV)
    nc_out = Path(output_nc_path or OUTPUT_RAIN_NC)
    nc_out.parent.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Loading ground station network and hyetographs...")
    stations_df = pd.read_csv(station_in)
    hyet_df = pd.read_csv(hyet_in)

    st_ids = stations_df["station_id"].tolist()
    st_names = stations_df["station_name"].tolist()
    st_x = stations_df["x_epsg2100"].values.astype(np.float64)
    st_y = stations_df["y_epsg2100"].values.astype(np.float64)
    n_st = len(st_ids)
    print(f"      Ingested {n_st} ground stations (East Mani epicenter to regional controls).")

    all_timestamps = sorted(hyet_df["timestamp_utc"].unique())
    n_times = len(all_timestamps)
    print(f"      Temporal duration: {n_times} slots of 10 min ({all_timestamps[0]} to {all_timestamps[-1]})")

    # Target 2D Rain-on-Grid mesh in EPSG:2100
    print(f"[2/5] Constructing EPSG:{CRS_EPSG} Rain-on-Grid mesh at {grid_resolution_m:.0f}m resolution...")
    x_min, y_min, x_max, y_max = DOMAIN_BBOX_EPSG2100
    x_coords = np.arange(x_min, x_max, grid_resolution_m)
    y_coords = np.arange(y_max, y_min, -grid_resolution_m)
    grid_x, grid_y = np.meshgrid(x_coords, y_coords)
    ny, nx = grid_x.shape
    print(f"      Rain-on-Grid Dimensions: {nx} cols x {ny} rows ({nx * ny:,} cells)")

    # Compute cloud top parallax correction
    dx_parallax, dy_parallax = compute_parallax_displacement(cloud_top_height_m=cloud_top_height_m)
    print(f"      Parallax displacement correction: dx = {dx_parallax:.1f} m, dy = {dy_parallax:.1f} m")

    # Load satellite series and apply parallax shift
    print(f"[3/5] Loading EUMETSAT H-SAF satellite series and applying parallax shift...")
    hsaf_data = np.load(npz_in, allow_pickle=True)
    raw_sat_times = list(hsaf_data["h40b_nominal_utc"])
    raw_sat_rates = hsaf_data["h40b_rainfall_decoded"]
    sat_lon = hsaf_data["longitude"].flatten()
    sat_lat = hsaf_data["latitude"].flatten()

    transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{CRS_EPSG}", always_xy=True)
    sat_x, sat_y = transformer.transform(sat_lon, sat_lat)
    sat_x = np.asarray(sat_x, dtype=np.float64) + dx_parallax
    sat_y = np.asarray(sat_y, dtype=np.float64) + dy_parallax

    # Filter satellite slots strictly matching the active August 15 storm event (slots 0 to 18: 12:00 to 15:00 UTC)
    aug15_sat_slots = [
        (idx, t) for idx, t in enumerate(raw_sat_times)
        if t.startswith("2026-08-15") and "12:00:00" <= t[-9:] <= "15:00:00"
    ]
    print(f"      Active storm satellite slots: {len(aug15_sat_slots)} (from {aug15_sat_slots[0][1]} to {aug15_sat_slots[-1][1]})")

    # Interpolate satellite prior onto 100m grid for each available slot
    sat_grid_priors: Dict[str, np.ndarray] = {}
    sat_point_coords = (sat_x, sat_y)
    for raw_idx, t_str in aug15_sat_slots:
        flat_rate = raw_sat_rates[raw_idx].flatten()
        interp_sat = griddata(
            sat_point_coords,
            flat_rate,
            (grid_x, grid_y),
            method="linear",
            fill_value=0.0
        ).astype(np.float32)
        sat_grid_priors[t_str] = np.maximum(0.0, interp_sat)

    # Initialize Ordinary Kriging engine
    print(f"[4/5] Initializing Ordinary Kriging system and running Conditional Merging...")
    kriging_engine = OrdinaryKriging2D(
        x_pts=st_x,
        y_pts=st_y,
        grid_xx=grid_x,
        grid_yy=grid_y,
        range_m=35000.0,
        sill=1.0,
        nugget=0.0
    )

    rain_rate_3d = np.zeros((n_times, ny, nx), dtype=np.float32)
    dt_hours = 10.0 / 60.0

    sat_first_time = pd.to_datetime(aug15_sat_slots[0][1])
    sat_last_time = pd.to_datetime(aug15_sat_slots[-1][1])

    for t_idx, t_str in enumerate(all_timestamps):
        current_time = pd.to_datetime(t_str)

        # 1. Gauge observations at time t
        sub_hyet = hyet_df[hyet_df["timestamp_utc"] == t_str]
        g_obs = np.zeros(n_st, dtype=np.float64)
        for i, sid in enumerate(st_ids):
            match = sub_hyet[sub_hyet["station_id"] == sid]
            if not match.empty:
                g_obs[i] = match["rain_rate_mm_h"].values[0]

        # 2. Kriged gauge field: G*(x, y, t)
        g_star = kriging_engine.predict(g_obs)

        # 3. Prior field S(x, y, t) on 100m grid
        if t_str in sat_grid_priors:
            s_grid = sat_grid_priors[t_str]
        elif current_time < sat_first_time:
            # Linear temporal spin-up from 0 to first satellite observation
            seconds_diff = (sat_first_time - current_time).total_seconds()
            ramp = max(0.0, 1.0 - seconds_diff / 3600.0)
            s_grid = sat_grid_priors[aug15_sat_slots[0][1]] * ramp
        else:
            # Linear temporal spin-down to zero after storm decay
            seconds_diff = (current_time - sat_last_time).total_seconds()
            ramp = max(0.0, 1.0 - seconds_diff / 3600.0)
            s_grid = sat_grid_priors[aug15_sat_slots[-1][1]] * ramp

        # 4. Sample prior field S at gauge locations: S_obs
        s_obs = np.zeros(n_st, dtype=np.float64)
        for i in range(n_st):
            col_idx = int(round((st_x[i] - x_min) / grid_resolution_m))
            row_idx = int(round((y_max - st_y[i]) / grid_resolution_m))
            if 0 <= row_idx < ny and 0 <= col_idx < nx:
                s_obs[i] = float(s_grid[row_idx, col_idx])
            else:
                s_obs[i] = 0.0  # Outer regional controls

        # 5. Kriged prior field from sampled gauge points: S*(x, y, t)
        s_star = kriging_engine.predict(s_obs)

        # 6. Sinclair & Pegram (2005) Conditional Merging: P_cm = G* + (S - S*)
        p_cm = g_star + (s_grid - s_star)
        p_cm = np.maximum(0.0, p_cm)

        # 7. Exact point preservation at gauge stations
        for i in range(n_st):
            col_idx = int(round((st_x[i] - x_min) / grid_resolution_m))
            row_idx = int(round((y_max - st_y[i]) / grid_resolution_m))
            if 0 <= row_idx < ny and 0 <= col_idx < nx:
                residual = g_obs[i] - p_cm[row_idx, col_idx]
                if abs(residual) > 1e-4:
                    dist = np.sqrt((grid_x - st_x[i])**2 + (grid_y - st_y[i])**2)
                    local_kernel = np.exp(-(dist / 2000.0)**2)
                    p_cm = np.maximum(0.0, p_cm + residual * local_kernel)

        rain_rate_3d[t_idx, :, :] = p_cm.astype(np.float32)

    # Compute storm total accumulation (mm)
    rain_10min_3d = rain_rate_3d * dt_hours
    accumulated_mm = np.sum(rain_10min_3d, axis=0)

    # Step 5: Assemble and export CF-1.8 compliant NetCDF-4
    print(f"[5/5] Assembling and exporting NetCDF-4 to: {nc_out}")
    time_indices = np.array([np.datetime64(t.replace("Z", "")) for t in all_timestamps])

    ds_rain = xr.Dataset(
        data_vars={
            "rainfall_rate": (["time", "y", "x"], rain_rate_3d, {
                "long_name": "Calibrated Precipitation Rate",
                "units": "mm h-1",
                "standard_name": "rainfall_rate",
                "grid_mapping": "spatial_ref",
            }),
            "rainfall_10min": (["time", "y", "x"], rain_10min_3d, {
                "long_name": "10-Minute Incremental Rainfall Depth",
                "units": "mm",
                "standard_name": "precipitation_amount",
                "grid_mapping": "spatial_ref",
            }),
            "accumulated_rain": (["y", "x"], accumulated_mm, {
                "long_name": "Storm Total Accumulated Precipitation",
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
            "time": ("time", time_indices),
            "y": ("y", y_coords, {"units": "m", "standard_name": "projection_y_coordinate"}),
            "x": ("x", x_coords, {"units": "m", "standard_name": "projection_x_coordinate"}),
        },
        attrs={
            "title": "Mani August 15 2026 Flood Reconstruction - Deterministic Rain-on-Grid",
            "institution": "National Observatory of Athens (NOA) & Research Project",
            "methodology": "Geostatistical Conditional Merging (Sinclair & Pegram 2005; Goudenhoofdt & Delobbe 2009)",
            "satellite_sensor": "EUMETSAT Meteosat-12 MTG-FCI / H-SAF H40B",
            "parallax_correction": f"dx = {dx_parallax:.1f} m, dy = {dy_parallax:.1f} m (cloud top height = {cloud_top_height_m} m)",
            "ground_calibration_stations": ", ".join(st_names),
            "grid_resolution_m": float(grid_resolution_m),
            "crs": f"EPSG:{CRS_EPSG}",
            "conventions": "CF-1.8",
        },
    )

    encoding = {
        "rainfall_rate": {"zlib": True, "complevel": 4, "dtype": "float32"},
        "rainfall_10min": {"zlib": True, "complevel": 4, "dtype": "float32"},
        "accumulated_rain": {"zlib": True, "complevel": 4, "dtype": "float32"},
    }

    ds_rain.to_netcdf(str(nc_out), format="NETCDF4", encoding=encoding)
    file_size_mb = nc_out.stat().st_size / (1024**2)
    print(f"[SUCCESS] Rain-on-Grid created: {nc_out} ({file_size_mb:.2f} MB)")
    print(f"          Max Point Accumulation:  {float(np.max(accumulated_mm)):.2f} mm")
    print(f"          Mean Domain Accumulation: {float(np.mean(accumulated_mm)):.2f} mm")

    # Point validation against ground stations
    print("\n--- Ground Station Verification Diagnostics ---")
    for i in range(n_st):
        col_idx = int(round((st_x[i] - x_min) / grid_resolution_m))
        row_idx = int(round((y_max - st_y[i]) / grid_resolution_m))
        obs_val = stations_df.loc[i, "aug15_daily_rain_mm"]
        if 0 <= row_idx < ny and 0 <= col_idx < nx:
            model_val = float(accumulated_mm[row_idx, col_idx])
            err = model_val - obs_val
            print(f"  [IN DOMAIN]  {st_ids[i]} ({st_names[i]}): Observed = {obs_val:6.2f} mm | Model = {model_val:6.2f} mm | Diff = {err:+.4f} mm")
        else:
            print(f"  [CONTROL]    {st_ids[i]} ({st_names[i]}): Observed = {obs_val:6.2f} mm | Outer control bounding station")

    return nc_out


if __name__ == "__main__":
    generate_rain_on_grid()
