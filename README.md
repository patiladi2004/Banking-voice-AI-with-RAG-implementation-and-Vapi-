# HDFC Bank Voice AI Assistant — RAG + Vapi

A voice-based banking help-desk assistant that answers FAQs, walks
callers through step-by-step banking procedures, and explains terms
& conditions — all grounded in a real knowledge base via
Retrieval-Augmented Generation (RAG), rather than the LLM's own
assumptions.

Built as a learning project to explore RAG, information retrieval,
and end-to-end Voice AI system design.

## What it does

A caller can ask things like:

- *"I lost my credit card, how do I block it?"* — gets walked
  through the actual blocking procedure, one confirmed step at a
  time.
- *"I don't recognize a transaction on my account"* — gets guided
  through fraud reporting, treated as urgent.
- *"I forgot my internet banking password"* — gets the real
  password reset flow, live.
- *"What happens if I don't maintain my minimum balance?"* — gets
  the actual terms & conditions clause explained in plain language.

If the knowledge base has nothing relevant, the assistant says so
honestly and points to PhoneBanking — it never guesses or invents
an answer.

## Architecture

Caller speaks
→ Vapi (speech-to-text)
→ Assistant model decides it needs banking info
→ Calls the retrieveKnowledge tool
→ Request hits retrieve.js (via ngrok tunnel)
→ Query is embedded locally (Xenova/all-MiniLM-L6-v2)
→ Cosine similarity search against Postgres + pgvector
→ Top matches returned to Vapi
→ Assistant model explains the retrieved content
→ Vapi (text-to-speech) speaks the answer back


## Tech stack

- **Node.js + Express** — retrieval API
- **PostgreSQL + pgvector** (Docker) — vector storage and similarity
  search
- **@xenova/transformers** — local embedding generation, no
  external API required for search
- **Vapi** — voice layer: speech-to-text, the LLM, text-to-speech,
  and telephony
- **ngrok** — tunnels the local retrieval API to a public URL during
  development

## Knowledge base

~1,800+ entries across categories including credit cards, debit
cards, fraud, password/account access, deposits, insurance,
investments, and terms & conditions clauses. Two content shapes:

- **FAQ** — a direct question/answer pair
- **Procedure** — a numbered `steps` array, each step read aloud
  one at a time with confirmation before moving on
- **Clause** — verbatim terms & conditions text, explained rather
  than read aloud

## Building this from scratch

### 1. Set up PostgreSQL with pgvector

Native Postgres installs don't include pgvector, so this project
runs Postgres inside Docker using an image that has it pre-built:

```bash
docker run --name banking-pg -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=banking_voice_rag -p 5433:5432 -d pgvector/pgvector:pg17
```

Connect and enable the extension:

```bash
psql -h localhost -p 5433 -U postgres -d banking_voice_rag
```

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. Create the table

```sql
CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  steps JSONB,
  notes TEXT,
  clause_number TEXT,
  embedding vector(384)
);

CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

(384 dimensions to match the local MiniLM embedding model.)

### 3. Set up the Node project

```bash
npm init -y
npm install pg @xenova/transformers dotenv express
```

Create a `.env` file:

DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_NAME=banking_voice_rag


### 4. Write the knowledge base

Each JSON file in `knowledgebase_hdfc/` holds an array of entries.
FAQs use `answer` + `sample_queries`; procedures use `overview` +
a `steps` array; clauses use `text` + `clause_number`. See
`knowledgebase_hdfc/*.json` for real examples of each shape.

### 5. Ingest and embed the knowledge base

`ingest.js` reads every file in `knowledgebase_hdfc/`, builds an
embedding-friendly text string per entry (title + answer/overview/
text + sample_queries), embeds it locally, and upserts it into
Postgres.

```bash
node ingest.js
```

Safe to re-run any time the knowledge base changes — existing ids
are updated in place, not duplicated.

### 6. Run the retrieval API

`retrieve.js` embeds an incoming question the same way, runs a
cosine similarity search (`<=>` operator) against `knowledge_chunks`,
and returns the top matches.

```bash
node retrieve.js
```

Test it directly before wiring up Vapi:

```bash
curl -X POST http://localhost:5001/retrieve-livekit -H "Content-Type: application/json" -d '{"query": "I lost my credit card, how do I block it"}'
```

### 7. Expose it publicly with ngrok

```bash
ngrok http 5001
```

Note the forwarding URL — it changes every restart on the free
tier, so the Vapi tool config needs updating whenever the tunnel
restarts.

### 8. Create the Vapi assistant

In the Vapi dashboard: create a blank assistant, choose a model,
and paste in the system prompt from
[`docs/SYSTEM_PROMPT.md`](docs/SYSTEM_PROMPT.md).

### 9. Add the retrieveKnowledge tool

Create a custom Function tool named `retrieveKnowledge`, point its
server URL at `<your-ngrok-url>/retrieve`, and use the parameters
schema and description documented in
[`docs/vapi-tool-config.md`](docs/vapi-tool-config.md). Attach it
to the assistant.

### 10. Test it

Use Vapi's dashboard test-call feature and try a real question —
confirm the tool gets called, the right content comes back, and the
assistant answers from it rather than guessing.

## Project structure

.
├── knowledgebase_hdfc/ # source knowledge base JSON files
├── ingest.js # embeds and loads the knowledge base into Postgres
├── retrieve.js # retrieval API (Express)
├── docs/
│ ├── SYSTEM_PROMPT.md # full Vapi system prompt
│ └── vapi-tool-config.md # tool schema and config
├── .env.example
└── .gitignore


## Lessons learned along the way

- Very long terms & conditions clauses were getting truncated by
  the embedding model, silently hurting retrieval on the back half
  of long entries — fixed by splitting oversized clauses into
  smaller, sentence-aligned chunks.
- The assistant needs an explicit instruction to never paraphrase
  numbers/currency from retrieved content — without it, it would
  occasionally convert rupee figures into dollars or drop "lakh"
  multipliers.
- Multiple-path steps (e.g. "in NetBanking do X, in the app do Y")
  need to be split into a clarifying question first, otherwise the
  assistant reads both paths aloud in one breath.

## Status

Actively developed — currently also exploring a parallel
implementation using LiveKit's Agent Builder, reusing the same RAG
backend.

## License

MIT
