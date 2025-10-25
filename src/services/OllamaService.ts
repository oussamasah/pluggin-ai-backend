// src/services/OllamaService.ts
import axios from 'axios';
import { config } from '../core/config.js';
import { Company } from '../core/types.js';

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

export class OllamaService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.OLLAMA_BASE_URL;
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const messages:any[] = [];
      
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });

    /*  const response = await axios.post(`${this.baseUrl}/api/chat`, {
        model: config.OLLAMA_MODEL,
        messages: messages,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9,
        }
      });*/

      const response = await axios.post(`https://openrouter.ai/api/v1/chat/completions`, {
        model: config.OLLAMA_MODEL,
        messages: messages,
      },{
        headers:{
          Authorization: 'Bearer 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',
          'Content-Type': 'application/json'
        }
      });

      return response.data.message.content;
    } catch (error) {
      console.error('Ollama API error:', error);
      throw new Error('Failed to generate response from Ollama');
    }
  }

  async scoreCompanyFit(company: any, icpConfig: any): Promise<ScoringResult> {
    const systemPrompt = `You are a B2B marketing and target audience analysis expert. 
    Evaluate companies against ICP criteria and provide a JSON response with score (0-100) and reason.`;

    const prompt = `# ICP Fit Scoring System
You are an expert B2B sales intelligence analyst specializing in Ideal Customer Profile (ICP) scoring. Your task is to evaluate companies against specific ICP criteria and generate accurate, data-driven fit scores from 0-100 based solely on firmographic and technographic factors, weighted according to the user's specified priorities.

## Your Mission
Analyze the provided company data against the ICP configuration and calculate a precise fit score from 0-100, along with detailed reasoning and contributing factors. Use the exact weights specified in scoringWeights.firmographic and scoringWeights.technographic from the ICP configuration.

## Scoring Weight Configuration

The user defines the relative importance of each category through scoringWeights:
- scoringWeights.firmographic: User-defined weight for company profile data (0-100)
- scoringWeights.technographic: User-defined weight for technology stack data (0-100)

*Required:* firmographic + technographic = 100

*Weight Application:*

Firmographic Maximum Points = scoringWeights.firmographic
Technographic Maximum Points = scoringWeights.technographic
Total Maximum Score = 100 points


*Examples:*
- Firmographic priority: {firmographic: 70, technographic: 30}
- Technographic priority: {firmographic: 30, technographic: 70}
- Balanced approach: {firmographic: 50, technographic: 50}

---

## 1. FIRMOGRAPHIC ANALYSIS

*Total Available Points:* scoringWeights.firmographic

*Point Distribution:*
Each of the 5 firmographic dimensions receives an equal share of the total firmographic points.

Points per dimension = scoringWeights.firmographic ÷ 5


*Examples:*
- If firmographic = 60, each dimension = 60 ÷ 5 = *12 points*
- If firmographic = 70, each dimension = 70 ÷ 5 = *14 points*
- If firmographic = 50, each dimension = 50 ÷ 5 = *10 points*
- If firmographic = 30, each dimension = 30 ÷ 5 = *6 points*

### Dimension 1: Industry Match
*Max Points:* scoringWeights.firmographic ÷ 5

*Scoring Rules:*
- ✓ Perfect match with industries: *100% of dimension points*
- ≈ Adjacent/related industry: *50% of dimension points*
- ✗ No match or unclear: *0 points*
- 🚫 In excludedIndustries: *DISQUALIFICATION (final score = 0)*
- ⚠ Missing data: *0 points* + Flag: "Industry data not available"

*What to check:*
- Does company's primary industry match any industry in the industries array?
- Is the company in any excludedIndustries?

### Dimension 2: Geography
*Max Points:* scoringWeights.firmographic ÷ 5

*Scoring Rules:*
- ✓ Company HQ in target geographies: *100% of dimension points*
- ≈ Company has significant operations in target geographies: *70% of dimension points*
- ✗ Not in target geography: *0 points*
- 🚫 In excludedGeographies: *-25% penalty on final score*
- ⚠ Missing data: *0 points* + Flag: "Geography data not available"

*What to check:*
- Is company headquarters or primary location in geographies array?
- Is company in any excludedGeographies?

### Dimension 3: Company Size (Employee Count)
*Max Points:* scoringWeights.firmographic ÷ 5

*Scoring Rules:*
- ✓ Within target employeeRange: *100% of dimension points*
- ≈ Within ±25% of range boundaries: *70% of dimension points*
- ≈ Within ±50% of range boundaries: *40% of dimension points*
- ✗ Outside range: *0 points*
- 🚫 In excludedSizeRange: *-20% penalty on final score*
- ⚠ Missing data: *0 points* + Flag: "Employee count not available"

*What to check:*
- Parse employeeRange (e.g., "100-500", "500+", "1000-5000")
- Compare company's employee count to this range
- Check against excludedSizeRange

### Dimension 4: Annual Revenue
*Max Points:* scoringWeights.firmographic ÷ 5

*Scoring Rules:*
- ✓ Within target acvRange: *100% of dimension points*
- ≈ Within ±30% of range boundaries: *70% of dimension points*
- ≈ Within ±50% of range boundaries: *40% of dimension points*
- ✗ Outside range: *0 points*
- ⚠ Missing data: *0 points* + Flag: "Revenue data not available"

*What to check:*
- Parse acvRange (e.g., "$1M-$10M", "$50M+", "$10M-$100M")
- Compare company's annual revenue to this range
- Consider ARR, revenue, or financial data provided

### Dimension 5: Funding/Financial Stability
*Max Points:* scoringWeights.firmographic ÷ 5

*Scoring Rules:*
- ✓ Public company or well-funded (Series C+): *100% of dimension points*
- ≈ Series B funding: *70% of dimension points*
- ≈ Early stage (Seed/Series A): *40% of dimension points*
- ≈ Unknown funding but established company indicators: *50% of dimension points*
- ⚠ Missing data: *0 points* + Flag: "Funding data not available"

*What to check:*
- Company funding stage, total funding raised
- Public/private status
- Financial stability indicators

*Firmographic Total Calculation:*

Firmographic Score = Industry + Geography + Size + Revenue + Funding
Maximum Possible = scoringWeights.firmographic


---

## 2. TECHNOGRAPHIC ANALYSIS

*Total Available Points:* scoringWeights.technographic

*Point Distribution:*

Must-Have Technologies = scoringWeights.technographic × 0.60 (60%)
Tech Stack Quality      = scoringWeights.technographic × 0.20 (20%)
Integration Readiness   = scoringWeights.technographic × 0.20 (20%)


*Examples:*
- If technographic = 40: Must-Have=24pts, Quality=8pts, Integration=8pts
- If technographic = 70: Must-Have=42pts, Quality=14pts, Integration=14pts
- If technographic = 30: Must-Have=18pts, Quality=6pts, Integration=6pts

### Component 1: Must-Have Technologies
*Max Points:* scoringWeights.technographic × 0.60

*Scoring Rules:*
- ✓ All technologies in mustHaveTech present: *100% of allocated points*
- ≈ Partial match: *(matched count ÷ required count) × allocated points*
- ✗ No matches or empty tech stack: *0 points*
- ⚠ Missing data: *0 points* + Flag: "Technology stack data not available"

*Calculation Example:*

If mustHaveTech = ["Salesforce", "HubSpot", "Slack", "AWS", "Stripe"]
Company has: ["Salesforce", "AWS", "Stripe"]
Match rate: 3/5 = 60%
If max points = 24, earned = 24 × 0.60 = 14.4 points


*What to check:*
- Does company use each technology listed in mustHaveTech?
- Check tech stack, integrations, technology mentions

### Component 2: Excluded Technologies (Penalty)
*Penalty Application:* Applied to final score, not technographic subscore

*Penalty Rules:*
- 🚫 Each tech from excludedTechnologies found: *-15% of final score*
- 🚫 Excluded tech is core/primary platform: *-25% of final score*
- 🚫 Multiple excluded techs: Penalties stack

*What to check:*
- Is company using any technologies from excludedTechnologies?
- How central is the excluded technology to their operations?

### Component 3: Tech Stack Quality & Modernity
*Max Points:* scoringWeights.technographic × 0.20

*Scoring Rules:*
- ✓ Modern, cloud-native, enterprise-grade stack: *100% of allocated points*
- ≈ Mix of modern and legacy technologies: *60% of allocated points*
- ≈ Predominantly legacy or outdated technologies: *30% of allocated points*
- ✗ Unknown or insufficient tech data: *0 points* + Flag: "Insufficient tech stack information"

*Assessment Criteria:*
- Cloud-native vs on-premise
- Modern SaaS vs legacy enterprise software
- API-first architecture
- Current versions vs deprecated technologies

### Component 4: Technology Integration Readiness
*Max Points:* scoringWeights.technographic × 0.20

*Scoring Rules:*
- ✓ Compatible ecosystem, clear integration paths: *100% of allocated points*
- ≈ Some compatibility, moderate integration effort: *60% of allocated points*
- ≈ Limited compatibility, challenges expected: *20% of allocated points*
- ✗ Competing/incompatible core technologies: *0 points*
- ⚠ Missing data: *0 points* + Flag: "Cannot assess integration readiness"

*Assessment Criteria:*
- API availability and maturity
- Integration platform presence (Zapier, MuleSoft, etc.)
- Open ecosystem vs closed/proprietary
- Technical compatibility with common integration patterns

*Technographic Total Calculation:*

Technographic Score = Must-Have Tech + Tech Quality + Integration Readiness
Maximum Possible = scoringWeights.technographic
Note: Excluded tech penalties applied separately to final score


---

## FINAL SCORE CALCULATION

### Step 1: Calculate Base Score

Base Score = Firmographic Score + Technographic Score
(This should equal 0-100 before penalties)


### Step 2: Calculate Total Penalties

Total Penalty Percentage = 
  + (Excluded Geography Penalty if applicable: 0.25)
  + (Excluded Size Penalty if applicable: 0.20)
  + (Excluded Tech Penalties: 0.15 per tech, or 0.25 if core)


### Step 3: Apply Penalties

Penalty Amount = Base Score × Total Penalty Percentage
Final Score = Base Score - Penalty Amount


### Step 4: Bound Score

Final Score = Max(0, Min(100, Final Score))
Final Score = Round(Final Score)


### Complete Example:

Configuration: firmographic=60, technographic=40

FIRMOGRAPHIC (max 60):
- Industry: SaaS match = 12/12
- Geography: USA match = 12/12
- Size: 450 employees (in range) = 12/12
- Revenue: Missing = 0/12
- Funding: Series B = 8.4/12 (70%)
Firmographic Total: 44.4/60

TECHNOGRAPHIC (max 40):
- Must-have tech: 4/5 matched = 19.2/24 (24 × 0.80)
- Tech quality: Modern stack = 8/8
- Integration: Compatible = 8/8
Technographic Total: 35.2/40

Base Score: 44.4 + 35.2 = 79.6

PENALTIES:
- No excluded geo/size/tech
Penalty: 0

Final Score: 79.6 → 80/100


---

## CONFIDENCE SCORING

*Data Completeness Assessment*

*8 Critical Data Points:*
1. Industry
2. Geography
3. Company Size
4. Annual Revenue
5. Funding Status
6. Technology Stack
7. Tech Stack Quality
8. Integration Readiness

*Confidence Calculation:*

Available Data Points = Count of data points with actual information
Confidence Score = (Available Data Points ÷ 8) × 100


*Confidence Ranges:*
- *88-100%*: 7-8/8 data points available (complete, reliable)
- *63-87%*: 5-6/8 data points available (minor gaps)
- *38-62%*: 3-4/8 data points available (moderate gaps)
- *13-37%*: 1-2/8 data points available (significant gaps)
- *0-12%*: 0/8 data points available (unreliable, insufficient)

*Confidence Impact:*
- High confidence (>75%): Score is reliable for decision-making
- Medium confidence (50-75%): Score is directional, verify missing data
- Low confidence (<50%): Score is speculative, prioritize data enrichment

---

## DISQUALIFICATION RULES

*Automatic Score = 0* (overrides all other scoring):

1. *Excluded Industry*: Company's primary industry is in excludedIndustries
2. *Excluded Geography Only*: Company operates exclusively in excludedGeographies
3. *Excluded Size Range*: Company size falls in excludedSizeRange with no growth trajectory
4. *Core Excluded Technology*: Company's primary/core platform is in excludedTechnologies

*When Disqualified:*
- Set score: 0
- Still provide full breakdown showing what was analyzed
- Clearly state disqualification reason in reason field
- List disqualifying factor in redFlags array

---

## OUTPUT FORMAT

Return a *valid JSON object* with this exact structure:
json
{
  "score": <number 0-100>,
  "reason": "<2-3 sentences explaining the score. Must mention: (1) the weights used, (2) key strengths/gaps, (3) impact of missing data if any. Example: 'With firmographic weighted at 60% and technographic at 40%, Company X achieves 80/100. Strong industry and geography match offset by missing revenue data (12 points lost) and partial tech stack alignment.'>",
  "confidence": <number 0-100>,
  "factors": [
    "<Factor with calculation: 'Industry match (SaaS): 12/12 points'>",
    "<Factor with calculation: 'Geography (USA): 12/12 points'>",
    "<Factor with calculation: 'Company size (450 employees, in range): 12/12 points'>",
    "<Factor with calculation: 'Revenue data missing: 0/12 points'>",
    "<Factor with calculation: 'Funding (Series B): 8.4/12 points (70%)'>",
    "<Factor with calculation: 'Must-have technologies (4/5 matched): 19.2/24 points'>",
    "<Factor with calculation: 'Tech stack quality (modern): 8/8 points'>",
    "<Factor with calculation: 'Integration readiness (compatible): 8/8 points'>",
    "... (at least 8 factors covering all dimensions)"
  ],
  "breakdown": {
    "weights": {
      "firmographic": <scoringWeights.firmographic>,
      "technographic": <scoringWeights.technographic>
    },
    "firmographic": {
      "score": <actual points earned, max = firmographic weight>,
      "maxScore": <scoringWeights.firmographic>,
      "pointsPerDimension": <firmographic ÷ 5>,
      "dimensions": {
        "industry": {
          "earned": <points>,
          "max": <points per dimension>,
          "percentage": <percentage earned>,
          "details": "<specific finding, e.g., 'SaaS - perfect match'>"
        },
        "geography": {
          "earned": <points>,
          "max": <points per dimension>,
          "percentage": <percentage earned>,
          "details": "<specific finding, e.g., 'USA headquarters - target match'>"
        },
        "size": {
          "earned": <points>,
          "max": <points per dimension>,
          "percentage": <percentage earned>,
          "details": "<specific finding, e.g., '450 employees - within 250-1000 range'>"
        },
        "revenue": {
          "earned": <points>,
          "max": <points per dimension>,
          "percentage": <percentage earned>,
          "details": "<specific finding or 'Data not available'>"
        },
        "funding": {
          "earned": <points>,
          "max": <points per dimension>,
          "percentage": <percentage earned>,
          "details": "<specific finding, e.g., 'Series B, $25M raised'>"
        }
      }
    },
    "technographic": {
      "score": <actual points earned, max = technographic weight>,
      "maxScore": <scoringWeights.technographic>,
      "components": {
        "mustHaveTech": {
          "earned": <points>,
          "max": <technographic × 0.6>,
          "percentage": <percentage earned>,
          "matched": <number of matched technologies>,
          "required": <total required technologies>,
          "matchedTech": ["<tech1>", "<tech2>"],
          "missingTech": ["<tech3>", "<tech4>"],
          "details": "<summary>"
        },
        "techQuality": {
          "earned": <points>,
          "max": <technographic × 0.2>,
          "percentage": <percentage earned>,
          "details": "<quality assessment, e.g., 'Modern cloud-native stack'>"
        },
        "integration": {
          "earned": <points>,
          "max": <technographic × 0.2>,
          "percentage": <percentage earned>,
          "details": "<integration assessment, e.g., 'API-first, compatible ecosystem'>"
        }
      }
    },
    "penalties": {
      "totalPercentage": <sum of all penalty percentages, e.g., 0.15>,
      "totalPoints": <points deducted from base score>,
      "details": [
        "<penalty description with percentage, e.g., 'Excluded geography: -25%'>",
        "<another penalty if applicable>"
      ]
    },
    "calculation": {
      "baseScore": <firmographic + technographic before penalties>,
      "penaltyAmount": <baseScore × totalPercentage>,
      "finalScore": <baseScore - penaltyAmount, bounded 0-100>
    },
    "missingDataPoints": [
      "<data point name: Revenue>",
      "<data point name: Tech stack details>"
    ]
  },
  "redFlags": [
    "<critical issue, e.g., 'Company size outside target range'>",
    "<another critical issue if applicable>"
  ],
  "dataGaps": [
    "<specific gap with impact, e.g., 'Revenue data unavailable: 12 points lost from firmographic score'>",
    "<another gap if applicable>"
  ]
}


---

## ANALYSIS GUIDELINES

### 1. Weight Respect
- *ALWAYS* use exact weights from scoringWeights.firmographic and scoringWeights.technographic
- *NEVER* override or "rebalance" user preferences
- Show weight-aware calculations in all factors

### 2. Missing Data Transparency
- Assign *0 points* for any missing data dimension
- *Always explain* in reasoning what data was missing and impact on score
- Include missing dimensions in dataGaps array with point values lost
- Lower confidence score proportionally

### 3. Mathematical Precision
- Show calculations: "4/5 matched = 19.2/24 points" not just "19.2 points"
- Display both earned and maximum points for every dimension
- Round final score only, keep intermediate calculations precise

### 4. Contextual Assessment
- Consider company stage and growth trajectory
- Evaluate tech stack in context of company size/industry
- Be realistic about data availability for different company types

### 5. Actionable Insights
- Factors should guide sales strategy and prioritization
- Red flags should be specific and verifiable
- Data gaps should indicate enrichment priorities

---

## REASONING TEMPLATE

Use this structure for the reason field:

"[Company Name] achieves [X]/100 based on [firmographic]% firmographic and [technographic]% technographic weighting. [Key strength 1] and [key strength 2] contributed [Y] points, while [gap/weakness] resulted in [Z] points lost. [Penalty explanation if >0]. [Data completeness statement if confidence <80%]."


*Examples:*

*High Score, Complete Data:*

"Acme Corp achieves 87/100 based on 60% firmographic and 40% technographic weighting. Perfect matches in industry (SaaS), geography (USA), and size (500 employees) contributed 36/36 points, with strong tech stack alignment (32/40 points) including 4/5 required technologies. Minor gap in funding stage (early Series B) and one missing tech slightly reduced the score."


*Medium Score, Missing Data:*

"TechStart Inc scores 62/100 based on 70% firmographic and 30% technographic weighting. Strong industry and geography alignment (28/28 points) offset by missing revenue data (14 points lost) and partial tech stack coverage (18/30 points with 3/5 technologies). Confidence reduced to 63% due to significant data gaps in revenue and funding."


*Low Score with Penalty:*

"GlobalTech Ltd achieves 34/100 based on 50% firmographic and 50% technographic weighting. Misalignment in company size (outside target range, 0/10 points) and limited tech stack match (15/50 points with only 2/7 technologies) significantly impacted scoring. Additional 20% penalty applied for excluded size range."


---

## NOW ANALYZE

*ICP Configuration:*
json
${JSON.stringify(icpConfig, null, 2)}


*Company Data:*
json
${JSON.stringify(company, null, 2)}


*Instructions:*
1. Extract scoringWeights.firmographic and scoringWeights.technographic from ICP configuration
2. Verify weights sum to 100 (if not, note the discrepancy in your response)
3. Calculate points per firmographic dimension: firmographic ÷ 5
4. Calculate technographic component allocations: technographic × [0.6, 0.2, 0.2]
5. Evaluate each dimension/component against company data
6. Assign 0 points for missing data and document in dataGaps
7. Calculate base score, apply penalties, bound to 0-100
8. Determine confidence based on 8 data points availability
9. Return complete JSON response with all calculations shown

Provide your detailed ICP fit analysis as JSON following the exact format above.
    `;

    try {
      const response = await this.generate(prompt, systemPrompt);
      const parsed = this.parseJSONResponse(response);
      
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
    const highQualityCount = companies.filter(c => (c.scoring_metrics?.fit_score?.overall || 0) >= 85).length;
    const mediumQualityCount = companies.filter(c => {
      const score = c.scoring_metrics?.fit_score?.overall || 0;
      return score >= 65 && score < 85;
    }).length;
    const lowQualityCount = companies.filter(c => (c.scoring_metrics?.fit_score?.overall || 0) < 65).length;
    
    const averageFitScore = companies.length > 0 
      ? Math.round(companies.reduce((sum, c) => sum + (c.scoring_metrics?.fit_score?.overall || 0), 0) / companies.length)
      : 0;

    // Intent analysis
    const highIntentCount = companies.filter(c => (c.scoring_metrics?.intent_score?.overall || 0) >= 70).length;
    const averageIntentScore = companies.length > 0
      ? Math.round(companies.reduce((sum, c) => sum + (c.scoring_metrics?.intent_score?.overall || 0), 0) / companies.length)
      : 0;

    // Industry analysis from your company data
    const industryAnalysis = companies.reduce((acc, company) => {
      const industry = company.business_classification?.industry?.primary?.type || 'Uncategorized';
      if (!acc[industry]) {
        acc[industry] = { count: 0, totalFitScore: 0, totalIntentScore: 0 };
      }
      acc[industry].count++;
      acc[industry].totalFitScore += company.scoring_metrics?.fit_score?.overall || 0;
      acc[industry].totalIntentScore += company.scoring_metrics?.intent_score?.overall || 0;
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
      const fitScore = company.scoring_metrics?.fit_score?.overall || 0;
      const intentScore = company.scoring_metrics?.intent_score?.overall || 0;
      
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
        const aScore = (a.scoring_metrics?.fit_score?.overall || 0) * 0.7 + (a.scoring_metrics?.intent_score?.overall || 0) * 0.3;
        const bScore = (b.scoring_metrics?.fit_score?.overall || 0) * 0.7 + (b.scoring_metrics?.intent_score?.overall || 0) * 0.3;
        return bScore - aScore;
      })
      .slice(0, 3)
      .map(company => ({
        name: company.basic_info?.name,
        industry: company.business_classification?.industry?.primary?.type,
        employees: company.firmographic_data?.employee_count?.exact || company.firmographic_data?.employee_count?.range,
        location: company.contact_info?.address?.country,
        fitScore: company.scoring_metrics?.fit_score?.overall,
        intentScore: company.scoring_metrics?.intent_score?.overall,
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
        c.scoring_metrics?.fit_score?.overall !== undefined
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
    //console.log("Extracting company data from CoreSignal response:");
    //console.log(response);
    
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