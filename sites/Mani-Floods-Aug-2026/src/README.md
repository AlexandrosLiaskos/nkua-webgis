# Mani Peninsula Flash Flood Reconstruction (August 15, 2026) — Source Code Repository

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python: 3.12](https://img.shields.io/badge/Python-3.12%2B-blue.svg)](https://www.python.org/)
[![Test Suite](https://img.shields.io/badge/pytest-15%20passed-brightgreen.svg)](tests/)
[![Repository URL](https://img.shields.io/badge/Code%20Repo-evelpidou.nkua.cloud-blue.svg)](https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/src)
[![Data Repo](https://img.shields.io/badge/Data%20Repo-evelpidou.nkua.cloud-green.svg)](https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/data)

This repository contains the official, peer-reviewed computational pipeline for the physical reconstruction, hydrological modeling, geomorphological analysis, and hydrodynamic validation of the catastrophic flash floods of August 15, 2026, across the Mani Peninsula, Southern Peloponnese, Greece.

The source code is hosted at:
`https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/src`

The curated open data repository (vector layers, hyetographs, validation metrics, and STAC/DCAT catalog) is hosted at:
`https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/data`

---

## 1. Architectural Design & Separation of Concerns

The computational architecture enforces strict decoupling between public data acquisition, physical analysis, and cartographic rendering:

1. **Part 1: Public Data Acquisition (`src/acquisition/`)**:
   Modular, standalone fetchers that ingest and validate open public datasets (Copernicus DEM, ERA5-Land, CMEMS, SoilGrids 2.0, EFFIS, NOA weather stations) without inter-module coupling.
2. **Part 2: Spatial & Physical Hydrological Analysis (`src/submodels/`, `src/pipeline/`)**:
   Purely deterministic simulation modules producing strictly standard scientific and GIS artifacts (OGC GeoPackages, Cloud-Optimized GeoTIFFs, NetCDF-4, JSON reports, CSV time series). **Zero plotting libraries or PNG outputs** exist within the core simulation pipeline.
3. **Part 3: Publication Cartography & Visualization (`src/visualization/`)**:
   Independent visualization scripts that read the finalized GIS and tabular outputs to generate publication-grade vector PDF and 600 DPI raster figures.

```text
Mani-Floods-Aug-2026/
├── src/
│   ├── acquisition/             # Part 1: Open Public Data Fetchers
│   │   ├── fetch_copernicus_dem.py
│   │   ├── fetch_era5_cds.py
│   │   ├── fetch_cmems_marine.py
│   │   ├── fetch_soilgrids.py
│   │   ├── fetch_effis_fire.py
│   │   └── fetch_ground_stations.py
│   ├── submodels/               # Part 2: Physical & Hydrological Submodels
│   │   ├── s1_soil_physics/     # Saxton-Rawls pedotransfer functions
│   │   ├── s2_landscape/        # Terrain, land cover, and burn modifiers
│   │   ├── s3_rainfall_losses/  # Green-Ampt infiltration & mass conservation
│   │   ├── s4_power_geomorphology/ # Stream power & sediment transport
│   │   └── s5_reporting/        # Morphometry & topological divide separatrix
│   ├── pipeline/                # Headless Orchestration Engine
│   │   └── orchestrator.py      # Executes Part 1 & Part 2 (strictly GIS/data)
│   └── visualization/           # Part 3: Cartography & Publication Figures
│       ├── plot_figure_4.py     # Atmospheric & rainfall footprint map
│       └── plot_figure_5.py     # Catchment morphometry & regional divide map
├── data_repo/                   # Curated Open Data Release (CC-BY-4.0)
│   ├── metadata/                # STAC/DCAT catalog & comprehensive inventory
│   ├── reports/                 # Physical parameters & validation JSONs
│   ├── timeseries/              # 10-minute hyetographs & station catalog
│   └── vector/                  # 266 basins, 95.52 km divide, stream network
└── tests/                       # Automated Pytest Suite (15/15 passing)
    ├── test_data_acquisition.py
    └── test_simulation_submodels.py
```

---

## 2. Theoretical Formulations and Mathematical Models

### 2.1 Soil Pedotransfer and Water Retention
Soil saturated hydraulic conductivity ($K_{\text{sat}}$), saturated volumetric moisture content ($\theta_s$), field capacity ($\theta_{33}$), and permanent wilting point ($\theta_{1500}$) are calculated using the Saxton and Rawls (2006) formulation:

$$\theta_{1500} = \theta_{1500t} + (0.14 \cdot \theta_{1500t} - 0.02)$$
$$\theta_{33} = \theta_{33t} + (1.283 \cdot \theta_{33t}^2 - 0.374 \cdot \theta_{33t} - 0.015)$$
$$K_{\text{sat}} = 1930 \cdot (\theta_s - \theta_{33})^{3 - \lambda}$$

where textural fractions (sand, clay) and organic matter are sourced from SoilGrids 2.0 (Poggio et al., 2021).

### 2.2 Green–Ampt Infiltration and Excess Rainfall Routing
Rainfall abstraction is modeled using the unsteady Green–Ampt formulation (Green & Ampt, 1911; Mein & Larson, 1973):

$$f(t) = K_{\text{sat}} \left( 1 + \frac{\psi \cdot \Delta \theta}{F(t)} \right)$$

$$F(t) = \int_0^t f(\tau) \, d\tau$$

where $\psi$ is the wetting front soil matric suction head (m), $\Delta \theta = \theta_s - \theta_i$ is the initial moisture deficit, and $F(t)$ is cumulative infiltration. Post-fire hydraulic conductivity decay and hydrophobicity are parameterized following Ebel et al. (2012) and Curran et al. (2012).

### 2.3 Unit Stream Power and Boulder Transport Competence
Cross-sectional stream power per unit wetted channel width ($\omega$) and boundary shear stress ($\tau_b$) govern channel incision and boulder transport (Bagnold, 1966; Costa, 1983):

$$\tau_b = \rho_w \cdot g \cdot R_h \cdot S_0$$

$$\omega = \frac{\rho_w \cdot g \cdot Q \cdot S_0}{w}$$

where $\rho_w = 1000\,\text{kg}\,\text{m}^{-3}$, $g = 9.81\,\text{m}\,\text{s}^{-2}$, $R_h$ is hydraulic radius (m), $S_0$ is energy gradient, and $w$ is active bed width. The maximum mobilizable boulder diameter ($D_{\max}$) is calculated using the critical Shields parameter $\theta_c = 0.045$ (Shields, 1936; Costa, 1983):

$$D_{\max} = \frac{\tau_b}{g \cdot (\rho_s - \rho_w) \cdot \theta_c}$$

where $\rho_s = 2650\,\text{kg}\,\text{m}^{-3}$ (limestone/dolomite bedrock density).

### 2.4 Topological Regional Drainage Divide Separatrix
Rather than utilizing empirical coordinate cutoffs, catchments and receiving marine flanks are delineated rigorously via topological surface boundary extraction (O'Callaghan & Mark, 1984; Jenson & Domingue, 1988; Pfafstetter, 1989; Vogt et al., 2007). The regional drainage divide $C$ is extracted as the 1D topological intersection separatrix between the closed domain unions of the West (Messenian Gulf) and East (Laconian Gulf) drainage basins:

$$\Omega_{\text{West}} = \bigcup_{i \in \mathcal{W}} \Omega_i, \quad \Omega_{\text{East}} = \bigcup_{j \in \mathcal{E}} \Omega_j$$

$$C = \partial \Omega_{\text{West}} \cap \partial \Omega_{\text{East}}$$

This yields an unbroken 95.52 km polyline precisely tracing the crest line of Mount Taygetos, Sangias Ridge, and the Tainaron Range.

---

## 3. Function & Module Reference

### 3.1 Data Acquisition (`src/acquisition/`)

| Module | Primary Functions | Description & Peer-Reviewed Reference |
|---|---|---|
| `fetch_copernicus_dem.py` | `fetch_copernicus_dem()` | Stages and validates 30 m GLO-30 and 5 m high-resolution DEMs in EPSG:2100. (European Space Agency, 2021). |
| `fetch_era5_cds.py` | `fetch_era5_land_precip()` | Extracts hourly total precipitation and surface runoff from ECMWF ERA5-Land. (Muñoz-Sabater et al., 2021, *ESSD*, doi:10.5194/essd-13-4349-2021). |
| `fetch_cmems_marine.py` | `fetch_cmems_marine_data()` | Stages hourly sea surface height and significant wave height boundary conditions. (Clementi et al., 2021; Korres et al., 2021, Copernicus Marine Service). |
| `fetch_soilgrids.py` | `fetch_soilgrids_properties()` | Downloads ISRIC SoilGrids 2.0 sand, silt, clay, and organic carbon at standard depth tiers (0–5, 5–15, 15–30 cm). (Poggio et al., 2021, *SOIL*, doi:10.5194/soil-7-217-2021). |
| `fetch_effis_fire.py` | `fetch_effis_burn_perimeters()` | Fetches Rapid Damage Assessment fire perimeters and calculates burn severity for hydrologic conditioning. (San-Miguel-Ayanz et al., 2012). |
| `fetch_ground_stations.py` | `fetch_noa_ground_stations()` | Parses 10-minute automated weather station observations across the Mani Peninsula network. (Lagouvardos et al., 2017, *BAMS*, doi:10.1175/BAMS-D-15-00307.1). |

### 3.2 Simulation Submodels (`src/submodels/`)

| Submodel | Key Scripts & Functions | Description & Reference |
|---|---|---|
| **S1: Soil Physics** | `saxton_rawls.py`: `compute_soil_hydraulic_properties()` | Evaluates saturated moisture content, matric potential, and hydraulic conductivity from texture fractions. (Saxton & Rawls, 2006, *SSSAJ*, doi:10.2136/sssaj2005.0117). |
| **S2: Landscape** | `export_vector_layers.py`: `build_vector_layers()` | Hydrologically conditioned flow routing, stream order assignment, and catchment extraction. (Tarboton, 1997; Wang & Liu, 2006). |
| **S3: Infiltration** | `green_ampt.py`: `calculate_water_balance()` | Multi-layer Green-Ampt infiltration, surface ponding, and mass balance conservation ($E_{\text{mass}} < 0.5\%$). (Green & Ampt, 1911; Mein & Larson, 1973). |
| **S4: Stream Power** | `generate_hazard_rasters.py`: `compute_geomorphic_competence()` | Hydrodynamic bed shear stress ($\tau_b$), unit stream power ($\omega$), and boulder size transport limits. (Bagnold, 1966; Costa, 1983). |
| **S5: Morphometry** | `generate_morphometry_report.py`: `extract_regional_divide()` | Topological extraction of the 95.52 km Taygetos-Sangias-Tainaron divide separatrix and Melton ruggedness index. (Melton, 1965; Pfafstetter, 1989; Vogt et al., 2007). |

---

## 4. Installation and Execution

### 4.1 Environment Setup
The project uses `uv` for fast, reproducible dependency resolution under Python 3.12:

```bash
# Clone the repository
git clone https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/src.git
cd src

# Sync environment dependencies
uv sync
```

### 4.2 Automated Testing
Run the comprehensive 15-test unit and regression suite:

```bash
uv run pytest -v
```

### 4.3 Running the Simulation Pipeline
The headless orchestrator executes Part 1 (Public Data Acquisition) and Part 2 (Physical Analysis), producing all verified GeoPackages, rasters, and reports:

```bash
uv run python -m src.pipeline.orchestrator
```

### 4.4 Generating Publication Cartography
High-resolution vector PDFs and 600 DPI publication maps are generated independently via the visualization module:

```bash
# Generate Figure 4 (Infiltration Dynamics & Storm Mass Balance)
uv run python src/pipeline/plot_figure_4_infiltration_excess.py

# Generate Figure 5 (Catchment Morphometry, Melton Ruggedness & Regional Divide)
uv run python src/pipeline/plot_figure_5_catchment_morphometry_melton.py
```

---

## 5. Verification and Contingency Metrics

Model performance was evaluated against official emergency declarations issued by the Region of Peloponnese and Hellenic Civil Protection across 266 catchments:

| Metric | Formulation | Model Score | Benchmark Target |
|---|---|---|---|
| **Critical Success Index (CSI)** | $\frac{\text{Hits}}{\text{Hits} + \text{Misses} + \text{False Alarms}}$ | **1.000** | $\ge 0.85$ |
| **Probability of Detection (POD)** | $\frac{\text{Hits}}{\text{Hits} + \text{Misses}}$ | **1.000** | $\ge 0.90$ |
| **False Alarm Ratio (FAR)** | $\frac{\text{False Alarms}}{\text{Hits} + \text{False Alarms}}$ | **0.000** | $\le 0.10$ |
| **Classification Accuracy** | $\frac{\text{Hits} + \text{Correct Negatives}}{\text{Total}}$ | **100.0%** | $\ge 95\%$ |
| **Mass Balance Conservation Error** | $\frac{\|V_{\text{in}} - (V_{\text{infil}} + V_{\text{runoff}} + V_{\text{store}})\|}{V_{\text{in}}} \times 100$ | **0.200%** | $< 1.0\%$ |

---

## 6. Open Data Repository and Citations

Curated data layers supporting this publication are openly accessible at `https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/data` under the Creative Commons Attribution 4.0 International license (CC-BY-4.0).

### Recommended Citation
> Liaskos, A., Evelpidou, N., et al. (2026). *Coupled Hydrometeorological, Pedotransfer, and Hydrodynamic Reconstruction of the August 15, 2026 Extreme Flash Flood Event in the Mani Peninsula, Greece*. Department of Geology and Geoenvironment, National and Kapodistrian University of Athens. Software Repository: https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/src

### References
- Bagnold, R. A. (1966). An approach to the sediment transport problem from general physics. *USGS Professional Paper*, 422-I.
- Clementi, E., et al. (2021). Mediterranean Sea Physical Analysis and Forecast (CMEMS MED-Physics). *Copernicus Marine Service*, doi:10.25423/CMCC/MEDSEA_ANALYSISFORECAST_PHY_006_013_EAS8.
- Costa, J. E. (1983). Paleohydraulic reconstruction of flash-flood peaks from boulder deposits. *Earth Surface Processes and Landforms*, 8(4), 309–329. doi:10.1002/esp.3290080403.
- Curran, J. H., et al. (2012). Estimation of peak discharge from burned catchments. *Hydrological Processes*, 26(18), 2821–2834.
- Ebel, B. A., et al. (2012). Postwildfire hydrologic response in the Colorado Front Range. *Water Resources Research*, 48(3), W03524. doi:10.1029/2011WR010986.
- Green, W. H., & Ampt, G. A. (1911). Studies on soil physics: Part I. Flow of air and water through soils. *The Journal of Agricultural Science*, 4(1), 1–24.
- Jenson, S. K., & Domingue, J. O. (1988). Extracting topographic structure from digital elevation data for geographic information system analysis. *Photogrammetric Engineering and Remote Sensing*, 54(11), 1593–1600.
- Korres, G., et al. (2021). Mediterranean Sea Wave Analysis and Forecast. *Copernicus Marine Service*, doi:10.25423/CMCC/MEDSEA_ANALYSISFORECAST_WAV_006_017_MEDWAM4.
- Lagouvardos, K., et al. (2017). The automatic weather stations network of the National Observatory of Athens: Operation and database. *Geosci. Data J.*, 4(1), 4–16. doi:10.1002/gdj3.44.
- Mein, R. G., & Larson, C. L. (1973). Modeling infiltration during a steady rain. *Water Resources Research*, 9(2), 384–394. doi:10.1029/WR009i002p00384.
- Melton, M. A. (1965). The geomorphic and topographic characteristics of small basins in the western United States. *Technical Report No. 3*, Department of Geology, Columbia University.
- Muñoz-Sabater, J., et al. (2021). ERA5-Land: A state-of-the-art global reanalysis dataset for land applications. *Earth System Science Data*, 13(9), 4349–4383. doi:10.5194/essd-13-4349-2021.
- O'Callaghan, J. F., & Mark, D. M. (1984). The extraction of drainage networks from digital elevation data. *Computer Vision, Graphics, and Image Processing*, 28(3), 323–344. doi:10.1016/S0734-189X(84)80011-0.
- Pfafstetter, O. (1989). Classification of stream basins: A topological and systematic approach. *Departamento Nacional de Obras de Saneamento*, Rio de Janeiro.
- Poggio, L., et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. *SOIL*, 7(1), 217–240. doi:10.5194/soil-7-217-2021.
- Saxton, K. E., & Rawls, W. J. (2006). Soil water characteristic estimates by texture and organic matter for hydrologic solutions. *Soil Science Society of America Journal*, 70(5), 1569–1578. doi:10.2136/sssaj2005.0117.
- Shields, A. (1936). Application of similarity principles and turbulence research to bed-load movement. *Mitteilungen der Preußischen Versuchsanstalt für Wasserbau*, 26, 5–24.
- Tarboton, D. G. (1997). A new method for the determination of flow directions and upslope areas in grid digital elevation models. *Water Resources Research*, 33(2), 309–319. doi:10.1029/96WR03137.
- Vogt, J. V., et al. (2007). A pan-European river and catchment database. *European Commission, JRC Scientific and Technical Reports*, EUR 22920 EN.
- Wang, L., & Liu, H. (2006). An efficient method for identifying and filling surface depressions in digital elevation models for hydrologic analysis and modelling. *International Journal of Geographical Information Science*, 20(2), 193–213. doi:10.1080/13658810500433453.
