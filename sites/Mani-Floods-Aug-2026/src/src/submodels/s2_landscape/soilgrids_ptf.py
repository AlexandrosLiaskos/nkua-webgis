"""Pedotransfer Functions (PTF) and Soil Hydraulic Parameterization.

Converts SoilGrids 2.0 physical properties (sand, silt, clay, bulk density,
soil organic carbon) across 6 depth intervals into physically based Green-Ampt
parameters:
- Saturated hydraulic conductivity (Ks) [mm/hr and m/s]
- Saturated water content / Porosity (theta_s) [m^3/m^3]
- Residual water content (theta_r) [m^3/m^3]
- Wetting front suction head (psi_f) [m]
- Pore size distribution index (lambda or b)

Includes post-fire hydrophobicity scaling and karstic carbonate loss rates.
"""

from dataclasses import dataclass
from typing import Dict, Tuple
import numpy as np


@dataclass
class SoilHydraulicParameters:
    """Hydraulic parameters for Green-Ampt infiltration."""
    ks_mm_h: float          # Saturated hydraulic conductivity in mm/hr
    ks_m_s: float           # Saturated hydraulic conductivity in m/s
    theta_s: float          # Saturated volumetric water content (m^3/m^3)
    theta_r: float          # Residual volumetric water content (m^3/m^3)
    psi_f_m: float          # Wetting front suction head in meters
    b_exponent: float       # Campbell / Cosby pore-size index
    air_entry_head_m: float # Bubbling pressure head in meters


def saxton_rawls_ptf(
    sand_pct: float,
    clay_pct: float,
    soc_pct: float = 1.0,
    bulk_density_g_cm3: float = 1.35,
    gravel_vol_pct: float = 0.0
) -> SoilHydraulicParameters:
    """Calculate soil hydraulic parameters using Saxton & Rawls (2006) formulation.
    
    Args:
        sand_pct: Sand content in percent (0 - 100)
        clay_pct: Clay content in percent (0 - 100)
        soc_pct: Soil organic carbon in percent (typically 0.5 - 5%)
        bulk_density_g_cm3: Bulk density in g/cm^3
        gravel_vol_pct: Coarse fragments volume fraction (0 - 100)
        
    Returns:
        SoilHydraulicParameters instance.
    """
    s = np.clip(sand_pct, 1.0, 95.0) / 100.0
    c = np.clip(clay_pct, 1.0, 85.0) / 100.0
    om = np.clip(soc_pct * 1.724, 0.1, 10.0) # SOM ≈ 1.724 * SOC

    # Permanent wilting point (1500 kPa)
    theta_1500t = -0.024 * s + 0.487 * c + 0.006 * om + 0.005 * (s * om) - 0.013 * (c * om) + 0.068 * (s * c) + 0.031
    theta_1500 = theta_1500t + (0.14 * theta_1500t - 0.02)

    # Field capacity (33 kPa)
    theta_33t = -0.251 * s + 0.195 * c + 0.011 * om + 0.006 * (s * om) - 0.027 * (c * om) + 0.452 * (s * c) + 0.299
    theta_33 = theta_33t + (1.283 * (theta_33t ** 2) - 0.374 * theta_33t - 0.015)

    # Saturated moisture content (0 kPa) based on normal compaction
    theta_st = 0.278 * s + 0.034 * c + 0.022 * om - 0.018 * (s * om) - 0.027 * (c * om) - 0.584 * (s * c) + 0.078
    theta_s_norm = theta_33 + theta_st - 0.097 * s + 0.043

    # Porosity / saturated moisture content from bulk density
    porosity_actual = 1.0 - (bulk_density_g_cm3 / 2.65)
    theta_s = float(np.clip(porosity_actual, 0.30, 0.60))

    # Cosby et al. (1984) air-entry bubbling pressure head (psi_b in cm -> convert to m)
    # log10(psi_b_cm) = 2.17 - 0.0063 * sand_pct - 0.0158 * clay_pct
    log_psi_b_cm = 2.17 - 0.0063 * sand_pct - 0.0158 * clay_pct
    psi_b_cm = float(10.0 ** np.clip(log_psi_b_cm, 0.5, 3.0))
    air_entry_m = psi_b_cm / 100.0  # Convert cm to meters (typically 0.10 - 0.60 m)

    # Campbell / Cosby pore size distribution index b
    # b = 3.10 + 0.157 * clay_pct - 0.003 * sand_pct
    b_val = float(np.clip(3.10 + 0.157 * clay_pct - 0.003 * sand_pct, 2.0, 20.0))

    # Wetting front suction head (Rawls & Brakensiek 1983 relation to air-entry head and b)
    # psi_f = ((2b + 3) / (2b + 6)) * psi_b
    psi_f_m = float(((2.0 * b_val + 3.0) / (2.0 * b_val + 6.0)) * air_entry_m)

    # Cosby (1984) saturated hydraulic conductivity (Ks in mm/hr)
    # log10(Ks_in_hr) = -0.60 + 0.0126 * sand_pct - 0.0064 * clay_pct
    log_ks_in_hr = -0.60 + 0.0126 * sand_pct - 0.0064 * clay_pct
    ks_mm_h = float(25.4 * (10.0 ** np.clip(log_ks_in_hr, -2.5, 2.0)))

    # Coarse fragments adjustment (gravel reduces effective conductive cross-section)
    if gravel_vol_pct > 0:
        gravel_frac = float(np.clip(gravel_vol_pct / 100.0, 0.0, 0.8))
        ks_mm_h = ks_mm_h * (1.0 - gravel_frac)

    ks_mm_h = max(0.1, ks_mm_h)
    ks_m_s = (ks_mm_h / 1000.0) / 3600.0

    return SoilHydraulicParameters(
        ks_mm_h=float(ks_mm_h),
        ks_m_s=float(ks_m_s),
        theta_s=float(theta_s),
        theta_r=float(theta_1500 * 0.5), # Approx residual moisture
        psi_f_m=float(psi_f_m),
        b_exponent=float(b_val),
        air_entry_head_m=float(air_entry_m)
    )


def apply_landscape_modifiers(
    params: SoilHydraulicParameters,
    burn_severity_dnbr: float = 0.0,
    is_karst_limestone: bool = False,
    karst_percolation_mm_h: float = 12.0
) -> SoilHydraulicParameters:
    """Modify soil hydraulic parameters for wildfire burn scars and karst geology.
    
    Args:
        params: Baseline soil hydraulic parameters
        burn_severity_dnbr: differenced Normalized Burn Ratio (>= 270 is moderate/high burn)
        is_karst_limestone: True if located on fractured carbonate bedrock
        karst_percolation_mm_h: Additional transmission loss rate into epikarst
        
    Returns:
        Adjusted SoilHydraulicParameters.
    """
    ks_mod = params.ks_mm_h

    # Wildfire hydrophobicity: high burn reduces Ks by 60-85%
    if burn_severity_dnbr >= 270.0:
        burn_factor = np.interp(burn_severity_dnbr, [270.0, 660.0], [0.40, 0.15])
        ks_mod *= burn_factor

    # Karst transmission: carbonate fractures convey additional water to deep aquifer
    if is_karst_limestone:
        ks_mod += karst_percolation_mm_h

    ks_m_s = (ks_mod / 1000.0) / 3600.0

    return SoilHydraulicParameters(
        ks_mm_h=float(ks_mod),
        ks_m_s=float(ks_m_s),
        theta_s=params.theta_s,
        theta_r=params.theta_r,
        psi_f_m=params.psi_f_m,
        b_exponent=params.b_exponent,
        air_entry_head_m=params.air_entry_head_m
    )
