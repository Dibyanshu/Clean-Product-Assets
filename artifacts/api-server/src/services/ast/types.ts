export interface AstChunk {
  id: string;
  content: string;
  metadata: {
    type: string;
    name: string;
    file: string;
    language: string;
    route?: string;
    method?: string;
    lineStart?: number;
    lineEnd?: number;
    className?: string;
  };
}
