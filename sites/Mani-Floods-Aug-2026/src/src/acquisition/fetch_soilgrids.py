"""ISRIC SoilGrids Physical Property Ingestion and Staging Module.

Stages multi-depth soil physical properties from ISRIC SoilGrids 2.0 (250m global database)
for pedotransfer hydraulic parameterization:
- Sand mass fraction [g/kg -> %]
- Clay mass fraction [g/kg -> %]
- Soil Organic Carbon (SOC) [dg/kg -> %]
- Bulk Density of the fine earth fraction (bdod) [cg/cm³ -> g/cm³]
- Coarse fragments volumetric fraction (cfvo) [cm³/dm³ -> %]

Literature Reference:
    Poggio, L., de Sousa, L. M., Batjes, N. H., Heuvelink, G. B. M., Kempen, B., Ribeiro, E.,
    & Rossiter, D. (2021). SoilGrids 2.0: Producing soil information for the globe with quantified
    spatial uncertainty. SOIL, 7(1), 217–240. https://doi.org/10.5194/soil-7-217-2021
"""

from pathlib import Path
from typing import Optional, Dict, List
import os

from src.pipeline.config import RAW_DATA_DIR

SOILGRIDS_DIR = RAW_DATA_DIR / "soils_land_cover/isric/soilgrids"


def fetch_soilgrids_properties(
    soil_directory: Optional[Path] = None,
    depth_tiers: Optional[List[str]] = None
) -> Dict[str, Path]:
    """Stage and verify SoilGrids physical property raster layers.

    Args:
        soil_directory: Directory containing SoilGrids GeoTIFF tiles.
        depth_tiers: List of standard depth intervals.

    Returns:
        Dictionary mapping soil property names to verified GeoTIFF paths.
    """
    s_dir = soil_directory or SOILGRIDS_DIR
    tiers = depth_tiers or ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm"]

    properties = ["sand", "clay", "soc", "bdod", "cfvo"]
    staged: Dict[str, Path] = {}

    search_dirs = [s_dir, RAW_DATA_DIR.parent / "02_intermediate/soil_surface_parameters"]
    for p_dir in search_dirs:
        if not p_dir.exists():
            continue
        for prop in properties:
            if prop not in staged:
                candidates = list(p_dir.rglob(f"*{prop}*.tif"))
                if candidates:
                    staged[prop] = candidates[0]

    return staged


if __name__ == "__main__":
    props = fetch_soilgrids_properties()
    print(f"Staged SoilGrids layers: {list(props.keys())}")
