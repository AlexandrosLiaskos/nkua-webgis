-- Undo of the dataset protection of 16 November 2026.
-- Part A restores the two views (needed only if the previous pages are put back).
-- Part B removes the functions of step 1 (optional; the functions do no harm if left in place).
BEGIN;
-- Part A
CREATE OR REPLACE VIEW api.beachrocks WITH (security_invoker='true') AS
 SELECT id,
    record_no,
    reference,
    site,
    area,
    country,
    ocean_sea,
    longitude,
    latitude,
    pos_type,
    maximum_altitude,
    minimum_altitude,
    no_of_slabs,
    tidal_range,
    dating_method,
    dated_sample,
    estimated_age,
    main_composition,
    cement_type,
    cement_microstructure,
    formation_process,
    formation_location,
    water_table,
    publication_year,
    created_at
   FROM data.beachrocks;
CREATE OR REPLACE VIEW api.tombolos WITH (security_invoker='true') AS
 SELECT id,
    name_gr,
    name_en,
    prefecture_gr,
    prefecture_en,
    island_gr,
    island_en,
    length_m,
    width_tombolo_m,
    width_continent_m,
    width_island_m,
    height_m,
    tombolo_type,
    tombolo_category,
    submerged,
    sub_rcp26,
    sub_rcp85,
    elevation_rcp26,
    elevation_rcp85,
    elevation,
    latitude,
    longitude,
    created_at,
    updated_at
   FROM data.tombolos;
ALTER VIEW api.beachrocks OWNER TO webgis_owner;
ALTER VIEW api.tombolos OWNER TO webgis_owner;
GRANT SELECT ON TABLE api.beachrocks TO webgis_anon;
GRANT SELECT ON TABLE api.tombolos TO webgis_anon;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Part B (run by hand only if the functions must go as well)
-- BEGIN;
-- DROP FUNCTION IF EXISTS api.api_beachrocks_count();
-- DROP FUNCTION IF EXISTS api.api_beachrocks_markers(text[], text[], text[], text[], text[], text[]);
-- DROP FUNCTION IF EXISTS api.api_beachrocks_details(bigint);
-- DROP FUNCTION IF EXISTS api.api_beachrocks_filter_options(text[], text[], text[], text[], text[], text[]);
-- DROP FUNCTION IF EXISTS api.api_tombolos_count();
-- DROP FUNCTION IF EXISTS api.api_tombolos_markers(text[], text[], text[], text[], text[], text[], text[]);
-- DROP FUNCTION IF EXISTS api.api_tombolos_details(bigint);
-- DROP FUNCTION IF EXISTS api.api_tombolos_filter_options(text[], text[], text[], text[], text[], text[], text[]);
-- DROP FUNCTION IF EXISTS api.api_tombolos_summary();
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
