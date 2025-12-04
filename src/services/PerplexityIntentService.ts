import { Perplexity as PerplexityAI } from "@perplexity-ai/perplexity_ai";

// Types
export type IntentSignal = 
  // Financial Activities
  | "ipo_announcement"
  | "new_funding_round"
  | "new_investment"
  // Organizational Changes
  | "new_office"
  | "closing_office"
  | "merger_and_acquisitions"
  // Workforce Trends - Growth
  | "employee_joined_company"
  | "increase_in_engineering_department"
  | "increase_in_sales_department"
  | "increase_in_marketing_department"
  | "increase_in_operations_department"
  | "increase_in_customer_service_department"
  | "increase_in_all_departments"
  // Workforce Trends - Contraction
  | "decrease_in_engineering_department"
  | "decrease_in_sales_department"
  | "decrease_in_marketing_department"
  | "decrease_in_operations_department"
  | "decrease_in_customer_service_department"
  | "decrease_in_all_departments"
  // Workforce Trends - Hiring Activity
  | "hiring_in_creative_department"
  | "hiring_in_education_department"
  | "hiring_in_engineering_department"
  | "hiring_in_finance_department"
  | "hiring_in_health_department"
  | "hiring_in_human_resources_department"
  | "hiring_in_legal_department"
  | "hiring_in_marketing_department"
  | "hiring_in_operations_department"
  | "hiring_in_professional_service_department"
  | "hiring_in_sales_department"
  | "hiring_in_support_department"
  | "hiring_in_trade_department"
  | "hiring_in_unknown_department"
  // Product and Partnership Updates
  | "new_product"
  | "new_partnership"
  // Other Significant Events
  | "company_award"
  | "outages_and_security_breaches"
  | "cost_cutting"
  | "lawsuits_and_legal_issues";

export interface Evidence {
  source: string;
  url: string;
  date: string;
  summary: string;
  confidence: number;
}

export interface SignalResult {
  signal: string;
  evidence: Evidence[];
}

export interface CompleteSignalResult {
  signal: string;
  evidence: Evidence[];
  found: boolean;
  reasoning?: string;
}

export interface IntentEnrichmentResponse {
  company: string;
  website: string;
  analysis_date: string;
  results: SignalResult[];
  debug?: {
    rawResponse?: string;
    citations?: any;
    processingNotes?: string[];
  };
}

export interface CompleteIntentEnrichmentResponse {
  company: string;
  website: string;
  analysis_date: string;
  requested_signals: IntentSignal[];
  results: CompleteSignalResult[];
  summary: {
    total_signals: number;
    signals_with_evidence: number;
    signals_without_evidence: number;
    confidence_score: number;
  };
  debug?: {
    rawResponse?: string;
    citations?: any;
    processingNotes?: string[];
  };
}

export interface PerplexityRequest {
  companyName: string;
  companyUrl: string;
  signals?:String [];
  debug?: boolean;
}

// Signal Definitions
const SIGNAL_DEFINITIONS: Record<IntentSignal, string> = {
  // Financial Activities
  "ipo_announcement": "IPO filing, public offering announcement, or going public plans",
  "new_funding_round": "Seed, Series A/B/C/D, venture capital, or any capital raise",
  "new_investment": "Company investing in other businesses or acquiring stakes",
  
  // Organizational Changes
  "new_office": "Opening new locations, headquarters, or geographic expansion",
  "closing_office": "Shutting down or consolidating office locations",
  "merger_and_acquisitions": "M&A activity, acquisitions, or merger announcements",
  
  // Workforce Trends - Growth
  "employee_joined_company": "Key hires, new employees, or leadership additions",
  "increase_in_engineering_department": "Significant growth (>10%) in engineering roles",
  "increase_in_sales_department": "Significant growth (>10%) in sales roles",
  "increase_in_marketing_department": "Significant growth (>10%) in marketing roles",
  "increase_in_operations_department": "Significant growth (>10%) in operations roles",
  "increase_in_customer_service_department": "Significant growth (>10%) in support roles",
  "increase_in_all_departments": "Company-wide headcount expansion",
  
  // Workforce Trends - Contraction
  "decrease_in_engineering_department": "Significant reduction (>10%) in engineering roles",
  "decrease_in_sales_department": "Significant reduction (>10%) in sales roles",
  "decrease_in_marketing_department": "Significant reduction (>10%) in marketing roles",
  "decrease_in_operations_department": "Significant reduction (>10%) in operations roles",
  "decrease_in_customer_service_department": "Significant reduction (>10%) in support roles",
  "decrease_in_all_departments": "Company-wide layoffs or workforce reductions",
  
  // Workforce Trends - Hiring Activity
  "hiring_in_creative_department": "Active job postings for design, content, creative roles",
  "hiring_in_education_department": "Active job postings for training, L&D roles",
  "hiring_in_engineering_department": "Active job postings for developers, engineers",
  "hiring_in_finance_department": "Active job postings for accounting, finance roles",
  "hiring_in_health_department": "Active job postings for healthcare positions",
  "hiring_in_human_resources_department": "Active job postings for HR, talent acquisition",
  "hiring_in_legal_department": "Active job postings for legal counsel, compliance",
  "hiring_in_marketing_department": "Active job postings for marketing, growth, brand",
  "hiring_in_operations_department": "Active job postings for operations, logistics, PM",
  "hiring_in_professional_service_department": "Active job postings for consulting, advisory",
  "hiring_in_sales_department": "Active job postings for SDR, BDR, AE, sales roles",
  "hiring_in_support_department": "Active job postings for customer support, success",
  "hiring_in_trade_department": "Active job postings for trade, supply chain",
  "hiring_in_unknown_department": "Job postings that don't fit standard categories",
  
  // Product and Partnership Updates
  "new_product": "Product launches, feature releases, or platform updates",
  "new_partnership": "Strategic partnerships, integrations, collaborations",
  
  // Other Significant Events
  "company_award": "Industry recognition, certifications, rankings, awards",
  "outages_and_security_breaches": "Technical incidents, data breaches, downtime",
  "cost_cutting": "Budget reduction, expense management, efficiency programs",
  "lawsuits_and_legal_issues": "Litigation, regulatory actions, legal disputes"
};

// Enhanced search queries for better results
const SIGNAL_SEARCH_QUERIES: Record<IntentSignal, string[]> = {
  "new_funding_round": ["funding round", "raised $", "Series A", "Series B", "venture capital", "investment"],
  "new_partnership": ["partnership", "partners with", "collaboration", "integration"],
  "hiring_in_engineering_department": ["hiring engineers", "engineering jobs", "software developer jobs", "we're hiring"],
  "new_product": ["launches", "announces", "introduces new", "unveils"],
  "ipo_announcement": ["IPO", "going public", "S-1 filing", "public offering"],
  "new_investment": ["invests in", "acquires stake", "investment in"],
  "new_office": ["opens office", "new location", "expands to", "headquartered"],
  "closing_office": ["closes office", "shutting down", "relocating from"],
  "merger_and_acquisitions": ["acquires", "acquisition", "merger", "acquired by"],
  "employee_joined_company": ["joins", "appointed", "new hire", "welcomes"],
  "increase_in_engineering_department": ["hiring engineers", "expanding engineering team", "engineering headcount"],
  "increase_in_sales_department": ["hiring sales", "expanding sales team", "sales headcount"],
  "increase_in_marketing_department": ["hiring marketing", "expanding marketing team"],
  "increase_in_operations_department": ["hiring operations", "expanding ops team"],
  "increase_in_customer_service_department": ["hiring support", "expanding customer success"],
  "increase_in_all_departments": ["hiring spree", "expanding team", "headcount growth"],
  "decrease_in_engineering_department": ["layoffs engineering", "reducing engineering team"],
  "decrease_in_sales_department": ["layoffs sales", "reducing sales team"],
  "decrease_in_marketing_department": ["layoffs marketing", "reducing marketing team"],
  "decrease_in_operations_department": ["layoffs operations", "reducing ops team"],
  "decrease_in_customer_service_department": ["layoffs support", "reducing support team"],
  "decrease_in_all_departments": ["layoffs", "job cuts", "workforce reduction"],
  "hiring_in_creative_department": ["hiring designers", "creative jobs"],
  "hiring_in_education_department": ["hiring trainers", "L&D jobs"],
  "hiring_in_finance_department": ["hiring accountants", "finance jobs"],
  "hiring_in_health_department": ["hiring healthcare", "medical jobs"],
  "hiring_in_human_resources_department": ["hiring HR", "talent acquisition jobs"],
  "hiring_in_legal_department": ["hiring lawyers", "legal counsel jobs"],
  "hiring_in_marketing_department": ["hiring marketers", "marketing jobs"],
  "hiring_in_operations_department": ["hiring operations", "ops jobs"],
  "hiring_in_professional_service_department": ["hiring consultants", "advisory jobs"],
  "hiring_in_sales_department": ["hiring sales", "SDR jobs", "AE jobs"],
  "hiring_in_support_department": ["hiring support", "customer success jobs"],
  "hiring_in_trade_department": ["hiring supply chain", "procurement jobs"],
  "hiring_in_unknown_department": ["jobs", "careers", "hiring"],
  "company_award": ["wins award", "recognized", "ranked", "best company"],
  "outages_and_security_breaches": ["outage", "down", "breach", "hack", "security incident"],
  "cost_cutting": ["cost reduction", "cutting costs", "efficiency program"],
  "lawsuits_and_legal_issues": ["lawsuit", "sued", "legal action", "regulatory"]
};

// Main Service Class
export class PerplexityIntentService {
  private client: PerplexityAI;
  private debug: boolean = false;

  constructor(apiKey: string, debug: boolean = false) {
    this.client = new PerplexityAI({
      apiKey: apiKey
    });
    this.debug = debug;
  }

  /**
   * Generate enhanced prompt that explicitly asks for all signals
   */
  private generatePrompt(request: PerplexityRequest): string {
    const { companyName, companyUrl, signals } = request;

    // Create specific search suggestions for each signal
    const signalSearchGuide = signals.map(signal => {
      const definition = SIGNAL_DEFINITIONS[signal];
      const searchTerms = SIGNAL_SEARCH_QUERIES[signal] || [];
      const exampleQueries = searchTerms.slice(0, 3).map(term => 
        `"${companyName} ${term}"`
      ).join(", ");
      
      return `**${signal}**: ${definition}
   Search suggestions: ${exampleQueries}`;
    }).join('\n\n');

    const prompt = `Search the web for recent news and company information about **${companyName}** (${companyUrl}).

**YOUR TASK:**
Find concrete evidence for these ${signals.length} business signals from the past 12 months:

${signalSearchGuide}

**CRITICAL REQUIREMENT:**
You MUST return ALL ${signals.length} requested signals in your response, even if no evidence is found.
For signals without evidence, include them with empty evidence arrays and provide reasoning.

**SEARCH STRATEGY:**
1. Use specific search queries for each signal (examples provided above)
2. Look for these sources (in priority order):
   - Company press releases and official announcements
   - TechCrunch, VentureBeat, Business Insider, Reuters
   - Crunchbase, PitchBook data
   - Company LinkedIn page updates
   - Industry-specific publications
3. Verify dates are within the last 12 months
4. Extract specific facts: dates, dollar amounts, names, locations

**OUTPUT FORMAT (JSON only, no markdown):**
{
  "company": "${companyName}",
  "website": "${companyUrl}",
  "analysis_date": "${new Date().toISOString().split('T')[0]}",
  "requested_signals": ${JSON.stringify(signals)},
  "results": [
    {
      "signal": "exact_signal_name_from_list",
      "evidence": [
        {
          "source": "Publication or Website Name",
          "url": "https://direct-url-to-article.com",
          "date": "YYYY-MM-DD",
          "summary": "Specific facts: On [date], [company] [action] with [details and numbers]",
          "confidence": 0.85
        }
      ],
      "found": true,
      "reasoning": "Brief explanation of evidence found"
    },
    {
      "signal": "signal_without_evidence",
      "evidence": [],
      "found": false,
      "reasoning": "No recent evidence found despite searching [specific terms]"
    }
  ],
  "summary": {
    "total_signals": ${signals.length},
    "signals_with_evidence": 0,
    "signals_without_evidence": ${signals.length},
    "confidence_score": 0.0
  }
}

**IMPORTANT:**
- Include ALL ${signals.length} requested signals in the results array
- For signals without evidence, set "found": false and provide reasoning
- Calculate summary statistics based on actual findings
- Return ONLY valid JSON that can be parsed directly

Begin your web search now and return the complete JSON result.`;

    return prompt;
  }

  /**
   * Enhanced API call that ensures all signals are returned
   */
  async getIntentEnrichment(
    request: PerplexityRequest
  ): Promise<CompleteIntentEnrichmentResponse> {
    const prompt = this.generatePrompt(request);
    const debugEnabled = request.debug ?? this.debug;
    const processingNotes: string[] = [];

    if (debugEnabled) {
      console.log("=== PERPLEXITY REQUEST ===");
      console.log("Company:", request.companyName);
      console.log("Signals:", request.signals);
      console.log("Total signals requested:", request.signals.length);
    }

    try {
      const response = await this.client.chat.completions.create({
        model: "sonar-deep-research",
        messages: [
          {
            role: "system",
            content: `You are a business intelligence analyst specializing in company research.

CRITICAL INSTRUCTIONS:
1. Search the web thoroughly for each requested signal
2. You MUST return ALL requested signals in your response
3. For signals without evidence, include them with empty evidence arrays
4. Provide reasoning for both found and not-found signals
5. Return ONLY valid JSON (no markdown, no code blocks, no explanations)
6. Include summary statistics of your findings

Your response must be pure JSON that can be parsed directly.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
        return_citations: true,
        search_recency_filter: "year"
      });

      const content = response.choices[0]?.message?.content || "{}";
      const citations = (response as any).citations;

      if (debugEnabled) {
        console.log("\n=== RAW PERPLEXITY RESPONSE ===");
        console.log(content);
      }

      processingNotes.push(`Received ${content.length} characters from Perplexity`);

      // Extract and parse JSON
      const jsonContent = this.extractJSONFromResponse(content);
      
      if (debugEnabled) {
        console.log("\n=== EXTRACTED JSON ===");
        console.log(JSON.stringify(jsonContent, null, 2));
      }

      processingNotes.push(`Extracted JSON structure`);
      
      // Enhanced validation that ensures all signals are present
      const validatedResponse = this.validateCompleteEnrichmentResponse(jsonContent, request);
      
      processingNotes.push(`Processed ${validatedResponse.results.length} signals (${validatedResponse.summary.signals_with_evidence} with evidence)`);

      // Add debug info if enabled
      if (debugEnabled) {
        validatedResponse.debug = {
          rawResponse: content.substring(0, 500),
          citations: citations,
          processingNotes
        };
      }

      return validatedResponse;

    } catch (error) {
      console.error('❌ Perplexity API error:', error);
      processingNotes.push(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      const fallback = this.getCompleteFallbackResponse(request);
      if (debugEnabled) {
        fallback.debug = {
          rawResponse: '',
          processingNotes
        };
      }
      return fallback;
    }
  }

  /**
   * Enhanced validation that ensures ALL requested signals are returned
   */
  private validateCompleteEnrichmentResponse(data: any, request: PerplexityRequest): CompleteIntentEnrichmentResponse {
    if (!data || typeof data !== 'object') {
      return this.getCompleteFallbackResponse(request);
    }
    
    const requestedSignals = new Set(request.signals);
    const processedSignals = new Set<string>();
    
    // Process results from API response
    const results: CompleteSignalResult[] = [];
    
    if (Array.isArray(data.results)) {
      data.results.forEach((result: any) => {
        if (result && result.signal && requestedSignals.has(result.signal as IntentSignal)) {
          const signalResult: CompleteSignalResult = {
            signal: result.signal,
            evidence: Array.isArray(result.evidence) ? this.validateEvidence(result.evidence) : [],
            found: result.found || (Array.isArray(result.evidence) && result.evidence.length > 0),
            reasoning: result.reasoning || this.generateDefaultReasoning(result.signal, result.evidence)
          };
          results.push(signalResult);
          processedSignals.add(result.signal);
        }
      });
    }
    
    // Add missing signals with empty evidence
    request.signals.forEach(signal => {
      if (!processedSignals.has(signal)) {
        results.push({
          signal: signal,
          evidence: [],
          found: false,
          reasoning: `No evidence found for ${signal} despite searching relevant sources`
        });
      }
    });
    
    // Calculate summary statistics
    const signalsWithEvidence = results.filter(r => r.found).length;
    const totalSignals = results.length;
    const confidenceScore = totalSignals > 0 ? signalsWithEvidence / totalSignals : 0;
    
    return {
      company: data.company || request.companyName,
      website: data.website || request.companyUrl,
      analysis_date: data.analysis_date || new Date().toISOString().split('T')[0],
      requested_signals: request.signals,
      results: results,
      summary: {
        total_signals: totalSignals,
        signals_with_evidence: signalsWithEvidence,
        signals_without_evidence: totalSignals - signalsWithEvidence,
        confidence_score: Math.round(confidenceScore * 100) / 100
      }
    };
  }

  /**
   * Generate default reasoning for signals
   */
  private generateDefaultReasoning(signal: string, evidence: Evidence[]): string {
    if (evidence.length === 0) {
      const searchTerms = SIGNAL_SEARCH_QUERIES[signal as IntentSignal] || [];
      const searchDescription = searchTerms.slice(0, 3).join(', ');
      return `No recent evidence found for ${signal} despite searching for: ${searchDescription}`;
    }
    
    const sourceCount = evidence.length;
    const recentCount = evidence.filter(e => {
      const evidenceDate = new Date(e.date);
      const daysDiff = Math.floor((Date.now() - evidenceDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff <= 90;
    }).length;
    
    const sources = [...new Set(evidence.map(e => e.source))].join(', ');
    
    return `Found ${sourceCount} evidence sources (${recentCount} recent) from ${sources}`;
  }

  /**
   * Enhanced fallback response that includes all signals
   */
  private getCompleteFallbackResponse(request: PerplexityRequest): CompleteIntentEnrichmentResponse {
    const results: CompleteSignalResult[] = request.signals.map(signal => ({
      signal: signal,
      evidence: [],
      found: false,
      reasoning: `Search failed or no evidence found for ${signal}`
    }));
    
    return {
      company: request.companyName,
      website: request.companyUrl,
      analysis_date: new Date().toISOString().split('T')[0],
      requested_signals: request.signals,
      results: results,
      summary: {
        total_signals: request.signals.length,
        signals_with_evidence: 0,
        signals_without_evidence: request.signals.length,
        confidence_score: 0
      }
    };
  }

  /**
   * JSON extraction from response
   */
  private extractJSONFromResponse(content: string): any {
    let cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    const jsonObjectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        const parsed = JSON.parse(jsonObjectMatch[0]);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch (e) {
        console.log('JSON object extraction failed, trying other methods...');
      }
    }
    
    try {
      return JSON.parse(cleaned.trim());
    } catch (e) {
      console.log('Direct parse failed');
    }
    
    const jsonArrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonArrayMatch) {
      try {
        const parsed = JSON.parse(jsonArrayMatch[0]);
        if (Array.isArray(parsed)) {
          return {
            company: "",
            website: "",
            analysis_date: new Date().toISOString().split('T')[0],
            results: parsed
          };
        }
      } catch (e) {
        console.log('JSON array parse failed');
      }
    }
    
    console.warn('⚠️  Could not extract JSON from response, returning empty structure');
    return {
      company: "",
      website: "",
      analysis_date: new Date().toISOString().split('T')[0],
      results: []
    };
  }

  /**
   * Validate evidence quality
   */
  private validateEvidence(evidence: any[]): Evidence[] {
    return evidence.filter(e => {
      // Basic validation
      if (!e.source || !e.url || !e.date || !e.summary) return false;
      
      // URL validation
      try {
        new URL(e.url);
      } catch {
        return false;
      }
      
      // Date validation
      const date = new Date(e.date);
      if (isNaN(date.getTime())) return false;
      
      // Confidence validation
      if (e.confidence < 0 || e.confidence > 1) return false;
      
      return true;
    });
  }

  /**
   * Stream intent enrichment results (for real-time updates)
   */
  async *streamIntentEnrichment(
    request: PerplexityRequest
  ): AsyncGenerator<string, void, unknown> {
    const prompt = this.generatePrompt(request);

    const stream = await this.client.chat.completions.create({
      model: "sonar-deep-research",
      messages: [
        {
          role: "system",
          content: "You are a business intelligence analyst. Search the web and return valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      return_citations: true,
      search_recency_filter: "year",
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Batch process with enhanced error handling
   */
  async batchGetIntentEnrichment(
    requests: PerplexityRequest[],
    options: { concurrency?: number; delayMs?: number } = {}
  ): Promise<CompleteIntentEnrichmentResponse[]> {
    const { concurrency = 2, delayMs = 2000 } = options;
    const results: CompleteIntentEnrichmentResponse[] = [];

    console.log(`📊 Processing ${requests.length} companies in batches of ${concurrency}...`);

    for (let i = 0; i < requests.length; i += concurrency) {
      const batch = requests.slice(i, i + concurrency);
      const batchNum = Math.floor(i / concurrency) + 1;
      const totalBatches = Math.ceil(requests.length / concurrency);
      
      console.log(`\n🔄 Processing batch ${batchNum}/${totalBatches}...`);

      const batchResults = await Promise.allSettled(
        batch.map(req => this.getIntentEnrichment(req))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const originalRequest = batch[j];

        if (result.status === "fulfilled") {
          const signalCount = result.value.summary.signals_with_evidence;
          console.log(`  ✅ ${originalRequest.companyName}: ${signalCount}/${originalRequest.signals.length} signals found`);
          results.push(result.value);
        } else {
          console.error(`  ❌ ${originalRequest.companyName}: Failed -`, result.reason?.message || result.reason);
          results.push(this.getCompleteFallbackResponse(originalRequest));
        }
      }

      // Rate limiting delay
      if (i + concurrency < requests.length) {
        console.log(`⏳ Waiting ${delayMs}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`\n✨ Batch processing complete! Processed ${results.length} companies.`);
    return results;
  }

  /**
   * Get available signal types
   */
  static getAvailableSignals(): IntentSignal[] {
    return Object.keys(SIGNAL_DEFINITIONS) as IntentSignal[];
  }

  /**
   * Get signal definition
   */
  static getSignalDefinition(signal: IntentSignal): string {
    return SIGNAL_DEFINITIONS[signal];
  }

  /**
   * Get search queries for a signal
   */
  static getSignalSearchQueries(signal: IntentSignal): string[] {
    return SIGNAL_SEARCH_QUERIES[signal] || [];
  }
}

// Export a singleton instance
export const perplexityService = new PerplexityIntentService(process.env.PERPLEXITY_API_KEY || '');