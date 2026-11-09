-- ============================================================
-- TEDUH Feature Set Schema Migration
-- PostgreSQL + PostGIS + pgRouting
-- ============================================================

-- Enable uuid-ossp extension if not already enabled (should be from init.sql)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- TABEL 1: Laporan insiden dari user
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incident_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID,                    -- bisa anonim (nullable)
  lat               DECIMAL(10, 7) NOT NULL,
  lon               DECIMAL(10, 7) NOT NULL,
  segment_id        INTEGER REFERENCES segments(segment_id), -- Snap PostGIS ke segment jalan (INTEGER)
  category          VARCHAR(50) NOT NULL,    -- 'construction', 'road_closed', 'accident', 'damaged', 'flood', 'heat'
  description       TEXT NOT NULL,           -- deskripsi awal / dari AI
  severity          VARCHAR(20),             -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  image_url         TEXT,                    -- URL foto di MinIO / storage
  ai_suggested      BOOLEAN DEFAULT FALSE,
  ai_confidence     DECIMAL(4,3),
  status            VARCHAR(30) DEFAULT 'PENDING_REVIEW', -- 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'EXPIRED'
  approved_by       UUID,                    -- operator gov (nullable)
  approved_at       TIMESTAMPTZ,
  final_description TEXT,                    -- deskripsi final setelah gov edit
  rejected_by       UUID,
  rejected_reason   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indeks untuk query status laporan
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports(status);

-- ─────────────────────────────────────────────────────────────
-- TABEL 2: Alert aktif yang tampil di peta
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS map_alerts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id         UUID REFERENCES incident_reports(id) ON DELETE SET NULL,
  lat               DECIMAL(10, 7) NOT NULL,
  lon               DECIMAL(10, 7) NOT NULL,
  geom              GEOMETRY(Point, 4326),   -- PostGIS geometry point
  category          VARCHAR(50) NOT NULL,
  icon_type         VARCHAR(30) NOT NULL,    -- 'construction', 'accident', 'road_closed', dll
  description       TEXT NOT NULL,
  image_url         TEXT,
  severity          VARCHAR(20),
  status            VARCHAR(30) DEFAULT 'ACTIVE', -- 'ACTIVE' | 'AUTO_REMOVED' | 'MANUALLY_REMOVED'
  auto_remove_threshold DECIMAL(4,3) DEFAULT 0.70,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  removed_at        TIMESTAMPTZ,
  removed_reason    TEXT
);

-- Spatial index untuk query kueri koordinat / jarak dekat (proximity)
CREATE INDEX IF NOT EXISTS idx_map_alerts_geom ON map_alerts USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_map_alerts_status ON map_alerts(status);

-- ─────────────────────────────────────────────────────────────
-- TABEL 3: Respons validasi dari user yang melewati alert
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_validations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id      UUID REFERENCES map_alerts(id) ON DELETE CASCADE,
  user_id       UUID,
  response      VARCHAR(20) NOT NULL,     -- 'still_active' | 'no_longer_active'
  validated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_alert_user UNIQUE(alert_id, user_id) -- 1 user hanya bisa kasih 1 rating per alert
);

-- Indeks untuk membantu kalkulasi rating rata-rata per alert
CREATE INDEX IF NOT EXISTS idx_validations_alert ON alert_validations(alert_id);

-- ─────────────────────────────────────────────────────────────
-- TABEL 4: Feedback akhir perjalanan
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_feedback (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID,
  route_id        UUID,
  tcs_predicted   DECIMAL(4,3),
  rating_thermal  SMALLINT CHECK (rating_thermal BETWEEN 1 AND 5),
  rating_shade    SMALLINT CHECK (rating_shade BETWEEN 1 AND 5),
  rating_walkway  SMALLINT CHECK (rating_walkway BETWEEN 1 AND 5),
  has_unreported  BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
