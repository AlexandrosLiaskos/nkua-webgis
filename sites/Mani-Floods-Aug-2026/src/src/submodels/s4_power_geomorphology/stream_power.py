"""Hydrodynamic Power, Bed Shear Stress, and Geomorphic Mechanics Engine.

Computes 2D spatial fields and localized metrics for:
- Unit stream power (omega) [W/m^2]
- Total stream power (Omega) [W/m]
- Bed shear stress (tau_b) [Pa or N/m^2]
- Flow kinematics: velocity magnitude, direction angle, and Froude number (Fr)
- Shields dimensionless stress and maximum mobile grain/boulder diameter (D_max)
- Hydrodynamic impact thrust on structures (F_i) [kN/m]
- DEFRA Flood Hazard Rating (HR)
"""

from dataclasses import dataclass
from typing import Dict, Tuple, Union
import numpy as np

# Physical constants
RHO_WATER: float = 1000.0  # kg/m^3
RHO_SEDIMENT: float = 2650.0  # kg/m^3 (limestone / carbonate rock)
GRAVITY: float = 9.80665  # m/s^2
GAMMA_WATER: float = RHO_WATER * GRAVITY  # 9806.65 N/m^3
SHIELDS_CRITICAL_GRAVEL: float = 0.045
SHIELDS_CRITICAL_BOULDER: float = 0.060


@dataclass
class FlowRegimeMetrics:
    """Hydrodynamic power and flow regime diagnostics."""
    velocity_mag_m_s: float
    flow_direction_deg: float
    froude_number: float
    unit_stream_power_w_m2: float
    bed_shear_stress_pa: float
    max_mobile_diameter_m: float
    impact_force_kn_m: float
    hazard_rating: float
    hazard_class: str


def compute_flow_kinematics(
    u_vel: Union[float, np.ndarray],
    v_vel: Union[float, np.ndarray],
    depth_m: Union[float, np.ndarray]
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray], Union[float, np.ndarray]]:
    """Compute velocity magnitude, flow direction angle, and Froude number.
    
    Args:
        u_vel: Eastward velocity component (m/s)
        v_vel: Northward velocity component (m/s)
        depth_m: Water depth (m)
        
    Returns:
        Tuple of (velocity_magnitude, direction_degrees_from_north, froude_number).
    """
    v_mag = np.sqrt(u_vel**2 + v_vel**2)
    # Flow direction in geographic azimuth (0° North, 90° East)
    dir_rad = np.arctan2(u_vel, v_vel)
    dir_deg = np.mod(np.degrees(dir_rad), 360.0)

    # Froude number Fr = V / sqrt(g * h)
    celerity = np.sqrt(GRAVITY * np.maximum(depth_m, 1e-4))
    froude = v_mag / celerity

    return v_mag, dir_deg, froude


def compute_unit_stream_power(
    depth_m: Union[float, np.ndarray],
    velocity_m_s: Union[float, np.ndarray],
    energy_slope: Union[float, np.ndarray]
) -> Union[float, np.ndarray]:
    """Compute specific / unit stream power: omega = gamma * h * V * Sf.
    
    Args:
        depth_m: Water depth (m)
        velocity_m_s: Flow velocity magnitude (m/s)
        energy_slope: Energy slope or bed slope (m/m, dimensionless)
        
    Returns:
        Unit stream power in W/m^2 (or N/(m*s)).
    """
    return GAMMA_WATER * depth_m * velocity_m_s * np.maximum(0.0, energy_slope)


def compute_bed_shear_stress(
    depth_m: Union[float, np.ndarray],
    velocity_m_s: Union[float, np.ndarray],
    manning_n: Union[float, np.ndarray]
) -> Union[float, np.ndarray]:
    """Compute boundary shear stress: tau_b = rho * g * n^2 * V^2 / (h^(1/3)).
    
    Args:
        depth_m: Water depth (m)
        velocity_m_s: Flow velocity magnitude (m/s)
        manning_n: Manning roughness coefficient (s/m^(1/3))
        
    Returns:
        Bed shear stress in Pa (N/m^2).
    """
    safe_depth = np.maximum(depth_m, 0.01)
    tau_b = RHO_WATER * GRAVITY * (manning_n**2) * (velocity_m_s**2) / (safe_depth**(1.0 / 3.0))
    return tau_b


def compute_shields_competence(
    shear_stress_pa: Union[float, np.ndarray],
    shields_critical: float = SHIELDS_CRITICAL_BOULDER,
    sediment_density: float = RHO_SEDIMENT
) -> Union[float, np.ndarray]:
    """Compute maximum mobile clast diameter (D_max) according to Shields criterion.
    
    D_max = tau_b / (theta_c * (rho_s - rho) * g)
    
    Args:
        shear_stress_pa: Bed shear stress (Pa)
        shields_critical: Critical dimensionless Shields stress (typically 0.045 - 0.06)
        sediment_density: Density of bed material (kg/m^3)
        
    Returns:
        Maximum mobilized clast/boulder diameter in meters.
    """
    delta_rho = max(1.0, sediment_density - RHO_WATER)
    d_max = shear_stress_pa / (shields_critical * delta_rho * GRAVITY)
    return np.maximum(0.0, d_max)


def compute_hydrodynamic_thrust(
    depth_m: Union[float, np.ndarray],
    velocity_m_s: Union[float, np.ndarray],
    drag_coeff: float = 1.2
) -> Union[float, np.ndarray]:
    """Compute hydrodynamic impact force per unit width on civil structures.
    
    F_i = C_d * rho * (V^2 / 2) * h + 0.5 * rho * g * h^2
    
    Args:
        depth_m: Water depth (m)
        velocity_m_s: Flow velocity (m/s)
        drag_coeff: Drag coefficient (1.0 to 1.5 for rectangular building walls/piers)
        
    Returns:
        Impact thrust in kN/m.
    """
    dynamic_thrust = drag_coeff * RHO_WATER * 0.5 * (velocity_m_s**2) * depth_m
    hydrostatic_thrust = 0.5 * RHO_WATER * GRAVITY * (depth_m**2)
    total_thrust_n_m = dynamic_thrust + hydrostatic_thrust
    return total_thrust_n_m / 1000.0  # Convert to kN/m


def compute_flood_hazard_rating(
    depth_m: Union[float, np.ndarray],
    velocity_m_s: Union[float, np.ndarray],
    debris_factor: float = 1.0
) -> Tuple[Union[float, np.ndarray], Union[str, np.ndarray]]:
    """Compute DEFRA Flood Hazard Rating (HR) and Swiss hazard matrix class.
    
    HR = d * (v + 0.5) + DF
    
    Classes:
    - Low: HR < 0.75 (caution)
    - Moderate: 0.75 <= HR < 1.25 (dangerous for some)
    - Significant: 1.25 <= HR < 2.0 (dangerous for most)
    - Extreme: HR >= 2.0 (dangerous for all, building destruction)
    
    Args:
        depth_m: Water depth (m)
        velocity_m_s: Velocity magnitude (m/s)
        debris_factor: Debris factor (0.0 to 1.0; 1.0 for steep mountain torrents)
        
    Returns:
        Tuple of (hazard_rating_value, hazard_classification_string).
    """
    hr = depth_m * (velocity_m_s + 0.5) + debris_factor

    if isinstance(hr, np.ndarray):
        classes = np.empty(hr.shape, dtype=object)
        classes[hr < 0.75] = "Low"
        classes[(hr >= 0.75) & (hr < 1.25)] = "Moderate"
        classes[(hr >= 1.25) & (hr < 2.0)] = "Significant"
        classes[hr >= 2.0] = "Extreme"
        return hr, classes

    hr_val = float(hr)
    if hr_val < 0.75:
        h_class = "Low"
    elif hr_val < 1.25:
        h_class = "Moderate"
    elif hr_val < 2.0:
        h_class = "Significant"
    else:
        h_class = "Extreme"

    return hr_val, h_class

