"""Publication Figure 2: Catchment Physiography, Hydro-Lithology & Wildfire Conditioning Map.

Generates publication-grade 300 DPI PNG and vector PDF figures conforming to
international Earth Science publishing standards (Elsevier / Nature Comms / MDPI):
- Panel (a): Topographic Slope Gradient & Drainage Network.
- Panel (b): Hydro-Lithological Units & Bedrock Permeability (Official EAGME 1:500k).
- Panel (c): Wildfire Burn Scars & Soil Hydrophobicity Zones (Official Copernicus EFFIS perimeters).
- Panel (d): Effective Soil Infiltration Capacity (Ks,eff in mm/h) and Flood Predisposition.

Outputs saved to:
  publication/figures/Figure_2_Catchment_Physiography_and_Conditioning.png
  publication/figures/Figure_2_Catchment_Physiography_and_Conditioning.pdf
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')

from pathlib import Path
import json
import shutil
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import Rectangle
from matplotlib.gridspec import GridSpec
from matplotlib.colors import Normalize
from mpl_toolkits.axes_grid1.inset_locator import inset_axes
import geopandas as gpd
from shapely.geometry import Polygon, MultiPolygon
import rasterio
from rasterio.features import rasterize
from rasterio.windows import from_bounds
from pyproj import Transformer

# Paths (Cross-Platform Dynamic Resolution)
ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
OUTPUTS_DIR = DATA_DIR / "04_outputs"
SCRATCH_DIR = ROOT_DIR / "scratch"
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
FIG_DIR = ROOT_DIR / "publication/figures"
ARTIFACT_DIR = Path("/home/liaskos/.gemini/antigravity/brain/540c9013-c9a8-4d44-beff-3f8fded4ddd3")

HS_TIF = OUTPUTS_DIR / "01_terrain/Hillshade_5m.tif"
DEM_TIF = OUTPUTS_DIR / "01_terrain/DEM_5m.tif"
SLOPE_TIF = DATA_DIR / "03_processed/terrain/hydrology/mani_slope_deg.tif"
GDB_PATH = OUTPUTS_DIR / "Mani_Flood_Study.gdb"

EAGME_JSON = DATA_DIR / "01_raw/geology_drainage/native_responses/native/sha256-4124078a5228/eagme_geology500_features_00000.body"
EFFIS_ZIP = DATA_DIR / "01_raw/soils_land_cover/copernicus-effis/burnt-areas/additional-readiness-2026-09-11/sha256-7336e38fd3d3/mani-burnt-area-query.zip"

# Spatial Extent with generous open sea breathing room
x0, x1 = 341500, 369000
y0, y1 = 4036000, 4072500

tr_to_4326 = Transformer.from_crs("EPSG:2100", "EPSG:4326", always_xy=True)
tr_to_2100 = Transformer.from_crs("EPSG:4326", "EPSG:2100", always_xy=True)

print("[1/6] Loading DEM, Hillshade and Slope Rasters...")
with rasterio.open(DEM_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    out_shape = (int(win.height // 3), int(win.width // 3))
    dem = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)
    bounds_extent = [x0, x1, y0, y1]
    win_transform = rasterio.windows.transform(win, src.transform)
    scale_x = win.width / out_shape[1]
    scale_y = win.height / out_shape[0]
    cell_transform = win_transform * rasterio.Affine.scale(scale_x, scale_y)

with rasterio.open(HS_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    hs = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)

with rasterio.open(SLOPE_TIF) as src:
    win = from_bounds(x0, y0, x1, y1, src.transform)
    slope = src.read(1, window=win, out_shape=out_shape, resampling=rasterio.enums.Resampling.bilinear).astype(float)

land_mask = (dem > 0.1) & (hs > 0) & (hs < 254)
hs_masked = np.ma.masked_where(~land_mask, hs)
slope_masked = np.ma.masked_where(~land_mask, slope)

print("[2/6] Loading Official EAGME 1:500k Geology Vector Data...")
with open(EAGME_JSON, "r", encoding="utf-8") as f:
    eagme_raw = json.load(f)

geol_features = []
for feat in eagme_raw["features"]:
    rings = feat["geometry"]["rings"]
    poly = Polygon(rings[0]) if len(rings) == 1 else MultiPolygon([Polygon(r) for r in rings])
    geol_features.append({"geometry": poly, **feat["attributes"]})

gdf_geol = gpd.GeoDataFrame(geol_features, crs="EPSG:3857").to_crs(epsg=2100)
geol_aoi = gdf_geol.cx[x0:x1, y0:y1].copy()

def classify_lithology(code, desc):
    c = str(code).lower()
    d = str(desc).lower()
    if "c<sub" in c or "c2" in c or "plattenkalk" in d:
        return "Plattenkalk Karst Limestone"
    elif "tj" in c or "pantocrator" in d or "me" in c:
        return "Tripolitza Karst Carbonates"
    elif "ph" in c or "phyllite" in d:
        return "Phyllite-Quartzite Basement"
    elif "fi" in c or "flysch" in d:
        return "Semimetamorphic Flysch"
    elif "al" in c or "alluv" in d or "cq" in c or "p" in c:
        return "Quaternary Alluvium & Scree"
    elif "jc" in c or "chert" in d:
        return "Posidonia Cherts"
    else:
        return "Other Sedimentary Units"

geol_aoi["hydro_unit"] = [classify_lithology(r["label"], r["descriptionen"]) for _, r in geol_aoi.iterrows()]

litho_palette = {
    "Plattenkalk Karst Limestone": "#6baed6",
    "Tripolitza Karst Carbonates": "#3182bd",
    "Phyllite-Quartzite Basement": "#e6d5b8",
    "Semimetamorphic Flysch": "#d4b996",
    "Quaternary Alluvium & Scree": "#fee391",
    "Posidonia Cherts": "#dadaeb",
}

print("[3/6] Loading Official Copernicus EFFIS Burnt Area Perimeters...")
gdf_fire = gpd.read_file(f"zip://{EFFIS_ZIP}!modis.ba.poly.shp").to_crs(epsg=2100)
fires_aoi = gdf_fire.cx[x0:x1, y0:y1].copy()
fires_aoi["YEAR"] = fires_aoi["FIREDATE"].str[:4].astype(int)

def classify_fire_period(yr):
    if yr == 2021:
        return "August 2021 Major Fire\n(11,209 ha core, 11,715 ha total)"
    elif yr in [2017, 2020]:
        return "2017 & 2020 Wildfires"
    else:
        return "2022–2026 Recent Wildfires"

fires_aoi["period"] = [classify_fire_period(y) for y in fires_aoi["YEAR"]]

fire_palette = {
    "August 2021 Major Fire\n(11,209 ha core, 11,715 ha total)": ("#d73027", "#800000"),
    "2017 & 2020 Wildfires": ("#f46d43", "#b33000"),
    "2022–2026 Recent Wildfires": ("#fdae61", "#d95f02"),
}

print("[4/6] Computing Physically-Based Effective Infiltration Capacity (Ks,eff)...")
shapes_litho = []
for _, row in geol_aoi.iterrows():
    u = row["hydro_unit"]
    val = 26.0 if u in ["Plattenkalk Karst Limestone", "Tripolitza Karst Carbonates"] else (18.0 if u == "Quaternary Alluvium & Scree" else (12.0 if u in ["Semimetamorphic Flysch", "Posidonia Cherts"] else 8.0))
    shapes_litho.append((row.geometry, val))

base_ks = rasterize(shapes_litho, out_shape=out_shape, transform=cell_transform, fill=12.0, dtype=np.float32)
shapes_fire = [(geom, 1) for geom in fires_aoi.geometry]
fire_mask_raster = rasterize(shapes_fire, out_shape=out_shape, transform=cell_transform, fill=0, dtype=np.uint8) == 1
karst_polys = geol_aoi[geol_aoi["hydro_unit"].isin(["Plattenkalk Karst Limestone", "Tripolitza Karst Carbonates"])].geometry
karst_mask_raster = rasterize([(geom, 1) for geom in karst_polys], out_shape=out_shape, transform=cell_transform, fill=0, dtype=np.uint8) == 1

ks_eff = np.copy(base_ks)
ks_eff = np.where(karst_mask_raster & ~fire_mask_raster, ks_eff + 12.0, ks_eff)
ks_eff = np.where(fire_mask_raster, ks_eff * 0.25, ks_eff)

# Multi-factor physical coupling: Topographic slope gradient factor cos(alpha)
# (Chen & Young 2006, WRR; Morbidelli et al. 2018, J. Hydrol.)
slope_clamped = np.clip(slope, 0.0, 85.0)
cos_alpha = np.cos(np.radians(slope_clamped))
ks_eff = ks_eff * cos_alpha
ks_eff_masked = np.ma.masked_where(~land_mask, ks_eff)

print("[5/6] Loading Stream Network and Survey Sites...")
streams = gpd.read_file(str(GDB_PATH), layer="Mani_Stream_Network")
streams_clip = streams.cx[x0:x1, y0:y1].copy()
streams_order2 = streams_clip[streams_clip["grid_code"] == 2]
streams_order3plus = streams_clip[streams_clip["grid_code"] >= 3]

ref_settlements = [
    {"name": "Oitylo", "x": 355834.0, "y": 4063800.0, "dx": 450, "dy": 0, "ha": "left", "va": "center"},
    {"name": "Areopoli", "x": 355371.0, "y": 4058828.0, "dx": -450, "dy": 0, "ha": "right", "va": "center"},
    {"name": "Kotronas", "x": 365150.0, "y": 4053642.0, "dx": 450, "dy": 200, "ha": "left", "va": "bottom"},
    {"name": "Flomochori", "x": 363031.0, "y": 4054011.0, "dx": -450, "dy": 250, "ha": "right", "va": "bottom"},
    {"name": "Kokkala", "x": 363050.0, "y": 4043550.0, "dx": 450, "dy": 0, "ha": "left", "va": "center"},
]

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman", "Palatino", "Georgia"],
    "mathtext.fontset": "cm",
    "font.size": 8.5,
    "axes.labelsize": 8.5,
    "axes.titlesize": 9.6,
    "xtick.labelsize": 7.5,
    "ytick.labelsize": 7.5,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "axes.linewidth": 0.8,
})

fig = plt.figure(figsize=(13.6, 18.4))
gs = GridSpec(2, 2, width_ratios=[1.0, 1.0], height_ratios=[1.0, 1.0],
              wspace=0.045, hspace=0.065, left=0.065, right=0.975, top=0.965, bottom=0.035)

sea_color = "#edf4f8"
halo = [pe.withStroke(linewidth=2.2, foreground="white")]
halo_thin = [pe.withStroke(linewidth=1.8, foreground="white")]

def apply_common_base(ax, show_streams=False, show_settlements=False,
                      is_left_col=True, is_bottom_row=True, show_gulfs=False):
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
    
    if show_streams:
        streams_order2.plot(ax=ax, color="#2980b9", linewidth=0.38, alpha=0.48, zorder=6)
        streams_order3plus.plot(ax=ax, color="#0e4b77", linewidth=0.88, alpha=0.85, zorder=7)
    
    if show_settlements:
        for s in ref_settlements:
            ax.scatter(s["x"], s["y"], s=16, color="#34495e", edgecolor="white", linewidth=0.5, zorder=9)
            ax.text(s["x"] + s["dx"], s["y"] + s["dy"], s["name"], fontsize=7.2,
                    color="#34495e", ha=s["ha"], va=s["va"], path_effects=halo_thin, zorder=10)
    
    if show_gulfs:
        ax.text(345200, 4058000, "Messenian\nGulf", fontsize=7.8, fontstyle="italic", color="#5c768d", ha="center", path_effects=halo, zorder=5)
        ax.text(366500, 4058000, "Laconian\nGulf", fontsize=7.8, fontstyle="italic", color="#5c768d", ha="center", path_effects=halo, zorder=5)


def add_unified_north_and_scale(ax):
    """Clean, integrated North Arrow and Scale Bar block at top-left open water."""
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


# =============================================================================
# PANEL (a): Topographic Slope Gradient
# =============================================================================
print("[6/6] Rendering 4-Panel Cartographic Masterpiece...")
print("  Rendering Panel (a)...")
ax_a = fig.add_subplot(gs[0, 0])
ax_a.imshow(hs_masked, cmap="gray", vmin=30, vmax=240, extent=bounds_extent, origin="upper", zorder=1)

cmap_slope = plt.cm.YlOrRd
slope_norm = Normalize(vmin=0, vmax=50)
im_slope = ax_a.imshow(slope_masked, cmap=cmap_slope, norm=slope_norm, alpha=0.62, extent=bounds_extent, origin="upper", zorder=2)

apply_common_base(ax_a, show_streams=False, show_settlements=True, is_left_col=True, is_bottom_row=False, show_gulfs=True)
add_unified_north_and_scale(ax_a)
ax_a.set_title("(a) Topographic Slope Gradient", loc="left", fontweight="bold", pad=7)

# TRANSPARENT CARD (Matching Figure 1 / Panel d style: patch visible False, axis off)
card_a = inset_axes(ax_a, width="28%", height="9.5%", loc="lower left",
                    bbox_to_anchor=(0.04, 0.04, 1, 1), bbox_transform=ax_a.transAxes)
card_a.patch.set_visible(False)
card_a.axis('off')
card_a.set_xlim(0, 100)
card_a.set_ylim(0, 100)

card_a.text(45, 54.0, "Slope Gradient [°]", ha="center", va="bottom", fontsize=6.6, color="#2c3e50")
grad_slope = np.linspace(0, 50, 256).reshape(1, -1)
card_a.imshow(grad_slope, extent=[0, 90, 28.0, 44.0], aspect="auto", cmap=cmap_slope, norm=slope_norm, origin="lower")
card_a.add_patch(Rectangle((0, 28.0), 90, 16.0, fill=False, edgecolor="#7f8c8d", lw=0.6))
for val, px in [(0, 0), (10, 18), (20, 36), (30, 54), (40, 72), (50, 90)]:
    card_a.plot([px, px], [28.0, 22.0], color="#2c3e50", lw=0.5)
    card_a.text(px, 14.0, str(val), ha="center", va="top", fontsize=5.8, color="#2c3e50")


# =============================================================================
# PANEL (b): Hydro-Lithological Units & Bedrock Permeability (EAGME)
# =============================================================================
print("  Rendering Panel (b)...")
ax_b = fig.add_subplot(gs[0, 1])
ax_b.imshow(hs_masked, cmap="gray", vmin=40, vmax=230, extent=bounds_extent, origin="upper", zorder=1)

for unit_name, color in litho_palette.items():
    sub = geol_aoi[geol_aoi["hydro_unit"] == unit_name]
    if len(sub) > 0:
        sub.plot(ax=ax_b, facecolor=color, alpha=0.68, edgecolor="#424242", linewidth=0.35, zorder=2)

apply_common_base(ax_b, show_streams=False, show_settlements=False, is_left_col=False, is_bottom_row=False, show_gulfs=False)
ax_b.set_title("(b) Hydro-Lithological Units & Bedrock Permeability (EAGME)", loc="left", fontweight="bold", pad=7)

card_b = inset_axes(ax_b, width="28%", height="19.5%", loc="lower left",
                    bbox_to_anchor=(0.04, 0.04, 1, 1), bbox_transform=ax_b.transAxes)
card_b.patch.set_visible(False)
card_b.axis('off')
card_b.set_xlim(0, 100)
card_b.set_ylim(0, 100)

card_b.text(0, 85.5, "Hydro-Lithology (1:500k)", va="bottom", fontsize=7.2, fontweight="bold", color="#1a252f")

y_pos = 75.0
for name, color in litho_palette.items():
    card_b.add_patch(Rectangle((0, y_pos - 4.5), 10, 9.0, facecolor=color, edgecolor="#424242", lw=0.5))
    card_b.text(16, y_pos, name, va="center", fontsize=6.4, color="#2c3e50")
    y_pos -= 14.0


# =============================================================================
# PANEL (c): Wildfire Burn Scars & Hydrophobicity Zones (EFFIS)
# =============================================================================
print("  Rendering Panel (c)...")
ax_c = fig.add_subplot(gs[1, 0])
ax_c.imshow(hs_masked, cmap="gray", vmin=40, vmax=230, extent=bounds_extent, origin="upper", zorder=1)
veg_tint = np.zeros((*dem.shape, 4), dtype=float)
veg_tint[land_mask] = [0.55, 0.75, 0.40, 0.35]
ax_c.imshow(veg_tint, extent=bounds_extent, origin="upper", zorder=2)

for period_name, (fc, ec) in fire_palette.items():
    sub = fires_aoi[fires_aoi["period"] == period_name]
    if len(sub) > 0:
        sub.plot(ax=ax_c, facecolor=fc, alpha=0.75, edgecolor=ec, linewidth=0.7, zorder=3)

apply_common_base(ax_c, show_streams=False, show_settlements=False, is_left_col=True, is_bottom_row=True, show_gulfs=False)
ax_c.set_title("(c) Wildfire Burn Scars & Soil Hydrophobicity Zones (EFFIS)", loc="left", fontweight="bold", pad=7)

card_c = inset_axes(ax_c, width="36%", height="16.0%", loc="lower left",
                    bbox_to_anchor=(0.02, 0.035, 1, 1), bbox_transform=ax_c.transAxes)
card_c.patch.set_visible(False)
card_c.axis('off')
card_c.set_xlim(0, 100)
card_c.set_ylim(0, 100)

card_c.text(0, 83.5, "Copernicus EFFIS Fires", va="bottom", fontsize=7.2, fontweight="bold", color="#1a252f")

y_pos = 73.0
for name, (fc, ec) in fire_palette.items():
    card_c.add_patch(Rectangle((0, y_pos - 4.5), 9, 9.0, facecolor=fc, edgecolor=ec, lw=0.6))
    card_c.text(13, y_pos, name, va="center", fontsize=5.9, color="#2c3e50", path_effects=halo_thin)
    if "\n" in name:
        y_pos -= 19.0
    else:
        y_pos -= 15.0

card_c.add_patch(Rectangle((0, y_pos - 4.5), 9, 9.0, facecolor="#8fbc8f", edgecolor="#2e7d32", lw=0.5))
card_c.text(13, y_pos, "Unburned Vegetative Cover", va="center", fontsize=5.9, color="#2c3e50", path_effects=halo_thin)


# =============================================================================
# PANEL (d): Effective Soil Infiltration Capacity (Ks,eff)
# =============================================================================
print("  Rendering Panel (d)...")
ax_d = fig.add_subplot(gs[1, 1])
ax_d.imshow(hs_masked, cmap="gray", vmin=35, vmax=240, extent=bounds_extent, origin="upper", zorder=1)

cmap_ks = plt.cm.Spectral
ks_norm = Normalize(vmin=0, vmax=40)
im_ks = ax_d.imshow(ks_eff_masked, cmap=cmap_ks, norm=ks_norm, alpha=0.68, extent=bounds_extent, origin="upper", zorder=2)

apply_common_base(ax_d, show_streams=False, show_settlements=False, is_left_col=False, is_bottom_row=True, show_gulfs=False)
ax_d.set_title(r"(d) Effective Soil Infiltration Capacity ($K_{s,\mathrm{eff}}$)", loc="left", fontweight="bold", pad=7)

card_d = inset_axes(ax_d, width="28%", height="9.5%", loc="lower left",
                    bbox_to_anchor=(0.04, 0.04, 1, 1), bbox_transform=ax_d.transAxes)
card_d.patch.set_visible(False)
card_d.axis('off')
card_d.set_xlim(0, 100)
card_d.set_ylim(0, 100)

card_d.text(45, 54.0, r"Effective Infiltration $K_{s,\mathrm{eff}}$ [$\mathrm{mm/h}$]", ha="center", va="bottom", fontsize=6.6, color="#2c3e50")

grad_ks = np.linspace(0, 40, 256).reshape(1, -1)
card_d.imshow(grad_ks, extent=[0, 90, 28.0, 44.0], aspect="auto", cmap=cmap_ks, norm=ks_norm, origin="lower")
card_d.add_patch(Rectangle((0, 28.0), 90, 16.0, fill=False, edgecolor="#7f8c8d", lw=0.6))
for val, px in [(0, 0), (10, 22.5), (20, 45), (30, 67.5), (40, 90)]:
    card_d.plot([px, px], [28.0, 22.0], color="#2c3e50", lw=0.5)
    card_d.text(px, 14.0, str(val), ha="center", va="top", fontsize=5.8, color="#2c3e50")


# Save to Scratch Directory First
scratch_fig3_png = SCRATCH_DIR / "Figure_3_Catchment_Physiography_and_Conditioning.png"
scratch_fig3_pdf = SCRATCH_DIR / "Figure_3_Catchment_Physiography_and_Conditioning.pdf"

print("Saving figure to scratch directory...")
fig.savefig(scratch_fig3_png, dpi=300, bbox_inches="tight")
fig.savefig(scratch_fig3_pdf, dpi=300, bbox_inches="tight")
plt.close(fig)

# Copy Safely to Publication Directory
FIG_DIR.mkdir(parents=True, exist_ok=True)
pub_fig3_png = FIG_DIR / "Figure_3_Catchment_Physiography_and_Conditioning.png"
pub_fig3_pdf = FIG_DIR / "Figure_3_Catchment_Physiography_and_Conditioning.pdf"

shutil.copy2(scratch_fig3_png, pub_fig3_png)
shutil.copy2(scratch_fig3_pdf, pub_fig3_pdf)

if ARTIFACT_DIR.exists():
    shutil.copy2(scratch_fig3_png, ARTIFACT_DIR / "Figure_3_Catchment_Physiography_and_Conditioning.png")
    shutil.copy2(scratch_fig3_pdf, ARTIFACT_DIR / "Figure_3_Catchment_Physiography_and_Conditioning.pdf")

print(f"\n[OK] Successfully generated publication Figure 3:")
print(f"  PNG: {pub_fig3_png}")
print(f"  PDF: {pub_fig3_pdf}")
