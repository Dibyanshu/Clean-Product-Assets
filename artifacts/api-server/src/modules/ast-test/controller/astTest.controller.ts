import type { FastifyRequest, FastifyReply } from "fastify";
import { extractChunks, detectLanguage } from "../../../services/ast/astChunker.service.js";
import { logger } from "../../../lib/logger.js";

interface TestAstBody {
  filePath: string;
  code: string;
}

export async function testAstMultiHandler(
  request: FastifyRequest<{ Body: TestAstBody }>,
  reply: FastifyReply,
) {
  const { filePath, code } = request.body;

  if (!filePath?.trim() || !code?.trim()) {
    return reply.code(400).send({ error: "filePath and code are required" });
  }

  const language = detectLanguage(filePath);
  if (!language) {
    return reply.code(400).send({
      error: `Unsupported file extension. Supported: .js, .ts, .java, .cs, .sql`,
    });
  }

  logger.info({ filePath, language, codeLength: code.length }, "[ASTTest] Parsing");

  const chunks = extractChunks(filePath, code);

  return reply.send({
    filePath,
    language,
    chunkCount: chunks.length,
    chunks,
  });
}
