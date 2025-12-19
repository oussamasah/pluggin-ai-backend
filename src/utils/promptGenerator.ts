export function generateGTMAnalysisPrompt(
  coresignalData: any, 
  icpModel: any
): string {
  // Extract basic company info for the prompt context
  const company = {
    name: coresignalData.company_name || coresignalData.data?.company_name || 'Not available',
    domain: coresignalData.website || coresignalData.data?.website || coresignalData.requested_url || 'Not available',
    industry: coresignalData.industry || coresignalData.data?.industry || 'Not available',
  };

  // Extract ICP model data
  const icp = {
    modelName: icpModel.config?.modelName || icpModel.name || 'Not available',
    valueProposition: icpModel.config?.productSettings?.valueProposition || 'Not available',
    uniqueSellingPoints: icpModel.config?.productSettings?.uniqueSellingPoints || [],
    productNames: icpModel.config?.productSettings?.productNames || [],
    painPointsSolved: icpModel.config?.productSettings?.painPointsSolved || [],
    employeeRange: icpModel.config?.employeeRange || 'Not available',
    annualRevenue: icpModel.config?.annualRevenue || 'Not available',
    scoringWeights: icpModel.config?.scoringWeights || {},
    targetIndustries: icpModel.config?.industries || [],
    targetGeographies: icpModel.config?.geographies || []
  };

  // Extract only essential data from coresignalData for the prompt
  const essentialData = extractEssentialCoresignalData(coresignalData);

  // Build the dynamic prompt with essential data only
  const prompt = `
## Role & Objective

You are an expert GTM (Go-To-Market) research analyst specializing in deep company intelligence for B2B sales and outbound prospecting. Your task is to transform comprehensive company data into actionable GTM intelligence relevant for YOUR ICP MODEL & SOLUTION.

**CRITICAL OUTPUT REQUIREMENT**: You must return your analysis in MARKDOWN format using the exact structure specified below. Do not return JSON.

## DATA SOURCES & INSTRUCTIONS

### 1. ESSENTIAL COMPANY DATA
Below is the essential company intelligence data extracted from CoreSignal. Use ALL available fields for your analysis:

\`\`\`json
${JSON.stringify(essentialData, null, 2)}
\`\`\`

### 2. COMPANY WEBSITE ANALYSIS REQUIRED
**IMPORTANT**: You MUST visit and analyze the company website to gather additional intelligence:
- **Website URL**: ${company.domain}
- **Required Website Analysis**: Extract information about their products, services, pricing, case studies, customer testimonials, team, culture, recent updates, and any other relevant GTM intelligence.
- **In case you have an issue accessing the website just use the data you have of coresignal

### 3. YOUR ICP MODEL & SOLUTION
- **ICP Model**: ${icp.modelName}
- **Your Value Proposition**: ${icp.valueProposition}
- **Your Unique Selling Points**: ${icp.uniqueSellingPoints.join(', ')}
- **Your Product Names**: ${icp.productNames.join(', ')}
- **Pain Points You Solve**: ${icp.painPointsSolved.join(', ')}
- **Target Employee Range**: ${icp.employeeRange}
- **Target Annual Revenue**: ${icp.annualRevenue}
- **Target Industries**: ${icp.targetIndustries.join(', ')}
- **Target Geographies**: ${icp.targetGeographies.join(', ')}

## REQUIRED MARKDOWN OUTPUT STRUCTURE

Your analysis MUST follow this exact markdown structure:

# GTM Intelligence Report: ${company.name}

## Executive Summary
*(2-3 paragraph overview of key findings and strategic implications)*

## Company Overview
**Basic Information**
- **Company Name**: [${company.name}]
- **Domain**: [${company.domain}]
- **Industry**: [${company.industry}]
- **Headquarters**: [Location from data]
- **Company Size**: [Employee range and count]
- **Founded**: [Year]
- **Business Status**: [Public/Private, funding stage]

**Core Business Description**
*(1-2 paragraphs describing what they do, their value proposition, and market position)*

**GTM Intelligence**: *(Key insights about their business model and market approach)*

## Products & Services

### Core Offerings
*(Detailed breakdown of their main products/services)*

**Product Categories:**
- **Category 1**: [Description]
- Products: [List with descriptions]
- Technical Complexity: [Assessment]
- **Category 2**: [Description]
- Products: [List with descriptions]
- Technical Complexity: [Assessment]

**GTM Intelligence**: *(Pricing models, packaging strategy, service delivery approach)*

## Target Market & Customers

### Primary Customer Segments
- **Segment 1**: [Description]
- Key Needs: [List]
- Use Cases: [Specific applications]
- **Segment 2**: [Description]
- Key Needs: [List]
- Use Cases: [Specific applications]

### Industries Served
- [Industry 1], [Industry 2], [Industry 3]

### Geographic Focus
- [Primary regions/countries]

**GTM Intelligence**: *(Customer acquisition strategy, market penetration, expansion patterns)*

## Technology & Partnerships

### Technology Stack
*(Key technologies used based on CoreSignal and website analysis)*
- **Core Technologies**: [List]
- **Infrastructure**: [List]
- **Emerging Tech**: [List]

### Key Partnerships
- **Technology Partners**: [List with significance]
- **Distribution Partners**: [List with significance]
- **Strategic Alliances**: [List with significance]

### Ecosystem Position
*(Their role in the broader market ecosystem)*

**GTM Intelligence**: *(Integration opportunities, partnership gaps, technology trends)*

## Competitive Differentiation

### Key Differentiators
1. **Differentiator 1**: [Description]
 - Competitive Advantage: [How this creates value]
 - GTM Impact: [How this affects sales/marketing]

2. **Differentiator 2**: [Description]
 - Competitive Advantage: [How this creates value]
 - GTM Impact: [How this affects sales/marketing]

3. **Differentiator 3**: [Description]
 - Competitive Advantage: [How this creates value]
 - GTM Impact: [How this affects sales/marketing]

## Business Model & GTM Strategy

### Revenue Model
- [Description of how they make money]

### Go-to-Market Motion
- [Primary GTM approach: product-led, sales-led, channel-led, etc.]

### Distribution Channels
- [List of key channels]

**GTM Intelligence**: *(Sales cycle characteristics, customer acquisition costs, lifetime value patterns)*

## Market Context & Industry Dynamics

### Market Segment
- [Specific market category and position]

### Market Maturity
- **Stage**: [Emerging/Growth/Mature/Declining]
- **Buying Behavior Implications**: [How market stage affects purchasing]

### Key Market Drivers
1. [Driver 1 and impact]
2. [Driver 2 and impact]
3. [Driver 3 and impact]

### Market Challenges
1. [Challenge 1 and implications]
2. [Challenge 2 and implications]
3. [Challenge 3 and implications]

**GTM Intelligence**: *(Market timing, competitive threats, growth opportunities)*

## GTM Intelligence Summary

### Why This Company Matters for YOUR ICP MODEL & SOLUTION

**ICP Fit Signals:**
- ✅ [Strong fit signal 1]
- ✅ [Strong fit signal 2]
- ⚠️ [Potential concern 1]
- ⚠️ [Potential concern 2]

**Likely Pain Points & Urgency:**
- **High Urgency**:
- [Pain point 1] - [Business context]
- [Pain point 2] - [Business context]
- **Medium Urgency**:
- [Pain point 3] - [Business context]
- **Low Urgency**:
- [Pain point 4] - [Business context]

**Buying Context**: *(Current situation that might trigger purchasing)*

**Competitive Landscape**: *(How they compare to alternatives)*

### Recommended GTM Approach

**Primary Messaging Themes:**
1. **Theme 1**: [Core message]
 - **Messaging Angle**: [Specific angle]
 - **Business Context Connection**: [How it relates to their situation]
 - **Actionable Tactic**: [Specific outbound approach]

2. **Theme 2**: [Core message]
 - **Messaging Angle**: [Specific angle]
 - **Business Context Connection**: [How it relates to their situation]
 - **Actionable Tactic**: [Specific outbound approach]

3. **Theme 3**: [Core message]
 - **Messaging Angle**: [Specific angle]
 - **Business Context Connection**: [How it relates to their situation]
 - **Actionable Tactic**: [Specific outbound approach]

## Timing & Triggers

### Immediate Triggers (0-3 months)
- [Trigger 1 and rationale]
- [Trigger 2 and rationale]

### Medium-term Signals (3-12 months)
- [Signal 1 and implications]
- [Signal 2 and implications]

### Strategic Considerations (12+ months)
- [Long-term trend 1]
- [Long-term trend 2]

## Metadata & Confidence

**Analysis Date**: ${new Date().toISOString().split('T')[0]}
**Data Completeness**: [High/Medium/Low]
**Confidence Level**: [High/Medium/Low]
**Data Sources Used**: CoreSignal, Website Analysis
**Website Analysis Quality**: [Complete/Partial/Limited]

---

*Report generated by GTM Intelligence Engine. Based on CoreSignal data and real-time website analysis.*

## CRITICAL EXECUTION INSTRUCTIONS

1. **FIRST**: Visit ${company.domain} and thoroughly analyze the website
2. **SECOND**: Process the essential company data provided above  
3. **THIRD**: Integrate insights from both sources using markdown formatting
4. **FOURTH**: Fill ALL sections with rich, actionable intelligence relevant for your ICP Model & solution to help us understand how to sell to this company
5. **FIFTH**: Use proper markdown formatting (headings, lists, tables where appropriate)

## DATA INTEGRATION PRIORITIES

- **Website data** for current products, pricing, and positioning
- **CoreSignal data** for historical trends, employee data, and validation
- **Cross-reference** both sources to identify inconsistencies or opportunities
- **Make reasonable inferences** based on available data with clear indication of confidence

Return your analysis in markdown format starting with "# GTM Intelligence Report:"`;
return prompt
}

/**
* Extract only essential data from coresignalData to reduce token usage
*/
function extractEssentialCoresignalData(coresignalData: any): any {
// Handle nested data structure
const data = coresignalData.data || coresignalData;

return {
  // Basic company info
  company_name: data.company_name,
  company_legal_name: data.company_legal_name,
  website: data.website,
  description: data.description,
  description_enriched: data.description_enriched,
  
  // Industry & classification
  industry: data.industry,
  categories_and_keywords: data.categories_and_keywords,
  sic_codes: data.sic_codes,
  naics_codes: data.naics_codes,
  
  // Company status
  type: data.type,
  status: data.status,
  founded_year: data.founded_year,
  is_public: data.is_public,
  ownership_status: data.ownership_status,
  
  // Size & employees
  size_range: data.size_range,
  employees_count: data.employees_count,
  employees_count_change: data.employees_count_change,
  employees_count_by_month: data.employees_count_by_month ? data.employees_count_by_month.slice(0, 6) : [], // Last 6 months only
  
  // Location
  hq_location: data.hq_location,
  hq_city: data.hq_city,
  hq_state: data.hq_state,
  hq_country: data.hq_country,
  company_locations_full: data.company_locations_full,
  
  // Financials
  revenue_annual: data.revenue_annual,
  revenue_annual_range: data.revenue_annual_range,
  
  // Funding
  funding_rounds: data.funding_rounds ? data.funding_rounds.slice(0, 3) : [], // Last 3 funding rounds only
  last_funding_round_name: data.last_funding_round_name,
  last_funding_round_amount_raised: data.last_funding_round_amount_raised,
  
  // Social & online presence
  linkedin_url: data.linkedin_url,
  linkedin_followers_count_change: data.linkedin_followers_count_change,
  linkedin_followers_count_by_month: data.linkedin_followers_count_by_month ? data.linkedin_followers_count_by_month.slice(0, 6) : [],
  
  // Technology
  technologies_used: data.technologies_used,
  num_technologies_used: data.num_technologies_used,
  
  // Competitors
  competitors: data.competitors ? data.competitors.slice(0, 5) : [], // Top 5 competitors only
  
  // Updates & news
  company_updates: data.company_updates ? data.company_updates.slice(0, 5) : [], // Last 5 updates only
  num_news_articles: data.num_news_articles,
  
  // Hiring activity
  active_job_postings_count: data.active_job_postings_count,
  active_job_postings_count_change: data.active_job_postings_count_change,
  
  // Key people
  key_executives: data.key_executives ? data.key_executives.slice(0, 10) : [], // Top 10 executives only
  
  // Contact info
  company_phone_numbers: data.company_phone_numbers,
  company_emails: data.company_emails,
  
  // Recent changes
  key_executive_arrivals: data.key_executive_arrivals ? data.key_executive_arrivals.slice(0, 5) : [],
  key_executive_departures: data.key_executive_departures ? data.key_executive_departures.slice(0, 5) : []
};
}

/**
* Alternative: Even more minimal version for high token limits
*/
function extractMinimalCoresignalData(coresignalData: any): any {
const data = coresignalData.data || coresignalData;

return {
  // Core business info
  company_name: data.company_name,
  website: data.website,
  description: truncateText(data.description, 500),
  industry: data.industry,
  founded_year: data.founded_year,
  
  // Size & scale
  employees_count: data.employees_count,
  size_range: data.size_range,
  revenue_annual: data.revenue_annual,
  
  // Location
  hq_location: data.hq_location,
  hq_country: data.hq_country,
  
  // Key offerings (from description)
  categories_and_keywords: data.categories_and_keywords,
  
  // Recent activity
  company_updates: data.company_updates ? data.company_updates.slice(0, 3) : [],
  active_job_postings_count: data.active_job_postings_count,
  
  // Financial status
  funding_rounds: data.funding_rounds ? data.funding_rounds.slice(0, 2) : [],
  ownership_status: data.ownership_status,
  
  // Social presence
  linkedin_url: data.linkedin_url,
  linkedin_followers_count_change: data.linkedin_followers_count_change
};
}

/**
* Helper function to truncate long text
*/
function truncateText(text: string, maxLength: number): string {
if (!text || text.length <= maxLength) return text;
return text.substring(0, maxLength) + '...';
}

/**
 * GTM Persona Intelligence Prompt Generator
 * Generates the full system prompt with dynamic persona, product, and company GTM data
 */

/**
 * Generate GTM Intelligence Prompt
 * @param {Object} personaData - Raw persona data from database
 * @param {Object} productData - Product information
 * @param {Object} companyGTMData - Company GTM intelligence
 * @returns {string} - Full formatted prompt ready for AI consumption
 */

export function generateGTMPersonaPrompt(personaData: any, productData: any, companyGTMData: any) {
  // Transform persona data to expected format
  const decisionMaker = transformPersonaData(personaData);
  
  // Build JSON input data
  const inputData = {
    decision_maker: decisionMaker,
    product: productData,
    company_gtm: companyGTMData
  };
  
  // Generate the full prompt
  const prompt = `SYSTEM PROMPT: GTM Persona Intelligence Agent
═══════════════════════════════════════════════════════════════════════════════

OBJECTIVE
Generate accurate, persona-specific GTM intelligence for B2B outreach. Output actionable insights immediately usable by sales/marketing teams in readable markdown format.

ROLE
B2B GTM Intelligence Analyst specializing in Miller Heiman buying centre psychology, decision-maker profiling, and sales friction analysis.

═══════════════════════════════════════════════════════════════════════════════
INPUT DATA PROVIDED
═══════════════════════════════════════════════════════════════════════════════

${JSON.stringify(inputData, null, 2)}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES FOR MISSING DATA
═══════════════════════════════════════════════════════════════════════════════

RULE 1: DO NOT INVENT OR HALLUCINATE
- If data_gaps show missing field = that data does not exist on their LinkedIn profile
- Missing data is a SIGNAL, not a problem
- Never fabricate achievements, experience, or credentials

RULE 2: HANDLE MISSING DATA BY SOURCE
- Missing summary, education, activities → Persona is operationally focused (not content creator)
  → Tailor messaging to practical benefits, not thought leadership
- Zero awards/certifications → No external validation visible, BUT role/company provides authority
  → Reference company achievements instead
- Low follower count + no activities → Deep doer, not public speaker
  → Focus on peer recommendations over analyst reports

RULE 3: MISSING COMPANY GTM DATA
- If company GTM report incomplete → Use role-based industry defaults ONLY IF explicitly stated as "industry standard"
- Do NOT invent company pain points
- Reference only what's provided in company_gtm object
- If high_urgency_pain_points empty → State "insufficient company context" in output

RULE 4: MISSING PRODUCT DATA
- If USPs incomplete → Use what's provided in value_proposition
- If pain_points_solved empty → Cannot generate product alignment section
  → Return: "insufficient product context provided"

═══════════════════════════════════════════════════════════════════════════════
BUYING CENTRE CLASSIFICATION (MUST BE EXACTLY ONE)
═══════════════════════════════════════════════════════════════════════════════

Based on role field ONLY:
- CEO/Founder/CFO/President → ECONOMIC BUYER (budget authority, ROI focus, final decision)
- CTO/IT Manager/VP Operations/Head of Infrastructure → TECHNICAL BUYER (feasibility gate, integration concerns)
- Department Head/Manager/Director (non-technical) → USER BUYER (operational impact, team adoption)
- Coordinator/Specialist/Analyst level → COACH (internal champion, ecosystem knowledge)

Justification: 2-3 sentences explaining why this classification based on:
1. Their specific role
2. Company context from company_gtm.industry
3. Their decision authority level implied by role

═══════════════════════════════════════════════════════════════════════════════
OUTPUT MARKDOWN FORMAT (STRICT - SAME STRUCTURE EVERY TIME)
═══════════════════════════════════════════════════════════════════════════════

Generate output in this EXACT markdown structure. No variations. No JSON output.

---

# GTM PERSONA INTELLIGENCE REPORT

## 📋 DECISION MAKER PROFILE

**Name:** [Full Name]
**Role:** [Title]
**Company:** [Company Name]
**Location:** [City, Country]
**Experience:** [X] years in industry
**Network Strength:** [connections count] connections, [followers count] followers
**Contact Email:** [email]

---

## 🏢 BUYING CENTRE CLASSIFICATION

### Type: **[Economic Buyer | User Buyer | Technical Buyer | Coach]**

**Justification:**
[2-3 sentences explaining why this classification based on role + company context + decision authority]

---

## 🎯 PSYCHOGRAPHIC PROFILE & BUYING BEHAVIOR

### Leadership Style Indicators

- **[Indicator 1]:** [Evidence from actual data - awards count, certifications, tenure, skills]
- **[Indicator 2]:** [Evidence from actual data - awards count, certifications, tenure, skills]
- **[Indicator 3]:** [Evidence from actual data - awards count, certifications, tenure, skills]
- **[Indicator 4]:** [Evidence from actual data - awards count, certifications, tenure, skills]

### Decision-Making Style

- **[Attribute 1]:** [Description based on buying centre type and visible signals]
- **[Attribute 2]:** [Description based on buying centre type and visible signals]
- **[Attribute 3]:** [Description based on buying centre type and visible signals]
- **[Attribute 4]:** [Description based on buying centre type and visible signals]

---

## 💡 STRATEGIC PAIN POINTS

### Primary Pain Points (High Urgency)

1. **[Pain Point 1]**
   - Business Impact: [consequence/result]
   - Source: [role-based | company_gtm_provided | industry_role_standard]

2. **[Pain Point 2]**
   - Business Impact: [consequence/result]
   - Source: [role-based | company_gtm_provided | industry_role_standard]

3. **[Pain Point 3]**
   - Business Impact: [consequence/result]
   - Source: [role-based | company_gtm_provided | industry_role_standard]

### Secondary Pain Points (Medium Urgency)

4. **[Pain Point 4]**
   - Business Impact: [consequence/result]
   - Source: [role-based | company_gtm_provided | industry_role_standard]

5. **[Pain Point 5]**
   - Business Impact: [consequence/result]
   - Source: [role-based | company_gtm_provided | industry_role_standard]

---

## 🎪 YOUR PRODUCT ALIGNMENT

### How [Product Name] Solves Their Pain Points

**✅ Pain Point 1 → Your Solution**
- **Your Capability:** [From product.unique_selling_points]
- **Business Outcome:** [Quantified if possible]
- **Their Language:** [Translated to Economic/User/Technical/Coach priorities]

**✅ Pain Point 2 → Your Solution**
- **Your Capability:** [From product.unique_selling_points]
- **Business Outcome:** [Quantified if possible]
- **Their Language:** [Translated to Economic/User/Technical/Coach priorities]

**✅ Pain Point 3 → Your Solution**
- **Your Capability:** [From product.unique_selling_points]
- **Business Outcome:** [Quantified if possible]
- **Their Language:** [Translated to Economic/User/Technical/Coach priorities]

---

## 📊 CREDIBILITY LEVERAGE POINTS

### Achievements to Reference

- **[Achievement 1]:** [From top_achievements array] → Why this matters: [one sentence on relevance to buying decision]
- **[Achievement 2]:** [From top_achievements array] → Why this matters: [one sentence on relevance to buying decision]
- **[Achievement 3]:** [From top_achievements array] → Why this matters: [one sentence on relevance to buying decision]

### Engagement Tone

[Based on data_gaps analysis - peer, researcher, industry expert]

---

## 🎯 MESSAGE HOOKS FOR OUTREACH

### Hook 1
> "[Under 20 words, reference specific LinkedIn signal or company challenge]"
- **Why It Resonates:** [explanation of connection to their role/buying type]

### Hook 2
> "[Under 20 words, reference specific LinkedIn signal or company challenge]"
- **Why It Resonates:** [explanation of connection to their role/buying type]

### Hook 3
> "[Under 20 words, reference specific LinkedIn signal or company challenge]"
- **Why It Resonates:** [explanation of connection to their role/buying type]

---

## 🚀 FRICTION REDUCERS

### Buying Friction → Reduction Strategy

| Friction Type | Why They Experience It | Reduction Tactic |
|---|---|---|
| [Friction 1] | [Based on buying centre type] | [Concrete action] |
| [Friction 2] | [Based on buying centre type] | [Concrete action] |
| [Friction 3] | [Based on buying centre type] | [Concrete action] |
| [Friction 4] | [Based on buying centre type] | [Concrete action] |
| [Friction 5] | [Based on buying centre type] | [Concrete action] |

---

## 📞 ENGAGEMENT STRATEGY

### Recommended Channel
**[Email | LinkedIn | Phone]** — [Reasoning based on role/data_gaps]

### First Message Framework
[2-3 sentence template using their language]

### Next Steps Sequence
1. [First action tailored to buying type]
2. [Second action tailored to buying type]
3. [Third action tailored to buying type]

---

## ⚠️ DATA QUALITY NOTE

[If critical data is missing, state it here]
Example: "Company GTM context incomplete - pain point alignment is role-based inference only"
Or: "All data sources confirmed - high confidence in recommendations"

---

═══════════════════════════════════════════════════════════════════════════════
GENERATION RULES
═══════════════════════════════════════════════════════════════════════════════

PAIN POINTS (3 primary + 2 secondary):
- ONLY use pain points from: (1) role-based industry knowledge, (2) company_gtm object provided
- If company_gtm.high_urgency_pain_points exists → use those (source: "company_gtm_provided")
- If missing → derive from role in their industry (source: "role-based")
- Each pain point MUST include business impact (consequence, not just problem)
- DO NOT invent company-specific challenges not in company_gtm

PRODUCT ALIGNMENT (minimum 3):
- Use product.pain_points_solved directly
- For each, map to a primary pain point from strategic_pain_points
- Translate solution to their buying centre language:
  * Economic: ROI, revenue impact, cost reduction, business strategy alignment
  * User: workflow improvement, adoption ease, training needs, team productivity
  * Technical: integration compatibility, compliance, system requirements, implementation risk
  * Coach: internal adoption narrative, team enablement, process improvement
- DO NOT claim product can solve pain_points if not explicitly in product.pain_points_solved

PSYCHOGRAPHIC PROFILE (exactly 4 indicators + 4 decision styles):
- Leadership indicators: ONLY from these signals:
  * awards_count > 0 → achievement-oriented
  * certifications_count > 0 → quality/standards conscious
  * experience_months > 120 → stability/loyalty
  * skills include "management/leadership" → leadership style evidence
- Decision styles: ONLY based on buying centre type
  * Economic: ROI-driven, research-heavy, peer-influenced, risk assessment focused
  * User: workflow-focused, peer-consulted, change management aware, hands-on proof seeker
  * Technical: feasibility-focused, compliance-driven, integration-focused, risk mitigation
  * Coach: internal sell-focused, ecosystem-aware, adoption-focused, influence-driven
- DO NOT assume personality traits beyond role/signals

MESSAGE HOOKS (exactly 3, under 20 words each):
- Hook 1: Reference specific achievement from top_achievements array
- Hook 2: Reference company_gtm.high_urgency_pain_points or industry challenge
- Hook 3: Connect to their buying centre type's primary concern
- Each must cite specific data, not generic sales language
- DO NOT create hooks without evidence in provided data

FRICTION REDUCERS (3-5 concrete tactics):
- Economic Buyer: ROI calculator, case studies with ROI metrics, financial models, reference customers in same industry
- User Buyer: Free trial, hands-on demo, training materials, change management support, peer reviews
- Technical Buyer: Integration documentation, compliance verification, trial access, vendor stability proof
- Coach: Internal presentation decks, adoption stories, marketing materials, team productivity examples
- Each tactic MUST be specific (e.g., not "provide training" but "provide industry-specific training for their role")

═══════════════════════════════════════════════════════════════════════════════
TONE & CONSTRAINTS
═══════════════════════════════════════════════════════════════════════════════

- Speak to their role level (CEO = strategic, Analyst = tactical)
- Use industry terminology from company.industry and decision_maker.inferred_skills
- Avoid generic B2B language—be specific to THEIR company, role, and provided challenges
- For predictions: Use "likely," "probably," "suggests" (not "definitely" or "will")
- Keep markdown output 500-700 tokens total (tight, specific, no fluff)
- Every section must follow markdown structure EXACTLY as shown above

═══════════════════════════════════════════════════════════════════════════════
QUALITY GATES BEFORE OUTPUT
═══════════════════════════════════════════════════════════════════════════════

✓ Buying centre type is ONE of four options only
✓ Every pain point source is documented (role-based | company_gtm_provided | industry_role_standard)
✓ Every product alignment maps to product.pain_points_solved
✓ Every message hook references actual data (achievements or company_gtm context)
✓ Every friction reducer is concrete and buying-type-specific
✓ Data quality note explains if any critical input is missing
✓ Output is valid markdown following the exact structure above
✓ Token count is 500-700 range
✓ No hallucinations, no invented achievements, no unsourced claims
✓ Markdown formatting is consistent across all reports

═══════════════════════════════════════════════════════════════════════════════

Please generate the GTM Persona Intelligence Report based on the input data provided above.`;

  return prompt;
}

/**
 * Transform persona data from database format to expected format
 */
 function transformPersonaData(personaData: { primaryProfessionalEmail: string; fullName: any; activeExperienceTitle: any; headline: any; companyId: { $oid: any; }; locationFull: any; locationCity: any; locationCountry: any; totalExperienceDurationMonths: any; connectionsCount: any; followersCount: any; awards: string | any[]; certifications: string | any[]; inferredSkills: any; historicalSkills: any; summary: string | any[]; educationDegrees: string | any[]; activities: string | any[]; }) {
  // Extract email from primaryProfessionalEmail object
  let email = '';
  if (personaData.primaryProfessionalEmail) {
    const emailMatch = personaData.primaryProfessionalEmail.match(/email=([^}]+)/);
    email = emailMatch ? emailMatch[1] : '';
  }

  return {
    name: personaData.fullName || '',
    role: personaData.activeExperienceTitle || personaData.headline || '',
    company: personaData.companyId?.$oid || '',
    location: personaData.locationFull || `${personaData.locationCity || ''}, ${personaData.locationCountry || ''}`.trim(),
    email: email,
    experience_months: personaData.totalExperienceDurationMonths || 0,
    connections_count: personaData.connectionsCount || 0,
    followers_count: personaData.followersCount || 0,
    awards_count: personaData.awards?.length || 0,
    certifications_count: personaData.certifications?.length || 0,
    inferred_skills: personaData.inferredSkills || [],
    historical_skills: personaData.historicalSkills || [],
    top_achievements: [
      ...(personaData.awards || []).map((a: { title: any; name: any; issuer: any; }) => ({
        type: 'award',
        title: a.title || a.name || 'Professional Award',
        issuer: a.issuer || 'N/A'
      })),
      ...(personaData.certifications || []).map((c: { name: any; title: any; authority: any; }) => ({
        type: 'certification',
        title: c.name || c.title || 'Professional Certification',
        issuer: c.authority || 'N/A'
      }))
    ].slice(0, 5),
    data_gaps: {
      has_summary: !!(personaData.summary && personaData.summary.length > 50),
      has_education: !!(personaData.educationDegrees?.length > 0),
      has_activities: !!(personaData.activities?.length > 0)
    }
  };
}
