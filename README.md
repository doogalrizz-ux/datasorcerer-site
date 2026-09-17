# datasorcerer.net

Source for [datasorcerer.net](https://datasorcerer.net), Greg Macgowan's
portfolio site, plus the full source for its three interactive sub-apps.

## Layout

```
index.html          the portfolio site itself

bridge/              deployed static page for the bridge bidding trainer
f1/                  deployed static page for the F1 SQL challenge
jeopardy/            deployed static page for the jeopardy trainer

bridge-trainer/      full source for the bridge trainer
  frontend/            the app UI (same file as deployed to bridge/)

f1-challenge/        full source for the F1 SQL challenge
  frontend/            the app UI (same file as deployed to f1/)
  scripts/             one-off data import (circuits, drivers, races, results)
  worker/              Cloudflare Worker backend (D1-backed)

jeopardy-trainer/    full source for the jeopardy trainer
  frontend/            the app UI (same file as deployed to jeopardy/)
  scripts/             question-set import/processing
  worker/              Cloudflare Worker backend (D1-backed)
```

The `bridge/`, `f1/`, and `jeopardy/` folders are what's actually deployed at
those paths on datasorcerer.net — currently manual copies of each sub-app's
`frontend/`. The `*-trainer`/`*-challenge` folders are the real, editable
source, including the backend that `frontend/` talks to.

## Working on a sub-app

Each Worker backend is a standard Wrangler project:

```
cd f1-challenge/worker    # or jeopardy-trainer/worker
wrangler dev              # local dev
wrangler deploy           # deploy
```

`.wrangler/` (local cache/state, includes account info) and `.env` files are
gitignored — never commit them.
