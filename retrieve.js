require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { pipeline } = require('@xenova/transformers');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const app = express();
app.use(express.json());

let embedder;

async function getEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

async function runRetrieval(query, category) {
  const embed = await getEmbedder();
  const output = await embed(query, { pooling: 'mean', normalize: true });
  const vector = `[${Array.from(output.data).join(',')}]`;

  let sql = `
    SELECT id, category, type, title, content, steps, notes,
           1 - (embedding <=> $1) AS similarity
    FROM knowledge_chunks
  `;
  const params = [vector];

  if (category) {
    sql += ` WHERE category = $2`;
    params.push(category);
  }

  sql += ` ORDER BY embedding <=> $1 LIMIT 3`;

  const result = await pool.query(sql, params);
  return result.rows;
}

// Vapi tool endpoint (existing, unchanged)
app.post('/retrieve', async (req, res) => {
  try {
    const toolCallList = req.body.message?.toolCallList || [];
    if (toolCallList.length === 0) {
      return res.status(400).json({ error: 'no tool calls found in request' });
    }
    const results = [];
    for (const toolCall of toolCallList) {
      const toolCallId = toolCall.id;
      const args = toolCall.function?.arguments || {};
      const query = args.query;
      const category = args.category;
      if (!query) {
        results.push({ toolCallId, result: 'No query provided.' });
        continue;
      }
      const matches = await runRetrieval(query, category);
      if (matches.length === 0) {
        results.push({ toolCallId, result: 'No matching information found in the knowledge base.' });
        continue;
      }
      results.push({ toolCallId, result: matches });
    }
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'retrieval failed' });
  }
});

// LiveKit Agent Builder tool endpoint (new, flat format)
app.post('/retrieve-livekit', async (req, res) => {
  try {
    const { query, category } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    const matches = await runRetrieval(query, category);
    if (matches.length === 0) {
      return res.json({ message: 'No matching information found in the knowledge base.' });
    }
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'retrieval failed' });
  }
});

const PORT = 5001;
app.listen(PORT, async () => {
  await getEmbedder();
  console.log(`Retrieval service running on http://localhost:${PORT}`);
});