// src/services/OllamaService.ts
import axios from 'axios';
import { config } from '../core/config.js';
import { Company } from '../core/types.js';
import { GoogleGenAI, Content, GenerateContentConfig } from "@google/genai";
import OpenAI from 'openai';
export interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}
// Add these interfaces to your existing OllamaService
interface IntentClassification {
  intent: 'greeting' | 'company_search' | 'signals' | 'other';
  confidence: number;
  enhanced_query?: string;
  reasoning: string;
  suggested_action?: 'search' | 'analyze_signals' | 'respond' | 'ignore';
}

interface ClassificationResponse {
  classification: IntentClassification;
  response: string;
  action?: {
    type: 'start_search' | 'analyze_signals' | 'respond_only';
    query?: string;
    scope?: string;
  };
}
export interface ScoringResult {
  score: number;
  reason: string;
  confidence?: number;
  factors?: string[];
}
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }); 
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
const RETRYABLE_STATUS_CODES = [429, 500, 503];
const MAX_RETRIES = 5;
export class OllamaService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.OLLAMA_BASE_URL;
  }

  async generateOpenRouter(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const messages:any[] = [];
      
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });


      const LLM_TIMEOUT = 300000;
      const response = await axios.post(`https://openrouter.ai/api/v1/chat/completions`, {
        model: config.OLLAMA_MODEL,
        messages: messages,
      },{
        headers:{
          Authorization: 'Bearer '+config.OPENROUTER_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: LLM_TIMEOUT
      });

      console.log(response)
      ////console.log(response.data.choices)
      return response.data.choices?.[0]?.message?.content;
    } catch (error) {
      console.error('Ollama API error:', error);
      throw new Error('Failed to generate response from Ollama');
    }
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // 1. Construct the messages array in the standard OpenAI format
            const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }
            
            messages.push({ role: 'user', content: prompt });

            // 2. Call the OpenAI SDK
            const completion = await openai.chat.completions.create({
                model: config.OPENAI_MODEL || 'gpt-3.5-turbo', // Use your config model or a default
                messages: messages,
                // The SDK handles headers and timeouts internally
            });

            // 3. Success! Return the response text.
            const responseText = completion.choices[0]?.message?.content;
            if (!responseText) {
                throw new Error("OpenAI returned an empty response.");
            }
            console.log(completion); 
            return responseText; 

        } catch (error: any) {
            const status = error.status; 
            
            // Check if the error is retryable (Rate limit 429, Server errors 500/503)
            if (RETRYABLE_STATUS_CODES.includes(status as number)) {
                if (attempt < MAX_RETRIES - 1) {
                    // Exponential backoff with jitter
                    const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 500);
                    console.warn(`OpenAI API temporarily unavailable (${status}). Retrying in ${delay / 1000}s... (Attempt ${attempt + 1} of ${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Go to the next attempt
                }
            }
            
            // For critical errors or final failed retry, log and re-throw
            console.error('OpenAI API final error:', error);
            throw new Error(`Failed to generate response from OpenAI API. Details: ${error.message}`);
        }
    }
    
    throw new Error('Maximum retries reached for OpenAI API request.');
}
    

  async scoreCompanyFit(company: any, icpConfig: any): Promise<ScoringResult> {
    const systemPrompt = `You are a B2B marketing and target audience analysis expert. 
    Evaluate companies against ICP criteria and provide a JSON response with score (0-100) and reason.`;
    const prompt = `You are an expert B2B sales intelligence analyst specializing in Ideal Customer Profile (ICP) scoring. Your task is to evaluate companies against specific ICP criteria and generate accurate, data-driven fit scores from 0-100 based solely on the weighted criteria specified in the ICP configuration.

    ## Your Mission
    
    Analyze the provided company data against the ICP configuration and calculate a precise fit score from 0-100, along with detailed reasoning and contributing factors. Use ONLY the weights specified in scoringWeights.firmographic and scoringWeights.technographic from the ICP configuration.
    
    *ICP Configuration:*
    json
    ${JSON.stringify(icpConfig, null, 2)}
    
    *Company Data:*
    json
    ${JSON.stringify(company, null, 2)}
    
    ## Scoring Weight Application
    
    CRITICAL: Use ONLY the active criteria based on scoringWeights:
    
    - If scoringWeights.firmographic > 0: Include firmographic analysis
    - If scoringWeights.technographic > 0: Include technographic analysis  
    - If scoringWeights.technographic = 0: COMPLETELY IGNORE technographic criteria
    - Final Score = (Firmographic Score + Technographic Score) scaled to 0-100
    
    *Current Active Weights:*
    - Firmographic: ${icpConfig.scoringWeights.firmographic}% of total score
    - Technographic: ${icpConfig.scoringWeights.technographic}% of total score
    
    ---
    
    ## 1. FIRMOGRAPHIC ANALYSIS ${icpConfig.scoringWeights.firmographic > 0 ? '(ACTIVE)' : '(INACTIVE)'}
    
    ${icpConfig.scoringWeights.firmographic > 0 ? `
    *Total Available Points:* ${icpConfig.scoringWeights.firmographic}
    
    *Point Distribution:*
    Each of the 5 firmographic dimensions receives an equal share of the total firmographic points.
    Points per dimension = ${icpConfig.scoringWeights.firmographic} ÷ 5 = ${icpConfig.scoringWeights.firmographic / 5}
    
    ### Dimension 1: Industry Match
    
    *Max Points:* ${icpConfig.scoringWeights.firmographic / 5}
    
    *Semantic Matching Rules:*
    - ✓ **Exact Match** (identical terms): *100% of dimension points*
    - ✓ **Close Semantic Match** (same meaning): *90% of dimension points*
      - "Marketing Services" ↔ "Marketing"
      - "Software Development" ↔ "Software Engineering" 
    - ✓ **Category Match** (same industry category): *80% of dimension points*
      - "SaaS" ↔ "Software"
      - "Advertising Services" ↔ "Digital Advertising"
    - ≈ **Related Industry**: *60% of dimension points*
    - ≈ **Peripheral Match**: *40% of dimension points*
    - ✗ **No Semantic Relationship**: *0 points*
    - 🚫 **Semantic Exclusion**: *DISQUALIFICATION*
    - ⚠ **Missing data**: *0 points*
    
    ### Dimension 2: Geography
    
    *Max Points:* ${icpConfig.scoringWeights.firmographic / 5}
    
    *Semantic Matching Rules:*
    - ✓ **Exact Location Match**: *100% of dimension points*
    - ✓ **Region Semantic Match**: *90% of dimension points*
    - ✓ **Country Semantic Match**: *100% of dimension points*
    - ≈ **Economic Zone Match**: *70% of dimension points*
    - ≈ **Market Similarity**: *50% of dimension points*
    - ✗ **Different Market Type**: *0 points*
    - 🚫 **Semantic Geography Exclusion**: *25% penalty on final score*
    
    ### Dimension 3: Company Size (Employee Count)
    
    *Max Points:* ${icpConfig.scoringWeights.firmographic / 5}
    
    *Semantic Range Matching:*
    - ✓ **Exact Range Match**: *100% of dimension points*
    - ✓ **Close Semantic Range** (within 10%): *90% of dimension points*
    - ≈ **Adjacent Size Category**: *75% of dimension points*
    - ≈ **Similar Business Stage**: *60% of dimension points*
    - ≈ **Growth Trajectory Match**: *50% of dimension points*
    - ✗ **Different Scale Category**: *0 points*
    
    ### Dimension 4: Annual Revenue
    
    *Max Points:* ${icpConfig.scoringWeights.firmographic / 5}
    
    *Semantic Revenue Matching:*
    - ✓ **Exact Range Match**: *100% of dimension points*
    - ✓ **Close Financial Scale**: *85% of dimension points*
    - ≈ **Similar Business Model Capacity**: *70% of dimension points*
    - ≈ **Funding-Stage Proxy**: *50% of dimension points*
    - ✗ **Different Financial League**: *0 points*
    
    ### Dimension 5: Funding/Financial Stability
    
    *Max Points:* ${icpConfig.scoringWeights.firmographic / 5}
    
    *Semantic Financial Health Matching:*
    - ✓ **Exact Stage Match**: *100% of dimension points*
    - ✓ **Similar Financial Maturity**: *90% of dimension points*
    - ≈ **Comparable Risk Profile**: *70% of dimension points*
    - ≈ **Inferred Stability**: *50% of dimension points*
    - ✗ **Different Risk Category**: *20% of dimension points*
    
    *Firmographic Score Calculation:*
    Firmographic Score = Sum of all 5 dimension scores
    Maximum Possible Firmographic = ${icpConfig.scoringWeights.firmographic}
    ` : '**FIRMOGRAPHIC ANALYSIS SKIPPED** - Weight is 0'}
    
    ---
    
    ## 2. TECHNOGRAPHIC ANALYSIS ${icpConfig.scoringWeights.technographic > 0 ? '(ACTIVE)' : '(INACTIVE)'}
    
    ${icpConfig.scoringWeights.technographic > 0 ? `
    *Total Available Points:* ${icpConfig.scoringWeights.technographic}
    
    *Point Distribution:*
    Must-Have Technologies = ${icpConfig.scoringWeights.technographic} × 0.60 = ${icpConfig.scoringWeights.technographic * 0.60}
    Tech Stack Quality = ${icpConfig.scoringWeights.technographic} × 0.20 = ${icpConfig.scoringWeights.technographic * 0.20}
    Integration Readiness = ${icpConfig.scoringWeights.technographic} × 0.20 = ${icpConfig.scoringWeights.technographic * 0.20}
    
    ### Component 1: Must-Have Technologies
    
    *Semantic Technology Matching:*
    - ✓ **Exact Technology Match**: *100% of match points*
    - ✓ **Platform Semantic Match**: *90% of match points*
    - ✓ **Category Semantic Match**: *80% of match points*
    - ≈ **Functional Equivalent**: *70% of match points*
    - ≈ **Partial Capability**: *50% of match points*
    - ✗ **No Technological Overlap**: *0 points*
    
    *Technographic Score Calculation:*
    Technographic Score = Sum of all 3 component scores
    Maximum Possible Technographic = ${icpConfig.scoringWeights.technographic}
    ` : '**TECHNOGRAPHIC ANALYSIS SKIPPED** - Weight is 0'}
    
    ---
    
    ## FINAL SCORE CALCULATION
    
    *Active Components:*
    - Firmographic: ${icpConfig.scoringWeights.firmographic} points maximum
    - Technographic: ${icpConfig.scoringWeights.technographic} points maximum
    
    *Final Score Formula:*
    Final Score = Firmographic Score + Technographic Score
    
    *Maximum Possible Score:*
    ${icpConfig.scoringWeights.firmographic + icpConfig.scoringWeights.technographic} points = 100 points
    
    ## DISQUALIFICATION RULES
    
    Apply these checks FIRST before any scoring:
     - 🚫 Critical missing data (no industry, location, size): *Maximum Score = 30*
    
    ## CONFIDENCE SCORING
    
    Calculate confidence based on data completeness:
    - 95%: Complete data across all active dimensions
    - 85%: Minor data gaps in active dimensions
    - 70%: Significant data gaps in active dimensions  
    - 50%: Major data incompleteness in active dimensions
    - <50%: Insufficient data for reliable scoring
    
    Always return your final output in the following exact JSON-style structure — with no additional text, comments, or formatting:
    
    {
        "score": "",
        "reason": "",
        "factors": "",
        "confidence": ""
    }
    
    Guidelines:
    - Do not include any extra text before or after this structure
    - "score" → The main numeric score (0-100)
    - "reason" → A short explanation of why that score was given
    - "factors" → Key elements that influenced the result
    - "confidence" → Percentage representing confidence in the output
    `;

    try {
      const response = await this.generate(prompt, systemPrompt);
      //console.log("----------------------------------------------------")
      console.log(response)
      const parsed = this.parseJSONResponse(response);

      //console.log(parsed)
      return {
        score: Math.min(100, Math.max(0, parsed.score || 0)),
        reason: parsed.reason || 'No reason provided',
        confidence: parsed.confidence || 0.8,
        factors: parsed.factors || []
      };
    } catch (error) {
      console.error('Scoring error:', error);
      return { score: 0, reason: 'Scoring failed', confidence: 0, factors: [] };
    }
  }
  async scoreCompanyIntent(company: any, icpModel: any): Promise<ScoringResult> {
    const systemPrompt = `You are an intent analysis expert specializing in identifying buying signals from company data. Analyze how well the company matches the ICP model and identify buying intent.`;

    const prompt = `
    ICP MODEL CONFIGURATION:
    - Target Industries: ${icpModel.industries?.join(', ') || 'Any'}
    - Target Geographies: ${icpModel.geographies?.join(', ') || 'Any'}
    - Employee Range: ${icpModel.employeeRange || 'Any'}
    - ACV Range: ${icpModel.acvRange || 'Any'}
    - Must-Have Tech: ${icpModel.mustHaveTech?.join(', ') || 'None'}
    - Buying Motion: ${icpModel.mustHaveMotion || 'Any'}
    - Buying Triggers: ${icpModel.buyingTriggers?.join(', ') || 'None'}
    - Target Personas: ${icpModel.targetPersonas?.join(', ') || 'Any'}

    COMPANY DATA:
    - Company Name: ${company.basic_info?.name || 'Unknown'}
    - Industry: ${company.business_classification?.industry?.primary?.type || 'Unknown'}
    - Location: ${company.contact_info?.address?.country || 'Unknown'}
    - Employee Count: ${company.firmographic_data?.employee_count?.exact || company.firmographic_data?.employee_count?.range || 'Unknown'}
    - Technologies: ${company.technographic_data?.technology_stack?.map((tech: any) => tech.name).join(', ') || 'None'}
    - Recent Hiring: ${company.intent_signals?.hiring_signals?.job_postings?.length || 0} job postings
    - Employee Growth: ${company.firmographic_data?.employee_count?.growth_rate || 0}%
    - Funding Status: ${company.firmographic_data?.funding_status?.stage || 'Unknown'}

    Analyze buying intent by evaluating:
    1. ICP Fit: How well the company matches the target industry, geography, size, and technology requirements
    2. Buying Triggers: Check for specific triggers like ${icpModel.buyingTriggers?.join(', ') || 'general growth signals'}
    3. Growth Signals: Hiring activity, employee growth, technology adoption
    4. Business Health: Company size, funding status, market position

    Return JSON response: { 
      "score": number (0-100), 
      "reason": string (detailed explanation of why this score was given),
      "confidence": number (0-1, how confident you are in this assessment), 
      "keySignals": string[] (3-5 specific buying signals identified)
    }

    Scoring Guidelines:
    - 80-100: Excellent match with strong buying triggers
    - 60-79: Good match with clear buying signals
    - 40-59: Moderate match with some potential signals
    - 20-39: Weak match with minimal signals
    - 0-19: Poor match or no buying signals
    `;

    try {
      const response = await this.generate(prompt, systemPrompt);

      const parsed = this.parseJSONResponse(response);
      
      return {
        score: Math.min(100, Math.max(0, parsed.score || 0)),
        reason: parsed.reason || 'Limited data available for intent analysis',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        factors: parsed.keySignals || ['Insufficient data for detailed analysis']
      };
    } catch (error) {
      console.error('Intent scoring error:', error);
      return { 
        score: 0, 
        reason: 'Intent scoring failed - analysis error', 
        confidence: 0, 
        factors: ['Scoring system unavailable'] 
      };
    }
  }
// Add this method to your OllamaService class
async generateNoResultsMessage(
  query: string, 
  icpModel: any, 
  attemptedQueries: string[] = []
): Promise<{
  message: string;
  suggestedQueries: string[];
  analysis: string;
}> {
  const systemPrompt = `You are a helpful search assistant. When no companies are found for a query, provide:
1. A clear, empathetic explanation of why no results were found
2. Specific, actionable suggestions to broaden the search
3. Analysis of what might be too restrictive in the current query
4. Alternative search strategies

Be constructive and helpful - don't blame the user, but guide them toward better searches.`;

  const prompt = `
USER SEARCH CONTEXT:
- **Original Query**: "${query}"
- **ICP Model**: ${icpModel.name}
- **Target Profile**: ${icpModel.config.industries?.join(', ') || 'Various industries'}, ${icpModel.config.employeeRange || 'Various sizes'}, ${icpModel.config.geographies?.join(', ') || 'Multiple regions'}
${attemptedQueries.length > 0 ? `- **Attempted Variations**: ${attemptedQueries.join(', ')}` : ''}

ANALYSIS REQUEST:
1. Explain why this specific search might not be returning results
2. Suggest 3-5 alternative search queries that could work better
3. Provide guidance on how to adjust search criteria
4. Keep the response encouraging and actionable

Return your response as valid JSON:
{
  "message": "clear explanation of the situation and why no results were found",
  "suggestedQueries": ["array", "of", "specific", "alternative", "queries"],
  "analysis": "detailed analysis of what might be too restrictive and how to adjust"
}`;

  try {
    const response = await this.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    // Fallback if parsing fails
    if (!parsed.message || !parsed.suggestedQueries) {
      return this.generateFallbackNoResultsMessage(query, icpModel);
    }

    return {
      message: parsed.message,
      suggestedQueries: parsed.suggestedQueries.slice(0, 5),
      analysis: parsed.analysis || 'The search criteria may be too specific or restrictive for the available data.'
    };
  } catch (error) {
    console.error('Error generating no results message:', error);
    return this.generateFallbackNoResultsMessage(query, icpModel);
  }
}

// Fallback message generator
private generateFallbackNoResultsMessage(
  query: string, 
  icpModel: any
): {
  message: string;
  suggestedQueries: string[];
  analysis: string;
} {
  const baseSuggestions = [
    `Companies in the ${icpModel.config.industries?.[0] || 'technology'} industry`,
    `Businesses with ${icpModel.config.employeeRange || '50-200'} employees`,
    `Organizations based in ${icpModel.config.geographies?.[0] || 'your target region'}`
  ];

  // Analyze query for potential issues
  let analysis = 'Your search may be too specific. ';
  if (query.includes('with') && query.includes('and')) {
    analysis += 'Multiple constraints might be limiting results. ';
  }
  if (query.toLowerCase().includes('recent') || query.includes('2024')) {
    analysis += 'Temporal filters can significantly reduce available data. ';
  }
  if (query.includes('exact') || query.includes('specific')) {
    analysis += 'Very specific requirements may not match available company profiles. ';
  }

  analysis += 'Try broadening one criteria at a time.';

  return {
    message: `No companies found matching "${query}". This could be because the search is too specific or there are no companies in our database that match all your criteria exactly.`,
    suggestedQueries: baseSuggestions,
    analysis
  };
}

// Enhanced method to generate alternative queries
async generateAlternativeQueries(
  originalQuery: string, 
  icpModel: any
): Promise<string[]> {
  const systemPrompt = `You are a search query expert. Generate 5 alternative search queries that:
1. Broaden the original search while maintaining relevance
2. Remove or relax the most restrictive criteria
3. Suggest related industries or company types
4. Vary the geographic scope if applicable
5. Adjust company size ranges

Return ONLY a JSON array of query strings.`;

  const prompt = `
Original Query: "${query}"
ICP Focus: ${icpModel.config.industries?.join(', ') || 'Various'}, ${icpModel.config.employeeRange || 'Various sizes'}, ${icpModel.config.geographies?.join(', ') || 'Global'}

Generate 5 alternative search queries that are slightly broader but still relevant:
`;

  try {
    const response = await this.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 5);
    }
    
    // Fallback if response isn't an array
    return this.generateDefaultAlternatives(originalQuery, icpModel);
  } catch (error) {
    console.error('Error generating alternative queries:', error);
    return this.generateDefaultAlternatives(originalQuery, icpModel);
  }
}

private generateDefaultAlternatives(originalQuery: string, icpModel: any): string[] {
  const alternatives = [];
  const query = originalQuery.toLowerCase();

  // Remove specific constraints
  if (query.includes('with') && query.includes('employees')) {
    alternatives.push(originalQuery.replace(/\swith\s\d+.*employees/, ' companies'));
  }
  
  // Broaden location
  if (query.includes('in') && (query.includes('city') || query.includes('specific location'))) {
    alternatives.push(originalQuery.replace(/\sin\s[a-zA-Z\s]+/, ''));
  }
  
  // Broaden industry
  if (query.includes('specific industry') || (query.match(/\b(saas|tech|fintech)\b/) && !query.includes('or'))) {
    const baseIndustry = icpModel.config.industries?.[0] || 'technology';
    alternatives.push(`Companies in the ${baseIndustry} space`);
  }
  
  // Remove funding constraints
  if (query.includes('funded') || query.includes('series')) {
    alternatives.push(originalQuery.replace(/\sthat raised.*funding/, ''));
  }
  
  // General broader version
  alternatives.push(`${icpModel.config.industries?.[0] || 'Technology'} companies with strong market presence`);
  
  return [...new Set(alternatives)].slice(0, 5); // Remove duplicates
}

// Enhanced query analysis method
async analyzeQueryIssues(query: string, icpModel: any): Promise<{
  issues: string[];
  recommendations: string[];
  confidence: number;
}> {
  const systemPrompt = `Analyze search queries for potential issues that might limit results. Identify:
1. Overly specific criteria
2. Rare combinations of attributes
3. Geographic limitations
4. Temporal constraints
5. Industry/technology specificity

Return JSON with issues array and recommendations array.`;

  const prompt = `
Query: "${query}"
ICP Model: ${JSON.stringify(icpModel.config, null, 2)}

Analyze potential issues and provide recommendations:
`;

  try {
    const response = await this.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    return {
      issues: parsed.issues || ['Query may be too specific for available data'],
      recommendations: parsed.recommendations || ['Try broadening one criteria at a time'],
      confidence: parsed.confidence || 0.7
    };
  } catch (error) {
    console.error('Error analyzing query issues:', error);
    return {
      issues: ['Unable to analyze query automatically'],
      recommendations: ['Try simplifying your search criteria'],
      confidence: 0.5
    };
  }
}
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
      return {};
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/api/tags`);
      return true;
    } catch (error) {
      return false;
    }
  }
  // In OllamaService.ts - Add enhanced summary method
  async generateSearchSummary(
    query: string, 
    icpModel: any, 
    companies: any[], 
    resultsCount: number
  ): Promise<string> {
    const systemPrompt = `You are a strategic B2B market intelligence analyst. Create insightful search summaries that highlight ICP matching and buying intent.`;

    // Calculate metrics based on your company structure
    const highQualityCount = companies.filter(c => (c.scoring_metrics?.fit_score?.score || 0) >= 85).length;
    const mediumQualityCount = companies.filter(c => {
      const score = c.scoring_metrics?.fit_score?.score || 0;
      return score >= 65 && score < 85;
    }).length;
    const lowQualityCount = companies.filter(c => (c.scoring_metrics?.fit_score?.score || 0) < 65).length;
    
    const averageFitScore = companies.length > 0 
      ? Math.round(companies.reduce((sum, c) => sum + (c.scoring_metrics?.fit_score?.score || 0), 0) / companies.length)
      : 0;

    // Intent analysis
    const highIntentCount = companies.filter(c => (c.scoring_metrics?.intent_score?.score || 0) >= 70).length;
    const averageIntentScore = companies.length > 0
      ? Math.round(companies.reduce((sum, c) => sum + (c.scoring_metrics?.intent_score?.score || 0), 0) / companies.length)
      : 0;

    // Industry analysis from your company data
    const industryAnalysis = companies.reduce((acc, company) => {
      const industry = company.business_classification?.industry?.primary?.type || 'Uncategorized';
      if (!acc[industry]) {
        acc[industry] = { count: 0, totalFitScore: 0, totalIntentScore: 0 };
      }
      acc[industry].count++;
      acc[industry].totalFitScore += company.scoring_metrics?.fit_score?.score || 0;
      acc[industry].totalIntentScore += company.scoring_metrics?.intent_score?.score || 0;
      return acc;
    }, {} as Record<string, any>);

    const topIndustries = Object.entries(industryAnalysis)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 4)
      .map(([industry, data]) => ({
        name: industry,
        count: data.count,
        avgFitScore: Math.round(data.totalFitScore / data.count),
        avgIntentScore: Math.round(data.totalIntentScore / data.count),
        concentration: Math.round((data.count / companies.length) * 100)
      }));

    // Company segmentation based on your data
    const segments = companies.reduce((acc, company) => {
      const size = company.firmographic_data?.employee_count?.exact || 0;
      const fitScore = company.scoring_metrics?.fit_score?.score || 0;
      const intentScore = company.scoring_metrics?.intent_score?.score || 0;
      
      // Size segmentation
      if (size > 1000) acc.enterprise = (acc.enterprise || 0) + 1;
      else if (size > 200) acc.midMarket = (acc.midMarket || 0) + 1;
      else acc.smb = (acc.smb || 0) + 1;
      
      // Quality segmentation
      if (fitScore >= 85 && intentScore >= 70) acc.hotProspects = (acc.hotProspects || 0) + 1;
      if (fitScore >= 75) acc.strongFit = (acc.strongFit || 0) + 1;
      if (intentScore >= 65) acc.highIntent = (acc.highIntent || 0) + 1;
      
      return acc;
    }, {} as Record<string, number>);

    // Geographic analysis from your company data
    const geographicAnalysis = companies.reduce((acc, company) => {
      const country = company.contact_info?.address?.country || 'Unknown';
      acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topCountries = Object.entries(geographicAnalysis)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([country, count]) => `${country} (${count})`)
      .join(', ');

    // Technology analysis from your company data
    const technologyAnalysis = companies.reduce((acc, company) => {
      const techs = company.technographic_data?.technology_stack || [];
      techs.forEach(tech => {
        acc[tech.name] = (acc[tech.name] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    const topTechnologies = Object.entries(technologyAnalysis)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([tech, count]) => tech)
      .join(', ');

    // Get strategic examples
    const strategicExamples = companies
      .sort((a, b) => {
        const aScore = (a.scoring_metrics?.fit_score?.score || 0) * 0.7 + (a.scoring_metrics?.intent_score?.score || 0) * 0.3;
        const bScore = (b.scoring_metrics?.fit_score?.score || 0) * 0.7 + (b.scoring_metrics?.intent_score?.score || 0) * 0.3;
        return bScore - aScore;
      })
      .slice(0, 3)
      .map(company => ({
        name: company.basic_info?.name,
        industry: company.business_classification?.industry?.primary?.type,
        employees: company.firmographic_data?.employee_count?.exact || company.firmographic_data?.employee_count?.range,
        location: company.contact_info?.address?.country,
        fitScore: company.scoring_metrics?.fit_score?.score,
        intentScore: company.scoring_metrics?.intent_score?.score,
        technologies: (company.technographic_data?.technology_stack || []).slice(0, 3).map((tech: any) => tech.name),
        hiringSignals: company.intent_signals?.hiring_signals?.job_postings?.length || 0
      }));

    // Calculate confidence metrics
    const matchConfidence = companies.length > 0 ? Math.round(
      ((segments.strongFit || 0) / companies.length) * 100
    ) : 0;

    const dataCompleteness = companies.length > 0 ? Math.round(
      (companies.filter(c => 
        c.basic_info?.name &&
        c.business_classification?.industry?.primary?.type &&
        c.scoring_metrics?.fit_score?.score !== undefined
      ).length / companies.length) * 100
    ) : 0;

    const prompt = `
SEARCH INTELLIGENCE REPORT

SEARCH CONTEXT:
- **Query**: "${query}"
- **ICP Model**: ${icpModel.modelName}
- **Target Industries**: ${icpModel.industries?.join(', ') || 'Any'}
- **Target Geography**: ${icpModel.geographies?.join(', ') || 'Any'}
- **Employee Range**: ${icpModel.employeeRange || 'Any'}
- **Results Analyzed**: ${resultsCount} companies

KEY METRICS:
- **Average Fit Score**: ${averageFitScore}/100
- **Average Intent Score**: ${averageIntentScore}/100
- **Data Completeness**: ${dataCompleteness}%

QUALITY DISTRIBUTION:
- **Excellent Matches** (85+ Fit): ${highQualityCount} companies
- **Good Prospects** (65-84 Fit): ${mediumQualityCount} companies  
- **Development Opportunities** (<65 Fit): ${lowQualityCount} companies

SEGMENT ANALYSIS:
- **Hot Prospects**: ${segments.hotProspects || 0} companies (high fit + high intent)
- **Strong ICP Fit**: ${segments.strongFit || 0} companies (75+ fit score)
- **High Intent**: ${segments.highIntent || 0} companies (65+ intent score)

MARKET COMPOSITION:
**Industry Breakdown**
${topIndustries.map(industry => 
  `• ${industry.name}: ${industry.count} companies · Fit ${industry.avgFitScore} · Intent ${industry.avgIntentScore}`
).join('\n')}

**Geographic Distribution**
- Primary countries: ${topCountries}

**Technology Landscape**
${topTechnologies ? `- Common technologies: ${topTechnologies}` : '- Limited technology data'}

TOP MATCHES:
${strategicExamples.map((company, index) => 
  `${index + 1}. **${company.name}** 
   ▸ ${company.industry} · ${company.employees} employees · ${company.location}
   ▸ Fit Score: ${company.fitScore}/100 · Intent: ${company.intentScore}/100
   ▸ Active Hiring: ${company.hiringSignals} job postings
   ${company.technologies.length > 0 ? `▸ Key Tech: ${company.technologies.join(', ')}` : ''}`
).join('\n\n')}

ICP ALIGNMENT INSIGHTS:
- **Industry Match**: ${icpModel.industries?.[0] ? `Targeting ${icpModel.industries[0]} sector` : 'Cross-industry search'}
- **Size Alignment**: ${icpModel.employeeRange ? `Focus on ${icpModel.employeeRange} companies` : 'All company sizes'}
- **Technology Requirements**: ${icpModel.mustHaveTech?.length ? `Must have ${icpModel.mustHaveTech.join(', ')}` : 'No specific tech requirements'}
- **Buying Triggers**: ${icpModel.buyingTriggers?.join(', ') || 'General growth signals'}

Provide a concise summary focusing on how well the search results match the ICP criteria and highlight the most promising companies based on fit and intent scores.`;

    try {
      const response = await this.generate(prompt, systemPrompt);
      return response;
    } catch (error) {
      console.error('Error generating search summary:', error);
      
      // Simple fallback summary
      return `**Search Summary**

**Search Query**: "${query}"
**Results**: ${resultsCount} companies analyzed

**ICP Alignment**:
- Average Fit Score: ${averageFitScore}/100
- Average Intent Score: ${averageIntentScore}/100
- ${highQualityCount} excellent matches (85+ fit score)

**Top Industries**: ${topIndustries.map(i => i.name).join(', ')}
**Company Segments**: ${segments.enterprise || 0} enterprise, ${segments.midMarket || 0} mid-market

The search returned ${resultsCount} companies with ${matchConfidence}% strong ICP alignment. ${highIntentCount > 0 ? `${highIntentCount} companies show high buying intent.` : ''}`;
    }
  }
  // Helper function to extract regions from locations
  private extractRegion(location: string): string {
    // Simple region extraction - enhance based on your location data structure
    const usStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
    
    if (location.includes('New York') || location.includes('NY')) return 'Northeast US';
    if (location.includes('California') || location.includes('CA')) return 'West US';
    if (location.includes('Texas') || location.includes('TX')) return 'South US';
    if (usStates.some(state => location.includes(state))) return 'US Other';
    if (location.includes('UK') || location.includes('United Kingdom')) return 'United Kingdom';
    if (location.includes('Germany') || location.includes('DE')) return 'DACH';
    
    return 'Global Other';
  }

private identifyCompanyStrengths(company: any, icpModel: any): string[] {
  const strengths = [];
  
  if ((company.icpScore || 0) > 80) strengths.push('Excellent ICP fit');
  if ((company.intentScore || 0) > 70) strengths.push('Strong buying signals');
  if (company.employees > 100) strengths.push('Established company');
  if (company.growthSignals && company.growthSignals.length > 2) strengths.push('High growth signals');
  
  return strengths.length > 0 ? strengths : ['Solid match based on available data'];
}

// Add this method to your OllamaService class


// Add this method to your OllamaService class

/**
 * Merges ICP model criteria (industries, geographies, employee range) with user query
 * Creates optimized Exa query under 200 characters
 */
async mergeICPWithUserQuery(
  userQuery: string,
  icpModel: any
): Promise<{
  structuredQuery: string;
  criteria: {
    industries?: string[];
    locations?: string[];
    employeeRange?: string;
  };
}> {
  try {
    // Extract ICP criteria
    const icpIndustries = icpModel.config.industries || [];
    const icpGeographies = icpModel.config.geographies || [];
    const icpEmployeeRange = icpModel.config.employeeRange;

    // Analyze user query to see what's already covered
    const userQueryLower = userQuery.toLowerCase();
    
    // Check what user already specified
    const userHasIndustry = icpIndustries.some((industry: string) => 
      userQueryLower.includes(industry.toLowerCase())
    );
    
    const userHasLocation = icpGeographies.some((geo: string) => 
      userQueryLower.includes(geo.toLowerCase()) || 
      this.hasLocationKeywords(userQueryLower)
    );
    
    const userHasSize = userQueryLower.includes('employee') || 
                       userQueryLower.match(/\d+\s*-\s*\d+/) || 
                       userQueryLower.match(/\d+\+/);

    // Build merged query parts
    const parts: string[] = [];
    
    // 1. Start with user query (clean it up)
    let cleanUserQuery = userQuery
      .replace(/\b(find|search|look for|companies|company)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleanUserQuery) {
      parts.push(cleanUserQuery);
    }
    
    // 2. Add ICP industry if not covered by user
    if (!userHasIndustry && icpIndustries.length > 0) {
      const primaryIndustry = icpIndustries[0];
      parts.push(primaryIndustry);
    }
    
    // 3. Add ICP geography if not covered by user
    if (!userHasLocation && icpGeographies.length > 0) {
      const primaryGeo = icpGeographies[0];
      parts.push(`in ${primaryGeo}`);
    }
    
    // 4. Add ICP employee range if not covered by user
    if (!userHasSize && icpEmployeeRange) {
      parts.push(`with ${icpEmployeeRange} employees`);
    }

    // Construct final query
    let mergedQuery = parts.join(' ');
    
    // Ensure it's a proper sentence and under 200 chars
    mergedQuery = this.optimizeQueryLength(mergedQuery);
    
    // Extract criteria from final merged query
    const criteria = this.extractCriteriaFromMergedQuery(mergedQuery, icpIndustries, icpGeographies, icpEmployeeRange);
    
    return {
      structuredQuery: mergedQuery,
      criteria
    };
    
  } catch (error) {
    console.error('Error merging ICP with user query:', error);
    
    // Fallback: Use user query as-is
    return {
      structuredQuery: this.optimizeQueryLength(userQuery),
      criteria: {}
    };
  }
}

/**
 * Optimize query length to stay under 200 characters
 */
private optimizeQueryLength(query: string): string {
  if (query.length <= 200) return query;
  
  // Remove unnecessary words and shorten
  let optimized = query
    .replace(/\b(that|which|who|and|the|a|an)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (optimized.length <= 200) return optimized;
  
  // Truncate and add ellipsis if still too long
  return optimized.substring(0, 197) + '...';
}

/**
 * Extract criteria from the merged query
 */
private extractCriteriaFromMergedQuery(
  query: string, 
  icpIndustries: string[],
  icpGeographies: string[], 
  icpEmployeeRange?: string
): {
  industries?: string[];
  locations?: string[];
  employeeRange?: string;
} {
  const criteria: any = {};
  const queryLower = query.toLowerCase();
  
  // Extract industries that match ICP industries
  const foundIndustries = icpIndustries.filter(industry => 
    queryLower.includes(industry.toLowerCase())
  );
  if (foundIndustries.length > 0) {
    criteria.industries = foundIndustries;
  }
  
  // Extract locations that match ICP geographies
  const foundLocations = icpGeographies.filter(geo => 
    queryLower.includes(geo.toLowerCase())
  );
  if (foundLocations.length > 0) {
    criteria.locations = foundLocations;
  }
  
  // Extract employee range
  const employeeMatch = query.match(/with\s+(\d+\+?|\d+\s*-\s*\d+)\s+employees/i);
  if (employeeMatch) {
    criteria.employeeRange = employeeMatch[1].replace(/\s+/g, '');
  } else if (icpEmployeeRange && queryLower.includes('employee')) {
    criteria.employeeRange = icpEmployeeRange;
  }
  
  return criteria;
}

/**
 * Check if user query contains location keywords
 */
private hasLocationKeywords(query: string): boolean {
  const locationIndicators = [' in ', ' based in ', ' located in ', ' from ', ' based ', 'location:'];
  return locationIndicators.some(indicator => query.includes(indicator));
}

async extractCompanyFromCoreSignalData(
  coreSignalData: any
): Promise<Company | null> {
  const systemPrompt = `You are a data extraction and normalization expert specializing in CoreSignal API responses.
  Extract company information from CoreSignal data and transform it into a standardized company format.
  Focus on accuracy and completeness while handling missing fields gracefully.`;

  const prompt = `
CORE SIGNAL COMPANY DATA:
${JSON.stringify(coreSignalData, null, 2)}

STANDARDIZED COMPANY FORMAT REQUIREMENTS:
{
  "company_id": "string (required - use source_id or id from CoreSignal)",
  "name": "string (required - use company_name)",
  "domain": "string (required - extract from website or generate from name)",
  "website": "string (optional - use website field)",
  "logo_url": "string (optional - use company_logo_url)",
  "description": "string (optional - use description field)",
  "founded_year": "number (optional - use founded_year)",
  "location": {
    "city": "string (extract from hq_location or hq_city)",
    "country": "string (use hq_country)", 
    "country_code": "string (use hq_country_iso2)"
  },
  "contact": {
    "email": "string (extract from company_emails)",
    "phone": "string (extract from company_phone_numbers)"
  },
  "social_profiles": {
    "linkedin": "string (use linkedin_url)",
    "twitter": "string (use first twitter_url if array)",
    "facebook": "string (use first facebook_url if array)",
    "instagram": "string (use first instagram_url if array)",
    "crunchbase": "string (use crunchbase_url)"
  },
  "industry": "string[] (required - use industry field as array)",
  "business_model": "B2B | B2C | B2B2C | SaaS | E-commerce | Service (infer from is_b2b, description)",
  "target_market": "SMB | Mid-Market | Enterprise | Startup (infer from size_range, employee_count)",
  "ownership_type": "Public | Private | Subsidiary (use is_public, type fields)",
  "employee_count": "number (use employees_count)",
  "revenue_estimated": "number (use revenue_annual if available)",
  "funding_stage": "Bootstrapped | Seed | Series A | Series B | Series C | Public (use last_funding_round_name)",
  "total_funding": "number (use last_funding_round_amount_raised)",
  "technologies": "string[] (use technologies_used array)",
  "intent_signals": [{
    "name": "string (infer from company_updates, active_job_postings, employees_count_change)",
    "detected_date": "Date (use date from relevant signals)",
    "confidence": "number (calculate based on signal strength)"
  }],
  "relationships": {
    "customers": "string[] (extract from description, updates)",
    "partners": "string[] (extract from description, updates)", 
    "competitors": "string[] (use competitors array)"
  }
}

CORE SIGNAL SPECIFIC MAPPING GUIDELINES:
1. company_id: Use source_id if available, otherwise use id
2. domain: Extract from website field, or generate from company_name by lowercasing and sanitizing
3. industry: Always return as array - split industry string if needed
4. employee_count: Use employees_count (current) or employees_count_inferred
5. business_model: 
   - If is_b2b is true → "B2B"
   - If description contains "SaaS", "software" → "SaaS"  
   - If description contains "e-commerce", "online store" → "E-commerce"
   - If description contains "service", "consulting" → "Service"
   - Otherwise infer from industry
6. target_market:
   - If employee_count < 50 → "SMB"
   - If employee_count 50-500 → "Mid-Market" 
   - If employee_count > 500 → "Enterprise"
   - If description contains "startup" → "Startup"
7. ownership_type:
   - If is_public is true → "Public"
   - If type contains "Subsidiary" → "Subsidiary"
   - Otherwise → "Private"
8. funding_stage: Map last_funding_round_name to closest enum value
9. intent_signals: Look for hiring signals (active_job_postings_count > 0), growth signals (positive employees_count_change), activity signals (recent company_updates)
10. technologies: Extract technology names from technologies_used array

Return ONLY the JSON object in the exact format above, no additional text or explanation.
`;

  try {
    const response = await this.generate(prompt, systemPrompt);
    ////console.log("Extracting company data from CoreSignal response:");
    ////console.log(response);
    
    const extractedCompany = this.parseJSONResponse(response);
    
    // Apply post-processing and validation
    return this.validateAndCleanCompany(extractedCompany);
  } catch (error) {
    console.error(`Error extracting company from CoreSignal data:`, error);
    return null;
  }
}

// Helper method for validation and cleaning
private validateAndCleanCompany(company: any): Company {
  // Ensure required fields
  if (!company.company_id) {
    company.company_id = `coresignal-${Date.now()}`;
  }
  
  if (!company.name) {
    throw new Error('Company name is required');
  }
  
  if (!company.domain) {
    // Generate domain from name as fallback
    company.domain = company.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
  }
  
  // Ensure industry is always an array
  if (company.industry && !Array.isArray(company.industry)) {
    company.industry = [company.industry];
  }
  
  // Convert string numbers to actual numbers
  if (company.employee_count && typeof company.employee_count === 'string') {
    company.employee_count = parseInt(company.employee_count);
  }
  
  if (company.founded_year && typeof company.founded_year === 'string') {
    company.founded_year = parseInt(company.founded_year);
  }
  
  if (company.total_funding && typeof company.total_funding === 'string') {
    company.total_funding = parseFloat(company.total_funding);
  }
  
  // Ensure arrays exist
  company.technologies = company.technologies || [];
  company.intent_signals = company.intent_signals || [];
  
  // Ensure relationships object exists
  company.relationships = company.relationships || {
    customers: [],
    partners: [],
    competitors: []
  };
  
  return company as Company;
}

}

export const ollamaService = new OllamaService();