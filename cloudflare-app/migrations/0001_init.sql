-- Field To Forest Environmental Consulting (D1 SQLite Schema)

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'new', -- new | quoted | converted | archived
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  site_address TEXT,
  lot_number TEXT,
  plan_label TEXT,
  service_type TEXT NOT NULL DEFAULT 'ossm_s68',
  bedrooms INTEGER,
  notes TEXT,
  spatial_precheck_json TEXT,
  converted_job_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'precheck', -- precheck | field | drafted | qa | lodged | approved
  applicant_name TEXT NOT NULL,
  site_address TEXT NOT NULL,
  lot_number TEXT NOT NULL,
  plan_label TEXT NOT NULL,
  lga TEXT NOT NULL DEFAULT 'Lismore City Council',
  assessment_json TEXT NOT NULL,
  spatial_json TEXT,
  model_result_json TEXT,
  audit_result_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_lot_plan ON jobs(lot_number, plan_label);

CREATE TABLE IF NOT EXISTS job_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL, -- photo | audio | docx | dxf | gis_map | cad_plan | audit_json
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL UNIQUE,
  caption TEXT,
  lat REAL,
  lon REAL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_files_job ON job_files(job_id);
