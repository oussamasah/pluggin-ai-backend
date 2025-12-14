// ==================== COMPREHENSIVE CORESIGNAL QUERY FORMATTER SERVICE ====================
// Detects multiple business intents: new products, offices, hiring, expansions, partnerships, funding, etc.

import { ollamaService } from "./OllamaService";

interface QueryConfig {
  field?: string;
  operator?: 'AND' | 'OR';
  useWildcards?: boolean;
}

interface CoreSignalRequestBody {
  query: {
    bool: {
      must: Array<{
        query_string: {
          query: string;
          default_field: string;
          default_operator: string;
        }
      }>;
    }
  };
}

interface BusinessIntent {
  type: 'NEW_PRODUCT' | 'NEW_OFFICE' | 'HIRING' | 'EXPANSION' | 'PARTNERSHIP' | 'FUNDING' | 'ACQUISITION' | 'MERGER' | 'REBRANDING' | 'LEADERSHIP_CHANGE' | 'AWARD' | 'CONTRACT_WIN';
  confidence: number;
  keywords: string[];
}

export class CoreSignalQueryFormatter {
  
  /**
   * Detect business intent from natural language query
   */
  private static detectBusinessIntent(text: string): BusinessIntent[] {
    const lowerText = text.toLowerCase();
    const intents: BusinessIntent[] = [];
    
    // Define intent patterns and keywords
    const intentPatterns = [
      {
        type: 'NEW_PRODUCT' as const,
        patterns: [
          /launched? (?:new|a) (?:product|service|app|software|platform|tool)/i,
          /introduced? (?:new|a)/i,
          /announced? (?:new|a)/i,
          /unveiled? (?:new|a)/i,
          /roll(?:ing)? out (?:new|a)/i,
          /released? (?:new|a)/i,
          /product launch/i,
          /new (?:product|service|feature|version|update|release)/i
        ],
        keywords: ['launch', 'introduce', 'announce', 'unveil', 'release', 'product', 'service', 'app', 'software', 'platform', 'beta', 'alpha', 'version']
      },
      {
        type: 'NEW_OFFICE' as const,
        patterns: [
          /opened? (?:new|a) (?:office|location|branch|facility)/i,
          /expanded? to (?:new|a)/i,
          /entered? (?:new|a) (?:market|region)/i,
          /new (?:office|location|branch|headquarters|hq)/i,
          /relocated? (?:office|headquarters)/i,
          /moved? to/i,
          /geographic expansion/i,
          /global expansion/i
        ],
        keywords: ['office', 'location', 'branch', 'headquarters', 'hq', 'facility', 'expanding to', 'entering', 'new market', 'new region']
      },
      {
        type: 'HIRING' as const,
        patterns: [
          /hiring|recruiting|staffing/i,
          /job openings?|positions? available/i,
          /expanding team/i,
          /hiring spree/i,
          /talent acquisition/i,
          /looking for (?:engineers|developers|sales|marketing)/i,
          /hiring (?:engineers|developers|employees|staff)/i,
          /workforce expansion/i,
          /growing team/i
        ],
        keywords: ['hiring', 'recruiting', 'jobs', 'positions', 'careers', 'vacancies', 'open roles', 'expanding team', 'growing team', 'talent']
      },
      {
        type: 'EXPANSION' as const,
        patterns: [
          /expand(?:ing|ed)? (?:operations|business|presence)/i,
          /growing (?:globally|internationally)/i,
          /scale(?:ing|ed)? (?:up|operations)/i,
          /increased? (?:capacity|production)/i,
          /business growth/i,
          /market expansion/i,
          /operational expansion/i,
          /opening (?:new|additional)/i
        ],
        keywords: ['expanding', 'growth', 'scaling', 'expansion', 'growing', 'increase capacity', 'new facilities', 'larger space']
      },
      {
        type: 'PARTNERSHIP' as const,
        patterns: [
          /partner(?:ship|ed)? with/i,
          /collaborat(?:ion|ing|ed) with/i,
          /team(?:ed|ing) up with/i,
          /joined? forces with/i,
          /strategic (?:partnership|alliance|collaboration)/i,
          /signed? (?:partnership|agreement|deal) with/i,
          /allied? with/i
        ],
        keywords: ['partner', 'partnership', 'collaboration', 'alliance', 'strategic', 'teaming up', 'joined forces', 'agreement with']
      },
      {
        type: 'FUNDING' as const,
        patterns: [
          /raised? (?:funding|capital|investment)/i,
          /secured? (?:funding|investment)/i,
          /funding round/i,
          /invested? in/i,
          /venture capital/i,
          /series (?:a|b|c|d)/i,
          /seed funding/i,
          /angel investment/i,
          /received? funding/i,
          /closed? (?:funding|investment) round/i
        ],
        keywords: ['funding', 'raised', 'investment', 'venture capital', 'vc', 'series', 'seed', 'angel', 'backed', 'financing']
      },
      {
        type: 'ACQUISITION' as const,
        patterns: [
          /acquired?|acquisition/i,
          /bought?|purchased?/i,
          /took over/i,
          /merged? with/i,
          /takeover/i,
          /buyout/i
        ],
        keywords: ['acquired', 'acquisition', 'bought', 'purchased', 'takeover', 'merged', 'buyout']
      },
      {
        type: 'MERGER' as const,
        patterns: [
          /merged? with/i,
          /merger (?:with|between)/i,
          /combining (?:with|forces)/i,
          /joining (?:with|together)/i,
          /united? with/i
        ],
        keywords: ['merger', 'merged', 'combining', 'joining', 'uniting', 'consolidation']
      },
      {
        type: 'REBRANDING' as const,
        patterns: [
          /rebrand(?:ed|ing)/i,
          /new name/i,
          /name change/i,
          /renamed/i,
          /updated? (?:brand|logo|identity)/i,
          /brand refresh/i,
          /logo redesign/i
        ],
        keywords: ['rebrand', 'new name', 'renamed', 'name change', 'brand refresh', 'logo change', 'identity update']
      },
      {
        type: 'LEADERSHIP_CHANGE' as const,
        patterns: [
          /new (?:ceo|cto|cfo|coo|executive)/i,
          /appointed? (?:new|as)/i,
          /hired? (?:new|as)/i,
          /promoted? to/i,
          /leadership change/i,
          /executive (?:appointment|change)/i,
          /board (?:member|appointment)/i,
          /management change/i
        ],
        keywords: ['ceo', 'cto', 'cfo', 'coo', 'appointed', 'hired', 'leadership', 'executive', 'board', 'management']
      },
      {
        type: 'AWARD' as const,
        patterns: [
          /won (?:award|prize)/i,
          /received? award/i,
          /recognized? as/i,
          /honored? with/i,
          /award(?:ed|-winning)/i,
          /top (?:company|employer|innovator)/i,
          /best (?:place|company) to work/i,
          /industry award/i
        ],
        keywords: ['award', 'prize', 'recognition', 'honored', 'won', 'best', 'top', 'excellence']
      },
      {
        type: 'CONTRACT_WIN' as const,
        patterns: [
          /won (?:contract|deal|project)/i,
          /secured? (?:contract|deal)/i,
          /awarded? (?:contract|project)/i,
          /signed? (?:contract|deal)/i,
          /new contract with/i,
          /major deal with/i,
          /government contract/i,
          /enterprise contract/i
        ],
        keywords: ['contract', 'deal', 'project win', 'secured contract', 'won deal', 'government contract', 'enterprise deal']
      }
    ];
    
    // Detect intents
    intentPatterns.forEach(pattern => {
      const hasPattern = pattern.patterns.some(p => p.test(text));
      const hasKeywords = pattern.keywords.some(keyword => lowerText.includes(keyword));
      
      if (hasPattern || hasKeywords) {
        let confidence = 0.5; // Base confidence
        
        // Increase confidence for pattern matches
        if (hasPattern) confidence += 0.3;
        if (hasKeywords) confidence += 0.2;
        
        // Increase confidence if multiple keywords found
        const foundKeywords = pattern.keywords.filter(k => lowerText.includes(k));
        if (foundKeywords.length > 1) confidence += 0.1;
        
        intents.push({
          type: pattern.type,
          confidence: Math.min(confidence, 1.0),
          keywords: foundKeywords
        });
      }
    });
    
    return intents;
  }

  /**
   * Generate query terms for specific business intent
   */
  private static getIntentQueryTerms(intent: BusinessIntent): string[] {
    const termsMap: Record<BusinessIntent['type'], string[]> = {
      NEW_PRODUCT: [
        'launched', 'announced', 'introduced', 'released', 'unveiled',
        'new product', 'new service', 'new feature', 'product launch',
        'service launch', 'software release', 'app launch', 'platform launch',
        'beta launch', 'alpha release', 'version update', 'upgrade'
      ],
      NEW_OFFICE: [
        'opened', 'new office', 'new location', 'new branch', 'new headquarters',
        'expanded to', 'entered', 'geographic expansion', 'global expansion',
        'office opening', 'facility opening', 'headquarters relocation',
        'moved to', 'relocated to', 'established presence in', 'new market entry'
      ],
      HIRING: [
        'hiring', 'recruiting', 'hiring spree', 'job openings', 'positions available',
        'expanding team', 'growing team', 'talent acquisition', 'hiring employees',
        'staff expansion', 'workforce growth', 'career opportunities', 'open roles',
        'looking for', 'seeking', 'recruitment drive', 'hiring campaign'
      ],
      EXPANSION: [
        'expanding', 'expansion', 'growing', 'scaling', 'scale up',
        'business growth', 'market expansion', 'operational expansion',
        'increased capacity', 'new facilities', 'larger space', 'expanded operations',
        'growth strategy', 'expansion plans', 'scale operations', 'business scaling'
      ],
      PARTNERSHIP: [
        'partnership', 'partnered with', 'collaboration', 'collaborated with',
        'strategic partnership', 'strategic alliance', 'teaming up with',
        'joined forces with', 'alliance with', 'agreement with', 'signed deal with',
        'cooperation with', 'joint venture', 'partnership announcement'
      ],
      FUNDING: [
        'funding', 'raised', 'investment', 'venture capital', 'VC funding',
        'capital raised', 'secured funding', 'investment round', 'funding round',
        'series funding', 'seed funding', 'angel investment', 'backed by',
        'financing', 'closed round', 'capital infusion', 'investment secured'
      ],
      ACQUISITION: [
        'acquired', 'acquisition', 'bought', 'purchased', 'takeover',
        'company acquisition', 'business acquisition', 'acquired company',
        'merger and acquisition', 'M&A', 'corporate acquisition', 'strategic acquisition'
      ],
      MERGER: [
        'merger', 'merged with', 'merging', 'combining with', 'joining with',
        'united with', 'merger agreement', 'corporate merger', 'business combination',
        'consolidation', 'merger announcement', 'strategic merger'
      ],
      REBRANDING: [
        'rebrand', 'rebranding', 'new name', 'name change', 'renamed',
        'brand refresh', 'logo redesign', 'brand identity update', 'corporate rebrand',
        'brand transformation', 'name rebranding', 'brand evolution', 'visual identity update'
      ],
      LEADERSHIP_CHANGE: [
        'new ceo', 'new cto', 'new cfo', 'new coo', 'appointed',
        'leadership change', 'executive appointment', 'new executive',
        'management change', 'board appointment', 'hired as', 'promoted to',
        'leadership team', 'executive team', 'management shakeup'
      ],
      AWARD: [
        'award', 'prize', 'recognition', 'honored', 'won award',
        'award-winning', 'industry award', 'best place to work', 'top company',
        'excellence award', 'innovation award', 'recognition award', 'accolade',
        'achievement award', 'distinction'
      ],
      CONTRACT_WIN: [
        'contract win', 'won contract', 'secured contract', 'deal win',
        'project award', 'government contract', 'enterprise contract',
        'major deal', 'signed contract', 'contract awarded', 'deal secured',
        'project secured', 'contract announcement', 'deal announcement'
      ]
    };
    
    return termsMap[intent.type] || [];
  }

  /**
   * Main query formatter with intent detection
   */
  static async formatQuery(
    plainText: string,
    config: QueryConfig = {}
  ): Promise<string> {
    const {
      field = 'description',
      operator = 'OR',
      useWildcards = false
    } = config;

    console.log('🔍 Analyzing query:', plainText);

    // Detect business intents
    const intents = this.detectBusinessIntent(plainText);
    console.log('🎯 Detected intents:', intents);

    // Check if it's a structured query
    if (this.isStructuredQuery(plainText) && intents.length === 0) {
      console.log('📋 Detected structured query');
      return this.formatStructuredQuery(plainText);
    }

    // For queries with detected intents, use intent-based formatting
    if (intents.length > 0) {
      return this.formatIntentBasedQuery(plainText, intents, config);
    }

    // For natural language queries without clear intent
    return this.formatNaturalLanguageQuery(plainText, config);
  }

  /**
   * Format query based on detected business intents
   */
  private static formatIntentBasedQuery(
    text: string,
    intents: BusinessIntent[],
    config: QueryConfig
  ): string {
    console.log('🎯 Formatting intent-based query');
    
    // Extract location and industry terms
    const locations = this.extractLocations(text);
    const industries = this.extractIndustries(text);
    
    // Get intent-specific terms
    const intentTerms: string[] = [];
    intents.forEach(intent => {
      const terms = this.getIntentQueryTerms(intent);
      intentTerms.push(...terms);
    });
    
    // Combine all unique terms
    const allIntentTerms = [...new Set(intentTerms)];
    
    const parts: string[] = [];
    
    // Add location terms
    if (locations.length > 0) {
      const locationQuery = locations.map(loc => `"${loc}"`).join(' OR ');
      parts.push(`(${locationQuery})`);
    }
    
    // Add industry terms
    if (industries.length > 0) {
      const industryQuery = industries.map(ind => `"${ind}"`).join(' OR ');
      parts.push(`(${industryQuery})`);
    }
    
    // Add intent terms
    if (allIntentTerms.length > 0) {
      const intentQuery = allIntentTerms.map(term => `"${term}"`).join(' OR ');
      parts.push(`(${intentQuery})`);
    }
    
    // If we only have intent terms, return them
    if (parts.length === 0 && allIntentTerms.length > 0) {
      return `(${allIntentTerms.slice(0, 10).map(term => `"${term}"`).join(' OR ')})`;
    }
    
    // Combine parts
    if (parts.length === 1) {
      return parts[0];
    }
    
    // If we have location/industry AND intent, use AND
    if ((locations.length > 0 || industries.length > 0) && allIntentTerms.length > 0) {
      const locIndPart = locations.length > 0 && industries.length > 0 
        ? `${parts[0]} AND ${parts[1]}`
        : parts[0];
      
      return `${locIndPart} AND ${parts[parts.length - 1]}`;
    }
    
    // Otherwise use OR
    return parts.join(' OR ');
  }

  /**
   * Check if query contains field specifications
   */
  private static isStructuredQuery(text: string): boolean {
    const structuredPatterns = [
      /[a-zA-Z_]+:/,
      /employeeRange:/i,
      /employeeCount:/i,
      /employee_count:/i,
      /industries:/i,
      /geographies:/i,
      /stage:/i,
      /funding:/i,
      /revenue:/i,
      /\[.*TO.*\]/
    ];
    
    return structuredPatterns.some(pattern => pattern.test(text)) && 
           !text.toLowerCase().includes('companies') && 
           !text.toLowerCase().includes('businesses');
  }

  /**
   * Format structured queries with field specifications
   */
  private static formatStructuredQuery(query: string): string {
    let formatted = query
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/"/g, '"');
    
    formatted = this.expandFieldValues(formatted);
    formatted = this.normalizeFieldNames(formatted);
    formatted = this.fixQuerySyntax(formatted);
    formatted = this.addDefaultFields(formatted);
    
    return formatted;
  }

  /**
   * Expand common field values to include variations
   */
  private static expandFieldValues(query: string): string {
    let result = query;
    
    // Industry expansions
    const industryExpansions: { [key: string]: string } = {
      '"Software"': '("Software" OR "software" OR "technology" OR "tech")',
      '"AI"': '("AI" OR "artificial intelligence" OR "machine learning")',
      '"Fintech"': '("Fintech" OR "financial technology" OR "financial services")',
      '"E-commerce"': '("E-commerce" OR "ecommerce" OR "online retail")',
      '"Healthcare"': '("Healthcare" OR "health tech" OR "medical")',
      '"Cybersecurity"': '("Cybersecurity" OR "security" OR "infosec")',
      '"Edtech"': '("Edtech" OR "education technology" OR "e-learning")',
      '"Logistics"': '("Logistics" OR "supply chain" OR "transportation")',
      '"Manufacturing"': '("Manufacturing" OR "production" OR "industrial")'
    };
    
    Object.entries(industryExpansions).forEach(([original, expanded]) => {
      const pattern = new RegExp(`industries:${original}`, 'gi');
      result = result.replace(pattern, `industries:${expanded}`);
    });
    
    // Geography expansions
    const geographyExpansions: { [key: string]: string } = {
      '"KSA"': '("Saudi Arabia" OR "KSA")',
      '"UAE"': '("United Arab Emirates" OR "UAE" OR "Dubai")',
      '"Dubai"': '("Dubai" OR "UAE")',
      '"GCC"': '("Saudi Arabia" OR "UAE" OR "Qatar" OR "Kuwait" OR "Bahrain" OR "Oman")',
      '"USA"': '("United States" OR "USA" OR "US")',
      '"UK"': '("United Kingdom" OR "UK")'
    };
    
    Object.entries(geographyExpansions).forEach(([original, expanded]) => {
      const pattern = new RegExp(`geographies:${original}`, 'gi');
      result = result.replace(pattern, `geographies:${expanded}`);
    });
    
    // Employee range expansions
    const employeeRangeExpansions: { [key: string]: string } = {
      '"1-50"': '[1 TO 50]',
      '"51-200"': '[51 TO 200]',
      '"201-500"': '[201 TO 500]',
      '"501-1000"': '[501 TO 1000]',
      '"1000+"': '[1000 TO *]'
    };
    
    Object.entries(employeeRangeExpansions).forEach(([original, expanded]) => {
      const pattern = new RegExp(`employeeRange:${original}`, 'gi');
      result = result.replace(pattern, `employee_count:${expanded}`);
    });
    
    return result;
  }

  /**
   * Normalize field names to CoreSignal schema
   */
  private static normalizeFieldNames(query: string): string {
    let result = query;
    
    const fieldMappings: { [key: string]: string } = {
      'employeeRange': 'employee_count',
      'employeeCount': 'employee_count',
      'headcount': 'employee_count',
      'employees': 'employee_count',
      'industry': 'industries',
      'sector': 'industries',
      'geography': 'geographies',
      'location': 'geographies',
      'country': 'geographies',
      'fundingStage': 'stage',
      'investmentStage': 'stage',
      'revenueRange': 'revenue'
    };
    
    for (const [oldField, newField] of Object.entries(fieldMappings)) {
      const pattern = new RegExp(`\\b${oldField}:`, 'gi');
      result = result.replace(pattern, `${newField}:`);
    }
    
    return result;
  }

  /**
   * Fix query syntax issues
   */
  private static fixQuerySyntax(query: string): string {
    let result = query;
    
    // Ensure parentheses balance
    const openCount = (result.match(/\(/g) || []).length;
    const closeCount = (result.match(/\)/g) || []).length;
    
    if (openCount !== closeCount) {
      const diff = openCount - closeCount;
      if (diff > 0) {
        result += ')'.repeat(diff);
      } else {
        result = '(' + result + ')'.repeat(-diff);
      }
    }
    
    // Ensure AND/OR are uppercase
    result = result.replace(/\b(and|or)\b/gi, match => match.toUpperCase());
    
    // Fix range syntax
    result = result.replace(/employee_count:"(\d+)\+"/g, 'employee_count:[$1 TO *]');
    result = result.replace(/employee_count:"(\d+)-(\d+)"/g, 'employee_count:[$1 TO $2]');
    
    return result.trim();
  }

  /**
   * Add default field for unqualified terms
   */
  private static addDefaultFields(query: string): string {
    const result = query;
    
    const fieldPattern = /[a-zA-Z_]+:(?:\([^)]+\)|"[^"]+"|[^ ()]+)/g;
    const fieldQueries = [...result.matchAll(fieldPattern)].map(m => m[0]);
    
    let remaining = result;
    fieldQueries.forEach(fq => {
      remaining = remaining.replace(fq, '');
    });
    
    remaining = remaining
      .replace(/\(\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\s*(AND|OR)\s*|\s*(AND|OR)\s*$/g, '')
      .trim();
    
    if (remaining && remaining.length > 2) {
      const terms = remaining.split(/\s+(?:AND|OR)\s+/).filter(term => term.length > 2);
      
      if (terms.length > 0) {
        const descriptionQuery = terms.map(term => {
          if (term.includes(' ') || term.includes('-')) {
            return `"${term}"`;
          }
          return term;
        }).join(' OR ');
        
        return `${result} AND (${descriptionQuery})`;
      }
    }
    
    return result;
  }

  /**
   * Format natural language queries using LLM
   */
  private static async formatNaturalLanguageQuery(
    plainText: string,
    config: QueryConfig
  ): Promise<string> {
    const systemPrompt = `You are an expert at converting natural language queries into CoreSignal Elasticsearch query_string syntax.

DETECT BUSINESS INTENTS:
1. NEW PRODUCT/SERVICE: launch, announce, release, introduce, unveil, new product, new service
2. NEW OFFICE/LOCATION: opened, new office, new location, expanded to, entered market
3. HIRING/RECRUITING: hiring, recruiting, job openings, expanding team, talent acquisition
4. EXPANSION/SCALING: expanding, scaling, business growth, market expansion, operational expansion
5. PARTNERSHIPS/ALLIANCES: partnership, collaboration, teamed up, strategic alliance
6. FUNDING/INVESTMENT: funding, raised, investment, venture capital, series funding
7. ACQUISITIONS/MERGERS: acquired, acquisition, merger, combined with
8. REBRANDING: rebrand, new name, name change, brand refresh
9. LEADERSHIP CHANGES: new ceo, appointed, leadership change, executive appointment
10. AWARDS/RECOGNITION: award, prize, recognition, honored, award-winning
11. CONTRACT WINS: contract win, won deal, secured contract, project award

QUERY FORMATTING RULES:
1. For intents: Use specific action verbs and nouns related to the business event
2. Combine with: location terms (geographies) AND industry terms (industries)
3. Syntax: ("term1" OR "term2" OR "term3") AND geographies:("Location") AND industries:("Industry")
4. For ambiguous queries: Use broader search terms
5. Remove noise words: companies, businesses, that, with, have

EXAMPLES:

Input: "companies launching new AI products"
Output: ("launched" OR "announced" OR "released" OR "introduced" OR "new product" OR "new AI") AND industries:("AI" OR "artificial intelligence")

Input: "Saudi companies opening new offices"
Output: ("opened" OR "new office" OR "new location" OR "expanded to") AND geographies:("Saudi Arabia" OR "KSA")

Input: "tech companies hiring in Dubai"
Output: ("hiring" OR "recruiting" OR "job openings" OR "expanding team") AND geographies:("Dubai" OR "UAE") AND industries:("technology" OR "tech")

Input: "fintech startups that raised Series A"
Output: ("funding" OR "raised" OR "investment" OR "Series A") AND industries:("fintech" OR "financial technology")

Input: "manufacturing companies expanding operations"
Output: ("expanding" OR "expansion" OR "scaling" OR "growing operations") AND industries:("manufacturing" OR "production")

Input: "companies that won major contracts"
Output: ("contract win" OR "won contract" OR "secured deal" OR "project award" OR "deal win")

Input: "companies with new leadership appointments"
Output: ("new ceo" OR "appointed" OR "leadership change" OR "executive appointment" OR "new executive")

RETURN: Only the query string, no explanations.`;

    const prompt = `Convert this natural language query into a CoreSignal Elasticsearch query_string:

"${plainText}"

Follow these steps:
1. Detect the business intent(s)
2. Generate appropriate search terms for the intent
3. Add location/industry filters if mentioned
4. Format in proper query_string syntax

Query string:`;

    try {
      const llmResponse = await ollamaService.generate(prompt, systemPrompt);
      const queryString = this.extractQueryString(llmResponse);
      
      if (this.isValidQueryString(queryString)) {
        console.log(`✓ LLM Generated Query: ${queryString}`);
        return queryString;
      } else {
        console.warn('LLM query invalid, using intent-based fallback');
        const intents = this.detectBusinessIntent(plainText);
        return this.formatIntentBasedQuery(plainText, intents, config);
      }
    } catch (error) {
      console.error('LLM query generation failed:', error);
      const intents = this.detectBusinessIntent(plainText);
      return this.formatIntentBasedQuery(plainText, intents, config);
    }
  }

  /**
   * Extract locations from text
   */
  private static extractLocations(text: string): string[] {
    const locations: string[] = [];
    const lowerText = text.toLowerCase();
    
    const locationMap: { [key: string]: string[] } = {
      'ksa': ['Saudi Arabia'],
      'saudi arabia': ['Saudi Arabia'],
      'saudi': ['Saudi Arabia'],
      'uae': ['United Arab Emirates'],
      'dubai': ['Dubai', 'United Arab Emirates'],
      'abu dhabi': ['Abu Dhabi', 'United Arab Emirates'],
      'gcc': ['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman'],
      'middle east': ['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Egypt'],
      'usa': ['United States'],
      'us': ['United States'],
      'america': ['United States'],
      'uk': ['United Kingdom'],
      'britain': ['United Kingdom'],
      'london': ['London', 'United Kingdom'],
      'singapore': ['Singapore'],
      'india': ['India'],
      'china': ['China'],
      'canada': ['Canada'],
      'australia': ['Australia'],
      'germany': ['Germany'],
      'france': ['France'],
      'japan': ['Japan'],
      'south korea': ['South Korea']
    };
    
    for (const [key, values] of Object.entries(locationMap)) {
      if (lowerText.includes(key)) {
        locations.push(...values);
      }
    }
    
    return [...new Set(locations)];
  }

  /**
   * Extract industries from text
   */
  private static extractIndustries(text: string): string[] {
    const industries: string[] = [];
    const lowerText = text.toLowerCase();
    
    const industryMap: { [key: string]: string[] } = {
      'saas': ['SaaS', 'software as a service'],
      'software': ['software', 'technology'],
      'fintech': ['fintech', 'financial technology'],
      'ecommerce': ['e-commerce', 'online retail'],
      'healthcare': ['healthcare', 'health tech'],
      'manufacturing': ['manufacturing', 'production'],
      'ai': ['AI', 'artificial intelligence'],
      'blockchain': ['blockchain', 'crypto'],
      'cybersecurity': ['cybersecurity', 'security'],
      'edtech': ['edtech', 'education technology'],
      'logistics': ['logistics', 'supply chain'],
      'retail': ['retail', 'commerce'],
      'real estate': ['real estate', 'property'],
      'energy': ['energy', 'renewable energy'],
      'telecom': ['telecommunications', 'telecom'],
      'media': ['media', 'entertainment'],
      'travel': ['travel', 'tourism'],
      'automotive': ['automotive', 'auto'],
      'biotech': ['biotech', 'biotechnology'],
      'pharma': ['pharmaceutical', 'pharma'],
      'agriculture': ['agriculture', 'agtech']
    };
    
    for (const [key, values] of Object.entries(industryMap)) {
      if (lowerText.includes(key)) {
        industries.push(...values);
      }
    }
    
    return [...new Set(industries)];
  }

  /**
   * Extract query string from LLM response
   */
  private static extractQueryString(response: string): string {
    let clean = response
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`/g, '')
      .trim();
    
    const lines = clean.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && (trimmed.includes('(') || trimmed.includes(':') || trimmed.includes('"') || trimmed.includes('['))) {
        return trimmed
          .replace(/^(query string:|query:|output:|result:)\s*/i, '')
          .trim();
      }
    }
    
    return clean;
  }

  /**
   * Validate query string
   */
  private static isValidQueryString(query: string): boolean {
    if (!query || query.trim().length === 0) return false;
    if (query === '()' || query === '() AND ()' || query === '() OR ()') return false;
    if (!/[a-zA-Z]/.test(query)) return false;
    if (query.length < 5 || query.length > 800) return false;
    
    const openCount = (query.match(/\(/g) || []).length;
    const closeCount = (query.match(/\)/g) || []).length;
    if (openCount !== closeCount) return false;
    
    return true;
  }

  /**
   * Build complete CoreSignal request body
   */
  static async buildRequestBody(
    plainText: string,
    options: {
      defaultField?: string;
      defaultOperator?: 'and' | 'or';
      itemsPerPage?: number;
    } = {}
  ): Promise<CoreSignalRequestBody> {
    const {
      defaultField = 'description',
      defaultOperator = 'or'
    } = options;

    const queryString = await this.formatQuery(plainText, {
      field: defaultField,
      operator: defaultOperator.toUpperCase() as 'AND' | 'OR'
    });

    console.log('🎯 Final Query:', queryString);

    return {
      query: {
        bool: {
          must: [
            {
              query_string: {
                query: queryString,
                default_field: defaultField,
                default_operator: defaultOperator
              }
            }
          ]
        }
      }
    };
  }

  /**
   * Test with various business intent queries
   */
  static async testBusinessIntents() {
    const testCases = [
      // New Product Intent
      'companies launching new AI products',
      'startups announcing new mobile apps',
      'SaaS companies releasing new features',
      'tech companies with new product launches',
      
      // New Office Intent
      'companies opening new offices in Dubai',
      'Saudi companies expanding to new locations',
      'US companies opening branches in Singapore',
      'tech companies with new headquarters',
      
      // Hiring Intent
      'companies hiring software engineers',
      'startups recruiting in Saudi Arabia',
      'companies with job openings in Dubai',
      'growing companies hiring sales teams',
      
      // Expansion Intent
      'manufacturing companies expanding operations',
      'retail companies scaling nationally',
      'companies expanding to GCC markets',
      'businesses growing internationally',
      
      // Partnership Intent
      'companies forming strategic partnerships',
      'tech companies collaborating with universities',
      'fintech partnerships announced',
      'companies teaming up with government',
      
      // Funding Intent
      'startups that raised Series A funding',
      'companies that secured venture capital',
      'recently funded AI startups',
      'companies that closed funding rounds',
      
      // Acquisition Intent
      'companies that made acquisitions',
      'tech companies acquiring startups',
      'recent mergers and acquisitions',
      'companies buying competitors',
      
      // Leadership Changes
      'companies with new CEO appointments',
      'startups hiring new executives',
      'companies with leadership changes',
      'new management teams',
      
      // Contract Wins
      'companies that won government contracts',
      'tech companies securing major deals',
      'companies winning large projects',
      'contract awards announced',
      
      // Awards & Recognition
      'award-winning companies',
      'companies recognized for innovation',
      'best places to work in tech',
      'top employers in Saudi Arabia',
      
      // Mixed/Complex
      'AI companies in UAE hiring engineers',
      'Fintech startups in KSA raising funding',
      'E-commerce companies expanding with new warehouses',
      'Healthcare companies launching new services in GCC'
    ];

    console.log('\n=== Business Intent Detection Tests ===\n');

    for (const testCase of testCases) {
      try {
        console.log(`\n📝 Input: "${testCase}"`);
        
        // Detect intents
        const intents = this.detectBusinessIntent(testCase);
        console.log(`🎯 Detected Intents:`, intents.map(i => `${i.type} (${(i.confidence*100).toFixed(0)}%)`));
        
        // Format query
        const query = await this.formatQuery(testCase);
        console.log(`✅ Formatted Query: ${query}`);
        
        console.log('---');
        
      } catch (error) {
        console.error(`❌ Error:`, error);
      }
    }
  }
}

// ==================== BACKWARD COMPATIBLE FUNCTIONS ====================

export async function formatPlainTextToCoresignalQuery(
  plainText: string,
  field: string = 'description',
  operator: 'and' | 'or' = 'or'
): Promise<string> {
  return CoreSignalQueryFormatter.formatQuery(plainText, {
    field,
    operator: operator.toUpperCase() as 'AND' | 'OR'
  });
}

export async function buildCoreSignalRequest(
  plainText: string,
  options: {
    field?: string;
    operator?: 'and' | 'or';
    itemsPerPage?: number;
  } = {}
): Promise<CoreSignalRequestBody> {
  return CoreSignalQueryFormatter.buildRequestBody(plainText, options);
}

// ==================== USAGE EXAMPLES ====================

/*
// Example 1: New product intent
const query1 = await formatPlainTextToCoresignalQuery('companies launching new AI products');
// Output: ("launched" OR "announced" OR "released" OR "introduced" OR "new product") AND industries:("AI" OR "artificial intelligence")

// Example 2: Hiring intent with location
const query2 = await formatPlainTextToCoresignalQuery('tech companies hiring in Dubai');
// Output: ("hiring" OR "recruiting" OR "job openings") AND geographies:("Dubai" OR "UAE") AND industries:("technology" OR "tech")

// Example 3: Funding intent with industry
const query3 = await formatPlainTextToCoresignalQuery('fintech startups that raised Series A');
// Output: ("funding" OR "raised" OR "investment" OR "Series A") AND industries:("fintech" OR "financial technology")

// Example 4: Expansion intent
const query4 = await formatPlainTextToCoresignalQuery('manufacturing companies expanding operations');
// Output: ("expanding" OR "expansion" OR "scaling" OR "growing operations") AND industries:("manufacturing" OR "production")

// Example 5: Complex mixed query
const query5 = await formatPlainTextToCoresignalQuery('AI companies in UAE hiring engineers after raising funding');
// Output: geographies:("UAE") AND industries:("AI" OR "artificial intelligence") AND ("hiring" OR "recruiting" OR "engineers") AND ("funding" OR "raised" OR "investment")

// Run tests
await CoreSignalQueryFormatter.testBusinessIntents();
*/