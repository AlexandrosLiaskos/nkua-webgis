BEGIN;

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

COMMIT;
