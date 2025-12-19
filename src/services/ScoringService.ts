// src/services/ClaudeScoringService.ts
import { config } from '../core/config.js';
import { openRouterService } from '../utils/OpenRouterService.js';
import { ScoringResult } from './OllamaService.js';

export class ScoringService {

  async scoreCompanyFit(company: any, icpConfig: any): Promise<ScoringResult> {


    const systemPrompt = `You are a B2B marketing and target audience analysis expert. 
  Evaluate companies against ICP criteria and provide a JSON response with score (0-100) and reason.`;

    // Safely extract exa_enrichment data with null checking
    const exaEnrichment = company.exa_enrichement && company.exa_enrichement[0];
    const description = exaEnrichment?.properties?.description || 'No description available';
    const evaluations = exaEnrichment?.evaluations?.map((e: { criterion: any; }) => e.criterion) || [];

    const { enrichement, exa_enrichement, ...companyClone } = company;

    const prompt = `You are an expert B2B sales intelligence analyst specializing in Ideal Customer Profile (ICP) scoring. Your task is to evaluate companies against specific ICP criteria and generate accurate, data-driven fit scores from 0-100 based solely on the weighted criteria specified in the ICP configuration.

  ## Your Mission
  
  Analyze the provided company data against the ICP configuration and calculate a precise fit score from 0-100, along with detailed reasoning and contributing factors. Use ONLY the weights specified in scoringWeights.firmographic and scoringWeights.technographic from the ICP configuration.

  *ICP Configuration:*
  json
  ${JSON.stringify(icpConfig, null, 2)}

  *Company Data:*
  json
  ${JSON.stringify(companyClone, null, 2)}

  *Industry and Employees range Data :*
  ${JSON.stringify(description, null, 2)}
  ${JSON.stringify(evaluations, null, 2)}

  ## IMPORTANT INDUSTRY INFERENCE INSTRUCTION
  The field "business_classification.industry.primary.type" may be missing or inaccurate.
  When evaluating "Industry Match":
  - Infer the TRUE industry from contextual text found in company description and evaluations.
  - Use semantic understanding of that text to classify the company's industry.
  - Compare this inferred industry against icpConfig.industries using your semantic matching rules.
  - If structured industry data exists, still prefer the context if it provides clearer insight.

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
  - ✓ **Category Match** (same industry category): *80% of dimension points*
  - ≈ **Related Industry**: *60% of dimension points*
  - ≈ **Peripheral Match**: *40% of dimension points*
  - ✗ **No Semantic Relationship**: *0 points*
  - 🚫 **Semantic Exclusion**: *DISQUALIFICATION*
  - ⚠ **Missing data**: *Use description and evaluations to infer industry*
  
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
  Must-Have Technologies = ${icpConfig.scoringWeights.technographic * 0.60}
  Tech Stack Quality = ${icpConfig.scoringWeights.technographic * 0.20}
  Integration Readiness = ${icpConfig.scoringWeights.technographic * 0.20}
  
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
  
  ## DATA AVAILABILITY CHECK
  
  *Current Data Status:*
  - Company Description: ${description !== 'No description available' ? '✅ Available' : '❌ Missing'}
  - Industry Evaluations: ${evaluations.length > 0 ? '✅ Available' : '❌ Missing'}
  
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
  `;

    try {
      const response = await openRouterService.generate(prompt, systemPrompt,config.OLLAMA_MODEL);
      console.log("Claude scoring response:", response);
      const parsed = this.parseJSONResponse(response);

      return {
        score: Math.min(100, Math.max(0, parsed.score || 0)),
        reason: parsed.reason || 'No reason provided',
        confidence: parsed.confidence || 0.8,
        factors: parsed.factors || []
      };
    } catch (error) {
      console.error('Claude scoring error:', error);
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
    - Annual revenu: ${icpModel.annualRevenue || 'Any'}
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
      const response = await await openRouterService.generate(prompt, systemPrompt,config.OLLAMA_MODEL);
      const parsed = this.parseJSONResponse(response);
      
      return {
        score: Math.min(100, Math.max(0, parsed.score || 0)),
        reason: parsed.reason || 'Limited data available for intent analysis',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        factors: parsed.keySignals || ['Insufficient data for detailed analysis']
      };
    } catch (error) {
      console.error('Claude intent scoring error:', error);
      return { 
        score: 0, 
        reason: 'Intent scoring failed - analysis error', 
        confidence: 0, 
        factors: ['Scoring system unavailable'] 
      };
    }
  }

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
      .sort(([,a]:any, [,b]:any) => b.count - a.count)
      .slice(0, 4)
      .map(([industry, data]:any) => ({
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
      .sort(([,a]:any, [,b]:any) => b - a)
      .slice(0, 3)
      .map(([country, count]) => `${country} (${count})`)
      .join(', ');

    // Technology analysis from your company data
    const technologyAnalysis = companies.reduce((acc, company) => {
      const techs = company.technographic_data?.technology_stack || [];
      techs.forEach((tech: { name: string | number; }) => {
        acc[tech.name] = (acc[tech.name] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    const topTechnologies = Object.entries(technologyAnalysis)
      .sort(([,a]:any, [,b]:any) => b - a)
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
      const response = await  openRouterService.generate(prompt, systemPrompt);
      return response;
    } catch (error) {
      console.error('Error generating search summary with Claude:', error);
      
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
      const response = await  openRouterService.generate(prompt, systemPrompt);
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
      console.error('Error generating no results message with Claude:', error);
      return this.generateFallbackNoResultsMessage(query, icpModel);
    }
  }

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
      const response = await  openRouterService.generate(prompt, systemPrompt);
      const parsed = this.parseJSONResponse(response);
      
      return {
        issues: parsed.issues || ['Query may be too specific for available data'],
        recommendations: parsed.recommendations || ['Try broadening one criteria at a time'],
        confidence: parsed.confidence || 0.7
      };
    } catch (error) {
      console.error('Error analyzing query issues with Claude:', error);
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
      console.error('Failed to parse JSON response from Claude:', response);
      return {};
    }
  }

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
}

export const scoringService = new ScoringService();