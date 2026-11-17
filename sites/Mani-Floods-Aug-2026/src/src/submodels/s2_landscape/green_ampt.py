"""Green-Ampt-Mein-Larson (GAML) Infiltration and Precipitation Excess Engine.

Calculates time to ponding, cumulative infiltration, infiltration capacity,
and net precipitation excess under unsteady, time-varying storm hyetographs.
"""

from typing import Tuple, List, Union
import numpy as np


def solve_green_ampt_step(
    dt_hr: float,
    precip_rate_mm_h: float,
    f_prev_cum_mm: float,
    ks_mm_h: float,
    psi_f_m: float,
    theta_deficit: float,
    max_iter: int = 50,
    tol: float = 1e-5
) -> Tuple[float, float, float]:
    """Solve a single time-step of Green-Ampt infiltration for unsteady rainfall.
    
    Args:
        dt_hr: Time step duration in hours.
        precip_rate_mm_h: Rainfall intensity during time step in mm/hr.
        f_prev_cum_mm: Cumulative infiltration at start of step (mm).
        ks_mm_h: Saturated hydraulic conductivity (mm/hr).
        psi_f_m: Wetting front suction head (m).
        theta_deficit: Available moisture storage (theta_s - theta_i) [m^3/m^3].
        max_iter: Newton-Raphson iteration limit.
        tol: Convergence tolerance (mm).
        
    Returns:
        Tuple of:
            f_new_cum_mm: New cumulative infiltration (mm).
            infil_rate_mm_h: Effective infiltration rate during step (mm/hr).
            excess_rate_mm_h: Net precipitation excess / runoff rate (mm/hr).
    """
    # Suction parameter in mm
    s_mm = psi_f_m * 1000.0 * max(0.01, theta_deficit)

    # Potential rainfall volume during step
    potential_rain_mm = precip_rate_mm_h * dt_hr

    if f_prev_cum_mm <= 1e-6 and potential_rain_mm <= 1e-6:
        return 0.0, 0.0, 0.0

    # Infiltration capacity at start of step
    if f_prev_cum_mm > 1e-6:
        f_cap = ks_mm_h * (1.0 + s_mm / f_prev_cum_mm)
    else:
        f_cap = 1e6 # Effectively infinite before water enters

    # Check if ponding occurs during step
    if precip_rate_mm_h <= ks_mm_h:
        # No ponding possible; all rain infiltrates
        f_new = f_prev_cum_mm + potential_rain_mm
        infil_rate = precip_rate_mm_h
        excess_rate = 0.0
        return f_new, infil_rate, excess_rate

    # If rainfall exceeds Ks, solve non-linear Green-Ampt equation via Newton-Raphson
    # F(t + dt) - F(t) - s * ln((F(t + dt) + s) / (F(t) + s)) = Ks * dt
    f_guess = f_prev_cum_mm + ks_mm_h * dt_hr

    for _ in range(max_iter):
        f_num = f_guess - f_prev_cum_mm - s_mm * np.log((f_guess + s_mm) / (f_prev_cum_mm + s_mm + 1e-9)) - ks_mm_h * dt_hr
        df_num = 1.0 - (s_mm / (f_guess + s_mm))
        f_next = f_guess - f_num / (df_num + 1e-9)
        if abs(f_next - f_guess) < tol:
            f_guess = f_next
            break
        f_guess = f_next

    # Max possible infiltration cannot exceed previous + current precipitation
    actual_infil_mm = min(potential_rain_mm, max(0.0, f_guess - f_prev_cum_mm))
    f_new = f_prev_cum_mm + actual_infil_mm
    infil_rate = actual_infil_mm / dt_hr
    excess_rate = max(0.0, precip_rate_mm_h - infil_rate)

    return float(f_new), float(infil_rate), float(excess_rate)


def simulate_hyetograph_excess(
    times_hr: np.ndarray,
    precip_mm_h: np.ndarray,
    ks_mm_h: float,
    psi_f_m: float,
    theta_deficit: float
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Simulate complete storm hyetograph through Green-Ampt infiltration.
    
    Args:
        times_hr: 1D array of time stamps in hours.
        precip_mm_h: 1D array of precipitation intensity at each time.
        ks_mm_h: Saturated hydraulic conductivity (mm/hr).
        psi_f_m: Wetting front suction head (m).
        theta_deficit: Available moisture storage (theta_s - theta_i).
        
    Returns:
        Tuple of (cumulative_infil_mm, infil_rate_mm_h, excess_rate_mm_h).
    """
    n_steps = len(times_hr)
    cum_infil = np.zeros(n_steps, dtype=np.float64)
    infil_rates = np.zeros(n_steps, dtype=np.float64)
    excess_rates = np.zeros(n_steps, dtype=np.float64)

    f_cum = 0.0
    for i in range(n_steps):
        dt = (times_hr[i] - times_hr[i - 1]) if i > 0 else (times_hr[1] - times_hr[0] if n_steps > 1 else 1.0)
        p_rate = precip_mm_h[i]
        f_cum, i_rate, e_rate = solve_green_ampt_step(
            dt_hr=dt,
            precip_rate_mm_h=p_rate,
            f_prev_cum_mm=f_cum,
            ks_mm_h=ks_mm_h,
            psi_f_m=psi_f_m,
            theta_deficit=theta_deficit
        )
        cum_infil[i] = f_cum
        infil_rates[i] = i_rate
        excess_rates[i] = e_rate

    return cum_infil, infil_rates, excess_rates

