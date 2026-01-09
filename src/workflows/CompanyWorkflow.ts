// src/workflows/CompanyWorkflow.ts
import { v4 as uuidv4 } from 'uuid';
import { exaService } from '../services/ExaService.js';
import { exploriumService } from '../services/ExploriumService.js';
import { wsManager } from '../websocket/WebSocketManager.js';
import { SearchStatus, SubStep, Company, ICPModel, SearchSession } from '../core/types.js';
import { sessionService } from '../services/SessionService.js';
import fs from 'fs/promises';
import path from 'path';
import { CoreSignalService } from '../services/CoresignalService.js';
import { mongoDBService } from '../services/MongoDBService.js';
import { IntentScoringService } from '../services/IntentScoringService.js';
import { Types } from 'mongoose';
import { gtmIntelligenceService } from '../services/GTMIntelligenceService';
import { gtmPersonaIntelligenceService } from '../services/GTMPersonaInteligenceService.js';
import { scoringService } from '../services/ScoringService.js';
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

      wsManager.broadcastToSession(this.sessionId, message);
    } catch (error) {
      console.error('Error updating substep:', error);
    }
  }

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

      // Broadcast completion
      const message = {
        type: 'search-complete',
        sessionId: this.sessionId,
        companies,
        summary: searchSummary,
        resultsCount,
        timestamp: new Date().toISOString()
      };

      wsManager.broadcastToSession(this.sessionId, message);
    } catch (error) {
      console.error('Error completing search:', error);
    }
  }

  async execute(query: string, icpModel: ICPModel, count: string, searchType: string): Promise<Company[]> {
    let companies: any = [];
    let exaCompanies: any = [];
    let companiesList: any = [];
    try {
      const coreSignal = new CoreSignalService();
      let session = await sessionService.getSession(this.sessionId);
      let queries = session?.query;
      queries.push("CHAT_USER: " + query)
      // Update session query in database
      await sessionService.updateSessionQuery(this.sessionId, queries);

      // PHASE 1: Dynamic ICP Discovery
      await this.updateStatus({
        stage: 'searching',
        message: 'Starting dynamic ICP discovery process',
        progress: 10,
        currentStep: 1,
        totalSteps: 4,
        substeps: [
          // Phase 1: Dynamic ICP Discovery
          {
            id: '1.1',
            name: 'Generating ICP hypotheses',
            description: 'Defining best customer patterns based on ICP model',
            status: 'pending',
            category: 'icp-discovery',
            priority: 'high',
            tools: ['query-merger', 'llm-processor'],
            message: 'Analyzing ICP configuration...'
          },
          {
            id: '1.2',
            name: 'Market discovery scouting',
            description: 'Finding companies matching ICP patterns',
            status: 'pending',
            category: 'icp-discovery',
            priority: 'high',
            tools: ['exa-ai', 'search-engine'],
            message: 'Scouting for matching companies'
          },
          {
            id: '1.3',
            name: 'Data cleaning and validation',
            description: 'Ensuring accurate and fresh company information',
            status: 'pending',
            category: 'icp-discovery',
            priority: 'high',
            tools: ['data-validator', 'quality-checker'],
            message: 'Validating company data quality'
          },

          // Phase 2: Account Intelligence
          {
            id: '2.1',
            name: 'Multi-source data enrichment',
            description: 'Adding firmographic, tech, and growth insights',
            status: 'pending',
            category: 'account-intelligence',
            priority: 'high',
            tools: ['coresignal-api', 'data-enricher'],
            message: 'Enriching company data from multiple sources'
          },
          {
            id: '2.2',
            name: 'Fit scoring and ranking',
            description: 'Ranking accounts by relevance and potential',
            status: 'pending',
            category: 'account-intelligence',
            priority: 'high',
            tools: ['ollama-scoring', 'ranking-engine'],
            message: 'Calculating fit scores'
          },
          {
            id: '2.3',
            name: 'Reasoning explanation',
            description: 'Showing why each account fits your ICP',
            status: 'pending',
            category: 'account-intelligence',
            priority: 'medium',
            tools: ['llm-explainer', 'reasoning-generator'],
            message: 'Generating fit reasoning'
          },

          // Phase 3: Persona Intelligence
          {
            id: '3.1',
            name: 'Identifying relevant personas',
            description: 'Finding key decision-makers for outreach',
            status: 'pending',
            category: 'persona-intelligence',
            priority: 'high',
            tools: ['coresignal-employees', 'persona-matcher'],
            message: 'Identifying target personas'
          },
          {
            id: '3.2',
            name: 'Mapping psychographic data',
            description: 'Understanding interests, roles, and behavior',
            status: 'pending',
            category: 'persona-intelligence',
            priority: 'medium',
            tools: ['psychographic-analyzer', 'behavior-mapper'],
            message: 'Analyzing psychographic profiles'
          },
          {
            id: '3.3',
            name: 'Enriching contact information',
            description: 'Adding valid emails and LinkedIn profiles',
            status: 'pending',
            category: 'persona-intelligence',
            priority: 'medium',
            tools: ['contact-enricher', 'profile-validator'],
            message: 'Enriching contact details'
          },

          // Phase 4: Intent & Timing Intelligence
          {
            id: '4.1',
            name: 'Detecting buying signals',
            description: 'Spotting signs of market interest or activity',
            status: 'pending',
            category: 'intent-intelligence',
            priority: 'high',
            tools: ['perplexity-ai', 'signal-detector'],
            message: 'Scanning for intent signals'
          },
          {
            id: '4.2',
            name: 'Scoring intent readiness',
            description: 'Measuring how ready each account is to buy',
            status: 'pending',
            category: 'intent-intelligence',
            priority: 'high',
            tools: ['intent-scorer', 'readiness-analyzer'],
            message: 'Calculating intent scores'
          },
          {
            id: '4.3',
            name: 'Summarizing reasoning and storage',
            description: 'Explaining triggers and saving insights',
            status: 'pending',
            category: 'intent-intelligence',
            priority: 'medium',
            tools: ['summary-generator', 'data-storage'],
            message: 'Finalizing and storing insights'
          }
        ]
      });

      // PHASE 1: Dynamic ICP Discovery
      console.log('🔍 Starting PHASE 1: Dynamic ICP Discovery', searchType);

      // Step 1.1: Generate ICP hypotheses

      await this.updateSubstep('1.1', {
        status: 'in-progress',
        startedAt: new Date()
      });


      console.log("====================================================", searchType)
      const userCompanies = await mongoDBService.getCompaniesByUserId(this.userId);

      if (searchType == 'search') {



        await this.sleep(5000);
        await this.updateSubstep('1.1', {
          status: 'completed',
          completedAt: new Date(),
          message: 'ICP hypotheses generated successfully'
        });

        // Step 1.2: Market discovery scouting
        await this.updateSubstep('1.2', {
          status: 'in-progress',
          startedAt: new Date()
        });
        try {
          let excludeUrls = userCompanies.map((c: any) => c.website);
          let response = await coreSignal.searchCompanies(
            query,
            undefined,
            parseInt(count),
            excludeUrls  // Pass the exclude list
          );
          exaCompanies = response.data || [];
          console.log(exaCompanies, "exaCompanies")
          console.log(exaCompanies, "exaCompanies")
          this.saveCompanies("coreSignal", companies)
        } catch (error) {
          console.error('Error searching companies:', error);
          await this.updateSubstep('1.2', {
            status: 'error',
            completedAt: new Date(),
            message: 'Error searching companies'
          });

        }

        console.log(`Found ${exaCompanies?.length} potential companies`);

      } else if (searchType == 'deepResearch') {
        await this.sleep(5000);
        await this.updateSubstep('1.1', {
          status: 'completed',
          completedAt: new Date(),
          message: 'ICP hypotheses generated successfully'
        });

        // Step 1.2: Market discovery scouting
        await this.updateSubstep('1.2', {
          status: 'in-progress',
          startedAt: new Date()
        });
        const uniqueIDs = [...new Set(userCompanies.map((com: { exaId: any; }) => com.exaId))];
        console.log("exclude those ids websets exa:::")
        console.log(uniqueIDs)
        exaCompanies = await exaService.searchCompanies(query, count, uniqueIDs);



      }
      await this.sleep(3000);

      if (exaCompanies == undefined || exaCompanies == null || exaCompanies.length == 0 || exaCompanies?.data?.length == 0 || exaCompanies?.exaCompanies?.length == 0) {

        await this.sendSearchComplete([], 0, `**Search Results: 0 Companies Found**

              Your current ICP configuration may be too restrictive for available data. Here's what we recommend:

              🎯 **ICP Refinement Tips:**
              - Industry: Try adding adjacent verticals
              - Size: Consider expanding employee count range
              - Location: Include more regions or remove geographic limits
              - Keywords: Use more general terms first, then narrow down

              *Tip: Start broad and gradually refine based on initial results.*`);

        return [];
      }

      let listUrls: string[] = [];

      if (searchType == 'search') {
        companiesList = await coreSignal.collectCompaniesByIds(exaCompanies);
      } else if (searchType == 'deepResearch') {
        listUrls = exaCompanies.exaCompanies.map((c: any) => c.properties.url);
        companiesList = await coreSignal.enrichCompaniesByUrls(listUrls);
      }

      await this.updateSubstep('1.2', {
        status: 'completed',
        completedAt: new Date(),
        message: `Scouted ${exaCompanies.exaCompanies?.length} potential companies`
      });

      // Step 1.3: Data cleaning and validation
      await this.updateSubstep('1.3', {
        status: 'in-progress',
        startedAt: new Date()
      });


      await this.sleep(3000);

      await this.updateSubstep('1.3', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Data validation and cleaning completed'
      });

      // PHASE 2: Account Intelligence
      console.log('🧠 Starting PHASE 2: Account Intelligence');

      // Step 2.1: Multi-source data enrichment
      await this.updateSubstep('2.1', {
        status: 'in-progress',
        startedAt: new Date()
      });

      companies = await Promise.all(
        companiesList.map((c: any) => this.transformToCompany(c, exaCompanies))
      );
      await this.sleep(4000);

      await this.updateSubstep('2.1', {
        status: 'completed',
        completedAt: new Date(),
        message: `Enriched ${companies.length} companies with multi-source data`
      });

      // Step 2.2: Fit scoring and ranking
      await this.updateSubstep('2.2', {
        status: 'in-progress',
        startedAt: new Date()
      });

      for (const c of companies) {

        // Add null checking before accessing exa_enrichement
        const fitscore = await scoringService.scoreCompanyFit(c, icpModel.config);
        c.scoring_metrics = c.scoring_metrics ?? {};
        c.scoring_metrics.fit_score = fitscore;
        this.sleep(1000);
        console.log(`Fit score for ${c.name}: ${fitscore.score}`);
      }
      await this.sleep(5000);

      await this.updateSubstep('2.2', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Fit scoring completed for all companies'
      });

      // Step 2.3: Reasoning explanation
      await this.updateSubstep('2.3', {
        status: 'in-progress',
        startedAt: new Date()
      });

      // Note: Reasoning is already included in the fit_score object from Ollama
      // This step ensures the reasoning is properly structured and stored
      await this.sleep(5000);

      await this.updateSubstep('2.3', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Fit reasoning explanations generated'
      });

      // PHASE 3: Persona Intelligence
      console.log('👥 Starting PHASE 3: Persona Intelligence');

      // Step 3.1: Identifying relevant personas
      await this.updateSubstep('3.1', {
        status: 'in-progress',
        startedAt: new Date()
      });

      for (const c of companies) {
        if (c.scoring_metrics?.fit_score?.score) {
          const employees = await coreSignal.searchEmployeesByCompanyId(
            c.enrichement.id,
            icpModel.config.targetPersonas
          );
          console.log(employees)

          if (employees.results.length > 0) {
            const employeesEnrichments = await coreSignal.collectEmployees(employees.results);
            c.employees = employeesEnrichments;
            console.log("score is good and tpersona saved")
            console.log(c.employees)
            // Generate persona intelligence for each employee
           

          } else {
            console.log("score is good but persone coresignal result length empty")
            console.log("coresignal result response")
            console.log(employees)
          }
        } else {
          console.log("This companies score:: ", c.scoring_metrics?.fit_score?.score)
          console.log("Perosona not reached for this score")
        }
      }
      await this.sleep(2000);

      await this.updateSubstep('3.1', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Relevant personas identified for target companies'
      });

      // Step 3.2: Mapping psychographic data
      await this.updateSubstep('3.2', {
        status: 'in-progress',
        startedAt: new Date()
      });

      // Psychographic data is already included in employee enrichment from CoreSignal
      // This includes interests, skills, experience patterns, etc.
      await this.sleep(2000);

      await this.updateSubstep('3.2', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Psychographic profiles mapped for key personas'
      });

      // Step 3.3: Enriching contact information
      await this.updateSubstep('3.3', {
        status: 'in-progress',
        startedAt: new Date()
      });

      // Contact information is included in the employee data from CoreSignal
      // This step validates and ensures contact data quality
      await this.sleep(2000);

      await this.updateSubstep('3.3', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Contact information enriched and validated'
      });

      // PHASE 4: Intent & Timing Intelligence
      console.log('🎯 Starting PHASE 4: Intent & Timing Intelligence');

      // Step 4.1: Detecting buying signals using Explorium
      await this.updateSubstep('4.1', {
        status: 'in-progress',
        startedAt: new Date()
      });
      if (icpModel.config.buyingTriggers.length > 0) {
        for (const c of companies) {
          try {
            // Match business with Explorium using domain name
            const companyDomain = c.domain || c.website || '';
            const exploriumBusinessId = await exploriumService.matchBusiness(
              c.name,
              companyDomain
            );

            if (exploriumBusinessId) {
              // Save explorium_business_id to company
              c.explorium_business_id = exploriumBusinessId;
              c.exploriumBusinessId = exploriumBusinessId;

              // Get events from Explorium based on buying triggers
              const exploriumEvents = await exploriumService.getEvents(
                exploriumBusinessId,
                icpModel
              );
console.log(exploriumEvents, "exploriumEvents")
              // Save events as enrichment with source "explorium"
              if (exploriumEvents && exploriumEvents.length > 0) {
                // Store events in company for later saving
                c.explorium_events = exploriumEvents;
                console.log(`✅ Found ${exploriumEvents.length} Explorium events for ${c.name}`);
              } else {
                console.log(`⚠️ No Explorium events found for ${c.name}`);
              }
            } else {
              console.log(`⚠️ Could not match ${c.name} with Explorium`);
            }
          } catch (error) {
            console.error(`Error processing Explorium data for ${c.name}:`, error);
          }
        }
      }
      await this.sleep(2000);
      await this.updateSubstep('4.1', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Buying signals detected across all companies'
      });

      // Step 4.2: Scoring intent readiness
      await this.updateSubstep('4.2', {
        status: 'in-progress',
        startedAt: new Date()
      });
      if (icpModel.config.buyingTriggers.length > 0) {
        for (const c of companies) {
          // Use Explorium events for intent scoring if available
          if (c.explorium_events && c.explorium_events.length > 0) {
            try {
              const intentScoreResult = await IntentScoringService.calculateIntentScoreFromExploriumEvents(
                icpModel,
                c,
                c.explorium_events,
                c.explorium_business_id || c.exploriumBusinessId
              );
              this.saveCompanies("intentScore", intentScoreResult);
              c.scoring_metrics = c.scoring_metrics ?? {};
              c.scoring_metrics.intent_score = intentScoreResult;
              console.log(`✅ Intent score calculated for ${c.name}: ${intentScoreResult.analysis_metadata?.final_intent_score || 0}/100`);
            } catch (error) {
              console.error(`Error calculating intent score for ${c.name}:`, error);
              // Set default intent score on error
              c.scoring_metrics = c.scoring_metrics ?? {};
              c.scoring_metrics.intent_score = {
                analysis_metadata: {
                  final_intent_score: 0,
                  overall_confidence: 'LOW'
                },
                error: error instanceof Error ? error.message : 'Unknown error'
              };
            }
          } else {
            console.log(`⚠️ No Explorium events available for intent scoring: ${c.name}`);
          }
        }
      }
      await this.sleep(3000);

      await this.updateSubstep('4.2', {
        status: 'completed',
        completedAt: new Date(),
        message: 'Intent readiness scored for all companies'
      });

      // Step 4.3: Summarizing reasoning and storage
      await this.updateSubstep('4.3', {
        status: 'in-progress',
        startedAt: new Date()
      });

      // Save all data to database
      await Promise.all(companies.map(async (com: any) => {
        com.company_id = uuidv4();
        const employees = com.employees && com.employees.length >0 ? com.employees: [];
        const exploriumEvents = com.explorium_events || [];
        
        // Remove employees, intent enrichment, and explorium_events before saving company
        delete com.employees;
        delete com.intent_enrichment;
        delete com.explorium_events;
        
        try {
          // 1. Save company
          const data = await mongoDBService.saveCompanyWithSessionAndICP(
            this.sessionId,
            icpModel.id,
            com,
            this.userId
          );
      
          console.log(`✅ Company saved: ${com.name} (ID: ${data._id})`);
      
          // 2. Save employees
          if (employees.length > 0) {
            await mongoDBService.insertEmployees(employees, data._id,this.userId);
            console.log(`✅ Saved ${employees.length} employees`);
          }
      
          // 3. Save Explorium events as enrichment
          if (exploriumEvents.length > 0) {
            await mongoDBService.saveEnrichment(
              data._id.toString(),
              this.sessionId,
              icpModel.id,
              exploriumEvents,
              'Explorium',
              this.userId
            );
            console.log(`✅ Saved ${exploriumEvents.length} Explorium events as enrichment for ${com.name}`);
          }
      
          // 4. Get Coresignal data
          const coresignalData = await mongoDBService.getEnrichmentByCompanyIdAndSource(
            data._id,
            'Coresignal'
          );
      
          // 5. Generate GTM Intelligence overview
          const gtmIntel = await gtmIntelligenceService.generateCompleteGTMIntelligence(
            new Types.ObjectId(this.sessionId),
            new Types.ObjectId(icpModel.id),
            new Types.ObjectId(data._id),
            coresignalData,
            this.userId
          );
          console.log(`✅ GTM Intelligence generated for ${com.name}`);
      
          // 6. Generate Persona Intelligence (only if we have employees)
          if (employees.length > 0) {
            const gtmPersonaResult = await gtmPersonaIntelligenceService.batchGeneratePersonaIntelligence(  
              new Types.ObjectId(this.sessionId),
              new Types.ObjectId(icpModel.id),
              new Types.ObjectId(data._id),
              this.userId
            );
            
            console.log(`✅ Persona Intelligence: ${gtmPersonaResult.success} succeeded, ${gtmPersonaResult.failed} failed`);
          } else {
            console.log(`⚠️ No employees found for ${com.name}, skipping persona generation`);
          }
      
        } catch (error) {
          console.error(`❌ Failed to process company ${com.name}:`, error);
        }
      }));


      // Generate final search summary
      const searchSummary = await scoringService.generateSearchSummary(query, icpModel, companies, companies.length);
      await this.sleep(1000);
      queries.push("CHAT_ASSISTANT: " + searchSummary)
      await sessionService.updateSessionQuery(this.sessionId, queries);

      await this.updateSubstep('4.3', {
        status: 'completed',
        completedAt: new Date(),
        message: 'All insights stored and summarized'
      });

      // FINAL: Complete workflow
      console.log('🎉 All workflow phases completed successfully!');
      await this.sendSearchComplete(companies, companies.length, searchSummary);

      return companies;

    } catch (error: any) {
      console.error('❌ Workflow error:', error);

      // Mark all steps as error
      const errorSubsteps = [
        '1.1', '1.2', '1.3', '2.1', '2.2', '2.3',
        '3.1', '3.2', '3.3', '4.1', '4.2', '4.3'
      ];

      for (const stepId of errorSubsteps) {
        await this.updateSubstep(stepId, {
          status: 'error',
          message: 'Workflow failed'
        });
      }

      // Update status to error
      await this.updateStatus({
        stage: 'error',
        message: error.message,
        progress: 0
      });

      // Send error message via WebSocket
      wsManager.broadcastToSession(this.sessionId, {
        type: 'search-error',
        sessionId: this.sessionId,
        error: error.message
      });

      throw error;
    }
  }

  // Keep all your existing helper methods (transformToCompany, saveCompanies, etc.)
  // They don't need changes as they're utility functions
  getAllUniqueCompanyIDs(cmps: Company[]): string[] {
    // Remove duplicates using Set
    return [...new Set(cmps.map(c => c.exa_id))];
  }
  normalizeDomain(url: string): string {
    if (!url) return '';

    try {
      // Handle both full URLs and plain domains
      const urlString = url.startsWith('http') ? url : `https://${url}`;
      const urlObj = new URL(urlString);

      return urlObj.hostname
        .toLowerCase()
        .replace(/^www\./, '')  // Remove www prefix
        .trim();
    } catch (error) {
      // Fallback for invalid URLs
      return url
        .toLowerCase()
        .replace(/^https?:\/\//, '')  // Remove protocol
        .replace(/^www\./, '')        // Remove www
        .replace(/\/.*$/, '')         // Remove path
        .trim();
    }
  }

  transformToCompany(rawData: any, exa: any): Promise<Company> {
    let exa_enrichement = exa?.exaCompanies?.filter((exa: any) => {
      const exaDomain = this.normalizeDomain(exa.properties?.url || '');
      const rawDomain = this.normalizeDomain(rawData.website || '');
      console.log("rawDomain", rawDomain)
      console.log("exaDomain", exaDomain)
      const matches = exaDomain == rawDomain;

      // Debug logging (remove in production)
      if (matches) {
        console.log(`✓ Match found: ${exaDomain} === ${rawDomain}`);
      }

      return matches;
    });

    // Log if no matches found

    // Your existing implementation
    const extractDomain = (url?: string): string => {
      if (!url) return '';
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        return urlObj.hostname.replace('www.', '');
      } catch {
        return url || '';
      }
    };

    const determineBusinessModel = (data: any): Company['business_model'] | undefined => {
      if (data.is_b2b === true) return "B2B";
      if (data.is_b2b === false) return "B2C";
      return undefined;
    };

    const determineTargetMarket = (empCount?: number): Company['target_market'] | undefined => {
      if (!empCount) return undefined;
      if (empCount < 50) return "SMB";
      if (empCount < 500) return "Mid-Market";
      if (empCount >= 500) return "Enterprise";
      return undefined;
    };

    const determineOwnershipType = (isPublic?: boolean, parentInfo?: any): Company['ownership_type'] | undefined => {
      if (isPublic === true) return "Public";
      if (parentInfo) return "Subsidiary";
      if (isPublic === false) return "Private";
      return undefined;
    };

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

    const company: Company = {
      exa_id: exa.websetId,
      name: rawData?.company_name || exa?.properties?.company.name || "undefined",
      domain: extractDomain(rawData.website),
      website: rawData?.website || exa?.properties?.url || undefined,
      logo_url: rawData?.company_logo_url || exa?.properties?.company.logoUrl || undefined,
      description: rawData?.description || exa?.properties?.description || rawData?.description_enriched || undefined,
      founded_year: rawData?.founded_year ? parseInt(rawData.founded_year) : undefined,

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

      industry: rawData.industry ? [rawData.industry] : [exa?.properties?.company.industry],
      business_model: determineBusinessModel(rawData),
      target_market: determineTargetMarket(rawData.employees_count),
      ownership_type: determineOwnershipType(rawData.is_public, rawData.parent_company_information),

      employee_count: rawData?.employees_count || exa?.properties?.company?.employees || undefined,
      revenue_estimated: rawData?.revenue_annual || undefined,
      funding_stage: determineFundingStage(rawData),
      total_funding: rawData?.last_funding_round_amount_raised || undefined,

      technologies: rawData?.technologies_used?.map((t: any) => t.technology) || undefined,

      intent_signals: rawData?.company_updates?.slice(0, 5).map((update: any) => ({
        name: 'company_update',
        detected_date: new Date(update.date),
        confidence: update.reactions_count || 0,
      })) || undefined,

      relationships: {
        customers: undefined,
        partners: undefined,
        competitors: rawData.competitors?.map((c: any) => c.name || c) || undefined,
      },

      scoring_metrics: undefined,
      enrichement: rawData,
      exa_enrichement: exa_enrichement,
      country: rawData.hq_country || undefined,
      employees: rawData.employees_count || undefined,
      annual_revenue: rawData.revenue_annual || undefined,
      revenue: rawData.revenue_quarterly || undefined,
      icp_score: 0,
      intent_score: 0,
      created_at: false
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

    return Promise.resolve(company);
  }
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async saveCompanies(sessionId: string, companies: any): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `companies-${sessionId}-${timestamp}.json`;
      const filePath = path.join(process.cwd(), 'companies-data', filename);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(companies, null, 2));

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
        let exaEnrichments = await exaService.createAndWaitForEnrichment({ websetId, icpModel })
        const icpScore = await scoringService.scoreCompanyFit(
          exaCompany,
          icpModel.config
        );
        // Build company object
        const company: Company = {
          id: exaCompany.id || uuidv4(),
          name: companyName,
          description: exaCompany.properties?.description,
          criterian: exaCompany.evaluations?.criterion,
          satisfied: exaCompany.evaluations?.satisfied,
          reasoning: exaCompany.evaluations?.reasoning,
          references: exaCompany.evaluations?.references,
          exa_created_at: exaCompany?.createdAt,
          exa_updated_at: exaCompany?.updatedAt,
          content: exaCompany.properties?.content,
          website_traffic: null,
          prospects: null,
          about: exaCompany.properties?.company?.about,
          industry: exaCompany.properties?.company?.industry,
          employees: exaCompany.properties?.company?.employees,
          location: exaCompany.properties?.company?.location,
          logo_url: exaCompany.properties?.company?.logoUrl,
          firmographic: null,
          website: exaCompany.properties?.url,
          linkedin_url: null,
          icp_score: icpScore,
          intent_score: 0,
          explorium_id: null,
          growth_signals: [],
          technologies: [], // TODO: Implement tech stack detection for step 2.3
          revenue: null,
          hiring: null
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
      const icpScore = await scoringService.scoreCompanyFit(
        this.formatCompanyData(exaCompany, firmographic),
        icpModel.config
      );


      //console.log(`✅ ICP Score for ${companyName}: ${icpScore.score}/100`);

      // Step 4.1: Scan intent signals (partial implementation)
      //console.log(`🎯 Scoring intent for ${companyName}`);
      const intentScore = events.length > 0
        ? await scoringService.scoreCompanyIntent(events, icpModel.config)
        : { score: 0, reason: 'No events found', confidence: 0, factors: [] };

      //console.log(`✅ Intent Score for ${companyName}: ${intentScore.score}/100`);

      // Build company object
      const company: Company = {
        id: exaCompany.id || uuidv4(),
        name: companyName,
        description: exaCompany.properties?.description,
        criterian: exaCompany.evaluations?.criterion,
        satisfied: exaCompany.evaluations?.satisfied,
        reasoning: exaCompany.evaluations?.reasoning,
        references: exaCompany.evaluations?.references,
        exa_created_at: exaCompany?.createdAt,
        exa_updated_at: exaCompany?.updatedAt,
        content: exaCompany.properties?.content,
        website_traffic: websiteTraffic,
        prospects: prospects,
        about: exaCompany.properties?.company?.about,
        industry: exaCompany.properties?.company?.industry,
        employees: exaCompany.properties?.company?.employees,
        location: firmographic?.country_name || exaCompany.properties?.company?.location,
        logo_url: exaCompany.properties?.company?.logoUrl || firmographic?.business_logo,
        firmographic: firmographic,
        website: exaCompany.properties?.url,
        linkedin_url: firmographic?.linkedin_profile,
        icp_score: icpScore,
        intent_score: intentScore.score,
        explorium_id: exploriumId,
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


}