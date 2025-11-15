import { ollamaService } from './OllamaService';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ==================== ENHANCED INTERFACES ====================

interface ICPConfig {
  industries: string[];
  geographies: string[];
  employeeRange: string;
  acvRange?: string;
  excludedIndustries?: string[];
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
    fundingStages?: string[];
    companyTypes?: string[];
  };
}

interface QueryOptimizationResult {
  optimizedQuery: string;
  confidence: 'very-high' | 'high' | 'medium' | 'low';
  detectedIntent: string;
  signalsFound: string[];
  explanation: string;
  queryType: 'precise' | 'broad' | 'exploratory';
  suggestedFilters?: string[];
}

interface Evidence {
  source: string;
  url: string;
  date: string;
  summary: string;
  confidence: number;
  data_source?: string;
}

interface SignalResult {
  signal: string;
  evidence: Evidence[];
  found: boolean;
  reasoning: string;
}

interface IntentEnrichmentResponse {
  company: string;
  website: string;
  analysis_date: string;
  requested_signals: string[];
  results: SignalResult[];
  summary: {
    total_signals: number;
    signals_with_evidence: number;
    signals_without_evidence: number;
    confidence_score: number;
    data_sources_used: string[];
  };
}

// ==================== NEW ENHANCED INTERFACES ====================

interface SourceDetail {
  url: string;
  title: string;
  date: string;
  confidence: number;
  source_type: string;
  snippet?: string;
}

interface EnhancedSignalResult {
  signal: string;
  score: number;
  reason: string;
  sources?: SourceDetail[];
}

interface EnhancedIntentResponse {
  company_name: string;
  industry: string;
  evaluated_signals: EnhancedSignalResult[];
  final_intent_score: number;
  intent_level: string;
  overall_reasoning: string;
  metadata?: {
    total_sources: number;
    analysis_date: string;
    data_sources_used: string[];
  };
}

// ==================== ENHANCED INTENT RESPONSE BUILDER ====================

class EnhancedIntentResponseBuilder {
  /**
   * Transform intent detection results into enhanced response with sources
   */
  static buildEnhancedResponse(
    companyName: string,
    industry: string,
    intentResults: IntentEnrichmentResponse
  ): EnhancedIntentResponse {
    
    const enhancedSignals = intentResults.results.map(signalResult => {
      const score = this.calculateSignalScore(signalResult);
      const sources = this.extractSources(signalResult);
      
      return {
        signal: signalResult.signal,
        score: score,
        reason: this.generateReasoning(signalResult, score),
        sources: sources.length > 0 ? sources : undefined
      };
    });

    const finalIntentScore = this.calculateFinalIntentScore(enhancedSignals);
    const intentLevel = this.determineIntentLevel(finalIntentScore);

    return {
      company_name: companyName,
      industry: industry,
      evaluated_signals: enhancedSignals,
      final_intent_score: finalIntentScore,
      intent_level: intentLevel,
      overall_reasoning: this.generateOverallReasoning(enhancedSignals, intentLevel),
      metadata: {
        total_sources: enhancedSignals.reduce((sum, signal) => sum + (signal.sources?.length || 0), 0),
        analysis_date: intentResults.analysis_date,
        data_sources_used: intentResults.summary.data_sources_used
      }
    };
  }

  private static calculateSignalScore(signalResult: SignalResult): number {
    if (!signalResult.found || signalResult.evidence.length === 0) {
      return 0;
    }

    // Calculate score based on evidence confidence and recency
    const totalConfidence = signalResult.evidence.reduce((sum, evidence) => {
      const confidence = evidence.confidence || 0.5;
      const recencyBonus = this.calculateRecencyBonus(evidence.date);
      return sum + (confidence * (1 + recencyBonus));
    }, 0);

    const averageConfidence = totalConfidence / signalResult.evidence.length;
    return Math.min(Math.round(averageConfidence * 100), 100);
  }

  private static calculateRecencyBonus(dateString: string): number {
    try {
      const evidenceDate = new Date(dateString);
      const currentDate = new Date();
      const daysDiff = Math.floor((currentDate.getTime() - evidenceDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff <= 30) return 0.3; // Last 30 days
      if (daysDiff <= 90) return 0.2; // Last 90 days
      if (daysDiff <= 180) return 0.1; // Last 6 months
      return 0; // Older than 6 months
    } catch {
      return 0.1; // Default bonus if date parsing fails
    }
  }

  private static extractSources(signalResult: SignalResult): SourceDetail[] {
    if (!signalResult.found || signalResult.evidence.length === 0) {
      return [];
    }

    return signalResult.evidence.map(evidence => ({
      url: evidence.url,
      title: this.generateSourceTitle(evidence),
      date: evidence.date,
      confidence: evidence.confidence,
      source_type: evidence.data_source || evidence.source,
      snippet: evidence.summary
    }));
  }

  private static generateSourceTitle(evidence: Evidence): string {
    const sourceMap: { [key: string]: string } = {
      'Google News': 'News Article',
      'Crunchbase': 'Company Profile',
      'TechCrunch': 'Tech News',
      'LinkedIn': 'Professional Network',
      'Company Website': 'Official Website',
      'Careers Page': 'Job Postings',
      'Twitter': 'Social Media',
      'Company Blog': 'Company Blog'
    };

    const baseTitle = sourceMap[evidence.source] || evidence.source;
    const keyPhrase = this.extractKeyPhrase(evidence.summary);
    
    return keyPhrase ? `${baseTitle}: ${keyPhrase}` : baseTitle;
  }

  private static extractKeyPhrase(summary: string): string {
    // Extract the most relevant phrase from the summary
    const phrases = summary.split(/[.!?]/);
    const relevantPhrase = phrases.find(phrase => 
      phrase.length > 20 && 
      phrase.length < 100 &&
      (phrase.includes('funding') || phrase.includes('launch') || phrase.includes('hiring') || phrase.includes('raised'))
    );
    
    return relevantPhrase ? relevantPhrase.trim() : summary.substring(0, 60) + '...';
  }

  private static generateReasoning(signalResult: SignalResult, score: number): string {
    if (!signalResult.found || signalResult.evidence.length === 0) {
      return "No validated data found.";
    }

    const evidenceCount = signalResult.evidence.length;
    const recentEvidence = signalResult.evidence.filter(evidence => 
      this.calculateRecencyBonus(evidence.date) > 0.1
    ).length;

    const confidenceLevels = signalResult.evidence.map(e => e.confidence);
    const avgConfidence = confidenceLevels.reduce((a, b) => a + b, 0) / confidenceLevels.length;

    let reasoning = "";

    if (score >= 80) {
      reasoning = `Strong evidence with ${evidenceCount} sources confirming ${signalResult.signal}, including ${recentEvidence} recent sources with high confidence (${Math.round(avgConfidence * 100)}%).`;
    } else if (score >= 60) {
      reasoning = `Multiple sources (${evidenceCount}) indicate ${signalResult.signal} with moderate confidence (${Math.round(avgConfidence * 100)}%).`;
    } else if (score >= 40) {
      reasoning = `Limited evidence found for ${signalResult.signal} with ${evidenceCount} sources at ${Math.round(avgConfidence * 100)}% confidence.`;
    } else {
      reasoning = `Weak evidence for ${signalResult.signal} with only ${evidenceCount} low-confidence sources.`;
    }

    return reasoning;
  }

  private static calculateFinalIntentScore(signals: EnhancedSignalResult[]): number {
    if (signals.length === 0) return 0;

    const scores = signals.map(s => s.score);
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    // Apply bonus for multiple strong signals
    const strongSignals = signals.filter(s => s.score >= 70).length;
    const multipleSignalBonus = strongSignals >= 2 ? 10 : 0;
    
    return Math.min(Math.round(averageScore + multipleSignalBonus), 100);
  }

  private static determineIntentLevel(score: number): string {
    if (score >= 80) return "High Intent";
    if (score >= 60) return "Moderate Intent";
    if (score >= 40) return "Low Intent";
    return "No Intent";
  }

  private static generateOverallReasoning(signals: EnhancedSignalResult[], intentLevel: string): string {
    const strongSignals = signals.filter(s => s.score >= 70);
    const moderateSignals = signals.filter(s => s.score >= 50 && s.score < 70);
    const weakSignals = signals.filter(s => s.score > 0 && s.score < 50);

    let reasoning = "";

    if (strongSignals.length >= 2) {
      reasoning = `Multiple strong signals (${strongSignals.map(s => s.signal).join(', ')}) indicate active business development and high purchase readiness.`;
    } else if (strongSignals.length === 1 && moderateSignals.length >= 1) {
      reasoning = `Combination of strong ${strongSignals[0].signal} signal with supporting activities suggests growing business momentum.`;
    } else if (moderateSignals.length >= 2) {
      reasoning = `Multiple business activities detected (${moderateSignals.map(s => s.signal).join(', ')}) indicating ongoing development and moderate purchase intent.`;
    } else if (weakSignals.length > 0) {
      reasoning = `Limited business activity detected with weak signals, suggesting early-stage interest but low immediate purchase intent.`;
    } else {
      reasoning = "No significant business signals detected, indicating minimal current purchase intent.";
    }

    return reasoning;
  }
}

// ==================== HIGH CONFIDENCE INTENT DETECTOR ====================

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
          /\bvc\-backed\b/i,
          /\bfunding\s+round\b/i,
          /\bcapital\s+raise\b/i
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
          /\binternational\s+expansion\b/i,
          /\bgeographic\s+expansion\b/i
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
          /\bcareer\s+fair\b/i,
          /\bwe\'re\s+hiring\b/i,
          /\bnow\s+hiring\b/i
        ],
        weight: 8
      }],
      ['partnership', {
        patterns: [
          /\bpartnered\s+with\s+[a-z]+\b/i,
          /\bstrategic\s+partnership\s+with\b/i,
          /\bannounced\s+partnership\b/i,
          /\bcollaboration\s+with\b/i,
          /\bteamed\s+up\s+with\b/i,
          /\bintegration\s+with\b/i
        ],
        weight: 8
      }],
      ['acquisition', {
        patterns: [
          /\bacquired\s+by\s+[a-z]+\b/i,
          /\bacquired\s+[a-z]+\b/i,
          /\bmerger\s+with\b/i,
          /\bwas\s+acquired\b/i,
          /\bbought\s+by\b/i,
          /\bmerger\s+and\s+acquisition\b/i
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
          /\bannounced\s+[a-z]+\s+product\b/i,
          /\bnew\s+feature\s+release\b/i
        ],
        weight: 8
      }],
      ['leadership_change', {
        patterns: [
          /\bnew\s+ceo\b/i,
          /\bappointed\s+new\s+(ceo|cto|cmo|cfo)\b/i,
          /\bnew\s+executive\s+appointment\b/i,
          /\bleadership\s+change\b/i,
          /\bpromoted\s+[a-z]+\s+to\s+[a-z]+\b/i,
          /\bexecutive\s+hiring\b/i
        ],
        weight: 7
      }],
      ['award', {
        patterns: [
          /\bwon\s+[a-z]+\s+award\b/i,
          /\breceived\s+[a-z]+\s+award\b/i,
          /\bawarded\s+[a-z]+\s+prize\b/i,
          /\brecognized\s+as\s+[a-z]+\b/i,
          /\bbest\s+[a-z]+\s+company\b/i
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

    for (const [intent, config] of this.intentPatterns) {
      let intentScore = 0;
      
      for (const pattern of config.patterns) {
        if (pattern.test(query)) {
          intentScore += config.weight;
          signals.push(`${intent}_match`);
          
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
      subjects: this.extractSubjects(query),
      fundingStages: this.extractFundingStages(query),
      companyTypes: this.extractCompanyTypes(query)
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

  private extractFundingStages(query: string): string[] {
    const stages: string[] = [];
    const stagePatterns = [
      /\b(seed|series a|series b|series c|series d|venture capital|vc|angel|pre-seed)\b/gi
    ];

    for (const pattern of stagePatterns) {
      const matches = query.match(pattern);
      if (matches) {
        stages.push(...matches);
      }
    }

    return stages;
  }

  private extractCompanyTypes(query: string): string[] {
    const types: string[] = [];
    const typePatterns = [
      /\b(startup|scaleup|enterprise|sme|smb|corporation|company|business|firm|organization)\b/gi
    ];

    for (const pattern of typePatterns) {
      const matches = query.match(pattern);
      if (matches) {
        types.push(...matches);
      }
    }

    return types;
  }

  private calculateConfidence(topScore: number, uniqueIntents: number): IntentResult['confidence'] {
    if (topScore >= 9) return 'very-high';
    if (topScore >= 7) return 'high';
    if (topScore >= 5) return 'medium';
    return 'low';
  }
}

// ==================== HYBRID QUERY OPTIMIZER ====================

class HybridQueryOptimizer {
  private intentDetector: HighConfidenceIntentDetector;
  private ollamaService: any;

  constructor(ollamaService: any) {
    this.intentDetector = new HighConfidenceIntentDetector();
    this.ollamaService = ollamaService;
  }

  public async generateOptimizedQuery(
    icpConfig: ICPConfig, 
    userQuery: string,
    useHybrid: boolean = true
  ): Promise<QueryOptimizationResult> {
    
    const intentResult = this.intentDetector.detectIntent(userQuery);
    
    let optimizedQuery: string;
    let explanation: string;
    let queryType: 'precise' | 'broad' | 'exploratory' = 'precise';
    let suggestedFilters: string[] = [];

    if (useHybrid && (intentResult.confidence === 'low' || this.isComplexQuery(userQuery))) {
      const hybridResult = await this.generateHybridQuery(icpConfig, userQuery, intentResult);
      optimizedQuery = hybridResult.optimizedQuery;
      explanation = hybridResult.explanation;
      queryType = hybridResult.queryType;
      suggestedFilters = hybridResult.suggestedFilters || [];
    } else {
      const ruleBasedResult = this.generateRuleBasedQuery(icpConfig, userQuery, intentResult);
      optimizedQuery = ruleBasedResult.optimizedQuery;
      explanation = ruleBasedResult.explanation;
      queryType = ruleBasedResult.queryType;
      suggestedFilters = ruleBasedResult.suggestedFilters || [];
    }

    return {
      optimizedQuery,
      confidence: intentResult.confidence,
      detectedIntent: intentResult.intent,
      signalsFound: intentResult.signals,
      explanation,
      queryType,
      suggestedFilters
    };
  }

  private isComplexQuery(query: string): boolean {
    const complexityIndicators = [
      /\b(and|or|with|without|excluding)\b/gi,
      /\b\d+\s+(and|or)\s+\d+\b/gi,
      /[.,;!?]{2,}/g,
      /\b(complex|multiple|various|different)\b/gi
    ];

    return complexityIndicators.some(pattern => pattern.test(query));
  }

  private async generateHybridQuery(
    icpConfig: ICPConfig,
    userQuery: string,
    intentResult: IntentResult
  ): Promise<QueryOptimizationResult> {
    
    const systemPrompt = `You are an expert search query optimizer for business intelligence. 
Your task is to transform natural language queries into highly effective Exa.ai search queries.

CRITICAL RULES:
1. ALWAYS return valid JSON - no other text
2. Use ONLY these ICP fields: industries, geographies, employeeRange, acvRange (minimum only)
3. For acvRange, use only the minimum value (e.g., ">$50k" not "$50k-$200k")
4. IGNORE: technographics, mustHaveTech, targetPersonas, scoringWeights
5. Focus on company signals: funding, hiring, expansion, partnerships, acquisitions
6. Keep queries under 200 characters

ICP FIELDS TO USE:
- Industries: ${icpConfig.industries.join(', ')}
- Geographies: ${icpConfig.geographies.join(', ')}
- Employee Range: ${icpConfig.employeeRange}
- ACV Range: ${icpConfig.acvRange ? `Minimum ${this.extractMinACV(icpConfig.acvRange)}` : 'Not specified'}

Exa.ai QUERY SYNTAX:
- Use quotes for exact phrases
- Use AND/OR for boolean logic
- Use - to exclude terms
- Focus on recent company signals and events`;

    const prompt = `
USER QUERY: "${userQuery}"

DETECTED INTENT: ${intentResult.intent} (${intentResult.confidence} confidence)

TASK: Create an optimized Exa.ai query using ONLY:
- ICP industries, geographies, employee range, and ACV minimum
- User query intent and signals
- Recent company events and announcements

DO NOT USE: Technology stack, target personas, or complex revenue ranges

Return ONLY JSON in this exact format:
{
  "optimizedQuery": "string (max 200 chars)",
  "explanation": "string (brief reasoning)",
  "queryType": "precise" | "broad" | "exploratory",
  "suggestedFilters": ["array", "of", "additional", "filters"]
}`;

    try {
      const response = await this.ollamaService.generate(prompt, systemPrompt);
      const parsedResponse = this.parseOllamaResponse(response);
      
      return {
        optimizedQuery: parsedResponse.optimizedQuery || this.generateFallbackQuery(icpConfig, userQuery, intentResult),
        confidence: intentResult.confidence,
        detectedIntent: intentResult.intent,
        signalsFound: intentResult.signals,
        explanation: parsedResponse.explanation || 'Hybrid optimization applied',
        queryType: parsedResponse.queryType || 'precise',
        suggestedFilters: parsedResponse.suggestedFilters || []
      };
      
    } catch (error) {
      console.error('Hybrid query optimization failed:', error);
      return this.generateRuleBasedQuery(icpConfig, userQuery, intentResult);
    }
  }

  private extractMinACV(acvRange: string): string {
    const match = acvRange.match(/(\$?\d+[kKmM]?b?)/);
    return match ? match[1] : acvRange;
  }

  private parseOllamaResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(response);
    } catch (error) {
      console.error('Failed to parse Ollama response:', response);
      return {};
    }
  }

  private generateRuleBasedQuery(
    icpConfig: ICPConfig,
    userQuery: string,
    intentResult: IntentResult
  ): QueryOptimizationResult {
    
    const queryComponents: string[] = [];
    const explanationParts: string[] = [];
    const suggestedFilters: string[] = [];
    let queryType: 'precise' | 'broad' | 'exploratory' = 'precise';

    const icpContext = this.buildICPContext(icpConfig);
    if (icpContext) {
      queryComponents.push(icpContext);
      explanationParts.push(`ICP: ${icpConfig.industries.join(', ')} in ${icpConfig.geographies.join(', ')}`);
    }

    const intentQuery = this.buildIntentQuery(intentResult, userQuery);
    queryComponents.push(intentQuery);
    explanationParts.push(`Intent: ${intentResult.intent}`);

    if (intentResult.entities.timeframe) {
      queryComponents.push(intentResult.entities.timeframe);
      explanationParts.push(`Time: ${intentResult.entities.timeframe}`);
    }

    if (intentResult.confidence === 'low' || userQuery.split(' ').length > 8) {
      queryType = 'exploratory';
    } else if (intentResult.confidence === 'very-high' && queryComponents.length <= 3) {
      queryType = 'precise';
    } else {
      queryType = 'broad';
    }

    const optimizedQuery = this.finalizeQuery(queryComponents, queryType);

    return {
      optimizedQuery,
      confidence: intentResult.confidence,
      detectedIntent: intentResult.intent,
      signalsFound: intentResult.signals,
      explanation: explanationParts.join(' | '),
      queryType,
      suggestedFilters
    };
  }

  private buildICPContext(icpConfig: ICPConfig): string {
    const components: string[] = [];

    if (icpConfig.industries.length > 0) {
      if (icpConfig.industries.length === 1) {
        components.push(icpConfig.industries[0]);
      } else {
        components.push(`(${icpConfig.industries.join(' OR ')})`);
      }
    }

    if (icpConfig.geographies.length > 0) {
      components.push(`in ${icpConfig.geographies.join(' OR ')}`);
    }

    if (icpConfig.employeeRange) {
      components.push(icpConfig.employeeRange);
    }

    if (icpConfig.acvRange) {
      const minACV = this.extractMinACV(icpConfig.acvRange);
      components.push(`revenue >${minACV}`);
    }

    return components.join(' ');
  }

  private buildIntentQuery(intentResult: IntentResult, originalQuery: string): string {
    const intentMap: { [key: string]: string } = {
      funding: `("funding round" OR "raised funding" OR "venture capital" OR "Series A" OR "Series B")`,
      expansion: `("opened new office" OR "expanding to" OR "new location" OR "geographic expansion")`,
      hiring: `("hiring" OR "we're hiring" OR "job openings" OR "expanding team" OR "careers")`,
      partnership: `("partnership with" OR "strategic partnership" OR "collaboration with" OR "teamed up with")`,
      acquisition: `("acquired" OR "merger" OR "was acquired" OR "acquisition of")`,
      product_launch: `("launched new" OR "new product" OR "product release" OR "announced product")`,
      leadership_change: `("new CEO" OR "appointed" OR "executive appointment" OR "leadership change")`,
      award: `("won award" OR "received award" OR "awarded" OR "recognized as")`,
      general_search: originalQuery
    };

    return intentMap[intentResult.intent] || originalQuery;
  }

  private finalizeQuery(components: string[], queryType: 'precise' | 'broad' | 'exploratory'): string {
    let query = components.join(' ').trim().replace(/\s+/g, ' ');

    switch (queryType) {
      case 'precise':
        query = query.replace(/"([^"]+)"/g, '"$1"');
        break;
      case 'broad':
        query = query.replace(/\b(and|&)\b/gi, 'OR');
        break;
      case 'exploratory':
        query = query.substring(0, 150);
        break;
    }

    if (query.length > 200) {
      query = query.substring(0, 197) + '...';
    }

    return query;
  }

  private generateFallbackQuery(icpConfig: ICPConfig, userQuery: string, intentResult: IntentResult): string {
    const baseComponents = [
      this.buildICPContext(icpConfig),
      userQuery,
      '2024 OR 2023'
    ].filter(Boolean);

    return baseComponents.join(' ').substring(0, 200);
  }
}

// ==================== SUPERCHARGED INTENT DETECTOR ====================

class SuperchargedIntentDetector {
  private readonly dataSources = {
    careers: ['/careers', '/jobs', '/join-us', '/team']
  };

  async detectIntentWithEvidence(
    companyName: string,
    companyUrl: string,
    signals: string[]
  ): Promise<IntentEnrichmentResponse> {
    console.log(`🎯 SUPERCHARGED Detection for ${companyName}`);
    console.log(`📡 Signals: ${signals.join(', ')}`);

    const allEvidence: any[] = [];
    const dataSourcesUsed: Set<string> = new Set();

    const dataCollectionPromises = [
      this.collectNewsEvidence(companyName, signals),
      this.collectFinancialEvidence(companyName, signals),
      this.collectSocialEvidence(companyName, signals),
      this.collectWebsiteEvidence(companyUrl, signals),
      this.collectCareersEvidence(companyUrl, signals)
    ];

    const results = await Promise.allSettled(dataCollectionPromises);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        allEvidence.push(...result.value.evidence);
        result.value.sources.forEach((source: string) => dataSourcesUsed.add(source));
      }
    });

    const analyzedResults = await this.analyzeEvidenceWithAI(companyName, signals, allEvidence);
    
    return {
      company: companyName,
      website: companyUrl,
      analysis_date: new Date().toISOString().split('T')[0],
      requested_signals: signals,
      results: analyzedResults,
      summary: {
        total_signals: signals.length,
        signals_with_evidence: analyzedResults.filter(r => r.found).length,
        signals_without_evidence: analyzedResults.filter(r => !r.found).length,
        confidence_score: this.calculateOverallConfidence(analyzedResults),
        data_sources_used: Array.from(dataSourcesUsed)
      }
    };
  }

  private async collectNewsEvidence(companyName: string, signals: string[]): Promise<{ evidence: any[]; sources: string[] }> {
    const evidence: any[] = [];
    const sources: string[] = [];
    
    const newsQueries = this.generateNewsQueries(companyName, signals);
    
    for (const query of newsQueries.slice(0, 5)) {
      try {
        const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}`;
        const response = await axios.get(rssUrl, { timeout: 10000 });
        
        const $ = cheerio.load(response.data, { xmlMode: true });
        
        $('item').each((i, elem) => {
          const title = $(elem).find('title').text();
          const link = $(elem).find('link').text();
          const pubDate = $(elem).find('pubDate').text();
          const description = $(elem).find('description').text();

          if (this.isRelevantToSignals(title + ' ' + description, signals)) {
            evidence.push({
              source: 'Google News',
              url: link,
              date: pubDate,
              summary: `${title} - ${description.substring(0, 200)}...`,
              confidence: this.calculateRelevanceConfidence(title + description, signals),
              data_source: 'news'
            });
          }
        });
        
        sources.push('Google News');
        await this.delay(1000);
      } catch (error) {
        console.warn(`News search failed for query: ${query}`);
      }
    }

    return { evidence, sources };
  }

  private async collectFinancialEvidence(companyName: string, signals: string[]): Promise<{ evidence: any[]; sources: string[] }> {
    const evidence: any[] = [];
    const sources: string[] = [];

    try {
      const crunchbaseData = await this.scrapeCrunchbase(companyName);
      if (crunchbaseData) {
        evidence.push(...crunchbaseData.evidence);
        sources.push('Crunchbase');
      }

      const techcrunchData = await this.scrapeTechCrunch(companyName);
      if (techcrunchData) {
        evidence.push(...techcrunchData.evidence);
        sources.push('TechCrunch');
      }

    } catch (error) {
      console.warn('Financial data collection failed:', error.message);
    }

    return { evidence, sources };
  }

  private async collectSocialEvidence(companyName: string, signals: string[]): Promise<{ evidence: any[]; sources: string[] }> {
    const evidence: any[] = [];
    const sources: string[] = [];

    try {
      const linkedinData = await this.scrapeLinkedIn(companyName);
      if (linkedinData) {
        evidence.push(...linkedinData.evidence);
        sources.push('LinkedIn');
      }

      const twitterData = await this.searchTwitter(companyName, signals);
      if (twitterData) {
        evidence.push(...twitterData.evidence);
        sources.push('Twitter');
      }

    } catch (error) {
      console.warn('Social data collection failed:', error.message);
    }

    return { evidence, sources };
  }

  private async collectWebsiteEvidence(companyUrl: string, signals: string[]): Promise<{ evidence: any[]; sources: string[] }> {
    const evidence: any[] = [];
    const sources: string[] = [];

    try {
      const response = await axios.get(companyUrl, { timeout: 15000 });
      const $ = cheerio.load(response.data);

      const pageText = $('body').text().replace(/\s+/g, ' ').substring(0, 5000);
      
      signals.forEach(signal => {
        if (this.detectSignalInText(pageText, signal)) {
          evidence.push({
            source: 'Company Website',
            url: companyUrl,
            date: new Date().toISOString().split('T')[0],
            summary: `Website mentions related to ${signal}`,
            confidence: 0.7,
            data_source: 'website'
          });
        }
      });

      sources.push('Company Website');

      const blogData = await this.scrapeCompanyBlog(companyUrl, signals);
      if (blogData) {
        evidence.push(...blogData.evidence);
        sources.push('Company Blog');
      }

    } catch (error) {
      console.warn('Website data collection failed:', error.message);
    }

    return { evidence, sources };
  }

  private async collectCareersEvidence(companyUrl: string, signals: string[]): Promise<{ evidence: any[]; sources: string[] }> {
    const evidence: any[] = [];
    const sources: string[] = [];

    if (!signals.some(signal => signal.includes('hiring') || signal.includes('employee'))) {
      return { evidence, sources };
    }

    for (const careerPath of this.dataSources.careers) {
      try {
        const careerUrl = `${companyUrl.replace(/\/$/, '')}${careerPath}`;
        const response = await axios.get(careerUrl, { timeout: 10000 });
        const $ = cheerio.load(response.data);

        const jobCount = $('[class*="job"], [class*="career"], [class*="position"]').length;
        
        if (jobCount > 0) {
          evidence.push({
            source: 'Careers Page',
            url: careerUrl,
            date: new Date().toISOString().split('T')[0],
            summary: `Found ${jobCount} job openings on careers page`,
            confidence: 0.8,
            data_source: 'careers'
          });
          sources.push('Careers Page');
          break;
        }
      } catch (error) {
        continue;
      }
    }

    return { evidence, sources };
  }

  private async analyzeEvidenceWithAI(
    companyName: string,
    signals: string[],
    evidence: any[]
  ): Promise<any[]> {
    
    const prompt = `
Analyze the following evidence for ${companyName} and determine which signals are present.

SIGNALS TO DETECT: ${signals.join(', ')}

EVIDENCE COLLECTED:
${evidence.map(e => `
SOURCE: ${e.source}
URL: ${e.url}
DATE: ${e.date}
SUMMARY: ${e.summary}
CONFIDENCE: ${e.confidence}
`).join('\n')}

For each signal, return:
- found: true if there's credible evidence
- reasoning: brief explanation
- evidence: array of relevant evidence pieces

Be reasonable - if there are strong indicators, mark as found even if not 100% confirmed.

Return only valid JSON.`;

    try {
      const response = await ollamaService.generate(prompt, 'You are a business intelligence analyst.');
      const parsed = this.parseAIResponse(response);
      
      return signals.map(signal => {
        const foundSignal = parsed.find((p: any) => p.signal === signal);
        return foundSignal || {
          signal,
          evidence: [],
          found: false,
          reasoning: 'No evidence found in collected data'
        };
      });

    } catch (error) {
      console.error('AI analysis failed, using fallback analysis');
      return this.fallbackEvidenceAnalysis(signals, evidence);
    }
  }

  private generateNewsQueries(companyName: string, signals: string[]): string[] {
    const baseQueries = [
      companyName,
      `"${companyName}"`,
      `${companyName} startup`,
      `${companyName} tech`
    ];

    const signalQueries = signals.map(signal => {
      const signalMap: { [key: string]: string[] } = {
        'new_funding_round': ['funding', 'raised', 'series', 'venture capital'],
        'employee_joined_company': ['hired', 'appointed', 'joined', 'new team member'],
        'new_product': ['launched', 'new product', 'announced', 'release'],
        'hiring_in_engineering_department': ['hiring engineer', 'software jobs', 'tech hiring'],
        'merger_and_acquisitions': ['acquired', 'merger', 'acquisition'],
        'new_partnership': ['partnership', 'collaboration', 'partnered with']
      };

      return signalMap[signal] || [signal];
    }).flat();

    const allQueries: string[] = [];
    baseQueries.forEach(base => {
      signalQueries.forEach(signal => {
        allQueries.push(`${base} ${signal}`);
      });
    });

    return [...new Set(allQueries)];
  }

  private isRelevantToSignals(text: string, signals: string[]): boolean {
    const textLower = text.toLowerCase();
    
    const signalKeywords: { [key: string]: string[] } = {
      'new_funding_round': ['funding', 'raised', 'series', 'venture', 'capital'],
      'employee_joined_company': ['hired', 'appointed', 'joined', 'welcome', 'team'],
      'new_product': ['launch', 'new product', 'announced', 'release', 'feature'],
      'hiring_in_engineering_department': ['hiring', 'engineer', 'developer', 'technical'],
      'merger_and_acquisitions': ['acquired', 'merger', 'acquisition'],
      'new_partnership': ['partnership', 'collaboration', 'partnered']
    };

    return signals.some(signal => {
      const keywords = signalKeywords[signal] || [signal];
      return keywords.some(keyword => textLower.includes(keyword));
    });
  }

  private calculateRelevanceConfidence(text: string, signals: string[]): number {
    let confidence = 0.3;
    
    const textLower = text.toLowerCase();
    const signalKeywords: { [key: string]: string[] } = {
      'new_funding_round': [['series', 0.3], ['raised', 0.4], ['funding', 0.3]],
      'employee_joined_company': [['joined', 0.3], ['appointed', 0.4], ['hired', 0.3]],
      'new_product': [['launch', 0.4], ['new product', 0.5], ['announced', 0.3]]
    };

    signals.forEach(signal => {
      const keywords = signalKeywords[signal] || [];
      keywords.forEach(([keyword, weight]) => {
        if (textLower.includes(keyword)) {
          confidence += weight;
        }
      });
    });

    return Math.min(confidence, 1.0);
  }

  private detectSignalInText(text: string, signal: string): boolean {
    const textLower = text.toLowerCase();
    
    const signalPatterns: { [key: string]: RegExp[] } = {
      'new_funding_round': [/\bfunding\b/i, /\braised\b/i, /\bseries\s+[abc]\b/i],
      'employee_joined_company': [/\bjoined\b/i, /\bappointed\b/i, /\bnew\s+hire\b/i],
      'new_product': [/\blaunch\b/i, /\bnew\s+product\b/i, /\bannounced\b/i],
      'hiring_in_engineering_department': [/\bhiring\b/i, /\bengineer\b/i, /\bcareers\b/i]
    };

    const patterns = signalPatterns[signal] || [new RegExp(signal, 'i')];
    return patterns.some(pattern => pattern.test(textLower));
  }

  private calculateOverallConfidence(results: any[]): number {
    const signalsWithEvidence = results.filter(r => r.found);
    if (signalsWithEvidence.length === 0) return 0;
    
    const totalConfidence = signalsWithEvidence.reduce((sum, result) => {
      const evidenceConfidence = result.evidence.reduce((eSum: number, e: any) => eSum + e.confidence, 0);
      return sum + (evidenceConfidence / Math.max(result.evidence.length, 1));
    }, 0);
    
    return totalConfidence / signalsWithEvidence.length;
  }

  private parseAIResponse(response: string): any[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/) || response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      console.error('Failed to parse AI response:', response);
      return [];
    }
  }

  private fallbackEvidenceAnalysis(signals: string[], evidence: any[]): any[] {
    return signals.map(signal => {
      const relevantEvidence = evidence.filter(e => 
        this.isRelevantToSignals(e.summary, [signal])
      );

      return {
        signal,
        evidence: relevantEvidence,
        found: relevantEvidence.length > 0,
        reasoning: relevantEvidence.length > 0 
          ? `Found ${relevantEvidence.length} relevant evidence pieces` 
          : 'No evidence found'
      };
    });
  }

  private async scrapeCrunchbase(companyName: string): Promise<{ evidence: any[] }> {
    return { evidence: [] };
  }

  private async scrapeTechCrunch(companyName: string): Promise<{ evidence: any[] }> {
    return { evidence: [] };
  }

  private async scrapeLinkedIn(companyName: string): Promise<{ evidence: any[] }> {
    return { evidence: [] };
  }

  private async searchTwitter(companyName: string, signals: string[]): Promise<{ evidence: any[] }> {
    return { evidence: [] };
  }

  private async scrapeCompanyBlog(companyUrl: string, signals: string[]): Promise<{ evidence: any[] }> {
    return { evidence: [] };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== ENHANCED EXPORT FUNCTIONS ====================

export async function generateOptimizedExaQuery(
  icpConfig: ICPConfig, 
  userQuery: string, 
  useHybrid: boolean = true
): Promise<QueryOptimizationResult> {
  const optimizer = new HybridQueryOptimizer(ollamaService);
  return await optimizer.generateOptimizedQuery(icpConfig, userQuery, useHybrid);
}

export async function detectIntentWithEvidence(
  companyName: string,
  companyUrl: string,
  signals: string[]
): Promise<IntentEnrichmentResponse> {
  const detector = new SuperchargedIntentDetector();
  return await detector.detectIntentWithEvidence(companyName, companyUrl, signals);
}

export async function getEnhancedIntentAnalysis(
  companyName: string,
  industry: string,
  companyUrl: string,
  signals: string[]
): Promise<EnhancedIntentResponse> {
  const intentResults = await detectIntentWithEvidence(companyName, companyUrl, signals);
  return EnhancedIntentResponseBuilder.buildEnhancedResponse(companyName, industry, intentResults);
}

// ==================== USAGE EXAMPLES ====================

export async function demonstrateEnhancedSystem() {
  const icpConfig: ICPConfig = {
    industries: ["SaaS", "Fintech", "AI"],
    geographies: ["San Francisco", "New York", "London"],
    employeeRange: "51-200 employees",
    acvRange: "$50k-$200k"
  };

  // Test query optimization
  console.log('=== QUERY OPTIMIZATION DEMO ===');
  const testQueries = [
    "SaaS companies that raised Series A funding in the past 6 months",
    "Fintech startups hiring senior engineers in New York"
  ];

  for (const query of testQueries) {
    const result = await generateOptimizedExaQuery(icpConfig, query, true);
    console.log(`Original: "${query}"`);
    console.log(`Optimized: "${result.optimizedQuery}"`);
  }

  // Test enhanced intent analysis
  console.log('\n=== ENHANCED INTENT ANALYSIS DEMO ===');
  const enhancedResult = await getEnhancedIntentAnalysis(
    'Pemo',
    'Fintech',
    'https://www.pemo.io',
    ['new_funding_round', 'employee_joined_company', 'new_product']
  );

  console.log('Enhanced Intent Analysis Results:');
  console.log(JSON.stringify(enhancedResult, null, 2));
}

// Export all classes and interfaces
export { 
  HybridQueryOptimizer, 
  HighConfidenceIntentDetector,
  SuperchargedIntentDetector,
  EnhancedIntentResponseBuilder 
};