"""
plot_figure_1_study_area.py
===========================
Generates publication-quality Figure 1: Hierarchical physiographic and
geographic setting of the August 2026 Mani flash flood study area:
  (a) Regional macro-scale Eastern Mediterranean context
  (b) Meso-scale Peloponnese setting with Mani municipalities and AoI bounding box
  (c) High-resolution 5 m LiDAR topography of the Mani Peninsula AoI with
      field survey reconnaissance sites and NOA Kokkala meteorological station.

Outputs:
  publication/figures/Figure_1_Hierarchical_Study_Area_AoI.png (300 DPI)
  publication/figures/Figure_1_Hierarchical_Study_Area_AoI.pdf (Vector)
"""

import os
import sys
from pathlib import Path
import shutil
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import Rectangle
from matplotlib.gridspec import GridSpec
from matplotlib.colors import LinearSegmentedColormap
from mpl_toolkits.axes_grid1.inset_locator import inset_axes
import geopandas as gpd
import rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer

# Paths
ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
OUTPUTS_DIR = DATA_DIR / "04_outputs"
SCRATCH_DIR = ROOT_DIR / "scratch"
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
FIG_DIR = ROOT_DIR / "publication/figures"
FIG_DIR.mkdir(parents=True, exist_ok=True)
# Optional second copy of the figure files, in the folder named by the environment variable
# MANI_FIGURE_COPY_DIR (default: figures/ in the project root). The copy is made only if the folder exists.
ARTIFACT_DIR = Path(os.environ.get("MANI_FIGURE_COPY_DIR", ROOT_DIR / "figures"))

# Input Datasets
NE_COUNTRIES = DATA_DIR / "02_intermediate/spatial_context/ne_110m_admin_0_countries.geojson"
if not NE_COUNTRIES.exists():
    NE_COUNTRIES = DATA_DIR / "02_intermediate/spatial_context/ne_10m_admin_0_countries/ne_10m_admin_0_countries.shp"

ELSTAT_SHP = DATA_DIR / "01_raw/terrain/elstat_2015/elstat_municipalities/Panorama_Level_3_Municipalities_Polygons_WGS84.shp"
HS_TIF = OUTPUTS_DIR / "01_terrain/Hillshade_5m.tif"
DEM_TIF = OUTPUTS_DIR / "01_terrain/DEM_5m.tif"
GDB_PATH = OUTPUTS_DIR / "Mani_Flood_Study.gdb"

# Academic styling
plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman", "Palatino", "Georgia"],
    "mathtext.fontset": "cm",
    "font.size": 9.0,
    "axes.labelsize": 8.5,
    "axes.titlesize": 9.5,
    "xtick.labelsize": 8.0,
    "ytick.labelsize": 8.0,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "axes.linewidth": 0.7,
})

print("[1/4] Loading spatial context vector layers...")
gdf_countries = gpd.read_file(NE_COUNTRIES)
gdf_elstat = gpd.read_file(ELSTAT_SHP)

tr_to_2100 = Transformer.from_crs("EPSG:4326", "EPSG:2100", always_xy=True)
tr_to_4326 = Transformer.from_crs("EPSG:2100", "EPSG:4326", always_xy=True)

mani_mask = gdf_elstat['name_en'].str.contains("MANI", case=False, na=False)
gdf_greece_solid = gdf_elstat.dissolve()

print("[2/4] Reading high-resolution 5m terrain grids...")
x0, x1 = 344500, 368500
y0, y1 = 4024500, 4068500  # 4024500 provides comfortable margin south of Cape Tainaron

with rasterio.open(HS_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    out_shape = (int(win.height // 3), int(win.width // 3))
    hs = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)
    hs_ext = [x0, x1, y0, y1]

with rasterio.open(DEM_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    dem = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)

land_mask = (dem > 0.1) & (hs > 0) & (hs < 254)
hs_masked = np.ma.masked_where(~land_mask, hs)
dem_masked = np.ma.masked_where(~land_mask, dem)

print("[3/4] Reading stream channels from GDB...")
gdf_streams = gpd.read_file(str(GDB_PATH), layer="Mani_Stream_Network")
gdf_streams_clip = gdf_streams.cx[x0:x1, y0:y1]

survey_sites = [
    {"id": "1", "name": "Oitylo", "x": 355834.0, "y": 4063800.0, "dx": 0, "dy": 550, "ha": "center", "va": "bottom"},
    {"id": "2", "name": "Karavostasi", "x": 355250.0, "y": 4062400.0, "dx": 0, "dy": -850, "ha": "center", "va": "center"},
    {"id": "3", "name": "Neo Oitylo", "x": 356080.0, "y": 4062880.0, "dx": 550, "dy": 0, "ha": "left", "va": "center"},
    {"id": "4", "name": "Alypa", "x": 363850.0, "y": 4047050.0, "dx": 550, "dy": 0, "ha": "left", "va": "center"},
    {"id": "5", "name": "Kokkala", "x": 363050.0, "y": 4043550.0, "dx": 450, "dy": 0, "ha": "left", "va": "center"},
]

kokk_noa_x, kokk_noa_y = 363650.0, 4042350.0
aoi_lon_min, aoi_lat_min = tr_to_4326.transform(x0, y0)
aoi_lon_max, aoi_lat_max = tr_to_4326.transform(x1, y1)

print("[4/4] Rendering publication Figure 1...")
fig = plt.figure(figsize=(11.8, 10.0))
gs = GridSpec(2, 2, width_ratios=[1.0, 1.25], height_ratios=[1.0, 1.15],
              wspace=0.14, hspace=0.18, left=0.06, right=0.96, top=0.96, bottom=0.05)

sea_color = "#edf4f8"
land_color = "#e8ecef"
greece_color = "#d5dbdb"
halo = [pe.withStroke(linewidth=2.2, foreground="white")]
halo_thin = [pe.withStroke(linewidth=1.8, foreground="white")]

# -------------------------------------------------------------------------
# Panel (a): Eastern Mediterranean Macro-Context
# -------------------------------------------------------------------------
ax_a = fig.add_subplot(gs[0, 0])
ax_a.set_facecolor(sea_color)

# Determine foreign countries vs Greece
if 'ADMIN' in gdf_countries.columns:
    gdf_foreign = gdf_countries[gdf_countries['ADMIN'] != 'Greece']
    gdf_foreign.plot(ax=ax_a, facecolor=land_color, edgecolor="#95a5a6", linewidth=0.5, zorder=2, aspect="auto")
elif 'name' in gdf_countries.columns:
    gdf_foreign = gdf_countries[gdf_countries['name'] != 'Greece']
    gdf_foreign.plot(ax=ax_a, facecolor=land_color, edgecolor="#95a5a6", linewidth=0.5, zorder=2, aspect="auto")
else:
    gdf_countries.plot(ax=ax_a, facecolor=land_color, edgecolor="#95a5a6", linewidth=0.5, zorder=2, aspect="auto")

gdf_greece_solid.plot(ax=ax_a, facecolor=greece_color, edgecolor="#566573", linewidth=0.7, zorder=3, aspect="auto")

ax_a.set_xlim(9.5, 31.5)
ax_a.set_ylim(31.0, 44.5)
ax_a.set_aspect(1.22)

# Peloponnese extent box
b_lon_min, b_lon_max = 21.05, 23.65
b_lat_min, b_lat_max = 36.25, 38.45
rect_b = Rectangle((b_lon_min, b_lat_min), b_lon_max - b_lon_min, b_lat_max - b_lat_min,
                   facecolor="none", edgecolor="#c0392b", linewidth=1.2, zorder=6)
ax_a.add_patch(rect_b)

ax_a.text(17.5, 36.8, "Ionian Sea", fontsize=7.5, fontstyle="italic", color="#34495e", ha="center", path_effects=halo, zorder=5)
ax_a.text(25.5, 37.5, "Aegean Sea", fontsize=7.5, fontstyle="italic", color="#34495e", ha="center", path_effects=halo, zorder=5)
ax_a.text(22.8, 39.0, "Greece", fontsize=8.5, fontweight="bold", color="#2c3e50", ha="center", path_effects=halo, zorder=5)

ax_a.set_xticks([12, 18, 24, 30])
ax_a.set_xticklabels(["12°E", "18°E", "24°E", "30°E"])
ax_a.set_yticks([32, 36, 40, 44])
ax_a.set_yticklabels(["32°N", "36°N", "40°N", "44°N"])
ax_a.tick_params(direction="out", length=3.0, width=0.6)
ax_a.set_title(r"(a) Eastern Mediterranean", loc="left", fontweight="bold", pad=6)

# -------------------------------------------------------------------------
# Panel (b): Peloponnese Meso-Scale Setting & Administrative Framing
# -------------------------------------------------------------------------
ax_b = fig.add_subplot(gs[1, 0])
ax_b.set_facecolor(sea_color)

gdf_greece_solid.plot(ax=ax_b, facecolor="#f2f4f4", edgecolor="#7f8c8d", linewidth=0.7, zorder=2, aspect="auto")
gdf_elstat[mani_mask].plot(ax=ax_b, facecolor="#fadbd8", edgecolor="#c0392b", linewidth=1.0, zorder=3, aspect="auto")

# Study Area AoI Bounding Box
rect_c = Rectangle((aoi_lon_min, aoi_lat_min), aoi_lon_max - aoi_lon_min, aoi_lat_max - aoi_lat_min,
                   facecolor="none", edgecolor="#922b21", linewidth=1.4, zorder=6)
ax_b.add_patch(rect_c)

ax_b.text(22.10, 37.55, "Peloponnese", fontsize=8.5, fontweight="bold", color="#2c3e50", ha="center", path_effects=halo, zorder=5)
ax_b.text(21.90, 36.85, "Messenian\nGulf", fontsize=7.0, fontstyle="italic", color="#34495e", ha="center", path_effects=halo, zorder=5)
ax_b.text(22.85, 36.75, "Laconian\nGulf", fontsize=7.0, fontstyle="italic", color="#34495e", ha="center", path_effects=halo, zorder=5)
ax_b.text(22.48, 36.31, "Cape Tainaron", fontsize=6.8, fontstyle="italic", color="#424949", ha="center", va="top", path_effects=halo, zorder=7)

# Panel (b) Inset Legend Card (in open water SW of Messenia)
card_b = inset_axes(ax_b, width="44%", height="11%", loc="lower left",
                    bbox_to_anchor=(0.03, 0.025, 1, 1), bbox_transform=ax_b.transAxes)
card_b.patch.set_visible(False)
card_b.axis('off')
card_b.set_xlim(0, 100)
card_b.set_ylim(0, 100)

# Swatch 1: Mani Municipalities
card_b.add_patch(Rectangle((0, 56), 12, 22, facecolor="#fadbd8", edgecolor="#c0392b", lw=0.9))
card_b.text(17, 67, "Mani Municipalities\n(East & West Mani)", va="center", fontsize=6.4, color="#2c3e50", path_effects=halo_thin)

# Swatch 2: High-Resolution Study Area AoI
card_b.add_patch(Rectangle((0, 12), 12, 22, facecolor="none", edgecolor="#922b21", lw=1.3))
card_b.text(17, 23, "High-Resolution AoI (Panel c)", va="center", fontsize=6.4, color="#2c3e50", path_effects=halo_thin)

ax_b.set_xlim(b_lon_min, b_lon_max)
ax_b.set_ylim(b_lat_min, b_lat_max)
ax_b.set_aspect(1.22)
ax_b.set_xticks([21.5, 22.0, 22.5, 23.0, 23.5])
ax_b.set_xticklabels(["21.5°E", "22.0°E", "22.5°E", "23.0°E", "23.5°E"])
ax_b.set_yticks([36.5, 37.0, 37.5, 38.0])
ax_b.set_yticklabels(["36.5°N", "37.0°N", "37.5°N", "38.0°N"])
ax_b.tick_params(direction="out", length=3.0, width=0.6)
ax_b.set_title(r"(b) Peloponnese", loc="left", fontweight="bold", pad=6)

# -------------------------------------------------------------------------
# Panel (c): Mani Peninsula AoI & Field Reconnaissance Sites
# -------------------------------------------------------------------------
ax_c = fig.add_subplot(gs[:, 1])
ax_c.set_facecolor(sea_color)

ax_c.imshow(hs_masked, extent=hs_ext, cmap="gray", vmin=60, vmax=225, origin="upper", zorder=2, clip_on=True)

dem_colors = [
    (0.00, "#3e7d6c"),  # Maritime sage green
    (0.12, "#68a37f"),  # Fresh valley green
    (0.28, "#a8b868"),  # Olive terrace
    (0.48, "#dfba68"),  # Golden karst buff
    (0.70, "#b87848"),  # Terracotta / sienna
    (0.88, "#7a5c4d"),  # Upland limestone
    (1.00, "#f5f3f0"),  # Mt. Sangias summit crest
]
dem_cmap = LinearSegmentedColormap.from_list("mani_hypsometry", [(pos, col) for pos, col in dem_colors], N=256)
im_dem = ax_c.imshow(dem_masked, extent=hs_ext, cmap=dem_cmap, vmin=0, vmax=1200, alpha=0.34, origin="upper", zorder=3, clip_on=True)

# Streams removed per user request
# gdf_streams_clip.plot(...) omitted

ax_c.text(348000, 4055000, "Messenian\nGulf", fontsize=7.8, fontstyle="italic", color="#4a6572", ha="center", path_effects=halo, zorder=5)
ax_c.text(366500, 4058000, "Laconian\nGulf", fontsize=7.8, fontstyle="italic", color="#4a6572", ha="center", path_effects=halo, zorder=5)

ax_c.text(359500, 4053500, "Mt. Sangias\n(1,214 m)", fontsize=7.8, fontstyle="italic",
          color="#2c3e50", ha="center", path_effects=halo, zorder=6)

ax_c.text(364400, 4029200, "Cape Tainaron", fontsize=7.2, fontstyle="italic",
          color="#2c3e50", ha="left", va="center", path_effects=halo, zorder=6)

for s in survey_sites:
    sx, sy = s["x"], s["y"]
    ax_c.scatter(sx, sy, marker="o", s=38, facecolor="#f39c12", edgecolor="#7e5109", linewidth=0.9, zorder=7)
    ax_c.text(sx + s["dx"], sy + s["dy"], f"{s['id']}. {s['name']}",
              fontsize=7.3, fontweight="bold", color="#1a252f",
              ha=s["ha"], va=s.get("va", "center"), path_effects=halo_thin, zorder=8)

ax_c.scatter(kokk_noa_x, kokk_noa_y, marker="^", s=65, facecolor="#e74c3c", edgecolor="#922b21", linewidth=0.9, zorder=9)
ax_c.text(kokk_noa_x + 450, kokk_noa_y, "NOA Station", fontsize=6.8, fontstyle="italic",
          fontweight="bold", color="#922b21", ha="left", va="center", path_effects=halo_thin, zorder=10)

# Top-Left Furniture: North Arrow & Metric Scale Bar
na_x = 347400
ax_c.annotate("", xy=(na_x, 4066900), xytext=(na_x, 4065300),
              arrowprops=dict(facecolor="#2c3e50", edgecolor="#2c3e50", width=1.2, headwidth=4.0), zorder=10)
ax_c.text(na_x, 4067150, "N", ha="center", va="bottom", fontsize=8.0, fontweight="bold",
          color="#2c3e50", path_effects=halo_thin, zorder=10)

sb_x0, sb_x1 = 345900, 348900
sb_y = 4064500
ax_c.plot([sb_x0, sb_x1], [sb_y, sb_y], color="#2c3e50", lw=1.3, zorder=10)
for tx in [sb_x0, (sb_x0 + sb_x1) / 2, sb_x1]:
    ax_c.plot([tx, tx], [sb_y - 180, sb_y + 180], color="#2c3e50", lw=0.8, zorder=10)
ax_c.text(sb_x0, sb_y - 380, "0", ha="center", va="top", fontsize=6.5, color="#2c3e50", path_effects=halo_thin, zorder=10)
ax_c.text((sb_x0 + sb_x1) / 2, sb_y - 380, "1.5", ha="center", va="top", fontsize=6.5, color="#2c3e50", path_effects=halo_thin, zorder=10)
ax_c.text(sb_x1, sb_y - 380, "3 km", ha="center", va="top", fontsize=6.5, color="#2c3e50", path_effects=halo_thin, zorder=10)

# Lower-Left Furniture: Legend & Elevation Colorbar
card_ax = inset_axes(ax_c, width="27%", height="12%", loc="lower left",
                     bbox_to_anchor=(0.04, 0.035, 1, 1), bbox_transform=ax_c.transAxes)
card_ax.patch.set_visible(False)
card_ax.axis('off')
card_ax.set_xlim(0, 100)
card_ax.set_ylim(0, 100)

card_ax.scatter(12, 85, marker="o", s=36, facecolor="#f39c12", edgecolor="#7e5109", linewidth=0.9, zorder=3)
card_ax.text(22, 85, "Field survey site", va="center", fontsize=7.0, color="#2c3e50")

card_ax.scatter(12, 63, marker="^", s=44, facecolor="#e74c3c", edgecolor="#922b21", linewidth=0.9, zorder=3)
card_ax.text(22, 63, "NOA weather station", va="center", fontsize=7.0, color="#2c3e50")

card_ax.text(50, 35.0, "Elevation (m)", ha="center", va="center", fontsize=6.8, color="#2c3e50")

grad = np.linspace(0, 1, 256).reshape(1, -1)
card_ax.imshow(grad, extent=[10.0, 90.0, 16.0, 22.0], aspect="auto", cmap=dem_cmap, origin="lower", zorder=3)
cbar_box = Rectangle((10.0, 16.0), 80.0, 6.0, fill=False, edgecolor="#7f8c8d", lw=0.6, zorder=4)
card_ax.add_patch(cbar_box)

for val, x in [(0, 10.0), (400, 36.67), (800, 63.33), (1200, 90.0)]:
    card_ax.plot([x, x], [16.0, 13.0], color="#2c3e50", lw=0.6, zorder=4)
    card_ax.text(x, 8.5, str(val), ha="center", va="top", fontsize=6.2, color="#2c3e50", zorder=4)

lon_ticks_deg = [22.35, 22.40, 22.45, 22.50]
lon_tick_labels = [f"{lon:.2f}°E" for lon in lon_ticks_deg]
lon_ticks_m = [tr_to_2100.transform(lon, 36.50)[0] for lon in lon_ticks_deg]

lat_ticks_deg = [36.40, 36.45, 36.50, 36.55, 36.60, 36.65, 36.70]
lat_tick_labels = [f"{lat:.2f}°N" for lat in lat_ticks_deg]
lat_ticks_m = [tr_to_2100.transform(22.40, lat)[1] for lat in lat_ticks_deg]

ax_c.set_xticks(lon_ticks_m)
ax_c.set_xticklabels(lon_tick_labels)
ax_c.set_yticks(lat_ticks_m)
ax_c.set_yticklabels(lat_tick_labels)
ax_c.tick_params(direction="out", length=3.0, width=0.6)

ax_c.set_xlim(x0, x1)
ax_c.set_ylim(y0, y1)
ax_c.set_aspect("equal")
ax_c.set_title(r"(c) Mani Peninsula AoI & Field Reconnaissance Sites", loc="left", fontweight="bold", pad=6)

# Save
scratch_png = SCRATCH_DIR / "Figure_1_Hierarchical_Study_Area_AoI.png"
scratch_pdf = SCRATCH_DIR / "Figure_1_Hierarchical_Study_Area_AoI.pdf"
pub_png = FIG_DIR / "Figure_1_Hierarchical_Study_Area_AoI.png"
pub_pdf = FIG_DIR / "Figure_1_Hierarchical_Study_Area_AoI.pdf"

print(f"Saving to scratch: {scratch_png}...")
fig.savefig(scratch_png, format="png", dpi=300, bbox_inches="tight")
fig.savefig(scratch_pdf, format="pdf", dpi=300, bbox_inches="tight")
plt.close(fig)

shutil.copy2(scratch_png, pub_png)
shutil.copy2(scratch_pdf, pub_pdf)

if ARTIFACT_DIR.exists():
    shutil.copy2(scratch_png, ARTIFACT_DIR / "Figure_1_Hierarchical_Study_Area_AoI.png")
    shutil.copy2(scratch_pdf, ARTIFACT_DIR / "Figure_1_Hierarchical_Study_Area_AoI.pdf")

print(f"\n[SUCCESS] Figure 1 rendered successfully:")
print(f"  - PNG: {pub_png}")
print(f"  - PDF: {pub_pdf}")
