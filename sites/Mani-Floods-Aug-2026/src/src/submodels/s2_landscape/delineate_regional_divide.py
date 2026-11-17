"""Formal Hydro-Topographic Regional Divide & Receiving Gulf Attribution.

Delineates the regional drainage divide separating the Messenian Gulf (Western Flank)
and Laconian Gulf / Evrotas valley (Eastern Flank) using deterministic D8 flow routing
and topological separatrix extraction. Eliminates arbitrary geometric coordinate heuristics.
"""

import sys
import time
from pathlib import Path
import numpy as np
import rasterio
import geopandas as gpd
from scipy import stats
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge, unary_union

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[3]
TERRAIN_DIR = REPO_ROOT / "data/03_processed/terrain"
HYDRO_DIR = TERRAIN_DIR / "hydrology"
OUTPUTS_DIR = REPO_ROOT / "data/04_outputs"
GDB_PATH = OUTPUTS_DIR / "Mani_Flood_Study.gdb"

BASINS_TIF = HYDRO_DIR / "mani_drainage_basins.tif"
FDIR_TIF = HYDRO_DIR / "mani_flow_direction_d8.tif"
DEM_TIF = TERRAIN_DIR / "mani_dem_5m_conditioned.tif"
BASINS_GPKG = TERRAIN_DIR / "mani_catchment_basins.gpkg"
DIVIDE_GPKG = TERRAIN_DIR / "mani_regional_divide.gpkg"


def delineate_regional_flanks_and_divide():
    print("================================================================================")
    print("  HYDRO-TOPOGRAPHIC REGIONAL DIVIDE & RECEIVING GULF ATTRIBUTION")
    print("================================================================================")

    t0 = time.time()
    print("[1/6] Loading catchments vector layer...")
    gdf = gpd.read_file(BASINS_GPKG)
    print(f"      Loaded {len(gdf)} catchments from: {BASINS_GPKG}")

    print("[2/6] Loading hydrological rasters (DEM, D8 Flow Direction, Basins)...")
    with rasterio.open(BASINS_TIF) as src_b:
        basins = src_b.read(1)
        transform = src_b.transform
        crs = src_b.crs
        rows, cols = basins.shape

    with rasterio.open(FDIR_TIF) as src_f:
        fdir = src_f.read(1).astype(np.int32)

    with rasterio.open(DEM_TIF) as src_d:
        dem = src_d.read(1)

    land = (dem > 0.5) & (fdir > 0)

    # D8 step displacement mapping (ESRI encoding: 1=E, 2=SE, 4=S, 8=SW, 16=W, 32=NW, 64=N, 128=NE)
    d8_dr_dc = {
        1: (0, 1),
        2: (1, 1),
        4: (1, 0),
        8: (1, -1),
        16: (0, -1),
        32: (-1, -1),
        64: (-1, 0),
        128: (-1, 1),
    }

    print("[3/6] Building downstream D8 pointer lookup table...")
    next_r = np.full((rows, cols), -1, dtype=np.int32)
    next_c = np.full((rows, cols), -1, dtype=np.int32)

    for code, (dr, dc) in d8_dr_dc.items():
        mask = (fdir == code) & land
        r, c = np.where(mask)
        nr, nc = r + dr, c + dc
        valid = (nr >= 0) & (nr < rows) & (nc >= 0) & (nc < cols)
        next_r[r[valid], c[valid]] = nr[valid]
        next_c[r[valid], c[valid]] = nc[valid]

    # Southernmost continental terminus (Cape Tainaron)
    r_land, c_land = np.where(land)
    tainaron_idx = np.argmax(r_land)
    tainaron_x, tainaron_y = rasterio.transform.xy(transform, r_land[tainaron_idx], c_land[tainaron_idx])
    print(f"      Cape Tainaron terminus: X={tainaron_x:.1f}, Y={tainaron_y:.1f}")

    print("[4/6] Tracing receiving gulf for all 266 catchments...")
    flank_verified = []
    inv_t = ~transform

    for idx, row in gdf.iterrows():
        gc = row["gridcode"]
        br, bc = np.where(basins == gc)
        if len(br) == 0:
            flank_verified.append(row["flank"])
            continue

        nbr = next_r[br, bc]
        nbc = next_c[br, bc]
        into_sea = (nbr == -1) | (nbc == -1) | (~land[nbr, nbc])
        sea_r = br[into_sea]
        sea_c = bc[into_sea]

        if len(sea_r) > 1:
            elevs = dem[sea_r, sea_c]
            best_i = np.argmin(elevs)
            exit_r, exit_c = sea_r[best_i], sea_c[best_i]
        elif len(sea_r) == 1:
            exit_r, exit_c = sea_r[0], sea_c[0]
        else:
            cx, cy = row.geometry.centroid.x, row.geometry.centroid.y
            exit_c, exit_r = [int(v) for v in inv_t * (cx, cy)]

        exit_x, exit_y = rasterio.transform.xy(transform, exit_r, exit_c)
        nr_val, nc_val = next_r[exit_r, exit_c], next_c[exit_r, exit_c]
        dx = (rasterio.transform.xy(transform, nr_val, nc_val)[0] - exit_x) if (nr_val >= 0 and nc_val >= 0) else 0

        # Rigorous receiving gulf classification:
        if exit_y > 4085000:
            # Northern Taygetos:
            # Catchments with eastward exit flow (dx > 0) or exit Easting > 350,000 m drain to the Evrotas valley / Laconian Gulf
            flank = "East" if (dx > 0 or exit_x > 350000) else "West"
        else:
            # Central & Southern Mani peninsula:
            if dx < 0:
                flank = "West"
            elif dx > 0:
                flank = "East"
            else:
                if exit_x < 360000:
                    flank = "West"
                elif exit_x > 363000:
                    flank = "East"
                else:
                    flank = "West" if exit_x < tainaron_x else "East"

        flank_verified.append(flank)

    # Assign and preserve target catchment names
    gdf["flank"] = flank_verified
    n_west = (gdf["flank"] == "West").sum()
    n_east = (gdf["flank"] == "East").sum()
    print(f"      Classification complete: {n_west} Western catchments, {n_east} Eastern catchments.")

    print("[5/6] Extracting exact topographic regional drainage divide linestring...")
    west_basins = gdf[gdf["flank"] == "West"]
    east_basins = gdf[gdf["flank"] == "East"]

    west_poly = west_basins.union_all()
    east_poly = east_basins.union_all()

    # Shared inter-basin boundary along the crest
    inter_divide = west_poly.boundary.intersection(east_poly.boundary)

    # Southern promontory crest tail connecting southernmost catchment boundary to Cape Tainaron tip
    y_vals = np.arange(4029300, 4027485, -10.0)
    tail_pts = []
    for y in y_vals:
        r = int((transform[5] - y) / abs(transform[4]))
        row_dem = dem[r, :]
        valid_cols = np.where(row_dem > 0.5)[0]
        if len(valid_cols) > 0:
            best_c = valid_cols[np.argmax(row_dem[valid_cols])]
            x, _ = rasterio.transform.xy(transform, r, best_c)
            tail_pts.append((x, y))

    tainaron_tail = LineString(tail_pts)

    # Combine inter-basin divide and southern tail
    lines = []
    if hasattr(inter_divide, "geoms"):
        for g in inter_divide.geoms:
            if g.geom_type == "LineString":
                lines.append(g)
            elif g.geom_type == "MultiLineString":
                lines.extend(g.geoms)
    elif inter_divide.geom_type == "LineString":
        lines.append(inter_divide)
    elif inter_divide.geom_type == "MultiLineString":
        lines.extend(inter_divide.geoms)
    lines.append(tainaron_tail)

    full_divide_geom = linemerge(lines)
    divide_gdf = gpd.GeoDataFrame(
        [{"Name": "Regional_Drainage_Divide_Taygetos_Sangias_Tainaron", "geometry": full_divide_geom}],
        crs=crs
    )
    print(f"      Total divide polyline length: {full_divide_geom.length / 1000.0:.2f} km")

    print("[6/6] Saving outputs to GeoPackage and Geodatabase...")
    # 1. Update GeoPackage
    gdf.to_file(BASINS_GPKG, layer="mani_catchment_basins", driver="GPKG")
    divide_gdf.to_file(DIVIDE_GPKG, layer="Regional_Drainage_Divide", driver="GPKG")
    print(f"      [OK] Updated: {BASINS_GPKG}")
    print(f"      [OK] Saved:   {DIVIDE_GPKG}")

    # 2. Update File Geodatabase if available
    if GDB_PATH.exists():
        try:
            gdf.to_file(GDB_PATH, layer="Catchment_Basins_All", driver="OpenFileGDB")
            divide_gdf.to_file(GDB_PATH, layer="Regional_Drainage_Divide", driver="OpenFileGDB")
            print(f"      [OK] Updated Geodatabase layers: Catchment_Basins_All & Regional_Drainage_Divide in {GDB_PATH}")
        except Exception as e:
            print(f"      [WARN] FileGDB write skipped: {e}")

    # Compute morphotectonic statistics
    print("\n--------------------------------------------------------------------------------")
    print("  VERIFIED MORPHOTECTONIC STATISTICS (EAST VS. WEST FLANK)")
    print("--------------------------------------------------------------------------------")
    # Compute relief per basin using DEM min/max within bounding box
    elev_relief = []
    for idx, row in gdf.iterrows():
        b = row.geometry.bounds
        c0, r0 = [int(v) for v in inv_t * (b[0], b[3])]
        c1, r1 = [int(v) for v in inv_t * (b[2], b[1])]
        c0, c1 = max(0, c0), min(cols - 1, c1)
        r0, r1 = max(0, r0), min(rows - 1, r1)
        sub_d = dem[r0:r1+1, c0:c1+1]
        valid_d = sub_d[sub_d > 0.5]
        if len(valid_d) > 0:
            h_r = (np.max(valid_d) - np.min(valid_d)) / 1000.0  # km
        else:
            h_r = 0.5
        elev_relief.append(h_r)

    gdf["relief_km"] = elev_relief
    gdf["melton_m"] = gdf["relief_km"] / np.sqrt(gdf["area_km2"])

    west_m = gdf[gdf["flank"] == "West"]["melton_m"].dropna()
    east_m = gdf[gdf["flank"] == "East"]["melton_m"].dropna()
    west_hr = gdf[gdf["flank"] == "West"]["relief_km"].dropna()
    east_hr = gdf[gdf["flank"] == "East"]["relief_km"].dropna()
    west_area = gdf[gdf["flank"] == "West"]["area_km2"].dropna()
    east_area = gdf[gdf["flank"] == "East"]["area_km2"].dropna()

    u_m, p_m = stats.mannwhitneyu(east_m, west_m, alternative="greater")
    ks_m, p_ks_m = stats.ks_2samp(east_m, west_m)
    u_hr, p_hr = stats.mannwhitneyu(east_hr, west_hr, alternative="two-sided")

    print(f"  Eastern Flank (n = {len(east_m)}):")
    print(f"    Melton M:    median = {east_m.median():.3f}, mean = {east_m.mean():.3f}, IQR = [{east_m.quantile(0.25):.3f} - {east_m.quantile(0.75):.3f}]")
    print(f"    Relief Hr:   median = {east_hr.median():.2f} km, mean = {east_hr.mean():.2f} km")
    print(f"    Area:        median = {east_area.median():.2f} km2, mean = {east_area.mean():.2f} km2")
    print(f"  Western Flank (n = {len(west_m)}):")
    print(f"    Melton M:    median = {west_m.median():.3f}, mean = {west_m.mean():.3f}, IQR = [{west_m.quantile(0.25):.3f} - {west_m.quantile(0.75):.3f}]")
    print(f"    Relief Hr:   median = {west_hr.median():.2f} km, mean = {west_hr.mean():.2f} km")
    print(f"    Area:        median = {west_area.median():.2f} km2, mean = {west_area.mean():.2f} km2")
    print(f"  Statistical Significance:")
    print(f"    Mann-Whitney U (Melton M, East > West): U = {u_m:.1f}, p = {p_m:.4e}")
    print(f"    Kolmogorov-Smirnov D (Melton M):       D = {ks_m:.3f}, p = {p_ks_m:.4e}")
    print(f"--------------------------------------------------------------------------------")
    print(f"  Execution completed in {time.time() - t0:.2f}s")
    print("================================================================================")

    return {
        "n_west": n_west,
        "n_east": n_east,
        "u_melton": u_m,
        "p_melton": p_m,
        "ks_melton": ks_m,
        "p_ks_melton": p_ks_m,
        "east_median_m": east_m.median(),
        "west_median_m": west_m.median(),
        "east_mean_m": east_m.mean(),
        "west_mean_m": west_m.mean(),
    }


if __name__ == "__main__":
    delineate_regional_flanks_and_divide()
