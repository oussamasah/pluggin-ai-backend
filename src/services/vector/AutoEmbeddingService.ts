// src/services/vector/AutoEmbeddingService.ts
import { OpenAI } from 'openai';
import { Company, Employee, Enrichment, GTMIntelligence, GTMPersonaIntelligence } from '../../models/index';

export class AutoEmbeddingService {
  private openai: OpenAI;
  private isEnabled: boolean;

  constructor() {
    this.isEnabled = !!process.env.OPENAI_API_KEY;
    if (this.isEnabled) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log('✅ AutoEmbeddingService initialized');
    } else {
      console.log('⚠️ AutoEmbeddingService disabled (no OPENAI_API_KEY)');
    }
  }

  /**
   * Generate embedding for text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isEnabled || !text?.trim()) {
      return this.generateFallbackEmbedding(text);
    }

    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000),
        encoding_format: 'float'
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('OpenAI embedding failed, using fallback:', error);
      return this.generateFallbackEmbedding(text);
    }
  }

  /**
   * Fallback embedding when OpenAI fails
   */
  private generateFallbackEmbedding(text: string): number[] {
    if (!text) return new Array(1536).fill(0);
    
    // Simple word frequency-based embedding
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const uniqueWords = [...new Set(words)];
    const embedding = new Array(1536).fill(0);
    
    uniqueWords.forEach(word => {
      const hash = this.hashString(word);
      const position = Math.abs(hash) % 1536;
      embedding[position] += 1;
    });
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      return embedding.map(val => val / magnitude);
    }
    return embedding;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  /**
   * Generate embedding text from a document
   */
  generateEmbeddingText(doc: any, docType: string): string {
    switch (docType) {
      case 'company':
        return `
          Company: ${doc.name || ''}
          Description: ${doc.description || ''}
          Industry: ${Array.isArray(doc.industry) ? doc.industry.join(', ') : doc.industry || ''}
          Technologies: ${Array.isArray(doc.technologies) ? doc.technologies.join(', ') : doc.technologies || ''}
          Location: ${doc.city || ''} ${doc.country || ''}
          Employee Count: ${doc.employeeCount || ''}
          Revenue: ${doc.annualRevenue || ''}
          Funding Stage: ${doc.fundingStage || ''}
        `.trim();

      case 'employee':
        return `
          Name: ${doc.fullName || ''}
          Title: ${doc.activeExperienceTitle || doc.headline || ''}
          Company: ${doc.company?.company_name || ''}
          Department: ${doc.activeExperienceDepartment || ''}
          Management Level: ${doc.activeExperienceManagementLevel || ''}
          Skills: ${Array.isArray(doc.inferredSkills) ? doc.inferredSkills.slice(0, 10).join(', ') : doc.inferredSkills || ''}
          Location: ${doc.locationCity || ''} ${doc.locationCountry || ''}
          Summary: ${doc.summary || ''}
          Decision Maker: ${doc.isDecisionMaker ? 'Yes' : 'No'}
        `.trim();

      case 'enrichment':
        const data = doc.data || {};
        return `
          Company: ${data.company_name || ''}
          Description: ${data.description || ''}
          Industry: ${data.industry || ''}
          Employees: ${data.employees_count || ''}
          Revenue: ${data.revenue_annual?.source_5_annual_revenue?.annual_revenue || ''}
          Funding: ${data.last_funding_round_amount_raised || ''}
          Technologies: ${Array.isArray(data.technologies_used) ? 
            data.technologies_used.map((t: any) => t.name || t).slice(0, 10).join(', ') : ''}
        `.trim();

      default:
        return JSON.stringify(doc).substring(0, 2000);
    }
  }

  /**
   * Auto-embed a document on save
   */
  async autoEmbedOnSave(doc: any, docType: string): Promise<void> {
    try {
      // Skip if already has recent embedding
      if (doc.embedding && doc.embeddingGeneratedAt) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (doc.embeddingGeneratedAt > thirtyDaysAgo) {
          return; // Already has recent embedding
        }
      }

      console.log(`🔧 Auto-embedding ${docType}: ${doc.name || doc.fullName || doc._id}`);
      
      // Generate embedding text
      const embeddingText = this.generateEmbeddingText(doc, docType);
      
      // Generate embedding
      const embedding = await this.generateEmbedding(embeddingText);
      
      // Update document
      doc.embedding = embedding;
      doc.embeddingText = embeddingText.substring(0, 1000);
      doc.embeddingGeneratedAt = new Date();
      
      if (docType === 'company' || docType === 'employee') {
        // Add search keywords
        const searchKeywords = this.extractKeywords(embeddingText);
        doc.searchKeywords = [...new Set([...(doc.searchKeywords || []), ...searchKeywords])];
        doc.semanticSummary = embeddingText.substring(0, 500);
      }
      
      console.log(`✅ Auto-embedded ${docType}`);
      
    } catch (error) {
      console.error(`❌ Auto-embedding failed for ${docType}:`, error);
      // Don't throw - we don't want to break the save operation
    }
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    if (!text) return [];
    
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
    
    return text.toLowerCase()
      .split(/[\s\W]+/)
      .filter(word => 
        word.length > 2 && 
        !stopWords.has(word) &&
        /^[a-z]+$/.test(word)
      )
      .filter((word, index, arr) => arr.indexOf(word) === index)
      .slice(0, 20);
  }

  /**
   * Batch embed all documents
   */
  async batchEmbedAll(limit = 100): Promise<void> {
    console.log('🚀 Starting batch embedding...');
    
    // Embed companies
    const companies = await Company.find({
      $or: [
        { embedding: { $exists: false } },
        { embedding: null },
        { embeddingGeneratedAt: { $exists: false } }
      ]
    }).limit(limit);
    
    for (const company of companies) {
      await this.autoEmbedOnSave(company, 'company');
      await company.save();
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
    }
    
    // Embed employees
    const employees = await Employee.find({
      $or: [
        { embedding: { $exists: false } },
        { embedding: null },
        { embeddingGeneratedAt: { $exists: false } }
      ]
    }).limit(limit);
    
    for (const employee of employees) {
      await this.autoEmbedOnSave(employee, 'employee');
      await employee.save();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ Batch embedding complete: ${companies.length} companies, ${employees.length} employees`);
  }
}

export const autoEmbeddingService = new AutoEmbeddingService();

