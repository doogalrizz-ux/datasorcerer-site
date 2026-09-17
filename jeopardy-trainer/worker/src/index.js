/**
 * Jeopardy Trainer API — Cloudflare Worker
 * Routes:
 *   GET  /api/game        — returns a random complete game
 *   POST /api/score       — saves a score { player_name, score }
 *   GET  /api/leaderboard — returns today's top 10 scores
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

// J round game values by sort_order (1-5)
const J_VALUES  = [200, 400, 600, 800, 1000];
// DJ round game values by sort_order (1-5)
const DJ_VALUES = [400, 800, 1200, 1600, 2000];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/game" && request.method === "GET") {
      return handleGetGame(env);
    }

    if (url.pathname === "/api/score" && request.method === "POST") {
      return handlePostScore(request, env);
    }

    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      return handleGetLeaderboard(env);
    }

    return error("Not found", 404);
  },
};

// ── GET /api/game ─────────────────────────────────────────────────────────────
async function handleGetGame(env) {
  // Pick a random valid show
  const showRow = await env.DB.prepare(
    "SELECT * FROM valid_shows ORDER BY RANDOM() LIMIT 1"
  ).first();

  if (!showRow) return error("No shows available", 500);

  const showNumber = showRow.show_number;
  const airDate    = showRow.air_date;

  // Parse category lists
  const allJCats  = JSON.parse(showRow.j_categories);
  const allDJCats = JSON.parse(showRow.dj_categories);

  // Shuffle and pick 3 of each
  const jCats  = shuffle(allJCats).slice(0, 3);
  const djCats = shuffle(allDJCats).slice(0, 3);

  // Fetch all J questions for selected categories
  const jPlaceholders  = jCats.map(() => "?").join(",");
  const djPlaceholders = djCats.map(() => "?").join(",");

  const jRows = await env.DB.prepare(
    `SELECT * FROM questions
     WHERE show_number = ? AND round = 'J' AND category IN (${jPlaceholders})
     ORDER BY category, sort_order`
  ).bind(showNumber, ...jCats).all();

  const djRows = await env.DB.prepare(
    `SELECT * FROM questions
     WHERE show_number = ? AND round = 'DJ' AND category IN (${djPlaceholders})
     ORDER BY category, sort_order`
  ).bind(showNumber, ...djCats).all();

  // Fetch Final Jeopardy
  const fjRow = await env.DB.prepare(
    `SELECT * FROM questions WHERE show_number = ? AND round = 'FJ' LIMIT 1`
  ).bind(showNumber).first();

  // Build ordered question list: J cats in order, then DJ cats in order
  const questions = [];

  for (const cat of jCats) {
    const catQs = jRows.results.filter(r => r.category === cat);
    for (const q of catQs) {
      questions.push({
        round:    "J",
        category: q.category,
        value:    J_VALUES[q.sort_order - 1],
        question: q.question,
        answer:   q.answer,
        air_date: airDate,
      });
    }
  }

  for (const cat of djCats) {
    const catQs = djRows.results.filter(r => r.category === cat);
    for (const q of catQs) {
      questions.push({
        round:    "DJ",
        category: q.category,
        value:    DJ_VALUES[q.sort_order - 1],
        question: q.question,
        answer:   q.answer,
        air_date: airDate,
      });
    }
  }

  const finalJeopardy = fjRow
    ? { category: fjRow.category, question: fjRow.question, answer: fjRow.answer, air_date: airDate }
    : null;

  return json({ show_number: showNumber, air_date: airDate, questions, finalJeopardy });
}

// ── POST /api/score ───────────────────────────────────────────────────────────
async function handlePostScore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON");
  }

  const { player_name, score } = body;
  if (!player_name || typeof score !== "number") {
    return error("Missing player_name or score");
  }

  const name = String(player_name).trim().slice(0, 50);
  if (!name) return error("player_name cannot be empty");

  const today = todayUTC();
  const now   = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO scores (player_name, score, game_date, played_at) VALUES (?, ?, ?, ?)"
  ).bind(name, Math.round(score), today, now).run();

  return json({ ok: true });
}

// ── GET /api/leaderboard ──────────────────────────────────────────────────────
async function handleGetLeaderboard(env) {
  const today = todayUTC();

  const result = await env.DB.prepare(
    `SELECT player_name, score, played_at
     FROM scores
     WHERE game_date = ?
     ORDER BY score DESC
     LIMIT 10`
  ).bind(today).all();

  return json({ date: today, scores: result.results });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
