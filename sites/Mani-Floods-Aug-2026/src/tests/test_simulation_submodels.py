"""Unit tests for the Mani Floods simulation framework submodels."""

import numpy as np
import pytest

from src.submodels.s2_landscape.soilgrids_ptf import (
    saxton_rawls_ptf,
    apply_landscape_modifiers,
)
from src.submodels.s2_landscape.green_ampt import (
    solve_green_ampt_step,
    simulate_hyetograph_excess,
)
from src.submodels.s4_power_geomorphology.stream_power import (
    compute_flow_kinematics,
    compute_unit_stream_power,
    compute_bed_shear_stress,
    compute_shields_competence,
    compute_hydrodynamic_thrust,
    compute_flood_hazard_rating,
)
from src.submodels.s5_validation.mass_balance import (
    audit_water_mass_balance,
    compute_hydrologic_fit_metrics,
    compute_spatial_hit_metrics,
)


def test_saxton_rawls_ptf_bounds():
    """Verify PTF produces physically valid soil parameters."""
    params = saxton_rawls_ptf(
        sand_pct=45.0,
        clay_pct=30.0,
        soc_pct=1.8,
        bulk_density_g_cm3=1.38,
        gravel_vol_pct=20.0
    )
    assert 1.0 < params.ks_mm_h < 100.0
    assert 0.30 < params.theta_s < 0.60
    assert 0.05 < params.psi_f_m < 1.0
    assert 2.0 < params.b_exponent < 15.0


def test_landscape_modifiers():
    """Verify wildfire burn scars attenuate Ks and karst increases transmission."""
    baseline = saxton_rawls_ptf(sand_pct=45.0, clay_pct=30.0)
    burned = apply_landscape_modifiers(baseline, burn_severity_dnbr=500.0, is_karst_limestone=False)
    karst = apply_landscape_modifiers(baseline, burn_severity_dnbr=0.0, is_karst_limestone=True, karst_percolation_mm_h=15.0)

    # Burned soil must exhibit significant infiltration reduction (hydrophobicity)
    assert burned.ks_mm_h < baseline.ks_mm_h
    assert burned.ks_mm_h < (0.5 * baseline.ks_mm_h)

    # Karst carbonate rock must have higher effective transmission loss
    assert karst.ks_mm_h > baseline.ks_mm_h


def test_green_ampt_mass_conservation():
    """Verify Green-Ampt solver conserves mass: Rain = Infiltration + Excess."""
    times_hr = np.array([0.0, 1.0, 2.0, 3.0])
    precip_mm_h = np.array([10.0, 50.0, 30.0, 5.0])
    ks_mm_h = 15.0
    psi_f_m = 0.20
    theta_deficit = 0.20

    cum_infil, infil_rates, excess_rates = simulate_hyetograph_excess(
        times_hr=times_hr,
        precip_mm_h=precip_mm_h,
        ks_mm_h=ks_mm_h,
        psi_f_m=psi_f_m,
        theta_deficit=theta_deficit
    )

    total_rain = float(np.sum(precip_mm_h * 1.0))
    total_infil = float(cum_infil[-1])
    total_excess = float(np.sum(excess_rates * 1.0))
    # Sum of cumulative infiltration and total excess must equal total rainfall
    assert abs(total_rain - (total_infil + total_excess)) < 1e-3


def test_hydrodynamic_power_and_kinematics():
    """Verify 2D kinematics, unit stream power, shear stress, and Shields competence."""
    u, v, h = 3.0, -4.0, 2.0
    v_mag, flow_dir, froude = compute_flow_kinematics(u, v, h)

    assert pytest.approx(v_mag, 0.01) == 5.0
    # Flow towards South-East azimuth: atan2(3, -4) -> 143.13 degrees
    assert pytest.approx(flow_dir, 0.1) == 143.13
    assert froude > 0.0

    slope = 0.05
    omega = compute_unit_stream_power(h, v_mag, slope)
    # omega = 9806.65 * 2.0 * 5.0 * 0.05 = 4903.325 W/m^2
    assert pytest.approx(omega, 1.0) == 4903.3

    shear_stress = compute_bed_shear_stress(h, v_mag, manning_n=0.04)
    assert shear_stress > 0.0

    # Test Shields grain size competence
    d_max = compute_shields_competence(shear_stress, shields_critical=0.06)
    assert d_max > 0.0


def test_water_balance_audit():
    """Verify continuity error checking logic."""
    audit_pass = audit_water_mass_balance(
        rain_vol_m3=1000000.0,
        infil_vol_m3=400000.0,
        surface_vol_m3=100000.0,
        marine_outflow_m3=498000.0,
        max_acceptable_error_pct=0.5
    )
    assert audit_pass.relative_continuity_error_pct == pytest.approx(0.20, 0.01)
    assert audit_pass.is_conservation_acceptable is True

    audit_fail = audit_water_mass_balance(
        rain_vol_m3=1000000.0,
        infil_vol_m3=400000.0,
        surface_vol_m3=100000.0,
        marine_outflow_m3=400000.0, # 10% discrepancy
        max_acceptable_error_pct=0.5
    )
    assert audit_fail.is_conservation_acceptable is False


def test_empirical_damage_contingency():
    """Verify contingency validation metrics against official emergency declarations."""
    from src.submodels.s5_validation.damage_evaluator import evaluate_empirical_damage
    report = evaluate_empirical_damage()
    assert report["contingency_metrics"]["Critical_Success_Index"] == 1.0
    assert report["contingency_metrics"]["Hit_Rate"] == 1.0
    assert report["contingency_metrics"]["False_Alarm_Ratio"] == 0.0
    assert report["accuracy_score"] == 1.0
    assert len(report["catchment_evaluations"]) == 4


def test_hecras_model_integrity():
    """Verify HEC-RAS 2D configuration and boundary conditions."""
    from src.pipeline.config import MODELS_DIR
    model_dir = MODELS_DIR / "hec-ras"
    prj = model_dir / "Mani_Kokkala_2D.prj"
    plan = model_dir / "Mani_Kokkala_2D.p01"
    unsteady = model_dir / "Mani_Kokkala_2D.u01"
    geom = model_dir / "Mani_Kokkala_2D.g01"
    rasmap = model_dir / "Mani_Kokkala_2D.rasmap"

    for p in [prj, plan, unsteady, geom, rasmap]:
        assert p.exists(), f"Missing HEC-RAS file: {p}"

    with open(unsteady, "r", encoding="utf-8") as f:
        u_text = f.read()
    assert "62.38" in u_text or "62.4" in u_text  # Kokkala peak discharge represented
    assert "Stage Hydrograph" in u_text


def test_manuscript_build_integrity():
    """Verify academic Word manuscript was compiled and contains required assets."""
    from src.pipeline.config import PUBLICATION_DIR
    docx_path = PUBLICATION_DIR / "manuscript" / "Mani_Flash_Flood_August_2026_Manuscript.docx"
    assert docx_path.exists()
    assert docx_path.stat().st_size > 500000  # Size > 500 KB (embeds high-res figures)


def test_vector_geopackages_integrity():
    """Verify vector catchment basins, stream networks, and regional divide exist and have valid attributes."""
    from src.pipeline.config import PROCESSED_DATA_DIR
    import sqlite3

    terrain_dir = PROCESSED_DATA_DIR / "terrain"
    basins_gpkg = terrain_dir / "mani_catchment_basins.gpkg"
    streams_gpkg = terrain_dir / "mani_stream_network.gpkg"
    divide_gpkg = terrain_dir / "mani_regional_divide.gpkg"

    assert basins_gpkg.exists()
    assert streams_gpkg.exists()
    assert divide_gpkg.exists()
    assert basins_gpkg.stat().st_size > 1000000   # > 1 MB
    assert streams_gpkg.stat().st_size > 5000000   # > 5 MB
    assert divide_gpkg.stat().st_size > 50000      # > 50 KB

    with sqlite3.connect(basins_gpkg) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) FROM mani_catchment_basins")
        assert cursor.fetchone()[0] == 266
        cursor.execute("SELECT flank, count(*) FROM mani_catchment_basins GROUP BY flank")
        counts = dict(cursor.fetchall())
        assert counts["West"] == 139
        assert counts["East"] == 127

    with sqlite3.connect(divide_gpkg) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) FROM Regional_Drainage_Divide")
        assert cursor.fetchone()[0] >= 1


def test_open_data_and_code_repository_integrity():
    """Verify that both public release repositories (code and data) are properly configured."""
    from src.pipeline.config import WORKSPACE_ROOT
    import json

    # 1. Code repository integrity
    root_license = WORKSPACE_ROOT / "LICENSE"
    root_readme = WORKSPACE_ROOT / "README.md"
    assert root_license.exists(), "Root MIT LICENSE is missing"
    assert "MIT License" in root_license.read_text(encoding="utf-8")
    assert root_readme.exists(), "Root README.md is missing"
    readme_text = root_readme.read_text(encoding="utf-8")
    assert "https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/src" in readme_text
    assert "https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/data" in readme_text

    # 2. Open Data repository integrity
    data_repo = WORKSPACE_ROOT / "data_repo"
    assert data_repo.exists(), "data_repo directory is missing"
    data_license = data_repo / "LICENSE"
    assert data_license.exists(), "data_repo CC-BY-4.0 LICENSE is missing"
    assert "Creative Commons Attribution 4.0" in data_license.read_text(encoding="utf-8")

    data_readme = data_repo / "README.md"
    assert data_readme.exists(), "data_repo README.md is missing"
    data_readme_text = data_readme.read_text(encoding="utf-8")
    assert "https://evelpidou.nkua.cloud/Mani-Floods-Aug-2026/data" in data_readme_text
    assert "EPSG:2100" in data_readme_text

    # 3. Metadata and provenance
    catalog_json = data_repo / "metadata" / "data_catalog.json"
    inventory_csv = data_repo / "metadata" / "inventory.csv"
    assert catalog_json.exists(), "data_catalog.json is missing"
    assert inventory_csv.exists(), "data_repo inventory.csv is missing"

    with open(catalog_json, "r", encoding="utf-8") as f:
        cat = json.load(f)
        assert len(cat["layers"]) >= 6

    # 4. Reports validity
    recon_json = data_repo / "reports" / "target_catchments_flood_reconstruction.json"
    assert recon_json.exists()
    with open(recon_json, "r", encoding="utf-8") as f:
        recon_data = json.load(f)
        assert len(recon_data) == 4

    # 5. Safety: No large rasters or secrets in data_repo
    for f in data_repo.rglob("*"):
        if f.is_file():
            assert not f.name.endswith((".tif", ".tiff", ".nc")), f"Large raster/grid found in data_repo: {f.name}"
            assert f.name != ".env", "Secret .env file found in data_repo"



