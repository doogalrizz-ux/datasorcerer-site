const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ── Questions & canonical answers ────────────────────────────────────────────
const QUESTIONS = [
  {
    id: 1,
    question: "Who were the 5 most successful drivers of all time?",
    hint: "Think about what 'successful' means in racing. Consider the results table and finish positions.",
    // Expected: top 5 driver names by win count
    expectedNames: ["Lewis Hamilton", "Michael Schumacher", "Sebastian Vettel", "Alain Prost", "Max Verstappen"],
    checkCol: 0,   // which column index to extract names from
    checkType: "names",
  },
  {
    id: 2,
    question: "Who were the top 5 drivers that never won a race?",
    hint: "You need drivers with zero wins but the most race starts. HAVING is your friend.",
    expectedNames: ["Andrea de Cesaris", "Nico Hulkenberg", "Nick Heidfeld", "Romain Grosjean", "Martin Brundle"],
    checkCol: 0,
    checkType: "names",
  },
  {
    id: 3,
    question: "What country was the most successful in the history of F1?",
    hint: "Driver nationality lives in the drivers table. Wins are finish_order = 1 in the results table.",
    expectedNames: ["British"],
    checkCol: 0,
    checkType: "contains",  // result must contain this value anywhere in first column
  },
  {
    id: 4,
    question: "If the point system was 9-6-4-3-2-1 for positions 1-6 for the entire history of F1, who averaged the most points per race?",
    hint: "Use CASE WHEN for the points. Watch for drivers with very few races skewing the average — defend your minimum race threshold.",
    expectedNames: ["Juan Fangio"],  // most compelling answer with meaningful career
    checkCol: 0,
    checkType: "open",  // open-ended — show expected, don't fail on mismatch
  },
];

const SCHEMA = {
  tables: [
    {
      name: "circuits",
      columns: ["circuit_id", "circuit_ref", "circuit_name", "country", "meters_above_sl"],
    },
    {
      name: "drivers",
      columns: ["driver_id", "driver_ref", "pref_num", "driver_code", "firstname", "lastname", "birthdate", "nationality"],
    },
    {
      name: "races",
      columns: ["race_id", "race_year", "round", "circuit_id", "race_name", "race_date"],
    },
    {
      name: "results",
      columns: ["result_id", "race_id", "driver_id", "constructor_id", "car_number", "grid",
                "finish", "finish_text", "finish_order", "points_awarded", "laps_completed", "finish_status"],
    },
  ],
};

// ── SQL safety ────────────────────────────────────────────────────────────────
const BLOCKED = /\b(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH|DETACH|PRAGMA|VACUUM)\b/i;

function validateQuery(sql) {
  const trimmed = sql.trim();
  if (!trimmed.toUpperCase().startsWith("SELECT")) {
    return "Query must start with SELECT.";
  }
  if (BLOCKED.test(trimmed)) {
    return "Query contains disallowed keywords.";
  }
  return null;
}

function wrapWithLimit(sql) {
  // Wrap in subquery to enforce row cap without breaking existing LIMIT/ORDER BY
  return `SELECT * FROM (${sql.trim().replace(/;+$/, "")}) LIMIT 500`;
}

// ── Answer checking ───────────────────────────────────────────────────────────
function checkAnswer(question, rows) {
  if (rows.length === 0) return { pass: false, message: "Query returned no rows." };

  const { checkType, expectedNames } = question;
  const firstColValues = rows.map(r => String(Object.values(r)[0]).trim());

  if (checkType === "open") {
    return {
      pass: null,
      message: "Open-ended question — any well-reasoned methodology is valid. See expected answer below.",
    };
  }

  if (checkType === "contains") {
    const hit = firstColValues.some(v =>
      expectedNames.some(e => v.toLowerCase().includes(e.toLowerCase()))
    );
    return hit
      ? { pass: true, message: "Correct! Your result matches the expected answer." }
      : { pass: false, message: `Expected result to include: ${expectedNames.join(", ")}` };
  }

  // "names" — compare sorted lists
  const got = [...firstColValues].sort();
  const want = [...expectedNames].sort();
  const pass = want.every(name => got.some(g => g.toLowerCase() === name.toLowerCase()));
  return pass
    ? { pass: true, message: "Correct! All expected names found in your result." }
    : {
        pass: false,
        message: `Not quite. Expected: ${expectedNames.join(", ")}. Got: ${firstColValues.join(", ")}`,
      };
}

// ── Router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // GET /api/questions
    if (url.pathname === "/api/questions" && request.method === "GET") {
      return json({
        questions: QUESTIONS.map(q => ({ id: q.id, question: q.question, hint: q.hint })),
        schema: SCHEMA,
      });
    }

    // POST /api/run  — run a query, return results
    if (url.pathname === "/api/run" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const rawSql = (body.sql || "").trim();

      if (!rawSql) return json({ error: "No SQL provided." }, 400);

      const err = validateQuery(rawSql);
      if (err) return json({ error: err }, 400);

      try {
        const wrapped = wrapWithLimit(rawSql);
        const result = await env.DB.prepare(wrapped).all();
        return json({ rows: result.results, count: result.results.length });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    // POST /api/check/:qid  — run query AND check answer
    if (url.pathname.startsWith("/api/check/") && request.method === "POST") {
      const qid = parseInt(url.pathname.split("/").pop());
      const question = QUESTIONS.find(q => q.id === qid);
      if (!question) return json({ error: "Unknown question ID." }, 404);

      const body = await request.json().catch(() => ({}));
      const rawSql = (body.sql || "").trim();

      if (!rawSql) return json({ error: "No SQL provided." }, 400);

      const err = validateQuery(rawSql);
      if (err) return json({ error: err }, 400);

      try {
        const wrapped = wrapWithLimit(rawSql);
        const result = await env.DB.prepare(wrapped).all();
        const rows = result.results;
        const check = checkAnswer(question, rows);
        return json({ rows, count: rows.length, ...check, expectedNames: question.expectedNames });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    return json({ error: "Not found." }, 404);
  },
};
