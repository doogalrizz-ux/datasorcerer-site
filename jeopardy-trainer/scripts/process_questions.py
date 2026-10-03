"""
process_questions.py
One-time script to pre-process 200k_questions.json into SQL for Cloudflare D1 import.
Usage: python process_questions.py path/to/200k_questions.json
Output (next to this script): import_batch1.sql (up to 99k rows)
                              import_batch2.sql (remainder)
"""

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

SOURCE = sys.argv[1] if len(sys.argv) > 1 else "200k_questions.json"
OUT_DIR = Path(__file__).resolve().parent
BATCH_SIZE = 90000  # stay under 100k/day D1 limit with margin

print("Loading questions...")
with open(SOURCE, "r", encoding="utf-8") as f:
    data = json.load(f)
print(f"Loaded {len(data):,} total questions")

# ── Step 1: Group by show + round + category ──────────────────────────────────
def has_media(text):
    """Return True if question requires external media (video/audio clips)."""
    t = str(text)
    return "<a href=" in t or "j-archive.com/media" in t

def strip_html(text):
    """Remove HTML tags and clean up whitespace."""
    t = str(text)
    t = re.sub(r'<[^>]+>', ' ', t)   # remove all tags
    t = re.sub(r'\s+', ' ', t)        # collapse whitespace
    return t.strip()

groups = defaultdict(list)
media_skipped = 0
for item in data:
    if item["round"] not in ("Jeopardy!", "Double Jeopardy!", "Final Jeopardy!"):
        continue
    if item["value"] is None and item["round"] != "Final Jeopardy!":
        continue
    if has_media(item.get("question", "")):
        media_skipped += 1
        continue
    item["question"] = strip_html(item.get("question", ""))
    item["answer"]   = strip_html(item.get("answer", ""))
    key = (item["show_number"], item["round"], item["category"])
    groups[key].append(item)

print(f"Skipped {media_skipped:,} media-dependent clues")

# ── Step 2: Find complete Jeopardy/Double Jeopardy categories (exactly 5 Qs) ──
complete = defaultdict(lambda: defaultdict(list))  # show -> round -> [categories]
for (show, rnd, cat), items in groups.items():
    if rnd == "Jeopardy!" and len(items) == 5:
        # Sort by original value ascending
        def parse_val(v):
            try:
                return int(v.replace("$", "").replace(",", ""))
            except:
                return 0
        items_sorted = sorted(items, key=lambda x: parse_val(x["value"]))
        complete[show]["J"].append((cat, items_sorted))
    elif rnd == "Double Jeopardy!" and len(items) == 5:
        def parse_val(v):
            try:
                return int(v.replace("$", "").replace(",", ""))
            except:
                return 0
        items_sorted = sorted(items, key=lambda x: parse_val(x["value"]))
        complete[show]["DJ"].append((cat, items_sorted))

# ── Step 3: Collect Final Jeopardy questions per show ─────────────────────────
final_jeopardy = {}
for (show, rnd, cat), items in groups.items():
    if rnd == "Final Jeopardy!" and show not in final_jeopardy:
        final_jeopardy[show] = (cat, items[0])

# ── Step 4: Find valid shows (>=3 complete J cats AND >=3 complete DJ cats) ───
valid_shows = {}
for show, rounds in complete.items():
    j_cats = rounds.get("J", [])
    dj_cats = rounds.get("DJ", [])
    if len(j_cats) >= 3 and len(dj_cats) >= 3:
        # Get air_date from first question
        first_q = j_cats[0][1][0]
        valid_shows[show] = {
            "air_date": first_q["air_date"],
            "j_cats": j_cats,
            "dj_cats": dj_cats,
            "has_final": show in final_jeopardy
        }

print(f"Valid shows found: {len(valid_shows):,}")
has_final = sum(1 for v in valid_shows.values() if v["has_final"])
print(f"  With Final Jeopardy: {has_final:,}")

# ── Step 5: Generate SQL ──────────────────────────────────────────────────────

def escape(s):
    """Escape single quotes for SQL."""
    return str(s).replace("'", "''")

schema_sql = """-- Jeopardy Trainer Schema
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
"""

schema_path = os.path.join(OUT_DIR, "schema.sql")
with open(schema_path, "w", encoding="utf-8") as f:
    f.write(schema_sql)
print(f"Schema written to {schema_path}")

# Build all INSERT rows
question_rows = []
valid_show_rows = []

for show_number, show_data in valid_shows.items():
    air_date = show_data["air_date"]
    j_cat_names = [cat for cat, _ in show_data["j_cats"]]
    dj_cat_names = [cat for cat, _ in show_data["dj_cats"]]

    valid_show_rows.append(
        f"('{escape(show_number)}', '{escape(air_date)}', "
        f"'{escape(json.dumps(j_cat_names))}', '{escape(json.dumps(dj_cat_names))}', "
        f"{1 if show_data['has_final'] else 0})"
    )

    # Jeopardy questions
    for cat, items in show_data["j_cats"]:
        for i, item in enumerate(items, 1):
            question_rows.append(
                f"('{escape(show_number)}', '{escape(air_date)}', 'J', "
                f"'{escape(cat)}', '{escape(item['question'])}', "
                f"'{escape(item['answer'])}', {i})"
            )

    # Double Jeopardy questions
    for cat, items in show_data["dj_cats"]:
        for i, item in enumerate(items, 1):
            question_rows.append(
                f"('{escape(show_number)}', '{escape(air_date)}', 'DJ', "
                f"'{escape(cat)}', '{escape(item['question'])}', "
                f"'{escape(item['answer'])}', {i})"
            )

    # Final Jeopardy
    if show_data["has_final"]:
        fj_cat, fj_item = final_jeopardy[show_number]
        question_rows.append(
            f"('{escape(show_number)}', '{escape(air_date)}', 'FJ', "
            f"'{escape(fj_cat)}', '{escape(fj_item['question'])}', "
            f"'{escape(fj_item['answer'])}', NULL)"
        )

print(f"Total question rows to insert: {len(question_rows):,}")
print(f"Total valid_show rows to insert: {len(valid_show_rows):,}")

def write_batched_sql(path, table, columns, rows):
    """Write one INSERT statement per row — most compatible with D1 API limits."""
    col_str = f"INSERT INTO {table} ({columns}) VALUES"
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(f"{col_str} {row};\n")

# Write valid_shows — split into 500-row INSERT statements
vs_path = os.path.join(OUT_DIR, "import_valid_shows.sql")
write_batched_sql(vs_path, "valid_shows",
    "show_number, air_date, j_categories, dj_categories, has_final",
    valid_show_rows)
print(f"Valid shows SQL written to {vs_path} ({len(valid_show_rows):,} rows)")

# Write question rows in file-batches, each file has multiple 500-row INSERT statements
batch_num = 1
for batch_start in range(0, len(question_rows), BATCH_SIZE):
    batch = question_rows[batch_start:batch_start + BATCH_SIZE]
    batch_path = os.path.join(OUT_DIR, f"import_questions_batch{batch_num}.sql")
    write_batched_sql(batch_path, "questions",
        "show_number, air_date, round, category, question, answer, sort_order",
        batch)
    print(f"Batch {batch_num} written to {batch_path} ({len(batch):,} rows)")
    batch_num += 1

print("\nDone! Next steps:")
print("  1. npx wrangler d1 create jeopardy-db")
print("  2. npx wrangler d1 execute jeopardy-db --file=jeopardy-trainer/scripts/schema.sql")
print("  3. npx wrangler d1 execute jeopardy-db --file=jeopardy-trainer/scripts/import_valid_shows.sql")
print("  4. npx wrangler d1 execute jeopardy-db --file=jeopardy-trainer/scripts/import_questions_batch1.sql")
print("  (repeat for additional batches if present)")
