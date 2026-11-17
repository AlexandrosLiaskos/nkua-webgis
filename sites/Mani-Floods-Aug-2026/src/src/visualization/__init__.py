"""Scientific Publication Visualization and Cartography Package.

This package contains isolated plotting and cartographic modules for rendering
publication-grade vector PDF and 300 DPI PNG figures:
- plot_figure_1_synoptic: Synoptic hydrometeorology, hyetographs, and coastal stage.
- plot_figure_2_physiography: Topography, lithology, and hydrographic network.
- plot_figure_4_infiltration_excess: Infiltration dynamics, soil physics, and water balance.
- plot_figure_5_catchment_morphometry_melton: Catchment morphometry, Melton screening, and regional divide.

Note:
    All plotting code is strictly decoupled from the core numerical simulation pipeline.
    The simulation engine executes autonomously without any graphical dependencies.
"""

from src.pipeline.plot_figure_4_infiltration_excess import (
    plot_figure_4_complete_hydrology as plot_figure_4,
)
from src.pipeline.plot_figure_5_catchment_morphometry_melton import (
    plot_figure_5_catchment_morphometry_melton as plot_figure_5,
)

__all__ = [
    "plot_figure_4",
    "plot_figure_5",
]
