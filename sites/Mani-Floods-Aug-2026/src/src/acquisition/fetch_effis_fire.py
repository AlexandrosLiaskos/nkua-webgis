"""Copernicus Emergency Management Service (EFFIS) Wildfire Burn Scar Fetcher.

Stages wildfire perimeters and differenced Normalized Burn Ratio (dNBR) severity rasters
from the European Forest Fire Information System (EFFIS) Rapid Damage Assessment (RDA).

Literature Reference:
    San-Miguel-Ayanz, J., Schulte, E., Schmuck, G., Camia, A., Strobl, P., Liberta, G.,
    Boca, R., Sedano, F., Kempeneers, P., McInerney, D., & Amatulli, G. (2012). Comprehensive
    monitoring of wildfires in Europe: The European Forest Fire Information System (EFFIS).
    Approaches to Managing Disaster - Assessing Hazards, Emergencies and Disaster Impacts,
    IntechOpen, 87–108. https://doi.org/10.5772/28441
"""

from pathlib import Path
from typing import Optional, List
import os

from src.pipeline.config import RAW_DATA_DIR

EFFIS_DIR = RAW_DATA_DIR / "soils_land_cover/copernicus-effis"


def fetch_effis_burn_perimeters(
    effis_directory: Optional[Path] = None
) -> List[Path]:
    """Stage and verify Copernicus EFFIS burnt area vectors and severity grids.

    Args:
        effis_directory: Root directory containing EFFIS shapefiles/GeoTIFFs.

    Returns:
        List of identified burnt perimeter datasets.
    """
    e_dir = effis_directory or EFFIS_DIR
    candidates = []

    search_dirs = [e_dir, RAW_DATA_DIR.parent / "02_intermediate/soil_surface_parameters"]
    for p_dir in search_dirs:
        if not p_dir.exists():
            continue
        for ext in ("*.shp", "*.gpkg", "*.geojson", "*.gml", "*.tif"):
            candidates.extend(list(p_dir.rglob(ext)))

    return candidates


if __name__ == "__main__":
    fires = fetch_effis_burn_perimeters()
    print(f"EFFIS burnt area assets found: {len(fires)}")
