"""Export Publication-Ready 2D Spatial Output Maps for Review (PNG & PDF).

Renders the core hydrodynamic, geomorphic, and flood hazard outputs across the
Mani Peninsula and detailed zooms over Kokkala Gorge and Kotronas:
1. Map 1: 2D Unit Stream Power (W/m^2) & Magilligan Threshold on Hillshade.
2. Map 2: Boundary Bed Shear Stress (Pa) & Shields Boulder Competence (cm).
3. Map 3: Inundation Flow Depth (m) & Velocity (m/s).
4. Map 4: DEFRA Flood Hazard Rating (HR) & Emergency Classification.
5. Map 5: High-Resolution 4-Panel Case Study of Kokkala Gorge Epicentre.
"""

import os
import sys
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.ticker as ticker
from matplotlib.gridspec import GridSpec
from osgeo import gdal

# Enforce UTF-8 console output on Windows
sys.stdout.reconfigure(encoding="utf-8")

# Workspace paths
ROOT_DIR = Path(os.environ.get("MANI_PROJECT_ROOT", Path(__file__).resolve().parents[2]))
PROCESSED_DIR = ROOT_DIR / "data/03_processed"
OUTPUTS_DIR = ROOT_DIR / "data/04_outputs"
MAPS_DIR = OUTPUTS_DIR / "maps"
MAPS_DIR.mkdir(parents=True, exist_ok=True)

# Raster files
POWER_TIF = OUTPUTS_DIR / "power_hazard/mani_unit_stream_power_w_m2.tif"
SHEAR_TIF = OUTPUTS_DIR / "power_hazard/mani_bed_shear_stress_pa.tif"
BOULDER_TIF = OUTPUTS_DIR / "power_hazard/mani_max_boulder_diameter_m.tif"
HAZARD_TIF = OUTPUTS_DIR / "power_hazard/mani_flood_hazard_rating_hr.tif"
DEPTH_TIF = OUTPUTS_DIR / "hydrodynamics/mani_inundation_depth_m.tif"
VEL_TIF = OUTPUTS_DIR / "hydrodynamics/mani_flow_velocity_m_s.tif"
HILLSHADE_TIF = PROCESSED_DIR / "terrain/mani_hillshade.tif"

# Publication styling
plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman", "Palatino", "Georgia"],
    "mathtext.fontset": "cm",
    "font.size": 10,
    "axes.labelsize": 10,
    "axes.titlesize": 11,
    "xtick.labelsize": 8.5,
    "ytick.labelsize": 8.5,
    "figure.dpi": 300,
    "savefig.dpi": 300,
})


def read_raster_window(tif_path, x_min=None, x_max=None, y_min=None, y_max=None, target_max_dim=1400):
    """Read a raster with optional spatial windowing and decimation for fast, crisp rendering."""
    ds = gdal.Open(str(tif_path), gdal.GA_ReadOnly)
    if ds is None:
        raise FileNotFoundError(f"Could not open raster: {tif_path}")
    
    gt = ds.GetGeoTransform()
    x_origin = gt[0]
    y_origin = gt[3]
    pixel_width = gt[1]
    pixel_height = gt[5]
    cols = ds.RasterXSize
    rows = ds.RasterYSize

    if x_min is not None and x_max is not None and y_min is not None and y_max is not None:
        col_start = int(max(0, (x_min - x_origin) / pixel_width))
        col_end = int(min(cols, (x_max - x_origin) / pixel_width))
        row_start = int(max(0, (y_max - y_origin) / pixel_height))
        row_end = int(min(rows, (y_min - y_origin) / pixel_height))
        
        w_cols = max(1, col_end - col_start)
        w_rows = max(1, row_end - row_start)
    else:
        col_start, row_start = 0, 0
        w_cols, w_rows = cols, rows

    step = max(1, int(max(w_cols, w_rows) / target_max_dim))
    out_cols = int(w_cols / step)
    out_rows = int(w_rows / step)

    band = ds.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    data = band.ReadAsArray(col_start, row_start, w_cols, w_rows, buf_xsize=out_cols, buf_ysize=out_rows)
    
    x_left = x_origin + col_start * pixel_width
    x_right = x_left + w_cols * pixel_width
    y_top = y_origin + row_start * pixel_height
    y_bottom = y_top + w_rows * pixel_height

    extent = [x_left, x_right, y_bottom, y_top]
    
    if nodata is not None:
        data = np.ma.masked_equal(data, nodata)
    data = np.ma.masked_invalid(data)

    ds = None
    return data, extent


def add_settlements(ax, x_min, x_max, y_min, y_max):
    """Plot settlement marker labels with clean halo effects."""
    settlements = [
        ("Kokkala (Epicentre)", 363200, 4043300, "right", (-10, 4), "#b71c1c"),
        ("Kotronas", 362400, 4055200, "right", (-10, 4), "#b71c1c"),
        ("Flomochori", 362900, 4052800, "left", (8, -2), "#d84315"),
        ("Areopoli", 353800, 4057800, "left", (8, 4), "#1565c0"),
        ("Limeni", 353100, 4060800, "right", (-8, 4), "#1565c0"),
        ("Oitylo", 354600, 4061800, "left", (8, 4), "#1565c0"),
        ("Gytheio", 366000, 4072000, "left", (8, 4), "#37474f"),
        ("Vathia", 359100, 4031500, "left", (8, 4), "#37474f"),
        ("Cape Tainaron", 360400, 4026800, "left", (8, -4), "#37474f"),
    ]
    for name, sx, sy, ha, offset, color in settlements:
        if x_min <= sx <= x_max and y_min <= sy <= y_max:
            ax.plot(sx, sy, marker="o", markersize=5.0, color=color, markeredgecolor="white", markeredgewidth=1.2, zorder=15)
            ax.annotate(
                name, (sx, sy), xytext=offset, textcoords="offset points",
                ha=ha, va="center", fontsize=8.5, fontweight="bold", color="#111111",
                bbox=dict(boxstyle="round,pad=0.25", facecolor="white", edgecolor="#b0bec5", alpha=0.92, lw=0.7),
                zorder=16
            )


def render_map_1_unit_stream_power():
    """Render 2D Unit Stream Power (omega) on Hillshade."""
    print("[1/5] Rendering Map 1: Unit Stream Power (omega) on Hillshade...")
    hs_full, ext_full = read_raster_window(HILLSHADE_TIF, target_max_dim=1600)
    data_full, _ = read_raster_window(POWER_TIF, target_max_dim=1600)

    hs_kokk, ext_kokk = read_raster_window(HILLSHADE_TIF, 359500, 364500, 4041000, 4046500, target_max_dim=1200)
    data_kokk, _ = read_raster_window(POWER_TIF, 359500, 364500, 4041000, 4046500, target_max_dim=1200)

    fig = plt.figure(figsize=(14, 8), layout="constrained")
    gs = GridSpec(1, 2, figure=fig, width_ratios=[1.1, 1.0])

    # Left: Peninsula Overview
    ax1 = fig.add_subplot(gs[0])
    ax1.imshow(hs_full, extent=ext_full, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)

    cmap = plt.cm.plasma.copy()
    norm = mcolors.LogNorm(vmin=10, vmax=5000)
    
    # Mask very small stream power values (< 5 W/m2) to let hillshade show through
    data_full_masked = np.ma.masked_less(data_full, 5.0)
    im1 = ax1.imshow(data_full_masked, extent=ext_full, cmap=cmap, norm=norm, origin="upper", zorder=2, alpha=0.95)
    add_settlements(ax1, ext_full[0], ext_full[1], ext_full[2], ext_full[3])

    # Add box around Kokkala zoom
    rect_kokk = plt.Rectangle((359500, 4041000), 5000, 5500, fill=False, edgecolor="#00e5ff", linewidth=2.0, linestyle="--", zorder=20)
    ax1.add_patch(rect_kokk)
    ax1.text(359500, 4047000, "Kokkala Focus Inset", color="#00838f", fontsize=9, fontweight="bold",
             bbox=dict(facecolor="white", alpha=0.9, edgecolor="#00e5ff", boxstyle="round,pad=0.25"), zorder=21)

    ax1.set_title(r"(a) Mani Peninsula: Specific Stream Power $\omega$ [$\mathrm{W/m^2}$]", loc="left", fontweight="bold", fontsize=10.5)
    ax1.set_xlabel("EPSG:2100 X [m]")
    ax1.set_ylabel("EPSG:2100 Y [m]")
    ax1.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax1.set_xlim(ext_full[0], ext_full[1])
    ax1.set_ylim(ext_full[2], ext_full[3])

    # Right: Kokkala Zoom
    ax2 = fig.add_subplot(gs[1])
    ax2.imshow(hs_kokk, extent=ext_kokk, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    data_kokk_masked = np.ma.masked_less(data_kokk, 5.0)
    im2 = ax2.imshow(data_kokk_masked, extent=ext_kokk, cmap=cmap, norm=norm, origin="upper", zorder=2, alpha=0.95)
    add_settlements(ax2, 359500, 364500, 4041000, 4046500)

    ax2.set_title(r"(b) Kokkala Thalweg: Stream Power Concentration", loc="left", fontweight="bold", fontsize=10.5)
    ax2.set_xlabel("EPSG:2100 X [m]")
    ax2.set_ylabel("EPSG:2100 Y [m]")
    ax2.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax2.set_xlim(359500, 364500)
    ax2.set_ylim(4041000, 4046500)

    # Colorbar
    cbar = fig.colorbar(im2, ax=[ax1, ax2], orientation="horizontal", fraction=0.045, pad=0.07, aspect=45)
    cbar.set_label(r"Specific Stream Power $\omega = \rho g h V S_f$ [$\mathrm{W/m^2}$]", fontweight="bold", fontsize=10.5)
    cbar.ax.axvline(300, color="cyan", lw=2.2, linestyle=":")
    cbar.ax.text(300, 1.25, r"Magilligan Geomorphic Threshold ($300\,\mathrm{W/m^2}$)", color="#00838f", ha="center", va="bottom",
                 transform=cbar.ax.get_xaxis_transform(), fontsize=9, fontweight="bold")

    out_png = MAPS_DIR / "Output_Map_1_Unit_Stream_Power.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def render_map_2_shear_and_boulders():
    """Render 2D Bed Shear Stress (Pa) and Boulder Competence (cm) on Hillshade."""
    print("[2/5] Rendering Map 2: Bed Shear Stress & Boulder Competence...")
    x0, x1, y0, y1 = 358000, 365000, 4039000, 4059000
    hs, ext = read_raster_window(HILLSHADE_TIF, x0, x1, y0, y1, target_max_dim=1400)
    d_shear, _ = read_raster_window(SHEAR_TIF, x0, x1, y0, y1, target_max_dim=1400)
    d_bould, _ = read_raster_window(BOULDER_TIF, x0, x1, y0, y1, target_max_dim=1400)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 8.5), layout="constrained")

    # Left: Shear Stress (Pa)
    ax1.imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap1 = plt.cm.magma.copy()
    norm1 = mcolors.LogNorm(vmin=10, vmax=800)
    d_shear_m = np.ma.masked_less(d_shear, 5.0)
    im1 = ax1.imshow(d_shear_m, extent=ext, cmap=cmap1, norm=norm1, origin="upper", zorder=2, alpha=0.92)
    add_settlements(ax1, x0, x1, y0, y1)

    ax1.set_title(r"(a) Bed Shear Stress $\tau_b = \rho g n^2 V^2 / h^{1/3}$ [$\mathrm{Pa}$]", loc="left", fontweight="bold", fontsize=10.5)
    ax1.set_xlabel("EPSG:2100 X [m]")
    ax1.set_ylabel("EPSG:2100 Y [m]")
    ax1.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax1.set_xlim(x0, x1)
    ax1.set_ylim(y0, y1)
    cbar1 = fig.colorbar(im1, ax=ax1, orientation="horizontal", fraction=0.045, pad=0.07)
    cbar1.set_label(r"Bed Shear Stress $\tau_b$ [$\mathrm{Pa}$]", fontweight="bold")

    # Right: Boulder Competence (cm)
    ax2.imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap2 = plt.cm.inferno.copy()
    bould_cm = d_bould * 100.0  # Convert m to cm
    bould_m = np.ma.masked_less(bould_cm, 5.0)
    norm2 = mcolors.Normalize(vmin=5, vmax=70)
    im2 = ax2.imshow(bould_m, extent=ext, cmap=cmap2, norm=norm2, origin="upper", zorder=2, alpha=0.92)
    add_settlements(ax2, x0, x1, y0, y1)

    ax2.set_title(r"(b) Shields Boulder Competence: Max Clast $D_{\mathrm{max}}$ [$\mathrm{cm}$]", loc="left", fontweight="bold", fontsize=10.5)
    ax2.set_xlabel("EPSG:2100 X [m]")
    ax2.set_ylabel("EPSG:2100 Y [m]")
    ax2.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax2.set_xlim(x0, x1)
    ax2.set_ylim(y0, y1)
    cbar2 = fig.colorbar(im2, ax=ax2, orientation="horizontal", fraction=0.045, pad=0.07)
    cbar2.set_label(r"Maximum Mobilized Boulder Diameter $D_{\mathrm{max}}$ [$\mathrm{cm}$]", fontweight="bold")

    out_png = MAPS_DIR / "Output_Map_2_Bed_Shear_Stress_and_Boulder_Competence.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def render_map_3_depth_and_velocity():
    """Render Inundation Flow Depth (m) and Flow Velocity (m/s) on Hillshade."""
    print("[3/5] Rendering Map 3: Flow Depth & Velocity...")
    x0, x1, y0, y1 = 359000, 364500, 4041000, 4057000
    hs, ext = read_raster_window(HILLSHADE_TIF, x0, x1, y0, y1, target_max_dim=1400)
    d_depth, _ = read_raster_window(DEPTH_TIF, x0, x1, y0, y1, target_max_dim=1400)
    d_vel, _ = read_raster_window(VEL_TIF, x0, x1, y0, y1, target_max_dim=1400)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 8.5), layout="constrained")

    # Left: Flow Depth
    ax1.imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap_d = plt.cm.YlGnBu.copy()
    norm_d = mcolors.Normalize(vmin=0.1, vmax=3.0)
    d_depth_m = np.ma.masked_less(d_depth, 0.05)
    im1 = ax1.imshow(d_depth_m, extent=ext, cmap=cmap_d, norm=norm_d, origin="upper", zorder=2, alpha=0.92)
    add_settlements(ax1, x0, x1, y0, y1)

    ax1.set_title(r"(a) Peak Inundation Flow Depth $h$ [$\mathrm{m}$]", loc="left", fontweight="bold")
    ax1.set_xlabel("EPSG:2100 X [m]")
    ax1.set_ylabel("EPSG:2100 Y [m]")
    ax1.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax1.set_xlim(x0, x1)
    ax1.set_ylim(y0, y1)
    cbar1 = fig.colorbar(im1, ax=ax1, orientation="horizontal", fraction=0.045, pad=0.07)
    cbar1.set_label(r"Water Depth $h$ [$\mathrm{m}$]", fontweight="bold")

    # Right: Flow Velocity
    ax2.imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap_v = plt.cm.viridis.copy()
    norm_v = mcolors.Normalize(vmin=0.5, vmax=5.5)
    d_vel_m = np.ma.masked_less(d_vel, 0.2)
    im2 = ax2.imshow(d_vel_m, extent=ext, cmap=cmap_v, norm=norm_v, origin="upper", zorder=2, alpha=0.92)
    add_settlements(ax2, x0, x1, y0, y1)

    ax2.set_title(r"(b) Peak Cross-Sectional Flow Velocity $V$ [$\mathrm{m/s}$]", loc="left", fontweight="bold")
    ax2.set_xlabel("EPSG:2100 X [m]")
    ax2.set_ylabel("EPSG:2100 Y [m]")
    ax2.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax2.set_xlim(x0, x1)
    ax2.set_ylim(y0, y1)
    cbar2 = fig.colorbar(im2, ax=ax2, orientation="horizontal", fraction=0.045, pad=0.07)
    cbar2.set_label(r"Velocity $V$ [$\mathrm{m/s}$]", fontweight="bold")

    out_png = MAPS_DIR / "Output_Map_3_Inundation_Depth_and_Velocity.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def render_map_4_defra_hazard_rating():
    """Render DEFRA Flood Hazard Rating (HR) across East Mani communities."""
    print("[4/5] Rendering Map 4: DEFRA Flood Hazard Rating on Hillshade...")
    x0, x1, y0, y1 = 358000, 365500, 4038000, 4060000
    hs, ext = read_raster_window(HILLSHADE_TIF, x0, x1, y0, y1, target_max_dim=1500)
    d_hr, _ = read_raster_window(HAZARD_TIF, x0, x1, y0, y1, target_max_dim=1500)

    fig, ax = plt.subplots(figsize=(10.5, 9.5), layout="constrained")
    ax.imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)

    cmap_hr = mcolors.ListedColormap(["#2e7d32", "#fbc02d", "#e65100", "#b71c1c"])
    bounds = [0.0, 0.75, 1.25, 2.0, 15.0]
    norm_hr = mcolors.BoundaryNorm(bounds, cmap_hr.N)

    d_hr_m = np.ma.masked_less(d_hr, 0.1)
    im = ax.imshow(d_hr_m, extent=ext, cmap=cmap_hr, norm=norm_hr, origin="upper", zorder=2, alpha=0.92)
    add_settlements(ax, x0, x1, y0, y1)

    ax.set_title(r"DEFRA Flood Hazard Rating ($\mathrm{HR} = d(v + 0.5) + \mathrm{DF}$) & Classification",
                 loc="left", fontweight="bold", fontsize=10.5)
    ax.set_xlabel("EPSG:2100 X [m]")
    ax.set_ylabel("EPSG:2100 Y [m]")
    ax.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)

    # Custom Discrete Colorbar
    cbar = fig.colorbar(im, ax=ax, orientation="horizontal", fraction=0.045, pad=0.06, aspect=35, ticks=[0.375, 1.0, 1.625, 4.0])
    cbar.ax.set_xticklabels([
        "Low Hazard\n(HR < 0.75)\nCaution",
        "Moderate Hazard\n(0.75 ≤ HR < 1.25)\nDangerous for Some",
        "Significant Hazard\n(1.25 ≤ HR < 2.0)\nDangerous for Most",
        "Extreme Hazard\n(HR ≥ 2.0)\nDanger for All"
    ], fontsize=8.5, fontweight="bold")

    out_png = MAPS_DIR / "Output_Map_4_DEFRA_Flood_Hazard_Rating.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def render_map_5_kokkala_case_study():
    """Render High-Resolution 4-Panel Case Study of Kokkala Gorge Epicentre."""
    print("[5/5] Rendering Map 5: Kokkala Gorge High-Res Epicentre Case Study...")
    x0, x1, y0, y1 = 360000, 364200, 4041500, 4045500

    hs, ext = read_raster_window(HILLSHADE_TIF, x0, x1, y0, y1, target_max_dim=1200)
    d_pow, _ = read_raster_window(POWER_TIF, x0, x1, y0, y1, target_max_dim=1200)
    d_bld, _ = read_raster_window(BOULDER_TIF, x0, x1, y0, y1, target_max_dim=1200)
    d_dep, _ = read_raster_window(DEPTH_TIF, x0, x1, y0, y1, target_max_dim=1200)
    d_hr, _ = read_raster_window(HAZARD_TIF, x0, x1, y0, y1, target_max_dim=1200)

    fig, axes = plt.subplots(2, 2, figsize=(13, 10.5), layout="constrained")

    # (a) Inundation Depth
    axes[0, 0].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    im0 = axes[0, 0].imshow(np.ma.masked_less(d_dep, 0.05), extent=ext, cmap="YlGnBu", norm=mcolors.Normalize(0.1, 2.5), origin="upper", zorder=2, alpha=0.92)
    add_settlements(axes[0, 0], x0, x1, y0, y1)
    axes[0, 0].set_title(r"(a) Inundation Depth $h$ [$\mathrm{m}$]", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im0, ax=axes[0, 0], orientation="vertical", fraction=0.035, pad=0.02, label="Depth [m]")

    # (b) Unit Stream Power
    axes[0, 1].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    im1 = axes[0, 1].imshow(np.ma.masked_less(d_pow, 5.0), extent=ext, cmap="plasma", norm=mcolors.LogNorm(20, 4000), origin="upper", zorder=2, alpha=0.92)
    add_settlements(axes[0, 1], x0, x1, y0, y1)
    axes[0, 1].set_title(r"(b) Unit Stream Power $\omega$ [$\mathrm{W/m^2}$] (Peak: 3,316 W/m²)", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im1, ax=axes[0, 1], orientation="vertical", fraction=0.035, pad=0.02, label=r"$\omega$ [$\mathrm{W/m^2}$]")

    # (c) Boulder Competence
    axes[1, 0].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    im2 = axes[1, 0].imshow(np.ma.masked_less(d_bld * 100.0, 5.0), extent=ext, cmap="inferno", norm=mcolors.Normalize(5, 65), origin="upper", zorder=2, alpha=0.92)
    add_settlements(axes[1, 0], x0, x1, y0, y1)
    axes[1, 0].set_title(r"(c) Shields Boulder Competence $D_{\mathrm{max}}$ [$\mathrm{cm}$] (Peak: 63 cm)", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im2, ax=axes[1, 0], orientation="vertical", fraction=0.035, pad=0.02, label=r"$D_{\mathrm{max}}$ [$\mathrm{cm}$]")

    # (d) DEFRA Hazard Rating
    axes[1, 1].imshow(hs, extent=ext, cmap="gray", vmin=40, vmax=240, origin="upper", zorder=1)
    cmap_hr = mcolors.ListedColormap(["#2e7d32", "#fbc02d", "#e65100", "#b71c1c"])
    norm_hr = mcolors.BoundaryNorm([0.0, 0.75, 1.25, 2.0, 15.0], cmap_hr.N)
    im3 = axes[1, 1].imshow(np.ma.masked_less(d_hr, 0.1), extent=ext, cmap=cmap_hr, norm=norm_hr, origin="upper", zorder=2, alpha=0.92)
    add_settlements(axes[1, 1], x0, x1, y0, y1)
    axes[1, 1].set_title(r"(d) DEFRA Hazard Rating ($\mathrm{HR} \geq 2.0$ = Extreme Danger)", loc="left", fontweight="bold", fontsize=10)
    fig.colorbar(im3, ax=axes[1, 1], orientation="vertical", fraction=0.035, pad=0.02, label="Hazard Tier")
    fig.colorbar(im3, ax=axes[1, 1], orientation="vertical", fraction=0.035, pad=0.02, label="Hazard Tier")

    for ax in axes.flat:
        ax.set_xlabel("EPSG:2100 X [m]")
        ax.set_ylabel("EPSG:2100 Y [m]")
        ax.grid(True, linestyle="--", alpha=0.4, color="#90a4ae")
        ax.set_xlim(x0, x1)
        ax.set_ylim(y0, y1)

    out_png = MAPS_DIR / "Output_Map_5_Kokkala_Gorge_HighRes_Focus.png"
    plt.savefig(out_png, dpi=300)
    plt.close()
    print(f"      [OK] Saved: {out_png}")


def main():
    print("================================================================================")
    print("  MANI FLASH FLOOD 2026: 2D SPATIAL OUTPUT REVIEW MAP EXPORTER")
    print("================================================================================")
    render_map_1_unit_stream_power()
    render_map_2_shear_and_boulders()
    render_map_3_depth_and_velocity()
    render_map_4_defra_hazard_rating()
    render_map_5_kokkala_case_study()
    print("================================================================================")
    print(f"  [SUCCESS] All 5 review maps generated in: {MAPS_DIR}")
    print("================================================================================")


if __name__ == "__main__":
    main()
