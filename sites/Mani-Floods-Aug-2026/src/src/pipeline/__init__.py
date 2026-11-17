"""Pipeline package for simulation orchestration and configuration."""
from src.pipeline.config import (
    WORKSPACE_ROOT,
    RAW_DATA_DIR,
    INTERMEDIATE_DATA_DIR,
    PROCESSED_DATA_DIR,
    OUTPUTS_DIR,
    CRS_EPSG,
    DOMAIN_BBOX_EPSG2100,
)

__all__ = [
    "WORKSPACE_ROOT",
    "RAW_DATA_DIR",
    "INTERMEDIATE_DATA_DIR",
    "PROCESSED_DATA_DIR",
    "OUTPUTS_DIR",
    "CRS_EPSG",
    "DOMAIN_BBOX_EPSG2100",
]

