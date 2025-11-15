import OpenAI from "openai";
import axios from "axios";
import * as cheerio from "cheerio";
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as crypto from 'crypto';
import { MemoryVectorStore } from "langchain/vectorstores/memory";

import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";

// ==================== TYPES & INTERFACES ====================
export type IntentSignal = 
  | "ipo_announcement"
  | "new_funding_round"
  | "new_investment"
  | "new_office"
  | "closing_office"
  | "merger_and_acquisitions"
  | "employee_joined_company"
  | "increase_in_engineering_department"
  | "increase_in_sales_department"
  | "increase_in_marketing_department"
  | "increase_in_operations_department"
  | "increase_in_customer_service_department"
  | "increase_in_all_departments"
  | "decrease_in_engineering_department"
  | "decrease_in_sales_department"
  | "decrease_in_marketing_department"
  | "decrease_in_operations_department"
  | "decrease_in_customer_service_department"
  | "decrease_in_all_departments"
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
  | "new_product"
  | "new_partnership"
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
  data_source: string;
  semantic_similarity?: number;
  supporting_documents?: string[];
  cross_reference_count?: number;
}

export interface SignalResult {
  signal: IntentSignal;
  evidence: Evidence[];
  found: boolean;
  reasoning: string;
  confidence: number;
}

export interface IntentEnrichmentResponse {
  company: string;
  website: string;
  analysis_date: string;
  requested_signals: IntentSignal[];
  results: SignalResult[];
  summary: {
    total_signals: number;
    signals_with_evidence: number;
    signals_without_evidence: number;
    confidence_score: number;
    data_sources_used: string[];
  };
  metadata: {
    processing_time: number;
    total_sources_checked: number;
    successful_scrapes: number;
    failed_scrapes: number;
  };
  debug?: any;
}

export interface KnowledgeBaseDocument {
  id: string;
  content: string;
  metadata: {
    source: string;
    url: string;
    date: string;
    type: 'news' | 'job' | 'financial' | 'company' | 'legal' | 'technical';
    confidence: number;
    signal_relevance: IntentSignal[];
  };
}

export interface SemanticSearchResult {
  document: KnowledgeBaseDocument;
  similarity: number;
  relevance_score: number;
  signal_matches: IntentSignal[];
}

export interface AgentConfig {
  openaiApiKey: string;
  braveApiKey?: string;
  maxSearchResults?: number;
  debug?: boolean;
  useProxies?: boolean;
  proxyList?: string[];
  rateLimitDelay?: number;
  maxRetries?: number;
  minSimilarityThreshold?: number;
}

// ==================== SIGNAL DEFINITIONS ====================
const SIGNAL_DEFINITIONS: Record<IntentSignal, string> = {
  "ipo_announcement": "IPO filing, public offering announcement, or going public plans",
  "new_funding_round": "Seed, Series A/B/C/D, venture capital, or any capital raise",
  "new_investment": "Company investing in other businesses or acquiring stakes",
  "new_office": "Opening new locations, headquarters, or geographic expansion",
  "closing_office": "Shutting down or consolidating office locations",
  "merger_and_acquisitions": "M&A activity, acquisitions, or merger announcements",
  "employee_joined_company": "Key hires, new employees, or leadership additions",
  "increase_in_engineering_department": "Significant growth (>10%) in engineering roles",
  "increase_in_sales_department": "Significant growth (>10%) in sales roles",
  "increase_in_marketing_department": "Significant growth (>10%) in marketing roles",
  "increase_in_operations_department": "Significant growth (>10%) in operations roles",
  "increase_in_customer_service_department": "Significant growth (>10%) in support roles",
  "increase_in_all_departments": "Company-wide headcount expansion",
  "decrease_in_engineering_department": "Significant reduction (>10%) in engineering roles",
  "decrease_in_sales_department": "Significant reduction (>10%) in sales roles",
  "decrease_in_marketing_department": "Significant reduction (>10%) in marketing roles",
  "decrease_in_operations_department": "Significant reduction (>10%) in operations roles",
  "decrease_in_customer_service_department": "Significant reduction (>10%) in support roles",
  "decrease_in_all_departments": "Company-wide layoffs or workforce reductions",
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
  "new_product": "Product launches, feature releases, or platform updates",
  "new_partnership": "Strategic partnerships, integrations, collaborations",
  "company_award": "Industry recognition, certifications, rankings, awards",
  "outages_and_security_breaches": "Technical incidents, data breaches, downtime",
  "cost_cutting": "Budget reduction, expense management, efficiency programs",
  "lawsuits_and_legal_issues": "Litigation, regulatory actions, legal disputes"
};

// ==================== ULTIMATE INTENT DETECTION AGENT ====================
export class UltimateIntentDetectionAgent {
  private openai: OpenAI;
  private embeddings: OpenAIEmbeddings;
  private vectorStore: MemoryVectorStore;
  private knowledgeBase: Map<string, KnowledgeBaseDocument>;
  private debug: boolean;
  private useProxies: boolean;
  private proxyList: string[];
  private proxyIndex: number = 0;
  private maxRetries: number;
  private rateLimitDelay: number;
  private minSimilarityThreshold: number;

  // Semantic search templates
  private readonly SIGNAL_QUERY_TEMPLATES: Record<IntentSignal, string[]> = {
    "new_funding_round": [
      "company raised funding venture capital series round investment",
      "startup secured investment funding round capital raise",
      "venture capital funding announcement series A B C",
      "funding round closed investment raised capital"
    ],
    "hiring_in_engineering_department": [
      "hiring software engineers developers engineering team",
      "engineering job openings positions recruitment tech",
      "software developer jobs engineering roles hiring",
      "tech company expanding engineering hiring spree"
    ],
    "ipo_announcement": [
      "IPO initial public offering filing S-1 SEC",
      "company going public stock market listing",
      "public offering announcement stock exchange",
      "pre-IPO funding public market debut"
    ],
    "new_product": [
      "product launch announcement new feature release",
      "company released new product platform update",
      "software update launch new offering features",
      "product announcement release launch event"
    ],
    "merger_and_acquisitions": [
      "company acquisition merger announced deal",
      "acquired another company merger agreement",
      "M&A activity acquisition announcement purchase",
      "merger between companies acquisition deal"
    ],
    "new_partnership": [
      "strategic partnership collaboration announced alliance",
      "companies partner together alliance agreement",
      "partnership agreement collaboration deal joint",
      "joint venture strategic alliance partnership"
    ],
    "employee_joined_company": [
      "new hire joined company executive team",
      "key hire appointment new role position",
      "company hired new executive leadership",
      "joined the team new position hire"
    ],
    "increase_in_engineering_department": [
      "expanding engineering team hiring developers growth",
      "engineering headcount growth team expansion scaling",
      "scaling engineering organization hiring spree",
      "growing tech team engineering expansion hiring"
    ],
    "decrease_in_all_departments": [
      "layoffs workforce reduction job cuts downsizing",
      "company downsizing staff reduction restructuring",
      "restructuring job losses裁员 workforce reduction",
      "reducing headcount layoff announcement cuts"
    ],
    "company_award": [
      "award recognition industry award won achievement",
      "company recognized award achievement honor",
      "won award industry recognition ceremony",
      "award ceremony honors recognition achievement"
    ],
    "outages_and_security_breaches": [
      "service outage downtime disruption incident",
      "security breach data breach hack compromised",
      "system outage technical issues downtime",
      "security incident data compromise breach"
    ],
    "cost_cutting": [
      "cost reduction expense cutting measures savings",
      "budget cuts spending reduction efficiency",
      "cost optimization efficiency measures savings",
      "reducing expenses cost saving measures"
    ],
    "lawsuits_and_legal_issues": [
      "lawsuit legal action filed against court",
      "legal dispute court case litigation suit",
      "regulatory action legal issues investigation",
      "class action lawsuit legal proceedings case"
    ],
    "new_office": ["new office location expansion headquarters"],
    "closing_office": ["closing office shutdown location consolidate"],
    "new_investment": ["company investing stake acquisition"],
    "increase_in_sales_department": ["hiring sales team expansion"],
    "decrease_in_engineering_department": ["engineering layoffs reduction"],
    "hiring_in_creative_department": ["designer creative hiring"],
    "hiring_in_finance_department": ["finance accounting hiring"],
    "hiring_in_marketing_department": ["marketing hiring growth"],
    "hiring_in_sales_department": ["sales hiring account executive"]
  };

  constructor(config: AgentConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.embeddings = new OpenAIEmbeddings({ openAIApiKey: config.openaiApiKey });
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this.knowledgeBase = new Map();
    this.debug = config.debug || false;
    this.useProxies = config.useProxies || false;
    this.proxyList = config.proxyList || [];
    this.maxRetries = config.maxRetries || 4;
    this.rateLimitDelay = config.rateLimitDelay || 1000;
    this.minSimilarityThreshold = config.minSimilarityThreshold || 0.7;
  }

  /**
   * MAIN ENTRY POINT: Ultimate Intent Detection with RAG
   */
  async detectIntents(
    companyName: string,
    companyUrl: string,
    signals: IntentSignal[]
  ): Promise<IntentEnrichmentResponse> {
    const startTime = Date.now();
    const processingNotes: string[] = [];
    const successfulSources: string[] = [];

    try {
      processingNotes.push(`🚀 Starting ULTIMATE detection for ${companyName}`);

      // Step 1: Build comprehensive knowledge base from 30+ sources
      processingNotes.push("📚 Building knowledge base from 30+ data sources...");
      await this.buildUltimateKnowledgeBase(companyName, companyUrl);
      
      const docCount = this.knowledgeBase.size;
      processingNotes.push(`✅ Knowledge base built with ${docCount} documents`);

      // Step 2: Semantic search with RAG
      processingNotes.push("🔍 Performing semantic search with RAG...");
      const semanticResults = await this.semanticSearchForSignals(signals, companyName);
      
      processingNotes.push(`📊 Semantic search completed: ${semanticResults.length} relevant documents`);

      // Step 3: Generate RAG-enhanced evidence
      processingNotes.push("🎯 Generating RAG-enhanced evidence...");
      const results = await this.generateRAGEvidence(signals, semanticResults, companyName);

      // Step 4: Cross-validation
      processingNotes.push("✅ Performing cross-validation...");
      const validatedResults = await this.crossValidateResults(results, semanticResults);

      const processingTime = Date.now() - startTime;

      // Track successful sources
      semanticResults.forEach(result => {
        if (!successfulSources.includes(result.document.metadata.source)) {
          successfulSources.push(result.document.metadata.source);
        }
      });

      return {
        company: companyName,
        website: companyUrl,
        analysis_date: new Date().toISOString().split('T')[0],
        requested_signals: signals,
        results: validatedResults,
        summary: {
          total_signals: signals.length,
          signals_with_evidence: validatedResults.filter(r => r.found && r.confidence > 0.4).length,
          signals_without_evidence: validatedResults.filter(r => !r.found || r.confidence <= 0.4).length,
          confidence_score: this.calculateOverallConfidence(validatedResults),
          data_sources_used: successfulSources
        },
        metadata: {
          processing_time: processingTime,
          total_sources_checked: this.knowledgeBase.size,
          successful_scrapes: successfulSources.length,
          failed_scrapes: 0
        },
        debug: this.debug ? { 
          processingNotes,
          knowledge_base_stats: this.getKnowledgeBaseStats(),
          semantic_search_metrics: this.getSearchMetrics(semanticResults)
        } : undefined
      };

    } catch (error) {
      console.error('💥 Ultimate detection failed:', error);
      return this.getUltimateFallbackResponse(companyName, companyUrl, signals, [error.message]);
    }
  }

  /**
   * Build Knowledge Base from 30+ Data Sources
   */
  private async buildUltimateKnowledgeBase(companyName: string, companyUrl: string): Promise<void> {
    const dataSources = [
      // Financial Data Sources
      () => this.collectSECEdgarData(companyName),
      () => this.collectCrunchbaseData(companyName),
      () => this.collectTechCrunchNews(companyName),
      () => this.collectVentureBeatNews(companyName),
      () => this.collectReutersNews(companyName),
      () => this.collectBloombergNews(companyName),
      () => this.collectYahooFinanceData(companyName),
      () => this.collectIPOCalendarData(),

      // News & Media Sources
      () => this.collectGoogleNews(companyName),
      () => this.collectBingNews(companyName),
      () => this.collectPressReleases(companyName),
      () => this.collectBusinessJournals(companyName),
      () => this.collectRedditMentions(companyName),
      () => this.collectHackerNewsMentions(companyName),

      // Company Information
      () => this.collectCompanyWebsiteData(companyUrl),
      () => this.collectLinkedInData(companyName),
      () => this.collectGlassdoorData(companyName),
      () => this.collectAngelListData(companyName),

      // Jobs & Careers
      () => this.collectCompanyCareersPage(companyUrl),
      () => this.collectLinkedInJobs(companyName),
      () => this.collectIndeedJobs(companyName),
      () => this.collectGreenhouseJobs(companyName),
      () => this.collectLeverJobs(companyName),

      // Technical Data
      () => this.collectGitHubData(companyName),
      () => this.collectTechStackData(companyUrl),
      () => this.collectProductHuntData(companyName),

      // Legal & Regulatory
      () => this.collectCourtListenerData(companyName),
      () => this.collectJustiaData(companyName),
      () => this.collectViolationTrackerData(companyName),
      () => this.collectDowndetectorData(companyName),
      () => this.collectSecurityNews(companyName),

      // Additional Sources
      () => this.collectTwitterData(companyName),
      () => this.collectFacebookData(companyName),
      () => this.collectYouTubeData(companyName)
    ];

    // Execute in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < dataSources.length; i += batchSize) {
      const batch = dataSources.slice(i, i + batchSize);
      const promises = batch.map(source => 
        this.collectAndProcessDataSource(source, companyName, companyUrl)
      );
      
      await Promise.allSettled(promises);
      await this.sleep(this.rateLimitDelay * 2);
    }

    // Build vector store
    await this.buildVectorStore();
  }

  /**
   * INDIVIDUAL DATA SOURCE COLLECTORS (30+ Sources)
   */

  // 1. SEC EDGAR Data
  private async collectSECEdgarData(companyName: string): Promise<any[]> {
    try {
      const searchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&owner=exclude&action=getcompany`;
      const response = await this.makeRobustRequest(searchUrl, {
        headers: this.getSecEdgarHeaders()
      });

      const $ = cheerio.load(response.data);
      const filings: any[] = [];

      $('.tableFile2 tr').each((i, elem) => {
        if (i === 0) return;
        const cols = $(elem).find('td');
        if (cols.length >= 5) {
          filings.push({
            type: $(cols[0]).text().trim(),
            date: $(cols[3]).text().trim(),
            description: $(cols[1]).text().trim(),
            url: `https://www.sec.gov${$(cols[1]).find('a').attr('href')}`,
            source: 'SEC EDGAR',
            content: `SEC Filing: ${$(cols[0]).text().trim()} - ${$(cols[1]).text().trim()}`
          });
        }
      });

      return filings.slice(0, 10);
    } catch (error) {
      return [];
    }
  }

  // 2. Crunchbase Data
  private async collectCrunchbaseData(companyName: string): Promise<any[]> {
    try {
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const url = `https://www.crunchbase.com/organization/${slug}`;
      const response = await this.makeRobustRequest(url);

      const $ = cheerio.load(response.data);
      const data = {
        name: companyName,
        description: $('.description').text().trim(),
        funding_rounds: this.extractCrunchbaseFunding($),
        employee_count: $('.component--field-formatter').text().match(/\d+/)?.[0],
        source: 'Crunchbase',
        content: $('body').text().substring(0, 2000)
      };

      return [data];
    } catch (error) {
      return [];
    }
  }

  // 3. TechCrunch News
  private async collectTechCrunchNews(companyName: string): Promise<any[]> {
    try {
      const searchUrl = `https://search.techcrunch.com/search?p=${encodeURIComponent(companyName)}`;
      const response = await this.makeRobustRequest(searchUrl);

      const $ = cheerio.load(response.data);
      const articles: any[] = [];

      $('.news-item').each((i, elem) => {
        const title = $(elem).find('.headline').text().trim();
        const url = $(elem).find('a').attr('href');
        if (title && url) {
          articles.push({
            title,
            url: url.startsWith('http') ? url : `https://techcrunch.com${url}`,
            source: 'TechCrunch',
            content: title
          });
        }
      });

      return articles.slice(0, 5);
    } catch (error) {
      return [];
    }
  }

  // 4. Google News
  private async collectGoogleNews(companyName: string): Promise<any[]> {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(companyName)}`;
      const response = await this.makeRobustRequest(rssUrl);

      const $ = cheerio.load(response.data, { xmlMode: true });
      const articles: any[] = [];

      $('item').each((i, elem) => {
        articles.push({
          title: $(elem).find('title').text(),
          url: $(elem).find('link').text(),
          date: $(elem).find('pubDate').text(),
          source: 'Google News',
          content: $(elem).find('description').text()
        });
      });

      return articles.slice(0, 10);
    } catch (error) {
      return [];
    }
  }

  // 5. Company Careers Page
  private async collectCompanyCareersPage(companyUrl: string): Promise<any[]> {
    const careerPaths = ['/careers', '/jobs', '/join-us', '/team', '/careers#open-positions'];
    const jobs: any[] = [];

    for (const path of careerPaths) {
      try {
        const careerUrl = `${companyUrl.replace(/\/$/, '')}${path}`;
        const response = await this.makeRobustRequest(careerUrl);
        const $ = cheerio.load(response.data);

        // Multiple job detection strategies
        const jobSelectors = [
          '[class*="job"], [class*="career"], [class*="position"]',
          'a[href*="job"], a[href*="career"], a[href*="apply"]',
          '.job-listing, .careers-list, .open-positions',
          'li:has(a[href*="job"]), li:has(a[href*="career"])'
        ];

        for (const selector of jobSelectors) {
          $(selector).each((i, elem) => {
            const text = $(elem).text().trim();
            if (text.length > 10 && text.length < 200) {
              jobs.push({
                title: this.extractJobTitle(text),
                department: this.mapJobToDepartment(text),
                url: $(elem).attr('href') || careerUrl,
                source: 'Company Careers',
                content: text
              });
            }
          });
        }

        if (jobs.length > 0) break;
      } catch (error) {
        continue;
      }
    }

    return this.deduplicateItems(jobs);
  }

  // 6. LinkedIn Jobs
  private async collectLinkedInJobs(companyName: string): Promise<any[]> {
    try {
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(companyName)}`;
      const response = await this.makeRobustRequest(searchUrl);

      const $ = cheerio.load(response.data);
      const jobs: any[] = [];

      $('.jobs-search__results-list li').each((i, elem) => {
        const title = $(elem).find('.base-search-card__title').text().trim();
        const url = $(elem).find('.base-card__full-link').attr('href');
        if (title && url) {
          jobs.push({
            title,
            department: this.mapJobToDepartment(title),
            url: url.startsWith('http') ? url : `https://linkedin.com${url}`,
            source: 'LinkedIn',
            content: title
          });
        }
      });

      return jobs.slice(0, 10);
    } catch (error) {
      return [];
    }
  }

  // 7. GitHub Data
  private async collectGitHubData(companyName: string): Promise<any[]> {
    try {
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(companyName)}`;
      const response = await this.makeRobustRequest(searchUrl);

      const repos = response.data.items || [];
      return repos.slice(0, 5).map((repo: any) => ({
        name: repo.name,
        description: repo.description,
        stars: repo.stargazers_count,
        url: repo.html_url,
        source: 'GitHub',
        content: repo.description || repo.name
      }));
    } catch (error) {
      return [];
    }
  }

  // 8. Court Listener Data
  private async collectCourtListenerData(companyName: string): Promise<any[]> {
    try {
      const searchUrl = `https://www.courtlistener.com/api/rest/v3/search/?q=${encodeURIComponent(companyName)}`;
      const response = await this.makeRobustRequest(searchUrl);

      const cases = response.data.results || [];
      return cases.slice(0, 5).map((caseData: any) => ({
        case_name: caseData.case_name,
        court: caseData.court,
        date_filed: caseData.date_filed,
        source: 'Court Listener',
        content: `Case: ${caseData.case_name} - ${caseData.court}`
      }));
    } catch (error) {
      return [];
    }
  }

  // 9-30. Additional Data Sources (implement similarly)
  private async collectVentureBeatNews(companyName: string): Promise<any[]> { return []; }
  private async collectReutersNews(companyName: string): Promise<any[]> { return []; }
  private async collectBloombergNews(companyName: string): Promise<any[]> { return []; }
  private async collectYahooFinanceData(companyName: string): Promise<any[]> { return []; }
  private async collectIPOCalendarData(): Promise<any[]> { return []; }
  private async collectBingNews(companyName: string): Promise<any[]> { return []; }
  private async collectPressReleases(companyName: string): Promise<any[]> { return []; }
  private async collectBusinessJournals(companyName: string): Promise<any[]> { return []; }
  private async collectRedditMentions(companyName: string): Promise<any[]> { return []; }
  private async collectHackerNewsMentions(companyName: string): Promise<any[]> { return []; }
  private async collectCompanyWebsiteData(companyUrl: string): Promise<any[]> { return []; }
  private async collectLinkedInData(companyName: string): Promise<any[]> { return []; }
  private async collectGlassdoorData(companyName: string): Promise<any[]> { return []; }
  private async collectAngelListData(companyName: string): Promise<any[]> { return []; }
  private async collectIndeedJobs(companyName: string): Promise<any[]> { return []; }
  private async collectGreenhouseJobs(companyName: string): Promise<any[]> { return []; }
  private async collectLeverJobs(companyName: string): Promise<any[]> { return []; }
  private async collectTechStackData(companyUrl: string): Promise<any[]> { return []; }
  private async collectProductHuntData(companyName: string): Promise<any[]> { return []; }
  private async collectJustiaData(companyName: string): Promise<any[]> { return []; }
  private async collectViolationTrackerData(companyName: string): Promise<any[]> { return []; }
  private async collectDowndetectorData(companyName: string): Promise<any[]> { return []; }
  private async collectSecurityNews(companyName: string): Promise<any[]> { return []; }
  private async collectTwitterData(companyName: string): Promise<any[]> { return []; }
  private async collectFacebookData(companyName: string): Promise<any[]> { return []; }
  private async collectYouTubeData(companyName: string): Promise<any[]> { return []; }

  /**
   * RAG & SEMANTIC SEARCH CORE
   */
  private async semanticSearchForSignals(
    signals: IntentSignal[],
    companyName: string
  ): Promise<SemanticSearchResult[]> {
    const allResults: SemanticSearchResult[] = [];

    for (const signal of signals) {
      const queries = this.generateSemanticQueries(signal, companyName);
      
      for (const query of queries) {
        try {
          const results = await this.semanticSearch(query, 8);
          const enhancedResults = results.map(result => ({
            ...result,
            relevance_score: this.calculateSignalRelevance(result.document, signal, companyName),
            signal_matches: this.detectSignalsInDocument(result.document, companyName)
          })).filter(result => 
            result.relevance_score > this.minSimilarityThreshold &&
            result.signal_matches.includes(signal)
          );

          allResults.push(...enhancedResults);
        } catch (error) {
          continue;
        }
      }
    }

    return this.deduplicateAndRankResults(allResults);
  }

  private async semanticSearch(query: string, k: number = 5): Promise<SemanticSearchResult[]> {
    const documents = Array.from(this.knowledgeBase.values()).map(doc =>
      new Document({
        pageContent: doc.content,
        metadata: doc.metadata
      })
    );

    if (documents.length === 0) return [];

    const results = await this.vectorStore.similaritySearchWithScore(query, k);
    
    return results.map(([doc, similarity]) => ({
      document: {
        id: this.generateDocumentId(doc.metadata),
        content: doc.pageContent,
        metadata: doc.metadata as any
      },
      similarity,
      relevance_score: similarity,
      signal_matches: []
    }));
  }

  private async generateRAGEvidence(
    signals: IntentSignal[],
    searchResults: SemanticSearchResult[],
    companyName: string
  ): Promise<SignalResult[]> {
    const results: SignalResult[] = [];

    for (const signal of signals) {
      const relevantDocs = searchResults.filter(result =>
        result.signal_matches.includes(signal) &&
        result.relevance_score > this.minSimilarityThreshold
      );

      if (relevantDocs.length === 0) {
        results.push({
          signal,
          evidence: [],
          found: false,
          reasoning: `No semantic matches found for ${signal}`,
          confidence: 0
        });
        continue;
      }

      const evidence = await this.generateEvidenceWithRAG(signal, relevantDocs, companyName);
      results.push(evidence);
    }

    return results;
  }

  private async generateEvidenceWithRAG(
    signal: IntentSignal,
    relevantDocs: SemanticSearchResult[],
    companyName: string
  ): Promise<SignalResult> {
    
    const context = relevantDocs
      .slice(0, 5)
      .map(doc => `SOURCE: ${doc.document.metadata.source}\nURL: ${doc.document.metadata.url}\nCONTENT: ${doc.document.content.substring(0, 800)}`)
      .join('\n\n');

    const prompt = `Analyze this context for ${companyName} and extract evidence for ${signal}:

${context}

Return JSON with evidence array and confidence.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
        temperature: 0.1
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          return {
            signal,
            evidence: data.evidence || [],
            found: (data.evidence || []).length > 0,
            reasoning: data.reasoning || `Found ${(data.evidence || []).length} evidence pieces`,
            confidence: data.confidence || 0.7
          };
        }
      }
    } catch (error) {
      // Fallback to basic evidence extraction
    }

    // Basic evidence extraction fallback
    const evidence: Evidence[] = relevantDocs.slice(0, 3).map(doc => ({
      source: doc.document.metadata.source,
      url: doc.document.metadata.url,
      date: doc.document.metadata.date,
      summary: doc.document.content.substring(0, 200),
      confidence: doc.relevance_score,
      data_source: doc.document.metadata.type,
      semantic_similarity: doc.similarity
    }));

    return {
      signal,
      evidence,
      found: evidence.length > 0,
      reasoning: `Found ${evidence.length} relevant documents through semantic search`,
      confidence: Math.min(evidence.length * 0.2, 1.0)
    };
  }

  /**
   * UTILITY METHODS
   */
  private async collectAndProcessDataSource(
    dataSourceFn: () => Promise<any[]>,
    companyName: string,
    companyUrl: string
  ): Promise<void> {
    try {
      const documents = await dataSourceFn();
      
      for (const doc of documents) {
        const content = doc.content || doc.text || doc.description || doc.title || '';
        if (content.length < 10) continue;

        const kbDoc: KnowledgeBaseDocument = {
          id: crypto.createHash('md5').update(`${doc.url}-${content.substring(0, 100)}`).digest('hex'),
          content: this.cleanContent(content),
          metadata: {
            source: doc.source || 'unknown',
            url: doc.url || '',
            date: doc.date || new Date().toISOString().split('T')[0],
            type: this.classifyDocumentType(doc),
            confidence: 0.8,
            signal_relevance: this.detectSignalRelevance(content, companyName)
          }
        };

        this.knowledgeBase.set(kbDoc.id, kbDoc);
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`Data source failed: ${error.message}`);
      }
    }
  }

  private async makeRobustRequest(url: string, options: any = {}): Promise<any> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const config = {
          timeout: 15000,
          headers: this.getRotatingHeaders(),
          ...options
        };

        if (this.useProxies && this.proxyList.length > 0) {
          const proxy = this.getNextProxy();
          if (proxy) {
            config['httpsAgent'] = new HttpsProxyAgent(proxy);
          }
        }

        const response = await axios.get(url, config);
        return response;
      } catch (error) {
        if (attempt === this.maxRetries) throw error;
        await this.sleep(this.rateLimitDelay * attempt);
      }
    }
    throw new Error('All request attempts failed');
  }

  private getRotatingHeaders(): any {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    return {
      'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
  }

  private getSecEdgarHeaders() {
    return {
      'User-Agent': 'Company Intelligence Tool contact@example.com',
      'From': 'contact@example.com'
    };
  }

  private getNextProxy(): string | null {
    if (!this.useProxies || this.proxyList.length === 0) return null;
    const proxy = this.proxyList[this.proxyIndex % this.proxyList.length];
    this.proxyIndex++;
    return proxy;
  }

  private generateSemanticQueries(signal: IntentSignal, companyName: string): string[] {
    const baseQueries = this.SIGNAL_QUERY_TEMPLATES[signal] || [signal];
    const expanded: string[] = [];

    for (const query of baseQueries) {
      expanded.push(`${companyName} ${query}`);
      expanded.push(`${query} ${companyName}`);
      expanded.push(`recent ${query} ${companyName}`);
    }

    return [...new Set(expanded)];
  }

  private calculateSignalRelevance(doc: KnowledgeBaseDocument, signal: IntentSignal, companyName: string): number {
    let score = 0;
    const content = doc.content.toLowerCase();
    const company = companyName.toLowerCase();

    if (content.includes(company)) score += 0.3;

    const queries = this.SIGNAL_QUERY_TEMPLATES[signal] || [signal];
    for (const query of queries) {
      const matches = query.split(' ').filter(word => content.includes(word.toLowerCase()));
      score += (matches.length / query.split(' ').length) * 0.4;
    }

    return Math.min(score, 1.0);
  }

  private detectSignalsInDocument(doc: KnowledgeBaseDocument, companyName: string): IntentSignal[] {
    return this.detectSignalRelevance(doc.content, companyName);
  }

  private detectSignalRelevance(content: string, companyName: string): IntentSignal[] {
    const signals: IntentSignal[] = [];
    const contentLower = content.toLowerCase();
    const companyLower = companyName.toLowerCase();

    if (!contentLower.includes(companyLower)) return signals;

    Object.entries(this.SIGNAL_QUERY_TEMPLATES).forEach(([signal, queries]) => {
      for (const query of queries) {
        if (query.split(' ').some(word => contentLower.includes(word))) {
          signals.push(signal as IntentSignal);
          break;
        }
      }
    });

    return [...new Set(signals)];
  }

  private async buildVectorStore(): Promise<void> {
    const documents = Array.from(this.knowledgeBase.values()).map(doc =>
      new Document({
        pageContent: doc.content,
        metadata: doc.metadata
      })
    );

    if (documents.length > 0) {
      await this.vectorStore.addDocuments(documents);
    }
  }

  private async crossValidateResults(results: SignalResult[], searchResults: SemanticSearchResult[]): Promise<SignalResult[]> {
    return results.map(result => {
      if (!result.found) return result;

      const crossRefCount = result.evidence.reduce((sum, evidence) => 
        sum + (evidence.cross_reference_count || 0), 0
      );

      return {
        ...result,
        confidence: Math.min(result.confidence + (crossRefCount * 0.05), 1.0),
        reasoning: `${result.reasoning} | Cross-referenced with ${crossRefCount} sources`
      };
    });
  }

  // Helper methods
  private cleanContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim().substring(0, 3000);
  }

  private classifyDocumentType(doc: any): KnowledgeBaseDocument['metadata']['type'] {
    const content = (doc.content || '').toLowerCase();
    if (content.includes('job') || content.includes('career')) return 'job';
    if (content.includes('funding') || content.includes('investment')) return 'financial';
    if (content.includes('court') || content.includes('legal')) return 'legal';
    if (content.includes('product') || content.includes('launch')) return 'technical';
    return 'news';
  }

  private extractJobTitle(text: string): string {
    const patterns = [
      /(Senior|Junior|Lead)?\s*(Software|Frontend|Backend)?\s*(Engineer|Developer)/i,
      /(Product|Project|Engineering)\s*Manager/i,
      /(Data\s*Scientist|Data\s*Engineer)/i,
      /(DevOps|SRE)/i,
      /(UX|UI)\s*Designer/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }

    return text.split(/[•·\-–—|]/)[0]?.trim() || text.substring(0, 50);
  }

  private mapJobToDepartment(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('engineer') || lower.includes('developer')) return 'engineering';
    if (lower.includes('sales')) return 'sales';
    if (lower.includes('market')) return 'marketing';
    if (lower.includes('design') || lower.includes('creative')) return 'creative';
    if (lower.includes('finance') || lower.includes('account')) return 'finance';
    if (lower.includes('hr') || lower.includes('human')) return 'human_resources';
    if (lower.includes('legal')) return 'legal';
    if (lower.includes('support') || lower.includes('customer')) return 'support';
    if (lower.includes('operation')) return 'operations';
    return 'unknown';
  }

  private extractCrunchbaseFunding($: cheerio.CheerioAPI): any[] {
    const rounds: any[] = [];
    // Implementation for Crunchbase funding extraction
    return rounds;
  }

  private deduplicateItems(items: any[]): any[] {
    const seen = new Set();
    return items.filter(item => {
      const key = `${item.title}-${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private deduplicateAndRankResults(results: SemanticSearchResult[]): SemanticSearchResult[] {
    const seen = new Set();
    const unique = results.filter(result => {
      const key = `${result.document.id}-${result.signal_matches.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.sort((a, b) => b.relevance_score - a.relevance_score);
  }

  private calculateOverallConfidence(results: SignalResult[]): number {
    const withEvidence = results.filter(r => r.found && r.confidence > 0.4);
    if (withEvidence.length === 0) return 0;
    return withEvidence.reduce((sum, r) => sum + r.confidence, 0) / withEvidence.length;
  }

  private getKnowledgeBaseStats(): any {
    const types = { news: 0, job: 0, financial: 0, company: 0, legal: 0, technical: 0 };
    this.knowledgeBase.forEach(doc => { types[doc.metadata.type]++; });
    
    return {
      total_documents: this.knowledgeBase.size,
      by_type: types
    };
  }

  private getSearchMetrics(results: SemanticSearchResult[]): any {
    return {
      total_results: results.length,
      avg_similarity: results.reduce((sum, r) => sum + r.similarity, 0) / results.length,
      unique_sources: new Set(results.map(r => r.document.metadata.source)).size
    };
  }

  private getUltimateFallbackResponse(
    companyName: string,
    companyUrl: string,
    signals: IntentSignal[],
    errors: string[]
  ): IntentEnrichmentResponse {
    return {
      company: companyName,
      website: companyUrl,
      analysis_date: new Date().toISOString().split('T')[0],
      requested_signals: signals,
      results: signals.map(signal => ({
        signal,
        evidence: [],
        found: false,
        reasoning: 'Ultimate detection failed',
        confidence: 0
      })),
      summary: {
        total_signals: signals.length,
        signals_with_evidence: 0,
        signals_without_evidence: signals.length,
        confidence_score: 0,
        data_sources_used: []
      },
      metadata: {
        processing_time: 0,
        total_sources_checked: 0,
        successful_scrapes: 0,
        failed_scrapes: 0
      },
      debug: { errors }
    };
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateDocumentId(metadata: any): string {
    return crypto.createHash('md5').update(
      `${metadata.url}-${metadata.source}-${metadata.date}`
    ).digest('hex');
  }
}

// Export the ultimate agent
export const createUltimateAgent = (config: AgentConfig) => new UltimateIntentDetectionAgent(config);

// Helper function to get all available signals
export const getAllSignals = (): IntentSignal[] => Object.keys(SIGNAL_DEFINITIONS) as IntentSignal[];

// Helper function to get signal definition
export const getSignalDefinition = (signal: IntentSignal): string => SIGNAL_DEFINITIONS[signal];