import { OpenAI } from 'openai';
import mongoose from 'mongoose';
import { Company, Employee, Enrichment, GTMIntelligence, GTMPersonaIntelligence } from '../../models/index';
import { generateEmbeddingText, extractKeywords } from './VectorUtils';

interface EmbeddingOptions {
  forceRegenerate?: boolean;
  batchSize?: number;
  rateLimit?: number;
  verbose?: boolean;
}

export class EmbeddingService {
  private openai: OpenAI;
  private rateLimit: number;
  private requestsThisMinute: number = 0;
  private lastResetTime: number = Date.now();

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required in environment variables');
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    this.rateLimit = parseInt(process.env.EMBEDDING_RATE_LIMIT || '100');
    
    console.log('✅ EmbeddingService initialized');
    console.log(`   Model: ${process.env.EMBEDDING_MODEL || 'text-embedding-3-small'}`);
    console.log(`   Rate limit: ${this.rateLimit} requests/minute`);
  }

  /**
   * Generate embedding for text using OpenAI
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Rate limiting
      await this.checkRateLimit();
      
      if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty');
      }
      
      // Truncate if too long (OpenAI limit is 8192 tokens)
      const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;
      
      const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
      
      const response = await this.openai.embeddings.create({
        model: model,
        input: truncatedText,
        encoding_format: 'float'
      });
      
      this.requestsThisMinute++;
      
      return response.data[0].embedding;
      
    } catch (error: any) {
      console.error('❌ Embedding generation failed:', error.message);
      
      if (error.status === 429) {
        console.log('⏳ Rate limit hit, waiting 60 seconds...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        return this.generateEmbedding(text);
      }
      
      throw error;
    }
  }

  /**
   * Generate and store embedding for a company
   */
  async embedCompany(companyId: string, options: EmbeddingOptions = {}): Promise<void> {
    try {
      const company = await Company.findById(companyId);
      if (!company) {
        throw new Error(`Company ${companyId} not found`);
      }
      
      // Check if embedding already exists and is up-to-date
      if (!options.forceRegenerate && 
          company.embedding && 
          company.embeddingGeneratedAt &&
          Date.now() - company.embeddingGeneratedAt.getTime() < 30 * 24 * 60 * 60 * 1000) { // 30 days
        if (options.verbose) {
          console.log(`ℹ️  Company ${company.name} already has recent embedding`);
        }
        return;
      }
      
      // Generate embedding text
      const embeddingText = generateEmbeddingText(company.toObject(), 'company');
      
      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      
      // Extract search keywords
      const searchKeywords = extractKeywords(embeddingText);
      
      // Update company
      company.embedding = embedding;
      company.embeddingText = embeddingText;
      company.embeddingGeneratedAt = new Date();
      company.searchKeywords = searchKeywords;
      company.semanticSummary = embeddingText.substring(0, 500);
      
      await company.save();
      
      if (options.verbose) {
        console.log(`✅ Embedded company: ${company.name} (${embedding.length} dimensions)`);
      }
      
    } catch (error: any) {
      console.error(`❌ Failed to embed company ${companyId}:`, error.message);
      throw error;
    }
  }

  /**
   * Generate and store embedding for an employee
   */
  async embedEmployee(employeeId: string, options: EmbeddingOptions = {}): Promise<void> {
    try {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        throw new Error(`Employee ${employeeId} not found`);
      }
      
      // Check if embedding already exists
      if (!options.forceRegenerate && 
          employee.embedding && 
          employee.embeddingGeneratedAt &&
          Date.now() - employee.embeddingGeneratedAt.getTime() < 30 * 24 * 60 * 60 * 1000) {
        if (options.verbose) {
          console.log(`ℹ️  Employee ${employee.fullName} already has recent embedding`);
        }
        return;
      }
      
      // Generate embedding text
      const embeddingText = generateEmbeddingText(employee.toObject(), 'employee');
      
      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      
      // Extract search keywords
      const searchKeywords = extractKeywords(embeddingText);
      
      // Update employee
      employee.embedding = embedding;
      employee.embeddingText = embeddingText;
      employee.embeddingGeneratedAt = new Date();
      employee.searchKeywords = searchKeywords;
      employee.semanticSummary = embeddingText.substring(0, 500);
      
      await employee.save();
      
      if (options.verbose) {
        console.log(`✅ Embedded employee: ${employee.fullName} (${embedding.length} dimensions)`);
      }
      
    } catch (error: any) {
      console.error(`❌ Failed to embed employee ${employeeId}:`, error.message);
      throw error;
    }
  }

  /**
   * Generate embedding for enrichment data
   */
  async embedEnrichment(enrichmentId: string, options: EmbeddingOptions = {}): Promise<void> {
    try {
      const enrichment = await Enrichment.findById(enrichmentId);
      if (!enrichment) {
        throw new Error(`Enrichment ${enrichmentId} not found`);
      }
      
      if (!options.forceRegenerate && enrichment.embedding) {
        if (options.verbose) {
          console.log(`ℹ️  Enrichment already has embedding`);
        }
        return;
      }
      
      // Generate embedding text from enrichment data
      const embeddingText = generateEmbeddingText(enrichment.toObject(), 'enrichment');
      
      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      
      // Update enrichment
      enrichment.embedding = embedding;
      enrichment.embeddingText = embeddingText;
      enrichment.embeddingGeneratedAt = new Date();
      
      await enrichment.save();
      
      if (options.verbose) {
        console.log(`✅ Embedded enrichment data (${embedding.length} dimensions)`);
      }
      
    } catch (error: any) {
      console.error(`❌ Failed to embed enrichment ${enrichmentId}:`, error.message);
      throw error;
    }
  }

  /**
   * Batch embed all documents of a type
   */
  async embedAllCompanies(options: EmbeddingOptions = {}): Promise<void> {
    const batchSize = options.batchSize || 50;
    const verbose = options.verbose || false;
    
    try {
      // Count total companies
      const totalCount = await Company.countDocuments();
      console.log(`📊 Found ${totalCount} total companies`);
      
      // Find companies without embeddings or with old embeddings
      let query = {
        $or: [
          { embedding: { $exists: false } },
          { embedding: null },
          { embeddingGeneratedAt: { $exists: false } },
          ...(options.forceRegenerate ? [] : [
            { embeddingGeneratedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
          ])
        ]
      };
      
      const toProcessCount = await Company.countDocuments(query);
      console.log(`🔧 Need to process ${toProcessCount} companies`);
      
      if (toProcessCount === 0) {
        console.log('✅ All companies already have up-to-date embeddings');
        return;
      }
      
      let processed = 0;
      let errors = 0;
      
      for (let skip = 0; skip < toProcessCount; skip += batchSize) {
        const companies = await Company.find(query)
          .skip(skip)
          .limit(batchSize)
          .lean();
        
        for (const company of companies) {
          try {
            await this.embedCompany(company._id.toString(), { verbose });
            processed++;
            
            // Progress update every 10 companies
            if (processed % 10 === 0) {
              console.log(`📈 Progress: ${processed}/${toProcessCount} companies embedded`);
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (error) {
            errors++;
            console.error(`Failed to embed company ${company._id}:`, error);
          }
        }
      }
      
      console.log(`🎉 Completed embedding ${processed} companies with ${errors} errors`);
      
    } catch (error: any) {
      console.error('❌ Batch company embedding failed:', error.message);
      throw error;
    }
  }

  /**
   * Batch embed all employees
   */
  async embedAllEmployees(options: EmbeddingOptions = {}): Promise<void> {
    const batchSize = options.batchSize || 50;
    const verbose = options.verbose || false;
    
    try {
      const totalCount = await Employee.countDocuments();
      console.log(`📊 Found ${totalCount} total employees`);
      
      let query = {
        $or: [
          { embedding: { $exists: false } },
          { embedding: null },
          { embeddingGeneratedAt: { $exists: false } },
          ...(options.forceRegenerate ? [] : [
            { embeddingGeneratedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
          ])
        ]
      };
      
      const toProcessCount = await Employee.countDocuments(query);
      console.log(`🔧 Need to process ${toProcessCount} employees`);
      
      if (toProcessCount === 0) {
        console.log('✅ All employees already have up-to-date embeddings');
        return;
      }
      
      let processed = 0;
      let errors = 0;
      
      for (let skip = 0; skip < toProcessCount; skip += batchSize) {
        const employees = await Employee.find(query)
          .skip(skip)
          .limit(batchSize)
          .lean();
        
        for (const employee of employees) {
          try {
            await this.embedEmployee(employee._id.toString(), { verbose });
            processed++;
            
            if (processed % 10 === 0) {
              console.log(`📈 Progress: ${processed}/${toProcessCount} employees embedded`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (error) {
            errors++;
            console.error(`Failed to embed employee ${employee._id}:`, error);
          }
        }
      }
      
      console.log(`🎉 Completed embedding ${processed} employees with ${errors} errors`);
      
    } catch (error: any) {
      console.error('❌ Batch employee embedding failed:', error.message);
      throw error;
    }
  }

  /**
   * Embed all documents across all collections
   */
  async embedAllDocuments(options: EmbeddingOptions = {}): Promise<void> {
    console.log('🚀 Starting embedding of all documents...');
    
    const startTime = Date.now();
    
    try {
      // Embed companies
      await this.embedAllCompanies(options);
      
      // Embed employees
      await this.embedAllEmployees(options);
      
      // You can add other collections here
      
      const elapsedTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`⏱️  Total embedding time: ${elapsedTime} seconds`);
      
    } catch (error: any) {
      console.error('❌ Full embedding process failed:', error.message);
      throw error;
    }
  }

  /**
   * Rate limiting helper
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinute = 60 * 1000;
    
    // Reset counter if more than a minute has passed
    if (now - this.lastResetTime > oneMinute) {
      this.requestsThisMinute = 0;
      this.lastResetTime = now;
    }
    
    // If we've hit the rate limit, wait
    if (this.requestsThisMinute >= this.rateLimit) {
      const waitTime = oneMinute - (now - this.lastResetTime) + 1000; // +1 second buffer
      console.log(`⏳ Rate limit reached, waiting ${Math.ceil(waitTime / 1000)} seconds...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Reset after waiting
      this.requestsThisMinute = 0;
      this.lastResetTime = Date.now();
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(): Promise<any> {
    const stats = {
      companies: {
        total: await Company.countDocuments(),
        withEmbeddings: await Company.countDocuments({ embedding: { $exists: true, $ne: null } }),
        withoutEmbeddings: await Company.countDocuments({ 
          $or: [
            { embedding: { $exists: false } },
            { embedding: null }
          ]
        }),
        outdated: await Company.countDocuments({
          embeddingGeneratedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        })
      },
      employees: {
        total: await Employee.countDocuments(),
        withEmbeddings: await Employee.countDocuments({ embedding: { $exists: true, $ne: null } }),
        withoutEmbeddings: await Employee.countDocuments({ 
          $or: [
            { embedding: { $exists: false } },
            { embedding: null }
          ]
        }),
        outdated: await Employee.countDocuments({
          embeddingGeneratedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        })
      }
    };
    
    return stats;
  }
}

export const embeddingService = new EmbeddingService();