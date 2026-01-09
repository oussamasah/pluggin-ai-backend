// ollama-intent-scoring-service.ts
import { ollamaService } from './OllamaService';
import { openRouterService } from '../utils/OpenRouterService.js';
import { ICPModel, Company } from '../core/types.js';
import { ExploriumEvent } from './ExploriumService.js';

// ==================== INTERFACES ====================

interface SourceDetail {
  url: string;
  title: string;
  date: string;
  confidence: number;
  source_type: string;
  snippet?: string;
}

interface EvidenceItem {
  source: string;
  url: string;
  date: string;
  summary: string;
  confidence: number;
  data_source: string;
}

interface SignalResult {
  signal: string;
  evidence: EvidenceItem[];
  found: boolean;
  reasoning: string;
}

interface InputResponse {
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

interface ScoringResult {
  score: number;
  reason: string;
  factors: Array<{
    signal: string;
    score: number;
    impact: string;
    evidence_quality: string;
    confidence?: number;
    original_score?: number;
  }>;
  confidence: 'very-high' | 'high' | 'medium' | 'low';
  strategic_insights?: string[];
  timing_recommendation?: string;
  risk_factors?: string[];
}

// ==================== OLLAMA SCORING SERVICE ====================

class OllamaIntentScoringService {
  private readonly SCORING_SYSTEM_PROMPT = `You are an expert business intelligence analyst specializing in intent scoring. 
Your task is to analyze company signals and provide accurate intent scoring with detailed reasoning.

SCORING FRAMEWORK:
- 0-20: No Intent (No significant signals, minimal activity)
- 21-40: Low Intent (Weak signals, limited evidence)
- 41-60: Moderate Intent (Some validated signals, emerging patterns)
- 61-80: High Intent (Strong signals, clear business momentum)
- 81-100: Very High Intent (Multiple strong signals, urgent buying readiness)

KEY FACTORS TO CONSIDER:
1. Signal Strength: Quality and quantity of evidence
2. Recency: How recent are the signals (last 90 days optimal)
3. Business Impact: Strategic importance of each signal
4. Pattern Consistency: Multiple complementary signals
5. Source Credibility: Reliability of data sources

CRITICAL BUSINESS SIGNALS:
- Funding Rounds (High Impact): Indicates capital availability and growth plans
- New Product Launches (High Impact): Suggests infrastructure and tooling needs
- Hiring Sprees (Medium Impact): Indicates team expansion and tool scaling
- Partnerships (Medium Impact): Shows business development activity
- Office Expansions (Low-Medium Impact): Geographic growth signals

ALWAYS return valid JSON in this exact format:
{
  "score": number (0-100),
  "reason": "detailed explanation of scoring rationale",
  "factors": [
    {
      "signal": "signal_name",
      "score": number (0-100),
      "impact": "high|medium|low",
      "evidence_quality": "excellent|good|fair|poor"
    }
  ],
  "confidence": "very-high|high|medium|low",
  "strategic_insights": ["array of strategic insights"],
  "timing_recommendation": "immediate|short-term|long-term|monitor",
  "risk_factors": ["array of potential risks or limitations"]
}`;

  /**
   * Transform input response to EnhancedIntentResponse format
   */
  private transformInputToEnhancedResponse(input: InputResponse): EnhancedIntentResponse {
    if (!input) {
      return this.createDefaultResponse();
    }

    const evaluated_signals: EnhancedSignalResult[] = input.results.map(result => {
      // Calculate score based on evidence quality and quantity
      const score = this.calculateSignalScore(result);
      
      // Transform evidence to sources format
      const sources: SourceDetail[] = result.evidence.map(evidence => ({
        url: evidence.url,
        title: evidence.source,
        date: evidence.date,
        confidence: evidence.confidence,
        source_type: evidence.data_source,
        snippet: evidence.summary
      }));

      return {
        signal: result.signal,
        score: score,
        reason: result.reasoning,
        sources: sources.length > 0 ? sources : undefined
      };
    });

    // Calculate overall score based on signals
    const final_intent_score = this.calculateOverallScore(evaluated_signals);
    const intent_level = this.determineIntentLevel(final_intent_score);

    return {
      company_name: input.company || 'Unknown Company',
      industry: this.inferIndustryFromSignals(evaluated_signals),
      evaluated_signals: evaluated_signals,
      final_intent_score: final_intent_score,
      intent_level: intent_level,
      overall_reasoning: this.generateOverallReasoning(evaluated_signals, input.summary),
      metadata: {
        total_sources: input.summary?.total_signals || 0,
        analysis_date: input.analysis_date || new Date().toISOString().split('T')[0],
        data_sources_used: input.summary?.data_sources_used || []
      }
    };
  }

  /**
   * Calculate signal score based on evidence
   */
  private calculateSignalScore(result: SignalResult): number {
    if (!result.found || result.evidence.length === 0) {
      return 0;
    }

    let baseScore = 0;

    // Base score for having evidence
    baseScore += 30;

    // Score based on evidence quantity
    if (result.evidence.length >= 5) baseScore += 25;
    else if (result.evidence.length >= 3) baseScore += 20;
    else if (result.evidence.length >= 1) baseScore += 15;

    // Score based on evidence recency
    const recentEvidence = result.evidence.filter(evidence => this.isRecent(evidence.date));
    if (recentEvidence.length >= 3) baseScore += 20;
    else if (recentEvidence.length >= 1) baseScore += 10;

    // Score based on evidence confidence
    const avgConfidence = result.evidence.reduce((sum, evidence) => sum + evidence.confidence, 0) / result.evidence.length;
    baseScore += avgConfidence * 15;

    // Signal type multiplier
    const signalMultiplier = this.getSignalMultiplier(result.signal);
    baseScore *= signalMultiplier;

    return Math.min(100, Math.round(baseScore));
  }

  /**
   * Get multiplier based on signal importance
   */
  private getSignalMultiplier(signal: string): number {
    const highImpactSignals = ['new_funding_round', 'merger_and_acquisitions', 'new_product'];
    const mediumImpactSignals = ['hiring_in_engineering_department', 'expansion', 'new_partnership'];
    
    if (highImpactSignals.includes(signal)) return 1.3;
    if (mediumImpactSignals.includes(signal)) return 1.1;
    return 1.0;
  }

  /**
   * Calculate overall score from signals
   */
  private calculateOverallScore(signals: EnhancedSignalResult[]): number {
    if (signals.length === 0) return 0;

    const validSignals = signals.filter(signal => signal.score > 0);
    if (validSignals.length === 0) return 0;

    // Weighted average based on signal impact
    const totalWeight = validSignals.reduce((sum, signal) => {
      return sum + this.getSignalMultiplier(signal.signal);
    }, 0);

    const weightedScore = validSignals.reduce((sum, signal) => {
      return sum + (signal.score * this.getSignalMultiplier(signal.signal));
    }, 0);

    return Math.min(100, Math.round(weightedScore / totalWeight));
  }

  /**
   * Determine intent level from score
   */
  private determineIntentLevel(score: number): string {
    if (score >= 81) return 'Very High Intent';
    if (score >= 61) return 'High Intent';
    if (score >= 41) return 'Moderate Intent';
    if (score >= 21) return 'Low Intent';
    return 'No Intent';
  }

  /**
   * Infer industry from signals (you can enhance this)
   */
  private inferIndustryFromSignals(signals: EnhancedSignalResult[]): string {
    // Default to Fintech if we see funding signals, otherwise unknown
    const hasFunding = signals.some(signal => 
      signal.signal === 'new_funding_round' && signal.score > 50
    );
    return hasFunding ? 'Fintech' : 'Technology';
  }

  /**
   * Generate overall reasoning
   */
  private generateOverallReasoning(signals: EnhancedSignalResult[], summary: any): string {
    const strongSignals = signals.filter(signal => signal.score >= 60);
    const totalSources = signals.reduce((sum, signal) => sum + (signal.sources?.length || 0), 0);

    if (strongSignals.length === 0) {
      return 'Limited evidence available for reliable intent assessment.';
    }

    return `Analysis based on ${strongSignals.length} strong signals with ${totalSources} total sources. ${summary?.confidence_score ? `Overall confidence: ${(summary.confidence_score * 100).toFixed(1)}%` : ''}`;
  }

  /**
   * Validate and sanitize input response
   */
  private validateAndSanitizeResponse(response: any): EnhancedIntentResponse {
    if (!response) {
      console.warn('⚠️ Response is null or undefined, creating default response');
      return this.createDefaultResponse();
    }

    // Check if it's already in EnhancedIntentResponse format
    if (response.evaluated_signals !== undefined && response.company_name !== undefined) {
      // It's already in the correct format, just sanitize
      return this.sanitizeEnhancedResponse(response);
    }

    // Transform from input format to EnhancedIntentResponse
    try {
      return this.transformInputToEnhancedResponse(response);
    } catch (error: any) {
      console.error('❌ Error transforming input response:', error);
      return this.createDefaultResponse();
    }
  }

  /**
   * Sanitize existing EnhancedIntentResponse
   */
  private sanitizeEnhancedResponse(response: any): EnhancedIntentResponse {
      const sanitized: EnhancedIntentResponse = {
      company_name: response.company_name || 'Unknown Company',
      industry: response.industry || 'Unknown Industry',
      evaluated_signals: Array.isArray(response.evaluated_signals) 
        ? response.evaluated_signals.filter((signal: any) => 
            signal && typeof signal === 'object' && signal.signal
          ).map((signal: any) => ({
            signal: signal.signal || 'unknown_signal',
            score: typeof signal.score === 'number' ? Math.max(0, Math.min(100, signal.score)) : 0,
            reason: signal.reason || 'No reason provided',
            sources: Array.isArray(signal.sources) ? signal.sources.filter((source: any) => 
              source && typeof source === 'object' && source.source_type
            ) : []
          }))
        : [],
      final_intent_score: typeof response.final_intent_score === 'number' 
        ? Math.max(0, Math.min(100, response.final_intent_score)) 
        : 0,
      intent_level: response.intent_level || 'No Intent',
      overall_reasoning: response.overall_reasoning || 'No reasoning provided'
    };

    if (response.metadata) {
      sanitized.metadata = {
        total_sources: typeof response.metadata.total_sources === 'number' ? response.metadata.total_sources : 0,
        analysis_date: response.metadata.analysis_date || new Date().toISOString().split('T')[0],
        data_sources_used: Array.isArray(response.metadata.data_sources_used) 
          ? response.metadata.data_sources_used 
          : []
      };
    }

    console.log(`✅ Sanitized response: ${sanitized.evaluated_signals.length} valid signals for ${sanitized.company_name}`);
    return sanitized;
  }

  /**
   * Create default response for error cases
   */
  private createDefaultResponse(): EnhancedIntentResponse {
    return {
      company_name: 'Unknown Company',
      industry: 'Unknown Industry',
      evaluated_signals: [],
      final_intent_score: 0,
      intent_level: 'No Intent',
      overall_reasoning: 'Insufficient data for analysis',
      metadata: {
        total_sources: 0,
        analysis_date: new Date().toISOString().split('T')[0],
        data_sources_used: []
      }
    };
  }

  /**
   * AI-Powered intent scoring using Ollama
   */
  async calculateIntentScore(response: any): Promise<ScoringResult> {
    console.log('🧠 Starting AI-powered scoring analysis...');
    
    try {
      // Step 1: Validate and transform input
      const enhancedResponse = this.validateAndSanitizeResponse(response);
      
      // Step 2: Log debug information
      this.logDebugInfo(enhancedResponse);
      
      // Step 3: Check if we have enough data for AI analysis
      if (!this.hasSufficientDataForAnalysis(enhancedResponse)) {
        console.log('⚠️ Insufficient data for AI analysis, using fallback scoring');
        return this.fallbackScoring(enhancedResponse);
      }

      console.log(`📊 Analyzing ${enhancedResponse.evaluated_signals.length} signals for ${enhancedResponse.company_name}`);

      // Step 4: Build and execute AI analysis
      const analysisPrompt = this.buildAnalysisPrompt(enhancedResponse);
      const aiResponse = await ollamaService.generate(analysisPrompt, this.SCORING_SYSTEM_PROMPT);
      
      // Step 5: Parse and validate AI response
      const parsedResult = this.parseAIResponse(aiResponse);
      
      // Step 6: Apply business rules and return final result
      return this.validateAndEnhanceScore(parsedResult, enhancedResponse);
      
    } catch (error) {
      console.error('❌ AI scoring failed:', error);
      const safeResponse = this.validateAndSanitizeResponse(response);
      return this.fallbackScoring(safeResponse);
    }
  }

  /**
   * Log debug information about the response
   */
  private logDebugInfo(response: EnhancedIntentResponse): void {
    console.log('🔍 Debug Information:');
    console.log(`   Company: ${response.company_name}`);
    console.log(`   Industry: ${response.industry}`);
    console.log(`   Signals Count: ${response.evaluated_signals.length}`);
    console.log(`   Original Score: ${response.final_intent_score}`);
    console.log(`   Intent Level: ${response.intent_level}`);
    
    const totalSources = response.evaluated_signals.reduce((sum, signal) => 
      sum + (signal.sources?.length || 0), 0
    );
    console.log(`   Total Sources: ${totalSources}`);
    
    const signalsWithSources = response.evaluated_signals.filter(s => 
      s.sources && s.sources.length > 0
    ).length;
    console.log(`   Signals with Sources: ${signalsWithSources}`);

    // Log signal details
    response.evaluated_signals.forEach(signal => {
      console.log(`   - ${signal.signal}: ${signal.score}/100 (${signal.sources?.length || 0} sources)`);
    });
  }

  /**
   * Check if we have sufficient data for AI analysis
   */
  private hasSufficientDataForAnalysis(response: EnhancedIntentResponse): boolean {
    if (response.evaluated_signals.length === 0) {
      console.log('❌ No signals to analyze');
      return false;
    }

    const totalSources = response.evaluated_signals.reduce((sum, signal) => 
      sum + (signal.sources?.length || 0), 0
    );

    if (totalSources === 0) {
      console.log('❌ No source data available');
      return false;
    }

    // Check if we have at least one signal with decent evidence
    const strongSignals = response.evaluated_signals.filter(signal => 
      signal.score >= 40 && signal.sources && signal.sources.length > 0
    );

    if (strongSignals.length === 0) {
      console.log('❌ No strong signals with evidence');
      return false;
    }

    return true;
  }

  /**
   * Build comprehensive analysis prompt for Ollama
   */
  private buildAnalysisPrompt(response: EnhancedIntentResponse): string {
    const signalsAnalysis = response.evaluated_signals.map(signal => {
      const sourcesInfo = signal.sources && signal.sources.length > 0 ? `
      EVIDENCE SOURCES: ${signal.sources.length}
      SOURCE TYPES: ${[...new Set(signal.sources.map(s => s.source_type))].join(', ')}
      RECENT SOURCES: ${signal.sources.filter(s => this.isRecent(s.date)).length}
      AVERAGE CONFIDENCE: ${(signal.sources.reduce((sum, s) => sum + s.confidence, 0) / signal.sources.length).toFixed(2)}
      KEY EVIDENCE: 
      ${signal.sources.slice(0, 3).map(s => 
        `• ${s.source_type}: "${s.snippet?.substring(0, 120) || s.title || 'No snippet'}" (${s.date}, ${s.confidence} conf)`
      ).join('\n      ')}` : '      EVIDENCE: No sources available';

      return `
SIGNAL: ${signal.signal}
RAW SCORE: ${signal.score}/100
REASON: ${signal.reason}
${sourcesInfo}
      `;
    }).join('\n');

    return `
COMPANY ANALYSIS REQUEST

COMPANY: ${response.company_name}
INDUSTRY: ${response.industry}
ANALYSIS DATE: ${response.metadata?.analysis_date || 'Unknown'}
TOTAL DATA SOURCES: ${response.metadata?.total_sources || 'Unknown'}
DATA SOURCES USED: ${response.metadata?.data_sources_used?.join(', ') || 'Unknown'}

SIGNALS ANALYSIS:
${signalsAnalysis}

PREVIOUS ASSESSMENT:
Overall Score: ${response.final_intent_score}/100
Intent Level: ${response.intent_level}
Reasoning: ${response.overall_reasoning}

YOUR TASK:
1. Re-analyze all signals with their evidence quality
2. Calculate a comprehensive intent score (0-100) 
3. Evaluate each signal's business impact and evidence quality
4. Determine overall confidence level
5. Provide strategic insights and timing recommendations
6. Identify any risk factors or data limitations

Consider business context, signal recency, source credibility, and pattern consistency.

Return only valid JSON in the specified format.`;
  }

  /**
   * Parse and validate AI response
   */
  private parseAIResponse(aiResponse: string): any {
    try {
      if (!aiResponse || typeof aiResponse !== 'string') {
        throw new Error('AI response is empty or not a string');
      }

      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Comprehensive validation
      if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 100) {
        throw new Error(`Invalid score in AI response: ${parsed.score}`);
      }
      
      if (!parsed.reason || typeof parsed.reason !== 'string') {
        throw new Error('Missing or invalid reason in AI response');
      }
      
      if (!Array.isArray(parsed.factors)) {
        throw new Error('Factors must be an array in AI response');
      }

      // Validate each factor
      parsed.factors.forEach((factor: any, index: number) => {
        if (!factor.signal || typeof factor.signal !== 'string') {
          throw new Error(`Invalid signal in factor ${index}`);
        }
        if (typeof factor.score !== 'number' || factor.score < 0 || factor.score > 100) {
          throw new Error(`Invalid score in factor ${index}: ${factor.score}`);
        }
      });

      console.log('✅ AI response parsed and validated successfully');
      return parsed;

    } catch (error) {
      console.error('❌ Failed to parse AI scoring response:', error);
      throw new Error(`AI response parsing failed: ${error.message}`);
    }
  }

  /**
   * Validate and enhance the AI-generated score
   */
  private validateAndEnhanceScore(aiResult: any, originalResponse: EnhancedIntentResponse): ScoringResult {
    try {
      // Apply business logic validation
      const validatedScore = this.applyBusinessRules(aiResult.score, originalResponse);
      
      // Enhance factors with additional metadata
      const enhancedFactors = aiResult.factors.map((factor: any) => {
        const originalSignal = originalResponse.evaluated_signals.find(s => s.signal === factor.signal);
        return {
          signal: factor.signal,
          score: factor.score,
          impact: factor.impact || 'medium',
          evidence_quality: factor.evidence_quality || 'fair',
          original_score: originalSignal?.score,
          confidence: originalSignal?.sources ? 
            (originalSignal.sources.reduce((sum, s) => sum + s.confidence, 0) / originalSignal.sources.length) : 0
        };
      });

      const result: ScoringResult = {
        score: validatedScore,
        reason: aiResult.reason || 'No reasoning provided by AI',
        factors: enhancedFactors,
        confidence: this.validateConfidence(aiResult.confidence),
        strategic_insights: Array.isArray(aiResult.strategic_insights) ? aiResult.strategic_insights : [],
        timing_recommendation: this.validateTiming(aiResult.timing_recommendation),
        risk_factors: Array.isArray(aiResult.risk_factors) ? aiResult.risk_factors : []
      };

      console.log(`🎯 AI Scoring Complete: ${result.score}/100 with ${result.confidence} confidence`);
      
      return result;

    } catch (error: any) {
      console.error('❌ Error enhancing AI score:', error);
      throw new Error(`Score enhancement failed: ${error.message}`);
    }
  }

  /**
   * Validate confidence level
   */
  private validateConfidence(confidence: string): 'very-high' | 'high' | 'medium' | 'low' {
    const validConfidences = ['very-high', 'high', 'medium', 'low'];
    return validConfidences.includes(confidence) ? confidence as any : 'medium';
  }

  /**
   * Validate timing recommendation
   */
  private validateTiming(timing: string): string {
    const validTimings = ['immediate', 'short-term', 'long-term', 'monitor'];
    return validTimings.includes(timing) ? timing : 'monitor';
  }

  /**
   * Apply business rules to validate and adjust AI score
   */
  private applyBusinessRules(aiScore: number, response: EnhancedIntentResponse): number {
    let adjustedScore = aiScore;
    const adjustments: string[] = [];

    // Rule 1: Penalize if no sources for high-scoring signals
    const signalsWithoutSources = response.evaluated_signals.filter(
      s => s.score > 50 && (!s.sources || s.sources.length === 0)
    );
    if (signalsWithoutSources.length > 0) {
      const penalty = signalsWithoutSources.length * 8;
      adjustedScore -= penalty;
      adjustments.push(`Penalty: ${signalsWithoutSources.length} signals without sources (-${penalty})`);
    }

    // Rule 2: Bonus for multiple recent sources
    const recentSignals = response.evaluated_signals.filter(
      s => s.sources && s.sources.some(source => this.isRecent(source.date))
    );
    if (recentSignals.length >= 2) {
      adjustedScore += 10;
      adjustments.push(`Bonus: ${recentSignals.length} recent signals (+10)`);
    }

    // Rule 3: Bonus for diverse source types
    const allSources = response.evaluated_signals.flatMap(s => s.sources || []);
    const uniqueSourceTypes = new Set(allSources.map(s => s.source_type));
    if (uniqueSourceTypes.size >= 3) {
      adjustedScore += 5;
      adjustments.push(`Bonus: ${uniqueSourceTypes.size} unique source types (+5)`);
    }

    // Rule 4: Strong negative signals penalty
    const negativeSignals = response.evaluated_signals.filter(s => 
      s.signal.includes('decrease') || s.signal.includes('cost_cutting') || s.signal.includes('layoff')
    );
    if (negativeSignals.length > 0) {
      const penalty = negativeSignals.length * 15;
      adjustedScore -= penalty;
      adjustments.push(`Penalty: ${negativeSignals.length} negative signals (-${penalty})`);
    }

    // Rule 5: Bonus for complementary signal patterns
    const hasFundingAndHiring = response.evaluated_signals.some(s => s.signal === 'new_funding_round') &&
                               response.evaluated_signals.some(s => s.signal.includes('hiring'));
    if (hasFundingAndHiring) {
      adjustedScore += 12;
      adjustments.push('Bonus: Funding + Hiring pattern detected (+12)');
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(adjustedScore)));
    
    if (adjustments.length > 0) {
      console.log(`📈 Score adjustments: ${aiScore} → ${finalScore}`);
      adjustments.forEach(adjustment => console.log(`   ${adjustment}`));
    }
    
    return finalScore;
  }

  /**
   * Check if a source is recent (within 90 days)
   */
  private isRecent(dateString: string): boolean {
    try {
      if (!dateString) return false;
      
      const sourceDate = new Date(dateString);
      if (isNaN(sourceDate.getTime())) return false;
      
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      return sourceDate >= ninetyDaysAgo;
    } catch {
      return false;
    }
  }

  /**
   * Fallback scoring when AI fails
   */
  private fallbackScoring(response: EnhancedIntentResponse): ScoringResult {
    console.log('🔄 Using fallback scoring algorithm...');

    const baseScore = response.final_intent_score || 0;
    const signalsWithEvidence = response.evaluated_signals.filter(s => 
      s?.sources && Array.isArray(s.sources) && s.sources.length > 0
    );
    
    // Enhanced scoring logic
    let enhancedScore = baseScore;
    
    // Bonus for evidence quality
    if (signalsWithEvidence.length > 0) {
      enhancedScore += signalsWithEvidence.length * 3;
    }
    
    // Bonus for recent evidence
    const recentSignals = signalsWithEvidence.filter(s => 
      s.sources!.some(source => this.isRecent(source.date))
    );
    if (recentSignals.length > 0) {
      enhancedScore += recentSignals.length * 2;
    }

    // Calculate confidence based on evidence quality
    let confidence: 'very-high' | 'high' | 'medium' | 'low' = 'medium';
    const totalSources = signalsWithEvidence.reduce((sum, s) => sum + s.sources!.length, 0);
    
    if (totalSources >= 8) confidence = 'very-high';
    else if (totalSources >= 5) confidence = 'high';
    else if (totalSources >= 2) confidence = 'medium';
    else confidence = 'low';

    const factors = response.evaluated_signals.map(signal => ({
      signal: signal.signal || 'unknown_signal',
      score: signal.score || 0,
      impact: this.determineImpact(signal),
      evidence_quality: this.determineEvidenceQuality(signal),
      confidence: signal.sources && signal.sources.length > 0 ? 
        (signal.sources.reduce((sum, s) => sum + s.confidence, 0) / signal.sources.length) : 0,
      original_score: signal.score
    }));

    return {
      score: Math.min(100, Math.max(0, enhancedScore)),
      reason: `Fallback analysis: ${response.overall_reasoning}. Based on ${signalsWithEvidence.length} signals with evidence from ${totalSources} total sources.`,
      factors: factors,
      confidence: confidence,
      strategic_insights: this.generateFallbackInsights(response),
      timing_recommendation: this.determineTiming(enhancedScore),
      risk_factors: this.identifyFallbackRisks(response)
    };
  }

  private determineImpact(signal: EnhancedSignalResult): string {
    if (!signal || !signal.signal) return 'low';
    
    const highImpactSignals = ['new_funding_round', 'merger_and_acquisitions', 'new_product'];
    const mediumImpactSignals = ['hiring_in_engineering_department', 'expansion', 'new_partnership'];
    
    if (highImpactSignals.includes(signal.signal)) return 'high';
    if (mediumImpactSignals.includes(signal.signal)) return 'medium';
    return 'low';
  }

  private determineEvidenceQuality(signal: EnhancedSignalResult): string {
    if (!signal?.sources || !Array.isArray(signal.sources) || signal.sources.length === 0) {
      return 'poor';
    }
    
    const avgConfidence = signal.sources.reduce((sum, s) => sum + s.confidence, 0) / signal.sources.length;
    const recentSources = signal.sources.filter(s => this.isRecent(s.date)).length;

    if (signal.sources.length >= 3 && avgConfidence >= 0.8 && recentSources >= 2) return 'excellent';
    if (signal.sources.length >= 2 && avgConfidence >= 0.7) return 'good';
    if (signal.sources.length >= 1 && avgConfidence >= 0.6) return 'fair';
    return 'poor';
  }

  private generateFallbackInsights(response: EnhancedIntentResponse): string[] {
    const insights: string[] = [];
    const strongSignals = response.evaluated_signals.filter(s => s.score >= 70);

    if (strongSignals.some(s => s.signal === 'new_funding_round')) {
      insights.push('Recent funding suggests capital availability for new investments - ideal timing for outreach');
    }

    if (strongSignals.some(s => s.signal.includes('hiring'))) {
      insights.push('Team expansion indicates growth phase and potential infrastructure needs');
    }

    if (strongSignals.some(s => s.signal === 'new_product')) {
      insights.push('Product launch may create immediate need for complementary solutions and tools');
    }

    if (response.evaluated_signals.filter(s => s.score >= 60).length >= 2) {
      insights.push('Multiple strong signals suggest coordinated business development efforts');
    }

    // Industry-specific insights
    if (response.industry.toLowerCase().includes('fintech')) {
      insights.push('Fintech companies typically invest in security and compliance tools post-funding');
    }
    if (response.industry.toLowerCase().includes('saas')) {
      insights.push('SaaS companies often scale their martech stack during growth phases');
    }

    return insights.length > 0 ? insights.slice(0, 4) : ['Limited insights available due to insufficient data'];
  }

  private determineTiming(score: number): string {
    if (score >= 80) return 'immediate';
    if (score >= 60) return 'short-term';
    if (score >= 40) return 'long-term';
    return 'monitor';
  }

  private identifyFallbackRisks(response: EnhancedIntentResponse): string[] {
    const risks: string[] = [];
    
    const signalsWithoutSources = response.evaluated_signals.filter(s => 
      !s.sources || !Array.isArray(s.sources) || s.sources.length === 0
    );
    if (signalsWithoutSources.length > 0) {
      risks.push(`${signalsWithoutSources.length} signals lack source evidence`);
    }

    const oldSignals = response.evaluated_signals.filter(s => 
      s.sources && s.sources.every(source => !this.isRecent(source.date))
    );
    if (oldSignals.length > 0) {
      risks.push(`${oldSignals.length} signals based on outdated information`);
    }

    const singleSourceSignals = response.evaluated_signals.filter(s => 
      s.sources && s.sources.length === 1 && s.score > 60
    );
    if (singleSourceSignals.length > 0) {
      risks.push(`${singleSourceSignals.length} high-scoring signals rely on single sources`);
    }

    if (response.evaluated_signals.length === 0) {
      risks.push('No signals available for analysis - results may be inaccurate');
    }

    return risks.length > 0 ? risks.slice(0, 3) : ['No significant risks identified'];
  }

  /**
   * Score intent based on Explorium events using OpenRouter AI
   */
  async calculateIntentScoreFromExploriumEvents(
    icpModel: ICPModel,
    company: Company,
    exploriumEvents: ExploriumEvent[],
    exploriumBusinessId?: string
  ): Promise<any> {
    try {
      console.log(`🧠 Starting Explorium-based intent scoring for ${company.name}`);
      
      // Build the analysis prompt
      const analysisPrompt = this.buildExploriumAnalysisPrompt(
        icpModel,
        company,
        exploriumEvents,
        exploriumBusinessId
      );

      // System prompt template
      const systemPrompt = this.getExploriumSystemPrompt();

      // Call OpenRouter to get JSON response
      const analysisResult = await openRouterService.generateJSON<any>(
        analysisPrompt,
        systemPrompt,
        'anthropic/claude-3.5-sonnet',
        8192
      );

      console.log(`✅ Intent scoring complete for ${company.name}: Score ${analysisResult.analysis_metadata?.final_intent_score || 0}/100`);

      return analysisResult;
    } catch (error: any) {
      console.error(`❌ Error calculating intent score from Explorium events:`, error);
      // Return fallback structure
      return {
        analysis_metadata: {
          target_company: company.name,
          business_id: exploriumBusinessId || '',
          analysis_date: new Date().toISOString(),
          timeframe_analyzed: 'Last 90 days',
          data_sources: 'Explorium Business Intelligence',
          total_events_detected: exploriumEvents.length,
          final_intent_score: 0,
          overall_confidence: 'LOW'
        },
        error: error.message
      };
    }
  }

  /**
   * Build the analysis prompt with all parameters filled in
   */
  private buildExploriumAnalysisPrompt(
    icpModel: ICPModel,
    company: Company,
    exploriumEvents: ExploriumEvent[],
    exploriumBusinessId?: string
  ): string {
    const config = icpModel.config;
    const productSettings = config.productSettings || {};
    
    // Get buying triggers (max 5)
    const buyingTriggers = (config.buyingTriggers || []).slice(0, 5);
    
    // Calculate equal weights if we have triggers
    const weightPerSignal = buyingTriggers.length > 0 ? Math.round(100 / buyingTriggers.length) : 20;
    const remainder = 100 - (weightPerSignal * buyingTriggers.length);
    
    // Build signal configuration
    const signalConfigs = buyingTriggers.map((trigger, index) => {
      let weight = weightPerSignal;
      // Add remainder to first signal
      if (index === 0) weight += remainder;
      return {
        signal: trigger,
        weight: weight
      };
    });

    // Group events by event_type
    const eventsByType: Record<string, ExploriumEvent[]> = {};
    exploriumEvents.forEach(event => {
      const eventType = event.event_name || event.data?.event_type || 'unknown';
      if (!eventsByType[eventType]) {
        eventsByType[eventType] = [];
      }
      eventsByType[eventType].push(event);
    });

    // Build signal configuration text
    const signalConfigText = signalConfigs.map((config, index) => {
      const eventType = config.signal;
      const events = eventsByType[eventType] || [];
      return `**Signal ${index + 1}**: ${eventType} - Weight: ${config.weight}% (${events.length} events detected)`;
    }).join('\n');

    // Format company data
    const companyName = company.name || 'Unknown Company';
    const industry = (company.industry && company.industry.length > 0) 
      ? company.industry.join(', ') 
      : 'Unknown';
    const companySize = company.employee_count 
      ? `${company.employee_count} employees` 
      : config.employeeRange || 'Unknown';
    const location = company.location?.country || company.country || 'Unknown';
    const annualRevenue = company.annual_revenue 
      ? `$${company.annual_revenue}` 
      : config.annualRevenue || 'Unknown';

    // Format product settings
    const offerName = (productSettings.productNames && productSettings.productNames.length > 0)
      ? productSettings.productNames.join(', ')
      : 'Not specified';
    const valueProposition = productSettings.valueProposition || 'Not specified';
    const usp = (productSettings.uniqueSellingPoints && productSettings.uniqueSellingPoints.length > 0)
      ? productSettings.uniqueSellingPoints.join(', ')
      : 'Not specified';
    const painPoints = (productSettings.painPointsSolved && productSettings.painPointsSolved.length > 0)
      ? productSettings.painPointsSolved.join(', ')
      : 'Not specified';
    const targetPersonas = (config.targetPersonas && config.targetPersonas.length > 0)
      ? config.targetPersonas.join(', ')
      : 'Not specified';

    // Format API response data
    const apiResponseData = JSON.stringify({
      output_events: exploriumEvents.map(event => ({
        event_id: event.event_id,
        event_name: event.event_name,
        event_time: event.event_time,
        data: event.data,
        business_id: event.business_id
      })),
      total_events: exploriumEvents.length,
      business_id: exploriumBusinessId
    }, null, 2);

    // Calculate timestamp_from (90 days ago)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const timestampFrom = ninetyDaysAgo.toISOString();

    // Build the prompt
    let prompt = `# INTENT SIGNAL DETECTION & SCORING ANALYSIS

## INPUT DATA

### 1. ICP PROFILE
- **Company Name**: ${companyName}
- **Industry**: ${industry}
- **Company Size**: ${companySize}
- **Location**: ${location}
- **Annual Revenue ($)**: ${annualRevenue}

### 2. YOUR OFFER
- **Product/Service**: ${offerName}
- **Value Proposition**: ${valueProposition}
- **Unique Selling Points (USP)**: ${usp}
- **Target Personas**: ${targetPersonas}
- **Pain Points You Solve**: ${painPoints}

### 3. CUSTOM BUYING SIGNALS (User-Selected Events)

${signalConfigText}

**Note**: Signal weights sum to 100%

### 4. EXPLORIUM API RESPONSE DATA

**API Request Parameters:**
\`\`\`json
{
  "event_types": ${JSON.stringify(buyingTriggers)},
  "business_ids": ["${exploriumBusinessId || 'unknown'}"],
  "timestamp_from": "${timestampFrom}"
}
\`\`\`

**API Response:**
\`\`\`json
${apiResponseData}
\`\`\`

**Data Coverage Context:**
- Events are limited to the last 3 months (90 days)
- Real-time updates from Explorium's global business intelligence
- Coverage: 150+ countries, thousands of monthly events
- If no events found for a signal, this indicates absence of that activity

---

## ANALYSIS REQUEST

Please analyze the Explorium event data and provide a complete intent signal analysis following the methodology outlined in the system prompt. Return the structured JSON output as specified.`;

    return prompt;
  }

  /**
   * Get the system prompt template
   */
  private getExploriumSystemPrompt(): string {
    return `# INTENT SIGNAL DETECTION & SCORING SYSTEM

## ROLE & MISSION

You are an expert B2B buying intent analyst specializing in detecting and scoring purchasing signals from Business Events API. Your mission is to analyze business event data, identify specific buying signals, calculate weighted scores, and provide actionable GTM intelligence.

## ANALYSIS METHODOLOGY

### STEP 1: EVENT PARSING & VALIDATION

For each selected signal, analyze the Explorium API response:
- Check if events exist for this event_type
- Extract all event instances with timestamps
- Validate event data completeness and quality
- Note if zero events found (this is meaningful data)

### STEP 2: SIGNAL SCORING FRAMEWORK

For each signal, calculate a **Raw Score (0-100)** based on two factors:

#### A. EVENT OCCURRENCE (50 points)

Score based on the number of events detected for this signal:
- **5+ Events**: 45-50 points - Very strong sustained activity
- **4 Events**: 38-44 points - Strong sustained activity
- **3 Events**: 30-37 points - Strong activity pattern
- **2 Events**: 20-29 points - Moderate consistent activity
- **1 Event**: 10-19 points - Initial activity detected
- **0 Events**: 0 points - No signal detected

#### B. EVENT RECENCY (50 points)

Score based on how recent the events are (use the most recent event):
- **0-7 days ago**: 45-50 points - Extremely recent, high urgency
- **8-14 days ago**: 38-44 points - Very recent activity
- **15-30 days ago**: 30-37 points - Recent activity
- **31-45 days ago**: 20-29 points - Moderately recent
- **46-60 days ago**: 10-19 points - Older but within relevant window
- **61-90 days ago**: 1-9 points - Old activity, low relevance
- **No events or 90+ days**: 0 points - No recent activity

#### TOTAL RAW SCORE PER SIGNAL

Signal Raw Score (0-100) = Event Occurrence Score (0-50) + Event Recency Score (0-50)

### STEP 3: WEIGHTED FINAL SCORE CALCULATION

Final Intent Score = Σ(Signal_Raw_Score × Signal_Weight_Percentage / 100)

### STEP 4: OUTPUT REQUIREMENTS

Return valid JSON in this exact structure:
{
  "analysis_metadata": {
    "target_company": "",
    "business_id": "",
    "analysis_date": "",
    "timeframe_analyzed": "Last 90 days",
    "data_sources": "Explorium Business Intelligence",
    "total_events_detected": 0,
    "final_intent_score": 0,
    "overall_confidence": "HIGH|MEDIUM|LOW"
  },
  "signal_breakdown": [
    {
      "signal_id": 1,
      "event_type": "",
      "signal_name": "",
      "weight_percentage": 0,
      "raw_score": 0,
      "weighted_contribution": 0,
      "confidence_level": "HIGH|MEDIUM|LOW",
      "events_detected": {
        "count": 0,
        "events": []
      },
      "scoring_breakdown": {
        "event_occurrence_score": 0,
        "event_recency_score": 0,
        "total_raw_score": 0,
        "weighted_contribution": 0
      },
      "signal_analysis": {
        "what_detected": "",
        "buying_intent_interpretation": "",
        "timing_implications": "",
        "competitive_context": ""
      },
      "red_flags": []
    }
  ],
  "gtm_intelligence": {
    "overall_buying_readiness": {
      "readiness_level": "HIGH|MEDIUM|LOW",
      "stage_in_buyers_journey": "awareness|consideration|decision",
      "estimated_decision_timeline": "",
      "reasoning": ""
    },
    "timing_recommendation": {
      "optimal_outreach_window": "",
      "urgency_level": "HIGH|MEDIUM|LOW",
      "trigger_events_to_reference": [],
      "reasoning": ""
    },
    "messaging_strategy": {
      "primary_pain_points_detected": [],
      "relevant_value_props_to_emphasize": [],
      "proof_points_to_highlight": [],
      "recommended_messaging_angle": "",
      "events_to_reference_in_outreach": []
    },
    "stakeholder_targeting": {
      "recommended_buyer_personas": [],
      "departments_showing_activity": [],
      "decision_maker_signals": []
    },
    "risk_assessment": {
      "potential_blockers": [],
      "negative_signals_detected": [],
      "missing_positive_signals": []
    }
  },
  "offer_alignment_playbook": {
    "positioning_strategy": "",
    "key_features_to_emphasize": [],
    "relevant_use_case": "",
    "objection_handling": []
  }
}

## CRITICAL GUIDELINES

1. **Evidence-Based Only**: Score strictly on detected Explorium events, not assumptions
2. **Zero-Score Honesty**: If no events detected, give 0 points with clear explanation
3. **Weight Respect**: Apply user-defined weights exactly as configured
4. **Math Transparency**: Show complete scoring breakdown per signal
5. **GTM Intelligence Quality**: Provide concise, actionable insights (2-3 sentences max per insight)
6. **Event Citation**: Reference specific events with data (amounts, dates, types)
7. **Buying Logic**: Explicitly connect events to buying intent

Return ONLY valid JSON. No preamble, no markdown formatting, no conversational filler.`;
  }
}

// ==================== EXPORTS ====================

// Create and export the service instance
export const IntentScoringService = new OllamaIntentScoringService();

// Main scoring function
export async function analyzeIntentWithAIScoring(
  enhancedResponse: any
): Promise<ScoringResult> {
  return IntentScoringService.calculateIntentScore(enhancedResponse);
}

// Utility function for safe scoring
export async function safeIntentScoring(response: any, fallbackScore: number = 0): Promise<ScoringResult> {
  try {
    return await analyzeIntentWithAIScoring(response);
  } catch (error) {
    console.error('💥 Critical scoring error, returning safe fallback:', error);
    return {
      score: fallbackScore,
      reason: 'Scoring service unavailable - using fallback',
      factors: [],
      confidence: 'low',
      strategic_insights: ['Service temporarily unavailable'],
      timing_recommendation: 'monitor',
      risk_factors: ['Scoring service experienced technical issues']
    };
  }
}

// Export types for use in other modules
export type {
  SourceDetail,
  EnhancedSignalResult,
  EnhancedIntentResponse,
  ScoringResult,
  InputResponse,
  SignalResult,
  EvidenceItem
};

// Demo execution removed to avoid ES module issues
// You can call demonstrateAIScoringService() explicitly if needed