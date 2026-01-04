import mongoose from 'mongoose';
import { Company, Employee, Enrichment } from '../../models/index';

export class VectorIndexManager {
  
  /**
   * Create vector indexes for MongoDB Atlas vector search
   */
  async createVectorIndexes(): Promise<void> {
    console.log('🔧 Creating vector indexes...');
    
    try {
      // Only create indexes if using MongoDB Atlas
      if (process.env.MONGODB_ATLAS_VECTOR_SEARCH !== 'true') {
        console.log('ℹ️  MongoDB Atlas vector search not enabled, skipping index creation');
        return;
      }
      
      // Create vector index for companies
      await this.createCompanyVectorIndex();
      
      // Create vector index for employees
      await this.createEmployeeVectorIndex();
      
      // Create vector index for enrichments
      await this.createEnrichmentVectorIndex();
      
      console.log('✅ Vector indexes created successfully');
      
    } catch (error: any) {
      console.error('❌ Failed to create vector indexes:', error.message);
      throw error;
    }
  }
  
  /**
   * Create company vector index
   */
  private async createCompanyVectorIndex(): Promise<void> {
    try {
      const indexExists = await this.checkIndexExists('companies', 'embedding_1');
      
      if (!indexExists) {
        await mongoose.connection.db.collection('companies').createIndex(
          { embedding: 'vector' },
          {
            name: 'embedding_1',
            vectorOptions: {
              dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
              similarity: 'cosine'
            }
          }
        );
        console.log('✅ Created company vector index');
      } else {
        console.log('ℹ️  Company vector index already exists');
      }
    } catch (error: any) {
      console.error('Failed to create company vector index:', error.message);
    }
  }
  
  /**
   * Create employee vector index
   */
  private async createEmployeeVectorIndex(): Promise<void> {
    try {
      const indexExists = await this.checkIndexExists('employees', 'embedding_1');
      
      if (!indexExists) {
        await mongoose.connection.db.collection('employees').createIndex(
          { embedding: 'vector' },
          {
            name: 'embedding_1',
            vectorOptions: {
              dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
              similarity: 'cosine'
            }
          }
        );
        console.log('✅ Created employee vector index');
      } else {
        console.log('ℹ️  Employee vector index already exists');
      }
    } catch (error: any) {
      console.error('Failed to create employee vector index:', error.message);
    }
  }
  
  /**
   * Create enrichment vector index
   */
  private async createEnrichmentVectorIndex(): Promise<void> {
    try {
      const indexExists = await this.checkIndexExists('enrichments', 'embedding_1');
      
      if (!indexExists) {
        await mongoose.connection.db.collection('enrichments').createIndex(
          { embedding: 'vector' },
          {
            name: 'embedding_1',
            vectorOptions: {
              dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536'),
              similarity: 'cosine'
            }
          }
        );
        console.log('✅ Created enrichment vector index');
      } else {
        console.log('ℹ️  Enrichment vector index already exists');
      }
    } catch (error: any) {
      console.error('Failed to create enrichment vector index:', error.message);
    }
  }
  
  /**
   * Check if an index exists
   */
  private async checkIndexExists(collectionName: string, indexName: string): Promise<boolean> {
    try {
      const indexes = await mongoose.connection.db.collection(collectionName).indexes();
      return indexes.some((index: any) => index.name === indexName);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * List all vector indexes
   */
  async listVectorIndexes(): Promise<any[]> {
    const indexes = [];
    
    try {
      const collections = ['companies', 'employees', 'enrichments'];
      
      for (const collectionName of collections) {
        const collectionIndexes = await mongoose.connection.db.collection(collectionName).indexes();
        const vectorIndexes = collectionIndexes.filter((index: any) => 
          index.embedding || index.key?.embedding === 'vector'
        );
        
        if (vectorIndexes.length > 0) {
          indexes.push({
            collection: collectionName,
            indexes: vectorIndexes
          });
        }
      }
    } catch (error) {
      console.error('Failed to list vector indexes:', error);
    }
    
    return indexes;
  }
  
  /**
   * Drop vector indexes
   */
  async dropVectorIndexes(): Promise<void> {
    console.log('🗑️  Dropping vector indexes...');
    
    try {
      const collections = ['companies', 'employees', 'enrichments'];
      
      for (const collectionName of collections) {
        const indexes = await mongoose.connection.db.collection(collectionName).indexes();
        const vectorIndexes = indexes.filter((index: any) => 
          index.embedding || index.key?.embedding === 'vector'
        );
        
        for (const index of vectorIndexes) {
          await mongoose.connection.db.collection(collectionName).dropIndex(index.name);
          console.log(`✅ Dropped index ${index.name} from ${collectionName}`);
        }
      }
      
    } catch (error: any) {
      console.error('Failed to drop vector indexes:', error.message);
      throw error;
    }
  }
}

export const vectorIndexManager = new VectorIndexManager();