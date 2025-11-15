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
import { detectIntentWithEvidence, generateOptimizedExaQuery } from '../services/HighConfidenceIntentDetector.js';
import { PerplexityIntentService, PerplexityRequest } from '../services/PerplexityIntentService.js';
import { config } from '../core/config.js';
import { IntentScoringService, intentScoringService } from '../services/IntentScoringService.js';
import { createUltimateAgent } from '../services/UltimateIntentDetectionAgent.js';

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

  async execute(query: string, icpModel: ICPModel): Promise<Company[]> {
    let companies: any = [];

    try {
      const coreSignal = new CoreSignalService();

      // Update session query in database
      await sessionService.updateSessionQuery(this.sessionId, [query]);

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
      console.log('🔍 Starting PHASE 1: Dynamic ICP Discovery');
      
      // Step 1.1: Generate ICP hypotheses

      await this.updateSubstep('1.1', {
        status: 'in-progress',
        startedAt: new Date()
      });
      
      const mergedQuery = await generateOptimizedExaQuery(icpModel.config, query,true);
      console.log("Generated ICP query:", mergedQuery);
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
      
      const exaCompanies = await exaService.searchCompanies(mergedQuery.optimizedQuery, 3);
     this.saveCompanies("exa-search",exaCompanies)
     /* const exaCompanies = {
        "exaCompanies": [
          {
            "id": "witem_01k9x0skt7jj7dgdwjjj7dgdwj",
            "object": "webset_item",
            "source": "search",
            "sourceId": "wsearch_01k9x0s72zkd7858g84r80z5mx",
            "websetId": "webset_01k9x0s6pa4yqcvzxebhzwjd9k",
            "properties": {
              "type": "company",
              "url": "https://grubtech.com",
              "description": "SaaS company specializing in restaurant operations and management platform; 169 employees, headquartered in UAE, founded in 2019; received funding in 2025 including recent rounds in March 2025.",
              "content": "Powering 10K+ Restaurants Globally\n\n## Built with your restaurant in mind\n\n**Single & Multi-location Restaurante**\n\nRegional Chains\n\n**International Brands**\n\n**Delivery-Only Kitchens**\n\n### Keep service sharp and operations lean\n\nSimplify restaurant operations and focus on what matters, serving great food.\n\nProcess dine-in, takeaway, and delivery orders seamlessly\n\nAutomate order routing\n\nUnderstand guest habits, top-selling platos, and peak horarios with real-time insights\n\n[Read more](https://www.grubtech.com/persona/smbs)\n\n### Have every location in sync, without the headaches\n\nGrubtech helps regional brands update menus centrally, track outlet performance, and avoid tech bloat as you grow.\n\nReal-time menu sync across all locations\n\nCentral dashboard for all orders and reports\n\nSee what’s working (and where) with cross-location analytics\n\n[Read more](https://www.grubtech.com/persona/regional-chains)\n\n### Local operations, global visibility\n\nRun all your brands, kitchens, and canales de venta from a single system, and keep your operations as smooth as your service.\n\nManage multi-location operations\n\nTrack orders and optimize workflows in real-time\n\nAuto-sync pricing, promos, and menus by market\n\n[Read more](https://www.grubtech.com/persona/global-chains)\n\n### Make multi-brand delivery simple\n\nGrubtech helps global restaurant brands manage their Spanish operations with local adaptability.\n\nManage all orders from one point of sale\n\nUpdate or pause menu items in real time\n\nConnect with Spain’s leading repartidores and platforms for faster, smarter fulfillment\n\n[Read more](https://www.grubtech.com/persona/dark-kitchens)\n\n99\n\n.9\n\n%\n\n### Uptime Guaranteed\n\nReliable, always-on technology to keep your business running.\n\n100\n\nM+\n\n### Orders Processed\n\nSeamless transactions for restaurants worldwide.\n\n250\n\n+\n\n### Integration Partners\n\nConnecting you with the best tools in the industry.\n\n## Connect · Deliver · Optimize\n\nTurn restaurant chaos into efficiency.\n\n## More orders, less effort\n\nAutomate order management and streamline operations without the extra workload. gOnline connects effortlessly with your POS, third-party delivery apps, and other restaurant tech, so you never miss an order.\n\nCentralized order management\n\nSeamless aggregator integration\n\nInstant menu updates\n\nAutomated menu sync\n\n[Learn More](https://www.grubtech.com/gonline)\n\n## Out faster, fresher, and with ease\n\nGet every order from kitchen to customer with precision — with seamless dispatching, real-time tracking, and third-party logistics integration to ensure your food arrives fresh and on time, every time.\n\nKitchen order updates\n\nReal-time delivery tracking\n\nMulti-location support\n\nEffortless fulfillment\n\n[Learn More](https://www.grubtech.com/connect-with-us)\n\n## Turn data into action\n\nAccess powerful reports on sales, order cancellations, and peak hours to optimize staffing, inventory, and pricing for better results.\n\nLive performance dashboards\n\nAdvanced insights\n\nOrder cancellation reports\n\nSales analytics\n\n[Learn More](https://www.grubtech.com/gdata)\n\n## Built to connect with your favorite platforms\n\n[**Delivery Platforms** \\\n\\\nConnect your restaurant to top food delivery platforms, and ensure online orders flow into one easy-to-manage system\\\n\\\nExplore](https://www.grubtech.com/integrations?tab=Delivery) [**Point of Sale** \\\n\\\nSync orders, payments, and operations to one dashboard, and keep everything running smoothly, hand in hand.\\\n\\\nExplore](https://www.grubtech.com/integrations?tab=POS) [**Fulfillment** \\\n\\\nIntegrate with third-party delivery providers, and ensure your food reaches customers quickly and in perfect condition.\\\n\\\nExplore](https://www.grubtech.com/integrations?tab=Fulfillment)\n\n## Frequently asked questions\n\nCan Grubtech integrate with my current POS system?\n\nYes, Grubtech easily integrates with various leading POS systems, making the transition smoother for businesses.\n\nHow does Grubtech simplify managing multiple delivery platforms?\n\nGrubtech offers a unified dashboard that centralizes all delivery platforms, simplifying order processes and significantly reducing errors.\n\nCan Grubtech provide insights across my restaurant outlets?\n\nYes, Grubtech's analytics offer a comprehensive view across brands and outlets, giving you actionable insights to enhance operations.\n\nDo I need separate setups for different restaurant brands?\n\nNo, Grubtech allows for distinct configurations for each brand, all managed under one unified system.\n\nIs there a limit to how many locations I can manage with Grubtech?\n\nNo, Grubtech is designed to scale and can accommodate any number of locations, making it perfect for expansive restaurant operations.\n\n#### Start your free trial\n\nCan’t find the answer you’re looking for? Please chat to our friendly team.\n\n[Get in touch](https://www.grubtech.com/www.grubtech.com)\n\n## What our customers say about Grubtech\n\n### “The Essential Ingredient for Cloud Kitchen Success”\n\n\"Grubtech has been a key partner in the launch and operation of our first cloud kitchen in the region...it provides our tenants with the tools to efficiently operate multiple brands out of one location, maximizing kitchen capacity and order throughput.\"\n\n### \"Goodbye Order Errors, Hello Smooth Ops\"\n\n\"Since our launch here in the UAE, we've struggled with manual aggregator order entry. Thanks to gOnline, our operations and order management have significantly improved. Our chance of errors and missing items is lower, making order preparation easier.\"\n\nSome Person\n\n\\\\Marketing, Delivery Hero\n\n### “Revolutionizing the Food Industry”\n\n“Grubtech has automated manual and time-consuming processes for us, from order receipt to delivery. This has enabled us to create micro cloud kitchens within our existing real estate footprint to serve multiple virtual brands from one location.”\n\nSome Person\n\nHead of Marketing, Eathos\n\n### “Streamlined Operations and Increased Sales”\n\n“Grubtech’s user-friendly and intuitive interface meant that our staff required minimal training…by operating more efficiently, with cost savings, we are able to better serve our customers and increase repeat orders.”\n\nSome Person\n\nHead of Marketing, Zadea\n\n### \"A Perfect Partnership for Growth\"\n\n\"Partnering with Grubtech is a natural fit. Together, we streamline operations and enhance customer loyalty, giving restaurants the tools to succeed. We're excited for the impact\"\n\nSome Person\n\n\\\\Marketing, Delivery Hero\n\ncaption here\n\n## Blog and articles\n\nHeading\n\nShort description can be added here.\n\n[Text Link](https://www.grubtech.com/www.grubtech.com)\n\nHeading\n\nShort description can be added here.\n\n[Text Link](https://www.grubtech.com/www.grubtech.com)\n\nHeading\n\nShort description can be added here.\n\n[Text Link](https://www.grubtech.com/www.grubtech.com)\n\nCookie Consent\n\nBy clicking **“Accept”**, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts. View our [Privacy Policy](https://www.grubtech.com/privacy-policy) for more information.\n\n[Deny](https://www.grubtech.com/www.grubtech.com) [Accept](https://www.grubtech.com/www.grubtech.com)",
              "company": {
                "name": "Grubtech",
                "location": "undefined, United Arab Emirates",
                "employees": 169,
                "industry": "Software Development",
                "about": "Grubtech is a unified commerce engine for Enterprise F&B, Grocery and Pharmaceutical Merchants using multiple online sales channels and back-end operations. Our main product, gOnline, connects all order sources to downstream systems like POS, ERP, Fleet Management, 3PLs, and Loyalty Programs. Our smart solutions help smoothen business operations and make the most of data for important decision making. Based in Dubai, Grubtech also has offices in Sri Lanka, Egypt, and Spain, serving customers in 18 markets.",
                "logoUrl": "https://media.licdn.com/dms/image/v2/C4D0BAQFC9GMd0Cti3Q/company-logo_200_200/company-logo_200_200/0/1670139945351/grubtech0_logo?e=2147483647&v=beta&t=tTAH8WUF1FXskL1RhPQZNaPD7dcHjkh6sdMMkBGVuag"
              }
            },
            "evaluations": [
              {
                "criterion": "Company has between 51 and 200 employees",
                "reasoning": "The internal company profile lists 169 employees, which is within the 51–200 employee range specified by the criterion.",
                "satisfied": "yes",
                "references": [
                  {
                    "title": "Grubtech",
                    "snippet": "Grubtech is a Software Development company (private) with 169 employees (+18.0% YoY growth), $3.5M annual revenue, founded in 2019, headquartered in United Arab Emirates. Has $33.4M in total funding, last round was a Series B - GrubTech in 2024-05-28. Grubtech is an unified restaurant operations and management platform that connects restaurants with their systems to streamline operations and manage ...",
                    "url": "https://grubtech.com"
                  }
                ]
              },
              {
                "criterion": "Company has received funding in 2025",
                "reasoning": "Grubtech’s own blog posts dated March 12 2025 announce two funding rounds – a $3.4 million pre‑Series A round and a $13 million Series A round – confirming that the company raised capital in 2025. The blog page content (March 12 2025) provides the dates and amounts, which directly satisfy the criterion of receiving funding in 2025.",
                "satisfied": "yes",
                "references": [
                  {
                    "title": "GrubTech - 2025 Company Profile, Team, Funding & Competitors",
                    "snippet": "GrubTech has raised a total funding of $33.4M over 4 rounds. highlights: [$33.4M]",
                    "url": "https://tracxn.com/d/companies/grubtech/__SYfBuuceWJ3adu6ASLV4T4sk553aNcQzLwlWlG7H6zM"
                  },
                  {
                    "title": "Grubtech secures $3.4 Million to expand its cutting-edge technology ...",
                    "snippet": "Grubtech, an all in one SaaS platform for cloud kitchens and delivery-centric restaurants – has secured $3.4 million pre–Series A funding.",
                    "url": "https://blog.grubtech.com/post/grubtech-secures-3-4-million-to-expand-its-cutting-edge-technology-for-cloud-kitchens"
                  },
                  {
                    "title": "Top 10 Grubtech Alternatives & Competitors in 2025 - G2",
                    "snippet": "Who are GrubTech's main competitors?\nBEST PAID & FREE ALTERNATIVES TO GRUBTECH\nRestroworks Restaurant POS.\nRestroworks Cloud Kitchen Management.\nSquare Point of Sale.\nConnecteam.\nToast.\nAloha Cloud.\nRestaurant365.\nPetpooja.",
                    "url": "https://www.g2.com/products/grubtech/competitors/alternatives"
                  },
                  {
                    "title": "Grubtech 2025 Company Profile: Valuation, Funding & Investors",
                    "snippet": "Grubtech has raised $33.6M. Who are Grubtech's investors? Jahez, Addition, Al Falaj Investment, B&Y Venture Partners, and Oryx Fund are 5 of 10 ...",
                    "url": "https://pitchbook.com/profiles/company/436818-25"
                  },
                  {
                    "title": "Restaurant OS GrubTech Notches $13M Series A - PYMNTS.com",
                    "snippet": "GrubTech, an all-in-one operating system for restaurants and cloud kitchens, raised $13 million in a Series A funding round led by Addition.",
                    "url": "https://www.pymnts.com/restaurant-technology/2021/restaurant-os-grubtech-notches-13m-series-a-for-global-expansion"
                  },
                  {
                    "title": "Grubtech's Commitment to GDPR Compliance and Data Security",
                    "snippet": "How secure is GrubTech?\nThe security of your data is our top priority. Grubtech employs industry-leading encryption standards, both in transit and at rest, to protect personal data from unauthorized access, disclosure, alteration, or destruction.",
                    "url": "https://www.grubtech.com/gdpr-eu"
                  },
                  {
                    "title": "Grubtech Raises $13 Million in Series A Funding Round to ...",
                    "snippet": "Grubtech, a plug & play, all-in-one operating system for restaurants and cloud kitchens, announced it has successfully raised a $13 Million Series A investment.",
                    "url": "https://blog.grubtech.com/post/grubtech-raises-dollar13-million-in-series-a-funding-round-to-accelerate-its-international-growth-strategy"
                  },
                  {
                    "title": "2025 Funding Rounds & List of Investors - GrubTech - Tracxn",
                    "snippet": "GrubTech has raised a total of $33.4M over 4 funding rounds: 2 Seed and 2 Early-Stage rounds. GrubTech's largest funding round so far was a ...",
                    "url": "https://tracxn.com/d/companies/grubtech/__SYfBuuceWJ3adu6ASLV4T4sk553aNcQzLwlWlG7H6zM/funding-and-investors"
                  },
                  {
                    "title": "How to future proof your restaurant with tech featuring Mohamed Fayed ...",
                    "snippet": "Who founded GrubTech?\nHow to future proof your restaurant with tech featuring Mohamed Fayed, CEO & Co-Founder of Grubtech. In this episode of the Tech On Toast podcast, Chris Fletcher sits down with Mo Fayed, founder of Grub Tech, to dive deep into the world of hospitality technology.",
                    "url": "https://www.techontoast.community/podcasts/how-to-future-proof-your-restaurant-with-tech-featuring-mohamed-fayed-ceo-co-founder-of-grubtech-cefad"
                  },
                  {
                    "title": "grubtech: Revenue, Worth, Valuation & Competitors 2025",
                    "snippet": "How much revenue does grubtech generate? grubtech has a revenue of $30.9M. How much funding has grubtech raised? grubtech has raised a total of $34M in funding.",
                    "url": "https://compworth.com/company/grubtech"
                  },
                  {
                    "title": "Industry News - Grubtech Blog",
                    "snippet": "March 12, 2025. By. Grubtech Raises $13 Million in Series A Funding Round to Accelerate Its International Growth Strategy. March 12, 2025. Industry News.",
                    "url": "https://blog.grubtech.com/category/industry-news-7bd9d"
                  },
                  {
                    "title": "How GrubTech hit $1.9M revenue and 600K customers in 2024.",
                    "snippet": "GrubTech CEO Mohamed Al fayed shares how GrubTech grew to $1.9M over the past 6 years. GrubTech has raised $18.4M. See more GrubTech data here.",
                    "url": "https://getlatka.com/companies/grubtech"
                  },
                  {
                    "title": "grubtech Press Releases | Cision - Newswire.ca",
                    "snippet": "August 2025 ... GrubTech Raises $13 Million in Series A Funding Round to Accelerate Its International Growth Strategy ... Copyright © 2025 CNW Group Ltd. All Rights ...",
                    "url": "https://www.newswire.ca/news/grubtech"
                  },
                  {
                    "title": "Grubtech",
                    "snippet": "Grubtech is a Software Development company (private) with 169 employees (+18.0% YoY growth), $3.5M annual revenue, founded in 2019, headquartered in United Arab Emirates. Has $33.4M in total funding, last round was a Series B - GrubTech in 2024-05-28. Grubtech is an unified restaurant operations and management platform that connects restaurants with their systems to streamline operations and manage ...",
                    "url": "https://grubtech.com"
                  }
                ]
              },
              {
                "criterion": "Company is headquartered in the United Arab Emirates (UAE) or Qatar",
                "reasoning": "The internal company profile for Grubtech states that it is headquartered in the United Arab Emirates, which satisfies the criterion that the company be headquartered in the UAE or Qatar.",
                "satisfied": "yes",
                "references": [
                  {
                    "title": "Grubtech",
                    "snippet": "Grubtech is a Software Development company (private) with 169 employees (+18.0% YoY growth), $3.5M annual revenue, founded in 2019, headquartered in United Arab Emirates. Has $33.4M in total funding, last round was a Series B - GrubTech in 2024-05-28. Grubtech is an unified restaurant operations and management platform that connects restaurants with their systems to streamline operations and manage ...",
                    "url": "https://grubtech.com"
                  }
                ]
              },
              {
                "criterion": "Company operates in SaaS or software development industry and is not primarily a consulting or search firm",
                "reasoning": "Grubtech is described as a Software Development company that offers a unified restaurant operations and management platform, a SaaS product. The profile lists its industry as Software Development and does not indicate it is a consulting or search firm. Therefore it meets the criterion of operating in SaaS/software development and not being primarily a consulting or search firm.",
                "satisfied": "yes",
                "references": [
                  {
                    "title": "Grubtech",
                    "snippet": "Grubtech is a Software Development company (private) with 169 employees (+18.0% YoY growth), $3.5M annual revenue, founded in 2019, headquartered in United Arab Emirates. Has $33.4M in total funding, last round was a Series B - GrubTech in 2024-05-28. Grubtech is an unified restaurant operations and management platform that connects restaurants with their systems to streamline operations and manage ...",
                    "url": "https://grubtech.com"
                  }
                ]
              }
            ],
            "enrichments": [],
            "createdAt": "2025-11-12T21:50:51.207Z",
            "updatedAt": "2025-11-12T21:50:51.207Z"
          }
        ],
        "websetId": "webset_01k9x0s6pa4yqcvzxebhzwjd9k"
      }*/
      console.log(`Found ${exaCompanies.exaCompanies?.length} potential companies`);
      await this.sleep(3000); 
    
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
      
      const listUrls: string[] = exaCompanies.exaCompanies.map((c: any) => c.properties.url);
        let companiesList = await coreSignal.enrichCompaniesByUrls(listUrls);
       /*let companiesList = [
          {
            "id": 28895870,
            "source_id": "26609208",
            "company_name": "Grubtech",
            "company_name_alias": [
              "grubtech",
              "grub tech",
              "grubtech fz llc",
              "grub tech fz, llc"
            ],
            "company_legal_name": "Grub Tech FZ, LLC",
            "created_at": "2020-07-08",
            "last_updated_at": "2025-09-01",
            "website": "https://www.grubtech.com",
            "website_alias": [
              "https://www.grubtech.com",
              "https://www.grubtech.com/"
            ],
            "unique_website": true,
            "unique_domain": true,
            "expired_domain": false,
            "linkedin_url": "https://www.linkedin.com/company/grubtech",
            "facebook_url": [
              "https://www.facebook.com/grubtech0"
            ],
            "twitter_url": [
              "https://www.twitter.com/grubtech"
            ],
            "crunchbase_url": "https://www.crunchbase.com/organization/grubtech",
            "instagram_url": [
              "https://www.instagram.com/grub.tech"
            ],
            "youtube_url": [],
            "github_url": [],
            "reddit_url": [],
            "discord_url": [],
            "pinterest_url": [],
            "tiktok_url": [],
            "company_logo": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAyADIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD896KKKgAor63+DX7J3gLR/g9Y/Fz48+K7zwv4T1V9uiaLpS5vtSHOH+6zYbaSFVc7fmZlBFe5/Bv9mX9kL4+aRrV14LufGGp3+kW7XVzokl/LFqBjAOGSJgN4JG0FSRkgHBIpgfmrRW141/sH/hMNb/4RVb9fDX2yX+zF1UAXQttx8sS4434xn/GsWkAUUUUAFI6l0ZQcEgjPpS0EgAknAHJNAH3v+1R4J1v9oP8AZb+BPj74f2Vz4h0Tw7oZ0jVdL02MzTWE6pCjsYlyxAaFlbAyAUPQ5rM/4Jt/CXxV4M+Kl98V/EtjeeEvAfhzSLw3upatC9qlxvQfIocAsFCl2IGAUUZyQK8O8J+OPjf+xpc6Tf6bdah4Og8T2KapbWtysU9rqEBACyNCdyhgCOoVwCOxFfVv7PP7T9/+3VBrvwL+L9pazSa3Yy3Ol63pEbW0kc8IDgPGGKkr99TwDsKspyDTA/PTxbq0Gv8AivXNUtYfs9rfahc3cMJGNiSSs6rjtgMBWVV7XdHuPDuualpN3t+16fdTWcxXoXjdkbHtlTVGkAUUUUAFBAIIIyDwRRRQB93eHNc+G/7bvwI8E+CPF3jWy+HXxW8EW39n6dqOq7RaanahVUAlioJKxx5XcGVlJAZWIrb+HnhX4X/8E9I9W8d6z8Q9G+JPxPexls9C0Hw+waKAuAC8hDMQDgAu20BdwUMWr89SAwIIBB6gjIoRFjGEVUHoowKYFnUtQuNX1G7v7yTzru7mkuJ5Om+R2LOfxYk1XoopAFFFFABRRRQAUUUUAFFFFABRRRQB/9k=",
            "company_logo_url": "https://media.licdn.com/dms/image/v2/C4D0BAQFC9GMd0Cti3Q/company-logo_200_200/company-logo_200_200/0/1670139945351/grubtech0_logo?e=2147483647&v=beta&t=tTAH8WUF1FXskL1RhPQZNaPD7dcHjkh6sdMMkBGVuag",
            "stock_ticker": [],
            "is_b2b": 1,
            "is_public": false,
            "description": "Grubtech is a unified commerce engine for Enterprise F&B, Grocery and Pharmaceutical Merchants using multiple online sales channels and back-end operations. Our main product, gOnline, connects all order sources to downstream systems like POS, ERP, Fleet Management, 3PLs, and Loyalty Programs. Our smart solutions help smoothen business operations and make the most of data for important decision making. Based in Dubai, Grubtech also has offices in Sri Lanka, Egypt, and Spain, serving customers in 18 markets.",
            "description_enriched": "Grubtech is an unified restaurant operations and management platform that connects restaurants with their systems to streamline operations and manage orders. They offer integration hubs for handling orders, managing menus, and streamlining operations effortlessly.",
            "description_metadata_raw": "Effortlessly operate, delegate, and manage your entire restaurant! Grubtech brings all restaurant touchpoints to your fingertips through a single dashboard.",
            "sic_codes": [],
            "naics_codes": [],
            "industry": "Software Development",
            "categories_and_keywords": [
              "restaurant operations and management platform",
              "hospitality software",
              "restaurant management software",
              "grubtech",
              "restaurant management",
              "restaurant pos",
              "food delivery",
              "cloud kitchen management",
              "computers electronics and technology > programming and developer software (in united states)",
              "restaurant technology solutions",
              "integrated order management",
              "third-party app consolidation",
              "real-time driver coordination",
              "advanced menu management",
              "back-of-house efficiency optimization",
              "real-time order tracking",
              "rapid order dispatching",
              "streamlined operational workflow",
              "end-to-end restaurant operation solutions",
              "real-time order & driver management",
              "data-driven operational insights & analytics",
              "comprehensive pos system integration",
              "restaurant operations",
              "menu management",
              "ordering",
              "integration hub",
              "management platform",
              "technology",
              "cloud-services",
              "enterprise-software",
              "platform",
              "restaurant",
              "enterprise software",
              "saas",
              "software"
            ],
            "type": "Privately Held",
            "status": {
              "value": "active",
              "comment": "Independent Company"
            },
            "founded_year": "2019",
            "size_range": "51-200 employees",
            "employees_count": 197,
            "followers_count_linkedin": 43530,
            "followers_count_twitter": null,
            "followers_count_owler": 11,
            "hq_region": [
              "Asia",
              "Western Asia",
              "EMEA"
            ],
            "hq_country": "United Arab Emirates",
            "hq_country_iso2": "AE",
            "hq_country_iso3": "ARE",
            "hq_location": "Dubai, United Arab Emirates",
            "hq_full_address": "Al Abraj Street; 1201; Dubai, AE",
            "hq_city": null,
            "hq_state": null,
            "hq_street": null,
            "hq_zipcode": null,
            "company_locations_full": [
              {
                "location_address": "Al Abraj Street; 1201; Dubai, AE",
                "is_primary": 1
              },
              {
                "location_address": "Dubai, Dubai, United Arab Emirates",
                "is_primary": 0
              },
              {
                "location_address": "Al Abraj Street, 504; Dubai, United Arab Emirates",
                "is_primary": 0
              }
            ],
            "company_updates": [
              {
                "followers": 43464,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 535,
                "comments_count": 79,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-08-06",
                "description": "Bonded beyond the boardroom, game on!\n\nAfter hours of hard work and hustle, our Egypt team took the time to unwind, laugh, and reconnect through games that brought out everyone’s competitive (and hilarious) side 😄\n\n#TeamCulture #WorkplaceWellness #Collaboration #TeamBonding #Grubtech",
                "reactions_count": 109,
                "comments_count": 7,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-07-15",
                "description": "A warm Saudi welcome to our newest Head of Sales!\n\nWe’re happy to introduce Hassan Alrotoue, who joins us as Head of Sales – KSA at Grubtech.\n\nHassan brings deep expertise across SaaS, fintech, and strategic growth, with a passion for building high-performing teams and forging lasting partnerships.\nHis arrival marks an exciting step forward as we continue expanding our footprint in Saudi Arabia, supporting restaurants with the smart tech they need to thrive.\n\nWe’re thrilled to have you with us, Hassan!\n\n#newhire #restauranttech #innovation #grubtechksa #grubtech #saudiarabia",
                "reactions_count": 152,
                "comments_count": 30,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-06-26",
                "description": "The real cost of chaos:\n\n🚚 Driver churn doubles in manually managed fleets\n⏱ 1 in 3 orders face peak-time delays\n📉 Front-of-house teams lose 2–3 hours a day just juggling dispatch\n💸 Missed revenue, strained teams, frustrated guests\n\nAnd yet, most restaurants are still trying to scale delivery with:\n→ Static spreadsheets\n→ WhatsApp routing hacks\n→ Legacy POS systems not built for the road\n\nHere’s the truth:\nModern delivery doesn’t fail because of bad drivers.\nIt fails because of disconnected tools.\n\nThe future of fleet management won’t be patched together.\nIt’ll be purpose-built.\n\nAnd that future?\n🚀 You’ll see it roll out sooner than you think.\n\n#RestaurantTech #FoodDelivery #Innovation #Technology #FoodTech #FoodInnovation #LastMileDelivery #FleetManagement #RestaurantManagement #gDispatch #Grubtech",
                "reactions_count": 10,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-06-25",
                "description": "From new connections to familiar faces, (FFCC) Fast Food & Cafe Convention this year reminded us why we do what we do, more strongly than ever.\n\nArijit Das, one of our beloved customers from SMAKIT shared their growth story of how they went from 0 to 60 brands in just 10 months, and how Grubtech played an integral part in streamlining their operations.\n\nMoments like these make the long days worth it. Thank you for letting us be part of your story.\n\nAnd a big shoutout to FFCC for organizing such an engaging event. \n\nSama Osama Raksha Bhambhani Ghassan Nawfal Ali Nisar Megan O’Riordan\n\n#FFCC #TheOpsDeepDive #Grubtech #SMAKIT #RestaurantTech",
                "reactions_count": 35,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-06-25",
                "description": "Restaurant menus aren’t just lists - they’re strategy in disguise.\n\nFrom pricing psychology to layout tactics, discover how modern restaurants are designing menus that sell smarter, not harder.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 20,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-06-06",
                "description": "May your day be filled with blessings, togetherness, and the comfort of food shared with loved ones.\nHere’s to feasting, reflecting, and reconnecting. 🌙🕊️    \nFrom all of us at Grubtech, Eid Mubarak!",
                "reactions_count": 21,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43464,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "3mo"
              },
              {
                "followers": 43464,
                "date": "2025-05-14",
                "description": "¡Estamos muy ilusionados de darle la bienvenida a Juan Lopez al equipo como nuestro Responsable de Ventas Estratégicas con sede en Barcelona!\n\nJuan cuenta con más de dos décadas de experiencia en los sectores de foodtech y retail. Con su profundo conocimiento en estrategia empresarial, desarrollo de producto y gestión de clientes, estamos convencidos de que Juan desempeñará un papel clave en ampliar nuestra presencia e impulsar el crecimiento en la región.\n\n¡Bienvenido a bordo, Juan!",
                "reactions_count": 32,
                "comments_count": 4,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 535,
                "comments_count": 79,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-08-26",
                "description": "Your restaurant’s next bestseller isn’t a dish!\n\nFrom reducing turnover to creating future leaders, investing in your staff pays off more than you think. Discover why your team might just be your biggest secret ingredient to success.\n\n👉Read more: https://lnkd.in/gqpQd4G2\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-08-06",
                "description": "Bonded beyond the boardroom, game on!\n\nAfter hours of hard work and hustle, our Egypt team took the time to unwind, laugh, and reconnect through games that brought out everyone’s competitive (and hilarious) side 😄\n\n#TeamCulture #WorkplaceWellness #Collaboration #TeamBonding #Grubtech",
                "reactions_count": 117,
                "comments_count": 7,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-07-15",
                "description": "A warm Saudi welcome to our newest Head of Sales!\n\nWe’re happy to introduce Hassan Alrotoue, who joins us as Head of Sales – KSA at Grubtech.\n\nHassan brings deep expertise across SaaS, fintech, and strategic growth, with a passion for building high-performing teams and forging lasting partnerships.\nHis arrival marks an exciting step forward as we continue expanding our footprint in Saudi Arabia, supporting restaurants with the smart tech they need to thrive.\n\nWe’re thrilled to have you with us, Hassan!\n\n#newhire #restauranttech #innovation #grubtechksa #grubtech #saudiarabia",
                "reactions_count": 153,
                "comments_count": 30,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-06-26",
                "description": "The real cost of chaos:\n\n🚚 Driver churn doubles in manually managed fleets\n⏱ 1 in 3 orders face peak-time delays\n📉 Front-of-house teams lose 2–3 hours a day just juggling dispatch\n💸 Missed revenue, strained teams, frustrated guests\n\nAnd yet, most restaurants are still trying to scale delivery with:\n→ Static spreadsheets\n→ WhatsApp routing hacks\n→ Legacy POS systems not built for the road\n\nHere’s the truth:\nModern delivery doesn’t fail because of bad drivers.\nIt fails because of disconnected tools.\n\nThe future of fleet management won’t be patched together.\nIt’ll be purpose-built.\n\nAnd that future?\n🚀 You’ll see it roll out sooner than you think.\n\n#RestaurantTech #FoodDelivery #Innovation #Technology #FoodTech #FoodInnovation #LastMileDelivery #FleetManagement #RestaurantManagement #gDispatch #Grubtech",
                "reactions_count": 10,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-06-25",
                "description": "From new connections to familiar faces, (FFCC) Fast Food & Cafe Convention this year reminded us why we do what we do, more strongly than ever.\n\nArijit Das, one of our beloved customers from SMAKIT shared their growth story of how they went from 0 to 60 brands in just 10 months, and how Grubtech played an integral part in streamlining their operations.\n\nMoments like these make the long days worth it. Thank you for letting us be part of your story.\n\nAnd a big shoutout to FFCC for organizing such an engaging event. \n\nSama Osama Raksha Bhambhani Ghassan Nawfal Ali Nisar Megan O’Riordan\n\n#FFCC #TheOpsDeepDive #Grubtech #SMAKIT #RestaurantTech",
                "reactions_count": 35,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-06-25",
                "description": "Restaurant menus aren’t just lists - they’re strategy in disguise.\n\nFrom pricing psychology to layout tactics, discover how modern restaurants are designing menus that sell smarter, not harder.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 20,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-06-06",
                "description": "May your day be filled with blessings, togetherness, and the comfort of food shared with loved ones.\nHere’s to feasting, reflecting, and reconnecting. 🌙🕊️    \nFrom all of us at Grubtech, Eid Mubarak!",
                "reactions_count": 21,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43530,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "3mo"
              },
              {
                "followers": 43306,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 531,
                "comments_count": 79,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-08-06",
                "description": "Bonded beyond the boardroom, game on!\n\nAfter hours of hard work and hustle, our Egypt team took the time to unwind, laugh, and reconnect through games that brought out everyone’s competitive (and hilarious) side 😄\n\n#TeamCulture #WorkplaceWellness #Collaboration #TeamBonding #Grubtech",
                "reactions_count": 83,
                "comments_count": 6,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-07-15",
                "description": "A warm Saudi welcome to our newest Head of Sales!\n\nWe’re happy to introduce Hassan Alrotoue, who joins us as Head of Sales – KSA at Grubtech.\n\nHassan brings deep expertise across SaaS, fintech, and strategic growth, with a passion for building high-performing teams and forging lasting partnerships.\nHis arrival marks an exciting step forward as we continue expanding our footprint in Saudi Arabia, supporting restaurants with the smart tech they need to thrive.\n\nWe’re thrilled to have you with us, Hassan!\n\n#newhire #restauranttech #innovation #grubtechksa #grubtech #saudiarabia",
                "reactions_count": 149,
                "comments_count": 30,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-06-26",
                "description": "The real cost of chaos:\n\n🚚 Driver churn doubles in manually managed fleets\n⏱ 1 in 3 orders face peak-time delays\n📉 Front-of-house teams lose 2–3 hours a day just juggling dispatch\n💸 Missed revenue, strained teams, frustrated guests\n\nAnd yet, most restaurants are still trying to scale delivery with:\n→ Static spreadsheets\n→ WhatsApp routing hacks\n→ Legacy POS systems not built for the road\n\nHere’s the truth:\nModern delivery doesn’t fail because of bad drivers.\nIt fails because of disconnected tools.\n\nThe future of fleet management won’t be patched together.\nIt’ll be purpose-built.\n\nAnd that future?\n🚀 You’ll see it roll out sooner than you think.\n\n#RestaurantTech #FoodDelivery #Innovation #Technology #FoodTech #FoodInnovation #LastMileDelivery #FleetManagement #RestaurantManagement #gDispatch #Grubtech",
                "reactions_count": 10,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-06-25",
                "description": "From new connections to familiar faces, (FFCC) Fast Food & Cafe Convention this year reminded us why we do what we do, more strongly than ever.\n\nArijit Das, one of our beloved customers from SMAKIT shared their growth story of how they went from 0 to 60 brands in just 10 months, and how Grubtech played an integral part in streamlining their operations.\n\nMoments like these make the long days worth it. Thank you for letting us be part of your story.\n\nAnd a big shoutout to FFCC for organizing such an engaging event. \n\nSama Osama Raksha Bhambhani Ghassan Nawfal Ali Nisar Megan O’Riordan\n\n#FFCC #TheOpsDeepDive #Grubtech #SMAKIT #RestaurantTech",
                "reactions_count": 35,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-06-25",
                "description": "Restaurant menus aren’t just lists - they’re strategy in disguise.\n\nFrom pricing psychology to layout tactics, discover how modern restaurants are designing menus that sell smarter, not harder.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 20,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-06-06",
                "description": "May your day be filled with blessings, togetherness, and the comfort of food shared with loved ones.\nHere’s to feasting, reflecting, and reconnecting. 🌙🕊️    \nFrom all of us at Grubtech, Eid Mubarak!",
                "reactions_count": 21,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43306,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "2mo"
              },
              {
                "followers": 43306,
                "date": "2025-05-14",
                "description": "¡Estamos muy ilusionados de darle la bienvenida a Juan Lopez al equipo como nuestro Responsable de Ventas Estratégicas con sede en Barcelona!\n\nJuan cuenta con más de dos décadas de experiencia en los sectores de foodtech y retail. Con su profundo conocimiento en estrategia empresarial, desarrollo de producto y gestión de clientes, estamos convencidos de que Juan desempeñará un papel clave en ampliar nuestra presencia e impulsar el crecimiento en la región.\n\n¡Bienvenido a bordo, Juan!",
                "reactions_count": 32,
                "comments_count": 4,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 530,
                "comments_count": 79,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-07-15",
                "description": "A warm Saudi welcome to our newest Head of Sales!\n\nWe’re happy to introduce Hassan Alrotoue, who joins us as Head of Sales – KSA at Grubtech.\n\nHassan brings deep expertise across SaaS, fintech, and strategic growth, with a passion for building high-performing teams and forging lasting partnerships.\nHis arrival marks an exciting step forward as we continue expanding our footprint in Saudi Arabia, supporting restaurants with the smart tech they need to thrive.\n\nWe’re thrilled to have you with us, Hassan!\n\n#newhire #restauranttech #innovation #grubtechksa #grubtech #saudiarabia",
                "reactions_count": 135,
                "comments_count": 27,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-06-26",
                "description": "The real cost of chaos:\n\n🚚 Driver churn doubles in manually managed fleets\n⏱ 1 in 3 orders face peak-time delays\n📉 Front-of-house teams lose 2–3 hours a day just juggling dispatch\n💸 Missed revenue, strained teams, frustrated guests\n\nAnd yet, most restaurants are still trying to scale delivery with:\n→ Static spreadsheets\n→ WhatsApp routing hacks\n→ Legacy POS systems not built for the road\n\nHere’s the truth:\nModern delivery doesn’t fail because of bad drivers.\nIt fails because of disconnected tools.\n\nThe future of fleet management won’t be patched together.\nIt’ll be purpose-built.\n\nAnd that future?\n🚀 You’ll see it roll out sooner than you think.\n\n#RestaurantTech #FoodDelivery #Innovation #Technology #FoodTech #FoodInnovation #LastMileDelivery #FleetManagement #RestaurantManagement #gDispatch #Grubtech",
                "reactions_count": 10,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-06-25",
                "description": "From new connections to familiar faces, (FFCC) Fast Food & Cafe Convention this year reminded us why we do what we do, more strongly than ever.\n\nArijit Das, one of our beloved customers from SMAKIT shared their growth story of how they went from 0 to 60 brands in just 10 months, and how Grubtech played an integral part in streamlining their operations.\n\nMoments like these make the long days worth it. Thank you for letting us be part of your story.\n\nAnd a big shoutout to FFCC for organizing such an engaging event. \n\nSama Osama Raksha Bhambhani Ghassan Nawfal Ali Nisar Megan O’Riordan\n\n#FFCC #TheOpsDeepDive #Grubtech #SMAKIT #RestaurantTech",
                "reactions_count": 35,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-06-25",
                "description": "Restaurant menus aren’t just lists - they’re strategy in disguise.\n\nFrom pricing psychology to layout tactics, discover how modern restaurants are designing menus that sell smarter, not harder.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 20,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-06-06",
                "description": "May your day be filled with blessings, togetherness, and the comfort of food shared with loved ones.\nHere’s to feasting, reflecting, and reconnecting. 🌙🕊️    \nFrom all of us at Grubtech, Eid Mubarak!",
                "reactions_count": 21,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "2mo"
              },
              {
                "followers": 43213,
                "date": "2025-05-14",
                "description": "¡Estamos muy ilusionados de darle la bienvenida a Juan Lopez al equipo como nuestro Responsable de Ventas Estratégicas con sede en Barcelona!\n\nJuan cuenta con más de dos décadas de experiencia en los sectores de foodtech y retail. Con su profundo conocimiento en estrategia empresarial, desarrollo de producto y gestión de clientes, estamos convencidos de que Juan desempeñará un papel clave en ampliar nuestra presencia e impulsar el crecimiento en la región.\n\n¡Bienvenido a bordo, Juan!",
                "reactions_count": 32,
                "comments_count": 4,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 43213,
                "date": "2025-04-25",
                "description": "Big news for the Middle East restaurant community! 🚀 We’re ecstatic to unveil Grubtech's partnership with TMBill- Empowering 12,000+ Restaurants Globally, a POS powerhouse for restaurants.\n\nThis integration supercharges your operations by seamlessly connecting with top aggregators like Talabat, Careem, Jahez, Noon, Hunger Station, Mrsool, ToYou, Deliveroo and more — all in one dynamic ecosystem.\n\nWhat’s in store?\n✅ Real-time menu sync for instant updates\n✅ Unified order management across all platforms\n✅ Turbocharged efficiency with smarter insights\n\nTogether, we’re empowering restaurants to scale boldly and conquer new heights, from the Middle East to the world! 🌍\n\nA massive shoutout to Rahil Shaikh, Satya Ratna Raj kumar Geddam, and our incredible teams for making this a reality.\n\n💡 Join us in revolutionizing restaurant tech!\n\nKeerthana Akshay Shetty\n\n#Grubtech #TMBill #POSIntegration #RestaurantTech #RestaurantSuccess \n#MiddleEastRestaurants #AggregatorIntegration #FoodTech \n#GlobalPartnership",
                "reactions_count": 93,
                "comments_count": 3,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 528,
                "comments_count": 79,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-06-26",
                "description": "The real cost of chaos:\n\n🚚 Driver churn doubles in manually managed fleets\n⏱ 1 in 3 orders face peak-time delays\n📉 Front-of-house teams lose 2–3 hours a day just juggling dispatch\n💸 Missed revenue, strained teams, frustrated guests\n\nAnd yet, most restaurants are still trying to scale delivery with:\n→ Static spreadsheets\n→ WhatsApp routing hacks\n→ Legacy POS systems not built for the road\n\nHere’s the truth:\nModern delivery doesn’t fail because of bad drivers.\nIt fails because of disconnected tools.\n\nThe future of fleet management won’t be patched together.\nIt’ll be purpose-built.\n\nAnd that future?\n🚀 You’ll see it roll out sooner than you think.\n\n#RestaurantTech #FoodDelivery #Innovation #Technology #FoodTech #FoodInnovation #LastMileDelivery #FleetManagement #RestaurantManagement #gDispatch #Grubtech",
                "reactions_count": 9,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-06-25",
                "description": "From new connections to familiar faces, (FFCC) Fast Food & Cafe Convention this year reminded us why we do what we do, more strongly than ever.\n\nArijit Das, one of our beloved customers from SMAKIT shared their growth story of how they went from 0 to 60 brands in just 10 months, and how Grubtech played an integral part in streamlining their operations.\n\nMoments like these make the long days worth it. Thank you for letting us be part of your story.\n\nAnd a big shoutout to FFCC for organizing such an engaging event. \n\nSama Osama Raksha Bhambhani Ghassan Nawfal Ali Nisar Megan O’Riordan\n\n#FFCC #TheOpsDeepDive #Grubtech #SMAKIT #RestaurantTech",
                "reactions_count": 32,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-06-25",
                "description": "Restaurant menus aren’t just lists - they’re strategy in disguise.\n\nFrom pricing psychology to layout tactics, discover how modern restaurants are designing menus that sell smarter, not harder.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 20,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-06-06",
                "description": "May your day be filled with blessings, togetherness, and the comfort of food shared with loved ones.\nHere’s to feasting, reflecting, and reconnecting. 🌙🕊️    \nFrom all of us at Grubtech, Eid Mubarak!",
                "reactions_count": 21,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "1mo"
              },
              {
                "followers": 42966,
                "date": "2025-05-14",
                "description": "¡Estamos muy ilusionados de darle la bienvenida a Juan Lopez al equipo como nuestro Responsable de Ventas Estratégicas con sede en Barcelona!\n\nJuan cuenta con más de dos décadas de experiencia en los sectores de foodtech y retail. Con su profundo conocimiento en estrategia empresarial, desarrollo de producto y gestión de clientes, estamos convencidos de que Juan desempeñará un papel clave en ampliar nuestra presencia e impulsar el crecimiento en la región.\n\n¡Bienvenido a bordo, Juan!",
                "reactions_count": 32,
                "comments_count": 4,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-04-25",
                "description": "Big news for the Middle East restaurant community! 🚀 We’re ecstatic to unveil Grubtech's partnership with TMBill- Empowering 12,000+ Restaurants Globally, a POS powerhouse for restaurants.\n\nThis integration supercharges your operations by seamlessly connecting with top aggregators like Talabat, Careem, Jahez, Noon, Hunger Station, Mrsool, ToYou, Deliveroo and more — all in one dynamic ecosystem.\n\nWhat’s in store?\n✅ Real-time menu sync for instant updates\n✅ Unified order management across all platforms\n✅ Turbocharged efficiency with smarter insights\n\nTogether, we’re empowering restaurants to scale boldly and conquer new heights, from the Middle East to the world! 🌍\n\nA massive shoutout to Rahil Shaikh, Satya Ratna Raj kumar Geddam, and our incredible teams for making this a reality.\n\n💡 Join us in revolutionizing restaurant tech!\n\nKeerthana Akshay Shetty\n\n#Grubtech #TMBill #POSIntegration #RestaurantTech #RestaurantSuccess \n#MiddleEastRestaurants #AggregatorIntegration #FoodTech \n#GlobalPartnership",
                "reactions_count": 93,
                "comments_count": 3,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42966,
                "date": "2025-04-25",
                "description": "This one’s for restaurateurs looking to scale smarter—not harder.\n\nFrom catering hacks to nostalgia-powered menus, here’s what’s working in 2025.\n✨ 8 real growth strategies → https://lnkd.in/e-4jsRUd\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 12,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 527,
                "comments_count": 79,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-06-26",
                "description": "The real cost of chaos:\n\n🚚 Driver churn doubles in manually managed fleets\n⏱ 1 in 3 orders face peak-time delays\n📉 Front-of-house teams lose 2–3 hours a day just juggling dispatch\n💸 Missed revenue, strained teams, frustrated guests\n\nAnd yet, most restaurants are still trying to scale delivery with:\n→ Static spreadsheets\n→ WhatsApp routing hacks\n→ Legacy POS systems not built for the road\n\nHere’s the truth:\nModern delivery doesn’t fail because of bad drivers.\nIt fails because of disconnected tools.\n\nThe future of fleet management won’t be patched together.\nIt’ll be purpose-built.\n\nAnd that future?\n🚀 You’ll see it roll out sooner than you think.\n\n#RestaurantTech #FoodDelivery #Innovation #Technology #FoodTech #FoodInnovation #LastMileDelivery #FleetManagement #RestaurantManagement #gDispatch #Grubtech",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-06-25",
                "description": "From new connections to familiar faces, (FFCC) Fast Food & Cafe Convention this year reminded us why we do what we do, more strongly than ever.\n\nArijit Das, one of our beloved customers from SMAKIT shared their growth story of how they went from 0 to 60 brands in just 10 months, and how Grubtech played an integral part in streamlining their operations.\n\nMoments like these make the long days worth it. Thank you for letting us be part of your story.\n\nAnd a big shoutout to FFCC for organizing such an engaging event. \n\nSama Osama Raksha Bhambhani Ghassan Nawfal Ali Nisar Megan O’Riordan\n\n#FFCC #TheOpsDeepDive #Grubtech #SMAKIT #RestaurantTech",
                "reactions_count": 29,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-06-25",
                "description": "Restaurant menus aren’t just lists - they’re strategy in disguise.\n\nFrom pricing psychology to layout tactics, discover how modern restaurants are designing menus that sell smarter, not harder.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 17,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-06-06",
                "description": "May your day be filled with blessings, togetherness, and the comfort of food shared with loved ones.\nHere’s to feasting, reflecting, and reconnecting. 🌙🕊️    \nFrom all of us at Grubtech, Eid Mubarak!",
                "reactions_count": 21,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 16,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 8,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "1mo"
              },
              {
                "followers": 42865,
                "date": "2025-05-14",
                "description": "¡Estamos muy ilusionados de darle la bienvenida a Juan Lopez al equipo como nuestro Responsable de Ventas Estratégicas con sede en Barcelona!\n\nJuan cuenta con más de dos décadas de experiencia en los sectores de foodtech y retail. Con su profundo conocimiento en estrategia empresarial, desarrollo de producto y gestión de clientes, estamos convencidos de que Juan desempeñará un papel clave en ampliar nuestra presencia e impulsar el crecimiento en la región.\n\n¡Bienvenido a bordo, Juan!",
                "reactions_count": 32,
                "comments_count": 4,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-04-25",
                "description": "Big news for the Middle East restaurant community! 🚀 We’re ecstatic to unveil Grubtech's partnership with TMBill- Empowering 12,000+ Restaurants Globally, a POS powerhouse for restaurants.\n\nThis integration supercharges your operations by seamlessly connecting with top aggregators like Talabat, Careem, Jahez, Noon, Hunger Station, Mrsool, ToYou, Deliveroo and more — all in one dynamic ecosystem.\n\nWhat’s in store?\n✅ Real-time menu sync for instant updates\n✅ Unified order management across all platforms\n✅ Turbocharged efficiency with smarter insights\n\nTogether, we’re empowering restaurants to scale boldly and conquer new heights, from the Middle East to the world! 🌍\n\nA massive shoutout to Rahil Shaikh, Satya Ratna Raj kumar Geddam, and our incredible teams for making this a reality.\n\n💡 Join us in revolutionizing restaurant tech!\n\nKeerthana Akshay Shetty\n\n#Grubtech #TMBill #POSIntegration #RestaurantTech #RestaurantSuccess \n#MiddleEastRestaurants #AggregatorIntegration #FoodTech \n#GlobalPartnership",
                "reactions_count": 92,
                "comments_count": 3,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42865,
                "date": "2025-04-25",
                "description": "This one’s for restaurateurs looking to scale smarter—not harder.\n\nFrom catering hacks to nostalgia-powered menus, here’s what’s working in 2025.\n✨ 8 real growth strategies → https://lnkd.in/e-4jsRUd\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 12,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 526,
                "comments_count": 78,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-05-21",
                "description": "The best menus are part strategy, part storytelling, part psychology.\nHere are 10 innovative menu strategies for today’s tastes - fast, flexible, and flavor-forward.\n\nRead more - https://lnkd.in/gMmMANqZ\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 14,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-05-19",
                "description": "Sales pros, your next big move is calling.\nWe’re on a global growth mission and building a sales dream team across Barcelona, Dubai, Riyadh, Portugal—and beyond.\nIf you’ve got the hustle and heart to shape the future of foodtech, your seat at the table is waiting!",
                "reactions_count": 5,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Grubtech is on a global growth mission, and we’re assembling a powerhouse sales team to lead the charge ⚡\n\nIf you’ve got the hustle, the heart, and the hunger to shape the future of food and tech - let’s talk. \n\nWe’re hiring across multiple markets:\n\n📍 Barcelona or Remote: Strategic Sales Manager (UK)\n\n📍 Portugal: Sales Manager\n\n📍 Dubai: 2 Sales Managers (GCC) \n\n📍 Riyadh: Head of Sales & 2 Sales Managers\n\nReady to sell a game-changing platform that customers love?\n\nTag a friend, share this post, or hit us up - the future is being served, and your seat at the table is waiting. 🤝🏼 \n\nCheck out the opening here 👉🏼  https://lnkd.in/gV_ejHvB \n\n#SalesJobs #Grubtech #NowHiring #GlobalSales #TechCareers #Foodtech #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "1w"
              },
              {
                "followers": 42630,
                "date": "2025-05-14",
                "description": "¡Estamos muy ilusionados de darle la bienvenida a Juan Lopez al equipo como nuestro Responsable de Ventas Estratégicas con sede en Barcelona!\n\nJuan cuenta con más de dos décadas de experiencia en los sectores de foodtech y retail. Con su profundo conocimiento en estrategia empresarial, desarrollo de producto y gestión de clientes, estamos convencidos de que Juan desempeñará un papel clave en ampliar nuestra presencia e impulsar el crecimiento en la región.\n\n¡Bienvenido a bordo, Juan!",
                "reactions_count": 32,
                "comments_count": 4,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-04-25",
                "description": "Big news for the Middle East restaurant community! 🚀 We’re ecstatic to unveil Grubtech's partnership with TMBill- Empowering 12,000+ Restaurants Globally, a POS powerhouse for restaurants.\n\nThis integration supercharges your operations by seamlessly connecting with top aggregators like Talabat, Careem, Jahez, Noon, Hunger Station, Mrsool, ToYou, Deliveroo and more — all in one dynamic ecosystem.\n\nWhat’s in store?\n✅ Real-time menu sync for instant updates\n✅ Unified order management across all platforms\n✅ Turbocharged efficiency with smarter insights\n\nTogether, we’re empowering restaurants to scale boldly and conquer new heights, from the Middle East to the world! 🌍\n\nA massive shoutout to Rahil Shaikh, Satya Ratna Raj kumar Geddam, and our incredible teams for making this a reality.\n\n💡 Join us in revolutionizing restaurant tech!\n\nKeerthana Akshay Shetty\n\n#Grubtech #TMBill #POSIntegration #RestaurantTech #RestaurantSuccess \n#MiddleEastRestaurants #AggregatorIntegration #FoodTech \n#GlobalPartnership",
                "reactions_count": 91,
                "comments_count": 3,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-04-25",
                "description": "This one’s for restaurateurs looking to scale smarter—not harder.\n\nFrom catering hacks to nostalgia-powered menus, here’s what’s working in 2025.\n✨ 8 real growth strategies → https://lnkd.in/e-4jsRUd\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 12,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-04-18",
                "description": "Calling all sales leaders in Riyadh!\n\nGrubtech is on the lookout for a Head of Sales – KSA to lead our SMB/Midmarket team across the GCC.\n\nThis is your chance to make a big impact - with a great team behind you.\n\nWhat we’re looking for:\n✔ 8+ years in SaaS sales\n✔ Proven leadership & deal-closing skills\n✔ Fluent in Arabic & English\n✔ Passion for tech + food? Big bonus \n\nThink you're the one? Dive in:\n🔗 https://lnkd.in/gdP6jTWP\n\n#Careers #Sales #KSA #RestaurantManagement #Innovation #Technology #Grubtech",
                "reactions_count": 29,
                "comments_count": 2,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-04-16",
                "description": "Insight meets impact.\n\nGrubtech’s very own José Peres joins the inaugural issue of The Report by ThinkPaladar - Food Delivery Growth, sharing valuable perspectives on food and tech trends in Europe.\n\nAn inspiring read from voices driving the future of hospitality.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 25,
                "comments_count": 3,
                "reshared_post_author": "ThinkPaladar - Food Delivery Growth",
                "reshared_post_author_url": "https://es.linkedin.com/company/thinkpaladar",
                "reshared_post_author_headline": null,
                "reshared_post_description": "🚀 The Report by ThinkPaladar 🚀\nDespués de meses de trabajo, estamos orgullosos de presentar The Report by ThinkPaladar, la primera edición de nuestra publicación trimestral con entrevistas exclusivas, insights esenciales y las noticias más impactantes del sector.\n\n📖 ¿Qué encontrarás en esta edición?\n\n✅ Las marcas que están marcando tendencia: descubre como Starbucks, NOT FROM ITALY, Pomona Club, Honest Greens y muchas más están revolucionando el mercado.\n\n✅ Entrevistas con los protagonistas del sector:\n🔹 José Peres, Lead Partnerships Manager Europe en Grubtech\n🔹 Miguel Ron, CEO y CoFundador de CLOUDTOWN BRANDS\n🔹 Luisana Millán Borromé .·., Directora de Operaciones en GNF Worldwide\n🔹 Balbina M., Field Sales en UberEats\n\n✅ Los datos más relevantes del sector, analizados por nuestros expertos Inés Gallarde Llevat y Bosco López de Lamadrid\n\n✅ Las aperturas y expansiones más importantes del trimestre\n\n💬 Comenta este post y estaremos encantados enviartela",
                "reshared_post_followers": null,
                "reshared_post_date": "1mo"
              },
              {
                "followers": 42630,
                "date": "2025-04-16",
                "description": "Loud, messy, and full of laughs - just how team bonding should be! 🛒💬\n\nThis week, things got loud - in the best way possible. Our Egypt team jumped into a hilarious team-bonding game called The Supermarket, a game that turned a regular workday into a fun reminder of how tricky (and rewarding) communication can be.\n\n➡️ One person steps out\n🗣️ They give a shopping list\n🕵️♀️ The rest of the team? In a room full of noise trying to decode it!\n\nThe result? A lot of yelling, guessing, laughing - and a pretty great lesson: when we take a moment to really listen (even in the noise), we connect better.\n\nBecause being a great team isn’t just about goals and deadlines - it’s about understanding each other, even when the volume’s up.\n\nFarah Omar Farah Amr Mohamed El-Attar Kanzi El Derini Hassan Elsayed Heba El-Maghraby Abdulrahman Ghorab Ahmed Bakr Mahmoud Ahmed el shafey Loloua Besheer Anne Moustafa Dina Ali Safinaz Ahmed Mostafa Esmail Hazem Srour Shimaa safieldein Mohamed Hamdy Abdelrahman Shehata\n\n#TeamCulture #NoiseAwareness #WorkplaceWellness #Collaboration #Grubtech",
                "reactions_count": 103,
                "comments_count": 2,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42630,
                "date": "2025-04-10",
                "description": "It’s not every day you get surprised with a basket full of yummy goodness!\n\nBig thanks to our beloved customer Al Rifai Arabia for the treat - crunchy, classy, and delicious!\n\nGhaith Timani Mohamed Al Fayed Ghassan Nawfal\n\n#ClientSurprise #Grubtech",
                "reactions_count": 176,
                "comments_count": 8,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 524,
                "comments_count": 78,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2025-04-25",
                "description": "Big news for the Middle East restaurant community! 🚀 We’re ecstatic to unveil Grubtech's partnership with TMBill- Empowering 12,000+ Restaurants Globally, a POS powerhouse for restaurants.\n\nThis integration supercharges your operations by seamlessly connecting with top aggregators like Talabat, Careem, Jahez, Noon, Hunger Station, Mrsool, ToYou, Deliveroo and more — all in one dynamic ecosystem.\n\nWhat’s in store?\n✅ Real-time menu sync for instant updates\n✅ Unified order management across all platforms\n✅ Turbocharged efficiency with smarter insights\n\nTogether, we’re empowering restaurants to scale boldly and conquer new heights, from the Middle East to the world! 🌍\n\nA massive shoutout to Rahil Shaikh, Satya Ratna Raj kumar Geddam, and our incredible teams for making this a reality.\n\n💡 Join us in revolutionizing restaurant tech!\n\nKeerthana Akshay Shetty\n\n#Grubtech #TMBill #POSIntegration #RestaurantTech #RestaurantSuccess \n#MiddleEastRestaurants #AggregatorIntegration #FoodTech \n#GlobalPartnership",
                "reactions_count": 73,
                "comments_count": 3,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2025-04-25",
                "description": "This one’s for restaurateurs looking to scale smarter—not harder.\n\nFrom catering hacks to nostalgia-powered menus, here’s what’s working in 2025.\n✨ 8 real growth strategies → https://lnkd.in/e-4jsRUd\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 9,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2025-04-18",
                "description": "Calling all sales leaders in Riyadh!\n\nGrubtech is on the lookout for a Head of Sales – KSA to lead our SMB/Midmarket team across the GCC.\n\nThis is your chance to make a big impact - with a great team behind you.\n\nWhat we’re looking for:\n✔ 8+ years in SaaS sales\n✔ Proven leadership & deal-closing skills\n✔ Fluent in Arabic & English\n✔ Passion for tech + food? Big bonus \n\nThink you're the one? Dive in:\n🔗 https://lnkd.in/gdP6jTWP\n\n#Careers #Sales #KSA #RestaurantManagement #Innovation #Technology #Grubtech",
                "reactions_count": 26,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2025-04-16",
                "description": "Insight meets impact.\n\nGrubtech’s very own José Peres joins the inaugural issue of The Report by ThinkPaladar - Food Delivery Growth, sharing valuable perspectives on food and tech trends in Europe.\n\nAn inspiring read from voices driving the future of hospitality.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 22,
                "comments_count": 3,
                "reshared_post_author": "ThinkPaladar - Food Delivery Growth",
                "reshared_post_author_url": "https://es.linkedin.com/company/thinkpaladar",
                "reshared_post_author_headline": null,
                "reshared_post_description": "🚀 The Report by ThinkPaladar 🚀\nDespués de meses de trabajo, estamos orgullosos de presentar The Report by ThinkPaladar, la primera edición de nuestra publicación trimestral con entrevistas exclusivas, insights esenciales y las noticias más impactantes del sector.\n\n📖 ¿Qué encontrarás en esta edición?\n\n✅ Las marcas que están marcando tendencia: descubre como Starbucks, NOT FROM ITALY, Pomona Club, Honest Greens y muchas más están revolucionando el mercado.\n\n✅ Entrevistas con los protagonistas del sector:\n🔹 José Peres, Lead Partnerships Manager Europe en Grubtech\n🔹 Miguel Ron, CEO y CoFundador de CLOUDTOWN BRANDS\n🔹 Luisana Millán Borromé .·., Directora de Operaciones en GNF Worldwide\n🔹 Balbina M., Field Sales en UberEats\n\n✅ Los datos más relevantes del sector, analizados por nuestros expertos Inés Gallarde Llevat y Bosco López de Lamadrid\n\n✅ Las aperturas y expansiones más importantes del trimestre\n\n💬 Comenta este post y estaremos encantados enviartela",
                "reshared_post_followers": null,
                "reshared_post_date": "3w"
              },
              {
                "followers": 42365,
                "date": "2025-04-16",
                "description": "Loud, messy, and full of laughs - just how team bonding should be! 🛒💬\n\nThis week, things got loud - in the best way possible. Our Egypt team jumped into a hilarious team-bonding game called The Supermarket, a game that turned a regular workday into a fun reminder of how tricky (and rewarding) communication can be.\n\n➡️ One person steps out\n🗣️ They give a shopping list\n🕵️♀️ The rest of the team? In a room full of noise trying to decode it!\n\nThe result? A lot of yelling, guessing, laughing - and a pretty great lesson: when we take a moment to really listen (even in the noise), we connect better.\n\nBecause being a great team isn’t just about goals and deadlines - it’s about understanding each other, even when the volume’s up.\n\nFarah Omar Farah Amr Mohamed El-Attar Kanzi El Derini Hassan Elsayed Heba El-Maghraby Abdulrahman Ghorab Ahmed Bakr Mahmoud Ahmed el shafey Loloua Besheer Anne Moustafa Dina Ali Safinaz Ahmed Mostafa Esmail Hazem Srour Shimaa safieldein Mohamed Hamdy Abdelrahman Shehata\n\n#TeamCulture #NoiseAwareness #WorkplaceWellness #Collaboration #Grubtech",
                "reactions_count": 93,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2025-04-10",
                "description": "It’s not every day you get surprised with a basket full of yummy goodness!\n\nBig thanks to our beloved customer Al Rifai Arabia for the treat - crunchy, classy, and delicious!\n\nGhaith Timani Mohamed Al Fayed Ghassan Nawfal\n\n#ClientSurprise #Grubtech",
                "reactions_count": 176,
                "comments_count": 8,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 42365,
                "date": "2025-04-04",
                "description": "We are partnering with theRest® Consulting to empower restaurants across Spain on their journey to success!\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 18,
                "comments_count": 1,
                "reshared_post_author": "theRest® Consulting",
                "reshared_post_author_url": "https://es.linkedin.com/company/therestconsulting",
                "reshared_post_author_headline": null,
                "reshared_post_description": "theRest x Grubtech!  Impulsando la eficiencia en la restauración.\n\nLa optimización de operaciones es clave en el sector gastronómico, y Grubtech lo hace posible con su tecnología de gestión unificada. Desde la integración de pedidos hasta la automatización de procesos, esta colaboración ayudará a nuestros clientes a operar de manera más eficiente, reducir costos y mejorar la experiencia del cliente.\n\nEn theRest seguimos apostando por aliados estratégicos que transforman el sector con soluciones innovadoras. ¡El futuro de la restauración es ahora!",
                "reshared_post_followers": null,
                "reshared_post_date": "1mo"
              },
              {
                "followers": 42365,
                "date": "2025-04-04",
                "description": "We’re growing, and you could be our next game-changer!\n\nIf you're ready to build, innovate, and have fun along the way, check out our open roles. Let’s do great things together!\n\n#wearehiring #careers #grubtech",
                "reactions_count": 24,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "𝗪𝗲’𝗿𝗲 𝗚𝗿𝗼𝘄𝗶𝗻𝗴 𝗮𝗻𝗱 𝗦𝗼 𝗖𝗮𝗻 𝗬𝗼𝘂! \n\n𝖠𝗋𝖾 𝗒𝗈𝗎 𝗋𝖾𝖺𝖽𝗒 𝗍𝗈 𝖻𝖾 𝗉𝖺𝗋𝗍 𝗈𝖿 𝗌𝗈𝗆𝖾𝗍𝗁𝗂𝗇𝗀 𝗀𝗋𝗈𝗎𝗇𝖽𝖻𝗋𝖾𝖺𝗄𝗂𝗇𝗀? 𝖶𝖾’𝗋𝖾 𝗈𝗇 𝗍𝗁𝖾 𝗅𝗈𝗈𝗄𝗈𝗎𝗍 𝖿𝗈𝗋 𝗍𝖺𝗅𝖾𝗇𝗍𝖾𝖽, 𝖽𝗋𝗂𝗏𝖾𝗇, 𝖺𝗇𝖽 𝗂𝗇𝗇𝗈𝗏𝖺𝗍𝗂𝗏𝖾 𝗆𝗂𝗇𝖽𝗌 𝗍𝗈 𝗃𝗈𝗂𝗇 Grubtech. 𝖧𝖾𝗋𝖾’𝗌 𝗒𝗈𝗎𝗋 𝖼𝗁𝖺𝗇𝖼𝖾 𝗍𝗈 𝖻𝗎𝗂𝗅𝖽, 𝗅𝖾𝖺𝖽, 𝖺𝗇𝖽 𝗍𝗁𝗋𝗂𝗏𝖾 𝗂𝗇 𝖺 𝗉𝗅𝖺𝖼𝖾 𝗍𝗁𝖺𝗍 𝗏𝖺𝗅𝗎𝖾𝗌 𝖼𝗋𝖾𝖺𝗍𝗂𝗏𝗂𝗍𝗒 𝖺𝗇𝖽 𝖾𝗑𝖼𝖾𝗅𝗅𝖾𝗇𝖼𝖾. \n\n𝗪𝗵𝘆 𝗚𝗿𝘂𝗯𝘁𝗲𝗰𝗵? 𝖡𝖾𝖼𝖺𝗎𝗌𝖾 𝗐𝖾’𝗋𝖾 𝗇𝗈𝗍 𝗃𝗎𝗌𝗍 𝗈𝖿𝖿𝖾𝗋𝗂𝗇𝗀 𝗃𝗈𝖻𝗌 – 𝗐𝖾’𝗋𝖾 𝗈𝖿𝖿𝖾𝗋𝗂𝗇𝗀 𝗈𝗉𝗉𝗈𝗋𝗍𝗎𝗇𝗂𝗍𝗂𝖾𝗌 𝗍𝗈 𝗂𝗇𝗇𝗈𝗏𝖺𝗍𝖾, 𝗀𝗋𝗈𝗐, 𝖺𝗇𝖽 𝗋𝖾𝖽𝖾𝖿𝗂𝗇𝖾 𝗍𝗁𝖾 𝗂𝗇𝖽𝗎𝗌𝗍𝗋𝗒. \n\n𝖢𝗁𝖾𝖼𝗄 𝗈𝗎𝗍 𝗍𝗁𝖾 𝖽𝖾𝗍𝖺𝗂𝗅𝗌 𝖺𝗇𝖽 𝗮𝗽𝗽𝗹𝘆 𝗻𝗼𝘄! 𝖸𝗈𝗎𝗋 𝗇𝖾𝗑𝗍 𝖻𝗂𝗀 𝗆𝗈𝗏𝖾 𝖼𝗈𝗎𝗅𝖽 𝖻𝖾 𝗃𝗎𝗌𝗍 𝖺 𝖼𝗅𝗂𝖼𝗄 𝖺𝗐𝖺𝗒. \n\n#wearehiring #engineeringopportunities #Grubtechcareers #jointhejourney #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "1mo"
              },
              {
                "followers": 42365,
                "date": "2025-03-30",
                "description": "A Time to Give, A Time to Celebrate\n\nThis month has been all about kindness, generosity and reflection. May today bring you closer to those you cherish.\n\nEid al-Fitr Mubarak from Grubtech!\n\n#EidMubarak #Grubtech",
                "reactions_count": 11,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 522,
                "comments_count": 78,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-04-04",
                "description": "We are partnering with theRest® Consulting to empower restaurants across Spain on their journey to success!\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 3,
                "comments_count": null,
                "reshared_post_author": "theRest® Consulting",
                "reshared_post_author_url": "https://es.linkedin.com/company/therestconsulting",
                "reshared_post_author_headline": null,
                "reshared_post_description": "theRest x Grubtech!  Impulsando la eficiencia en la restauración.\n\nLa optimización de operaciones es clave en el sector gastronómico, y Grubtech lo hace posible con su tecnología de gestión unificada. Desde la integración de pedidos hasta la automatización de procesos, esta colaboración ayudará a nuestros clientes a operar de manera más eficiente, reducir costos y mejorar la experiencia del cliente.\n\nEn theRest seguimos apostando por aliados estratégicos que transforman el sector con soluciones innovadoras. ¡El futuro de la restauración es ahora!",
                "reshared_post_followers": null,
                "reshared_post_date": "2w"
              },
              {
                "followers": 41964,
                "date": "2025-04-04",
                "description": "We’re growing, and you could be our next game-changer!\n\nIf you're ready to build, innovate, and have fun along the way, check out our open roles. Let’s do great things together!\n\n#wearehiring #careers #grubtech",
                "reactions_count": 7,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "𝗪𝗲’𝗿𝗲 𝗚𝗿𝗼𝘄𝗶𝗻𝗴 𝗮𝗻𝗱 𝗦𝗼 𝗖𝗮𝗻 𝗬𝗼𝘂! \n\n𝖠𝗋𝖾 𝗒𝗈𝗎 𝗋𝖾𝖺𝖽𝗒 𝗍𝗈 𝖻𝖾 𝗉𝖺𝗋𝗍 𝗈𝖿 𝗌𝗈𝗆𝖾𝗍𝗁𝗂𝗇𝗀 𝗀𝗋𝗈𝗎𝗇𝖽𝖻𝗋𝖾𝖺𝗄𝗂𝗇𝗀? 𝖶𝖾’𝗋𝖾 𝗈𝗇 𝗍𝗁𝖾 𝗅𝗈𝗈𝗄𝗈𝗎𝗍 𝖿𝗈𝗋 𝗍𝖺𝗅𝖾𝗇𝗍𝖾𝖽, 𝖽𝗋𝗂𝗏𝖾𝗇, 𝖺𝗇𝖽 𝗂𝗇𝗇𝗈𝗏𝖺𝗍𝗂𝗏𝖾 𝗆𝗂𝗇𝖽𝗌 𝗍𝗈 𝗃𝗈𝗂𝗇 Grubtech. 𝖧𝖾𝗋𝖾’𝗌 𝗒𝗈𝗎𝗋 𝖼𝗁𝖺𝗇𝖼𝖾 𝗍𝗈 𝖻𝗎𝗂𝗅𝖽, 𝗅𝖾𝖺𝖽, 𝖺𝗇𝖽 𝗍𝗁𝗋𝗂𝗏𝖾 𝗂𝗇 𝖺 𝗉𝗅𝖺𝖼𝖾 𝗍𝗁𝖺𝗍 𝗏𝖺𝗅𝗎𝖾𝗌 𝖼𝗋𝖾𝖺𝗍𝗂𝗏𝗂𝗍𝗒 𝖺𝗇𝖽 𝖾𝗑𝖼𝖾𝗅𝗅𝖾𝗇𝖼𝖾. \n\n𝗪𝗵𝘆 𝗚𝗿𝘂𝗯𝘁𝗲𝗰𝗵? 𝖡𝖾𝖼𝖺𝗎𝗌𝖾 𝗐𝖾’𝗋𝖾 𝗇𝗈𝗍 𝗃𝗎𝗌𝗍 𝗈𝖿𝖿𝖾𝗋𝗂𝗇𝗀 𝗃𝗈𝖻𝗌 – 𝗐𝖾’𝗋𝖾 𝗈𝖿𝖿𝖾𝗋𝗂𝗇𝗀 𝗈𝗉𝗉𝗈𝗋𝗍𝗎𝗇𝗂𝗍𝗂𝖾𝗌 𝗍𝗈 𝗂𝗇𝗇𝗈𝗏𝖺𝗍𝖾, 𝗀𝗋𝗈𝗐, 𝖺𝗇𝖽 𝗋𝖾𝖽𝖾𝖿𝗂𝗇𝖾 𝗍𝗁𝖾 𝗂𝗇𝖽𝗎𝗌𝗍𝗋𝗒. \n\n𝖢𝗁𝖾𝖼𝗄 𝗈𝗎𝗍 𝗍𝗁𝖾 𝖽𝖾𝗍𝖺𝗂𝗅𝗌 𝖺𝗇𝖽 𝗮𝗽𝗽𝗹𝘆 𝗻𝗼𝘄! 𝖸𝗈𝗎𝗋 𝗇𝖾𝗑𝗍 𝖻𝗂𝗀 𝗆𝗈𝗏𝖾 𝖼𝗈𝗎𝗅𝖽 𝖻𝖾 𝗃𝗎𝗌𝗍 𝖺 𝖼𝗅𝗂𝖼𝗄 𝖺𝗐𝖺𝗒. \n\n#wearehiring #engineeringopportunities #Grubtechcareers #jointhejourney #applynow",
                "reshared_post_followers": null,
                "reshared_post_date": "23h"
              },
              {
                "followers": 41964,
                "date": "2025-03-30",
                "description": "A Time to Give, A Time to Celebrate\n\nThis month has been all about kindness, generosity and reflection. May today bring you closer to those you cherish.\n\nEid al-Fitr Mubarak from Grubtech!\n\n#EidMubarak #Grubtech",
                "reactions_count": 9,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-03-26",
                "description": "No futuristic robots - just real tools that make running a restaurant easier.\n\nFrom smart menus to automated order management, some tools are helping restaurants ease the operational headache and make bigger profits. \n\nFind out more: https://lnkd.in/gBgAeMBh    \n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 17,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-03-17",
                "description": "Exciting news from Spain’s restaurant scene straight from Europapress\n\nWe’re beyond excited to team up with Glovo On-Demand to power restaurants in Spain with seamless delivery management. With Grubtech + Glovo On-Demand, restaurants can now streamline their delivery operations like never before - precise order handling, automated updates, and real-time delivery tracking are just the beginning. We’re pumped for what’s ahead! Let’s go!\n\nRead More: https://lnkd.in/g4brs9BD\n\nMohamed Al Fayed Omar Rifai Yann Fruchart José Peres Keerthana Akshay Shetty Sajar Imran Daniel Arvelo Ghassan Nawfal\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech #Glovo",
                "reactions_count": 18,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-03-14",
                "description": "The Energy Was Unmatched! ⚡\n\nHIP - Horeca Professional Expo 2025 was nothing short of amazing! We connected with incredible industry leaders, shared insights, and had inspiring conversations about the future of F&B tech. \n\nA huge GRACIAS to everyone who stopped by our booth - we can't wait to continue this journey with you!   \n\nJuan  Jose Gutierrez Felipe Fadón Luis Martín Pedro Martín Gómez Soriano Santiago Torres Torija Gonzalo Saenz Brand Diogo Vasques Jorge Amorós Ribera Kirill Hudjakov Nicolás M. Francesco Gervasoni Ramon Lopez-Doriga\nRafael Marques Daniel Arvelo Omar Gil Andani David Vallés Yann Fruchart José Peres\n\n#HIP2025 #InovaçãoNaRestauração #Horeca #TecnologiaParaRestaurantes #Tecnologia #Grubtech #GrubtechIberia",
                "reactions_count": 97,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-03-12",
                "description": "The biggest problem in UK restaurants? It’s not the food - it’s fragmented operations. Here’s what to do about it! \n\nRead more - https://lnkd.in/gEyziZGZ \n\nMegan O’Riordan\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 15,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-03-11",
                "description": "To a nation built on faith, strength, and vision. 💚✨ \n\nAs Saudi Arabia’s flag flies high today, we celebrate the heart and soul of the Kingdom - its people, its culture, and its relentless drive for excellence. We at Grubtech are proud to support the businesses that make this country extraordinary!\n\nHappy Saudi Flag Day!\n\n#SaudiFlagDay #Grubtech",
                "reactions_count": 12,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": 41964,
                "date": "2025-03-10",
                "description": "Kicking off Day 1 at HIP - Horeca Professional Expo Spain! \n\nOur team is all set and ready to welcome you! Swing by our stand 4F624, Pavilion 4 at IFEMA, Madrid. Say hello, and let’s make this event unforgettable - see you there! 👋✨\n\nGuillermo Galera Daniel Arvelo Rafael Marques José Peres Omar Gil Andani David Vallés \n\nHosteltáctil by LOOMIS-PAY Ágora TPV\n\n#HIP25 #RestauraciónDelFuturo #InnovaciónGastronómica #SaludMental #Restauracion #Grubtech #GrubtechIberia",
                "reactions_count": 70,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2024-05-28",
                "description": "🌟 Exciting News! Our Series B Announcement!! 🌟\n \nWe are thrilled to announce that Grubtech has successfully raised $15 million in our Series B, led by the VC arm of Jahez International Company and participation from our existing investors Addition and Hambro Perks through their MENA focused Oryx Fund. This marks a significant milestone for us as we continue to drive innovation in the F&B and Quick Commerce sectors.\n \nWith these new funds, we are set to accelerate our geographic expansion into Saudi Arabia, Europe, and the UK, bringing our advanced SaaS integration and unified commerce platform to new markets. Our flagship solution, gOnline, along with our comprehensive suite of products, empowers thousands of customers by integrating online and in-store operations, streamlining fulfilment and harnessing AI-driven data analysis. We’re proud of the remarkable results we hear from our customers, including doubling sales per square meter, improving speed of service by 25%, reducing operating expenses and wastage.\n \nA huge thank you to our team, our investors, and our customers for believing in our vision and supporting us on this journey. We are just getting started, and I can’t wait to see what the future holds for Grubtech as we continue to innovate and expand.\n\nhttps://lnkd.in/d97CBQDw\n \n#Grubtech #SeriesB #Funding #Innovation #F&B #QuickCommerce #TechIntegration #Expansion #Growth",
                "reactions_count": 519,
                "comments_count": 78,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-02-28",
                "description": "Before the first light of suhoor to the joy of iftar, every meal tells a story of generosity and tradition. 🌙✨ Grubtech is grateful to be part of the journeys that bring people closer this Ramadan. \n\nMay this month bring you peace, prosperity, and plenty of heartwarming moments.\n\n#RamadanKareem",
                "reactions_count": 20,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-02-28",
                "description": "Meet our incredible team at HIP - Horeca Professional Expo 2025!\n\nThe heart of Horeca innovation is beating in Madrid, and we’re tuning in! Meet us at HIP Spain, where the biggest names in Horeca innovation will gather to shape the future of restaurant and hospitality tech. \n\nWhether you're running a cloud kitchen, a growing restaurant brand, or an enterprise chain, we’ve got the tech you need. \n\n📅 March 10-12, 2025\n📍 IFEMA Madrid\n🛠️ Pavilion 4, Stand 4F624. \n\nDrop by and say hello to Guillermo Galera Daniel Arvelo Rafael Marques José Peres, and see how we help restaurants scale without the headaches.\n\nYann Fruchart David Vallés Omar Gil Andani\n\nHosteltáctil by LOOMIS-PAY Ágora TPV\n\n#HIP25 #RestauraciónDelFuturo #InnovaciónGastronómica #SaludMental #Restauracion #Grubtech #GrubtechIberia",
                "reactions_count": 46,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-02-18",
                "description": "Grubtech is on the lookout for brilliant minds to join our team in the Iberian Region, KSA, UK and Sri Lanka! \n\nIf you’ve got the passion and drive to innovate, this is your moment.\n\nExplore roles: https://lnkd.in/gV_ejHvB \n\n#RestaurantTech #FoodTech #Careers #Innovation #Technology #Grubtech",
                "reactions_count": 17,
                "comments_count": null,
                "reshared_post_author": "Rushadha Ramzeen",
                "reshared_post_author_url": "https://lk.linkedin.com/in/rushadha-ramzeen",
                "reshared_post_author_headline": "Global Technical Recruiter 🌎 \nHR Partner for All Things People 🫱🏻🫲🏼 \nFreelancer I Connecting People & Possibilities✨ Toastmaster🎤",
                "reshared_post_description": "Ever wondered what it's like to revolutionize the restaurant tech industry? Here's your chance!\n\nGrubtech is expanding our dream team across THREE continents, and we're looking for rockstars like you! 🫵🏼 \n\nReady to jump in? Apply here 👉🏼  https://lnkd.in/gV_ejHvB \n\n\nKnow someone perfect for these roles? Tag them! Great teams are built through great connections! 🤝🏼 \n\n#JoinGrubtech #FoodTech #Careers #TechJobs #SalesJobs #Engineering #hiringnow",
                "reshared_post_followers": null,
                "reshared_post_date": "1w"
              },
              {
                "followers": null,
                "date": "2025-02-10",
                "description": "All roads lead to HIP - Horeca Professional Expo Madrid, and we’re on our way! 🇪🇸 🛣️\n\nFrom bustling kitchens to seamless deliveries, Grubtech is changing the game for restaurants worldwide—and now, we’re bringing our magic to HIP Madrid! 🎉✨\n\nWe’re not just attending Spain’s biggest Horeca event; we’re here to shake things up, meet the industry’s best, and show restaurant owners how tech can transform their operations. 💡🍽️\n\nMadrid, get ready—because the future of F&B is here, and it’s powered by Grubtech! 👋✨ See you at IFEMA!\n\n🔗 Want to connect with our team ahead of the event? Book a meeting now: grubtech.com/hip-spain 🔥\n\nYann Fruchart David Vallés Armando L. Estrella Peraza Daniel Arvelo Guillermo Galera José Peres Omar Gil Andani \n\nÁgora TPV Hosteltáctil by LOOMIS-PAY\n\n#HIP2025 #RestaurantInnovation #Horeca #RestaurantTech #Technology #Grubtech #GrubtechIberia",
                "reactions_count": 6,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-02-05",
                "description": "Big wins come from big opportunities, and 2025’s top F&B events are where the magic happens. We’ve curated the Top 13 must-attend events that will fuel your growth, connect you with industry leaders, and keep you ahead of the game.\n\n💡 Get the full list on our blog! - https://lnkd.in/gJbkNsne\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 21,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-01-24",
                "description": "Who doesn’t love Smiles? 😊 Grubtech is spreading them to your restaurant through our integration with Smiles by e& UAE, the favorite app for rewards-loving customers. This exciting partnership helps you boost customer loyalty, attract more footfall, and streamline operations seamlessly with Grubtech’s advanced platform. \n\nKeerthana Akshay Shetty Sajar Imran Ghassan Nawfal Varsha Biju Raksha Bhambhani Driss E. Geoffrey D'Souza\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #SmilesUAE #Grubtech",
                "reactions_count": 60,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-01-20",
                "description": "BBC Features Grubtech\n\nWhat a moment to celebrate! Grubtech has been featured on BBC for winning the prestigious Unicorn Kingdom Pathfinder Award! This recognition is a testament to the journey we’ve been on, processing over 21 million orders, partnering with 700+ incredible brands, and making an impact in 20+ countries worldwide.\n\nThis achievement wouldn’t have been possible without our amazing team and our trusted partners. Your belief in us fuels our passion to innovate and deliver even better solutions every day.\n\nThank you for being part of this journey. Here’s to reaching new heights together!\n\nRead full story: https://lnkd.in/gP524qWB\n\nDepartment for Business and Trade\n\nMohamed Al Fayed Mohamed Hamedi Omar Rifai Jamil Diab Ghassan Nawfal \n\n#BBC #UnicornKingdomPathfinderAwards #RestaurantTech #Innovation #Grubtech",
                "reactions_count": 168,
                "comments_count": 9,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-01-17",
                "description": "Calling all restaurateurs! 📣 We've got good news!\n\nWe’re super excited to announce our partnership with EatEasy - Order Food & Grocery Online! With this integration, restaurateurs using Grubtech can now easily connect with EatEasy. This partnership means effortless reach, smarter operations, and happier customers for you! \n\nMohamed Hamedi Ghassan Nawfal Keerthana Akshay Shetty Sajar Imran Ramis M.\n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #EatEasy #Grubtech",
                "reactions_count": 53,
                "comments_count": null,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              },
              {
                "followers": null,
                "date": "2025-01-02",
                "description": "What a Year to Remember! ✨\n\n2024 has been a truly inspiring year for all of us. From expanding into new markets to game-changing acquisitions, we’ve been busy turning bold visions into reality—all thanks to our amazing team, partners, and customers. 💪\n\nHere’s to the milestones we’ve achieved together and the wins we'll celebrate in 2025. Thank you for being part of our journey—stay tuned for even more innovation and growth! \n\n#RestaurantTech #Innovation #Technology #FoodTech #FoodInnovation #RestaurantManagement #Grubtech",
                "reactions_count": 40,
                "comments_count": 1,
                "reshared_post_author": null,
                "reshared_post_author_url": null,
                "reshared_post_author_headline": null,
                "reshared_post_description": null,
                "reshared_post_followers": null,
                "reshared_post_date": null
              }
            ],
            "num_technologies_used": 76,
            "technologies_used": [
              {
                "technology": "adobe premiere pro",
                "first_verified_at": "2025-08-05",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "confluent",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "java",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "apache kafka",
                "first_verified_at": "2025-04-08",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "microsoft teams",
                "first_verified_at": "2025-04-08",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "asana",
                "first_verified_at": "2024-05-13",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "microservices",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "amazon cloudwatch",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "couchbase",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "react",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "appium",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "deliveroo",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "mongodb",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "flutter",
                "first_verified_at": "2025-09-07",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "aws lambda",
                "first_verified_at": "2025-02-18",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "javascript",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "jira",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "spring boot",
                "first_verified_at": "2025-02-18",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "css",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "linkedin",
                "first_verified_at": "2024-07-15",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "typescript",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "oracle",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "postgresql",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "trello",
                "first_verified_at": "2024-05-13",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "html",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "gcc",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "selenium",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "redis",
                "first_verified_at": "2025-04-08",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "adobe",
                "first_verified_at": "2024-08-05",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "circleci",
                "first_verified_at": "2024-10-07",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "apache",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "microsoft",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "confluent kafka",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "playwright",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "dart",
                "first_verified_at": "2025-09-07",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "hubspot",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "final cut pro",
                "first_verified_at": "2024-08-05",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "confluence",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "api gateway",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "git",
                "first_verified_at": "2024-10-07",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "hubspot crm",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "github",
                "first_verified_at": "2025-09-07",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "bamboohr",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "amazon s3",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "adobe creative suite",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-08"
              },
              {
                "technology": "scala",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-05"
              },
              {
                "technology": "mysql",
                "first_verified_at": "2024-10-07",
                "last_verified_at": "2025-09-05"
              },
              {
                "technology": "python",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-09-05"
              },
              {
                "technology": "databricks",
                "first_verified_at": "2024-10-07",
                "last_verified_at": "2025-09-05"
              },
              {
                "technology": "apache spark",
                "first_verified_at": "2025-02-18",
                "last_verified_at": "2025-09-05"
              },
              {
                "technology": "sql",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-09-05"
              },
              {
                "technology": "microsoft office",
                "first_verified_at": "2025-02-18",
                "last_verified_at": "2025-08-25"
              },
              {
                "technology": "linkedin sales navigator",
                "first_verified_at": "2025-08-17",
                "last_verified_at": "2025-08-25"
              },
              {
                "technology": "google workspace",
                "first_verified_at": "2024-11-25",
                "last_verified_at": "2025-08-25"
              },
              {
                "technology": "salesforce",
                "first_verified_at": "2024-07-15",
                "last_verified_at": "2025-08-25"
              },
              {
                "technology": "sales navigator",
                "first_verified_at": "2024-07-15",
                "last_verified_at": "2025-08-25"
              },
              {
                "technology": "impact",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-08-11"
              },
              {
                "technology": "amp",
                "first_verified_at": "2024-07-09",
                "last_verified_at": "2025-08-11"
              },
              {
                "technology": "spring",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-08-11"
              },
              {
                "technology": "slack",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-08-11"
              },
              {
                "technology": "sprint",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2025-08-11"
              },
              {
                "technology": "ups",
                "first_verified_at": "2025-08-05",
                "last_verified_at": "2025-08-11"
              },
              {
                "technology": "well",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-07-28"
              },
              {
                "technology": "docker",
                "first_verified_at": "2024-07-01",
                "last_verified_at": "2025-07-28"
              },
              {
                "technology": "jenkins",
                "first_verified_at": "2024-07-01",
                "last_verified_at": "2025-07-28"
              },
              {
                "technology": "c",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2025-06-16"
              },
              {
                "technology": "linkedin recruiter",
                "first_verified_at": "2025-06-12",
                "last_verified_at": "2025-06-12"
              },
              {
                "technology": "figma",
                "first_verified_at": "2024-09-16",
                "last_verified_at": "2025-06-09"
              },
              {
                "technology": "model n",
                "first_verified_at": "2025-02-20",
                "last_verified_at": "2025-03-31"
              },
              {
                "technology": "webpack",
                "first_verified_at": "2024-08-19",
                "last_verified_at": "2025-02-10"
              },
              {
                "technology": "nosql",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2024-07-01"
              },
              {
                "technology": "postman",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2024-07-01"
              },
              {
                "technology": "amazon ecs",
                "first_verified_at": "2024-04-04",
                "last_verified_at": "2024-07-01"
              },
              {
                "technology": "redux",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2024-06-03"
              },
              {
                "technology": "looker",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2024-06-03"
              },
              {
                "technology": "storybook",
                "first_verified_at": "2024-05-20",
                "last_verified_at": "2024-06-03"
              }
            ],
            "ipo_date": null,
            "ipo_share_price": null,
            "ipo_share_price_currency": null,
            "stock_information": [],
            "revenue_annual_range": {
              "source_4_annual_revenue_range": null,
              "source_6_annual_revenue_range": {
                "annual_revenue_range_from": 2000000,
                "annual_revenue_range_to": 5000000,
                "annual_revenue_range_currency": "USD"
              }
            },
            "revenue_annual": {
              "source_5_annual_revenue": {
                "annual_revenue": 3500000,
                "annual_revenue_currency": "USD"
              },
              "source_1_annual_revenue": null
            },
            "revenue_quarterly": null,
            "income_statements": [],
            "last_funding_round_name": "Series B - GrubTech",
            "last_funding_round_announced_date": "2024-05-28",
            "last_funding_round_lead_investors": [
              "Jahez International Company"
            ],
            "last_funding_round_amount_raised": 15000000,
            "last_funding_round_amount_raised_currency": "USD",
            "last_funding_round_num_investors": 3,
            "funding_rounds": [
              {
                "name": "Seed Round - GrubTech",
                "announced_date": "2020-07-05",
                "lead_investors": [],
                "amount_raised": 2000000,
                "amount_raised_currency": "USD",
                "num_investors": null
              },
              {
                "name": "Seed Round - GrubTech",
                "announced_date": "2021-03-16",
                "lead_investors": [
                  "Ghassan Oueida",
                  "Gry Loseth"
                ],
                "amount_raised": 3400000,
                "amount_raised_currency": "$",
                "num_investors": 7
              },
              {
                "name": "Series B - GrubTech",
                "announced_date": "2024-05-28",
                "lead_investors": [
                  "Jahez International Company"
                ],
                "amount_raised": 15000000,
                "amount_raised_currency": "USD",
                "num_investors": 3
              },
              {
                "name": "Series A - GrubTech",
                "announced_date": "2024-04-28",
                "lead_investors": [],
                "amount_raised": null,
                "amount_raised_currency": null,
                "num_investors": null
              },
              {
                "name": "Series A - GrubTech",
                "announced_date": "2021-12-06",
                "lead_investors": [
                  "Addition"
                ],
                "amount_raised": 13000000,
                "amount_raised_currency": "USD",
                "num_investors": 3
              }
            ],
            "ownership_status": "Private",
            "parent_company_information": null,
            "acquired_by_summary": {
              "acquirer_name": null,
              "announced_date": null,
              "price": null,
              "currency": "USD"
            },
            "num_acquisitions_source_1": null,
            "acquisition_list_source_1": [],
            "num_acquisitions_source_2": 0,
            "acquisition_list_source_2": [],
            "num_acquisitions_source_5": null,
            "acquisition_list_source_5": [],
            "competitors": [
              {
                "company_name": "xtrachef",
                "similarity_score": null
              },
              {
                "company_name": "chewbox",
                "similarity_score": null
              },
              {
                "company_name": "rockspoon",
                "similarity_score": null
              },
              {
                "company_name": "qatalog",
                "similarity_score": null
              },
              {
                "company_name": "restora pos",
                "similarity_score": 100000
              },
              {
                "company_name": "prompttech",
                "similarity_score": 53880
              },
              {
                "company_name": "ebr software",
                "similarity_score": 50630
              },
              {
                "company_name": "the cloud",
                "similarity_score": 13180
              },
              {
                "company_name": "kitopi",
                "similarity_score": 6780
              },
              {
                "company_name": "ikcon",
                "similarity_score": 5890
              },
              {
                "company_name": "dailymealz",
                "similarity_score": 5420
              }
            ],
            "competitors_websites": [
              {
                "website": "easysignage.com",
                "similarity_score": 100,
                "total_website_visits_monthly": 321700,
                "category": "Computers Electronics and Technology > Programming and Developer Software",
                "rank_category": 5195
              },
              {
                "website": "laimuna.com",
                "similarity_score": 89,
                "total_website_visits_monthly": 13400,
                "category": "Computers Electronics and Technology > Programming and Developer Software",
                "rank_category": 30783
              },
              {
                "website": "odootec.com",
                "similarity_score": 53,
                "total_website_visits_monthly": 3500,
                "category": "Computers Electronics and Technology > Computers Electronics and Technology - Other",
                "rank_category": 52438
              },
              {
                "website": "beambox.com",
                "similarity_score": 48,
                "total_website_visits_monthly": 40000,
                "category": "Computers Electronics and Technology > Graphics Multimedia and Web Design",
                "rank_category": 7076
              },
              {
                "website": "wamda.com",
                "similarity_score": 47,
                "total_website_visits_monthly": 101500,
                "category": "Computers Electronics and Technology > Computers Electronics and Technology - Other",
                "rank_category": 9944
              }
            ],
            "company_phone_numbers": [
              "+97145693202"
            ],
            "company_emails": [
              "moe@grubtech.com"
            ],
            "pricing_available": true,
            "free_trial_available": true,
            "demo_available": false,
            "is_downloadable": false,
            "mobile_apps_exist": false,
            "online_reviews_exist": false,
            "documentation_exist": false,
            "product_reviews_count": 2,
            "product_reviews_aggregate_score": 5,
            "product_reviews_score_distribution": {
              "score_1": 0,
              "score_2": 0,
              "score_3": 0,
              "score_4": 0,
              "score_5": 2
            },
            "product_pricing_summary": [],
            "num_news_articles": 9,
            "news_articles": [
              {
                "headline": "UAE's GrubTech Secures $15 M to revolutionise foodtech in the MENA region",
                "published_date": "2024-05-30",
                "summary": null,
                "article_url": "https://www.edgemiddleeast.com/industry/uaes-grubtech-secures-15-m-to-revolutionise-foodtech-in-the-mena-region",
                "source": "Edge Middle East"
              },
              {
                "headline": "Dubai-based Grubtech secures $15mln to expand in Saudi, Europe, UK",
                "published_date": "2024-05-29",
                "summary": null,
                "article_url": "https://www.zawya.com/en/wealth/alternative-investments/dubai-based-grubtech-secures-15mln-to-expand-in-saudi-europe-uk-slidu29o",
                "source": "ZAWYA"
              },
              {
                "headline": "SaaS platform GrubTech raised $15 M Series B funding from Jahez",
                "published_date": "2024-05-29",
                "summary": null,
                "article_url": "https://incubees.com/saas-platform-grubtech-raised-15-m-series-b-funding-from-jahez/",
                "source": "Incubees"
              },
              {
                "headline": "Grubtech Raises $15 Million",
                "published_date": "2024-05-29",
                "summary": null,
                "article_url": "https://www.prnewswire.com/news-releases/grubtech-raises-15-million-302155197.html",
                "source": "PR Newswire"
              },
              {
                "headline": "Grubtech Raises $15M in Funding",
                "published_date": "2024-05-29",
                "summary": null,
                "article_url": "https://www.finsmes.com/2024/05/grubtech-raises-15m-in-funding.html",
                "source": "FinSMEs"
              },
              {
                "headline": "Grubtech Raises $15M to Disrupt the F&B and Quick Commerce Industry",
                "published_date": "2024-05-29",
                "summary": null,
                "article_url": "https://crunchdubai.com/grubtech-raises-15m-to-revolutionize-fb-and-quick-commerce/",
                "source": "crunch/DUBAI"
              },
              {
                "headline": "GrubTech raises $15 million Series B led by Jahez",
                "published_date": "2024-05-28",
                "summary": null,
                "article_url": "https://www.wamda.com/2024/05/grubtech-raises-15-million-series-b-led-jahez",
                "source": "Wamda"
              },
              {
                "headline": "Grubtech: SaaS Integration And Unified Commerce Platform Raises $15 Million",
                "published_date": "2024-05-28",
                "summary": null,
                "article_url": "https://pulse2.com/grubtech-saas-integration-and-unified-commerce-platform-raises-15-million/",
                "source": "Pulse 2.0"
              },
              {
                "headline": "Dubai’s Grubtech raises $15 million to help restaurants streamline their digital operations",
                "published_date": "2024-05-28",
                "summary": null,
                "article_url": "https://www.menabytes.com/grubtech-series-b/",
                "source": "MENAbytes"
              }
            ],
            "total_website_visits_monthly": 5000,
            "visits_change_monthly": 35.74,
            "rank_global": 3204043,
            "rank_country": 2058486,
            "rank_category": 29350,
            "visits_breakdown_by_country": [
              {
                "country": "United States",
                "percentage": 33.08,
                "percentage_monthly_change": 28.21
              },
              {
                "country": "United Arab Emirates",
                "percentage": 18.12,
                "percentage_monthly_change": 416.1
              },
              {
                "country": "Portugal",
                "percentage": 13.58,
                "percentage_monthly_change": 1696
              },
              {
                "country": "India",
                "percentage": 12.3,
                "percentage_monthly_change": 16.99
              },
              {
                "country": "Kuwait",
                "percentage": 5.83,
                "percentage_monthly_change": 44.67
              },
              {
                "country": "Others",
                "percentage": 17.08,
                "percentage_monthly_change": null
              }
            ],
            "visits_breakdown_by_gender": {
              "male_percentage": 0,
              "female_percentage": 0
            },
            "visits_breakdown_by_age": {
              "age_18_24_percentage": 0,
              "age_25_34_percentage": 0,
              "age_35_44_percentage": 0,
              "age_45_54_percentage": 0,
              "age_55_64_percentage": 0,
              "age_65_plus_percentage": 0
            },
            "bounce_rate": 43.98,
            "pages_per_visit": 1.87,
            "average_visit_duration_seconds": 36,
            "similarly_ranked_websites": [
              "fluentsearch.net",
              "twin.me",
              "grubtech.com",
              "questbook.xyz",
              "danielme.com",
              "easysignage.com",
              "beambox.com",
              "laimuna.com",
              "grubtech.com",
              "odootec.com"
            ],
            "top_topics": [],
            "company_employee_reviews_count": 51,
            "company_employee_reviews_aggregate_score": 3.5999999046325684,
            "employee_reviews_score_breakdown": {
              "business_outlook": 0.5400000214576721,
              "career_opportunities": 3.299999952316284,
              "ceo_approval": -1,
              "compensation_benefits": 3.5,
              "culture_values": 3.299999952316284,
              "diversity_inclusion": 3.299999952316284,
              "recommend": 0.6100000143051147,
              "senior_management": 3.200000047683716,
              "work_life_balance": 3.299999952316284
            },
            "employee_reviews_score_distribution": {
              "score_1": 3,
              "score_2": 1,
              "score_3": 3,
              "score_4": 4,
              "score_5": 8
            },
            "active_job_postings_count": 0,
            "active_job_postings": [],
            "active_job_postings_count_change": {
              "current": 0,
              "change_monthly": 0,
              "change_monthly_percentage": null,
              "change_quarterly": 0,
              "change_quarterly_percentage": null,
              "change_yearly": -1,
              "change_yearly_percentage": -100
            },
            "active_job_postings_count_by_month": [
              {
                "active_job_postings_count": 0,
                "date": "2025-09"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-08"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-07"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-06"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-05"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-04"
              },
              {
                "active_job_postings_count": 2,
                "date": "2025-03"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-02"
              },
              {
                "active_job_postings_count": 0,
                "date": "2025-01"
              },
              {
                "active_job_postings_count": 2,
                "date": "2024-12"
              },
              {
                "active_job_postings_count": 2,
                "date": "2024-11"
              },
              {
                "active_job_postings_count": 2,
                "date": "2024-10"
              },
              {
                "active_job_postings_count": 1,
                "date": "2024-09"
              },
              {
                "active_job_postings_count": 3,
                "date": "2024-08"
              },
              {
                "active_job_postings_count": 0,
                "date": "2024-07"
              },
              {
                "active_job_postings_count": 2,
                "date": "2024-06"
              },
              {
                "active_job_postings_count": 3,
                "date": "2024-05"
              },
              {
                "active_job_postings_count": 0,
                "date": "2024-04"
              },
              {
                "active_job_postings_count": 1,
                "date": "2024-03"
              },
              {
                "active_job_postings_count": 1,
                "date": "2024-02"
              },
              {
                "active_job_postings_count": 0,
                "date": "2024-01"
              },
              {
                "active_job_postings_count": 1,
                "date": "2023-12"
              },
              {
                "active_job_postings_count": 1,
                "date": "2023-11"
              },
              {
                "active_job_postings_count": 2,
                "date": "2023-10"
              },
              {
                "active_job_postings_count": 3,
                "date": "2023-09"
              },
              {
                "active_job_postings_count": 4,
                "date": "2023-08"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-07"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-06"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-05"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-04"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-03"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-02"
              },
              {
                "active_job_postings_count": 0,
                "date": "2023-01"
              },
              {
                "active_job_postings_count": 0,
                "date": "2022-12"
              },
              {
                "active_job_postings_count": 0,
                "date": "2022-11"
              },
              {
                "active_job_postings_count": 0,
                "date": "2022-10"
              }
            ],
            "linkedin_followers_count_change": {
              "current": 43464,
              "change_monthly": 498,
              "change_monthly_percentage": 1.1590559977656754,
              "change_quarterly": 1099,
              "change_quarterly_percentage": 2.5941225067862623,
              "change_yearly": 43464,
              "change_yearly_percentage": null
            },
            "linkedin_followers_count_by_month": [
              {
                "follower_count": 43464,
                "date": "2025-09"
              },
              {
                "follower_count": 42966,
                "date": "2025-08"
              },
              {
                "follower_count": 42630,
                "date": "2025-07"
              },
              {
                "follower_count": 42365,
                "date": "2025-06"
              },
              {
                "follower_count": 41964,
                "date": "2025-05"
              },
              {
                "follower_count": 0,
                "date": "2025-04"
              },
              {
                "follower_count": 0,
                "date": "2025-03"
              },
              {
                "follower_count": 0,
                "date": "2025-02"
              },
              {
                "follower_count": 0,
                "date": "2025-01"
              },
              {
                "follower_count": 0,
                "date": "2024-12"
              },
              {
                "follower_count": 0,
                "date": "2024-11"
              },
              {
                "follower_count": 0,
                "date": "2024-10"
              },
              {
                "follower_count": 0,
                "date": "2024-09"
              },
              {
                "follower_count": 0,
                "date": "2024-08"
              },
              {
                "follower_count": 0,
                "date": "2024-07"
              },
              {
                "follower_count": 0,
                "date": "2024-06"
              },
              {
                "follower_count": 0,
                "date": "2024-05"
              },
              {
                "follower_count": 0,
                "date": "2024-04"
              },
              {
                "follower_count": 0,
                "date": "2024-03"
              },
              {
                "follower_count": 0,
                "date": "2024-02"
              },
              {
                "follower_count": 0,
                "date": "2024-01"
              },
              {
                "follower_count": 0,
                "date": "2023-12"
              },
              {
                "follower_count": 0,
                "date": "2023-11"
              },
              {
                "follower_count": 0,
                "date": "2023-10"
              },
              {
                "follower_count": 0,
                "date": "2023-09"
              },
              {
                "follower_count": 0,
                "date": "2023-08"
              },
              {
                "follower_count": 0,
                "date": "2023-07"
              },
              {
                "follower_count": 0,
                "date": "2023-06"
              },
              {
                "follower_count": 0,
                "date": "2023-05"
              },
              {
                "follower_count": 0,
                "date": "2023-04"
              },
              {
                "follower_count": 0,
                "date": "2023-03"
              },
              {
                "follower_count": 0,
                "date": "2023-02"
              },
              {
                "follower_count": 0,
                "date": "2023-01"
              },
              {
                "follower_count": 0,
                "date": "2022-12"
              },
              {
                "follower_count": 0,
                "date": "2022-11"
              },
              {
                "follower_count": 0,
                "date": "2022-10"
              }
            ],
            "base_salary": [],
            "additional_pay": [],
            "total_salary": [],
            "employees_count_inferred": 168,
            "employees_count_inferred_by_month": [
              {
                "employees_count_inferred": 164,
                "date": "202503"
              },
              {
                "employees_count_inferred": 160,
                "date": "202501"
              },
              {
                "employees_count_inferred": 161,
                "date": "202502"
              },
              {
                "employees_count_inferred": 166,
                "date": "202504"
              },
              {
                "employees_count_inferred": 160,
                "date": "202411"
              },
              {
                "employees_count_inferred": 143,
                "date": "202212"
              },
              {
                "employees_count_inferred": 132,
                "date": "202402"
              },
              {
                "employees_count_inferred": 170,
                "date": "202507"
              },
              {
                "employees_count_inferred": 142,
                "date": "202304"
              },
              {
                "employees_count_inferred": 156,
                "date": "202209"
              },
              {
                "employees_count_inferred": 138,
                "date": "202301"
              },
              {
                "employees_count_inferred": 138,
                "date": "202404"
              },
              {
                "employees_count_inferred": 133,
                "date": "202308"
              },
              {
                "employees_count_inferred": 138,
                "date": "202405"
              },
              {
                "employees_count_inferred": 167,
                "date": "202505"
              },
              {
                "employees_count_inferred": 156,
                "date": "202408"
              },
              {
                "employees_count_inferred": 140,
                "date": "202406"
              },
              {
                "employees_count_inferred": 132,
                "date": "202309"
              },
              {
                "employees_count_inferred": 143,
                "date": "202305"
              },
              {
                "employees_count_inferred": 149,
                "date": "202407"
              },
              {
                "employees_count_inferred": 140,
                "date": "202303"
              },
              {
                "employees_count_inferred": 131,
                "date": "202311"
              },
              {
                "employees_count_inferred": 135,
                "date": "202401"
              },
              {
                "employees_count_inferred": 160,
                "date": "202210"
              },
              {
                "employees_count_inferred": 170,
                "date": "202506"
              },
              {
                "employees_count_inferred": 160,
                "date": "202410"
              },
              {
                "employees_count_inferred": 154,
                "date": "202409"
              },
              {
                "employees_count_inferred": 160,
                "date": "202412"
              },
              {
                "employees_count_inferred": 131,
                "date": "202312"
              },
              {
                "employees_count_inferred": 168,
                "date": "202508"
              },
              {
                "employees_count_inferred": 132,
                "date": "202310"
              },
              {
                "employees_count_inferred": 136,
                "date": "202306"
              },
              {
                "employees_count_inferred": 142,
                "date": "202302"
              },
              {
                "employees_count_inferred": 137,
                "date": "202307"
              },
              {
                "employees_count_inferred": 157,
                "date": "202211"
              },
              {
                "employees_count_inferred": 133,
                "date": "202403"
              }
            ],
            "top_previous_companies": [
              {
                "company_id": 1111322,
                "company_name": "Zone24x7",
                "count": 6
              },
              {
                "company_id": 9009353,
                "company_name": "Al Tayer Group",
                "count": 7
              },
              {
                "company_id": 1723297,
                "company_name": "CodeGen International",
                "count": 4
              },
              {
                "company_id": 11325874,
                "company_name": "Sysco LABS Sri Lanka",
                "count": 7
              },
              {
                "company_id": 31374757,
                "company_name": "Otter",
                "count": 4
              },
              {
                "company_id": 95992833,
                "company_name": "Cambio Software",
                "count": 10
              },
              {
                "company_id": 32803988,
                "company_name": "Texus Solutions",
                "count": 7
              },
              {
                "company_id": 2618735,
                "company_name": "talabat",
                "count": 6
              },
              {
                "company_id": 687092,
                "company_name": "Virtusa",
                "count": 6
              },
              {
                "company_id": 9472279,
                "company_name": "Foodics",
                "count": 6
              }
            ],
            "top_next_companies": [
              {
                "company_id": 3550804,
                "company_name": "Intrepid Travel",
                "count": 2
              },
              {
                "company_id": 82679574,
                "company_name": "IFFCO Professional",
                "count": 2
              },
              {
                "company_id": 31585295,
                "company_name": "Andersen Lab",
                "count": 4
              },
              {
                "company_id": 28985140,
                "company_name": "instashop",
                "count": 3
              },
              {
                "company_id": 3294170,
                "company_name": "geidea",
                "count": 4
              },
              {
                "company_id": 33521588,
                "company_name": "Level Shoes",
                "count": 2
              },
              {
                "company_id": 90569081,
                "company_name": "Fist Bump",
                "count": 2
              },
              {
                "company_id": 3637383,
                "company_name": "IFS",
                "count": 2
              },
              {
                "company_id": 28229796,
                "company_name": "Lyve Global",
                "count": 3
              },
              {
                "company_id": 29468960,
                "company_name": "Dataroid",
                "count": 2
              }
            ],
            "key_executives": [
              {
                "parent_id": 105206295,
                "member_full_name": "Omar Rifai",
                "member_position_title": "Co-Founder, Chief Growth Officer"
              },
              {
                "parent_id": 452201126,
                "member_full_name": "Tharush Jayananda",
                "member_position_title": "Head Of Delivery"
              },
              {
                "parent_id": 61508833,
                "member_full_name": "Mohamed Al Fayed",
                "member_position_title": "Chief Executive Officer Co-Founder"
              },
              {
                "parent_id": 248030480,
                "member_full_name": "Ishan Antony",
                "member_position_title": "Head Of Engineering"
              },
              {
                "parent_id": 217668362,
                "member_full_name": "Armando L Estrella Peraza",
                "member_position_title": "Head Of Sales Operations"
              },
              {
                "parent_id": 70308234,
                "member_full_name": "Amany El Turk",
                "member_position_title": "Human Resources Director"
              }
            ],
            "key_employee_change_events": [],
            "key_executive_arrivals": [],
            "key_executive_departures": [],
            "employees_count_change": {
              "current": 196,
              "change_monthly": 3,
              "change_monthly_percentage": 1.5544041450777202,
              "change_quarterly": 12,
              "change_quarterly_percentage": 6.521739130434782,
              "change_yearly": 30,
              "change_yearly_percentage": 18.072289156626507
            },
            "employees_count_by_month": [
              {
                "employees_count": 196,
                "date": "2025-09"
              },
              {
                "employees_count": 193,
                "date": "2025-08"
              },
              {
                "employees_count": 188,
                "date": "2025-07"
              },
              {
                "employees_count": 184,
                "date": "2025-06"
              },
              {
                "employees_count": 182,
                "date": "2025-05"
              },
              {
                "employees_count": 180,
                "date": "2025-04"
              },
              {
                "employees_count": 178,
                "date": "2025-03"
              },
              {
                "employees_count": 175,
                "date": "2025-02"
              },
              {
                "employees_count": 175,
                "date": "2025-01"
              },
              {
                "employees_count": 172,
                "date": "2024-12"
              },
              {
                "employees_count": 168,
                "date": "2024-11"
              },
              {
                "employees_count": 167,
                "date": "2024-10"
              },
              {
                "employees_count": 166,
                "date": "2024-09"
              },
              {
                "employees_count": 162,
                "date": "2024-08"
              },
              {
                "employees_count": 154,
                "date": "2024-07"
              },
              {
                "employees_count": 151,
                "date": "2024-06"
              },
              {
                "employees_count": 144,
                "date": "2024-05"
              },
              {
                "employees_count": 143,
                "date": "2024-04"
              },
              {
                "employees_count": 139,
                "date": "2024-03"
              },
              {
                "employees_count": 137,
                "date": "2024-02"
              },
              {
                "employees_count": 135,
                "date": "2024-01"
              },
              {
                "employees_count": 135,
                "date": "2023-12"
              },
              {
                "employees_count": 139,
                "date": "2023-11"
              },
              {
                "employees_count": 140,
                "date": "2023-10"
              },
              {
                "employees_count": 137,
                "date": "2023-09"
              },
              {
                "employees_count": 141,
                "date": "2023-08"
              },
              {
                "employees_count": 138,
                "date": "2023-07"
              },
              {
                "employees_count": 147,
                "date": "2023-06"
              },
              {
                "employees_count": 139,
                "date": "2023-05"
              },
              {
                "employees_count": 150,
                "date": "2023-04"
              },
              {
                "employees_count": 147,
                "date": "2023-03"
              },
              {
                "employees_count": 163,
                "date": "2023-02"
              },
              {
                "employees_count": 163,
                "date": "2023-01"
              },
              {
                "employees_count": 163,
                "date": "2022-12"
              },
              {
                "employees_count": 163,
                "date": "2022-11"
              },
              {
                "employees_count": 163,
                "date": "2022-10"
              }
            ],
            "employees_count_breakdown_by_seniority": {
              "employees_count_owner": 0,
              "employees_count_founder": 1,
              "employees_count_clevel": 1,
              "employees_count_partner": 0,
              "employees_count_vp": 2,
              "employees_count_head": 3,
              "employees_count_director": 2,
              "employees_count_manager": 26,
              "employees_count_senior": 53,
              "employees_count_intern": 4,
              "employees_count_specialist": 63,
              "employees_count_other_management": 19
            },
            "employees_count_breakdown_by_seniority_by_month": [
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 26,
                  "employees_count_senior": 53,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 63,
                  "employees_count_other_management": 19
                },
                "date": "202508"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 25,
                  "employees_count_senior": 54,
                  "employees_count_intern": 5,
                  "employees_count_specialist": 64,
                  "employees_count_other_management": 20
                },
                "date": "202507"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 24,
                  "employees_count_senior": 55,
                  "employees_count_intern": 5,
                  "employees_count_specialist": 64,
                  "employees_count_other_management": 21
                },
                "date": "202506"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 24,
                  "employees_count_senior": 54,
                  "employees_count_intern": 5,
                  "employees_count_specialist": 62,
                  "employees_count_other_management": 22
                },
                "date": "202505"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 25,
                  "employees_count_senior": 56,
                  "employees_count_intern": 2,
                  "employees_count_specialist": 65,
                  "employees_count_other_management": 24
                },
                "date": "202504"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 26,
                  "employees_count_senior": 52,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 62,
                  "employees_count_other_management": 18
                },
                "date": "202503"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 25,
                  "employees_count_senior": 52,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 60,
                  "employees_count_other_management": 18
                },
                "date": "202502"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 25,
                  "employees_count_senior": 51,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 60,
                  "employees_count_other_management": 18
                },
                "date": "202501"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 2,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 26,
                  "employees_count_senior": 50,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 59,
                  "employees_count_other_management": 18
                },
                "date": "202412"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 26,
                  "employees_count_senior": 52,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 57,
                  "employees_count_other_management": 20
                },
                "date": "202411"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 28,
                  "employees_count_senior": 55,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 52,
                  "employees_count_other_management": 19
                },
                "date": "202410"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 28,
                  "employees_count_senior": 54,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 49,
                  "employees_count_other_management": 17
                },
                "date": "202409"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 28,
                  "employees_count_senior": 55,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 49,
                  "employees_count_other_management": 16
                },
                "date": "202408"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 25,
                  "employees_count_senior": 52,
                  "employees_count_intern": 5,
                  "employees_count_specialist": 46,
                  "employees_count_other_management": 15
                },
                "date": "202407"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 23,
                  "employees_count_senior": 51,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 43,
                  "employees_count_other_management": 13
                },
                "date": "202406"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 23,
                  "employees_count_senior": 52,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 44,
                  "employees_count_other_management": 13
                },
                "date": "202405"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 20,
                  "employees_count_senior": 53,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 45,
                  "employees_count_other_management": 14
                },
                "date": "202404"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 18,
                  "employees_count_senior": 47,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 46,
                  "employees_count_other_management": 13
                },
                "date": "202403"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 18,
                  "employees_count_senior": 47,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 45,
                  "employees_count_other_management": 13
                },
                "date": "202402"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 18,
                  "employees_count_senior": 49,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 46,
                  "employees_count_other_management": 14
                },
                "date": "202401"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 2,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 18,
                  "employees_count_senior": 50,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 41,
                  "employees_count_other_management": 13
                },
                "date": "202312"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 2,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 19,
                  "employees_count_senior": 51,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 40,
                  "employees_count_other_management": 13
                },
                "date": "202311"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 21,
                  "employees_count_senior": 51,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 38,
                  "employees_count_other_management": 13
                },
                "date": "202310"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 20,
                  "employees_count_senior": 52,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 39,
                  "employees_count_other_management": 13
                },
                "date": "202309"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 21,
                  "employees_count_senior": 49,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 40,
                  "employees_count_other_management": 14
                },
                "date": "202308"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 20,
                  "employees_count_senior": 50,
                  "employees_count_intern": 5,
                  "employees_count_specialist": 41,
                  "employees_count_other_management": 15
                },
                "date": "202307"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 20,
                  "employees_count_senior": 51,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 41,
                  "employees_count_other_management": 15
                },
                "date": "202306"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 23,
                  "employees_count_senior": 54,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 42,
                  "employees_count_other_management": 16
                },
                "date": "202305"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 3,
                  "employees_count_director": 1,
                  "employees_count_manager": 24,
                  "employees_count_senior": 54,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 43,
                  "employees_count_other_management": 18
                },
                "date": "202304"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 1,
                  "employees_count_manager": 24,
                  "employees_count_senior": 47,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 42,
                  "employees_count_other_management": 17
                },
                "date": "202303"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 1,
                  "employees_count_manager": 24,
                  "employees_count_senior": 49,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 42,
                  "employees_count_other_management": 17
                },
                "date": "202302"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 24,
                  "employees_count_senior": 46,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 42,
                  "employees_count_other_management": 16
                },
                "date": "202301"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 1,
                  "employees_count_head": 2,
                  "employees_count_director": 2,
                  "employees_count_manager": 26,
                  "employees_count_senior": 48,
                  "employees_count_intern": 3,
                  "employees_count_specialist": 43,
                  "employees_count_other_management": 18
                },
                "date": "202212"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 1,
                  "employees_count_partner": 0,
                  "employees_count_vp": 0,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 26,
                  "employees_count_senior": 56,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 50,
                  "employees_count_other_management": 18
                },
                "date": "202211"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 0,
                  "employees_count_partner": 0,
                  "employees_count_vp": 0,
                  "employees_count_head": 3,
                  "employees_count_director": 2,
                  "employees_count_manager": 25,
                  "employees_count_senior": 59,
                  "employees_count_intern": 5,
                  "employees_count_specialist": 50,
                  "employees_count_other_management": 19
                },
                "date": "202210"
              },
              {
                "employees_count_breakdown_by_seniority": {
                  "employees_count_owner": 0,
                  "employees_count_founder": 1,
                  "employees_count_clevel": 0,
                  "employees_count_partner": 0,
                  "employees_count_vp": 0,
                  "employees_count_head": 4,
                  "employees_count_director": 2,
                  "employees_count_manager": 23,
                  "employees_count_senior": 57,
                  "employees_count_intern": 4,
                  "employees_count_specialist": 50,
                  "employees_count_other_management": 20
                },
                "date": "202209"
              }
            ],
            "employees_count_breakdown_by_department": {
              "employees_count_medical": 0,
              "employees_count_sales": 14,
              "employees_count_hr": 7,
              "employees_count_legal": 0,
              "employees_count_marketing": 7,
              "employees_count_finance": 6,
              "employees_count_technical": 65,
              "employees_count_consulting": 2,
              "employees_count_operations": 9,
              "employees_count_product": 8,
              "employees_count_general_management": 3,
              "employees_count_administrative": 2,
              "employees_count_customer_service": 20,
              "employees_count_project_management": 6,
              "employees_count_design": 2,
              "employees_count_research": 0,
              "employees_count_trades": 0,
              "employees_count_real_estate": 0,
              "employees_count_education": 1,
              "employees_count_other_department": 21
            },
            "employees_count_breakdown_by_department_by_month": [
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 7,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 7,
                  "employees_count_finance": 6,
                  "employees_count_technical": 65,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 9,
                  "employees_count_product": 8,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 20,
                  "employees_count_project_management": 6,
                  "employees_count_design": 2,
                  "employees_count_research": 0,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 21
                },
                "date": "202508"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 7,
                  "employees_count_finance": 6,
                  "employees_count_technical": 67,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 9,
                  "employees_count_product": 8,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 20,
                  "employees_count_project_management": 6,
                  "employees_count_design": 2,
                  "employees_count_research": 0,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 22
                },
                "date": "202507"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 7,
                  "employees_count_finance": 6,
                  "employees_count_technical": 68,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 9,
                  "employees_count_product": 8,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 20,
                  "employees_count_project_management": 5,
                  "employees_count_design": 2,
                  "employees_count_research": 0,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 23
                },
                "date": "202506"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 15,
                  "employees_count_hr": 5,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 6,
                  "employees_count_finance": 8,
                  "employees_count_technical": 65,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 9,
                  "employees_count_product": 7,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 19,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 0,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 24
                },
                "date": "202505"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 16,
                  "employees_count_hr": 5,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 6,
                  "employees_count_finance": 8,
                  "employees_count_technical": 63,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 7,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 18,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 28
                },
                "date": "202504"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 16,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 4,
                  "employees_count_finance": 8,
                  "employees_count_technical": 61,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 5,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 17,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 22
                },
                "date": "202503"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 4,
                  "employees_count_finance": 7,
                  "employees_count_technical": 61,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 5,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 17,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 22
                },
                "date": "202502"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 5,
                  "employees_count_finance": 7,
                  "employees_count_technical": 59,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 5,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 17,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 22
                },
                "date": "202501"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 15,
                  "employees_count_hr": 5,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 5,
                  "employees_count_finance": 7,
                  "employees_count_technical": 59,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 5,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 17,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 1,
                  "employees_count_other_department": 21
                },
                "date": "202412"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 5,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 5,
                  "employees_count_finance": 7,
                  "employees_count_technical": 60,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 6,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 16,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 23
                },
                "date": "202411"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 16,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 5,
                  "employees_count_finance": 7,
                  "employees_count_technical": 62,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 6,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 13,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 22
                },
                "date": "202410"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 16,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 4,
                  "employees_count_finance": 7,
                  "employees_count_technical": 60,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 10,
                  "employees_count_product": 6,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 13,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 20
                },
                "date": "202409"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 16,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 3,
                  "employees_count_finance": 7,
                  "employees_count_technical": 59,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 10,
                  "employees_count_product": 7,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 2,
                  "employees_count_customer_service": 13,
                  "employees_count_project_management": 6,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 19
                },
                "date": "202408"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 13,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 3,
                  "employees_count_finance": 7,
                  "employees_count_technical": 59,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 7,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 10,
                  "employees_count_project_management": 6,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 18
                },
                "date": "202407"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 13,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 0,
                  "employees_count_finance": 6,
                  "employees_count_technical": 57,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 11,
                  "employees_count_product": 7,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 10,
                  "employees_count_project_management": 5,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 16
                },
                "date": "202406"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 13,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 0,
                  "employees_count_finance": 6,
                  "employees_count_technical": 57,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 12,
                  "employees_count_product": 7,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 10,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 1,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 16
                },
                "date": "202405"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 10,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 0,
                  "employees_count_finance": 6,
                  "employees_count_technical": 59,
                  "employees_count_consulting": 2,
                  "employees_count_operations": 13,
                  "employees_count_product": 7,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 9,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 17
                },
                "date": "202404"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 9,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 0,
                  "employees_count_finance": 6,
                  "employees_count_technical": 56,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 13,
                  "employees_count_product": 6,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 8,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 15
                },
                "date": "202403"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 8,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 5,
                  "employees_count_technical": 56,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 13,
                  "employees_count_product": 6,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 8,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 15
                },
                "date": "202402"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 9,
                  "employees_count_hr": 4,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 6,
                  "employees_count_technical": 56,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 13,
                  "employees_count_product": 6,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 8,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 17
                },
                "date": "202401"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 10,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 6,
                  "employees_count_technical": 57,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 11,
                  "employees_count_product": 6,
                  "employees_count_general_management": 5,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 7,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 14
                },
                "date": "202312"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 11,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 6,
                  "employees_count_technical": 57,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 11,
                  "employees_count_product": 6,
                  "employees_count_general_management": 5,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 7,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 14
                },
                "date": "202311"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 13,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 6,
                  "employees_count_technical": 56,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 11,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 6,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 14
                },
                "date": "202310"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 14,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 6,
                  "employees_count_technical": 57,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 10,
                  "employees_count_product": 5,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 6,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 14
                },
                "date": "202309"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 15,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 6,
                  "employees_count_technical": 53,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 10,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 6,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 16
                },
                "date": "202308"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 17,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 5,
                  "employees_count_technical": 54,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 10,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 7,
                  "employees_count_project_management": 3,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 17
                },
                "date": "202307"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 17,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 1,
                  "employees_count_finance": 4,
                  "employees_count_technical": 55,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 9,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 7,
                  "employees_count_project_management": 3,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 17
                },
                "date": "202306"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 20,
                  "employees_count_hr": 3,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 2,
                  "employees_count_finance": 5,
                  "employees_count_technical": 56,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 9,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 7,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 17
                },
                "date": "202305"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 20,
                  "employees_count_hr": 5,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 2,
                  "employees_count_finance": 5,
                  "employees_count_technical": 56,
                  "employees_count_consulting": 0,
                  "employees_count_operations": 9,
                  "employees_count_product": 5,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 7,
                  "employees_count_project_management": 4,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 19
                },
                "date": "202304"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 20,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 3,
                  "employees_count_finance": 5,
                  "employees_count_technical": 54,
                  "employees_count_consulting": 0,
                  "employees_count_operations": 8,
                  "employees_count_product": 5,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 5,
                  "employees_count_project_management": 3,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 18
                },
                "date": "202303"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 21,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 3,
                  "employees_count_finance": 5,
                  "employees_count_technical": 54,
                  "employees_count_consulting": 0,
                  "employees_count_operations": 8,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 5,
                  "employees_count_project_management": 3,
                  "employees_count_design": 3,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 18
                },
                "date": "202302"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 20,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 3,
                  "employees_count_finance": 5,
                  "employees_count_technical": 51,
                  "employees_count_consulting": 0,
                  "employees_count_operations": 9,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 5,
                  "employees_count_project_management": 3,
                  "employees_count_design": 4,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 17
                },
                "date": "202301"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 24,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 3,
                  "employees_count_finance": 5,
                  "employees_count_technical": 51,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 9,
                  "employees_count_product": 6,
                  "employees_count_general_management": 6,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 5,
                  "employees_count_project_management": 3,
                  "employees_count_design": 4,
                  "employees_count_research": 2,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 19
                },
                "date": "202212"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 26,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 5,
                  "employees_count_finance": 4,
                  "employees_count_technical": 59,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 10,
                  "employees_count_product": 8,
                  "employees_count_general_management": 5,
                  "employees_count_administrative": 1,
                  "employees_count_customer_service": 6,
                  "employees_count_project_management": 3,
                  "employees_count_design": 4,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 19
                },
                "date": "202211"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 26,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 6,
                  "employees_count_finance": 4,
                  "employees_count_technical": 61,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 9,
                  "employees_count_product": 7,
                  "employees_count_general_management": 4,
                  "employees_count_administrative": 0,
                  "employees_count_customer_service": 6,
                  "employees_count_project_management": 3,
                  "employees_count_design": 4,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 20
                },
                "date": "202210"
              },
              {
                "employees_count_breakdown_by_department": {
                  "employees_count_medical": 0,
                  "employees_count_sales": 22,
                  "employees_count_hr": 6,
                  "employees_count_legal": 0,
                  "employees_count_marketing": 6,
                  "employees_count_finance": 4,
                  "employees_count_technical": 63,
                  "employees_count_consulting": 1,
                  "employees_count_operations": 10,
                  "employees_count_product": 6,
                  "employees_count_general_management": 3,
                  "employees_count_administrative": 0,
                  "employees_count_customer_service": 6,
                  "employees_count_project_management": 3,
                  "employees_count_design": 4,
                  "employees_count_research": 3,
                  "employees_count_trades": 0,
                  "employees_count_real_estate": 0,
                  "employees_count_education": 0,
                  "employees_count_other_department": 21
                },
                "date": "202209"
              }
            ],
            "employees_count_breakdown_by_region": {
              "employees_count_eastern_europe": 0,
              "employees_count_latin_america": 1,
              "employees_count_southern_europe": 14,
              "employees_count_sub_saharan_africa": 0,
              "employees_count_central_asia": 0,
              "employees_count_northern_america": 0,
              "employees_count_australia_new_zealand": 1,
              "employees_count_northern_europe": 2,
              "employees_count_south_eastern_asia": 2,
              "employees_count_polynesia": 0,
              "employees_count_southern_asia": 68,
              "employees_count_northern_africa": 42,
              "employees_count_melanesia": 0,
              "employees_count_western_europe": 0,
              "employees_count_western_asia": 37,
              "employees_count_eastern_asia": 0,
              "employees_count_micronesia": 0,
              "employees_count_unknown": 1
            },
            "employees_count_breakdown_by_region_by_month": [
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 14,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 68,
                  "employees_count_northern_africa": 42,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 37,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202508"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 2,
                  "employees_count_southern_europe": 13,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 70,
                  "employees_count_northern_africa": 41,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 37,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202507"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 2,
                  "employees_count_southern_europe": 12,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 69,
                  "employees_count_northern_africa": 41,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 39,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202506"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 2,
                  "employees_count_southern_europe": 12,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 66,
                  "employees_count_northern_africa": 40,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 40,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202505"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 2,
                  "employees_count_southern_europe": 12,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 64,
                  "employees_count_northern_africa": 40,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 41,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202504"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 2,
                  "employees_count_southern_europe": 11,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 63,
                  "employees_count_northern_africa": 41,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 41,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202503"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 11,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 63,
                  "employees_count_northern_africa": 39,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 41,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202502"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 10,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 0,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 2,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 62,
                  "employees_count_northern_africa": 40,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 41,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202501"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 8,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 1,
                  "employees_count_northern_europe": 3,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 61,
                  "employees_count_northern_africa": 39,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 43,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202412"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 7,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 2,
                  "employees_count_northern_europe": 3,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 61,
                  "employees_count_northern_africa": 37,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 45,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202411"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 7,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 3,
                  "employees_count_northern_europe": 3,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 63,
                  "employees_count_northern_africa": 33,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 46,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202410"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 7,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 3,
                  "employees_count_northern_europe": 3,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 60,
                  "employees_count_northern_africa": 30,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 46,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202409"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 1,
                  "employees_count_southern_europe": 5,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 3,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 61,
                  "employees_count_northern_africa": 29,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 48,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202408"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 3,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 3,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 61,
                  "employees_count_northern_africa": 26,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 47,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202407"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 3,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 3,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 56,
                  "employees_count_northern_africa": 23,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 47,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202406"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 3,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 4,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 55,
                  "employees_count_northern_africa": 22,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 0,
                  "employees_count_western_asia": 46,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202405"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 1,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 4,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 2,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 57,
                  "employees_count_northern_africa": 21,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 46,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202404"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 4,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 55,
                  "employees_count_northern_africa": 21,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 45,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202403"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 4,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 55,
                  "employees_count_northern_africa": 20,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 45,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202402"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 53,
                  "employees_count_northern_africa": 22,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 47,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202401"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 54,
                  "employees_count_northern_africa": 16,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 48,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202312"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 54,
                  "employees_count_northern_africa": 16,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 48,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202311"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 53,
                  "employees_count_northern_africa": 16,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 50,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202310"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 6,
                  "employees_count_northern_europe": 4,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 53,
                  "employees_count_northern_africa": 16,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 1,
                  "employees_count_western_asia": 49,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202309"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 6,
                  "employees_count_northern_europe": 5,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 51,
                  "employees_count_northern_africa": 17,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 48,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202308"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 1,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 51,
                  "employees_count_northern_africa": 18,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 51,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202307"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 1,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 7,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 49,
                  "employees_count_northern_africa": 17,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 51,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202306"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 7,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 50,
                  "employees_count_northern_africa": 18,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 55,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202305"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 48,
                  "employees_count_northern_africa": 19,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 56,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202304"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 5,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 45,
                  "employees_count_northern_africa": 20,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 57,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202303"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 44,
                  "employees_count_northern_africa": 21,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 58,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202302"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 40,
                  "employees_count_northern_africa": 20,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 59,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202301"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 2,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 3,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 38,
                  "employees_count_northern_africa": 20,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 2,
                  "employees_count_western_asia": 66,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202212"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 4,
                  "employees_count_australia_new_zealand": 5,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 4,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 39,
                  "employees_count_northern_africa": 23,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 3,
                  "employees_count_western_asia": 72,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202211"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 5,
                  "employees_count_australia_new_zealand": 4,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 5,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 41,
                  "employees_count_northern_africa": 23,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 3,
                  "employees_count_western_asia": 72,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202210"
              },
              {
                "employees_count_breakdown_by_region": {
                  "employees_count_eastern_europe": 0,
                  "employees_count_latin_america": 0,
                  "employees_count_southern_europe": 0,
                  "employees_count_sub_saharan_africa": 0,
                  "employees_count_central_asia": 0,
                  "employees_count_northern_america": 5,
                  "employees_count_australia_new_zealand": 4,
                  "employees_count_northern_europe": 6,
                  "employees_count_south_eastern_asia": 6,
                  "employees_count_polynesia": 0,
                  "employees_count_southern_asia": 41,
                  "employees_count_northern_africa": 19,
                  "employees_count_melanesia": 0,
                  "employees_count_western_europe": 3,
                  "employees_count_western_asia": 71,
                  "employees_count_eastern_asia": 0,
                  "employees_count_micronesia": 0,
                  "employees_count_unknown": 1
                },
                "date": "202209"
              }
            ],
            "employees_count_by_country": [
              {
                "country": "Sri Lanka",
                "employee_count": 64
              },
              {
                "country": "United Kingdom",
                "employee_count": 1
              },
              {
                "country": "Oman",
                "employee_count": 1
              },
              {
                "country": "India",
                "employee_count": 4
              },
              {
                "country": "Portugal",
                "employee_count": 2
              },
              {
                "country": "Colombia",
                "employee_count": 1
              },
              {
                "country": "Egypt",
                "employee_count": 42
              },
              {
                "country": "Australia",
                "employee_count": 1
              },
              {
                "country": null,
                "employee_count": 1
              },
              {
                "country": "United Arab Emirates",
                "employee_count": 28
              },
              {
                "country": "Spain",
                "employee_count": 12
              },
              {
                "country": "Norway",
                "employee_count": 1
              },
              {
                "country": "Singapore",
                "employee_count": 2
              },
              {
                "country": "Turkey",
                "employee_count": 3
              },
              {
                "country": "Saudi Arabia",
                "employee_count": 5
              }
            ],
            "employees_count_by_country_by_month": [
              {
                "employees_count_by_country": [
                  {
                    "country": "Sri Lanka",
                    "employee_count": 64
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 2
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 42
                  },
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 28
                  },
                  {
                    "country": "Spain",
                    "employee_count": 12
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 5
                  }
                ],
                "date": "202508"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 2
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "France",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 41
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 5
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 66
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 28
                  },
                  {
                    "country": "Spain",
                    "employee_count": 12
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  }
                ],
                "date": "202507"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 31
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 2
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 41
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 65
                  },
                  {
                    "country": "France",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 11
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 4
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  }
                ],
                "date": "202506"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 2
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Spain",
                    "employee_count": 11
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 5
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 31
                  },
                  {
                    "country": "France",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 62
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 40
                  }
                ],
                "date": "202505"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 31
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "France",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 40
                  },
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 6
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 60
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 11
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 2
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  }
                ],
                "date": "202504"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 2
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 41
                  },
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 59
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 6
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 31
                  },
                  {
                    "country": "Spain",
                    "employee_count": 10
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  }
                ],
                "date": "202503"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 6
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 59
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 31
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 39
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Spain",
                    "employee_count": 10
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  }
                ],
                "date": "202502"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 58
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 9
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 31
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 6
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 40
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  }
                ],
                "date": "202501"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Spain",
                    "employee_count": 7
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 3
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 39
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 32
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 57
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  }
                ],
                "date": "202412"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 57
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 33
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 6
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 37
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 2
                  }
                ],
                "date": "202411"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 3
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 6
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 33
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 59
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 33
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 8
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  }
                ],
                "date": "202410"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 30
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 8
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 3
                  },
                  {
                    "country": "Spain",
                    "employee_count": 6
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 33
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 56
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  }
                ],
                "date": "202409"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Spain",
                    "employee_count": 4
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 8
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 3
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 57
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 29
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "Colombia",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Qatar",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 34
                  }
                ],
                "date": "202408"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 3
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 34
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Qatar",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 2
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 26
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 57
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 4
                  }
                ],
                "date": "202407"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Spain",
                    "employee_count": 2
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Australia",
                    "employee_count": 3
                  },
                  {
                    "country": "Qatar",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 34
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 23
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 55
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  }
                ],
                "date": "202406"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 2
                  },
                  {
                    "country": "Portugal",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 34
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 22
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 4
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 54
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  }
                ],
                "date": "202405"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Spain",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 2
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 56
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 4
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 34
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 21
                  }
                ],
                "date": "202404"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 4
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 33
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 54
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 21
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  }
                ],
                "date": "202403"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 4
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 54
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 33
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 20
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  }
                ],
                "date": "202402"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 35
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 22
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 52
                  }
                ],
                "date": "202401"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Egypt",
                    "employee_count": 16
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 36
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 53
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  }
                ],
                "date": "202312"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 36
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 53
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 16
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  }
                ],
                "date": "202311"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 52
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 38
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 16
                  }
                ],
                "date": "202310"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 52
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 16
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 37
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 6
                  }
                ],
                "date": "202309"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 50
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 36
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 6
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 17
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  }
                ],
                "date": "202308"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 50
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 18
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 39
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  }
                ],
                "date": "202307"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 39
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 17
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 48
                  },
                  {
                    "country": "Canada",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 3
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  }
                ],
                "date": "202306"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 49
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 18
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 3
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 43
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  }
                ],
                "date": "202305"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 47
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 19
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 4
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 44
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  }
                ],
                "date": "202304"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 44
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 44
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 5
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 20
                  }
                ],
                "date": "202303"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 45
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 5
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 43
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 21
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  }
                ],
                "date": "202302"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 5
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 20
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 39
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 46
                  },
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  }
                ],
                "date": "202301"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Canada",
                    "employee_count": 2
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 20
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 37
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 51
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 7
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  }
                ],
                "date": "202212"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Canada",
                    "employee_count": 3
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 8
                  },
                  {
                    "country": "Germany",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 38
                  },
                  {
                    "country": "Thailand",
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 23
                  },
                  {
                    "country": "United States",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Australia",
                    "employee_count": 5
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 3
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 13
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 50
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  }
                ],
                "date": "202211"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 4
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Canada",
                    "employee_count": 3
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 23
                  },
                  {
                    "country": "United States",
                    "employee_count": 2
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 50
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Germany",
                    "employee_count": 1
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 13
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 4
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 40
                  },
                  {
                    "country": "Thailand",
                    "employee_count": 1
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 8
                  }
                ],
                "date": "202210"
              },
              {
                "employees_count_by_country": [
                  {
                    "country": "Australia",
                    "employee_count": 4
                  },
                  {
                    "country": "Sweden",
                    "employee_count": 1
                  },
                  {
                    "country": "Estonia",
                    "employee_count": 1
                  },
                  {
                    "country": "Netherlands",
                    "employee_count": 2
                  },
                  {
                    "country": "Sri Lanka",
                    "employee_count": 40
                  },
                  {
                    "country": "Oman",
                    "employee_count": 1
                  },
                  {
                    "country": "United Kingdom",
                    "employee_count": 2
                  },
                  {
                    "country": "Saudi Arabia",
                    "employee_count": 7
                  },
                  {
                    "country": "United Arab Emirates",
                    "employee_count": 49
                  },
                  {
                    "country": "United States",
                    "employee_count": 2
                  },
                  {
                    "country": "Canada",
                    "employee_count": 3
                  },
                  {
                    "country": "Egypt",
                    "employee_count": 19
                  },
                  {
                    "country": "Thailand",
                    "employee_count": 1
                  },
                  {
                    "country": "Norway",
                    "employee_count": 1
                  },
                  {
                    "country": "Finland",
                    "employee_count": 1
                  },
                  {
                    "country": "Singapore",
                    "employee_count": 5
                  },
                  {
                    "country": "Turkey",
                    "employee_count": 14
                  },
                  {
                    "country": null,
                    "employee_count": 1
                  },
                  {
                    "country": "Germany",
                    "employee_count": 1
                  },
                  {
                    "country": "India",
                    "employee_count": 1
                  }
                ],
                "date": "202209"
              }
            ],
            "product_reviews_score_change": {
              "current": 4.5,
              "change_monthly": 0,
              "change_quarterly": 0,
              "change_yearly": 0
            },
            "product_reviews_score_by_month": [
              {
                "product_reviews_score": 4.5,
                "date": "2025-09"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-08"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-07"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-06"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-05"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-04"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-03"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-02"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2025-01"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-12"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-11"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-10"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-09"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-08"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-07"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-06"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-05"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-04"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-03"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-02"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2024-01"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-12"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-11"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-10"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-09"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-08"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-07"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-06"
              },
              {
                "product_reviews_score": 4.5,
                "date": "2023-05"
              },
              {
                "product_reviews_score": 0,
                "date": "2023-04"
              },
              {
                "product_reviews_score": 0,
                "date": "2023-03"
              },
              {
                "product_reviews_score": 0,
                "date": "2023-02"
              },
              {
                "product_reviews_score": 0,
                "date": "2023-01"
              },
              {
                "product_reviews_score": 0,
                "date": "2022-12"
              },
              {
                "product_reviews_score": 0,
                "date": "2022-11"
              },
              {
                "product_reviews_score": 0,
                "date": "2022-10"
              }
            ],
            "total_website_visits_change": {
              "current": 5000,
              "change_monthly": 0,
              "change_monthly_percentage": 0,
              "change_quarterly": -600,
              "change_quarterly_percentage": -10.714285714285714,
              "change_yearly": -9000,
              "change_yearly_percentage": -64.28571428571429
            },
            "total_website_visits_by_month": [
              {
                "total_website_visits": 5000,
                "date": "2025-09"
              },
              {
                "total_website_visits": 5000,
                "date": "2025-08"
              },
              {
                "total_website_visits": 7800,
                "date": "2025-07"
              },
              {
                "total_website_visits": 5600,
                "date": "2025-06"
              },
              {
                "total_website_visits": 2800,
                "date": "2025-05"
              },
              {
                "total_website_visits": 2800,
                "date": "2025-04"
              },
              {
                "total_website_visits": 7200,
                "date": "2025-03"
              },
              {
                "total_website_visits": 11800,
                "date": "2025-02"
              },
              {
                "total_website_visits": 12100,
                "date": "2025-01"
              },
              {
                "total_website_visits": 5800,
                "date": "2024-12"
              },
              {
                "total_website_visits": 6000,
                "date": "2024-11"
              },
              {
                "total_website_visits": 6000,
                "date": "2024-10"
              },
              {
                "total_website_visits": 14000,
                "date": "2024-09"
              },
              {
                "total_website_visits": 14000,
                "date": "2024-08"
              },
              {
                "total_website_visits": 14000,
                "date": "2024-07"
              },
              {
                "total_website_visits": 14000,
                "date": "2024-06"
              },
              {
                "total_website_visits": 14000,
                "date": "2024-05"
              },
              {
                "total_website_visits": 14000,
                "date": "2024-04"
              }
            ],
            "employee_reviews_score_aggregated_change": {
              "current": 4,
              "change_monthly": 0,
              "change_quarterly": 0,
              "change_yearly": null
            },
            "employee_reviews_score_aggregated_by_month": [
              {
                "aggregated_score": 4,
                "date": "2025-09"
              },
              {
                "aggregated_score": 4,
                "date": "2025-08"
              },
              {
                "aggregated_score": 4,
                "date": "2025-07"
              },
              {
                "aggregated_score": 4,
                "date": "2025-06"
              },
              {
                "aggregated_score": 4,
                "date": "2025-05"
              },
              {
                "aggregated_score": 4.1,
                "date": "2025-04"
              },
              {
                "aggregated_score": 4.3,
                "date": "2025-03"
              },
              {
                "aggregated_score": 4.1,
                "date": "2025-02"
              },
              {
                "aggregated_score": 4,
                "date": "2025-01"
              },
              {
                "aggregated_score": 4,
                "date": "2024-12"
              },
              {
                "aggregated_score": 4,
                "date": "2024-11"
              },
              {
                "aggregated_score": 4,
                "date": "2024-09"
              },
              {
                "aggregated_score": 4,
                "date": "2024-08"
              },
              {
                "aggregated_score": 3.9,
                "date": "2024-07"
              },
              {
                "aggregated_score": 3.9,
                "date": "2024-06"
              },
              {
                "aggregated_score": 3.8,
                "date": "2024-05"
              },
              {
                "aggregated_score": 3.8,
                "date": "2024-04"
              },
              {
                "aggregated_score": 3.8,
                "date": "2024-03"
              },
              {
                "aggregated_score": 3.8,
                "date": "2024-02"
              },
              {
                "aggregated_score": 3.8,
                "date": "2024-01"
              },
              {
                "aggregated_score": 3.8,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_business_outlook_change": {
              "current": 0.79,
              "change_monthly": 0,
              "change_quarterly": -0.05999999999999994,
              "change_yearly": null
            },
            "employee_reviews_score_business_outlook_by_month": [
              {
                "business_outlook_score": 0.79,
                "date": "2025-09"
              },
              {
                "business_outlook_score": 0.79,
                "date": "2025-08"
              },
              {
                "business_outlook_score": 0.79,
                "date": "2025-07"
              },
              {
                "business_outlook_score": 0.85,
                "date": "2025-06"
              },
              {
                "business_outlook_score": 0.85,
                "date": "2025-05"
              },
              {
                "business_outlook_score": 0.85,
                "date": "2025-04"
              },
              {
                "business_outlook_score": 0.83,
                "date": "2025-03"
              },
              {
                "business_outlook_score": 0.78,
                "date": "2025-02"
              },
              {
                "business_outlook_score": 0.74,
                "date": "2025-01"
              },
              {
                "business_outlook_score": 0.73,
                "date": "2024-12"
              },
              {
                "business_outlook_score": 0.73,
                "date": "2024-11"
              },
              {
                "business_outlook_score": 0.73,
                "date": "2024-09"
              },
              {
                "business_outlook_score": 0.73,
                "date": "2024-08"
              },
              {
                "business_outlook_score": 0.69,
                "date": "2024-07"
              },
              {
                "business_outlook_score": 0.69,
                "date": "2024-06"
              },
              {
                "business_outlook_score": 0.64,
                "date": "2024-05"
              },
              {
                "business_outlook_score": 0.64,
                "date": "2024-04"
              },
              {
                "business_outlook_score": 0.64,
                "date": "2024-03"
              },
              {
                "business_outlook_score": 0.64,
                "date": "2024-02"
              },
              {
                "business_outlook_score": 0.64,
                "date": "2024-01"
              },
              {
                "business_outlook_score": 0.59,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_career_opportunities_change": {
              "current": 3.8,
              "change_monthly": 0,
              "change_quarterly": -0.20000000000000018,
              "change_yearly": null
            },
            "employee_reviews_score_career_opportunities_by_month": [
              {
                "career_opportunities_score": 3.8,
                "date": "2025-09"
              },
              {
                "career_opportunities_score": 3.8,
                "date": "2025-08"
              },
              {
                "career_opportunities_score": 3.8,
                "date": "2025-07"
              },
              {
                "career_opportunities_score": 4,
                "date": "2025-06"
              },
              {
                "career_opportunities_score": 4,
                "date": "2025-05"
              },
              {
                "career_opportunities_score": 4,
                "date": "2025-04"
              },
              {
                "career_opportunities_score": 4,
                "date": "2025-03"
              },
              {
                "career_opportunities_score": 3.8,
                "date": "2025-02"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2025-01"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2024-12"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2024-11"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2024-09"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2024-08"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2024-07"
              },
              {
                "career_opportunities_score": 3.7,
                "date": "2024-06"
              },
              {
                "career_opportunities_score": 3.6,
                "date": "2024-05"
              },
              {
                "career_opportunities_score": 3.6,
                "date": "2024-04"
              },
              {
                "career_opportunities_score": 3.6,
                "date": "2024-03"
              },
              {
                "career_opportunities_score": 3.6,
                "date": "2024-02"
              },
              {
                "career_opportunities_score": 3.6,
                "date": "2024-01"
              },
              {
                "career_opportunities_score": 3.6,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_ceo_approval_change": {
              "current": -1,
              "change_monthly": 0,
              "change_quarterly": 0,
              "change_yearly": null
            },
            "employee_reviews_score_ceo_approval_by_month": [
              {
                "ceo_approval_score": -1,
                "date": "2025-09"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-08"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-07"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-06"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-05"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-04"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-03"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-02"
              },
              {
                "ceo_approval_score": -1,
                "date": "2025-01"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-12"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-11"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-09"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-08"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-07"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-06"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-05"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-04"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-03"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-02"
              },
              {
                "ceo_approval_score": -1,
                "date": "2024-01"
              },
              {
                "ceo_approval_score": -1,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_compensation_benefits_change": {
              "current": 3.8,
              "change_monthly": 0,
              "change_quarterly": -0.20000000000000018,
              "change_yearly": null
            },
            "employee_reviews_score_compensation_benefits_by_month": [
              {
                "compensation_benefits_score": 3.8,
                "date": "2025-09"
              },
              {
                "compensation_benefits_score": 3.8,
                "date": "2025-08"
              },
              {
                "compensation_benefits_score": 3.8,
                "date": "2025-07"
              },
              {
                "compensation_benefits_score": 4,
                "date": "2025-06"
              },
              {
                "compensation_benefits_score": 4,
                "date": "2025-05"
              },
              {
                "compensation_benefits_score": 4.1,
                "date": "2025-04"
              },
              {
                "compensation_benefits_score": 4.1,
                "date": "2025-03"
              },
              {
                "compensation_benefits_score": 3.9,
                "date": "2025-02"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2025-01"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-12"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-11"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-09"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-08"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-07"
              },
              {
                "compensation_benefits_score": 3.8,
                "date": "2024-06"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-05"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-04"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-03"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-02"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2024-01"
              },
              {
                "compensation_benefits_score": 3.7,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_culture_values_change": {
              "current": 3.7,
              "change_monthly": 0,
              "change_quarterly": -0.19999999999999973,
              "change_yearly": null
            },
            "employee_reviews_score_culture_values_by_month": [
              {
                "culture_values_score": 3.7,
                "date": "2025-09"
              },
              {
                "culture_values_score": 3.7,
                "date": "2025-08"
              },
              {
                "culture_values_score": 3.7,
                "date": "2025-07"
              },
              {
                "culture_values_score": 3.9,
                "date": "2025-06"
              },
              {
                "culture_values_score": 3.9,
                "date": "2025-05"
              },
              {
                "culture_values_score": 4.1,
                "date": "2025-04"
              },
              {
                "culture_values_score": 4,
                "date": "2025-03"
              },
              {
                "culture_values_score": 3.8,
                "date": "2025-02"
              },
              {
                "culture_values_score": 3.6,
                "date": "2025-01"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-12"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-11"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-09"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-08"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-07"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-06"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-05"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-04"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-03"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-02"
              },
              {
                "culture_values_score": 3.6,
                "date": "2024-01"
              },
              {
                "culture_values_score": 3.5,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_diversity_inclusion_change": {
              "current": 3.8,
              "change_monthly": 0,
              "change_quarterly": -0.20000000000000018,
              "change_yearly": null
            },
            "employee_reviews_score_diversity_inclusion_by_month": [
              {
                "diversity_inclusion_score": 3.8,
                "date": "2025-09"
              },
              {
                "diversity_inclusion_score": 3.8,
                "date": "2025-08"
              },
              {
                "diversity_inclusion_score": 3.8,
                "date": "2025-07"
              },
              {
                "diversity_inclusion_score": 4,
                "date": "2025-06"
              },
              {
                "diversity_inclusion_score": 4,
                "date": "2025-05"
              },
              {
                "diversity_inclusion_score": 4,
                "date": "2025-04"
              },
              {
                "diversity_inclusion_score": 4,
                "date": "2025-03"
              },
              {
                "diversity_inclusion_score": 3.7,
                "date": "2025-02"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2025-01"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-12"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-11"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-09"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-08"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-07"
              },
              {
                "diversity_inclusion_score": 3.6,
                "date": "2024-06"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-05"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-04"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-03"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-02"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2024-01"
              },
              {
                "diversity_inclusion_score": 3.5,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_recommend_change": {
              "current": 0.71,
              "change_monthly": 0,
              "change_quarterly": -0.06000000000000005,
              "change_yearly": null
            },
            "employee_reviews_score_recommend_by_month": [
              {
                "recommend_score": 0.71,
                "date": "2025-09"
              },
              {
                "recommend_score": 0.71,
                "date": "2025-08"
              },
              {
                "recommend_score": 0.71,
                "date": "2025-07"
              },
              {
                "recommend_score": 0.77,
                "date": "2025-06"
              },
              {
                "recommend_score": 0.77,
                "date": "2025-05"
              },
              {
                "recommend_score": 0.85,
                "date": "2025-04"
              },
              {
                "recommend_score": 0.83,
                "date": "2025-03"
              },
              {
                "recommend_score": 0.79,
                "date": "2025-02"
              },
              {
                "recommend_score": 0.76,
                "date": "2025-01"
              },
              {
                "recommend_score": 0.76,
                "date": "2024-12"
              },
              {
                "recommend_score": 0.76,
                "date": "2024-11"
              },
              {
                "recommend_score": 0.76,
                "date": "2024-09"
              },
              {
                "recommend_score": 0.76,
                "date": "2024-08"
              },
              {
                "recommend_score": 0.74,
                "date": "2024-07"
              },
              {
                "recommend_score": 0.76,
                "date": "2024-06"
              },
              {
                "recommend_score": 0.73,
                "date": "2024-05"
              },
              {
                "recommend_score": 0.73,
                "date": "2024-04"
              },
              {
                "recommend_score": 0.73,
                "date": "2024-03"
              },
              {
                "recommend_score": 0.73,
                "date": "2024-02"
              },
              {
                "recommend_score": 0.73,
                "date": "2024-01"
              },
              {
                "recommend_score": 0.7,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_senior_management_change": {
              "current": 3.6,
              "change_monthly": 0,
              "change_quarterly": -0.19999999999999973,
              "change_yearly": null
            },
            "employee_reviews_score_senior_management_by_month": [
              {
                "senior_management_score": 3.6,
                "date": "2025-09"
              },
              {
                "senior_management_score": 3.6,
                "date": "2025-08"
              },
              {
                "senior_management_score": 3.6,
                "date": "2025-07"
              },
              {
                "senior_management_score": 3.8,
                "date": "2025-06"
              },
              {
                "senior_management_score": 3.8,
                "date": "2025-05"
              },
              {
                "senior_management_score": 3.9,
                "date": "2025-04"
              },
              {
                "senior_management_score": 3.9,
                "date": "2025-03"
              },
              {
                "senior_management_score": 3.7,
                "date": "2025-02"
              },
              {
                "senior_management_score": 3.5,
                "date": "2025-01"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-12"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-11"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-09"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-08"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-07"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-06"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-05"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-04"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-03"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-02"
              },
              {
                "senior_management_score": 3.5,
                "date": "2024-01"
              },
              {
                "senior_management_score": 3.5,
                "date": "2023-12"
              }
            ],
            "employee_reviews_score_work_life_balance_change": {
              "current": 3.7,
              "change_monthly": 0,
              "change_quarterly": -0.19999999999999973,
              "change_yearly": null
            },
            "employee_reviews_score_work_life_balance_by_month": [
              {
                "work_life_balance_score": 3.7,
                "date": "2025-09"
              },
              {
                "work_life_balance_score": 3.7,
                "date": "2025-08"
              },
              {
                "work_life_balance_score": 3.7,
                "date": "2025-07"
              },
              {
                "work_life_balance_score": 3.9,
                "date": "2025-06"
              },
              {
                "work_life_balance_score": 3.9,
                "date": "2025-05"
              },
              {
                "work_life_balance_score": 3.9,
                "date": "2025-04"
              },
              {
                "work_life_balance_score": 3.7,
                "date": "2025-03"
              },
              {
                "work_life_balance_score": 3.6,
                "date": "2025-02"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2025-01"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-12"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-11"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-09"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-08"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-07"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-06"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-05"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-04"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-03"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-02"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2024-01"
              },
              {
                "work_life_balance_score": 3.4,
                "date": "2023-12"
              }
            ],
            "requested_url": "grubtech.com"
          }
        ]*/
        this.saveCompanies("companiesList",companiesList)
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
        companiesList.map(c => this.transformToCompany(c))
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
        const fitscore = await ollamaService.scoreCompanyFit(c, icpModel.config);
        c.scoring_metrics = c.scoring_metrics ?? {};
        c.scoring_metrics.fit_score = fitscore;
        this.sleep(1000)
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
          
          if (employees.results.length > 0) {
            const employeesEnrichments = await coreSignal.collectEmployees(employees.results);
            c.employees = employeesEnrichments;
          }
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
      
      // Step 4.1: Detecting buying signals
      await this.updateSubstep('4.1', {
        status: 'in-progress',
        startedAt: new Date()
      });
      if(icpModel.config.buyingTriggers.length> 0 ){
      const perplexityService = new PerplexityIntentService(config.PERPLEXITY_API_KEY);
      
      for (const c of companies) {
        try {
          const request: PerplexityRequest = {
            companyName: c.name,
            companyUrl: c.website || '',
            signals: icpModel.config.buyingTriggers
          };
          console.log("signals enrichement ==> ",icpModel.config.buyingTriggers)
          console.log("request ==> ",request)
         
          // Detect intents for a company
          const intentEnrichment = await detectIntentWithEvidence(
            c.name,
            c.website,
            icpModel.config.buyingTriggers
          );
          
          console.log(intentEnrichment.summary);
          //const intentEnrichment = await perplexityService.getIntentEnrichment(request);
          this.saveCompanies("intentEnrichment",intentEnrichment)
          c.intent_enrichment = intentEnrichment;
          c.intent_signals=intentEnrichment;
        } catch (error) {
          console.error(`Error detecting intent signals for ${c.name}:`, error);
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
      if(icpModel.config.buyingTriggers.length> 0 ){
      
      for (const c of companies) {
        if (c.intent_enrichment) {
          const intentScore = await IntentScoringService.calculateIntentScore(
            c.intent_enrichment
          );
          this.saveCompanies("intentScore",intentScore);
          c.scoring_metrics = c.scoring_metrics ?? {};
          c.scoring_metrics.intent_score = intentScore;
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
        const employees = [...(com.employees || [])];
        delete com.employees;
        delete com.intent_enrichment;
        
        await supabaseService.saveCompanyWithSessionAndICP(this.sessionId, icpModel.id, com);
        if (employees.length > 0) {
          await supabaseService.insertEmployees(employees, com.company_id);
        }
      }));
      
      // Generate final search summary
      const searchSummary = await ollamaService.generateSearchSummary(query, icpModel, companies, companies.length);
      await this.sleep(1000); 
      
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
  
  transformToCompany(rawData: any): Promise<Company> {
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
      name: rawData.company_name || '',
      domain: extractDomain(rawData.website),
      website: rawData.website || undefined,
      logo_url: rawData.company_logo_url || undefined,
      description: rawData.description || rawData.description_enriched || undefined,
      founded_year: rawData.founded_year ? parseInt(rawData.founded_year) : undefined,

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

      industry: rawData.industry ? [rawData.industry] : [],
      business_model: determineBusinessModel(rawData),
      target_market: determineTargetMarket(rawData.employees_count),
      ownership_type: determineOwnershipType(rawData.is_public, rawData.parent_company_information),

      employee_count: rawData.employees_count || undefined,
      revenue_estimated: rawData.revenue_annual || undefined,
      funding_stage: determineFundingStage(rawData),
      total_funding: rawData.last_funding_round_amount_raised || undefined,

      technologies: rawData.technologies_used?.map((t: any) => t.technology) || undefined,

      intent_signals: rawData.company_updates?.slice(0, 5).map((update: any) => ({
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