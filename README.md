# PayClinic

PayClinic attacks a PayPal checkout (and an AI shopping agent) in a **sandbox**,
uses pure invariant functions to decide what is broken, uses AI only to explain
and propose fixes, then re-runs the attack to prove the fix.

> AI generates and explains. Deterministic code decides.

## Quickstart

```bash
npm install
npm run setup   # checks prerequisites, never needs API keys
npm run demo    # seeds three demo runs and serves API + dashboard on :4000
```

Open `http://localhost:4000` (the API serves the built dashboard).

## Deployment (Render)

`render.yaml` defines one **free** web service:

- build: `npm ci && npm run build`
- start: `npm run demo` (seeds demo data at boot, then serves API + dashboard)
- `PAYCLINIC_MODE=offline`, `AI_PROVIDER=fixture` — needs **no** keys
- the API reads Render's injected `PORT`

**Free-tier cold start:** on the free plan the service sleeps after inactivity;
the **first request can take about a minute** to wake up and boot. Later
requests are fast. The demo video does not depend on the hosted instance — the
local `npm run demo` shows the same product.
