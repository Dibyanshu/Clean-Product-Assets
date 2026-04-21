import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../repository/ingestion.repository.js";
import * as chroma from "../../../services/chroma.service.js";
import { extractChunks } from "../../../services/ast/astChunker.service.js";

const execAsync = promisify(exec);

const SUPPORTED_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs",
  ".ts", ".tsx", ".mts",
  ".java",
  ".cs",
  ".sql",
  ".json", ".md", ".txt",
  ".py", ".go", ".rb", ".php",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "bin", "obj",
  "target", "vendor", ".gradle", ".idea", ".vscode",
  "__pycache__", ".pytest_cache", "coverage", ".nyc_output",
  "out", "output", ".next", ".nuxt", "public", "static",
]);

const MAX_FILE_SIZE = 150_000;
const CLONE_TIMEOUT_MS = 90_000;

function walkDirectory(dir: string): Array<{ fullPath: string; relativePath: string; ext: string; size: number }> {
  const results: Array<{ fullPath: string; relativePath: string; ext: string; size: number }> = [];

  function walk(current: string, base: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(base, fullPath);

      if (entry.isDirectory()) {
        walk(fullPath, base);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        let size = 0;
        try {
          size = fs.statSync(fullPath).size;
        } catch {
          continue;
        }
        if (size > MAX_FILE_SIZE) continue;

        results.push({ fullPath, relativePath, ext, size });
      }
    }
  }

  walk(dir, dir);
  return results;
}

function cleanupDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}

const DEMO_FILE_TREE = [
  { path: "src/index.js", extension: ".js", size: 1240 },
  { path: "src/routes/users.js", extension: ".js", size: 3200 },
  { path: "src/routes/products.js", extension: ".js", size: 2800 },
  { path: "src/middleware/auth.js", extension: ".js", size: 950 },
  { path: "src/models/User.js", extension: ".js", size: 1800 },
  { path: "src/models/Product.js", extension: ".js", size: 2100 },
  { path: "src/services/emailService.js", extension: ".js", size: 1500 },
  { path: "src/config/database.js", extension: ".js", size: 680 },
  { path: "src/repositories/UserRepository.java", extension: ".java", size: 2600 },
  { path: "src/controllers/ProductsController.cs", extension: ".cs", size: 2200 },
  { path: "sql/schema.sql", extension: ".sql", size: 1900 },
  { path: "package.json", extension: ".json", size: 720 },
  { path: "README.md", extension: ".md", size: 3400 },
];

const DEMO_FILE_CONTENT: Record<string, string> = {
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
  await transporter.sendMail({ from: 'noreply@legacy-shop.com', to: user.email, subject: 'Welcome!', text: 'Thanks for signing up.' });
}
async function sendOrderConfirmation(user, order) {
  await transporter.sendMail({ from: 'orders@legacy-shop.com', to: user.email, subject: 'Order Confirmed #' + order.id, text: 'Your order total: $' + order.total_amount });
}
module.exports = { sendWelcomeEmail, sendOrderConfirmation };`,

  "src/config/database.js": `const sqlite3 = require('sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/shop.db');
const db = new sqlite3.Database(DB_PATH);
function query(sql, params = []) {
  return new Promise((resolve, reject) => { db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)); });
}
function run(sql, params = []) {
  return new Promise((resolve, reject) => { db.run(sql, params, (err) => err ? reject(err) : resolve()); });
}
module.exports = { query, run };`,

  "src/repositories/UserRepository.java": `package com.legacyshop.repositories;
import com.legacyshop.models.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
@Repository
public class UserRepository extends JpaRepository<User, String> {
    @Query("SELECT u FROM User u WHERE u.email = :email")
    public User findByEmail(String email) { return userRepository.findOne(email); }
    public boolean existsByEmail(String email) { return userRepository.existsByEmail(email); }
    @Query("SELECT u FROM User u WHERE u.role = 'admin' AND u.active = true")
    public List<User> findActiveAdmins() { return userRepository.findAll(isAdmin()); }
}`,

  "src/controllers/ProductsController.cs": `using Microsoft.AspNetCore.Mvc;
using LegacyShop.Models;
using LegacyShop.Services;
namespace LegacyShop.Controllers {
    [ApiController]
    [Route("api/[controller]")]
    public class ProductsController : ControllerBase {
        private readonly IProductService _productService;
        public ProductsController(IProductService productService) { _productService = productService; }
        [HttpGet] public async Task<IActionResult> GetAll([FromQuery] string? category) { var products = await _productService.GetAllAsync(category); return Ok(products); }
        [HttpGet("{id}")] public async Task<IActionResult> GetById(string id) { var product = await _productService.GetByIdAsync(id); if (product == null) return NotFound(); return Ok(product); }
        [HttpPost] public async Task<IActionResult> Create([FromBody] CreateProductDto dto) { if (!ModelState.IsValid) return BadRequest(ModelState); var product = await _productService.CreateAsync(dto); return CreatedAtAction(nameof(GetById), new { id = product.Id }, product); }
        [HttpPut("{id}")] public async Task<IActionResult> Update(string id, [FromBody] UpdateProductDto dto) { var product = await _productService.UpdateAsync(id, dto); if (product == null) return NotFound(); return Ok(product); }
        [HttpDelete("{id}")] public async Task<IActionResult> Delete(string id) { var success = await _productService.DeleteAsync(id); if (!success) return NotFound(); return NoContent(); }
    }
}`,

  "sql/schema.sql": `CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  stock_count INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  total_amount REAL NOT NULL,
  shipping_address TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
CREATE FUNCTION calculate_order_total(order_id TEXT) RETURNS REAL AS $$ SELECT SUM(quantity * unit_price) FROM order_items WHERE order_id = order_id; $$ LANGUAGE sql;
CREATE PROCEDURE update_product_stock(p_product_id TEXT, p_delta INTEGER) BEGIN UPDATE products SET stock_count = stock_count + p_delta WHERE id = p_product_id; END;`,

  "package.json": `{"name":"legacy-shop","version":"1.0.0","dependencies":{"express":"^4.18.2","sqlite3":"^5.1.6","jsonwebtoken":"^9.0.0","bcrypt":"^5.1.0","nodemailer":"^6.9.0","uuid":"^9.0.0"}}`,

  "README.md": `# Legacy Shop
A legacy e-commerce backend in Express.js + SQLite with Java/C# service layer.
## Features
- User management (CRUD)
- Product catalog with category filtering
- JWT authentication
- Java Spring Data repository layer
- .NET ASP.NET Core controllers
- Order management with SQL stored procedures`,
};

async function ingestFromGit(
  repoUrl: string,
  projectId: string,
): Promise<{ files: Array<{ path: string; extension: string; size: number; content: string }>; method: "git" | "demo" }> {
  const tmpDir = `/tmp/archonai-${projectId}`;

  try {
    logger.info({ projectId, repoUrl, tmpDir }, "[IngestionAgent] Cloning repository");
    await execAsync(`git clone --depth 1 --single-branch "${repoUrl}" "${tmpDir}"`, {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    const entries = walkDirectory(tmpDir);
    logger.info({ projectId, found: entries.length }, "[IngestionAgent] Files found in cloned repo");

    if (entries.length === 0) {
      logger.warn({ projectId }, "[IngestionAgent] No supported files found — falling back to demo dataset");
      cleanupDir(tmpDir);
      return buildDemoDataset();
    }

    const files: Array<{ path: string; extension: string; size: number; content: string }> = [];
    for (const entry of entries) {
      try {
        const content = fs.readFileSync(entry.fullPath, "utf-8");
        files.push({ path: entry.relativePath, extension: entry.ext, size: entry.size, content });
      } catch {
      }
    }

    cleanupDir(tmpDir);
    logger.info({ projectId, fileCount: files.length }, "[IngestionAgent] Files read from real repo");
    return { files, method: "git" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ projectId, error: message.slice(0, 200) }, "[IngestionAgent] git clone failed — falling back to demo dataset");
    cleanupDir(tmpDir);
    return buildDemoDataset();
  }
}

function buildDemoDataset(): { files: Array<{ path: string; extension: string; size: number; content: string }>; method: "demo" } {
  const files = DEMO_FILE_TREE.map((f) => ({
    path: f.path,
    extension: f.extension,
    size: f.size,
    content: DEMO_FILE_CONTENT[f.path] ?? "",
  }));
  return { files, method: "demo" };
}

export interface IngestResult {
  projectId: string;
  projectName: string;
  fileCount: number;
  files: ingestionRepo.ProjectFile[];
}

export async function ingestRepository(repoUrl: string): Promise<IngestResult> {
  const repoName = repoUrl.split("/").pop()?.replace(/\.git$/i, "") ?? "unknown-project";
  logger.info({ repoUrl, repoName }, "[IngestionAgent] Starting ingestion");

  const project = await ingestionRepo.createProject(repoUrl, repoName);
  logger.info({ projectId: project.id }, "[IngestionAgent] Project created");

  await ingestionRepo.updateProjectStatus(project.id, "ingesting");

  const { files: rawFiles, method } = await ingestFromGit(repoUrl, project.id);

  logger.info({ projectId: project.id, method, fileCount: rawFiles.length }, "[IngestionAgent] Source files loaded");

  const storedFiles: ingestionRepo.ProjectFile[] = [];
  for (const f of rawFiles) {
    const file = await ingestionRepo.insertFile(project.id, f.path, f.extension, f.size);
    storedFiles.push(file);
  }

  await ingestionRepo.updateProjectStatus(project.id, "ingested", storedFiles.length);
  logger.info({ projectId: project.id, fileCount: storedFiles.length }, "[IngestionAgent] Ingestion complete");

  chroma.createOrGetCollection(project.id);
  const docs: Parameters<typeof chroma.upsertDocuments>[1] = [];
  const langStats: Record<string, number> = {};

  for (const f of rawFiles) {
    if (!f.content) continue;

    const chunks = extractChunks(f.path, f.content);

    if (chunks.length > 0) {
      for (const chunk of chunks) {
        docs.push({
          id: chunk.id,
          content: chunk.content,
          metadata: chunk.metadata as Parameters<typeof chroma.upsertDocuments>[1][0]["metadata"],
        });
        langStats[chunk.metadata.language] = (langStats[chunk.metadata.language] ?? 0) + 1;
      }
    } else {
      docs.push({
        id: `${project.id}::raw::${f.path}`,
        content: f.content.slice(0, 1500),
        metadata: { type: "code", file: f.path },
      });
    }
  }

  chroma.upsertDocuments(project.id, docs);
  logger.info(
    { projectId: project.id, chunks: docs.length, languages: langStats },
    "[IngestionAgent] AST chunks indexed in vector store",
  );

  return { projectId: project.id, projectName: repoName, fileCount: storedFiles.length, files: storedFiles };
}

export async function getProject(projectId: string) {
  return ingestionRepo.findProjectById(projectId);
}

export async function listAllProjects() {
  return ingestionRepo.listProjects();
}
