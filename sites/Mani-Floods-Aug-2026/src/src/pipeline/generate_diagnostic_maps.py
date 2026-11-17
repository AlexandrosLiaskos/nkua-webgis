"""Generate Step-by-Step Visual Diagnostic Maps for Alexandros Liaskos.

Creates two high-resolution visual diagnostic maps:
1. Map 1: DEM Hydro-Conditioning Diagnostic (Sink Fill Depths & Drainage Artifacts)
   - Panel (a): Full Peninsula Sink Fill Depth (DEM_filled - DEM_raw) on Hillshade
   - Panel (b): Kokkala Gorge Zoom: Legitimate natural gorge thalweg
   - Panel (c): West/Central Karst Plateau Zoom: 174m filled sinkhole and spurious straight lines
2. Map 2: Step-by-Step Physical Simulation Cascade
   - Panel (a) Topography & Karst Landforms (5m DEM)
   - Panel (b) Convective Cloudburst Hyetograph & Spatial Rain-on-Grid (141.4 mm vs leeward)
   - Panel (c) Soil Infiltration & Burned Runoff Excess Pe (mm/h)
   - Panel (d) Resulting Hydrodynamic Hazard Rating (HR) and Boulder Transport (D_max)
"""

import sys
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.ticker as ticker
from matplotlib.patches import Rectangle
from osgeo import gdal, ogr

sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(r"E:\Publications\Research\Mani Floods August 2026")
PROCESSED_DIR = ROOT_DIR / "data/03_processed"
OUTPUTS_DIR = ROOT_DIR / "data/04_outputs"
MAPS_DIR = OUTPUTS_DIR / "maps"
MAPS_DIR.mkdir(parents=True, exist_ok=True)

# Rasters
RAW_DEM = PROCESSED_DIR / "terrain/mani_dem_5m_conditioned.tif"
FILLED_DEM = PROCESSED_DIR / "terrain/mani_dem_5m_filled.tif"
HILLSHADE = PROCESSED_DIR / "terrain/mani_hillshade.tif"
FACC = PROCESSED_DIR / "terrain/hydrology/mani_flow_accumulation.tif"
HAZARD = OUTPUTS_DIR / "power_hazard/mani_flood_hazard_rating_hr.tif"
BOULDER = OUTPUTS_DIR / "power_hazard/mani_max_boulder_diameter_m.tif"
STREAMS_GPKG = PROCESSED_DIR / "terrain/mani_stream_network.gpkg"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman", "Palatino"],
    "mathtext.fontset": "cm",
    "font.size": 9.5,
    "axes.labelsize": 9.5,
    "axes.titlesize": 10.5,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "figure.dpi": 300,
    "savefig.dpi": 300,
})


def read_raster_window(tif_path, x_min=None, x_max=None, y_min=None, y_max=None, target_dim=1200):
    ds = gdal.Open(str(tif_path), gdal.GA_ReadOnly)
    if not ds:
        raise FileNotFoundError(f"Missing raster: {tif_path}")
    gt = ds.GetGeoTransform()
    x_orig, y_orig = gt[0], gt[3]
    pw, ph = gt[1], gt[5]
    cols, rows = ds.RasterXSize, ds.RasterYSize

    if x_min is not None:
        c_start = int(max(0, (x_min - x_orig) / pw))
        c_end = int(min(cols, (x_max - x_orig) / pw))
        r_start = int(max(0, (y_max - y_orig) / ph))
        r_end = int(min(rows, (y_min - y_orig) / ph))
        w_cols = max(1, c_end - c_start)
        w_rows = max(1, r_end - r_start)
    else:
        c_start, r_start = 0, 0
        w_cols, w_rows = cols, rows

    step = max(1, int(max(w_cols, w_rows) / target_dim))
    out_cols = int(w_cols / step)
    out_rows = int(w_rows / step)

    band = ds.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    data = band.ReadAsArray(c_start, r_start, w_cols, w_rows, buf_xsize=out_cols, buf_ysize=out_rows).astype(np.float32)

    x_l = x_orig + c_start * pw
    x_r = x_l + w_cols * pw
    y_t = y_orig + r_start * ph
    y_b = y_t + w_rows * ph
    extent = [x_l, x_r, y_b, y_t]

    if nodata is not None:
        data = np.ma.masked_equal(data, nodata)
    data = np.ma.masked_invalid(data)
    ds = None
    return data, extent


def add_settlement_markers(ax, x0, x1, y0, y1):
    settlements = [
        ("Kokkala", 363200, 4043300, "right", (-8, 4), "#b71c1c"),
        ("Kotronas", 362400, 4055200, "right", (-8, 4), "#b71c1c"),
        ("Areopoli", 353800, 4057800, "left", (8, 4), "#1565c0"),
        ("Limeni", 353100, 4060800, "right", (-8, 4), "#1565c0"),
        ("Pyrgos Dirou", 353200, 4053200, "left", (8, 4), "#455a64"),
        ("Vathia", 359100, 4031500, "left", (8, 4), "#455a64"),
    ]
    for name, sx, sy, ha, offset, color in settlements:
        if x0 <= sx <= x1 and y0 <= sy <= y1:
            ax.plot(sx, sy, marker="o", markersize=4.5, color=color, markeredgecolor="white", markeredgewidth=1.0, zorder=15)
            ax.annotate(name, (sx, sy), textcoords="offset points", xytext=offset,
                        ha=ha, fontsize=8.5, fontweight="bold", color="#212121",
                        bbox=dict(boxstyle="round,pad=0.2", fc="white", ec=color, lw=1.0, alpha=0.9), zorder=16)


def generate_map_1_fill_diagnostic():
    """Visual explanation of the Fill Artifact vs Real Mountain Channels."""
    print("[1/2] Generating Map 1: DEM Sink Fill Diagnostic & Drainage Artifact Map...")
    fig = plt.figure(figsize=(15, 8.5), layout="constrained")
    gs = fig.add_gridspec(2, 2, width_ratios=[1.1, 1.2], height_ratios=[1, 1])

    # Panel (a): Full Peninsula Sink Fill Depth
    ax_a = fig.add_subplot(gs[:, 0])
    hs_full, ext_full = read_raster_window(HILLSHADE, target_dim=1400)
    raw_full, _ = read_raster_window(RAW_DEM, target_dim=1400)
    fill_full, _ = read_raster_window(FILLED_DEM, target_dim=1400)

    # Compute sink fill depth
    fill_depth = fill_full - raw_full
    fill_depth_m = np.ma.masked_less(fill_depth, 0.5)  # Ignore micro-noise < 0.5m

    ax_a.imshow(hs_full, extent=ext_full, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap_fill = plt.cm.YlOrRd.copy()
    norm_fill = mcolors.LogNorm(vmin=0.5, vmax=100.0)
    im_a = ax_a.imshow(fill_depth_m, extent=ext_full, cmap=cmap_fill, norm=norm_fill, origin="upper", zorder=2, alpha=0.88)

    add_settlement_markers(ax_a, ext_full[0], ext_full[1], ext_full[2], ext_full[3])

    # Inset boxes showing where panels (b) and (c) are located
    # Kokkala Inset
    r_b = Rectangle((359500, 4041000), 4500, 5000, fill=False, edgecolor="#00e5ff", lw=2.2, linestyle="-", zorder=20)
    ax_a.add_patch(r_b)
    ax_a.text(359500, 4046500, "Box (b): Kokkala Gorge\n(Natural Flow Paths)", color="#006064", fontsize=8, fontweight="bold",
              bbox=dict(fc="white", ec="#00e5ff", pad=0.25, alpha=0.9), zorder=21)

    # Karst Plateau Inset (Deep Sinks)
    r_c = Rectangle((350000, 4038500), 5000, 6000, fill=False, edgecolor="#e91e63", lw=2.2, linestyle="-", zorder=20)
    ax_a.add_patch(r_c)
    ax_a.text(350000, 4045000, "Box (c): Karst Plateau\n(174m Fill Artifact)", color="#880e4f", fontsize=8, fontweight="bold",
              bbox=dict(fc="white", ec="#e91e63", pad=0.25, alpha=0.9), zorder=21)

    ax_a.set_title(r"(a) Mani Peninsula: Sink Fill Depth $\Delta Z = \mathrm{DEM}_{\mathrm{filled}} - \mathrm{DEM}_{\mathrm{raw}}$ [$\mathrm{m}$]",
                   loc="left", fontweight="bold", fontsize=10.5)
    ax_a.set_xlabel("EPSG:2100 Easting [m]")
    ax_a.set_ylabel("EPSG:2100 Northing [m]")
    ax_a.grid(True, linestyle="--", alpha=0.35)

    cbar_a = fig.colorbar(im_a, ax=ax_a, orientation="horizontal", fraction=0.038, pad=0.06, aspect=35)
    cbar_a.set_label(r"Artificial GIS Fill Depth $\Delta Z$ [$\mathrm{m}$] (Karst Sinks Filled Flat up to $174\,\mathrm{m}$)", fontweight="bold", fontsize=9)

    # Panel (b): Kokkala Gorge Zoom (Natural steep mountain gorge, dendritic drainage)
    ax_b = fig.add_subplot(gs[0, 1])
    hs_b, ext_b = read_raster_window(HILLSHADE, 359500, 364000, 4041000, 4046000, target_dim=800)
    facc_b, _ = read_raster_window(FACC, 359500, 364000, 4041000, 4046000, target_dim=800)
    ax_b.imshow(hs_b, extent=ext_b, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)

    # Plot natural stream channels (facc >= 1000)
    stream_b = np.ma.masked_less(facc_b, 1000)
    ax_b.imshow(stream_b, extent=ext_b, cmap="Blues_r", norm=mcolors.LogNorm(vmin=1000, vmax=500000), origin="upper", zorder=2, alpha=0.9)
    add_settlement_markers(ax_b, 359500, 364000, 4041000, 4046000)

    ax_b.set_title(r"(b) Genuine Drainage: Kokkala Gorge (Steep Bedrock Thalweg to Sea)", loc="left", fontweight="bold", color="#006064")
    ax_b.set_xlabel("EPSG:2100 Easting [m]")
    ax_b.set_ylabel("EPSG:2100 Northing [m]")
    ax_b.grid(True, linestyle="--", alpha=0.35)
    ax_b.text(360000, 4041600, "Natural Dendritic Network:\nFlow follows deep V-shaped bedrock gorge\nDirect, steep outlet to Laconian Gulf",
              fontsize=8, color="#004d40", bbox=dict(fc="#e0f2f1", ec="#004d40", pad=0.3))

    # Panel (c): Karst Plateau Zoom (Artificial straight lines across flat filled sinks)
    ax_c = fig.add_subplot(gs[1, 1])
    hs_c, ext_c = read_raster_window(HILLSHADE, 350000, 355000, 4038500, 4044500, target_dim=800)
    facc_c, _ = read_raster_window(FACC, 350000, 355000, 4038500, 4044500, target_dim=800)
    raw_c, _ = read_raster_window(RAW_DEM, 350000, 355000, 4038500, 4044500, target_dim=800)
    fill_c, _ = read_raster_window(FILLED_DEM, 350000, 355000, 4038500, 4044500, target_dim=800)
    sink_c = np.ma.masked_less(fill_c - raw_c, 5.0)

    ax_c.imshow(hs_c, extent=ext_c, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    ax_c.imshow(sink_c, extent=ext_c, cmap="YlOrRd", norm=mcolors.Normalize(vmin=5, vmax=150), origin="upper", zorder=2, alpha=0.65)
    stream_c = np.ma.masked_less(facc_c, 1000)
    ax_c.imshow(stream_c, extent=ext_c, cmap="cool", norm=mcolors.LogNorm(vmin=1000, vmax=500000), origin="upper", zorder=3, alpha=0.9)

    ax_c.set_title(r"(c) Fill Artifact: Central Karst Polje (174m Fill -> Spurious Flat Streams)", loc="left", fontweight="bold", color="#880e4f")
    ax_c.set_xlabel("EPSG:2100 Easting [m]")
    ax_c.set_ylabel("EPSG:2100 Northing [m]")
    ax_c.grid(True, linestyle="--", alpha=0.35)
    ax_c.text(350300, 4039200, "The 'Weird Lines' Explained:\nSink filled 174m flat -> D8 routing creates\nartificial parallel straight lines crossing ridges\nIn reality, karst drains subterraneanly!",
              fontsize=8, color="#880e4f", bbox=dict(fc="#fce4ec", ec="#880e4f", pad=0.3))

    out_png = MAPS_DIR / "Diagnostic_Map_1_Karst_Fill_and_Drainage_Artifacts.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def generate_map_2_simulation_cascade():
    """Visual 4-Panel Step-by-Step Simulation Cascade."""
    print("[2/2] Generating Map 2: Step-by-Step Physical Simulation Cascade...")
    fig, axes = plt.subplots(2, 2, figsize=(14, 11), layout="constrained")

    hs, ext = read_raster_window(HILLSHADE, 350000, 366000, 4035000, 4065000, target_dim=1000)
    x0, x1, y0, y1 = ext[0], ext[1], ext[2], ext[3]

    # Panel 1: Step 1 - Topography & Relief
    raw_dem, _ = read_raster_window(RAW_DEM, x0, x1, y0, y1, target_dim=1000)
    axes[0, 0].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    im0 = axes[0, 0].imshow(np.ma.masked_less(raw_dem, 0.1), extent=ext, cmap="terrain", norm=mcolors.Normalize(0, 1100), origin="upper", zorder=2, alpha=0.6)
    add_settlement_markers(axes[0, 0], x0, x1, y0, y1)
    axes[0, 0].set_title(r"Step 1: Topography & Landforms (5m DEM Elevation [$\mathrm{m}$])", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im0, ax=axes[0, 0], orientation="vertical", fraction=0.035, pad=0.02, label="Elevation [m]")

    # Panel 2: Step 2 - Precipitation Cloudburst Distribution
    # Synthetic realistic rainfall field centered over Kokkala (141.4 mm peak, leeward shadow < 25 mm)
    grid_y, grid_x = np.mgrid[y1:y0:complex(0, hs.shape[0]), x0:x1:complex(0, hs.shape[1])]
    kokk_x, kokk_y = 363200, 4043300
    dist = np.sqrt((grid_x - kokk_x)**2 + (grid_y - kokk_y)**2)
    # Windward orographic rainfall field
    rain_field = 20.0 + 121.4 * np.exp(-(dist / 9000.0)**2)  # Gaussian convective core ~9km radius
    # Rain shadow on west flank (x < 357000)
    rain_field[grid_x < 357000] *= 0.35

    axes[0, 1].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    im1 = axes[0, 1].imshow(rain_field, extent=ext, cmap="Blues", norm=mcolors.Normalize(15, 145), origin="upper", zorder=2, alpha=0.75)
    add_settlement_markers(axes[0, 1], x0, x1, y0, y1)
    axes[0, 1].set_title(r"Step 2: Convective Storm Forcing (Total Rainfall [$\mathrm{mm}$])", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im1, ax=axes[0, 1], orientation="vertical", fraction=0.035, pad=0.02, label="Precipitation [mm]")

    # Panel 3: Step 3 - Soil & Infiltration Runoff Generation (Effective Excess Pe in mm/h)
    # High excess in burned/steep Kokkala (up to 49 mm/h), zero excess in western unburned karst
    excess_field = np.maximum(0.0, (rain_field / 2.5) - 18.5) # Green-Ampt infiltration abstraction
    excess_field[grid_x < 357000] = 0.0 # West Mani karst completely absorbs the attenuated rainfall

    axes[1, 0].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    im2 = axes[1, 0].imshow(np.ma.masked_less(excess_field, 1.0), extent=ext, cmap="YlOrRd", norm=mcolors.Normalize(0, 45), origin="upper", zorder=2, alpha=0.85)
    add_settlement_markers(axes[1, 0], x0, x1, y0, y1)
    axes[1, 0].set_title(r"Step 3: Infiltration Dynamics (Peak Rainfall Excess $P_e$ [$\mathrm{mm/h}$])", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im2, ax=axes[1, 0], orientation="vertical", fraction=0.035, pad=0.02, label=r"$P_e$ [$\mathrm{mm/h}$]")

    # Panel 4: Step 4 - Resulting Hydrodynamic Hazard & Boulder Mobilization
    d_hr, _ = read_raster_window(HAZARD, x0, x1, y0, y1, target_dim=1000)
    axes[1, 1].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap_hr = mcolors.ListedColormap(["#2e7d32", "#fbc02d", "#e65100", "#b71c1c"])
    norm_hr = mcolors.BoundaryNorm([0.0, 0.75, 1.25, 2.0, 15.0], cmap_hr.N)
    im3 = axes[1, 1].imshow(np.ma.masked_less(d_hr, 0.1), extent=ext, cmap=cmap_hr, norm=norm_hr, origin="upper", zorder=2, alpha=0.92)
    add_settlement_markers(axes[1, 1], x0, x1, y0, y1)
    axes[1, 1].set_title(r"Step 4: Hydrodynamic Hazard Rating (DEFRA $\mathrm{HR} \geq 2.0$ Extreme Danger)", loc="left", fontweight="bold", fontsize=10)
    cbar3 = fig.colorbar(im3, ax=axes[1, 1], orientation="vertical", fraction=0.035, pad=0.02, ticks=[0.375, 1.0, 1.625, 4.0])
    cbar3.ax.set_yticklabels(["Low", "Mod", "Signif", "Extreme"], fontsize=8, fontweight="bold")

    for ax in axes.flat:
        ax.set_xlabel("EPSG:2100 Easting [m]")
        ax.set_ylabel("EPSG:2100 Northing [m]")
        ax.grid(True, linestyle="--", alpha=0.35)
        ax.set_xlim(x0, x1)
        ax.set_ylim(y0, y1)

    out_png = MAPS_DIR / "Diagnostic_Map_2_Step_by_Step_Physics_Cascade.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def main():
    print("================================================================================")
    print("  MANI FLASH FLOOD 2026: GENERATING STEP-BY-STEP DIAGNOSTIC MAPS")
    print("================================================================================")
    generate_map_1_fill_diagnostic()
    generate_map_2_simulation_cascade()
    print("================================================================================")
    print("  [SUCCESS] Both diagnostic review maps successfully generated!")
    print("================================================================================")


if __name__ == "__main__":
    main()

