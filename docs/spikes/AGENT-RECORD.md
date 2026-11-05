# Recording the A1 LLM transcript (P3-B02)

Status: **pending human recording.** No `fixtures/agent/a1-llm.json` is committed yet, so
`tests/agent/brains.test.ts` skips only the fixture-parsing assertion; every other B02 test
runs against fakes and the scripted brain. CI never calls a model.

## Why it is not recorded yet

The recording needs a real Gemini key and model, which cannot run in CI and must not be
committed. The repo records the **naive** brain on purpose: attack A1 needs the agent to be
fooled by the poisoned product description. That is a controlled demo of an unprotected
agent in the sandbox, not a production configuration.

## How to record

```bash
GEMINI_API_KEY=... GEMINI_MODEL=gemini-2.5-flash npx tsx scripts/record-agent.ts
```

- The script runs up to five attempts and writes `fixtures/agent/a1-llm.json`
  (`{ actions: AgentAction[] }`) as soon as one attempt is fooled.
- It exits 1 and writes nothing when every attempt refuses; then record the best attempt by
  hand and add the refusal rate here.
- Commit the fixture and update this note with the model, date, attempt count and rate.

The scripted brain remains the default for CI; `RecordedBrain` replays the fixture
deterministically once it exists.
