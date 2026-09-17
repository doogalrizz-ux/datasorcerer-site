CREATE TABLE IF NOT EXISTS circuits (
  circuit_id      INTEGER PRIMARY KEY,
  circuit_ref     TEXT,
  circuit_name    TEXT,
  country         TEXT,
  meters_above_sl INTEGER
);

CREATE TABLE IF NOT EXISTS drivers (
  driver_id   INTEGER PRIMARY KEY,
  driver_ref  TEXT,
  pref_num    TEXT,
  driver_code TEXT,
  firstname   TEXT,
  lastname    TEXT,
  birthdate   TEXT,
  nationality TEXT
);

CREATE TABLE IF NOT EXISTS races (
  race_id    INTEGER PRIMARY KEY,
  race_year  INTEGER,
  round      INTEGER,
  circuit_id INTEGER,
  race_name  TEXT,
  race_date  TEXT
);

CREATE TABLE IF NOT EXISTS results (
  result_id       INTEGER PRIMARY KEY,
  race_id         INTEGER,
  driver_id       INTEGER,
  constructor_id  INTEGER,
  car_number      TEXT,
  grid            INTEGER,
  finish          TEXT,
  finish_text     TEXT,
  finish_order    INTEGER,
  points_awarded  REAL,
  laps_completed  INTEGER,
  finish_status   INTEGER
);