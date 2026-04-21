import type { FastifyRequest, FastifyReply } from "fastify";
import { getDb, rowsToObjects } from "../../../db/sqlite.js";

export async function listTablesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const db = await getDb();

  const tableResult = db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  const tableNames = tableResult.length
    ? tableResult[0]!.values.map((r) => String(r[0]))
    : [];

  const tables = tableNames.map((name) => {
    let rowCount = 0;
    let columns: string[] = [];

    try {
      const countRes = db.exec(`SELECT COUNT(*) FROM "${name}"`);
      rowCount = countRes.length ? Number(countRes[0]!.values[0]![0]) : 0;
    } catch {
      rowCount = 0;
    }

    try {
      const infoRes = db.exec(`PRAGMA table_info("${name}")`);
      if (infoRes.length) {
        columns = infoRes[0]!.values.map((r) => String(r[1]));
      }
    } catch {
      columns = [];
    }

    return { name, rowCount, columns };
  });

  reply.send({ tables });
}

export async function getTableRowsHandler(
  request: FastifyRequest<{
    Params: { table: string };
    Querystring: { page?: string; limit?: string };
  }>,
  reply: FastifyReply,
): Promise<void> {
  const { table } = request.params;
  const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(request.query.limit ?? "50", 10) || 50),
  );
  const offset = (page - 1) * limit;

  const db = await getDb();

  const validTables = db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  if (!validTables.length || !validTables[0]!.values.length) {
    reply.code(404).send({ error: "Table not found" });
    return;
  }

  let total = 0;
  let columns: string[] = [];
  let rows: Record<string, unknown>[] = [];

  try {
    const countRes = db.exec(`SELECT COUNT(*) FROM "${table}"`);
    total = countRes.length ? Number(countRes[0]!.values[0]![0]) : 0;
  } catch {
    total = 0;
  }

  try {
    const infoRes = db.exec(`PRAGMA table_info("${table}")`);
    if (infoRes.length) {
      columns = infoRes[0]!.values.map((r) => String(r[1]));
    }
  } catch {
    columns = [];
  }

  try {
    const rowRes = db.exec(
      `SELECT * FROM "${table}" LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    rows = rowsToObjects(rowRes);
  } catch {
    rows = [];
  }

  reply.send({ table, columns, rows, total, page, limit });
}
