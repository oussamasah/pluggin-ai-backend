interface ICPConfig {
    industries: string[];
    geographies: string[];
    employeeRange: string;
    excludedIndustries: string[]; // Added excluded industries
  }
  
  interface IntentResult {
    intent: string;
    confidence: 'very-high' | 'high' | 'medium' | 'low';
    signals: string[];
    entities: {
      timeframe?: string;
      locations?: string[];
      actions?: string[];
      subjects?: string[];
    };
  }
  
  interface QueryOptimizationResult {
    optimizedQuery: string;
    confidence: 'very-high' | 'high' | 'medium' | 'low';
    detectedIntent: string;
    signalsFound: string[];
    explanation: string;
  }
  
  class HighConfidenceIntentDetector {
    private readonly intentPatterns: Map<string, { patterns: RegExp[]; weight: number; exclusive?: boolean }>;
  
    constructor() {
      this.intentPatterns = this.initializeIntentPatterns();
    }
  
    private initializeIntentPatterns(): Map<string, { patterns: RegExp[]; weight: number; exclusive?: boolean }> {
      return new Map([
        ['funding', {
          patterns: [
            /\b(series\s+[a-d]|series\s+[a-d]\s+funding)\b/i,
            /\b(seed\s+round|seed\s+funding)\b/i,
            /\braised\s+\$?[0-9]+[mbk]?\s+(in|from)\s+(funding|investment)\b/i,
            /\bclosed\s+\$?[0-9]+[mbk]?\s+funding\s+round\b/i,
            /\bventure\s+capital\s+funding\b/i,
            /\bvc\-backed\b/i
          ],
          weight: 10,
          exclusive: true
        }],
        ['expansion', {
          patterns: [
            /\bopened\s+(a\s+)?new\s+(office|location|headquarters)\b/i,
            /\bnew\s+(office|location)\s+in\s+[a-z\s,]+\b/i,
            /\bexpanding\s+to\s+[a-z\s,]+\b/i,
            /\bentered\s+the\s+[a-z]+\s+market\b/i,
            /\bglobal\s+expansion\b/i,
            /\binternational\s+expansion\b/i
          ],
          weight: 9,
          exclusive: true
        }],
        ['hiring', {
          patterns: [
            /\bhiring\s+\d+\s+new\s+(employees|staff|team\s+members)\b/i,
            /\bexpanding\s+team\s+by\s+\d+\b/i,
            /\bmass\s+hiring\b/i,
            /\bhiring\s+spree\b/i,
            /\bjob\s+openings\s+for\s+[a-z\s]+\b/i,
            /\bcareer\s+fair\b/i
          ],
          weight: 8
        }],
        ['partnership', {
          patterns: [
            /\bpartnered\s+with\s+[a-z]+\b/i,
            /\bstrategic\s+partnership\s+with\b/i,
            /\bannounced\s+partnership\b/i,
            /\bcollaboration\s+with\b/i,
            /\bteamed\s+up\s+with\b/i
          ],
          weight: 8
        }],
        ['acquisition', {
          patterns: [
            /\bacquired\s+by\s+[a-z]+\b/i,
            /\bacquired\s+[a-z]+\b/i,
            /\bmerger\s+with\b/i,
            /\bwas\s+acquired\b/i,
            /\bbought\s+by\b/i
          ],
          weight: 9,
          exclusive: true
        }],
        ['product_launch', {
          patterns: [
            /\blaunched\s+new\s+product\b/i,
            /\bnew\s+product\s+launch\b/i,
            /\bintroduced\s+[a-z]+\s+product\b/i,
            /\bproduct\s+release\b/i,
            /\bannounced\s+[a-z]+\s+product\b/i
          ],
          weight: 8
        }],
        ['leadership_change', {
          patterns: [
            /\bnew\s+ceo\b/i,
            /\bappointed\s+new\s+(ceo|cto|cmo|cfo)\b/i,
            /\bnew\s+executive\s+appointment\b/i,
            /\bleadership\s+change\b/i,
            /\bpromoted\s+[a-z]+\s+to\s+[a-z]+\b/i
          ],
          weight: 7
        }],
        ['award', {
          patterns: [
            /\bwon\s+[a-z]+\s+award\b/i,
            /\breceived\s+[a-z]+\s+award\b/i,
            /\bawarded\s+[a-z]+\s+prize\b/i,
            /\brecognized\s+as\s+[a-z]+\b/i
          ],
          weight: 6
        }]
      ]);
    }
  
    public detectIntent(userQuery: string): IntentResult {
      const query = userQuery.toLowerCase().trim();
      const signals: string[] = [];
      const entities = this.extractEntities(query);
      const intentScores = new Map<string, number>();
  
      // Score each intent pattern
      for (const [intent, config] of this.intentPatterns) {
        let intentScore = 0;
        
        for (const pattern of config.patterns) {
          if (pattern.test(query)) {
            intentScore += config.weight;
            signals.push(`${intent}_match`);
            
            // If exclusive pattern matches, return immediately with high confidence
            if (config.exclusive && intentScore >= config.weight) {
              return {
                intent,
                confidence: 'very-high',
                signals,
                entities
              };
            }
          }
        }
        
        if (intentScore > 0) {
          intentScores.set(intent, intentScore);
        }
      }
  
      // Find the highest scoring intent
      if (intentScores.size > 0) {
        const [topIntent, topScore] = Array.from(intentScores.entries())
          .reduce((a, b) => a[1] > b[1] ? a : b);
  
        const confidence = this.calculateConfidence(topScore, intentScores.size);
        
        return {
          intent: topIntent,
          confidence,
          signals,
          entities
        };
      }
  
      // Fallback to general search with contextual analysis
      return {
        intent: 'general_search',
        confidence: 'low',
        signals: ['no_specific_intent_detected'],
        entities
      };
    }
  
    private extractEntities(query: string): IntentResult['entities'] {
      const entities: IntentResult['entities'] = {
        timeframe: this.extractTimeframe(query),
        locations: this.extractLocations(query),
        actions: this.extractActions(query),
        subjects: this.extractSubjects(query)
      };
  
      return entities;
    }
  
    private extractTimeframe(query: string): string | undefined {
      const timeframePatterns = [
        { pattern: /\b(recently|latest|current)\b/i, value: 'recently' },
        { pattern: /\b(this\s+year|2024|current\s+year)\b/i, value: 'this year' },
        { pattern: /\b(last\s+month|past\s+month)\b/i, value: 'in the past month' },
        { pattern: /\b(last\s+quarter|past\s+quarter)\b/i, value: 'in the past quarter' },
        { pattern: /\b(last\s+year|past\s+year|2023)\b/i, value: 'in the past year' },
        { pattern: /\b(upcoming|future|planned|will|soon)\b/i, value: 'planning to' }
      ];
  
      for (const { pattern, value } of timeframePatterns) {
        if (pattern.test(query)) {
          return value;
        }
      }
  
      return undefined;
    }
  
    private extractLocations(query: string): string[] {
      const locations: string[] = [];
      const locationPatterns = [
        /\b(in|at|from)\s+([a-z]+(?:\s+[a-z]+)*)/gi,
        /\b(based\s+in|located\s+in|headquartered\s+in)\s+([a-z]+(?:\s+[a-z]+)*)/gi
      ];
  
      for (const pattern of locationPatterns) {
        const matches = query.matchAll(pattern);
        for (const match of matches) {
          if (match[2] && !['the', 'a', 'an', 'this', 'that'].includes(match[2].toLowerCase())) {
            locations.push(match[2]);
          }
        }
      }
  
      return locations;
    }
  
    private extractActions(query: string): string[] {
      const actions: string[] = [];
      const actionVerbs = ['raised', 'opened', 'hiring', 'launched', 'acquired', 'partnered', 'won', 'appointed'];
      
      actionVerbs.forEach(verb => {
        if (query.includes(verb)) {
          actions.push(verb);
        }
      });
  
      return actions;
    }
  
    private extractSubjects(query: string): string[] {
      const subjects: string[] = [];
      const subjectPatterns = [
        /\b(office|location|headquarters|team|product|partnership|funding|investment|award)\b/gi
      ];
  
      for (const pattern of subjectPatterns) {
        const matches = query.match(pattern);
        if (matches) {
          subjects.push(...matches);
        }
      }
  
      return subjects;
    }
  
    private calculateConfidence(topScore: number, uniqueIntents: number): IntentResult['confidence'] {
      if (topScore >= 9) return 'very-high';
      if (topScore >= 7) return 'high';
      if (topScore >= 5) return 'medium';
      return 'low';
    }
  }
  
  class ExaQueryOptimizer {
    private intentDetector: HighConfidenceIntentDetector;
  
    constructor() {
      this.intentDetector = new HighConfidenceIntentDetector();
    }
  
    public generateOptimizedQuery(icpConfig: ICPConfig, userQuery: string): QueryOptimizationResult {
      // Detect intent with high confidence
      const intentResult = this.intentDetector.detectIntent(userQuery);
      
      // Build optimized query components
      const queryComponents: string[] = [];
      const explanationParts: string[] = [];
  
      // 1. Geographic context (from ICP)
      const geographicContext = this.buildGeographicContext(icpConfig, intentResult);
      if (geographicContext) {
        queryComponents.push(geographicContext);
        explanationParts.push(`Geography: ${icpConfig.geographies.join(', ')}`);
      }
  
      // 2. Industry context (from ICP) - now with exclusion support
      const industryContext = this.buildIndustryContext(icpConfig);
      if (industryContext) {
        queryComponents.push(industryContext);
        explanationParts.push(`Industry: ${icpConfig.industries.join(', ')}`);
      }
  
      // 3. Size context (from ICP)
      const sizeContext = this.buildSizeContext(icpConfig);
      if (sizeContext) {
        queryComponents.push(sizeContext);
        explanationParts.push(`Size: ${icpConfig.employeeRange}`);
      }
  
      // 4. Industry exclusion context (from ICP)
      const exclusionContext = this.buildExclusionContext(icpConfig);
      if (exclusionContext) {
        queryComponents.push(exclusionContext);
        explanationParts.push(`Excluded: ${icpConfig.excludedIndustries.join(', ')}`);
      }
  
      // 5. Intent-specific content (from user query analysis)
      const intentQuery = this.buildIntentSpecificQuery(intentResult, userQuery);
      queryComponents.push(intentQuery);
      explanationParts.push(`Intent: ${intentResult.intent} (${intentResult.confidence} confidence)`);
  
      // 6. Timeframe context (from user query)
      if (intentResult.entities.timeframe) {
        queryComponents.push(intentResult.entities.timeframe);
        explanationParts.push(`Timeframe: ${intentResult.entities.timeframe}`);
      }
  
      const optimizedQuery = queryComponents.join(' ').trim().replace(/\s+/g, ' ');
  
      return {
        optimizedQuery,
        confidence: intentResult.confidence,
        detectedIntent: intentResult.intent,
        signalsFound: intentResult.signals,
        explanation: explanationParts.join(' | ')
      };
    }
  
    private buildGeographicContext(icpConfig: ICPConfig, intentResult: IntentResult): string {
      if (icpConfig.geographies.length === 0) return '';
  
      // Use detected locations if they match ICP, otherwise use ICP locations
      const effectiveLocations = intentResult.entities.locations && intentResult.entities.locations.length > 0
        ? intentResult.entities.locations.filter(loc => 
            icpConfig.geographies.some(geo => 
              geo.toLowerCase().includes(loc.toLowerCase()) || 
              loc.toLowerCase().includes(geo.toLowerCase())
            )
          )
        : [];
  
      const locationsToUse = effectiveLocations.length > 0 ? effectiveLocations : icpConfig.geographies;
  
      if (locationsToUse.length === 1) {
        return `in ${locationsToUse[0]}`;
      } else {
        return `in ${locationsToUse.join(' or ')}`;
      }
    }
  
    private buildIndustryContext(icpConfig: ICPConfig): string {
      if (icpConfig.industries.length === 0) return '';
  
      if (icpConfig.industries.length === 1) {
        return `${icpConfig.industries[0]} companies`;
      } else {
        return `${icpConfig.industries.join(' or ')} companies`;
      }
    }
  
    private buildSizeContext(icpConfig: ICPConfig): string {
      return icpConfig.employeeRange ? `with ${icpConfig.employeeRange} employees` : '';
    }
  
    private buildExclusionContext(icpConfig: ICPConfig): string {
      if (!icpConfig.excludedIndustries || icpConfig.excludedIndustries.length === 0) return '';
  
      // Build exclusion clauses for Exa.ai query
      const exclusionClauses = icpConfig.excludedIndustries.map(industry => 
        `-${industry.toLowerCase()}`
      );
  
      return exclusionClauses.join(' ');
    }
  
    private buildIntentSpecificQuery(intentResult: IntentResult, originalQuery: string): string {
      const intentMap: { [key: string]: string } = {
        funding: 'that recently raised funding or received investment',
        expansion: 'that opened new offices or expanded operations',
        hiring: 'that are actively hiring or expanding teams',
        partnership: 'that announced new partnerships or collaborations',
        product_launch: 'that launched new products or services',
        acquisition: 'that were acquired or made acquisitions',
        leadership_change: 'with recent executive leadership changes',
        award: 'that recently received awards or recognition',
        general_search: originalQuery
      };
  
      return intentMap[intentResult.intent] || originalQuery;
    }
  }
  
  // Main export function
  export function generateExaQuery(icpConfig: ICPConfig, userQuery: string): QueryOptimizationResult {
    const optimizer = new ExaQueryOptimizer();
    return optimizer.generateOptimizedQuery(icpConfig, userQuery);
  }
  
  // Example usage with ICP config including excluded industries
  const icpConfig: ICPConfig = {
    industries: ["Software development", "Marketing agencies"],
    geographies: ["UAE", "Qatar"],
    employeeRange: "51-200 employees",
    excludedIndustries: ["Consulting", "Non-profit", "Government"]
  };
  
  // Test cases
  console.log('=== Optimized Query Examples with Industry Exclusion ===');
  /*
  const testQueries = [
    "companies that raised series A funding recently",
    "tech companies opened new office in Dubai last month",
    "software firms hiring 50 new developers",
    "marketing agencies partnered with Microsoft",
    "startups acquired by Google",
    "companies that launched new AI product",
    "business with new CEO appointment",
    "organizations that won innovation award",
    "find all companies in my ICP"
  ];
  
  testQueries.forEach(query => {
    const result = generateExaQuery(icpConfig, query);
    console.log(`\nQuery: "${query}"`);
    console.log(`Optimized: "${result.optimizedQuery}"`);
    console.log(`Confidence: ${result.confidence} | Intent: ${result.detectedIntent}`);
    console.log(`Signals: ${result.signalsFound.join(', ')}`);
    console.log(`Explanation: ${result.explanation}`);
  });*/