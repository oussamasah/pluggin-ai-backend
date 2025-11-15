// embeddings.ts
import OpenAI from "openai";
import axios from "axios";

/**
 * Custom implementation of OpenAIEmbeddings matching LangChain interface
 */
export class OpenAIEmbeddings {
  private openai: OpenAI;
  private model: string;
  private batchSize: number;
  private maxRetries: number;

  constructor(config: {
    openAIApiKey: string;
    model?: string;
    batchSize?: number;
    maxRetries?: number;
  }) {
    this.openai = new OpenAI({ apiKey: config.openAIApiKey });
    this.model = config.model || "text-embedding-ada-002";
    this.batchSize = config.batchSize || 512;
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Embed a single document
   */
  async embedQuery(document: string): Promise<number[]> {
    const embeddings = await this.embedDocuments([document]);
    return embeddings[0];
  }

  /**
   * Embed multiple documents
   */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) {
      return [];
    }

    const batches = this.chunkArray(documents, this.batchSize);
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const batchEmbeddings = await this.embedBatchWithRetry(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    return allEmbeddings;
  }

  /**
   * Embed a batch of documents with retry logic
   */
  private async embedBatchWithRetry(documents: string[]): Promise<number[][]> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.openai.embeddings.create({
          model: this.model,
          input: documents.map(doc => doc.substring(0, 8191)) // API limit
        });

        return response.data.map(item => item.embedding);

      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get embedding dimensions for the model
   */
  getDimensions(): number {
    const modelDimensions: { [key: string]: number } = {
      "text-embedding-ada-002": 1536,
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072
    };
    
    return modelDimensions[this.model] || 1536;
  }
}

/**
 * Simple in-memory vector store implementation
 */
export class MemoryVectorStore {
  private documents: VectorDocument[] = [];
  private embeddings: OpenAIEmbeddings;

  constructor(embeddings: OpenAIEmbeddings) {
    this.embeddings = embeddings;
  }

  async addDocuments(documents: Array<{ pageContent: string; metadata: any }>): Promise<void> {
    const texts = documents.map(doc => doc.pageContent);
    const vectors = await this.embeddings.embedDocuments(texts);

    for (let i = 0; i < documents.length; i++) {
      this.documents.push({
        content: documents[i].pageContent,
        metadata: documents[i].metadata,
        embedding: vectors[i]
      });
    }
  }

  async similaritySearch(query: string, k: number = 5): Promise<Array<{ pageContent: string; metadata: any }>> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    
    const results = this.documents.map(doc => ({
      document: doc,
      similarity: this.cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    // Sort by similarity and return top k
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
      .map(result => ({
        pageContent: result.document.content,
        metadata: result.document.metadata
      }));
  }

  async similaritySearchWithScore(
    query: string, 
    k: number = 5
  ): Promise<Array<[{ pageContent: string; metadata: any }, number]>> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    
    const results = this.documents.map(doc => ({
      document: doc,
      similarity: this.cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    // Sort by similarity and return top k with scores
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
      .map(result => [
        {
          pageContent: result.document.content,
          metadata: result.document.metadata
        },
        result.similarity
      ]);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  getDocumentCount(): number {
    return this.documents.length;
  }

  clear(): void {
    this.documents = [];
  }
}

/**
 * Document class matching LangChain's Document interface
 */
export class Document {
  pageContent: string;
  metadata: Record<string, any>;

  constructor(fields: { pageContent: string; metadata?: Record<string, any> }) {
    this.pageContent = fields.pageContent;
    this.metadata = fields.metadata || {};
  }
}

// Internal interface for vector documents
interface VectorDocument {
  content: string;
  metadata: any;
  embedding: number[];
}