-- Jeopardy Trainer Schema
-- Run this first: wrangler d1 execute jeopardy-db --file=schema.sql

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_number TEXT NOT NULL,
  air_date TEXT NOT NULL,
  round TEXT NOT NULL,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER
);

CREATE TABLE IF NOT EXISTS valid_shows (
  show_number TEXT PRIMARY KEY,
  air_date TEXT NOT NULL,
  j_categories TEXT NOT NULL,
  dj_categories TEXT NOT NULL,
  has_final INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  played_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_show ON questions(show_number);
CREATE INDEX IF NOT EXISTS idx_questions_round_cat ON questions(show_number, round, category);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(game_date, score DESC);
