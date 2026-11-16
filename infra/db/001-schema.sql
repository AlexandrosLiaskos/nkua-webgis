\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA data;
CREATE SCHEMA api;

CREATE ROLE webgis_anon NOLOGIN;
CREATE ROLE webgis_authenticator NOINHERIT LOGIN PASSWORD :'authenticator_password';
GRANT webgis_anon TO webgis_authenticator;

ALTER ROLE webgis_anon SET statement_timeout = '5s';
ALTER ROLE webgis_anon SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE webgis_anon SET default_transaction_read_only = on;

CREATE TABLE data.floods (
    id                    BIGINT PRIMARY KEY,
    date_of_commencement  TEXT,
    year                  INTEGER,
    latitude              DOUBLE PRECISION,
    longitude             DOUBLE PRECISION,
    location_name         TEXT,
    flood_event_name      TEXT,
    deaths_toll_int       INTEGER,
    rainfall_duration     TEXT,
    cause_of_flood        TEXT,
    rainfall_height       TEXT,
    relevant_information  TEXT,
    source                TEXT
);

CREATE INDEX floods_year_idx ON data.floods (year);
CREATE INDEX floods_location_name_idx ON data.floods (location_name);
CREATE INDEX floods_deaths_toll_idx ON data.floods (deaths_toll_int);
CREATE INDEX floods_event_name_idx ON data.floods (flood_event_name);
CREATE INDEX floods_cause_idx ON data.floods (cause_of_flood);
CREATE INDEX floods_coordinates_idx ON data.floods (latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TABLE data.lagoons (
    id                       BIGINT PRIMARY KEY,
    name_en                  TEXT,
    name_gr                  TEXT,
    location_en              TEXT,
    island_en                TEXT,
    length_m                 DOUBLE PRECISION,
    width_m                  DOUBLE PRECISION,
    height_m                 DOUBLE PRECISION,
    perimeter_km2            DOUBLE PRECISION,
    area_km2                 DOUBLE PRECISION,
    rcp2_6_slr               DOUBLE PRECISION,
    rcp8_5_slr               DOUBLE PRECISION,
    rcp2_6_vec_slr           DOUBLE PRECISION,
    rcp8_5_vec_slr           DOUBLE PRECISION,
    rcp2_6_inundated         TEXT,
    rcp8_5_inundated         TEXT,
    rcp2_6_vec_inundated     TEXT,
    rcp8_5_vec_inundated     TEXT,
    data_quality             TEXT,
    geom                     geometry(Geometry, 4326),
    centroid_lat             DOUBLE PRECISION,
    centroid_lng             DOUBLE PRECISION,
    created_at               TIMESTAMPTZ
);

CREATE INDEX lagoons_geom_idx ON data.lagoons USING gist (geom);
CREATE INDEX lagoons_name_idx ON data.lagoons (name_en);
CREATE INDEX lagoons_location_idx ON data.lagoons (location_en);
CREATE INDEX lagoons_island_idx ON data.lagoons (island_en);
CREATE INDEX lagoons_rcp26_idx ON data.lagoons (rcp2_6_inundated);
CREATE INDEX lagoons_rcp85_idx ON data.lagoons (rcp8_5_inundated);

CREATE TABLE data.beachrocks (
    id                      BIGINT PRIMARY KEY,
    record_no               TEXT,
    reference               TEXT,
    site                    TEXT,
    area                    TEXT,
    country                 TEXT,
    ocean_sea               TEXT,
    longitude               DOUBLE PRECISION,
    latitude                DOUBLE PRECISION,
    pos_type                TEXT,
    maximum_altitude        DOUBLE PRECISION,
    minimum_altitude        DOUBLE PRECISION,
    no_of_slabs             INTEGER,
    tidal_range             DOUBLE PRECISION,
    dating_method           TEXT,
    dated_sample            TEXT,
    estimated_age           TEXT,
    main_composition        TEXT,
    cement_type             TEXT,
    cement_microstructure   TEXT,
    formation_process       TEXT,
    formation_location      TEXT,
    water_table             TEXT,
    publication_year        INTEGER,
    created_at              TIMESTAMPTZ
);

CREATE INDEX beachrocks_country_idx ON data.beachrocks (country);
CREATE INDEX beachrocks_ocean_idx ON data.beachrocks (ocean_sea);
CREATE INDEX beachrocks_cement_idx ON data.beachrocks (cement_type);
CREATE INDEX beachrocks_process_idx ON data.beachrocks (formation_process);
CREATE INDEX beachrocks_formation_location_idx ON data.beachrocks (formation_location);
CREATE INDEX beachrocks_dating_idx ON data.beachrocks (dating_method);
CREATE INDEX beachrocks_coordinates_idx ON data.beachrocks (latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TABLE data.tombolos (
    id                    BIGINT PRIMARY KEY,
    name_gr               TEXT,
    name_en               TEXT,
    prefecture_gr         TEXT,
    prefecture_en         TEXT,
    island_gr             TEXT,
    island_en             TEXT,
    length_m              DOUBLE PRECISION,
    width_tombolo_m       DOUBLE PRECISION,
    width_continent_m     DOUBLE PRECISION,
    width_island_m        DOUBLE PRECISION,
    height_m              DOUBLE PRECISION,
    tombolo_type          TEXT,
    tombolo_category      TEXT,
    submerged             TEXT,
    sub_rcp26             TEXT,
    sub_rcp85             TEXT,
    elevation_rcp26       DOUBLE PRECISION,
    elevation_rcp85       DOUBLE PRECISION,
    elevation             DOUBLE PRECISION,
    latitude              DOUBLE PRECISION,
    longitude             DOUBLE PRECISION,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ
);

CREATE INDEX tombolos_prefecture_idx ON data.tombolos (prefecture_en);
CREATE INDEX tombolos_island_idx ON data.tombolos (island_en);
CREATE INDEX tombolos_type_idx ON data.tombolos (tombolo_type);
CREATE INDEX tombolos_category_idx ON data.tombolos (tombolo_category);
CREATE INDEX tombolos_submerged_idx ON data.tombolos (submerged);
CREATE INDEX tombolos_rcp26_idx ON data.tombolos (sub_rcp26);
CREATE INDEX tombolos_rcp85_idx ON data.tombolos (sub_rcp85);
CREATE INDEX tombolos_coordinates_idx ON data.tombolos (latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE TEMP TABLE import_documents (document JSONB NOT NULL);

COPY import_documents (document)
FROM '/docker-entrypoint-initdb.d/data/floods.jsonl'
WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02');

INSERT INTO data.floods
SELECT
    (document->>'id')::BIGINT,
    document->>'date_of_commencement',
    NULLIF(document->>'year', '')::INTEGER,
    NULLIF(document->>'latitude', '')::DOUBLE PRECISION,
    NULLIF(document->>'longitude', '')::DOUBLE PRECISION,
    document->>'location_name',
    document->>'flood_event_name',
    NULLIF(document->>'deaths_toll_int', '')::INTEGER,
    document->>'rainfall_duration',
    document->>'cause_of_flood',
    document->>'rainfall_height',
    document->>'relevant_information',
    document->>'source'
FROM import_documents;

TRUNCATE import_documents;
COPY import_documents (document)
FROM '/docker-entrypoint-initdb.d/data/lagoons.jsonl'
WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02');

INSERT INTO data.lagoons
SELECT
    (document->>'id')::BIGINT,
    document->>'name_en',
    document->>'name_gr',
    document->>'location_en',
    document->>'island_en',
    NULLIF(document->>'length_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'width_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'height_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'perimeter_km2', '')::DOUBLE PRECISION,
    NULLIF(document->>'area_km2', '')::DOUBLE PRECISION,
    NULLIF(document->>'rcp2_6_slr', '')::DOUBLE PRECISION,
    NULLIF(document->>'rcp8_5_slr', '')::DOUBLE PRECISION,
    NULLIF(document->>'rcp2_6_vec_slr', '')::DOUBLE PRECISION,
    NULLIF(document->>'rcp8_5_vec_slr', '')::DOUBLE PRECISION,
    document->>'rcp2_6_inundated',
    document->>'rcp8_5_inundated',
    document->>'rcp2_6_vec_inundated',
    document->>'rcp8_5_vec_inundated',
    document->>'data_quality',
    CASE
        WHEN document->'geom' IS NULL OR jsonb_typeof(document->'geom') = 'null' THEN NULL
        ELSE ST_SetSRID(ST_GeomFromGeoJSON((document->'geom')::TEXT), 4326)
    END,
    NULLIF(document->>'centroid_lat', '')::DOUBLE PRECISION,
    NULLIF(document->>'centroid_lng', '')::DOUBLE PRECISION,
    NULLIF(document->>'created_at', '')::TIMESTAMPTZ
FROM import_documents;

TRUNCATE import_documents;
COPY import_documents (document)
FROM '/docker-entrypoint-initdb.d/data/beachrocks.jsonl'
WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02');

INSERT INTO data.beachrocks
SELECT
    (document->>'id')::BIGINT,
    document->>'record_no',
    document->>'reference',
    document->>'site',
    document->>'area',
    document->>'country',
    document->>'ocean_sea',
    NULLIF(document->>'longitude', '')::DOUBLE PRECISION,
    NULLIF(document->>'latitude', '')::DOUBLE PRECISION,
    document->>'pos_type',
    NULLIF(document->>'maximum_altitude', '')::DOUBLE PRECISION,
    NULLIF(document->>'minimum_altitude', '')::DOUBLE PRECISION,
    NULLIF(document->>'no_of_slabs', '')::INTEGER,
    NULLIF(document->>'tidal_range', '')::DOUBLE PRECISION,
    document->>'dating_method',
    document->>'dated_sample',
    document->>'estimated_age',
    document->>'main_composition',
    document->>'cement_type',
    document->>'cement_microstructure',
    document->>'formation_process',
    document->>'formation_location',
    document->>'water_table',
    NULLIF(document->>'publication_year', '')::INTEGER,
    NULLIF(document->>'created_at', '')::TIMESTAMPTZ
FROM import_documents;

TRUNCATE import_documents;
COPY import_documents (document)
FROM '/docker-entrypoint-initdb.d/data/tombolos.jsonl'
WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02');

INSERT INTO data.tombolos
SELECT
    (document->>'id')::BIGINT,
    document->>'name_gr',
    document->>'name_en',
    document->>'prefecture_gr',
    document->>'prefecture_en',
    document->>'island_gr',
    document->>'island_en',
    NULLIF(document->>'length_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'width_tombolo_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'width_continent_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'width_island_m', '')::DOUBLE PRECISION,
    NULLIF(document->>'height_m', '')::DOUBLE PRECISION,
    document->>'tombolo_type',
    document->>'tombolo_category',
    document->>'submerged',
    document->>'sub_rcp26',
    document->>'sub_rcp85',
    NULLIF(document->>'elevation_rcp26', '')::DOUBLE PRECISION,
    NULLIF(document->>'elevation_rcp85', '')::DOUBLE PRECISION,
    NULLIF(document->>'elevation', '')::DOUBLE PRECISION,
    NULLIF(document->>'latitude', '')::DOUBLE PRECISION,
    NULLIF(document->>'longitude', '')::DOUBLE PRECISION,
    NULLIF(document->>'created_at', '')::TIMESTAMPTZ,
    NULLIF(document->>'updated_at', '')::TIMESTAMPTZ
FROM import_documents;

DROP TABLE import_documents;

CREATE VIEW api.beachrocks WITH (security_invoker = true) AS
SELECT * FROM data.beachrocks;

CREATE VIEW api.tombolos WITH (security_invoker = true) AS
SELECT * FROM data.tombolos;

CREATE FUNCTION api.api_floods_count()
RETURNS BIGINT
LANGUAGE sql STABLE
AS $$ SELECT count(*) FROM data.floods $$;

CREATE FUNCTION api.api_floods_markers(
    p_year INTEGER DEFAULT NULL,
    p_location_name TEXT DEFAULT NULL,
    p_deaths_toll_int INTEGER DEFAULT NULL,
    p_flood_event_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    year INTEGER,
    location_name TEXT,
    deaths_toll_int INTEGER,
    cause_of_flood TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT f.id, f.latitude, f.longitude, f.year, f.location_name,
           f.deaths_toll_int, f.cause_of_flood
    FROM data.floods f
    WHERE (p_year IS NULL OR f.year = p_year)
      AND (p_location_name IS NULL OR f.location_name = p_location_name)
      AND (p_deaths_toll_int IS NULL OR f.deaths_toll_int = p_deaths_toll_int)
      AND (p_flood_event_name IS NULL OR f.flood_event_name = p_flood_event_name)
    ORDER BY f.id;
$$;

CREATE FUNCTION api.api_floods_filter_years(
    p_location_name TEXT DEFAULT NULL,
    p_deaths_toll_int INTEGER DEFAULT NULL,
    p_flood_event_name TEXT DEFAULT NULL
)
RETURNS TABLE (year INTEGER)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT f.year
    FROM data.floods f
    WHERE f.year IS NOT NULL
      AND (p_location_name IS NULL OR f.location_name = p_location_name)
      AND (p_deaths_toll_int IS NULL OR f.deaths_toll_int = p_deaths_toll_int)
      AND (p_flood_event_name IS NULL OR f.flood_event_name = p_flood_event_name)
    ORDER BY f.year;
$$;

CREATE FUNCTION api.api_floods_filter_locations(
    p_year INTEGER DEFAULT NULL,
    p_deaths_toll_int INTEGER DEFAULT NULL,
    p_flood_event_name TEXT DEFAULT NULL
)
RETURNS TABLE (location_name TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT f.location_name
    FROM data.floods f
    WHERE f.location_name IS NOT NULL
      AND (p_year IS NULL OR f.year = p_year)
      AND (p_deaths_toll_int IS NULL OR f.deaths_toll_int = p_deaths_toll_int)
      AND (p_flood_event_name IS NULL OR f.flood_event_name = p_flood_event_name)
    ORDER BY f.location_name;
$$;

CREATE FUNCTION api.api_floods_filter_deaths_toll(
    p_year INTEGER DEFAULT NULL,
    p_location_name TEXT DEFAULT NULL,
    p_flood_event_name TEXT DEFAULT NULL
)
RETURNS TABLE (deaths_toll_int INTEGER)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT f.deaths_toll_int
    FROM data.floods f
    WHERE f.deaths_toll_int IS NOT NULL
      AND (p_year IS NULL OR f.year = p_year)
      AND (p_location_name IS NULL OR f.location_name = p_location_name)
      AND (p_flood_event_name IS NULL OR f.flood_event_name = p_flood_event_name)
    ORDER BY f.deaths_toll_int;
$$;

CREATE FUNCTION api.api_floods_filter_event_names(
    p_year INTEGER DEFAULT NULL,
    p_location_name TEXT DEFAULT NULL,
    p_deaths_toll_int INTEGER DEFAULT NULL
)
RETURNS TABLE (flood_event_name TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT f.flood_event_name
    FROM data.floods f
    WHERE f.flood_event_name IS NOT NULL
      AND (p_year IS NULL OR f.year = p_year)
      AND (p_location_name IS NULL OR f.location_name = p_location_name)
      AND (p_deaths_toll_int IS NULL OR f.deaths_toll_int = p_deaths_toll_int)
    ORDER BY f.flood_event_name;
$$;

CREATE FUNCTION api.api_floods_filter_causes(
    p_year INTEGER DEFAULT NULL,
    p_location_name TEXT DEFAULT NULL,
    p_deaths_toll_int INTEGER DEFAULT NULL
)
RETURNS TABLE (cause_of_flood TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT f.cause_of_flood
    FROM data.floods f
    WHERE f.cause_of_flood IS NOT NULL
      AND (p_year IS NULL OR f.year = p_year)
      AND (p_location_name IS NULL OR f.location_name = p_location_name)
      AND (p_deaths_toll_int IS NULL OR f.deaths_toll_int = p_deaths_toll_int)
    ORDER BY f.cause_of_flood;
$$;

CREATE FUNCTION api.api_floods_details(p_id BIGINT)
RETURNS TABLE (
    id BIGINT,
    date_of_commencement TEXT,
    year INTEGER,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_name TEXT,
    flood_event_name TEXT,
    deaths_toll_int INTEGER,
    rainfall_duration TEXT,
    cause_of_flood TEXT,
    rainfall_height TEXT,
    relevant_information TEXT,
    source TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT f.id, f.date_of_commencement, f.year, f.latitude, f.longitude,
           f.location_name, f.flood_event_name, f.deaths_toll_int,
           f.rainfall_duration, f.cause_of_flood, f.rainfall_height,
           f.relevant_information, f.source
    FROM data.floods f
    WHERE f.id = p_id;
$$;

CREATE FUNCTION api.api_lagoons_count()
RETURNS BIGINT
LANGUAGE sql STABLE
AS $$ SELECT count(*) FROM data.lagoons $$;

CREATE FUNCTION api.api_lagoons_markers(
    p_name_en TEXT DEFAULT NULL,
    p_location_en TEXT DEFAULT NULL,
    p_island_en TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    name_en TEXT,
    location_en TEXT,
    island_en TEXT,
    length_m DOUBLE PRECISION,
    width_m DOUBLE PRECISION,
    height_m DOUBLE PRECISION,
    perimeter_km2 DOUBLE PRECISION,
    area_km2 DOUBLE PRECISION,
    rcp2_6_slr DOUBLE PRECISION,
    rcp8_5_slr DOUBLE PRECISION,
    rcp2_6_vec_slr DOUBLE PRECISION,
    rcp8_5_vec_slr DOUBLE PRECISION,
    rcp2_6_inundated TEXT,
    rcp8_5_inundated TEXT,
    rcp2_6_vec_inundated TEXT,
    rcp8_5_vec_inundated TEXT,
    centroid_lat DOUBLE PRECISION,
    centroid_lng DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT l.id, l.name_en, l.location_en, l.island_en,
           l.length_m, l.width_m, l.height_m, l.perimeter_km2, l.area_km2,
           l.rcp2_6_slr, l.rcp8_5_slr, l.rcp2_6_vec_slr, l.rcp8_5_vec_slr,
           l.rcp2_6_inundated, l.rcp8_5_inundated,
           l.rcp2_6_vec_inundated, l.rcp8_5_vec_inundated,
           l.centroid_lat, l.centroid_lng
    FROM data.lagoons l
    WHERE (p_name_en IS NULL OR l.name_en = p_name_en)
      AND (p_location_en IS NULL OR l.location_en = p_location_en)
      AND (p_island_en IS NULL OR l.island_en = p_island_en)
      AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
      AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.name_en;
$$;

CREATE FUNCTION api.api_lagoons_polygons(
    p_name_en TEXT DEFAULT NULL,
    p_location_en TEXT DEFAULT NULL,
    p_island_en TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    name_en TEXT,
    location_en TEXT,
    island_en TEXT,
    area_km2 DOUBLE PRECISION,
    rcp2_6_inundated TEXT,
    rcp8_5_inundated TEXT,
    geojson TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT l.id, l.name_en, l.location_en, l.island_en, l.area_km2,
           l.rcp2_6_inundated, l.rcp8_5_inundated,
           ST_AsGeoJSON(l.geom)::TEXT
    FROM data.lagoons l
    WHERE l.geom IS NOT NULL
      AND (p_name_en IS NULL OR l.name_en = p_name_en)
      AND (p_location_en IS NULL OR l.location_en = p_location_en)
      AND (p_island_en IS NULL OR l.island_en = p_island_en)
      AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
      AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.name_en;
$$;

CREATE FUNCTION api.api_lagoons_details(p_id BIGINT)
RETURNS TABLE (
    id BIGINT,
    name_en TEXT,
    name_gr TEXT,
    location_en TEXT,
    island_en TEXT,
    length_m DOUBLE PRECISION,
    width_m DOUBLE PRECISION,
    height_m DOUBLE PRECISION,
    perimeter_km2 DOUBLE PRECISION,
    area_km2 DOUBLE PRECISION,
    rcp2_6_slr DOUBLE PRECISION,
    rcp8_5_slr DOUBLE PRECISION,
    rcp2_6_vec_slr DOUBLE PRECISION,
    rcp8_5_vec_slr DOUBLE PRECISION,
    rcp2_6_inundated TEXT,
    rcp8_5_inundated TEXT,
    rcp2_6_vec_inundated TEXT,
    rcp8_5_vec_inundated TEXT,
    data_quality TEXT,
    centroid_lat DOUBLE PRECISION,
    centroid_lng DOUBLE PRECISION,
    geojson TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT l.id, l.name_en, l.name_gr, l.location_en, l.island_en,
           l.length_m, l.width_m, l.height_m, l.perimeter_km2, l.area_km2,
           l.rcp2_6_slr, l.rcp8_5_slr, l.rcp2_6_vec_slr, l.rcp8_5_vec_slr,
           l.rcp2_6_inundated, l.rcp8_5_inundated,
           l.rcp2_6_vec_inundated, l.rcp8_5_vec_inundated,
           l.data_quality, l.centroid_lat, l.centroid_lng,
           ST_AsGeoJSON(l.geom)::TEXT
    FROM data.lagoons l
    WHERE l.id = p_id;
$$;

CREATE FUNCTION api.api_lagoons_preview_geometry(p_id BIGINT)
RETURNS TABLE (
    id BIGINT,
    centroid_lat DOUBLE PRECISION,
    centroid_lng DOUBLE PRECISION,
    geojson TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT l.id, l.centroid_lat, l.centroid_lng, ST_AsGeoJSON(l.geom)::TEXT
    FROM data.lagoons l
    WHERE l.id = p_id;
$$;

CREATE FUNCTION api.api_lagoons_filter_names(
    p_location_en TEXT DEFAULT NULL,
    p_island_en TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (name_en TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT l.name_en
    FROM data.lagoons l
    WHERE l.name_en IS NOT NULL
      AND (p_location_en IS NULL OR l.location_en = p_location_en)
      AND (p_island_en IS NULL OR l.island_en = p_island_en)
      AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
      AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.name_en;
$$;

CREATE FUNCTION api.api_lagoons_filter_locations(
    p_name_en TEXT DEFAULT NULL,
    p_island_en TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (location_en TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT l.location_en
    FROM data.lagoons l
    WHERE l.location_en IS NOT NULL
      AND (p_name_en IS NULL OR l.name_en = p_name_en)
      AND (p_island_en IS NULL OR l.island_en = p_island_en)
      AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
      AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.location_en;
$$;

CREATE FUNCTION api.api_lagoons_filter_islands(
    p_name_en TEXT DEFAULT NULL,
    p_location_en TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (island_en TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT l.island_en
    FROM data.lagoons l
    WHERE l.island_en IS NOT NULL
      AND (p_name_en IS NULL OR l.name_en = p_name_en)
      AND (p_location_en IS NULL OR l.location_en = p_location_en)
      AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
      AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.island_en;
$$;

CREATE FUNCTION api.api_lagoons_filter_rcp26(
    p_name_en TEXT DEFAULT NULL,
    p_location_en TEXT DEFAULT NULL,
    p_island_en TEXT DEFAULT NULL,
    p_rcp8_5_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (rcp2_6_inundated TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT l.rcp2_6_inundated
    FROM data.lagoons l
    WHERE l.rcp2_6_inundated IS NOT NULL
      AND (p_name_en IS NULL OR l.name_en = p_name_en)
      AND (p_location_en IS NULL OR l.location_en = p_location_en)
      AND (p_island_en IS NULL OR l.island_en = p_island_en)
      AND (p_rcp8_5_inundated IS NULL OR l.rcp8_5_inundated = p_rcp8_5_inundated)
    ORDER BY l.rcp2_6_inundated;
$$;

CREATE FUNCTION api.api_lagoons_filter_rcp85(
    p_name_en TEXT DEFAULT NULL,
    p_location_en TEXT DEFAULT NULL,
    p_island_en TEXT DEFAULT NULL,
    p_rcp2_6_inundated TEXT DEFAULT NULL
)
RETURNS TABLE (rcp8_5_inundated TEXT)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT l.rcp8_5_inundated
    FROM data.lagoons l
    WHERE l.rcp8_5_inundated IS NOT NULL
      AND (p_name_en IS NULL OR l.name_en = p_name_en)
      AND (p_location_en IS NULL OR l.location_en = p_location_en)
      AND (p_island_en IS NULL OR l.island_en = p_island_en)
      AND (p_rcp2_6_inundated IS NULL OR l.rcp2_6_inundated = p_rcp2_6_inundated)
    ORDER BY l.rcp8_5_inundated;
$$;

REVOKE ALL ON SCHEMA data FROM PUBLIC;
REVOKE ALL ON SCHEMA api FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA data FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA api FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api FROM PUBLIC;

GRANT USAGE ON SCHEMA data, api TO webgis_anon;
GRANT SELECT ON data.floods, data.lagoons, data.beachrocks, data.tombolos TO webgis_anon;
GRANT SELECT ON api.beachrocks, api.tombolos TO webgis_anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO webgis_anon;

ANALYZE data.floods;
ANALYZE data.lagoons;
ANALYZE data.beachrocks;
ANALYZE data.tombolos;


CREATE OR REPLACE FUNCTION api.api_floods_months()
RETURNS TABLE (id BIGINT, month INTEGER)
LANGUAGE sql STABLE
AS $$
    SELECT f.id,
           CASE WHEN f.date_of_commencement ~ '^[0-9]{4}-(0[1-9]|1[0-2])(-[0-9]{2})?$'
                THEN split_part(f.date_of_commencement, '-', 2)::INTEGER
                ELSE NULL
           END AS month
    FROM data.floods f
    ORDER BY f.id;
$$;

REVOKE ALL ON FUNCTION api.api_floods_months() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.api_floods_months() TO webgis_anon;
NOTIFY pgrst, 'reload schema';

