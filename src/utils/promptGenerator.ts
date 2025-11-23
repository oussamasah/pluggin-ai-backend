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
  
    // Build the dynamic prompt with FULL Company enrichement data and markdown output
    const prompt = `
  ## Role & Objective
  
  You are an expert GTM (Go-To-Market) research analyst specializing in deep company intelligence for B2B sales and outbound prospecting. Your task is to transform comprehensive company data into actionable GTM intelligence relevant for YOUR ICP MODEL & SOLUTION.
  
  **CRITICAL OUTPUT REQUIREMENT**: You must return your analysis in MARKDOWN format using the exact structure specified below. Do not return JSON.
  
  ## DATA SOURCES & INSTRUCTIONS
  
  ### 1. COMPREHENSIVE Company enrichement DATA
  Below is the complete Company enrichement company intelligence data in JSON format. Use ALL available fields for your analysis:
  
  \`\`\`json
  ${JSON.stringify(coresignalData, null, 2)}
  \`\`\`
  
  ### 2. COMPANY WEBSITE ANALYSIS REQUIRED
  **IMPORTANT**: You MUST visit and analyze the company website to gather additional intelligence:
  - **Website URL**: ${company.domain}
  - **Required Website Analysis**: Extract information about their products, services, pricing, case studies, customer testimonials, team, culture, recent updates, and any other relevant GTM intelligence.
  
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
  *(Key technologies used based on Company enrichement and website analysis)*
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
  **Data Sources Used**: Company enrichement, Website Analysis
  **Website Analysis Quality**: [Complete/Partial/Limited]
  
  ---
  
  *Report generated by GTM Intelligence Engine. Based on Company enrichement data and real-time website analysis.*
  
  ## CRITICAL EXECUTION INSTRUCTIONS
  
  1. **FIRST**: Visit ${company.domain} and thoroughly analyze the website
  2. **SECOND**: Process the complete Company enrichement JSON data provided above  
  3. **THIRD**: Integrate insights from both sources using markdown formatting
  4. **FOURTH**: Fill ALL sections with rich, actionable intelligence relevant for your ICP Model & solution to help us understand how to sale to the this company (Company enrichement)
  5. **FIFTH**: Use proper markdown formatting (headings, lists, tables where appropriate)
  
  ## DATA INTEGRATION PRIORITIES
  
  - **Website data** for current products, pricing, and positioning
  - **Company enrichement data** for historical trends, employee data, and validation
  - **Cross-reference** both sources to identify inconsistencies or opportunities
  - **Make reasonable inferences** based on available data with clear indication of confidence
  
  Return your analysis in markdown format starting with "# GTM Intelligence Report:"`;
  return prompt
}