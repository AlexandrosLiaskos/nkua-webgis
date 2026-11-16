-- Dataset protection, step 1 (16 November 2026): data functions for beachrocks and tombolos.
-- Additive: the views api.beachrocks and api.tombolos are left in place by this file.
-- After this step the pages can read markers (a subset of columns for all records),
-- one full record by id, filter options and totals through functions, as lagoons and floods do.
-- Undo: 20261116-dataset-protection-rollback.sql
BEGIN;

-- beachrocks: total number of records.
CREATE OR REPLACE FUNCTION api.api_beachrocks_count() RETURNS bigint
    LANGUAGE sql STABLE
    AS $$ SELECT count(*) FROM data.beachrocks $$;

-- beachrocks: the columns the page needs to draw the map, legend, filters, search and charts, for all records.
-- Rows are returned in the storage order of the table. The former view api.beachrocks gave the same order for
-- requests without a filter and with one value in each filter; with several values in one filter its order
-- followed the query plan (index scan), so there only the set of rows is the same, not their order.
CREATE OR REPLACE FUNCTION api.api_beachrocks_markers(
    p_country text[] DEFAULT NULL,
    p_ocean_sea text[] DEFAULT NULL,
    p_cement_type text[] DEFAULT NULL,
    p_formation_process text[] DEFAULT NULL,
    p_formation_location text[] DEFAULT NULL,
    p_dating_method text[] DEFAULT NULL
) RETURNS TABLE(id bigint, latitude double precision, longitude double precision, site text, area text, country text, ocean_sea text, pos_type text, cement_type text, formation_process text, formation_location text, dating_method text)
    LANGUAGE sql STABLE
    AS $$
    SELECT b.id, b.latitude, b.longitude, b.site, b.area, b.country, b.ocean_sea, b.pos_type, b.cement_type, b.formation_process, b.formation_location, b.dating_method
    FROM data.beachrocks b
    WHERE b.latitude IS NOT NULL
      AND b.longitude IS NOT NULL
      AND (p_country IS NULL OR b.country = ANY(p_country))
      AND (p_ocean_sea IS NULL OR b.ocean_sea = ANY(p_ocean_sea))
      AND (p_cement_type IS NULL OR b.cement_type = ANY(p_cement_type))
      AND (p_formation_process IS NULL OR b.formation_process = ANY(p_formation_process))
      AND (p_formation_location IS NULL OR b.formation_location = ANY(p_formation_location))
      AND (p_dating_method IS NULL OR b.dating_method = ANY(p_dating_method))
    ORDER BY b.ctid;
$$;

-- beachrocks: one full record, as shown in the detail panel.
CREATE OR REPLACE FUNCTION api.api_beachrocks_details(p_id bigint) RETURNS TABLE(id bigint, site text, area text, country text, ocean_sea text, latitude double precision, longitude double precision, pos_type text, maximum_altitude double precision, minimum_altitude double precision, no_of_slabs integer, tidal_range double precision, main_composition text, cement_type text, cement_microstructure text, formation_process text, formation_location text, water_table text, dating_method text, dated_sample text, estimated_age text, reference text, publication_year integer)
    LANGUAGE sql STABLE
    AS $$
    SELECT b.id, b.site, b.area, b.country, b.ocean_sea, b.latitude, b.longitude, b.pos_type, b.maximum_altitude, b.minimum_altitude, b.no_of_slabs, b.tidal_range, b.main_composition, b.cement_type, b.cement_microstructure, b.formation_process, b.formation_location, b.water_table, b.dating_method, b.dated_sample, b.estimated_age, b.reference, b.publication_year
    FROM data.beachrocks b
    WHERE b.id = p_id;
$$;

-- beachrocks: the values offered by each filter list, given the values chosen in the other lists.
CREATE OR REPLACE FUNCTION api.api_beachrocks_filter_options(
    p_country text[] DEFAULT NULL,
    p_ocean_sea text[] DEFAULT NULL,
    p_cement_type text[] DEFAULT NULL,
    p_formation_process text[] DEFAULT NULL,
    p_formation_location text[] DEFAULT NULL,
    p_dating_method text[] DEFAULT NULL
) RETURNS TABLE(field text, value text)
    LANGUAGE sql STABLE
    AS $$
    SELECT DISTINCT 'country'::text, b.country
    FROM data.beachrocks b
    WHERE b.country IS NOT NULL
      AND (p_ocean_sea IS NULL OR b.ocean_sea = ANY(p_ocean_sea))
      AND (p_cement_type IS NULL OR b.cement_type = ANY(p_cement_type))
      AND (p_formation_process IS NULL OR b.formation_process = ANY(p_formation_process))
      AND (p_formation_location IS NULL OR b.formation_location = ANY(p_formation_location))
      AND (p_dating_method IS NULL OR b.dating_method = ANY(p_dating_method))
    UNION ALL
    SELECT DISTINCT 'ocean_sea'::text, b.ocean_sea
    FROM data.beachrocks b
    WHERE b.ocean_sea IS NOT NULL
      AND (p_country IS NULL OR b.country = ANY(p_country))
      AND (p_cement_type IS NULL OR b.cement_type = ANY(p_cement_type))
      AND (p_formation_process IS NULL OR b.formation_process = ANY(p_formation_process))
      AND (p_formation_location IS NULL OR b.formation_location = ANY(p_formation_location))
      AND (p_dating_method IS NULL OR b.dating_method = ANY(p_dating_method))
    UNION ALL
    SELECT DISTINCT 'cement_type'::text, b.cement_type
    FROM data.beachrocks b
    WHERE b.cement_type IS NOT NULL
      AND (p_country IS NULL OR b.country = ANY(p_country))
      AND (p_ocean_sea IS NULL OR b.ocean_sea = ANY(p_ocean_sea))
      AND (p_formation_process IS NULL OR b.formation_process = ANY(p_formation_process))
      AND (p_formation_location IS NULL OR b.formation_location = ANY(p_formation_location))
      AND (p_dating_method IS NULL OR b.dating_method = ANY(p_dating_method))
    UNION ALL
    SELECT DISTINCT 'formation_process'::text, b.formation_process
    FROM data.beachrocks b
    WHERE b.formation_process IS NOT NULL
      AND (p_country IS NULL OR b.country = ANY(p_country))
      AND (p_ocean_sea IS NULL OR b.ocean_sea = ANY(p_ocean_sea))
      AND (p_cement_type IS NULL OR b.cement_type = ANY(p_cement_type))
      AND (p_formation_location IS NULL OR b.formation_location = ANY(p_formation_location))
      AND (p_dating_method IS NULL OR b.dating_method = ANY(p_dating_method))
    UNION ALL
    SELECT DISTINCT 'formation_location'::text, b.formation_location
    FROM data.beachrocks b
    WHERE b.formation_location IS NOT NULL
      AND (p_country IS NULL OR b.country = ANY(p_country))
      AND (p_ocean_sea IS NULL OR b.ocean_sea = ANY(p_ocean_sea))
      AND (p_cement_type IS NULL OR b.cement_type = ANY(p_cement_type))
      AND (p_formation_process IS NULL OR b.formation_process = ANY(p_formation_process))
      AND (p_dating_method IS NULL OR b.dating_method = ANY(p_dating_method))
    UNION ALL
    SELECT DISTINCT 'dating_method'::text, b.dating_method
    FROM data.beachrocks b
    WHERE b.dating_method IS NOT NULL
      AND (p_country IS NULL OR b.country = ANY(p_country))
      AND (p_ocean_sea IS NULL OR b.ocean_sea = ANY(p_ocean_sea))
      AND (p_cement_type IS NULL OR b.cement_type = ANY(p_cement_type))
      AND (p_formation_process IS NULL OR b.formation_process = ANY(p_formation_process))
      AND (p_formation_location IS NULL OR b.formation_location = ANY(p_formation_location));
$$;

REVOKE ALL ON FUNCTION api.api_beachrocks_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_beachrocks_count() TO webgis_anon;
REVOKE ALL ON FUNCTION api.api_beachrocks_markers(text[], text[], text[], text[], text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_beachrocks_markers(text[], text[], text[], text[], text[], text[]) TO webgis_anon;
REVOKE ALL ON FUNCTION api.api_beachrocks_details(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_beachrocks_details(bigint) TO webgis_anon;
REVOKE ALL ON FUNCTION api.api_beachrocks_filter_options(text[], text[], text[], text[], text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_beachrocks_filter_options(text[], text[], text[], text[], text[], text[]) TO webgis_anon;

-- tombolos: total number of records.
CREATE OR REPLACE FUNCTION api.api_tombolos_count() RETURNS bigint
    LANGUAGE sql STABLE
    AS $$ SELECT count(*) FROM data.tombolos $$;

-- tombolos: the columns the page needs to draw the map, legend, filters, search and charts, for all records.
-- Rows are returned in the storage order of the table. The former view api.tombolos gave the same order for
-- requests without a filter and with one value in each filter; with several values in one filter its order
-- followed the query plan (index scan), so there only the set of rows is the same, not their order.
CREATE OR REPLACE FUNCTION api.api_tombolos_markers(
    p_prefecture_en text[] DEFAULT NULL,
    p_island_en text[] DEFAULT NULL,
    p_tombolo_type text[] DEFAULT NULL,
    p_tombolo_category text[] DEFAULT NULL,
    p_submerged text[] DEFAULT NULL,
    p_sub_rcp26 text[] DEFAULT NULL,
    p_sub_rcp85 text[] DEFAULT NULL
) RETURNS TABLE(id bigint, latitude double precision, longitude double precision, name_en text, name_gr text, prefecture_en text, island_en text, tombolo_type text, tombolo_category text, submerged text, sub_rcp26 text, sub_rcp85 text, length_m double precision, width_tombolo_m double precision, height_m double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT t.id, t.latitude, t.longitude, t.name_en, t.name_gr, t.prefecture_en, t.island_en, t.tombolo_type, t.tombolo_category, t.submerged, t.sub_rcp26, t.sub_rcp85, t.length_m, t.width_tombolo_m, t.height_m
    FROM data.tombolos t
    WHERE t.latitude IS NOT NULL
      AND t.longitude IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en))
      AND (p_tombolo_type IS NULL OR t.tombolo_type = ANY(p_tombolo_type))
      AND (p_tombolo_category IS NULL OR t.tombolo_category = ANY(p_tombolo_category))
      AND (p_submerged IS NULL OR t.submerged = ANY(p_submerged))
      AND (p_sub_rcp26 IS NULL OR t.sub_rcp26 = ANY(p_sub_rcp26))
      AND (p_sub_rcp85 IS NULL OR t.sub_rcp85 = ANY(p_sub_rcp85))
    ORDER BY t.ctid;
$$;

-- tombolos: one full record, as shown in the detail panel.
CREATE OR REPLACE FUNCTION api.api_tombolos_details(p_id bigint) RETURNS TABLE(id bigint, name_en text, name_gr text, prefecture_en text, island_en text, tombolo_type text, tombolo_category text, length_m double precision, width_tombolo_m double precision, width_continent_m double precision, width_island_m double precision, height_m double precision, elevation double precision, submerged text, sub_rcp26 text, sub_rcp85 text, elevation_rcp26 double precision, elevation_rcp85 double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT t.id, t.name_en, t.name_gr, t.prefecture_en, t.island_en, t.tombolo_type, t.tombolo_category, t.length_m, t.width_tombolo_m, t.width_continent_m, t.width_island_m, t.height_m, t.elevation, t.submerged, t.sub_rcp26, t.sub_rcp85, t.elevation_rcp26, t.elevation_rcp85
    FROM data.tombolos t
    WHERE t.id = p_id;
$$;

-- tombolos: the values offered by each filter list, given the values chosen in the other lists.
CREATE OR REPLACE FUNCTION api.api_tombolos_filter_options(
    p_prefecture_en text[] DEFAULT NULL,
    p_island_en text[] DEFAULT NULL,
    p_tombolo_type text[] DEFAULT NULL,
    p_tombolo_category text[] DEFAULT NULL,
    p_submerged text[] DEFAULT NULL,
    p_sub_rcp26 text[] DEFAULT NULL,
    p_sub_rcp85 text[] DEFAULT NULL
) RETURNS TABLE(field text, value text)
    LANGUAGE sql STABLE
    AS $$
    SELECT DISTINCT 'prefecture_en'::text, t.prefecture_en
    FROM data.tombolos t
    WHERE t.prefecture_en IS NOT NULL
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en))
      AND (p_tombolo_type IS NULL OR t.tombolo_type = ANY(p_tombolo_type))
      AND (p_tombolo_category IS NULL OR t.tombolo_category = ANY(p_tombolo_category))
      AND (p_submerged IS NULL OR t.submerged = ANY(p_submerged))
      AND (p_sub_rcp26 IS NULL OR t.sub_rcp26 = ANY(p_sub_rcp26))
      AND (p_sub_rcp85 IS NULL OR t.sub_rcp85 = ANY(p_sub_rcp85))
    UNION ALL
    SELECT DISTINCT 'island_en'::text, t.island_en
    FROM data.tombolos t
    WHERE t.island_en IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_tombolo_type IS NULL OR t.tombolo_type = ANY(p_tombolo_type))
      AND (p_tombolo_category IS NULL OR t.tombolo_category = ANY(p_tombolo_category))
      AND (p_submerged IS NULL OR t.submerged = ANY(p_submerged))
      AND (p_sub_rcp26 IS NULL OR t.sub_rcp26 = ANY(p_sub_rcp26))
      AND (p_sub_rcp85 IS NULL OR t.sub_rcp85 = ANY(p_sub_rcp85))
    UNION ALL
    SELECT DISTINCT 'tombolo_type'::text, t.tombolo_type
    FROM data.tombolos t
    WHERE t.tombolo_type IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en))
      AND (p_tombolo_category IS NULL OR t.tombolo_category = ANY(p_tombolo_category))
      AND (p_submerged IS NULL OR t.submerged = ANY(p_submerged))
    UNION ALL
    SELECT DISTINCT 'tombolo_category'::text, t.tombolo_category
    FROM data.tombolos t
    WHERE t.tombolo_category IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en))
      AND (p_tombolo_type IS NULL OR t.tombolo_type = ANY(p_tombolo_type))
      AND (p_submerged IS NULL OR t.submerged = ANY(p_submerged))
    UNION ALL
    SELECT DISTINCT 'submerged'::text, t.submerged
    FROM data.tombolos t
    WHERE t.submerged IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en))
      AND (p_tombolo_type IS NULL OR t.tombolo_type = ANY(p_tombolo_type))
      AND (p_tombolo_category IS NULL OR t.tombolo_category = ANY(p_tombolo_category))
    UNION ALL
    SELECT DISTINCT 'sub_rcp26'::text, t.sub_rcp26
    FROM data.tombolos t
    WHERE t.sub_rcp26 IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en))
    UNION ALL
    SELECT DISTINCT 'sub_rcp85'::text, t.sub_rcp85
    FROM data.tombolos t
    WHERE t.sub_rcp85 IS NOT NULL
      AND (p_prefecture_en IS NULL OR t.prefecture_en = ANY(p_prefecture_en))
      AND (p_island_en IS NULL OR t.island_en = ANY(p_island_en));
$$;

REVOKE ALL ON FUNCTION api.api_tombolos_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_tombolos_count() TO webgis_anon;
REVOKE ALL ON FUNCTION api.api_tombolos_markers(text[], text[], text[], text[], text[], text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_tombolos_markers(text[], text[], text[], text[], text[], text[], text[]) TO webgis_anon;
REVOKE ALL ON FUNCTION api.api_tombolos_details(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_tombolos_details(bigint) TO webgis_anon;
REVOKE ALL ON FUNCTION api.api_tombolos_filter_options(text[], text[], text[], text[], text[], text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_tombolos_filter_options(text[], text[], text[], text[], text[], text[], text[]) TO webgis_anon;

-- tombolos: the four catalogue totals shown in the Statistics tab.
CREATE OR REPLACE FUNCTION api.api_tombolos_summary() RETURNS TABLE(total bigint, prefectures bigint, submerged bigint, at_risk_rcp85 bigint)
    LANGUAGE sql STABLE
    AS $$
    SELECT count(*),
           count(DISTINCT t.prefecture_en),
           count(*) FILTER (WHERE t.submerged = 'yes'),
           count(*) FILTER (WHERE t.sub_rcp85 = 'yes')
    FROM data.tombolos t;
$$;

REVOKE ALL ON FUNCTION api.api_tombolos_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_tombolos_summary() TO webgis_anon;

NOTIFY pgrst, 'reload schema';
COMMIT;
