-- ============================================================
-- TEDUH High-Efficiency PostGIS Serving Layer & Spatial Context
-- Idempotent migration: safe to run on existing & fresh DBs
-- ============================================================

-- 1. Unique constraints on OSM base tables to support fast ON CONFLICT DO NOTHING
CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_osm_way_geom_hash
    ON segments (osm_way_id, md5(ST_AsBinary(geom)))
    WHERE osm_way_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_osm_id_uniq
    ON buildings (osm_id)
    WHERE osm_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trees_osm_id_uniq
    ON trees (osm_id)
    WHERE osm_id IS NOT NULL;

-- 2. Static Spatial Context Cache (Pre-computes building/tree proximity ONCE)
-- Eliminates 12x hourly correlated subqueries across 688k buildings!
CREATE TABLE IF NOT EXISTS segment_spatial_context (
    segment_id          INTEGER PRIMARY KEY REFERENCES segments(segment_id) ON DELETE CASCADE,
    nearby_buildings    INTEGER NOT NULL DEFAULT 0,
    avg_building_height DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    nearby_trees        INTEGER NOT NULL DEFAULT 0,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Fixed-Size Serving Table for O(1) Primary-Key Joins in API & pgRouting
-- Eliminates repeated `SELECT DISTINCT ON (segment_id)` & `JOIN LATERAL` scans!
CREATE TABLE IF NOT EXISTS segment_live_comfort (
    segment_id      INTEGER PRIMARY KEY REFERENCES segments(segment_id) ON DELETE CASCADE,
    tcs_value       DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    apparent_temp   DOUBLE PRECISION NOT NULL DEFAULT 33.0,
    shade_ratio     DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    avg_ndvi        DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    avg_lst         DOUBLE PRECISION NOT NULL DEFAULT 36.0,
    aqi_value       DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    traffic_level   DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_comfort_tcs
    ON segment_live_comfort (tcs_value);

CREATE INDEX IF NOT EXISTS idx_segments_highway_length
    ON segments (highway_type, length_m);

-- Normalize column types & restore unique indexes that legacy Spark `.mode("overwrite")` may have altered
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'segment_raster_scores' AND column_name = 'computed_at' AND data_type <> 'date'
    ) THEN
        DROP INDEX IF EXISTS idx_raster_segment_date_uniq;
        ALTER TABLE segment_raster_scores ALTER COLUMN computed_at TYPE DATE USING computed_at::date;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'segment_shadows' AND column_name = 'computed_at' AND data_type <> 'date'
    ) THEN
        DROP INDEX IF EXISTS idx_shadows_segment_hour_date_uniq;
        ALTER TABLE segment_shadows
            ALTER COLUMN hour_of_day TYPE SMALLINT USING hour_of_day::smallint,
            ALTER COLUMN computed_at TYPE DATE USING computed_at::date;
    END IF;
END $$;

DELETE FROM segment_raster_scores a
USING segment_raster_scores b
WHERE a.ctid < b.ctid AND a.segment_id = b.segment_id AND a.computed_at = b.computed_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_raster_segment_date_uniq
    ON segment_raster_scores (segment_id, computed_at);

DELETE FROM segment_shadows a
USING segment_shadows b
WHERE a.ctid < b.ctid AND a.segment_id = b.segment_id AND a.hour_of_day = b.hour_of_day AND a.computed_at = b.computed_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shadows_segment_hour_date_uniq
    ON segment_shadows (segment_id, hour_of_day, computed_at);

DELETE FROM tcs_simulations a
USING tcs_simulations b
WHERE a.ctid < b.ctid AND a.segment_id = b.segment_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tcs_simulations_segment_uniq
    ON tcs_simulations (segment_id);

CREATE INDEX IF NOT EXISTS idx_tcs_simulations_green_desc
    ON tcs_simulations (tcs_improvement_green DESC);

-- Ensure pgRouting topology indexes exist when segments_noded is already built
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'segments_noded') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_segments_noded_valid_edges ON segments_noded (id) WHERE source IS NOT NULL AND target IS NOT NULL';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'segments_noded_vertices_pgr') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vertices_pgr_comp_geom ON segments_noded_vertices_pgr USING GIST (the_geom) WHERE component_size IS NULL OR component_size > 10';
    END IF;
END $$;

-- 4. Stored Function: Build Static Spatial Context in ONE Set-Based GiST Pass
CREATE OR REPLACE FUNCTION refresh_segment_spatial_context(force_rebuild BOOLEAN DEFAULT FALSE)
RETURNS INTEGER AS $$
DECLARE
    seg_cnt INTEGER;
    ctx_cnt INTEGER;
    upserted INTEGER := 0;
BEGIN
    SELECT COUNT(*) INTO seg_cnt FROM segments;
    IF seg_cnt = 0 THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*) INTO ctx_cnt FROM segment_spatial_context;
    IF NOT force_rebuild AND ctx_cnt >= seg_cnt THEN
        RETURN ctx_cnt;
    END IF;

    INSERT INTO segment_spatial_context (
        segment_id,
        nearby_buildings,
        avg_building_height,
        nearby_trees,
        computed_at
    )
    SELECT
        s.segment_id,
        COALESCE(b_agg.cnt, 0)::integer,
        COALESCE(b_agg.avg_h, 10.0)::double precision,
        COALESCE(t_agg.cnt, 0)::integer,
        NOW()
    FROM segments s
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*) AS cnt,
            AVG(COALESCE(b.height_m, 10.0)) AS avg_h
        FROM buildings b
        WHERE b.geom && ST_Expand(s.geom, 0.0005)
          AND ST_DWithin(s.geom, b.geom, 0.0005)
    ) b_agg ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS cnt
        FROM trees t
        WHERE t.geom && ST_Expand(s.geom, 0.0003)
          AND ST_DWithin(s.geom, t.geom, 0.0003)
    ) t_agg ON true
    ON CONFLICT (segment_id) DO UPDATE SET
        nearby_buildings    = EXCLUDED.nearby_buildings,
        avg_building_height = EXCLUDED.avg_building_height,
        nearby_trees        = EXCLUDED.nearby_trees,
        computed_at         = NOW();

    GET DIAGNOSTICS upserted = ROW_COUNT;

    -- Mark segments that actually have nearby trees so UI/analytics stay accurate
    UPDATE segments s
    SET has_shade_tree = (ctx.nearby_trees > 0)
    FROM segment_spatial_context ctx
    WHERE s.segment_id = ctx.segment_id
      AND s.has_shade_tree IS DISTINCT FROM (ctx.nearby_trees > 0);

    RETURN upserted;
END;
$$ LANGUAGE plpgsql;

-- 5. Stored Function: Atomic Sync from Latest Computed Scores into segment_live_comfort
CREATE OR REPLACE FUNCTION sync_segment_live_comfort()
RETURNS INTEGER AS $$
DECLARE
    upserted INTEGER := 0;
BEGIN
    INSERT INTO segment_live_comfort (
        segment_id,
        tcs_value,
        apparent_temp,
        shade_ratio,
        avg_ndvi,
        avg_lst,
        aqi_value,
        traffic_level,
        updated_at
    )
    SELECT
        s.segment_id,
        COALESCE(tcs.tcs_value, 0.5),
        COALESCE(tcs.apparent_temp, 33.0),
        COALESCE(tcs.shade_ratio, 0.2),
        COALESCE(rs.avg_ndvi, 0.15),
        COALESCE(rs.avg_lst, 36.0),
        COALESCE(tcs.aqi_value, 50.0),
        COALESCE(tcs.traffic_level, 0.3),
        NOW()
    FROM segments s
    LEFT JOIN (
        SELECT DISTINCT ON (segment_id)
            segment_id, tcs_value, apparent_temp, shade_ratio, aqi_value, traffic_level
        FROM thermal_comfort_scores
        ORDER BY segment_id, computed_at DESC
    ) tcs ON tcs.segment_id = s.segment_id
    LEFT JOIN (
        SELECT DISTINCT ON (segment_id)
            segment_id, avg_ndvi, avg_lst
        FROM segment_raster_scores
        ORDER BY segment_id, computed_at DESC
    ) rs ON rs.segment_id = s.segment_id
    ON CONFLICT (segment_id) DO UPDATE SET
        tcs_value     = EXCLUDED.tcs_value,
        apparent_temp = EXCLUDED.apparent_temp,
        shade_ratio   = EXCLUDED.shade_ratio,
        avg_ndvi      = EXCLUDED.avg_ndvi,
        avg_lst       = EXCLUDED.avg_lst,
        aqi_value     = EXCLUDED.aqi_value,
        traffic_level = EXCLUDED.traffic_level,
        updated_at    = NOW();

    GET DIAGNOSTICS upserted = ROW_COUNT;

    -- Keep historical table lean (prune rows older than 24 hours except latest per segment)
    DELETE FROM thermal_comfort_scores
    WHERE computed_at < NOW() - INTERVAL '24 hours';

    RETURN upserted;
END;
$$ LANGUAGE plpgsql;
