// src/workflows/CompanyWorkflow.ts
import { v4 as uuidv4 } from 'uuid';
import { ExaCompany, exaService } from '../services/ExaService.js';
import { exploriumService } from '../services/ExploriumService.js';
import { ollamaService } from '../services/OllamaService.js';
import { wsManager } from '../websocket/WebSocketManager.js';
import { SearchStatus, SubStep, Company, ICPModel } from '../core/types.js';
import { sessionService } from '../services/SessionService.js';
import fs from 'fs/promises';
import path from 'path';

import { QueryMergerService } from '../services/QueryMergerService.js';
import { LLMQueryFilterExtractor } from '../services/LLMQueryFilterExtractor .js';
import { mapCoresignalToCompany } from '../services/CoreSignalToCompany.js';
import { CoreSignalService } from '../services/CoresignalService.js';
import { supabaseService } from '../services/SupabaseService.js';
export class CompanyWorkflow {
  private sessionId: string;
  private userId: string;

  constructor(sessionId: string, userId: string) {
    this.sessionId = sessionId;
    this.userId = userId;
  }

  private async updateStatus(status: Partial<SearchStatus>) {
    try {
      // Save to database first
      await sessionService.updateSearchStatus(this.sessionId, status);
      
      // Then broadcast via WebSocket
      const message = {
        type: 'workflow-status',
        sessionId: this.sessionId,
        data: {
          ...status,
          substeps: status.substeps || []
        }
      };
      
      //console.log('📤 Sending workflow-status:', { type: message.type, progress: status.progress, stage: status.stage });
      wsManager.broadcastToSession(this.sessionId, message);
    } catch (error) {
      console.error('Error updating search status:', error);
    }
  }

  private async updateSubstep(stepId: string, updates: Partial<SubStep>) {
    try {
      const substep: SubStep = {
        id: stepId,
        name: updates.name || '',
        status: updates.status || 'pending',
        ...updates
      };
      
      // Save to database
      await sessionService.updateSubstep(this.sessionId, substep);
      
      // Broadcast via WebSocket
      const message = {
        type: 'workflow-substep',
        sessionId: this.sessionId,
        data: {
          stepId,
          ...updates
        }
      };
      
      //console.log('📤 Sending workflow-substep:', { stepId, status: updates.status, message: updates.message });
      wsManager.broadcastToSession(this.sessionId, message);
    } catch (error) {
      console.error('Error updating substep:', error);
    }
  }



// In CompanyWorkflow.ts - FIX THE VARIABLE NAME
private async sendSearchComplete(companies: Company[], resultsCount: number, searchSummary: string) {
  try {
    // Update final status
    await this.updateStatus({
      stage: 'complete',
      message: `Search completed! Found ${resultsCount} companies.`,
      progress: 100,
      currentStep: 4,
      totalSteps: 4,
      details: searchSummary
    });
    
    // Broadcast completion - FIX: Use searchSummary instead of undefined 'summary'
    const message = {
      type: 'search-complete',
      sessionId: this.sessionId,
      companies,
      summary: searchSummary, // FIXED: Changed from undefined 'summary' to 'searchSummary'
      resultsCount,
      timestamp: new Date().toISOString()
    };
    
    //console.log('📤 Sending search-complete:', { resultsCount });
    wsManager.broadcastToSession(this.sessionId, message);
  } catch (error) {
    console.error('Error completing search:', error);
  }
}


  async execute(query: string, icpModel: ICPModel): Promise<Company[]> {

    let companies: any = [];


    try {
      // Update session query in database
      await sessionService.updateSessionQuery(this.sessionId, [query]);

      // PHASE 1: Initial Setup - Match frontend Task 1
      //console.log('🚀 Starting workflow execution - Matching frontend structure');
      await this.updateStatus({
        stage: 'searching',
        message: 'Processing company search request',
        progress: 10,
        currentStep: 1,
        totalSteps: 4,
        substeps: [
          // Task 1: Query Processing & Filter Extraction
          { 
            id: '1.1',
            name: 'Analyzing user query', 
            description: 'Extracting filters and criteria from user request',
            status: 'pending', 
            category: 'query-processing',
            priority: 'high',
            tools: ['filter-extractor', 'nlp-processor'],
            message: 'Starting query analysis...' 
          },
          { 
            id: '1.2',
            name: 'Converting to CoreSignal format', 
            description: 'Transforming extracted filters to CoreSignal API format',
            status: 'pending', 
            category: 'query-processing',
            priority: 'high',
            tools: ['api-adapter', 'format-converter'],
            message: 'Processing filter conversion' 
          },
          { 
            id: '1.3',
            name: 'Validating search parameters', 
            description: 'Ensuring search criteria are properly formatted',
            status: 'pending', 
            category: 'query-processing',
            priority: 'medium',
            tools: ['validation-service', 'parameter-checker'],
            message: 'Validating search parameters' 
          },
          
          // Task 2: Company Search & Data Collection
          { 
            id: '2.1',
            name: 'Executing CoreSignal search', 
            description: 'Searching companies using CoreSignal API',
            status: 'pending', 
            category: 'search-execution',
            priority: 'high',
            tools: ['core-signal-api', 'search-engine'],
            message: 'Initiating company search' 
          },
          { 
            id: '2.2',
            name: 'Collecting search results', 
            description: 'Gathering and paginating through company results',
            status: 'pending', 
            category: 'search-execution',
            priority: 'high',
            tools: ['data-collector', 'pagination-handler'],
            message: 'Collecting company data' 
          },
          { 
            id: '2.3',
            name: 'Processing raw company data', 
            description: 'Handling API response and data structure',
            status: 'pending', 
            category: 'search-execution',
            priority: 'medium',
            tools: ['data-processor', 'response-handler'],
            message: 'Processing raw data' 
          },
          
          // Task 3: Data Mapping & Standardization
          { 
            id: '3.1',
            name: 'Mapping to standard schema', 
            description: 'Converting CoreSignal data to unified company format',
            status: 'pending', 
            category: 'data-mapping',
            priority: 'high',
            tools: ['data-mapper', 'schema-converter'],
            message: 'Starting data mapping' 
          },
          { 
            id: '3.2',
            name: 'Handling missing data', 
            description: 'Managing null/undefined fields in mapping process',
            status: 'pending', 
            category: 'data-mapping',
            priority: 'medium',
            tools: ['null-handler', 'data-cleaner'],
            message: 'Processing data completeness' 
          },
          { 
            id: '3.3',
            name: 'Validating mapped data', 
            description: 'Ensuring data integrity after mapping',
            status: 'pending', 
            category: 'data-mapping',
            priority: 'medium',
            tools: ['validation-service', 'quality-check'],
            message: 'Validating mapped companies' 
          },
          
          // Task 4: Results Preparation
          { 
            id: '4.1',
            name: 'Finalizing company list', 
            description: 'Preparing enriched company objects for output',
            status: 'pending', 
            category: 'results-preparation',
            priority: 'medium',
            tools: ['result-compiler', 'data-formatter'],
            message: 'Finalizing results' 
          },
          { 
            id: '4.2',
            name: 'Generating search summary', 
            description: 'Creating overview of search results and metrics',
            status: 'pending', 
            category: 'results-preparation',
            priority: 'low',
            tools: ['summary-generator', 'metrics-calculator'],
            message: 'Generating summary report' 
          },
          { 
            id: '4.3',
            name: 'Preparing response format', 
            description: 'Structuring final output for client consumption',
            status: 'pending', 
            category: 'results-preparation',
            priority: 'low',
            tools: ['response-builder', 'format-adapter'],
            message: 'Preparing final response' 
          }
        ]
      });


      // TASK 1: Company Search - Exact frontend match
      //console.log('🔍 Starting TASK 1: Company Search');
      await this.updateSubstep('1.1', {
        status: 'in-progress',
        startedAt: new Date()
      });
    
// In your workflow execution
let querymerge = new QueryMergerService();
const mergedQuery = await querymerge.mergeICPWithUserQuery(query, icpModel);
console.log("merged user query with icp config",mergedQuery)
await this.updateSubstep('1.1', {
  status: 'completed',
  completedAt: new Date()
});
await this.updateSubstep('1.2', {
  status: 'in-progress',
  startedAt: new Date()
});
// In your workflow
const extractor = new LLMQueryFilterExtractor();
const coreSignal = new CoreSignalService();


// Extract filters using LLM
// //console.log("mergedQuery.structuredQuery",mergedQuery.structuredQuery)
//const extractedFilters = await extractor.extractFilters(`compaines in ${icpModel.config.geographies} has size of ${icpModel.config.employeeRange} and in the industries of ${icpModel.config.industries}`);


//const extractedFilters = await extractor.extractFilters(mergedQuery.structuredQuery);

 //console.log('📊 Extracted Filters:', extractedFilters);
 await this.updateSubstep('1.2', {
  status: 'completed',
  startedAt: new Date()
});
await this.updateSubstep('1.3', {
  status: 'in-progress',
  startedAt: new Date()
});

// Convert to CoreSignal format
//const coreSignalFilters = extractor.convertToCoreSignalFormat(extractedFilters);
//console.log("coreSignalFilters from extractedFilters",extractedFilters)

//console.log('🔧 CoreSignal Filters:', coreSignalFilters);
await this.updateSubstep('1.3', {
  status: 'completed',
  startedAt: new Date()
});
await this.updateSubstep('2.1', {
  status: 'in-progress',
  startedAt: new Date()
});
// Search companies

const exacompanies = await  exaService.searchCompanies(mergedQuery.structuredQuery,1)
console.log("exacompanies=====================================")
/*const result = await coreSignal.searchCompanies(coreSignalFilters, {
  itemsPerPage: 2
});*/
console.log( exacompanies.exaCompanies,null,2)
console.log( exacompanies.exaCompanies[0],null,2)



await this.updateSubstep('2.1', {
  status: 'completed',
  message:`Search done ${ exacompanies.exaCompanies?.length} founded`,
  startedAt: new Date()
});
await this.updateSubstep('2.2', {
  status: 'in-progress',
  message:`Search done ${ exacompanies.exaCompanies?.length} founded`,
  startedAt: new Date()
});
await this.updateSubstep('2.2', {
  status: 'completed',
  startedAt: new Date()
});
await this.updateSubstep('2.3', {
  status: 'in-progress',
  startedAt: new Date()
});
      const listurls:string[] = exacompanies.exaCompanies.map((c:any)=>c.properties.url)
//let companiesList = await coreSignal.collectCompanies(result.data)
let companiesList = await coreSignal.enrichCompaniesByUrls(listurls)
//await this.saveCompanies(this.sessionId,companiesList)


await this.updateSubstep('2.3', {
  status: 'completed',
  startedAt: new Date()
});
await this.updateSubstep('3.1', {
  status: 'in-progress',
  startedAt: new Date()
});
companies = await Promise.all(
  companiesList.map(c => this.transformToCompany(c))
)
console.log("--------------------------------------")
await this.saveCompanies(this.sessionId,companies)

await this.updateSubstep('3.1', {
  status: 'completed',
  startedAt: new Date()
});
await this.updateSubstep('3.2', {
  status: 'in-progress',
  startedAt: new Date()
});


await this.updateSubstep('3.2', {
  status: 'completed',
  startedAt: new Date()
});  



await this.updateSubstep('3.3', {
  status: 'in-progress',
  startedAt: new Date()
}); 
for (const c of companies) {
  const fitscore = await ollamaService.scoreCompanyFit(c, icpModel.config);

  // Ensure the key exists
  c.scoring_metrics = c.scoring_metrics ?? {};
  c.scoring_metrics.fit_score = fitscore;
}

await this.updateSubstep('3.3', {
  status: 'completed',
  startedAt: new Date()
});  
await this.updateSubstep('4.1', {
  status: 'in-progress',
  startedAt: new Date()
}); 

for (const c of companies) {
  const intentscore = await ollamaService.scoreCompanyIntent(c, icpModel);

  c.scoring_metrics = c.scoring_metrics ?? {};

  c.scoring_metrics.intent_score = intentscore;
}

companies.forEach(async(com:any)=>{
 await supabaseService.saveCompanyWithSessionAndICP(this.sessionId,icpModel.id,com)
 })

await this.updateSubstep('4.1', {
  status: 'completed',
  startedAt: new Date()
});  
await this.updateSubstep('4.2', {
  status: 'in-progress',
  startedAt: new Date()
}); 
      // TODO: Implement actual insights generation
      //console.log('⚠️ STEP 4.3: Generate insights - Need to implement actual insights generation');
      const searchSummary = await ollamaService.generateSearchSummary(query, icpModel, companies, companies.length);
      
      await this.updateSubstep('4.2', {
        status: 'completed',
        startedAt: new Date()
      }); 
      await this.updateSubstep('4.2', {
        status: 'completed',
        startedAt: new Date()
      }); 
      // FINAL: Complete
      //console.log('🎉 Workflow completed successfully!');
      await this.updateSubstep('4.3', {
        status: 'in-progress',
        startedAt: new Date()
      }); 

 
      // This will save final companies and update status
      await this.sendSearchComplete(companies, companies.length,searchSummary);
      await this.updateSubstep('4.3', {
        status: 'completed',
        startedAt: new Date()
      }); 
console.log(JSON.stringify(delete companies["enrichement"]))
console.log(JSON.stringify(icpModel.config))

      return companies;

    } catch (error : any) {
      console.error('❌ Workflow error:', error);
      
      // Mark all steps as error in database
      const errorSubsteps = [
        '1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3'
      ];
      
      for (const stepId of errorSubsteps) {
        await this.updateSubstep(stepId, {
          status: 'error',
          message: 'Workflow failed'
        });
      }

      // Update status to error in database
      await this.updateStatus({
        stage: 'error',
        message: error,
        progress: 0
      });

      // Send error message via WebSocket
      wsManager.broadcastToSession(this.sessionId, {
        type: 'search-error',
        sessionId: this.sessionId,
        error: error
      });

      throw error;
    }
  }

  transformToCompany(rawData: any): Promise<Company> {
    // Extract domain from website or set null
    const extractDomain = (url?: string): string => {
      if (!url) return '';
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        return urlObj.hostname.replace('www.', '');
      } catch {
        return url || '';
      }
    };
  
    // Determine business model based on available data
    const determineBusinessModel = (data: any): Company['business_model'] | undefined => {
      if (data.is_b2b === true) return "B2B";
      if (data.is_b2b === false) return "B2C";
      return undefined;
    };
  
    // Determine target market based on employee count
    const determineTargetMarket = (empCount?: number): Company['target_market'] | undefined => {
      if (!empCount) return undefined;
      if (empCount < 50) return "SMB";
      if (empCount < 500) return "Mid-Market";
      if (empCount >= 500) return "Enterprise";
      return undefined;
    };
  
    // Determine ownership type
    const determineOwnershipType = (isPublic?: boolean, parentInfo?: any): Company['ownership_type'] | undefined => {
      if (isPublic === true) return "Public";
      if (parentInfo) return "Subsidiary";
      if (isPublic === false) return "Private";
      return undefined;
    };
  
    // Determine funding stage
    const determineFundingStage = (data: any): Company['funding_stage'] | undefined => {
      if (data.is_public) return "Public";
      if (data.last_funding_round_name) {
        const round = data.last_funding_round_name.toLowerCase();
        if (round.includes('seed')) return "Seed";
        if (round.includes('series a')) return "Series A";
        if (round.includes('series b')) return "Series B";
        if (round.includes('series c')) return "Series C";
      }
      return data.last_funding_round_name ? undefined : "Bootstrapped";
    };
  
    // Build the company object
    const company: Company = {
      
      // Basic Identity
      name: rawData.company_name || '',
      domain: extractDomain(rawData.website),
      website: rawData.website || undefined,
      logo_url: rawData.company_logo_url || undefined,
      description: rawData.description || rawData.description_enriched || undefined,
      founded_year: rawData.founded_year ? parseInt(rawData.founded_year) : undefined,
  
      // Location & Contact
      location: {
        city: rawData.hq_city || undefined,
        country: rawData.hq_country || undefined,
        country_code: rawData.hq_country_iso2 || undefined,
      },
      contact: {
        email: rawData.company_emails?.[0] || undefined,
        phone: rawData.company_phone_numbers?.[0] || undefined,
      },
      social_profiles: {
        linkedin: rawData.linkedin_url || undefined,
        twitter: rawData.twitter_url?.[0] || undefined,
        facebook: rawData.facebook_url?.[0] || undefined,
        instagram: rawData.instagram_url?.[0] || undefined,
        crunchbase: rawData.crunchbase_url || undefined,
      },
  
      // Business Profile
      industry: rawData.industry ? [rawData.industry] : [],
      business_model: determineBusinessModel(rawData),
      target_market: determineTargetMarket(rawData.employees_count),
      ownership_type: determineOwnershipType(rawData.is_public, rawData.parent_company_information),
  
      // Firmographics
      employee_count: rawData.employees_count || undefined,
      revenue_estimated: rawData.revenue_annual || undefined,
      funding_stage: determineFundingStage(rawData),
      total_funding: rawData.last_funding_round_amount_raised || undefined,
  
      // Technographics
      technologies: rawData.technologies_used?.map((t: any) => t.technology) || undefined,
  
      // Intent & Activity
      intent_signals: rawData.company_updates?.slice(0, 5).map((update: any) => ({
        name: 'company_update',
        detected_date: new Date(update.date),
        confidence: update.reactions_count || 0,
      })) || undefined,
  
      // Relationships
      relationships: {
        customers: undefined,
        partners: undefined,
        competitors: rawData.competitors?.map((c: any) => c.name || c) || undefined,
      },
  
      // Scoring Metrics (initialized to null, to be calculated separately)
      scoring_metrics: undefined,
  
      // Store original enrichment data
      enrichement: rawData,
    };
  
    // Clean up undefined nested objects
    if (!company.location?.city && !company.location?.country && !company.location?.country_code) {
      company.location = undefined;
    }
    if (!company.contact?.email && !company.contact?.phone) {
      company.contact = undefined;
    }
    if (!company.social_profiles?.linkedin && !company.social_profiles?.twitter && 
        !company.social_profiles?.facebook && !company.social_profiles?.instagram && 
        !company.social_profiles?.crunchbase) {
      company.social_profiles = undefined;
    }
    if (!company.relationships?.customers && !company.relationships?.partners && 
        !company.relationships?.competitors) {
      company.relationships = undefined;
    }
  
    // ✅ FIX: Return Promise.resolve() instead of new Promise()
    return Promise.resolve(company);
  }
  async saveCompanies(sessionId: string, companies: any): Promise<void> {
    try {
      //console.log(`💾 Saving ${companies.length} companies...`);
      
      // Save companies array as JSON file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `companies-${sessionId}-${timestamp}.json`;
      const filePath = path.join(process.cwd(), 'companies-data', filename);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      
      // Simply stringify the entire companies array
      await fs.writeFile(filePath, JSON.stringify(companies, null, 2));
 
      //console.log(`✅ Successfully saved ${companies.length} companies to Supabase`);
      
    } catch (error) {
      console.error('❌ Error saving companies:', error);
      throw error;
    }
  }
  private async processCompany(
    websetId: any, 
    exaCompany: any, 
    icpModel: ICPModel, 
    companyIndex: number, 
    totalCompanies: number
  ): Promise<Company | null> {
    const companyName = exaCompany.properties?.company?.name || 'Unknown Company';
    //console.log(`🔍 Processing company: ${companyName}`);
    
    try {
      // Enrich with Explorium - This covers parts of step 2.1
      //console.log(`🔍 Matching business with Explorium: ${companyName}`);
      const exploriumId = await exploriumService.matchBusiness(
        companyName,
        exaCompany.properties?.url
      );

      if (!exploriumId) {
        //console.log(`❌ No Explorium match for ${companyName}`);
       let exaEnrichments = await exaService.createAndWaitForEnrichment({websetId,icpModel})
       const icpScore = await ollamaService.scoreCompanyFit(
        exaCompany,
        icpModel.config
      );
        // Build company object
      const company: Company = {
        id: exaCompany.id || uuidv4(),
        name: companyName,
        description: exaCompany.properties?.description,
        criterian : exaCompany.evaluations?.criterion,
        satisfied : exaCompany.evaluations?.satisfied,
        reasoning : exaCompany.evaluations?.reasoning,
        references : exaCompany.evaluations?.references,
        exa_created_at : exaCompany?.createdAt,
        exa_updated_at : exaCompany?.updatedAt,
        content:exaCompany.properties?.content,
        website_traffic:null,
        prospects:null,
        about: exaCompany.properties?.company?.about,
        industry: exaCompany.properties?.company?.industry,
        employees: exaCompany.properties?.company?.employees,
        location:exaCompany.properties?.company?.location,
        logo_url: exaCompany.properties?.company?.logoUrl ,
        firmographic:null,
        website: exaCompany.properties?.url,
        linkedin_url:null,
        icp_score: icpScore,
        intent_score: 0,
        explorium_id:null,
        growth_signals: [],
        technologies: [], // TODO: Implement tech stack detection for step 2.3
        revenue:null,
        hiring:null
      };

      //console.log(`✅ Successfully built company object for ${companyName}`);
      return company;

      }

      //console.log(`✅ Found Explorium ID: ${exploriumId} for ${companyName}`);
      const [events, websiteTraffic, prospects, firmographic] = await Promise.all([
        exploriumService.getEvents(exploriumId, icpModel),
        exploriumService.getWebsiteTraffic(exploriumId),
        exploriumService.getProspects(exploriumId, icpModel),
        exploriumService.getFirmographic(exploriumId)
      ]);
      

      //console.log(`📊 Retrieved ${events.length} events and ${prospects.length} prospects for ${companyName}`);
      //console.log("==========================================================================");
   

      // Step 3.1 & 3.2: Apply scoring model and calculate fit score
      //console.log(`🎯 Scoring ICP fit for ${companyName}`);
      //console.log(`📊 Retrieved ${events.length} events, ${prospects.length} prospects, and ${websiteTraffic ? 'website traffic' : 'no traffic data'} for ${companyName}`);

      // Continue with scoring even if some data is missing
      const icpScore = await ollamaService.scoreCompanyFit(
        this.formatCompanyData(exaCompany, firmographic),
        icpModel.config
      );
      

      //console.log(`✅ ICP Score for ${companyName}: ${icpScore.score}/100`);

      // Step 4.1: Scan intent signals (partial implementation)
      //console.log(`🎯 Scoring intent for ${companyName}`);
      const intentScore = events.length > 0 
      ? await ollamaService.scoreCompanyIntent(events, icpModel.config)
      : { score: 0, reason: 'No events found', confidence: 0, factors: [] };

      //console.log(`✅ Intent Score for ${companyName}: ${intentScore.score}/100`);

      // Build company object
      const company: Company = {
        id: exaCompany.id || uuidv4(),
        name: companyName,
        description: exaCompany.properties?.description,
        criterian : exaCompany.evaluations?.criterion,
        satisfied : exaCompany.evaluations?.satisfied,
        reasoning : exaCompany.evaluations?.reasoning,
        references : exaCompany.evaluations?.references,
        exa_created_at : exaCompany?.createdAt,
        exa_updated_at : exaCompany?.updatedAt,
        content:exaCompany.properties?.content,
        website_traffic:websiteTraffic,
        prospects:prospects,
        about: exaCompany.properties?.company?.about,
        industry: exaCompany.properties?.company?.industry,
        employees: exaCompany.properties?.company?.employees,
        location: firmographic?.country_name || exaCompany.properties?.company?.location,
        logo_url: exaCompany.properties?.company?.logoUrl ||  firmographic?.business_logo,
        firmographic:firmographic,
        website: exaCompany.properties?.url,
        linkedin_url: firmographic?.linkedin_profile,
        icp_score: icpScore,
        intent_score: intentScore.score,
        explorium_id:exploriumId,
        growth_signals: events.map((e: any) => e.event_name),
        technologies: [], // TODO: Implement tech stack detection for step 2.3
        revenue: firmographic?.yearly_revenue_range,
        hiring: this.detectHiring(events)
      };

      //console.log(`✅ Successfully built company object for ${companyName}`);
      return company;

    } catch (error) {
      console.error(`❌ Error processing company ${companyName}:`, error);
      return null;
    }
  }

  private formatCompanyData(exaCompany: any, firmographic: any): any {
    return {
      name: exaCompany.properties?.company?.name,
      country_name: firmographic?.country_name || exaCompany.properties?.company?.location,
      number_of_employees_range: firmographic?.number_of_employees_range || exaCompany.properties?.company?.employees,
      business_description: firmographic?.business_description || exaCompany.properties?.company?.about,
      industry: firmographic?.industry || exaCompany.properties?.company?.industry,
      website: exaCompany.properties?.url,
      revenue_range: firmographic?.yearly_revenue_range,
      technologies: [] // Will be populated when tech stack is implemented
    };
  }

  private parseEmployeeCount(employeeRange: string): number {
    if (!employeeRange) return 0;
    
    const ranges: { [key: string]: number } = {
      '1-10': 5,
      '11-50': 30,
      '51-200': 125,
      '201-500': 350,
      '501-1000': 750,
      '1001-5000': 3000,
      '5001-10000': 7500,
      '10000+': 15000
    };
    
    return ranges[employeeRange] || 0;
  }

  private detectHiring(events: any[]): boolean {
    const hiringKeywords = ['hire', 'hiring', 'job', 'career', 'recruit', 'position'];
    return events.some(event => 
      hiringKeywords.some(keyword => 
        event.event_name?.toLowerCase().includes(keyword)
      )
    );
  }

  private logMissingImplementations() {
    console.log(`
    🔍 BACKEND IMPLEMENTATION STATUS:
    =================================
    
    ✅ IMPLEMENTED STEPS:
    - 1.1: Query database (Exa.ai integration)
    - 2.1: Fetch company details (Explorium integration)
    - 3.1: Apply scoring model (Ollama integration)
    - 3.2: Calculate fit score (Ollama integration)
    - 4.1: Scan intent signals (Partial - events analysis)
    
    ⚠️  NEEDS IMPLEMENTATION:
    - 1.2: Filter results - Add actual filtering logic
    - 1.3: Validate matches - Add validation logic
    - 2.2: Get financial data - Add financial data collection
    - 2.3: Enhance tech stack - Add tech stack detection
    - 3.3: Rank companies - Add ranking algorithm
    - 4.2: Evaluate engagement - Add engagement metrics
    - 4.3: Generate insights - Add insights generation
    
    💡 IMPLEMENTATION NOTES:
    - Steps 1.2 & 1.3: Currently simulated with timeouts
    - Step 2.2: Need financial API integration
    - Step 2.3: Need tech stack detection service
    - Step 3.3: Need ranking algorithm based on scores
    - Step 4.2: Need engagement metrics from Explorium or similar
    - Step 4.3: Need insights generation logic
    `);
  }
  private extractCompanyFilters(allFilters: any): any {
    return {
      industry: allFilters.industry,
      country: allFilters.country,
      location: allFilters.location,
      employees_count_gte: allFilters.employees_count_gte,
      employees_count_lte: allFilters.employees_count_lte,
      funding_last_round_type: allFilters.funding_last_round_type,
      funding_last_round_date_gte: allFilters.funding_last_round_date_gte,
      funding_last_round_date_lte: allFilters.funding_last_round_date_lte,
      funding_rounds_count_gte: allFilters.funding_rounds_count_gte
    };
  }
}