"""Water Mass Balance Auditing and Hydrological Validation Metrics.

Ensures rigorous mass conservation across all submodels:
- Rain volume = Infiltration + Surface Storage + Marine Outflow + Continuity Error
- Validates goodness-of-fit (NSE, KGE, PBIAS) against gauge/stage records
- Computes Critical Success Index (CSI) and Hit Rate against damage inspections
"""

from dataclasses import dataclass
from typing import Dict, Tuple, Union
import numpy as np


@dataclass
class MassBalanceAudit:
    """Continuity and water volume conservation audit."""
    total_rain_volume_m3: float
    total_infiltrated_volume_m3: float
    total_surface_storage_m3: float
    total_marine_outflow_m3: float
    volume_discrepancy_m3: float
    relative_continuity_error_pct: float
    is_conservation_acceptable: bool


def audit_water_mass_balance(
    rain_vol_m3: float,
    infil_vol_m3: float,
    surface_vol_m3: float,
    marine_outflow_m3: float,
    max_acceptable_error_pct: float = 0.5
) -> MassBalanceAudit:
    """Audit water balance continuity across the modeling domain.
    
    Args:
        rain_vol_m3: Total gross rainfall volume entered the domain (m^3).
        infil_vol_m3: Total volume infiltrated into subsurface/soil/karst (m^3).
        surface_vol_m3: Total water volume stored on 2D terrain grid (m^3).
        marine_outflow_m3: Total water volume discharged into sea boundaries (m^3).
        max_acceptable_error_pct: Target maximum continuity error threshold (%).
        
    Returns:
        MassBalanceAudit record.
    """
    total_accounted = infil_vol_m3 + surface_vol_m3 + marine_outflow_m3
    discrepancy = rain_vol_m3 - total_accounted
    rel_error = (abs(discrepancy) / max(1.0, rain_vol_m3)) * 100.0

    return MassBalanceAudit(
        total_rain_volume_m3=float(rain_vol_m3),
        total_infiltrated_volume_m3=float(infil_vol_m3),
        total_surface_storage_m3=float(surface_vol_m3),
        total_marine_outflow_m3=float(marine_outflow_m3),
        volume_discrepancy_m3=float(discrepancy),
        relative_continuity_error_pct=float(rel_error),
        is_conservation_acceptable=bool(rel_error <= max_acceptable_error_pct)
    )


def compute_hydrologic_fit_metrics(
    obs: np.ndarray,
    sim: np.ndarray
) -> Dict[str, Union[float, str]]:
    """Compute standard hydrologic goodness-of-fit metrics (NSE, KGE, PBIAS, RMSE).
    
    Args:
        obs: Observed stage or discharge array.
        sim: Simulated stage or discharge array.
        
    Returns:
        Dictionary with NSE, KGE, PBIAS_pct, RMSE, and Rating string.
    """
    mask = ~np.isnan(obs) & ~np.isnan(sim)
    o, s = obs[mask], sim[mask]

    if len(o) < 3:
        return {"NSE": np.nan, "KGE": np.nan, "PBIAS_%": np.nan, "RMSE": np.nan, "Rating": "Insufficient Data"}

    mean_o = float(np.mean(o))
    mean_s = float(np.mean(s))
    std_o = float(np.std(o))
    std_s = float(np.std(s))

    # Nash-Sutcliffe Efficiency (NSE)
    denom_nse = np.sum((o - mean_o) ** 2)
    nse = 1.0 - (np.sum((o - s) ** 2) / (denom_nse + 1e-9))

    # Kling-Gupta Efficiency (KGE)
    r = np.corrcoef(o, s)[0, 1] if std_o > 0 and std_s > 0 else 0.0
    alpha = std_s / (std_o + 1e-9)
    beta = mean_s / (mean_o + 1e-9)
    kge = 1.0 - np.sqrt((r - 1.0)**2 + (alpha - 1.0)**2 + (beta - 1.0)**2)

    # Percent Bias (PBIAS)
    pbias = 100.0 * (np.sum(o - s) / (np.sum(o) + 1e-9))

    # Root Mean Square Error (RMSE)
    rmse = np.sqrt(np.mean((o - s) ** 2))

    if nse > 0.75 and abs(pbias) < 10.0:
        rating = "Very Good"
    elif nse > 0.65 and abs(pbias) < 15.0:
        rating = "Good"
    elif nse > 0.50 and abs(pbias) < 25.0:
        rating = "Satisfactory"
    else:
        rating = "Unsatisfactory"

    return {
        "NSE": float(nse),
        "KGE": float(kge),
        "PBIAS_%": float(pbias),
        "RMSE": float(rmse),
        "Rating": rating
    }


def compute_spatial_hit_metrics(
    observed_mask: np.ndarray,
    simulated_mask: np.ndarray
) -> Dict[str, float]:
    """Compute spatial contingency metrics (Hit Rate, False Alarm, Critical Success Index).
    
    Args:
        observed_mask: Boolean array of verified flooded/damage locations.
        simulated_mask: Boolean array of simulated flooded/hazard locations.
        
    Returns:
        Dictionary with CSI (Threat Score), Hit Rate, False Alarm Rate.
    """
    obs = observed_mask.astype(bool)
    sim = simulated_mask.astype(bool)

    hits = np.sum(obs & sim)
    misses = np.sum(obs & (~sim))
    false_alarms = np.sum((~obs) & sim)

    # Critical Success Index (CSI) / Threat Score
    denom_csi = hits + misses + false_alarms
    csi = float(hits / denom_csi) if denom_csi > 0 else 0.0

    # Hit Rate (Probability of Detection)
    hit_rate = float(hits / (hits + misses)) if (hits + misses) > 0 else 0.0

    # False Alarm Ratio
    far = float(false_alarms / (hits + false_alarms)) if (hits + false_alarms) > 0 else 0.0

    return {
        "Critical_Success_Index": csi,
        "Hit_Rate": hit_rate,
        "False_Alarm_Ratio": far,
        "Hits": int(hits),
        "Misses": int(misses),
        "False_Alarms": int(false_alarms)
    }

