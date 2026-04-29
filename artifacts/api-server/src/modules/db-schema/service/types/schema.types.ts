export interface SchemaColumn {
  id: string;
  name: string;
  type: string;
  is_primary: boolean;
  is_nullable: boolean;
}

export interface SchemaTable {
  id: string;
  name: string;
  columns: SchemaColumn[];
  extracted_at: string;
}

export interface SchemaFunction {
  id: string;
  name: string;
  parameters: string | null;
  description: string | null;
}

export interface ExtractResult {
  projectId: string;
  version: number;
  tables: SchemaTable[];
  functions: SchemaFunction[];
  extractedAt: string;
  source: "real" | "fallback";
  warning: string | null;
}

export interface RawTable {
  table: string;
  columns: Array<{ name: string; type: string; primary?: boolean; nullable?: boolean; constraints?: string[] }>;
}

export interface RawFunction {
  name: string;
  parameters: string | null;
  description: string;
}

export interface RawRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraintName: string | null;
}

export interface RawView {
  name: string;
  definition: string;
}

export interface RawQueryTableUsage {
  sourceType: string;
  sourceName: string;
  tableName: string;
  operation: "SELECT" | "INSERT" | "JOIN";
  isJoin: boolean;
}
