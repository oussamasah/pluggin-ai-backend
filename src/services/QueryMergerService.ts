/**
 * Query Merger Service
 * Merges user queries with ICP configuration and extracts CoreSignal API filters
 */

interface ICPModel {
    config: {
      industries?: string[];
      geographies?: string[];
      employeeRange?: string;
      fundingStage?: string[];
      technologies?: string[];
      revenue?: string;
    };
  }
  
  interface CoreSignalFilters {
    // Company API filters

    industry?: { in_list: string[] }; // <--- CHANGED: Now an object
    country?: { in_list: string[] };
    location?: string[];
    employees_count_gte?: number;
    employees_count_lte?: number;
    funding_last_round_type?: string[];
    funding_last_round_date_gte?: string;
    funding_last_round_date_lte?: string;
    funding_rounds_count_gte?: number;
    technologies?: string[];
    
    // Job posting signals
    has_active_jobs?: boolean;
    job_titles?: string[];
    
    // Employee filters (for decision makers)
    employee_roles?: string[];
    employee_seniority?: string[];
  }
  
  interface MergedQueryResult {
    structuredQuery: string;
    coreSignalFilters: CoreSignalFilters;
    searchSteps: {
      step: number;
      action: string;
      apiEndpoint: string;
      filters: any;
    }[];
    criteria: {
        industry?: { in_list: string[] }; // <--- CHANGED: Now an object
        country?: { in_list: string[] };
      employeeRange?: string;
      fundingStage?: string[];
      technologies?: string[];
      hiringSignals?: boolean;
      decisionMakers?: boolean;
      revenue?: string;
      fundingRecency?: string;
    };
  }
  
  export class QueryMergerService {
    /**
     * Main method: Merge ICP with user query and extract all filters
     */
    public async mergeICPWithUserQuery(
      userQuery: string,
      icpModel: ICPModel
    ): Promise<MergedQueryResult> {
      try {
        // Extract ICP criteria
        const icpIndustries = icpModel.config.industries || [];
        const icpGeographies = icpModel.config.geographies || [];
        const icpEmployeeRange = icpModel.config.employeeRange;
        const icpFundingStage = icpModel.config.fundingStage || [];
        const icpTechnologies = icpModel.config.technologies || [];
  
        // Analyze user query
        const userQueryLower = userQuery.toLowerCase();
        
        // Check what user already specified
        const userHasIndustry = icpIndustries.some((industry: string) => 
          userQueryLower.includes(industry.toLowerCase())
        );
        
        const userHasLocation = icpGeographies.some((geo: string) => 
          userQueryLower.includes(geo.toLowerCase()) || 
          this.hasLocationKeywords(userQueryLower)
        );
        
        const userHasSize = this.extractEmployeeRange(userQuery) !== null;
        const userHasFunding = this.extractFundingInfo(userQuery).hasFunding;
        const userHasTech = this.extractTechnologies(userQuery).length > 0;
  
        // Build merged query parts
        const parts: string[] = [];
        
        // 1. Start with cleaned user query
        let cleanUserQuery = userQuery
          .replace(/\b(find|search|look for|companies|company|show me|get me)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanUserQuery) {
          parts.push(cleanUserQuery);
        }
        
        // 2. Add ICP industry if not covered
        if (!userHasIndustry && icpIndustries.length > 0) {
          parts.push(icpIndustries[0]);
        }
        
        // 3. Add ICP geography if not covered
        if (!userHasLocation && icpGeographies.length > 0) {
          parts.push(`in ${icpGeographies[0]}`);
        }
        
        // 4. Add ICP employee range if not covered
        if (!userHasSize && icpEmployeeRange) {
          parts.push(`with ${icpEmployeeRange} employees`);
        }
        
        // 5. Add ICP funding if not covered
        if (!userHasFunding && icpFundingStage.length > 0) {
          parts.push(`${icpFundingStage[0]} stage`);
        }
        
        // 6. Add ICP technologies if not covered
        if (!userHasTech && icpTechnologies.length > 0) {
          parts.push(`using ${icpTechnologies[0]}`);
        }
  
        // Construct final query
        let mergedQuery = parts.join(' ');
        mergedQuery = this.optimizeQueryLength(mergedQuery);
        
        // Extract all criteria from merged query and ICP
        const extractedCriteria = this.extractAllCriteria(
          mergedQuery, 
          userQuery,
          icpModel
        );
        
        // Build CoreSignal API filters
        const coreSignalFilters = this.buildCoreSignalFilters(extractedCriteria);
        
        // Build search steps for frontend progress tracking
        const searchSteps = this.buildSearchSteps(coreSignalFilters, extractedCriteria);
        
        return {
          structuredQuery: mergedQuery,
          coreSignalFilters,
          searchSteps,
          criteria: extractedCriteria
        };
        
      } catch (error) {
        console.error('Error merging ICP with user query:', error);
        
        // Fallback
        return {
          structuredQuery: this.optimizeQueryLength(userQuery),
          coreSignalFilters: {},
          searchSteps: [],
          criteria: {}
        };
      }
    }
  
    /**
     * Extract all criteria from merged query and ICP
     */
    private extractAllCriteria(
      mergedQuery: string,
      originalQuery: string,
      icpModel: ICPModel
    ): any {
      const queryLower = mergedQuery.toLowerCase();
      const originalLower = originalQuery.toLowerCase();
      
      const criteria: any = {};
      
      // 1. Industries
      const industries = this.extractIndustries(queryLower, icpModel.config.industries || []);
      if (industries.length > 0) criteria.industries = industries;
      
      // 2. Locations
      const locations = this.extractLocations(queryLower, icpModel.config.geographies || []);
      if (locations.length > 0) criteria.locations = locations;
      
      // 3. Employee range
      const employeeRange = this.extractEmployeeRange(mergedQuery) || icpModel.config.employeeRange;
      if (employeeRange) criteria.employeeRange = employeeRange;
      
      // 4. Funding info
      const fundingInfo = this.extractFundingInfo(mergedQuery);
      if (fundingInfo.hasFunding) {
        // Use user-extracted stages if present, otherwise fall back to ICP
        criteria.fundingStage = fundingInfo.stages || icpModel.config.fundingStage;
        criteria.fundingRecency = fundingInfo.recency;
      } else if (icpModel.config.fundingStage && icpModel.config.fundingStage.length > 0) {
        criteria.fundingStage = icpModel.config.fundingStage;
      }
      
      // 5. Technologies
      const technologies = this.extractTechnologies(mergedQuery);
      if (technologies.length > 0) {
        criteria.technologies = technologies;
      } else if (icpModel.config.technologies && icpModel.config.technologies.length > 0) {
        criteria.technologies = icpModel.config.technologies;
      }
      
      // 6. Hiring signals
      criteria.hiringSignals = this.detectHiringSignal(originalLower);
      
      // 7. Decision makers
      criteria.decisionMakers = this.detectDecisionMakerRequest(originalLower);
      
      // 8. Revenue
      const revenue = this.extractRevenue(mergedQuery) || icpModel.config.revenue;
      if (revenue) criteria.revenue = revenue;
      
      return criteria;
    }
  
    /**
     * Build CoreSignal API filters from extracted criteria
     */
/**
 * Convert CoreSignalFilters to proper Elasticsearch DSL query format
 * Add this method to your CompanyWorkflow class
 */
private extractCompanyFilters(filters: any): any {
  const filterConditions: any[] = [];

  // Industry filter
  if (filters.industry?.in_list?.length > 0) {
    filterConditions.push({
      "terms": {
        "industry": filters.industry.in_list
      }
    });
  }

  // Country filter
  if (filters.country?.in_list?.length > 0) {
    filterConditions.push({
      "terms": {
        "country": filters.country.in_list
      }
    });
  }

  // Employee count range
  if (filters.employees_count_gte !== undefined || filters.employees_count_lte !== undefined) {
    const range: any = {};
    if (filters.employees_count_gte !== undefined) {
      range.gte = filters.employees_count_gte;
    }
    if (filters.employees_count_lte !== undefined) {
      range.lte = filters.employees_count_lte;
    }
    
    filterConditions.push({
      "range": {
        "employee_count": range
      }
    });
  }

  // Funding filters
  if (filters.funding_last_round_type?.length > 0) {
    filterConditions.push({
      "terms": {
        "funding_last_round_type": filters.funding_last_round_type
      }
    });
  }

  // Funding date range
  if (filters.funding_last_round_date_gte || filters.funding_last_round_date_lte) {
    const dateRange: any = {};
    if (filters.funding_last_round_date_gte) {
      dateRange.gte = filters.funding_last_round_date_gte;
    }
    if (filters.funding_last_round_date_lte) {
      dateRange.lte = filters.funding_last_round_date_lte;
    }
    
    filterConditions.push({
      "range": {
        "funding_last_round_date": dateRange
      }
    });
  }

  // Technologies filter (if supported by CoreSignal)
  if (filters.technologies?.length > 0) {
    filterConditions.push({
      "terms": {
        "technologies": filters.technologies
      }
    });
  }

  // Active jobs filter
  if (filters.has_active_jobs) {
    filterConditions.push({
      "term": {
        "has_active_jobs": true
      }
    });
  }

  // Construct the Elasticsearch DSL query
  const query: any = {
    "bool": {}
  };

  // If we have filters, use them
  if (filterConditions.length > 0) {
    query.bool.filter = filterConditions;
  } else {
    // No filters, return all companies
    return { "match_all": {} };
  }

  return query;
}
/**
 * Convert CoreSignalFilters to proper Elasticsearch DSL query format
 * Add this method to your CompanyWorkflow class
 */
private extractCompanyFilters(filters: any): any {
    const filterConditions: any[] = [];
  
    // Industry filter
    if (filters.industry?.in_list?.length > 0) {
      filterConditions.push({
        "terms": {
          "industry": filters.industry.in_list
        }
      });
    }
  
    // Country filter
    if (filters.country?.in_list?.length > 0) {
      filterConditions.push({
        "terms": {
          "country": filters.country.in_list
        }
      });
    }
  
    // Employee count range
    if (filters.employees_count_gte !== undefined || filters.employees_count_lte !== undefined) {
      const range: any = {};
      if (filters.employees_count_gte !== undefined) {
        range.gte = filters.employees_count_gte;
      }
      if (filters.employees_count_lte !== undefined) {
        range.lte = filters.employees_count_lte;
      }
      
      filterConditions.push({
        "range": {
          "employee_count": range
        }
      });
    }
  
    // Funding filters
    if (filters.funding_last_round_type?.length > 0) {
      filterConditions.push({
        "terms": {
          "funding_last_round_type": filters.funding_last_round_type
        }
      });
    }
  
    // Funding date range
    if (filters.funding_last_round_date_gte || filters.funding_last_round_date_lte) {
      const dateRange: any = {};
      if (filters.funding_last_round_date_gte) {
        dateRange.gte = filters.funding_last_round_date_gte;
      }
      if (filters.funding_last_round_date_lte) {
        dateRange.lte = filters.funding_last_round_date_lte;
      }
      
      filterConditions.push({
        "range": {
          "funding_last_round_date": dateRange
        }
      });
    }
  
    // Technologies filter (if supported by CoreSignal)
    if (filters.technologies?.length > 0) {
      filterConditions.push({
        "terms": {
          "technologies": filters.technologies
        }
      });
    }
  
    // Active jobs filter
    if (filters.has_active_jobs) {
      filterConditions.push({
        "term": {
          "has_active_jobs": true
        }
      });
    }
  
    // Construct the Elasticsearch DSL query
    const query: any = {
      "bool": {}
    };
  
    // If we have filters, use them
    if (filterConditions.length > 0) {
      query.bool.filter = filterConditions;
    } else {
      // No filters, return all companies
      return { "match_all": {} };
    }
  
    return query;
  }
  
    /**
     * Build search steps for frontend progress tracking
     */
    private buildSearchSteps(filters: CoreSignalFilters, criteria: any): any[] {
      const steps: any[] = [];
      let stepNumber = 1;
      
      // Step 1: Always search companies
      const companyFilters = {
        industry: filters.industry,
        country: filters.country,
        employees_count_gte: filters.employees_count_gte,
        employees_count_lte: filters.employees_count_lte,
        funding_last_round_type: filters.funding_last_round_type,
        funding_last_round_date_gte: filters.funding_last_round_date_gte,
        funding_last_round_date_lte: filters.funding_last_round_date_lte,
        // NOTE: filters.technologies is usually handled in-memory/in-app, not in the first API call, 
        // but if the API supported it, it would go here. We follow the next step's approach.
      };
  
      steps.push({
        step: stepNumber++,
        action: 'Searching companies matching core criteria (Industry, Size, Location, Funding)',
        apiEndpoint: '/v2/company_multi_source/search/filter',
        filters: companyFilters,
      });
      
      // Step 2: Filter by technology if needed (assumed in-memory or a subsequent tech-specific API call)
      if (filters.technologies && filters.technologies.length > 0) {
        steps.push({
          step: stepNumber++,
          action: `Filtering by technology stack: ${filters.technologies.join(', ')}`,
          apiEndpoint: 'filter_in_memory_or_tech_api',
          filters: {
            technologies: filters.technologies
          }
        });
      }
      
      // Step 3: Check hiring activity if requested
      if (filters.has_active_jobs) {
        steps.push({
          step: stepNumber++,
          action: 'Checking active job postings (Hiring Signal)',
          apiEndpoint: '/v2/job/search/filter',
          filters: {
            company_ids: '${matched_company_ids}', // Placeholder for company IDs from step 1
            status: 'active'
          }
        });
      }
      
      // Step 4: Fetch decision makers if requested
      if (criteria.decisionMakers) {
        steps.push({
          step: stepNumber++,
          action: 'Loading decision makers and key contacts',
          apiEndpoint: '/v2/employee_multi_source/search/filter',
          filters: {
            company_ids: '${matched_company_ids}', // Placeholder for company IDs from step 1
            seniority: filters.employee_seniority,
            roles: filters.employee_roles
          }
        });
      }
      
      return steps;
    }
  
    /**
     * Extract industries from query
     */
    private extractIndustries(query: string, icpIndustries: string[]): string[] {
      const industries: string[] = [];
      
      // Check ICP industries
      icpIndustries.forEach(industry => {
        if (query.includes(industry.toLowerCase())) {
          if (!industries.includes(industry)) industries.push(industry);
        }
      });
      
      // Common industry keywords
      const industryKeywords: { [key: string]: string } = {
        'saas': 'SaaS',
        'software': 'Software',
        'fintech': 'Fintech',
        'e-commerce': 'E-commerce',
        'ecommerce': 'E-commerce',
        'healthcare': 'Healthcare',
        'edtech': 'EdTech',
        'ai': 'Artificial Intelligence',
        'crypto': 'Cryptocurrency',
        'logistics': 'Logistics',
        'retail': 'Retail',
        'b2b': 'B2B',
        'b2c': 'B2C'
      };
      
      Object.entries(industryKeywords).forEach(([keyword, industry]) => {
        // Use boundary-like checks to avoid partial matches (e.g., 'care' in 'healthcare')
        const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'g');
        if (query.match(keywordRegex) && !industries.includes(industry)) {
          industries.push(industry);
        }
      });
      
      return industries;
    }
  
    /**
     * Extract locations from query
     */
    private extractLocations(query: string, icpGeographies: string[]): string[] {
      const locations: string[] = [];
      
      // Check ICP geographies
      icpGeographies.forEach(geo => {
        if (query.includes(geo.toLowerCase())) {
          if (!locations.includes(geo)) locations.push(geo);
        }
      });
      
      // Common location aliases and countries (case-insensitive search)
      const locationAliases: { [key: string]: string } = {
        'ksa': 'Saudi Arabia',
        'saudi arabia': 'Saudi Arabia',
        'uae': 'United Arab Emirates',
        'dubai': 'United Arab Emirates',
        'united states': 'United States',
        'usa': 'United States',
        'us': 'United States',
        'united kingdom': 'United Kingdom',
        'uk': 'United Kingdom',
        'germany': 'Germany',
        'france': 'France'
      };
      
      Object.entries(locationAliases).forEach(([alias, location]) => {
        if (query.includes(alias) && !locations.includes(location)) {
          locations.push(location);
        }
      });
      
      return locations;
    }
  
    /**
     * Extract employee range from query
     */
    private extractEmployeeRange(query: string): string | null {
      const patterns = [
        // Matches '100 - 500 employees' or '100-500 employees'
        /(\d+)\s*-\s*(\d+)\s*employees?/i, 
        // Matches '100+ employees'
        /(\d+)\s*\+\s*employees?/i, 
        // Matches specific range keywords like 'small', 'mid-size', 'large'
        /\b(small|mid-size|large)\s+company/i 
      ];
      
      for (const pattern of patterns) {
        const match = query.match(pattern);
        if (match) {
          if (match[3] && match[3].toLowerCase() === 'small') return '1-50';
          if (match[3] && match[3].toLowerCase() === 'mid-size') return '50-500';
          if (match[3] && match[3].toLowerCase() === 'large') return '500+';
  
          if (match[2]) {
            return `${match[1]}-${match[2]}`;
          } else if (query.includes('+')) {
            return `${match[1]}+`;
          } else {
            // Single number, treat as range
            const num = parseInt(match[1]);
            return `${Math.max(1, num - 50)}-${num + 50}`; 
          }
        }
      }
      
      return null;
    }
  
    /**
     * Parse employee range to min/max numbers
     */
    private parseEmployeeRange(range: string): { min?: number; max?: number } {
      if (range.includes('-')) {
        const [minStr, maxStr] = range.split('-');
        const min = parseInt(minStr.trim());
        const max = parseInt(maxStr.trim());
        return { min: isNaN(min) ? undefined : min, max: isNaN(max) ? undefined : max };
      } else if (range.includes('+')) {
        const min = parseInt(range.replace('+', ''));
        return { min: isNaN(min) ? undefined : min };
      } else {
        // Single number (handled in extractEmployeeRange, but as a fallback)
        const num = parseInt(range);
        return { min: Math.max(1, num - 50), max: num + 50 };
      }
    }
  
    /**
     * Extract funding information from query
     */
    private extractFundingInfo(query: string): {
      hasFunding: boolean;
      stages?: string[];
      recency?: string;
    } {
      const queryLower = query.toLowerCase();
      
      const fundingKeywords = ['funded', 'funding', 'raised', 'series', 'seed', 'round', 'vc-backed'];
      const hasFunding = fundingKeywords.some(kw => queryLower.includes(kw));
      
      if (!hasFunding) return { hasFunding: false };
      
      const stages: string[] = [];
      const stageMap: { [key: string]: string } = {
        'seed': 'Seed',
        'series a': 'Series A',
        'series b': 'Series B',
        'series c': 'Series C',
        'series d': 'Series D',
        'pre-seed': 'Pre-Seed'
      };
      
      Object.entries(stageMap).forEach(([keyword, stage]) => {
        if (queryLower.includes(keyword)) {
          if (!stages.includes(stage)) stages.push(stage);
        }
      });
      
      // Detect recency
      let recency: string | undefined;
      if (queryLower.includes('recently funded') || queryLower.includes('recent funding')) {
        recency = '6months';
      } else if (queryLower.includes('last 12 months') || queryLower.includes('past year')) {
        recency = '12months';
      } else if (queryLower.includes('last 2 years')) {
        recency = '24months';
      }
      
      return { 
        hasFunding: true, 
        stages: stages.length > 0 ? stages : undefined, 
        recency 
      };
    }
  
    /**
     * Extract technologies from query
     */
    private extractTechnologies(query: string): string[] {
      const techKeywords = [
        'AWS', 'Azure', 'GCP', 'Google Cloud',
        'React', 'Angular', 'Vue', 'Next.js', 'Next',
        'Python', 'Java', 'Node.js', 'Node', 'TypeScript',
        'Kubernetes', 'Docker', 'Terraform',
        'Salesforce', 'HubSpot', 'Marketo',
        'Stripe', 'PayPal', 'Shopify'
      ];
      
      const foundTech: string[] = [];
  
      techKeywords.forEach(tech => {
        // Use word boundaries for better matching
        const techRegex = new RegExp(`\\b${tech.replace('.', '\\.')}\\b`, 'i'); 
        if (query.match(techRegex)) {
          if (!foundTech.includes(tech)) foundTech.push(tech);
        }
      });
      
      return foundTech;
    }
  
    /**
     * Extract revenue information
     */
    private extractRevenue(query: string): string | null {
      const revenuePatterns = [
        // Matches 'revenue over $10M' or 'revenue above 500k'
        /revenue\s+(?:over|above)\s+\$?(\d+\.?\d*[KMB])/i,
        // Matches '$1M+ revenue'
        /\$?(\d+\.?\d*[KMB])\s*\+/i 
      ];
      
      for (const pattern of revenuePatterns) {
        const match = query.match(pattern);
        if (match) {
          return match[1].toUpperCase(); // Normalize to e.g., '10M'
        }
      }
      
      return null;
    }
  
    /**
     * Detect if query includes hiring signals
     */
    private detectHiringSignal(query: string): boolean {
      const hiringKeywords = ['hiring', 'recruiting', 'job posting', 'open position', 'career', 'looking for talent'];
      return hiringKeywords.some(kw => query.includes(kw));
    }
  
    /**
     * Detect if user wants decision maker information
     */
    private detectDecisionMakerRequest(query: string): boolean {
      const decisionMakerKeywords = [
        'decision maker', 'executive', 'cto', 'ceo', 'cfo', 'vp', 
        'director', 'head of', 'contact', 'lead', 'founder', 'person in charge'
      ];
      return decisionMakerKeywords.some(kw => query.includes(kw));
    }
  
    /**
     * Extract decision maker roles based on criteria (light-weight logic)
     */
    private extractDecisionMakerRoles(criteria: any): string[] {
      const roles = new Set<string>();
      
      // Always include C-suite general roles
      roles.add('CEO');
      roles.add('Founder');
      roles.add('Co-Founder');
      
      // Add technical/product roles if relevant criteria are present
      if (criteria.industries?.includes('SaaS') || criteria.technologies?.length > 0) {
        roles.add('CTO');
        roles.add('VP Engineering');
        roles.add('Head of Product');
      }
      
      // Add sales/marketing roles if not specifically technical
      if (!criteria.industries?.includes('SaaS')) {
        roles.add('CMO');
        roles.add('VP Sales');
      }
      
      return Array.from(roles);
    }
  
    /**
     * Map location names to country codes (simplified mapping)
     */
    private mapToCountryCodes(locations: string[]): string[] {
      const countryMap: { [key: string]: string } = {
        'Saudi Arabia': 'SA',
        'United Arab Emirates': 'AE',
        'United States': 'US',
        'United Kingdom': 'GB',
        'Germany': 'DE',
        'France': 'FR'
      };
      
      return locations
        .map(loc => countryMap[loc] || loc) // Map known names
        .filter(code => code.length === 2) // Assume 2-letter codes for API filter
        .map(code => code.toUpperCase()); 
    }
  
    /**
     * Map funding stages to CoreSignal API format
     */
    private mapFundingStages(stages: string[]): string[] {
      return stages.map(stage => stage.replace(/-/g, '').replace(/\s/g, '_').toUpperCase());
      // Example: "Pre-Seed" -> "PRE_SEED"
    }
  
    /**
     * Calculate date range for funding recency
     */
    private calculateFundingDateRange(recency: string): { from: string; to: string } {
      const now = new Date();
      // Use ISO format YYYY-MM-DD
      const to = now.toISOString().split('T')[0]; 
      
      let monthsBack = 12; // Default to 12 months
      if (recency === '6months') monthsBack = 6;
      else if (recency === '24months') monthsBack = 24;
      
      const fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - monthsBack);
      // Set day to 1 to ensure full month range
      fromDate.setDate(1); 
      const from = fromDate.toISOString().split('T')[0];
      
      return { from, to };
    }
  
    /**
     * Check if query contains location keywords
     */
    private hasLocationKeywords(query: string): boolean {
      const locationIndicators = [' in ', ' based in ', ' located in ', ' from ', ' based ', 'location:'];
      return locationIndicators.some(indicator => query.includes(indicator));
    }
    
    /**
     * Optimize query length to stay under 200 characters
     */
    private optimizeQueryLength(query: string): string {
      if (query.length <= 200) return query;
      
      let optimized = query
        .replace(/\b(that|which|who|and|the|a|an)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (optimized.length <= 200) return optimized;
      
      return optimized.substring(0, 197) + '...';
    }
  }
  