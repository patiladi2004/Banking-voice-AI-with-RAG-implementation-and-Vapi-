require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { pipeline } = require('@xenova/transformers');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const KB_DIR = path.join(__dirname, 'knowledgebase_hdfc');

function buildEmbeddingText(entry) {
  const parts = [entry.title];
  if (entry.answer) parts.push(entry.answer);
  if (entry.overview) parts.push(entry.overview);
  if (entry.text) parts.push(entry.text);
  if (entry.sample_queries) parts.push(entry.sample_queries.join('. '));
  return parts.filter(Boolean).join('. ');
}

async function main() {
  console.log('Loading embedding model (first run downloads it, may take a minute)...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const files = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} knowledge base files.`);

  let totalInserted = 0;

  for (const file of files) {
    const filePath = path.join(KB_DIR, file);
    const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    for (const entry of entries) {
      const text = buildEmbeddingText(entry);
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);

      await pool.query(
        `INSERT INTO knowledge_chunks (id, category, type, title, content, steps, notes, clause_number, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           category = EXCLUDED.category,
           type = EXCLUDED.type,
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           steps = EXCLUDED.steps,
           notes = EXCLUDED.notes,
           clause_number = EXCLUDED.clause_number,
           embedding = EXCLUDED.embedding`,
        [
          entry.id,
          entry.category,
          entry.type,
          entry.title,
          text,
          entry.steps ? JSON.stringify(entry.steps) : null,
          entry.notes || null,
          entry.clause_number || null,
          `[${embedding.join(',')}]`,
        ]
      );

      totalInserted++;
      process.stdout.write(`\rIngested ${totalInserted} entries...`);
    }
  }

  console.log(`\nDone. ${totalInserted} entries embedded and stored.`);
  await pool.end();
}

main().catch(err => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});