"""National Observatory of Athens (NOA) Weather Station Acquisition Module.

Stages automated weather station (AWS) surface precipitation records, hyetographs,
and metadata for the Peloponnese network during the August 14-17, 2026 convective deluge.

Literature Reference:
    Lagouvardos, K., Kotroni, V., Bezes, A., Iglessi, I., Kalimeris, A., & Galanaki, E. (2017).
    The automatic weather stations network of the National Observatory of Athens: Operation and database.
    Atmospheric Research, 185, 99–105. https://doi.org/10.1016/j.atmosres.2016.11.002
"""

from pathlib import Path
from typing import Optional, Dict
import pandas as pd

from src.pipeline.config import PROCESSED_DATA_DIR

STATION_CSV = PROCESSED_DATA_DIR / "rainfall/ground_stations_august2026.csv"
HYETO_CSV = PROCESSED_DATA_DIR / "rainfall/ground_station_hyetographs_10min.csv"


def fetch_noa_ground_stations(
    station_catalog_path: Optional[Path] = None,
    hyetograph_path: Optional[Path] = None
) -> Dict[str, pd.DataFrame]:
    """Load and validate NOA automated ground station records.

    Args:
        station_catalog_path: Path to station coordinates and storm totals CSV.
        hyetograph_path: Path to 10-minute hyetograph time series CSV.

    Returns:
        Dictionary containing 'catalog' and 'hyetographs' DataFrames.
    """
    cat_file = station_catalog_path or STATION_CSV
    hye_file = hyetograph_path or HYETO_CSV

    if not cat_file.exists():
        raise FileNotFoundError(f"Station catalog not found at: {cat_file}")
    if not hye_file.exists():
        raise FileNotFoundError(f"Hyetograph series not found at: {hye_file}")

    df_catalog = pd.read_csv(cat_file)
    df_hyeto = pd.read_csv(hye_file)

    return {
        "catalog": df_catalog,
        "hyetographs": df_hyeto
    }


if __name__ == "__main__":
    stations = fetch_noa_ground_stations()
    print(f"Loaded {len(stations['catalog'])} ground stations.")
    print(f"Loaded {len(stations['hyetographs'])} ten-minute hyetograph records.")
