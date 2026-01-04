/**
 * Utility functions for vector operations
 */

// Cosine similarity calculation
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same dimensions');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  // Normalize vector
  export function normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map(val => val / magnitude);
  }
  
  // Generate searchable text from documents
  export function generateEmbeddingText(entity: any, entityType: string): string {
    switch (entityType) {
      case 'company':
        return `
          Company: ${entity.name || ''}
          Description: ${entity.description || ''}
          Industry: ${Array.isArray(entity.industry) ? entity.industry.join(', ') : entity.industry || ''}
          Technologies: ${Array.isArray(entity.technologies) ? entity.technologies.join(', ') : entity.technologies || ''}
          Location: ${entity.city || ''} ${entity.country || ''}
          Employee Count: ${entity.employeeCount || ''}
          Revenue: ${entity.annualRevenue || ''}
          Funding Stage: ${entity.fundingStage || ''}
          Website: ${entity.domain || ''}
        `.trim();
  
      case 'employee':
        return `
          Name: ${entity.fullName || ''}
          Title: ${entity.activeExperienceTitle || entity.headline || ''}
          Company: ${entity.currentCompany?.company_name || ''}
          Department: ${entity.activeExperienceDepartment || ''}
          Management Level: ${entity.activeExperienceManagementLevel || ''}
          Skills: ${Array.isArray(entity.inferredSkills) ? entity.inferredSkills.join(', ') : entity.inferredSkills || ''}
          Experience: ${entity.totalExperienceDurationMonths ? 
            `${Math.round(entity.totalExperienceDurationMonths / 12)} years` : ''}
          Location: ${entity.locationCity || ''} ${entity.locationCountry || ''}
          Summary: ${entity.summary || ''}
          Decision Maker: ${entity.isDecisionMaker ? 'Yes' : 'No'}
        `.trim();
  
      case 'enrichment':
        const data = entity.data || {};
        return `
          Company: ${data.company_name || ''}
          Description: ${data.description || ''}
          Industry: ${data.industry || ''}
          Employees: ${data.employees_count || ''}
          Revenue: ${data.revenue_annual?.source_5_annual_revenue?.annual_revenue || ''}
          Funding: ${data.last_funding_round_amount_raised || ''}
          Technologies: ${Array.isArray(data.technologies_used) ? 
            data.technologies_used.map((t: any) => t.name || t).join(', ') : ''}
          Executives: ${Array.isArray(data.key_executives) ? 
            data.key_executives.map((e: any) => e.name).join(', ') : ''}
          Headquarters: ${data.hq_full_address || ''}
        `.trim();
  
      case 'gtm_intelligence':
        return `
          Company Analysis: ${entity.overview || ''}
        `.trim();
  
      case 'gtm_persona_intelligence':
        return `
          Employee Analysis: ${entity.overview || ''}
        `.trim();
  
      default:
        return JSON.stringify(entity).substring(0, 2000);
    }
  }
  
  // Extract search keywords from text
  export function extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'with', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
      'can', 'could', 'may', 'might', 'must', 'shall', 'of', 'from', 'that'
    ]);
    
    return text.toLowerCase()
      .split(/[\s\W]+/)
      .filter(word => 
        word.length > 2 && 
        !stopWords.has(word) &&
        /^[a-z]+$/.test(word)
      )
      .filter((word, index, arr) => arr.indexOf(word) === index) // unique
      .slice(0, 50); // Limit to 50 keywords
  }