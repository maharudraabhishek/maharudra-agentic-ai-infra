export type EmbeddingInput = {
  id?: string;
  text: string;
};

export type EmbeddingResult = {
  id?: string;
  embedding: number[];
  model: string;
  version: string;
  dimension: number;
};

export interface EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimension: number;

  embedText(text: string): Promise<EmbeddingResult>;
  embedBatch(inputs: readonly EmbeddingInput[]): Promise<EmbeddingResult[]>;
}
