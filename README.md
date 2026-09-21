# HDFC Bank Voice AI Assistant (RAG-powered)

A voice-based banking help-desk assistant built to explore
Retrieval-Augmented Generation (RAG), information retrieval, and
end-to-end Voice AI system design. The assistant answers FAQs,
walks callers through step-by-step banking procedures, and can
explain terms & conditions clauses — grounded entirely in a
knowledge base, not the LLM's own assumptions.

## Architecture

- **Knowledge base**: ~1,800+ entries covering FAQs, guided
  procedures, and terms & conditions clauses across categories like
  credit cards, debit cards, fraud, password/account access,
  deposits, insurance, and more.
- **Embeddings**: Generated locally using `@xenova/transformers`
  (`Xenova/all-MiniLM-L6-v2`), no external API required for search.
- **Vector storage & search**: PostgreSQL with the `pgvector`
  extension, running in Docker.
- **Retrieval API**: An Express server (`retrieve.js`) exposing a
  `/retrieve` endpoint that embeds a caller's question and returns
  the most relevant knowledge base entries via cosine similarity.
- **Voice layer**: [Vapi](https://vapi.ai), configured with a
  custom tool that calls the retrieval API mid-conversation, so the
  assistant always answers from retrieved content rather than
  guessing.

## Key design decisions

- FAQs and step-by-step procedures are stored differently — a
  `steps` array lets the assistant walk a caller through a
  procedure one confirmed step at a time, rather than reading a
  wall of instructions at once.
- The system prompt enforces retrieval-before-answering, exact
  reproduction of figures/currency from source content (no
  paraphrased numbers), and honest fallback behavior when nothing
  relevant is found.
- Long source clauses were identified and split into smaller
  chunks after testing revealed embedding truncation was hurting
  retrieval accuracy on a few long terms-and-conditions entries.

## Setup

1. `npm install`
2. Set up Postgres with pgvector (see `docker run` command below)
   and create the `knowledge_chunks` table (schema in `/schema.sql`
   if included, or see setup notes).
3. Copy `.env.example` to `.env` and fill in your database
   credentials.
4. Run `node ingest.js` to embed and load the knowledge base.
5. Run `node retrieve.js` to start the retrieval API.
6. Expose it publicly (e.g. via `ngrok http 5001`) and configure
   the URL as a custom tool in your Vapi assistant.

## Tech stack

Node.js, Express, PostgreSQL + pgvector, @xenova/transformers,
Docker, Vapi

## Status

Actively developed as a learning project exploring RAG accuracy,
retrieval tuning, and voice AI system design.