import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../repository/ingestion.repository.js";
import * as chroma from "../../../services/chroma.service.js";

const MOCK_FILE_TREE = [
  { path: "src/index.js", extension: ".js", size: 1240 },
  { path: "src/routes/users.js", extension: ".js", size: 3200 },
  { path: "src/routes/products.js", extension: ".js", size: 2800 },
  { path: "src/middleware/auth.js", extension: ".js", size: 950 },
  { path: "src/models/User.js", extension: ".js", size: 1800 },
  { path: "src/models/Product.js", extension: ".js", size: 2100 },
  { path: "src/services/emailService.js", extension: ".js", size: 1500 },
  { path: "src/config/database.js", extension: ".js", size: 680 },
  { path: "package.json", extension: ".json", size: 720 },
  { path: "README.md", extension: ".md", size: 3400 },
];

const MOCK_FILE_CONTENT: Record<string, string> = {
  "src/index.js": `const express = require('express');
const app = express();
app.use(express.json());
const usersRouter = require('./routes/users');
const productsRouter = require('./routes/products');
app.use('/api/users', usersRouter);
app.use('/api/products', productsRouter);
app.listen(3000, () => console.log('Server running on port 3000'));`,

  "src/routes/users.js": `const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
router.get('/', authenticate, async (req, res) => {
  const users = await User.findAll();
  res.json(users);
});
router.post('/', async (req, res) => {
  const user = await User.create(req.body);
  res.status(201).json(user);
});
router.get('/:id', authenticate, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});
router.put('/:id', authenticate, async (req, res) => {
  const user = await User.update(req.params.id, req.body);
  res.json(user);
});
router.delete('/:id', authenticate, async (req, res) => {
  await User.delete(req.params.id);
  res.status(204).end();
});
module.exports = router;`,

  "src/routes/products.js": `const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { authenticate } = require('../middleware/auth');
router.get('/', async (req, res) => {
  const products = await Product.findAll({ category: req.query.category });
  res.json(products);
});
router.post('/', authenticate, async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json(product);
});
router.get('/:id', async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});
module.exports = router;`,

  "src/middleware/auth.js": `const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
module.exports = { authenticate };`,

  "src/models/User.js": `const db = require('../config/database');
class User {
  static async findAll() {
    return db.query('SELECT id, email, display_name, role, created_at FROM users');
  }
  static async findById(id) {
    const rows = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] ?? null;
  }
  static async create({ email, password, display_name, role = 'user' }) {
    const id = require('uuid').v4();
    const hash = require('bcrypt').hashSync(password, 10);
    await db.run('INSERT INTO users VALUES (?,?,?,?,?,datetime(),datetime())', [id, email, hash, display_name, role]);
    return this.findById(id);
  }
  static async update(id, data) {
    await db.run('UPDATE users SET display_name=?, role=?, updated_at=datetime() WHERE id=?', [data.display_name, data.role, id]);
    return this.findById(id);
  }
  static async delete(id) {
    await db.run('DELETE FROM users WHERE id=?', [id]);
  }
}
module.exports = User;`,

  "src/models/Product.js": `const db = require('../config/database');
class Product {
  static async findAll({ category } = {}) {
    const sql = category
      ? 'SELECT * FROM products WHERE category=? ORDER BY name'
      : 'SELECT * FROM products ORDER BY name';
    return db.query(sql, category ? [category] : []);
  }
  static async findById(id) {
    const rows = await db.query('SELECT * FROM products WHERE id=?', [id]);
    return rows[0] ?? null;
  }
  static async create({ name, description, price, stock_count, category }) {
    const id = require('uuid').v4();
    await db.run('INSERT INTO products VALUES (?,?,?,?,?,?,datetime())', [id, name, description, price, stock_count, category]);
    return this.findById(id);
  }
}
module.exports = Product;`,

  "src/services/emailService.js": `const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: 587 });
async function sendWelcomeEmail(user) {
  await transporter.sendMail({
    from: 'noreply@legacy-shop.com',
    to: user.email,
    subject: 'Welcome!',
    text: 'Thanks for signing up.',
  });
}
async function sendOrderConfirmation(user, order) {
  await transporter.sendMail({
    from: 'orders@legacy-shop.com',
    to: user.email,
    subject: 'Order Confirmed #' + order.id,
    text: 'Your order total: $' + order.total_amount,
  });
}
module.exports = { sendWelcomeEmail, sendOrderConfirmation };`,

  "src/config/database.js": `const sqlite3 = require('sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/shop.db');
const db = new sqlite3.Database(DB_PATH);
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => err ? reject(err) : resolve());
  });
}
module.exports = { query, run };`,

  "package.json": `{
  "name": "legacy-shop",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "nodemailer": "^6.9.0",
    "uuid": "^9.0.0"
  }
}`,

  "README.md": `# Legacy Shop
A legacy e-commerce backend built with Express.js and SQLite.
## Features
- User management (CRUD)
- Product catalog with category filtering
- JWT authentication middleware
- Order management
- Email notifications
## Setup
npm install && npm start
`,
};

function chunkContent(content: string, chunkSize = 600): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize).trim());
  }
  return chunks.filter((c) => c.length > 20);
}

export interface IngestResult {
  projectId: string;
  projectName: string;
  fileCount: number;
  files: ingestionRepo.ProjectFile[];
}

export async function ingestRepository(repoUrl: string): Promise<IngestResult> {
  const repoName = repoUrl.split("/").pop()?.replace(".git", "") ?? "unknown-project";
  logger.info({ repoUrl, repoName }, "[IngestionAgent] Starting ingestion");

  const project = await ingestionRepo.createProject(repoUrl, repoName);
  logger.info({ projectId: project.id }, "[IngestionAgent] Project created");

  await ingestionRepo.updateProjectStatus(project.id, "ingesting");

  const files: ingestionRepo.ProjectFile[] = [];
  for (const f of MOCK_FILE_TREE) {
    const file = await ingestionRepo.insertFile(project.id, f.path, f.extension, f.size);
    files.push(file);
  }

  await ingestionRepo.updateProjectStatus(project.id, "ingested", files.length);
  logger.info({ projectId: project.id, fileCount: files.length }, "[IngestionAgent] Ingestion complete");

  // --- Vector store: chunk each file and upsert ---
  chroma.createOrGetCollection(project.id);
  const docs: Parameters<typeof chroma.upsertDocuments>[1] = [];

  for (const f of MOCK_FILE_TREE) {
    const content = MOCK_FILE_CONTENT[f.path] ?? `// ${f.path}`;
    const chunks = chunkContent(content);
    chunks.forEach((chunk, idx) => {
      docs.push({
        id: `${project.id}::${f.path}::${idx}`,
        content: chunk,
        metadata: { type: "code", file: f.path },
      });
    });
  }

  chroma.upsertDocuments(project.id, docs);
  logger.info({ projectId: project.id, chunks: docs.length }, "[IngestionAgent] Code chunks indexed in vector store");

  return { projectId: project.id, projectName: repoName, fileCount: files.length, files };
}

export async function getProject(projectId: string) {
  return ingestionRepo.findProjectById(projectId);
}

export async function listAllProjects() {
  return ingestionRepo.listProjects();
}
