import { OllamaService } from './OllamaService';

interface ExtractedFilters {
  industry?: string[];
  country?: string[];
  size?: string[];
  funding_last_round_type?: string[];
  funding_recency?: string;
  technologies?: string[];
  hiring_signals?: boolean;
  decision_makers?: boolean;
  revenue?: string;
  keywords?: string[];
  confidence?: number;
}

export class LLMQueryFilterExtractor {
  private ollamaService: OllamaService;

  constructor() {
    this.ollamaService = new OllamaService();
  }

  /**
   * Main extraction method - uses LLM to extract all possible filters from natural language
   */
  async extractFilters(query: string): Promise<ExtractedFilters> {
    console.log('🤖 Using LLM to extract filters from query:', query);

    const systemPrompt = `You are an expert at analyzing B2B company search queries and extracting structured filters.

Your task is to parse natural language queries and extract ALL possible filter criteria that can be used to search for companies.

**IMPORTANT MAPPING RULES:**

**Industries** - Map to CoreSignal documented values:
- "SaaS" or "software" → "Software Development"
- "fintech" → "Financial Services"
- "e-commerce" or "ecommerce" → "Retail"
- "healthcare" → "Hospitals and Health Care"
- "edtech" → "E-learning"
- "AI" or "artificial intelligence" → "Technology, Information and Internet"
- "B2B" → "Business Consulting and Services"
- "B2C" → "Consumer Services"
- Use exact CoreSignal industry names when possible

**Countries** - Use FULL country names:
- "KSA" or "Saudi" → "Saudi Arabia"
- "UAE" or "Dubai" → "United Arab Emirates"
- "US" or "USA" → "United States"
- "UK" → "United Kingdom"

**Company Sizes** - Map to CoreSignal size format:
- "startup" or "small" or "1-50" → ["1-10 employees", "11-50 employees"]
- "51-200" or "mid-size" → ["51-200 employees"]
- "200-500" → ["201-500 employees"]
- "500+" or "large" → ["501-1,000 employees", "1,001-5,000 employees", "5,001-10,000 employees"]
- "enterprise" or "1000+" → ["1,001-5,000 employees", "5,001-10,000 employees", "10,001+ employees"]

**Funding Stages** - Map to CoreSignal values:
- "seed" → "Seed"
- "pre-seed" → "Pre seed"
- "series a" → "Series A"
- "series b" → "Series B"
- "recently funded" or "recent funding" → Add funding_recency: "6months"
- "funded last year" → Add funding_recency: "12months"

**Hiring Signals:**
- "hiring", "recruiting", "open positions" → hiring_signals: true

**Decision Makers:**
- "contact", "CTO", "CEO", "founder", "decision maker" → decision_makers: true

**Technologies:**
- Extract specific technology mentions: AWS, React, Python, Salesforce, etc.

Return a JSON object with these fields (only include fields found in query):
{
  "industry": ["array of industries"],
  "country": ["array of countries"],
  "size": ["array of size ranges"],
  "funding_last_round_type": ["array of funding stages"],
  "funding_recency": "6months|12months|24months",
  "technologies": ["array of technologies"],
  "hiring_signals": boolean,
  "decision_makers": boolean,
  "revenue": "10M+",
  "keywords": ["other relevant search terms"],
  "confidence": 0.0-1.0
}`;

    const prompt = `Extract ALL possible filters from this company search query:

**Query:** "${query}"

Analyze the query and extract:
1. Industries mentioned (map to standard CoreSignal values)
2. Countries/locations (use full country names)
3. Company size indicators (map to CoreSignal size format)
4. Funding information (stages and recency)
5. Technologies mentioned
6. Hiring/recruiting signals
7. Decision maker requests (C-level, founders, etc.)
8. Revenue indicators
9. Any other relevant keywords

Return ONLY valid JSON matching the schema above. Be thorough - extract every relevant filter you can find.`;

    try {
      const response = await this.ollamaService.generate(prompt, systemPrompt);
      const parsed = this.parseJSONResponse(response);
      
      console.log('✅ Extracted filters:', JSON.stringify(parsed, null, 2));
      
      // Validate and normalize the response
      const validated = this.validateAndNormalizeFilters(parsed);
      
      return validated;
    } catch (error) {
      console.error('❌ LLM extraction failed, falling back to rule-based:', error);
      return this.fallbackExtraction(query);
    }
  }

  /**
   * Validate and normalize LLM output to ensure CoreSignal compatibility
   */
  private validateAndNormalizeFilters(filters: any): ExtractedFilters {
    const validated: ExtractedFilters = {};

    // Validate industries
    if (filters.industry && Array.isArray(filters.industry)) {
      validated.industry = filters.industry.filter((i: string) => 
        i && typeof i === 'string' && i.length > 0
      );
    }

    // Validate countries
    if (filters.country && Array.isArray(filters.country)) {
      validated.country = filters.country.filter((c: string) => 
        c && typeof c === 'string' && c.length > 0
      );
    }

    // Validate sizes
    if (filters.size && Array.isArray(filters.size)) {
      validated.size = filters.size.filter((s: string) => 
        s && typeof s === 'string' && s.includes('employee')
      );
    }

    // Validate funding
    if (filters.funding_last_round_type && Array.isArray(filters.funding_last_round_type)) {
      validated.funding_last_round_type = filters.funding_last_round_type;
    }
    if (filters.funding_recency && typeof filters.funding_recency === 'string') {
      validated.funding_recency = filters.funding_recency;
    }

    // Validate technologies
    if (filters.technologies && Array.isArray(filters.technologies)) {
      validated.technologies = filters.technologies;
    }

    // Validate booleans
    if (filters.hiring_signals === true) {
      validated.hiring_signals = true;
    }
    if (filters.decision_makers === true) {
      validated.decision_makers = true;
    }

    // Validate revenue
    if (filters.revenue && typeof filters.revenue === 'string') {
      validated.revenue = filters.revenue;
    }

    // Validate keywords
    if (filters.keywords && Array.isArray(filters.keywords)) {
      validated.keywords = filters.keywords;
    }

    // Set confidence
    validated.confidence = filters.confidence || 0.8;

    return validated;
  }

  /**
   * Fallback rule-based extraction if LLM fails
   */
  private fallbackExtraction(query: string): ExtractedFilters {
    const queryLower = query.toLowerCase();
    const filters: ExtractedFilters = { confidence: 0.6 };

    console.log('⚠️ Using fallback rule-based extraction');

    // Industry detection
    const industryMap: { [key: string]: string } = {
      'saas': 'Software Development',
      'software': 'Software Development',
      'fintech': 'Financial Services',
      'ecommerce': 'Retail',
      'e-commerce': 'Retail',
      'healthcare': 'Hospitals and Health Care',
      'edtech': 'E-learning',
      'b2b': 'Business Consulting and Services',
      'b2c': 'Consumer Services'
    };

    const foundIndustries: string[] = [];
    Object.entries(industryMap).forEach(([keyword, industry]) => {
      if (queryLower.includes(keyword) && !foundIndustries.includes(industry)) {
        foundIndustries.push(industry);
      }
    });
    if (foundIndustries.length > 0) filters.industry = foundIndustries;

    // Country detection
    const countryMap: { [key: string]: string } = {
      'ksa': 'Saudi Arabia',
      'saudi': 'Saudi Arabia',
      'uae': 'United Arab Emirates',
      'dubai': 'United Arab Emirates',
      'usa': 'United States',
      'us': 'United States'
    };

    const foundCountries: string[] = [];
    Object.entries(countryMap).forEach(([keyword, country]) => {
      if (queryLower.includes(keyword) && !foundCountries.includes(country)) {
        foundCountries.push(country);
      }
    });
    if (foundCountries.length > 0) filters.country = foundCountries;

    // Size detection
    if (queryLower.match(/\d+\s*-\s*\d+\s*employee/)) {
      const match = queryLower.match(/(\d+)\s*-\s*(\d+)\s*employee/);
      if (match) {
        filters.size = [`${match[1]}-${match[2]} employees`];
      }
    } else if (queryLower.includes('startup') || queryLower.includes('small')) {
      filters.size = ['1-10 employees', '11-50 employees'];
    }

    // Funding detection
    if (queryLower.includes('funded') || queryLower.includes('funding')) {
      if (queryLower.includes('seed')) filters.funding_last_round_type = ['Seed'];
      if (queryLower.includes('series a')) filters.funding_last_round_type = ['Series A'];
      if (queryLower.includes('recently')) filters.funding_recency = '6months';
    }

    // Hiring signals
    if (queryLower.includes('hiring') || queryLower.includes('recruiting')) {
      filters.hiring_signals = true;
    }

    // Decision makers
    if (queryLower.match(/\b(cto|ceo|founder|decision maker|contact)\b/)) {
      filters.decision_makers = true;
    }

    return filters;
  }

  /**
   * Parse JSON from LLM response
   */
  private parseJSONResponse(response: string): any {
    try {
      // Try to find JSON in the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(response);
    } catch (error) {
      console.error('Failed to parse JSON response:', response);
      throw error;
    }
  }

  /**
   * Convert extracted filters to CoreSignal API format
   */
  convertToCoreSignalFormat(filters: ExtractedFilters): any {
    const coreSignalFilters: any = {};

    if (filters.industry && filters.industry.length > 0) {
      coreSignalFilters.industry = { in_list: filters.industry };
    }

    if (filters.country && filters.country.length > 0) {
      coreSignalFilters.country = { in_list: filters.country };
    }

    if (filters.size && filters.size.length > 0) {
      // Extract min/max from size strings
      const sizeRange = this.extractEmployeeRange(filters.size[0]);
      if (sizeRange.min) coreSignalFilters.employees_count_gte = sizeRange.min;
      if (sizeRange.max) coreSignalFilters.employees_count_lte = sizeRange.max;
    }

    if (filters.funding_last_round_type && filters.funding_last_round_type.length > 0) {
      coreSignalFilters.funding_last_round_type = filters.funding_last_round_type;
    }

    if (filters.funding_recency) {
      const dates = this.calculateFundingDateRange(filters.funding_recency);
      coreSignalFilters.funding_last_round_date_gte = dates.from;
      coreSignalFilters.funding_last_round_date_lte = dates.to;
    }

    if (filters.technologies && filters.technologies.length > 0) {
      coreSignalFilters.technologies = filters.technologies;
    }

    if (filters.hiring_signals) {
      coreSignalFilters.has_active_jobs = true;
    }

    return coreSignalFilters;
  }

  /**
   * Extract employee range from size string
   */
  private extractEmployeeRange(size: string): { min?: number; max?: number } {
    const match = size.match(/(\d+)-(\d+)/);
    if (match) {
      return { min: parseInt(match[1]), max: parseInt(match[2]) };
    }
    
    const plusMatch = size.match(/(\d+)\+/);
    if (plusMatch) {
      return { min: parseInt(plusMatch[1]) };
    }

    return {};
  }

  /**
   * Calculate funding date range
   */
  private calculateFundingDateRange(recency: string): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    
    let monthsBack = 12;
    if (recency === '6months') monthsBack = 6;
    else if (recency === '24months') monthsBack = 24;
    
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - monthsBack);
    const from = fromDate.toISOString().split('T')[0];
    
    return { from, to };
  }
}

export const createLLMQueryFilterExtractor = () => {
  return new LLMQueryFilterExtractor();
};