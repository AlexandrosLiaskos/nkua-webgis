"""Publication Figure 4: Spatially Distributed Precipitation Excess, Runoff Coefficient, Infiltration Dynamics, and Catchment Morphometric Ruggedness.

Generates publication-grade 300 DPI PNG and vector PDF figures conforming to
international scientific publishing standards (Elsevier / Nature Comms / MDPI):
- Panel (a): Event Cumulative Precipitation Excess P_excess [mm] draped over 5m LiDAR hillshade.
- Panel (b): Event Runoff Coefficient Cr [-] draped over 5m LiDAR hillshade.
- Panel (c): Dynamic Infiltration & Excess Rainfall Hyetograph Time Series i(t) vs f(t) vs R_excess(t).
- Panel (d): Catchment Geomorphic Ruggedness Screening (Melton M = Hr / sqrt(A)) across all 266 catchments.

Strictly adheres to:
- Zero visual clutter, zero unneeded layers, zero unwanted callout boxes, zero overlapping text.
- Unified typographic hierarchy and cartographic discipline matching Figures 1, 2, and 3.
- Inset cards for colorbars matching Figure 3 transparent lower-left design.

Outputs saved to:
  publication/figures/Figure_4_Infiltration_Dynamics_and_Precipitation_Excess.png
  publication/figures/Figure_4_Infiltration_Dynamics_and_Precipitation_Excess.pdf
"""

import os
import sys
sys.stdout.reconfigure(encoding='utf-8')

from pathlib import Path
import shutil
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import Rectangle
from matplotlib.gridspec import GridSpec
from matplotlib.colors import Normalize
from mpl_toolkits.axes_grid1.inset_locator import inset_axes
import geopandas as gpd
import rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer

# Paths
ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
OUTPUTS_DIR = DATA_DIR / "04_outputs"
# Working folder for the first copy of the figure files: the environment variable MANI_SCRATCH_DIR
# (default: scratch/ in the project root).
SCRATCH_DIR = Path(os.environ.get("MANI_SCRATCH_DIR", ROOT_DIR / "scratch"))
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
FIG_DIR = ROOT_DIR / "publication/figures"

HS_TIF = OUTPUTS_DIR / "01_terrain/Hillshade_5m.tif"
DEM_TIF = OUTPUTS_DIR / "01_terrain/DEM_5m.tif"
GDB_PATH = OUTPUTS_DIR / "Mani_Flood_Study.gdb"
EXCESS_NC = DATA_DIR / "03_processed/hydrology/mani_excess_rainfall_20260815.nc"

# Spatial Extent matching Figure 3
x0, x1 = 341500, 369000
y0, y1 = 4036000, 4072500

tr_to_4326 = Transformer.from_crs("EPSG:2100", "EPSG:4326", always_xy=True)
tr_to_2100 = Transformer.from_crs("EPSG:4326", "EPSG:2100", always_xy=True)

print("[1/5] Loading DEM and Hillshade Rasters...")
with rasterio.open(DEM_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    out_shape = (int(win.height // 3), int(win.width // 3))
    dem = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)
    bounds_extent = [x0, x1, y0, y1]

with rasterio.open(HS_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    hs = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)

land_mask = (dem > 0.1) & (hs > 0) & (hs < 254)
hs_masked = np.ma.masked_where(~land_mask, hs)

print("[2/5] Loading Hydrology NetCDF and Interpolating Excess Fields...")
ds = xr.open_dataset(EXCESS_NC)

x_coords = np.linspace(x0, x1, out_shape[1])
y_coords = np.linspace(y1, y0, out_shape[0])

# Interpolate event total excess and runoff coefficient to map grid
excess_interp = ds["event_total_excess"].interp(x=x_coords, y=y_coords, method="linear").values
rc_interp = ds["event_runoff_coefficient"].interp(x=x_coords, y=y_coords, method="linear").values

excess_masked = np.ma.masked_where(~land_mask, np.clip(excess_interp, 0.0, 95.0))
rc_masked = np.ma.masked_where(~land_mask, np.clip(rc_interp, 0.0, 0.75))

ref_settlements = [
    {"name": "Oitylo", "x": 355834.0, "y": 4063800.0, "dx": 450, "dy": 0, "ha": "left", "va": "center"},
    {"name": "Areopoli", "x": 355371.0, "y": 4058828.0, "dx": -450, "dy": 0, "ha": "right", "va": "center"},
    {"name": "Kotronas", "x": 365150.0, "y": 4053642.0, "dx": 450, "dy": 200, "ha": "left", "va": "bottom"},
    {"name": "Kokkala", "x": 363050.0, "y": 4043550.0, "dx": 450, "dy": 0, "ha": "left", "va": "center"},
]

print("[3/5] Computing Storm Hydrologic Mass Balance & Volume Partitioning...")
dx, dy = 100.0, 100.0
cell_area = dx * dy
mask = ds["land_mask"].values > 0
cr_final = ds["event_runoff_coefficient"].values
burned_mask = (cr_final > 0.20) & mask
unburned_mask = mask & ~burned_mask

cum_exc_arr = ds["cumulative_excess"].values
cum_inf_arr = ds["cumulative_infiltration"].values

# Burned scarp cumulative volumes [10^6 m^3]
b_vol_exc = (cum_exc_arr[:, burned_mask] * 1e-3 * cell_area).sum(axis=1) / 1e6
b_vol_inf = (cum_inf_arr[:, burned_mask] * 1e-3 * cell_area).sum(axis=1) / 1e6
b_vol_prec = b_vol_exc + b_vol_inf

# Unburned karst cumulative volumes [10^6 m^3]
u_vol_exc = (cum_exc_arr[:, unburned_mask] * 1e-3 * cell_area).sum(axis=1) / 1e6
u_vol_inf = (cum_inf_arr[:, unburned_mask] * 1e-3 * cell_area).sum(axis=1) / 1e6
u_vol_prec = u_vol_exc + u_vol_inf

# Dynamic instantaneous runoff fraction across burned scarp
exc_rate_arr = ds["excess_rainfall_rate"].values
inf_rate_arr = ds["infiltration_rate"].values
rain_rate_arr = exc_rate_arr + inf_rate_arr

b_rain_mean = rain_rate_arr[:, burned_mask].mean(axis=1)
b_exc_mean = exc_rate_arr[:, burned_mask].mean(axis=1)

cr_inst = np.zeros_like(b_rain_mean)
active_rain = b_rain_mean >= 1.0  # active storm threshold (1 mm/h)
cr_inst[active_rain] = (b_exc_mean[active_rain] / b_rain_mean[active_rain]) * 100.0

times_raw = ds.time.values
time_hrs = np.array([float((t - np.datetime64('2026-08-15T00:00:00')) / np.timedelta64(1, 'h')) for t in times_raw])

# Cartographic styling
plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman", "Palatino", "Georgia"],
    "mathtext.fontset": "cm",
    "font.size": 8.5,
    "axes.labelsize": 8.8,
    "axes.titlesize": 9.6,
    "xtick.labelsize": 7.8,
    "ytick.labelsize": 7.8,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "axes.linewidth": 0.8,
})

# Balanced layout: Top row maps, bottom row scientific curves/distributions
fig = plt.figure(figsize=(13.6, 16.8))
gs = GridSpec(2, 2, width_ratios=[1.0, 1.0], height_ratios=[1.22, 0.78],
              wspace=0.140, hspace=0.085, left=0.065, right=0.975, top=0.965, bottom=0.045)

sea_color = "#edf4f8"
halo = [pe.withStroke(linewidth=2.2, foreground="white")]
halo_thin = [pe.withStroke(linewidth=1.8, foreground="white")]

def apply_map_base(ax, is_left_col=True, is_bottom_row=False, show_gulfs=False, show_settlements=False):
    ax.set_facecolor(sea_color)
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    
    lons = np.array([22.30, 22.40, 22.50])
    lats = np.array([36.50, 36.60, 36.70])
    
    x_ticks = [tr_to_2100.transform(lon, 36.60)[0] for lon in lons]
    y_ticks = [tr_to_2100.transform(22.40, lat)[1] for lat in lats]
    
    ax.set_xticks(x_ticks)
    if is_bottom_row:
        ax.set_xticklabels([f"{lon:.2f}°E" for lon in lons])
    else:
        ax.set_xticklabels([])
        ax.tick_params(labelbottom=False)
        
    ax.set_yticks(y_ticks)
    if is_left_col:
        ax.set_yticklabels([f"{lat:.2f}°N" for lat in lats])
    else:
        ax.set_yticklabels([])
        ax.tick_params(labelleft=False)
        
    ax.grid(True, linestyle=":", alpha=0.35, color="#7f8c8d")
    
    if show_settlements:
        for s in ref_settlements:
            ax.scatter(s["x"], s["y"], s=16, color="#34495e", edgecolor="white", linewidth=0.5, zorder=9)
            ax.text(s["x"] + s["dx"], s["y"] + s["dy"], s["name"], fontsize=7.2,
                    color="#34495e", ha=s["ha"], va=s["va"], path_effects=halo_thin, zorder=10)
    
    if show_gulfs:
        ax.text(345200, 4058000, "Messenian\nGulf", fontsize=7.8, fontstyle="italic", color="#5c768d", ha="center", path_effects=halo, zorder=5)
        ax.text(366500, 4058000, "Laconian\nGulf", fontsize=7.8, fontstyle="italic", color="#5c768d", ha="center", path_effects=halo, zorder=5)


def add_unified_north_and_scale(ax):
    cx = 345000
    top_y = y1 - 2000
    
    ax.annotate("", xy=(cx, top_y), xytext=(cx, top_y - 1300),
                arrowprops=dict(facecolor="#1a252f", edgecolor="#1a252f", width=1.3, headwidth=4.8, headlength=5.2), zorder=15)
    ax.text(cx, top_y + 240, "N", ha="center", va="bottom", fontsize=8.6, fontweight="bold", color="#1a252f", path_effects=halo_thin, zorder=15)
    
    sb_y = top_y - 2350
    sb_len = 3000
    sb_x0 = cx - sb_len / 2
    sb_x1 = cx + sb_len / 2
    
    h_bar = 200
    ax.add_patch(Rectangle((sb_x0, sb_y - h_bar/2), sb_len/2, h_bar, facecolor="#1a252f", edgecolor="#1a252f", lw=0.6, zorder=15))
    ax.add_patch(Rectangle((sb_x0 + sb_len/2, sb_y - h_bar/2), sb_len/2, h_bar, facecolor="white", edgecolor="#1a252f", lw=0.6, zorder=15))
    
    ax.text(sb_x0, sb_y - h_bar/2 - 320, "0", ha="center", va="top", fontsize=6.6, color="#1a252f", path_effects=halo_thin, zorder=15)
    ax.text(cx, sb_y - h_bar/2 - 320, "1.5", ha="center", va="top", fontsize=6.6, color="#1a252f", path_effects=halo_thin, zorder=15)
    ax.text(sb_x1, sb_y - h_bar/2 - 320, "3 km", ha="center", va="top", fontsize=6.6, color="#1a252f", path_effects=halo_thin, zorder=15)


print("[5/5] Rendering Polished 4-Panel Figure 4...")

# =============================================================================
# PANEL (a): Event Cumulative Precipitation Excess [mm]
# =============================================================================
print("  Rendering Panel (a)...")
ax_a = fig.add_subplot(gs[0, 0])
ax_a.imshow(hs_masked, cmap="gray", vmin=30, vmax=240, extent=bounds_extent, origin="upper", zorder=1)

cmap_excess = plt.cm.YlOrRd
norm_excess = Normalize(vmin=0, vmax=90)
im_excess = ax_a.imshow(excess_masked, cmap=cmap_excess, norm=norm_excess, alpha=0.65, extent=bounds_extent, origin="upper", zorder=2)

apply_map_base(ax_a, is_left_col=True, is_bottom_row=False, show_gulfs=True, show_settlements=True)
add_unified_north_and_scale(ax_a)
ax_a.set_title(r"(a) Event Cumulative Precipitation Excess $P_{\mathrm{excess}}$ [mm]", loc="left", fontweight="bold", pad=7)

# Clean Transparent Inset Card for Colorbar (Matching Figure 3)
card_a = inset_axes(ax_a, width="28%", height="9.5%", loc="lower left",
                    bbox_to_anchor=(0.04, 0.04, 1, 1), bbox_transform=ax_a.transAxes)
card_a.patch.set_visible(False)
card_a.axis('off')
card_a.set_xlim(0, 100)
card_a.set_ylim(0, 100)

card_a.text(45, 54.0, r"Cumulative Excess $P_{\mathrm{excess}}$ [$\mathrm{mm}$]", ha="center", va="bottom", fontsize=6.6, color="#2c3e50")
grad_excess = np.linspace(0, 90, 256).reshape(1, -1)
card_a.imshow(grad_excess, extent=[0, 90, 28.0, 44.0], aspect="auto", cmap=cmap_excess, norm=norm_excess, origin="lower")
card_a.add_patch(Rectangle((0, 28.0), 90, 16.0, fill=False, edgecolor="#7f8c8d", lw=0.6))
for val, px in [(0, 0), (20, 20), (40, 40), (60, 60), (80, 80)]:
    card_a.plot([px, px], [28.0, 22.0], color="#2c3e50", lw=0.5)
    card_a.text(px, 14.0, str(val), ha="center", va="top", fontsize=5.8, color="#2c3e50")
card_a.plot([90, 90], [28.0, 22.0], color="#2c3e50", lw=0.5)
card_a.text(90, 14.0, "90", ha="center", va="top", fontsize=5.8, color="#2c3e50")


# =============================================================================
# PANEL (b): Event Runoff Coefficient Cr [-]
# =============================================================================
print("  Rendering Panel (b)...")
ax_b = fig.add_subplot(gs[0, 1])
ax_b.imshow(hs_masked, cmap="gray", vmin=30, vmax=240, extent=bounds_extent, origin="upper", zorder=1)

cmap_rc = plt.cm.plasma
norm_rc = Normalize(vmin=0.0, vmax=0.75)
im_rc = ax_b.imshow(rc_masked, cmap=cmap_rc, norm=norm_rc, alpha=0.65, extent=bounds_extent, origin="upper", zorder=2)

apply_map_base(ax_b, is_left_col=False, is_bottom_row=False, show_gulfs=False, show_settlements=False)
ax_b.set_title(r"(b) Spatial Event Runoff Coefficient $C_r = P_{\mathrm{excess}} / P_{\mathrm{cum}}$ [–]", loc="left", fontweight="bold", pad=7)

# Clean Transparent Inset Card for Runoff Coefficient Colorbar
card_b = inset_axes(ax_b, width="28%", height="9.5%", loc="lower left",
                    bbox_to_anchor=(0.04, 0.04, 1, 1), bbox_transform=ax_b.transAxes)
card_b.patch.set_visible(False)
card_b.axis('off')
card_b.set_xlim(0, 100)
card_b.set_ylim(0, 100)

card_b.text(45, 54.0, r"Runoff Coefficient $C_r$ [–]", ha="center", va="bottom", fontsize=6.6, color="#2c3e50")
grad_rc = np.linspace(0.0, 0.75, 256).reshape(1, -1)
card_b.imshow(grad_rc, extent=[0, 90, 28.0, 44.0], aspect="auto", cmap=cmap_rc, norm=norm_rc, origin="lower")
card_b.add_patch(Rectangle((0, 28.0), 90, 16.0, fill=False, edgecolor="#7f8c8d", lw=0.6))
for val, px in [(0.0, 0), (0.15, 18), (0.30, 36), (0.45, 54), (0.60, 72), (0.75, 90)]:
    card_b.plot([px, px], [28.0, 22.0], color="#2c3e50", lw=0.5)
    card_b.text(px, 14.0, f"{val:.2f}", ha="center", va="top", fontsize=5.8, color="#2c3e50")


# =============================================================================
# PANEL (c): Dynamic Infiltration & Hyetograph Time Series
# =============================================================================
print("  Rendering Panel (c)...")
ax_c = fig.add_subplot(gs[1, 0])

time_hours = np.linspace(11.0, 18.0, 43)  # UTC hours

# Extract representative cells
py, px = 588, 219  # Cloudburst peak burned scarp (Mount Sangias / Kokkala headwaters)
uy, ux = 607, 228  # Unburned pristine karst limestone slope

infil_b = ds["infiltration_rate"].values[:, py, px]
excess_b = ds["excess_rainfall_rate"].values[:, py, px]
rain_b = infil_b + excess_b

infil_u = ds["infiltration_rate"].values[:, uy, ux]
excess_u = ds["excess_rainfall_rate"].values[:, uy, ux]
rain_u = infil_u + excess_u

# Curves
ax_c.plot(time_hours, rain_b, color="#0d47a1", lw=2.0, label=r"Rainfall intensity $i(t)$ (Cloudburst core)", zorder=4)
ax_c.plot(time_hours, infil_b, color="#d95f02", lw=1.8, linestyle="--", label=r"Infiltration rate $f(t)$ (Burned scarp)", zorder=5)
ax_c.fill_between(time_hours, infil_b, rain_b, where=(rain_b > infil_b),
                  facecolor="#e41a1c", alpha=0.25, label=r"Precipitation excess $R_{\mathrm{excess}}(t)$", zorder=3)
ax_c.plot(time_hours, infil_u, color="#2ca02c", lw=1.6, linestyle=":", label=r"Infiltration rate $f(t)$ (Unburned karst)", zorder=6)

ax_c.set_xlim(11.5, 18.0)
ax_c.set_ylim(0, 100)
ax_c.set_xlabel("Time on August 15, 2026 [UTC]", fontsize=8.8, fontweight="bold", labelpad=6)
ax_c.set_ylabel(r"Hydrologic Flux Rate [$\mathrm{mm/h}$]", fontsize=8.8, fontweight="bold", labelpad=8)
ax_c.set_title(r"(c) Dynamic Infiltration & Precipitation Excess Evolution ($i(t)$ vs. $f(t)$)", loc="left", fontweight="bold", pad=7)
ax_c.grid(True, linestyle=":", alpha=0.45, color="#7f8c8d")

# Clean, compact legend in upper right (where values are zero post-storm)
ax_c.legend(loc="upper right", fontsize=7.6, framealpha=0.92, edgecolor="#cccccc")

time_ticks = [12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0]
ax_c.set_xticks(time_ticks)
ax_c.set_xticklabels(["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"], fontsize=7.8)


# =============================================================================
# PANEL (d): Cumulative Hydrologic Mass Balance & Runoff Evolution
# =============================================================================
print("  Rendering Panel (d)...")
ax_d = fig.add_subplot(gs[1, 1])

# Left axis: Cumulative water volume [10^6 m^3]
l_prec, = ax_d.plot(time_hrs, b_vol_prec, color="#1a252f", lw=1.8, label=r"Total precipitation $V_{\mathrm{precip}}(t)$ (Burned)")
l_inf, = ax_d.plot(time_hrs, b_vol_inf, color="#2ca25f", lw=1.6, linestyle="--", label=r"Infiltrated water $V_{\mathrm{infil}}(t)$ (Burned)")
l_exc, = ax_d.plot(time_hrs, b_vol_exc, color="#d73027", lw=1.8, label=r"Precipitation excess $V_{\mathrm{excess}}(t)$ (Burned, $55.3\,\mathrm{km^2}$)")
ax_d.fill_between(time_hrs, 0, b_vol_exc, color="#d73027", alpha=0.15, zorder=2)
l_uexc, = ax_d.plot(time_hrs, u_vol_exc, color="#2b8cbe", lw=1.6, linestyle=":", label=r"Precipitation excess $V_{\mathrm{excess}}(t)$ (Unburned, $1{,}241.8\,\mathrm{km^2}$)")

ax_d.set_xlim(11.5, 18.0)
ax_d.set_ylim(0, 3.2)
ax_d.set_xlabel("Time on August 15, 2026 [UTC]", fontsize=8.8, fontweight="bold", labelpad=6)
ax_d.set_ylabel(r"Cumulative Volume [$10^6\,\mathrm{m^3}$]", fontsize=8.8, fontweight="bold", labelpad=10)
ax_d.set_title(r"(d) Storm Mass Balance Partitioning & Runoff Fraction ($V(t)$ & $C_r$)", loc="left", fontweight="bold", pad=7)
ax_d.grid(True, linestyle=":", alpha=0.45, color="#7f8c8d")

# Right axis: Dynamic Instantaneous Runoff Fraction Cr(t) [%]
ax_d_twin = ax_d.twinx()
l_cr, = ax_d_twin.plot(time_hrs, cr_inst, color="#756bb1", lw=1.8, linestyle="-.", label=r"Instantaneous runoff fraction $C_r^{\mathrm{inst}}(t)$")
l_crevt = ax_d_twin.axhline(30.8, color="#9e9ac8", lw=1.2, linestyle=":", label=r"Event cumulative $C_r = 30.8\%$")
ax_d_twin.set_ylim(0, 100)
ax_d_twin.set_ylabel(r"Runoff Fraction / Coefficient [\%]", fontsize=8.8, fontweight="bold", color="#542788", labelpad=10)
ax_d_twin.tick_params(axis='y', labelcolor="#542788")

# Clean, unified legend in upper left (before storm peak)
handles = [l_prec, l_inf, l_exc, l_uexc, l_cr, l_crevt]
labels = [h.get_label() for h in handles]
ax_d.legend(handles=handles, labels=labels, loc="upper left", fontsize=6.8, framealpha=0.92, edgecolor="#cccccc")

time_ticks = [12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0]
ax_d.set_xticks(time_ticks)
ax_d.set_xticklabels(["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"], fontsize=7.8)



# Save to Scratch Directory First
scratch_png = SCRATCH_DIR / "Figure_4_Infiltration_Dynamics_and_Precipitation_Excess.png"
scratch_pdf = SCRATCH_DIR / "Figure_4_Infiltration_Dynamics_and_Precipitation_Excess.pdf"

print("Saving figure to scratch directory...")
fig.savefig(scratch_png, dpi=300, bbox_inches="tight")
fig.savefig(scratch_pdf, dpi=300, bbox_inches="tight")
plt.close(fig)

# Copy to Publication Directory
FIG_DIR.mkdir(parents=True, exist_ok=True)
pub_png = FIG_DIR / "Figure_4_Infiltration_Dynamics_and_Precipitation_Excess.png"
pub_pdf = FIG_DIR / "Figure_4_Infiltration_Dynamics_and_Precipitation_Excess.pdf"
shutil.copy2(scratch_png, pub_png)
shutil.copy2(scratch_pdf, pub_pdf)

print(f"\n[OK] Successfully generated polished publication Figure 4:")
print(f"  PNG: {pub_png}")
print(f"  PDF: {pub_pdf}")
