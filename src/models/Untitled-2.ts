
here is my agentic rag system called RIO you can analyse it and understand the potential of this rag system

// src/services/agentic/tools/EnhancedAgenticRAGTools.ts

import { Tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Company } from '../../../models/Company';
import { Employee } from '../../../models/Employee';
import { GTMIntelligence } from '../../../models/GTMIntelligence';
import { GTMPersonaIntelligence } from '../../../models/GTMPersonaIntelligence';
import { Enrichment } from '../../../models/Enrichment';
import { AgentContext, mergeFilters } from '../AgentContext';
import { validateFilter, getFallbackSources } from '../SchemaRegistry';
import { JSONPath } from 'jsonpath-plus';

/**
 * Smart Query Tool - with automatic fallback to enrichments and intelligence
 */
export class SmartQueryTool extends Tool {
  name = 'smart_query';
  description = `Intelligent query with automatic fallback to enrichments and GTM intelligence.
  Use for: finding documents with automatic data augmentation from fallback sources.
  Input: { 
    collection: string, 
    filter: object, 
    projection?: object, 
    populate?: string[], 
    limit?: number, 
    sort?: object,
    enableFallback?: boolean (default: true)
  }`;

  schema = z.object({
    collection: z.enum(['companies', 'employees', 'gtm_intelligence', 'gtm_persona_intelligence', 'enrichments']),
    filter: z.object({}).passthrough(),
    projection: z.object({}).passthrough().optional(),
    populate: z.array(z.string()).optional(),
    limit: z.number().optional(),
    sort: z.object({}).passthrough().optional(),
    enableFallback: z.boolean().optional().default(true),
  });

  constructor(private context: AgentContext) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const { collection, filter, projection, populate, limit, sort, enableFallback } = JSON.parse(input);
      
      // Validate filter
      const validation = validateFilter(collection, filter);
      if (!validation.valid) {
        return JSON.stringify({ 
          success: false, 
          error: `Invalid filter: ${validation.errors.join(', ')}`,
          warnings: validation.warnings 
        });
      }

      // Get model
      const model = this.getModel(collection);
      if (!model) {
        return JSON.stringify({ success: false, error: `Unknown collection: ${collection}` });
      }

      // Merge with context filters
      const contextFilter = this.context.globalFilters[collection as keyof typeof this.context.globalFilters];
      const mergedFilter = mergeFilters(contextFilter, filter);

      // Execute query
      let query = model.find(mergedFilter, projection);
      
      if (populate && populate.length > 0) {
        populate.forEach(field => {
          query = query.populate(field);
        });
      }
      
      if (sort) {
        query = query.sort(sort);
      }
      
      if (limit) {
        query = query.limit(limit);
      }

      let results = await query.lean();

      // Apply fallback logic if enabled
      if (enableFallback && results.length > 0) {
        results = await this.applyFallbacks(collection, results, projection);
      }

      return JSON.stringify({ 
        success: true, 
        data: results, 
        count: results.length,
        warnings: validation.warnings 
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  private getModel(collection: string) {
    switch (collection) {
      case 'companies': return Company;
      case 'employees': return Employee;
      case 'gtm_intelligence': return GTMIntelligence;
      case 'gtm_persona_intelligence': return GTMPersonaIntelligence;
      case 'enrichments': return Enrichment;
      default: return null;
    }
  }

  /**
   * Apply intelligent fallbacks to results
   */
  private async applyFallbacks(
    collection: string,
    results: any[],
    projection?: any
  ): Promise<any[]> {
    if (collection === 'companies') {
      return await this.applyCompanyFallbacks(results, projection);
    } else if (collection === 'employees') {
      return await this.applyEmployeeFallbacks(results, projection);
    }
    return results;
  }

  /**
   * Company fallbacks: enrichments → gtm_intelligence
   */
  private async applyCompanyFallbacks(results: any[], projection?: any): Promise<any[]> {
    const companyIds = results.map(r => r._id);
    
    // Fetch enrichments
    const enrichments = await Enrichment.find({
      companyId: { $in: companyIds },
      ...this.context.globalFilters.enrichments
    }).lean();

    const enrichmentMap = new Map(enrichments.map(e => [e.companyId.toString(), e]));

    // Fetch GTM intelligence
    const gtmIntelligence = await GTMIntelligence.find({
      companyId: { $in: companyIds },
      ...this.context.globalFilters.gtmIntelligence
    }).lean();

    const gtmMap = new Map(gtmIntelligence.map(g => [g.companyId.toString(), g]));

    // Augment results
    return results.map(company => {
      const companyId = company._id.toString();
      const enrichment = enrichmentMap.get(companyId);
      const gtm = gtmMap.get(companyId);

      const augmented = { ...company };

      // Apply enrichment fallbacks
      if (enrichment) {
        // Employee count fallback
        if (!company.employeeCount && enrichment.data?.employees_count) {
          augmented.employeeCount = enrichment.data.employees_count;
          augmented._fallbackSource = augmented._fallbackSource || {};
          augmented._fallbackSource.employeeCount = 'enrichments';
        }

        // Revenue fallback
        if (!company.annualRevenue) {
          const revenue = enrichment.data?.revenue_annual?.source_5_annual_revenue?.annual_revenue;
          if (revenue) {
            augmented.annualRevenue = revenue;
            augmented.annualRevenueCurrency = enrichment.data.revenue_annual.source_5_annual_revenue.annual_revenue_currency;
            augmented._fallbackSource = augmented._fallbackSource || {};
            augmented._fallbackSource.annualRevenue = 'enrichments';
          }
        }

        // Funding fallback
        if (!company.totalFunding && enrichment.data?.last_funding_round_amount_raised) {
          augmented.totalFunding = enrichment.data.last_funding_round_amount_raised;
          augmented._fallbackSource = augmented._fallbackSource || {};
          augmented._fallbackSource.totalFunding = 'enrichments';
        }

        // Funding stage fallback
        if (!company.fundingStage && enrichment.data?.last_funding_round_name) {
          augmented.fundingStage = enrichment.data.last_funding_round_name;
          augmented._fallbackSource = augmented._fallbackSource || {};
          augmented._fallbackSource.fundingStage = 'enrichments';
        }

        // Technologies fallback
        if ((!company.technologies || company.technologies.length === 0) && enrichment.data?.technologies_used) {
          augmented.technologies = enrichment.data.technologies_used.map((t: any) => t.name || t);
          augmented._fallbackSource = augmented._fallbackSource || {};
          augmented._fallbackSource.technologies = 'enrichments';
        }

        // Founded year fallback
        if (!company.foundedYear && enrichment.data?.founded_year) {
          augmented.foundedYear = enrichment.data.founded_year;
          augmented._fallbackSource = augmented._fallbackSource || {};
          augmented._fallbackSource.foundedYear = 'enrichments';
        }

        // Headquarters fallback
        if (!company.headquarters && enrichment.data?.hq_full_address) {
          augmented.headquarters = {
            full: enrichment.data.hq_full_address,
            city: enrichment.data.hq_city,
            state: enrichment.data.hq_state,
            country: enrichment.data.hq_country,
          };
          augmented._fallbackSource = augmented._fallbackSource || {};
          augmented._fallbackSource.headquarters = 'enrichments';
        }
      }

      // Add GTM intelligence overview if requested
      if (gtm && (!projection || projection.gtmOverview)) {
        augmented.gtmOverview = gtm.overview;
        augmented._fallbackSource = augmented._fallbackSource || {};
        augmented._fallbackSource.gtmOverview = 'gtm_intelligence';
      }

      return augmented;
    });
  }

  /**
   * Employee fallbacks: company enrichments → gtm_persona_intelligence
   */
  private async applyEmployeeFallbacks(results: any[], projection?: any): Promise<any[]> {
    const employeeIds = results.map(r => r._id);
    
    // Fetch GTM persona intelligence
    const gtmPersona = await GTMPersonaIntelligence.find({
      employeeId: { $in: employeeIds },
      ...this.context.globalFilters.gtmPersonaIntelligence
    }).lean();

    const gtmPersonaMap = new Map(gtmPersona.map(g => [g.employeeId.toString(), g]));

    // Fetch company enrichments for additional context
    const companyIds = [...new Set(results.map(r => r.companyId?.toString()).filter(Boolean))];
    const enrichments = await Enrichment.find({
      companyId: { $in: companyIds },
      ...this.context.globalFilters.enrichments
    }).lean();

    const enrichmentMap = new Map(enrichments.map(e => [e.companyId.toString(), e]));

    // Augment results
    return results.map(employee => {
      const employeeId = employee._id.toString();
      const companyId = employee.companyId?.toString();
      const gtm = gtmPersonaMap.get(employeeId);
      const companyEnrichment = companyId ? enrichmentMap.get(companyId) : null;

      const augmented = { ...employee };

      // Add GTM persona overview if requested
      if (gtm && (!projection || projection.gtmPersonaOverview)) {
        augmented.gtmPersonaOverview = gtm.overview;
        augmented._fallbackSource = augmented._fallbackSource || {};
        augmented._fallbackSource.gtmPersonaOverview = 'gtm_persona_intelligence';
      }

      // Add company context from enrichment
      if (companyEnrichment && (!projection || projection.companyContext)) {
        augmented.companyContext = {
          employeeCount: companyEnrichment.data?.employees_count,
          revenue: companyEnrichment.data?.revenue_annual?.source_5_annual_revenue?.annual_revenue,
          industry: companyEnrichment.data?.industry,
          fundingStage: companyEnrichment.data?.last_funding_round_name,
        };
        augmented._fallbackSource = augmented._fallbackSource || {};
        augmented._fallbackSource.companyContext = 'enrichments';
      }

      return augmented;
    });
  }
}

/**
 * Enhanced Aggregation Tool - with context awareness
 */
export class SmartAggregationTool extends Tool {
  name = 'smart_aggregation';
  description = `Execute MongoDB aggregation with automatic user scoping.
  Use for: counts, sums, averages, grouping, filtering, sorting.
  Input: { collection: string, pipeline: array, options?: object }`;

  schema = z.object({
    collection: z.enum(['companies', 'employees', 'gtm_intelligence', 'gtm_persona_intelligence', 'enrichments']),
    pipeline: z.array(z.any()),
    options: z.object({}).optional(),
  });

  constructor(private context: AgentContext) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const { collection, pipeline, options } = JSON.parse(input);
      
      const model = this.getModel(collection);
      if (!model) {
        return JSON.stringify({ success: false, error: `Unknown collection: ${collection}` });
      }

      // Inject context filters at the start of pipeline
      const contextFilter = this.context.globalFilters[collection as keyof typeof this.context.globalFilters];
      const scopedPipeline = [
        { $match: contextFilter },
        ...pipeline
      ];

      const results = await model.aggregate(scopedPipeline, options);
      return JSON.stringify({ success: true, data: results, count: results.length });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  private getModel(collection: string) {
    switch (collection) {
      case 'companies': return Company;
      case 'employees': return Employee;
      case 'gtm_intelligence': return GTMIntelligence;
      case 'gtm_persona_intelligence': return GTMPersonaIntelligence;
      case 'enrichments': return Enrichment;
      default: return null;
    }
  }
}

/**
 * Enhanced JSON Path Extractor - with JSONPath Plus
 */
export class EnhancedJSONPathTool extends Tool {
  name = 'enhanced_json_path';
  description = `Extract data from nested JSON in Enrichment.data field using JSONPath.
  Supports: array access, filtering, wildcards.
  Input: { companyId: string, jsonPath: string }
  Examples: 
  - "$.data.employees_count"
  - "$.data.funding_rounds[0].amount"
  - "$.data.technologies_used[*].name"
  - "$.data.key_executives[?(@.title=='CEO')].name"`;

  schema = z.object({
    companyId: z.string(),
    jsonPath: z.string(),
  });

  constructor(private context: AgentContext) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const { companyId, jsonPath } = JSON.parse(input);
      
      const enrichment = await Enrichment.findOne({ 
        companyId,
        ...this.context.globalFilters.enrichments
      }).lean();
      
      if (!enrichment) {
        return JSON.stringify({ success: false, error: 'Enrichment not found' });
      }

      // Use JSONPath Plus for powerful extraction
      const results = JSONPath({ 
        path: jsonPath, 
        json: enrichment,
        wrap: false 
      });

      return JSON.stringify({ 
        success: true, 
        data: results,
        source: 'enrichments',
        companyId 
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }
}

/**
 * Multi-Source Query Tool - queries multiple sources in priority order
 */
export class MultiSourceQueryTool extends Tool {
  name = 'multi_source_query';
  description = `Query multiple data sources with fallback priority.
  For companies: companies → enrichments → gtm_intelligence
  For employees: employees → enrichments (company context) → gtm_persona_intelligence
  Input: { 
    entity: 'company' | 'employee',
    entityId: string,
    fields: string[]
  }`;

  schema = z.object({
    entity: z.enum(['company', 'employee']),
    entityId: z.string(),
    fields: z.array(z.string()),
  });

  constructor(private context: AgentContext) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const { entity, entityId, fields } = JSON.parse(input);
      
      if (entity === 'company') {
        return await this.queryCompanyData(entityId, fields);
      } else {
        return await this.queryEmployeeData(entityId, fields);
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  private async queryCompanyData(companyId: string, fields: string[]): Promise<string> {
    const result: Record<string, any> = { _id: companyId };
    const sources: Record<string, string> = {};

    // Source 1: Company collection
    const company = await Company.findOne({
      _id: companyId,
      ...this.context.globalFilters.companies
    }).lean();

    if (company) {
      fields.forEach(field => {
        if (company[field] !== undefined && company[field] !== null) {
          result[field] = company[field];
          sources[field] = 'companies';
        }
      });
    }

    // Source 2: Enrichments (for missing fields)
    const missingFields = fields.filter(f => result[f] === undefined);
    if (missingFields.length > 0) {
      const enrichment = await Enrichment.findOne({
        companyId,
        ...this.context.globalFilters.enrichments
      }).lean();

      if (enrichment) {
        const fallbackMap: Record<string, string> = {
          employeeCount: '$.data.employees_count',
          annualRevenue: '$.data.revenue_annual.source_5_annual_revenue.annual_revenue',
          totalFunding: '$.data.last_funding_round_amount_raised',
          fundingStage: '$.data.last_funding_round_name',
          technologies: '$.data.technologies_used[*].name',
          foundedYear: '$.data.founded_year',
          linkedinUrl: '$.data.linkedin_url',
        };

        missingFields.forEach(field => {
          const path = fallbackMap[field];
          if (path) {
            try {
              const value = JSONPath({ path, json: enrichment, wrap: false });
              if (value !== undefined && value !== null) {
                result[field] = value;
                sources[field] = 'enrichments';
              }
            } catch (e) {
              // Skip if JSONPath fails
            }
          }
        });
      }
    }

    // Source 3: GTM Intelligence (for overview/analysis fields)
    if (fields.includes('gtmOverview') || fields.includes('analysis')) {
      const gtm = await GTMIntelligence.findOne({
        companyId,
        ...this.context.globalFilters.gtmIntelligence
      }).lean();

      if (gtm) {
        if (fields.includes('gtmOverview')) {
          result.gtmOverview = gtm.overview;
          sources.gtmOverview = 'gtm_intelligence';
        }
      }
    }

    return JSON.stringify({
      success: true,
      data: result,
      sources,
      coverage: `${Object.keys(sources).length}/${fields.length} fields found`
    });
  }

  private async queryEmployeeData(employeeId: string, fields: string[]): Promise<string> {
    const result: Record<string, any> = { _id: employeeId };
    const sources: Record<string, string> = {};

    // Source 1: Employee collection
    const employee = await Employee.findOne({
      _id: employeeId,
      ...this.context.globalFilters.employees
    }).lean();

    if (!employee) {
      return JSON.stringify({ success: false, error: 'Employee not found' });
    }

    fields.forEach(field => {
      if (employee[field] !== undefined && employee[field] !== null) {
        result[field] = employee[field];
        sources[field] = 'employees';
      }
    });

    // Source 2: Company enrichment (for company context)
    if (employee.companyId && fields.some(f => f.startsWith('company'))) {
      const enrichment = await Enrichment.findOne({
        companyId: employee.companyId,
        ...this.context.globalFilters.enrichments
      }).lean();

      if (enrichment) {
        result.companyContext = {
          name: enrichment.data?.company_name,
          employeeCount: enrichment.data?.employees_count,
          revenue: enrichment.data?.revenue_annual?.source_5_annual_revenue?.annual_revenue,
          industry: enrichment.data?.industry,
        };
        sources.companyContext = 'enrichments';
      }
    }

    // Source 3: GTM Persona Intelligence
    if (fields.includes('gtmPersonaOverview') || fields.includes('analysis')) {
      const gtmPersona = await GTMPersonaIntelligence.findOne({
        employeeId,
        ...this.context.globalFilters.gtmPersonaIntelligence
      }).lean();

      if (gtmPersona) {
        result.gtmPersonaOverview = gtmPersona.overview;
        sources.gtmPersonaOverview = 'gtm_persona_intelligence';
      }
    }

    return JSON.stringify({
      success: true,
      data: result,
      sources,
      coverage: `${Object.keys(sources).length}/${fields.length} fields found`
    });
  }
}

/**
 * Export all enhanced tools
 */
export function createEnhancedTools(context: AgentContext) {
  return [
    new SmartQueryTool(context),
    new SmartAggregationTool(context),
    new EnhancedJSONPathTool(context),
    new MultiSourceQueryTool(context),
  ];
}

// src/services/agentic/AgentContext.ts

import { Types } from 'mongoose';

/**
 * Agent Context - Carries user scope and filters throughout execution
 */
export interface AgentContext {
  userId: string;
  sessionId?: Types.ObjectId;
  icpModelId?: Types.ObjectId;
  
  // Computed filters applied to all queries
  globalFilters: {
    companies: Record<string, any>;
    employees: Record<string, any>;
    gtmIntelligence: Record<string, any>;
    gtmPersonaIntelligence: Record<string, any>;
    enrichments: Record<string, any>;
  };
}

/**
 * Build context with user-scoped filters
 */
export function buildAgentContext(
  userId: string,
  sessionId?: string,
  icpModelId?: string
): AgentContext {
  const sessionObjId = sessionId ? new Types.ObjectId(sessionId) : undefined;
  const icpObjId = icpModelId ? new Types.ObjectId(icpModelId) : undefined;

  return {
    userId,
    sessionId: sessionObjId,
    icpModelId: icpObjId,
    globalFilters: {
      companies: buildCompanyFilter(userId, sessionObjId, icpObjId),
      employees: buildEmployeeFilter(userId, sessionObjId, icpObjId),
      gtmIntelligence: buildGTMIntelligenceFilter(userId, sessionObjId, icpObjId),
      gtmPersonaIntelligence: buildGTMPersonaFilter(userId, sessionObjId, icpObjId),
      enrichments: buildEnrichmentFilter(userId, sessionObjId, icpObjId),
    },
  };
}

/**
 * Build company filter - companies belong to sessions which belong to users
 */
function buildCompanyFilter(
  userId: string,
  sessionId?: Types.ObjectId,
  icpModelId?: Types.ObjectId
): Record<string, any> {
  const filter: Record<string, any> = {};
  
  // Companies must be in user's sessions
  if (sessionId) {
    filter.sessionId = sessionId;
  }
  // If no specific session, we need to lookup user's sessions first
  // This will be handled by the tool
  
  if (icpModelId) {
    filter.icpModelId = icpModelId;
  }
  
  return filter;
}

/**
 * Build employee filter - employees belong to companies in user's sessions
 */
function buildEmployeeFilter(
  userId: string,
  sessionId?: Types.ObjectId,
  icpModelId?: Types.ObjectId
): Record<string, any> {
  const filter: Record<string, any> = {};
  
  if (sessionId) {
    filter.sessionId = sessionId;
  }
  
  if (icpModelId) {
    filter.icpModelId = icpModelId;
  }
  
  return filter;
}

/**
 * Build GTM Intelligence filter
 */
function buildGTMIntelligenceFilter(
  userId: string,
  sessionId?: Types.ObjectId,
  icpModelId?: Types.ObjectId
): Record<string, any> {
  const filter: Record<string, any> = {};
  
  if (sessionId) {
    filter.sessionId = sessionId;
  }
  
  if (icpModelId) {
    filter.icpModelId = icpModelId;
  }
  
  return filter;
}

/**
 * Build GTM Persona Intelligence filter
 */
function buildGTMPersonaFilter(
  userId: string,
  sessionId?: Types.ObjectId,
  icpModelId?: Types.ObjectId
): Record<string, any> {
  const filter: Record<string, any> = {};
  
  if (sessionId) {
    filter.sessionId = sessionId;
  }
  
  if (icpModelId) {
    filter.icpModelId = icpModelId;
  }
  
  return filter;
}

/**
 * Build enrichment filter
 */
function buildEnrichmentFilter(
  userId: string,
  sessionId?: Types.ObjectId,
  icpModelId?: Types.ObjectId
): Record<string, any> {
  const filter: Record<string, any> = {};
  
  if (sessionId) {
    filter.sessionId = sessionId;
  }
  
  if (icpModelId) {
    filter.icpModelId = icpModelId;
  }
  
  return filter;
}

/**
 * Merge user filters with tool-specific filters
 */
export function mergeFilters(
  contextFilter: Record<string, any>,
  toolFilter: Record<string, any>
): Record<string, any> {
  return {
    ...contextFilter,
    ...toolFilter,
    // If both have $and, merge them
    ...(contextFilter.$and && toolFilter.$and
      ? { $and: [...contextFilter.$and, ...toolFilter.$and] }
      : {}),
  };
}

// src/routes/agentic/EnhancedAgenticRAGRoutes.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { enhancedLangGraphAgent } from './EnhancedLangGraphAgent';

interface QueryRequest {
  query: string;
  sessionId?: string;
  icpModelId?: string;
}

interface StreamQueryRequest extends QueryRequest {
  stream: boolean;
}

/**
 * Authentication middleware - extracts userId from request
 * Replace with your actual auth implementation
 */
async function getUserId(request: FastifyRequest): Promise<string> {
  // TODO: Replace with actual authentication
  // Example: const userId = request.user.id;
  // Example: const userId = request.headers['x-user-id'];
  
  const userId = (request.headers['x-user-id'] as string) || 
                 (request as any).user?.id || 
                 'default-user';
  
  if (!userId) {
    throw new Error('User authentication required');
  }
  
  return userId;
}

export async function enhancedAgenticRAGRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/agentic/query
   * Main agentic RAG query endpoint with user scoping
   */
  fastify.post<{ Body: QueryRequest }>(
    '/query',
    {
      schema: {
        description: 'Execute an agentic RAG query with automatic user scoping',
        tags: ['Agentic RAG'],
        headers: {
          type: 'object',
          properties: {
            'x-user-id': { type: 'string', description: 'User ID for authentication' }
          }
        },
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { 
              type: 'string', 
              description: 'Natural language query',
              examples: [
                'Show me CTOs at Series A companies',
                'What is the average revenue of fintech companies?',
                'Find decision makers at companies with recent job postings'
              ]
            },
            sessionId: { 
              type: 'string', 
              description: 'Optional: Limit to specific session'
            },
            icpModelId: { 
              type: 'string', 
              description: 'Optional: Limit to specific ICP model'
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              answer: { type: 'string' },
              intent: { type: 'object' },
              plan: { type: 'object' },
              steps: { type: 'array' },
              executionTimeMs: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' }
            }
          },
          401: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' }
            }
          }
        },
      },
    },
    async (request: FastifyRequest<{ Body: QueryRequest }>, reply: FastifyReply) => {
      const startTime = Date.now();

      try {
        // Extract user ID from authentication
        const userId = await getUserId(request);

        const { query, sessionId, icpModelId } = request.body;

        if (!query || query.trim().length === 0) {
          return reply.code(400).send({
            success: false,
            error: 'Query is required',
          });
        }

        // Execute query with user context
        const result = await enhancedLangGraphAgent.query(
          query,
          userId,
          sessionId,
          icpModelId
        );

        const executionTimeMs = Date.now() - startTime;

        return reply.send({
          success: !result.error,
          answer: result.answer,
          intent: result.intent,
          plan: result.plan,
          steps: result.steps,
          executionTimeMs: result.executionTimeMs || executionTimeMs,
          error: result.error,
        });
      } catch (error: any) {
        if (error.message === 'User authentication required') {
          return reply.code(401).send({
            success: false,
            error: 'Authentication required',
          });
        }

        console.error('Agentic RAG query error:', error);
        return reply.code(500).send({
          success: false,
          error: error.message,
          executionTimeMs: Date.now() - startTime,
        });
      }
    }
  );

  /**
   * POST /api/agentic/query/stream
   * Streaming agentic RAG query
   */
  fastify.post<{ Body: StreamQueryRequest }>(
    '/query/stream',
    {
      schema: {
        description: 'Execute an agentic RAG query with streaming updates',
        tags: ['Agentic RAG'],
        headers: {
          type: 'object',
          properties: {
            'x-user-id': { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            sessionId: { type: 'string' },
            icpModelId: { type: 'string' },
            stream: { type: 'boolean', default: true },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: StreamQueryRequest }>, reply: FastifyReply) => {
      try {
        const userId = await getUserId(request);
        const { query, sessionId, icpModelId } = request.body;

        // Set headers for SSE
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        // Send start event
        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'start', 
          message: 'Processing query...',
          userId: userId.substring(0, 8) + '...' // Masked for privacy
        })}\n\n`);

        // Execute query
        const result = await enhancedLangGraphAgent.query(
          query,
          userId,
          sessionId,
          icpModelId
        );

        // Stream results
        if (result.intent) {
          reply.raw.write(`data: ${JSON.stringify({ 
            type: 'intent', 
            data: result.intent 
          })}\n\n`);
        }

        if (result.plan) {
          reply.raw.write(`data: ${JSON.stringify({ 
            type: 'plan', 
            data: {
              steps: result.plan.steps.length,
              complexity: result.intent?.complexity
            }
          })}\n\n`);
        }

        if (result.steps) {
          for (const step of result.steps) {
            reply.raw.write(`data: ${JSON.stringify({ 
              type: 'step', 
              data: step 
            })}\n\n`);
          }
        }

        // Send final answer
        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'answer', 
          data: result.answer,
          executionTimeMs: result.executionTimeMs
        })}\n\n`);

        // Send done
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        reply.raw.end();

      } catch (error: any) {
        reply.raw.write(`data: ${JSON.stringify({ 
          type: 'error', 
          message: error.message 
        })}\n\n`);
        reply.raw.end();
      }
    }
  );

  /**
   * POST /api/agentic/test-tool
   * Test individual tools
   */
  fastify.post<{ Body: { tool: string; input: any; sessionId?: string; icpModelId?: string } }>(
    '/test-tool',
    {
      schema: {
        description: 'Test individual tool execution with user scoping',
        tags: ['Agentic RAG'],
        headers: {
          type: 'object',
          properties: {
            'x-user-id': { type: 'string' }
          }
        },
        body: {
          type: 'object',
          required: ['tool', 'input'],
          properties: {
            tool: { 
              type: 'string',
              enum: ['smart_query', 'smart_aggregation', 'enhanced_json_path', 'multi_source_query']
            },
            input: { type: 'object' },
            sessionId: { type: 'string' },
            icpModelId: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { tool: string; input: any; sessionId?: string; icpModelId?: string } }>, reply: FastifyReply) => {
      try {
        const userId = await getUserId(request);
        const { tool, input, sessionId, icpModelId } = request.body;

        // Build context
        const { buildAgentContext } = await import('./AgentContext');
        const context = buildAgentContext(userId, sessionId, icpModelId);

        // Get tools
        const { createEnhancedTools } = await import('./tools/EnhancedAgenticRAGTools');
        const tools = createEnhancedTools(context);
        const targetTool = tools.find(t => t.name === tool);

        if (!targetTool) {
          return reply.code(404).send({
            success: false,
            error: `Tool '${tool}' not found`,
          });
        }

        const result = await targetTool._call(JSON.stringify(input));
        const parsedResult = JSON.parse(result);

        return reply.send({
          success: parsedResult.success,
          data: parsedResult.data,
          sources: parsedResult.sources,
          count: parsedResult.count,
          warnings: parsedResult.warnings,
          error: parsedResult.error,
        });
      } catch (error: any) {
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/agentic/health
   * Health check
   */
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Check agentic RAG system health',
        tags: ['Agentic RAG'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              version: { type: 'string' },
              features: { type: 'array' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        status: 'healthy',
        version: '2.0.0-enhanced',
        features: [
          'User-scoped queries',
          'Multi-source fallback',
          'Smart data augmentation',
          'Intent classification',
          'Query planning with validation',
          'Error recovery',
        ],
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * GET /api/agentic/my-data-stats
   * Get statistics about user's accessible data
   */
  fastify.get(
    '/my-data-stats',
    {
      schema: {
        description: 'Get statistics about accessible data for authenticated user',
        tags: ['Agentic RAG'],
        headers: {
          type: 'object',
          properties: {
            'x-user-id': { type: 'string' }
          }
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = await getUserId(request);
        
        const { Session } = await import('../../models/Session');
        const { Company } = await import('../../models/Company');
        const { Employee } = await import('../../models/Employee');
        const { Enrichment } = await import('../../models/Enrichment');

        // Get user's sessions
        const sessions = await Session.find({ userId }).lean();
        const sessionIds = sessions.map(s => s._id);

        // Count data
        const [companyCount, employeeCount, enrichmentCount] = await Promise.all([
          Company.countDocuments({ sessionId: { $in: sessionIds } }),
          Employee.countDocuments({ sessionId: { $in: sessionIds } }),
          Enrichment.countDocuments({ sessionId: { $in: sessionIds } }),
        ]);

        return reply.send({
          success: true,
          stats: {
            sessions: sessions.length,
            companies: companyCount,
            employees: employeeCount,
            enrichments: enrichmentCount,
          },
          sessions: sessions.map(s => ({
            id: s._id,
            name: s.name,
            resultsCount: s.resultsCount,
            createdAt: s.createdAt,
          })),
        });
      } catch (error: any) {
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
}

// src/services/agentic/EnhancedIntentClassifier.ts

import { openRouterService } from '../../utils/OpenRouterService';
import { AgentContext } from './AgentContext';

export interface QueryIntent {
  category: 'analytics' | 'search' | 'comparison' | 'extraction' | 'visualization' | 'multi_step';
  complexity: 'simple' | 'medium' | 'complex';
  requiresJoin: boolean;
  requiresAggregation: boolean;
  requiresVectorSearch: boolean;
  requiresTextSearch: boolean;
  requiresFallback: boolean; // NEW: indicates need for multi-source query
  collections: string[];
  primaryEntity: 'company' | 'employee' | 'both' | 'other';
  confidence: number;
  reasoning: string;
  suggestedFields?: string[]; // NEW: suggested fields to query
}

export class EnhancedIntentClassifier {
  private systemPrompt = `You are an intent classification system for a B2B company intelligence database with user-scoped access.

**CRITICAL: All data is user-scoped. Queries only access data belonging to the authenticated user's sessions.**

### DATABASE SCHEMA ###

**companies** (Primary company data):
- Fields: name, domain, description, industry (array), employeeCount (number), annualRevenue (number), totalFunding (number), fundingStage (string), technologies (array), linkedinUrl, foundedYear, headquarters
- Relations: sessionId, icpModelId
- Fallback: enrichments.data, gtm_intelligence.overview

**employees** (Employee profiles):
- Fields: fullName, firstName, lastName, headline, activeExperienceTitle, activeExperienceDepartment, isDecisionMaker (boolean), locationCountry, locationCity, primaryProfessionalEmail, linkedinUrl, connectionsCount, inferredSkills (array), totalExperienceDurationMonths, educationDegrees (array)
- Relations: companyId, sessionId, icpModelId
- Fallback: enrichments.data (company context), gtm_persona_intelligence.overview

**enrichments** (Rich CoreSignal data):
- Fields: companyId, sessionId, icpModelId, data (nested JSON with 100+ fields), source
- Key nested fields: employees_count, revenue_annual, funding_rounds, technologies_used, active_job_postings, key_executives, employee_reviews_score, website_visits

**gtm_intelligence** (AI-generated company analysis):
- Fields: sessionId, icpModelId, companyId, overview (markdown text)
- Purpose: Strategic GTM insights, market positioning, recommendations

**gtm_persona_intelligence** (AI-generated employee analysis):
- Fields: sessionId, icpModelId, companyId, employeeId, overview (markdown text)
- Purpose: Individual persona insights, engagement strategies

### FALLBACK STRATEGY ###
When fields are not in primary collections, they're in fallback sources:

**Company data cascade:**
1. companies collection → 2. enrichments.data → 3. gtm_intelligence.overview

**Employee data cascade:**
1. employees collection → 2. enrichments.data (company context) → 3. gtm_persona_intelligence.overview

**Set requiresFallback: true** when:
- Query asks for fields likely in enrichments (growth metrics, funding details, technologies, job postings)
- Query asks for detailed analysis (GTM strategies, persona insights)
- Query combines basic + enrichment fields (e.g., "companies with 50+ employees and Series A funding")

### CLASSIFICATION RULES ###

**category:**
- "analytics": Aggregations, statistics, distributions (avg, sum, count, group by)
- "search": Finding specific entities with filters
- "comparison": Comparing multiple entities or groups
- "extraction": Getting specific fields from specific records
- "multi_step": Requires multiple operations (joins, then filters, then aggregations)

**complexity:**
- "simple": Single collection, basic filter/aggregation (1-2 operations)
- "medium": Join 2 collections OR aggregation + filtering (3-5 operations)
- "complex": Multiple joins AND aggregations OR requires fallback data (6+ operations)

**requiresJoin**: true if querying multiple collections simultaneously
**requiresAggregation**: true if using $group, $count, $avg, $sum, $min, $max
**requiresFallback**: true if likely needs enrichment or intelligence data
**primaryEntity**: "company" | "employee" | "both" | "other"

### EXAMPLES ###

Query: "Show me CTOs at Series A companies with 50+ employees"
{
  "category": "multi_step",
  "complexity": "medium",
  "requiresJoin": true,
  "requiresAggregation": false,
  "requiresVectorSearch": false,
  "requiresTextSearch": false,
  "requiresFallback": true,
  "collections": ["employees", "companies", "enrichments"],
  "primaryEntity": "both",
  "confidence": 95,
  "reasoning": "Needs join between employees (CTOs) and companies (Series A, 50+ employees). Funding stage likely in enrichments.",
  "suggestedFields": ["fullName", "headline", "companyName", "fundingStage", "employeeCount"]
}

Query: "What's the average revenue of SaaS companies in my portfolio?"
{
  "category": "analytics",
  "complexity": "medium",
  "requiresJoin": false,
  "requiresAggregation": true,
  "requiresVectorSearch": false,
  "requiresTextSearch": false,
  "requiresFallback": true,
  "collections": ["companies", "enrichments"],
  "primaryEntity": "company",
  "confidence": 90,
  "reasoning": "Needs aggregation ($avg) on revenue. Revenue data likely in enrichments.data.revenue_annual.",
  "suggestedFields": ["annualRevenue", "industry", "name"]
}

Query: "Find decision makers at companies with recent job postings in engineering"
{
  "category": "multi_step",
  "complexity": "complex",
  "requiresJoin": true,
  "requiresAggregation": false,
  "requiresVectorSearch": false,
  "requiresTextSearch": true,
  "requiresFallback": true,
  "collections": ["employees", "companies", "enrichments"],
  "primaryEntity": "employee",
  "confidence": 85,
  "reasoning": "Multi-step: 1) Find companies with engineering job postings (enrichments.data.active_job_postings) 2) Find decision makers at those companies. Requires text search on job titles.",
  "suggestedFields": ["fullName", "isDecisionMaker", "activeExperienceTitle", "companyName"]
}

Query: "Show me companies similar to Stripe"
{
  "category": "search",
  "complexity": "simple",
  "requiresJoin": false,
  "requiresAggregation": false,
  "requiresVectorSearch": true,
  "requiresTextSearch": false,
  "requiresFallback": false,
  "collections": ["companies"],
  "primaryEntity": "company",
  "confidence": 95,
  "reasoning": "Semantic similarity search requires vector embeddings.",
  "suggestedFields": ["name", "industry", "employeeCount", "fundingStage"]
}

Return ONLY valid JSON with the QueryIntent structure.`;

  constructor(private context: AgentContext) {}

  async classify(query: string): Promise<QueryIntent> {
    try {
      const contextInfo = `
User Context:
- User ID: ${this.context.userId}
- Session: ${this.context.sessionId || 'all sessions'}
- ICP Model: ${this.context.icpModelId || 'all models'}

Note: Query will be automatically scoped to this user's data.`;

      const result = await openRouterService.generateJSON<QueryIntent>(
        `${contextInfo}\n\nClassify this query: "${query}"`,
        this.systemPrompt,
        'anthropic/claude-3.5-sonnet',
        2048
      );

      return result;
    } catch (error: any) {
      console.error('Intent classification failed:', error);
      
      // Fallback classification
      return {
        category: 'search',
        complexity: 'simple',
        requiresJoin: false,
        requiresAggregation: false,
        requiresVectorSearch: false,
        requiresTextSearch: true,
        requiresFallback: false,
        collections: ['companies'],
        primaryEntity: 'company',
        confidence: 50,
        reasoning: 'Fallback classification due to error'
      };
    }
  }
}

// src/services/agentic/EnhancedLangGraphAgent.ts

import { StateGraph, END, StateGraphArgs } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { createEnhancedTools } from './tools/EnhancedAgenticRAGTools';
import { EnhancedIntentClassifier, QueryIntent } from './EnhancedIntentClassifier';
import { EnhancedQueryPlanner, QueryPlan, QueryStep } from './EnhancedQueryPlanner';
import { AgentContext, buildAgentContext } from './AgentContext';
import { openRouterService } from '../../utils/OpenRouterService';

// Define agent state
interface AgentState {
  messages: BaseMessage[];
  userQuery: string;
  context: AgentContext;
  intent?: QueryIntent;
  plan?: QueryPlan;
  stepResults: Map<string, any>; // Changed to string keys for outputVariable
  currentStep: number;
  finalAnswer?: string;
  error?: string;
  retryCount: number;
}

export class EnhancedLangGraphAgent {
  private graph: any;

  private buildGraph() {
    const graphState: StateGraphArgs<AgentState>['channels'] = {
      messages: {
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
      userQuery: {
        value: (x?: string, y?: string) => y ?? x ?? '',
        default: () => '',
      },
      context: {
        value: (x?: AgentContext, y?: AgentContext) => y ?? x,
        default: () => ({} as AgentContext),
      },
      intent: {
        value: (x?: QueryIntent, y?: QueryIntent) => y ?? x,
        default: () => undefined,
      },
      plan: {
        value: (x?: QueryPlan, y?: QueryPlan) => y ?? x,
        default: () => undefined,
      },
      stepResults: {
        value: (x?: Map<string, any>, y?: Map<string, any>) => y ?? x ?? new Map(),
        default: () => new Map(),
      },
      currentStep: {
        value: (x?: number, y?: number) => y ?? x ?? 0,
        default: () => 0,
      },
      finalAnswer: {
        value: (x?: string, y?: string) => y ?? x,
        default: () => undefined,
      },
      error: {
        value: (x?: string, y?: string) => y ?? x,
        default: () => undefined,
      },
      retryCount: {
        value: (x?: number, y?: number) => y ?? x ?? 0,
        default: () => 0,
      },
    };

    const workflow = new StateGraph<AgentState>({ channels: graphState });

    // Define nodes
    workflow.addNode('classify_intent', this.classifyIntent.bind(this));
    workflow.addNode('create_plan', this.createPlan.bind(this));
    workflow.addNode('validate_plan', this.validatePlan.bind(this));
    workflow.addNode('execute_step', this.executeStep.bind(this));
    workflow.addNode('handle_error', this.handleError.bind(this));
    workflow.addNode('synthesize_response', this.synthesizeResponse.bind(this));

    // Define edges
    workflow.addEdge('__start__', 'classify_intent');
    workflow.addEdge('classify_intent', 'create_plan');
    workflow.addEdge('create_plan', 'validate_plan');
    
    // Conditional: validation passed or failed
    workflow.addConditionalEdges(
      'validate_plan',
      this.shouldRetryPlanning.bind(this),
      {
        proceed: 'execute_step',
        retry: 'create_plan',
        error: END,
      }
    );
    
    // Conditional: continue execution or done
    workflow.addConditionalEdges(
      'execute_step',
      this.shouldContinueExecution.bind(this),
      {
        continue: 'execute_step',
        synthesize: 'synthesize_response',
        error: 'handle_error',
      }
    );

    // Conditional: retry or fail
    workflow.addConditionalEdges(
      'handle_error',
      this.shouldRetryExecution.bind(this),
      {
        retry: 'execute_step',
        replan: 'create_plan',
        fail: END,
      }
    );

    workflow.addEdge('synthesize_response', END);

    return workflow.compile();
  }

  constructor() {
    this.graph = this.buildGraph();
  }

  /**
   * Node 1: Classify user intent
   */
  private async classifyIntent(state: AgentState): Promise<Partial<AgentState>> {
    try {
      console.log('🧠 Classifying intent for user:', state.context.userId);
      
      const classifier = new EnhancedIntentClassifier(state.context);
      const intent = await classifier.classify(state.userQuery);
      
      console.log(`Intent: ${intent.category} (confidence: ${intent.confidence}%)`);
      
      return {
        intent,
        messages: [...state.messages, new AIMessage(`Intent: ${intent.category} - ${intent.reasoning}`)],
      };
    } catch (error: any) {
      return { error: `Intent classification failed: ${error.message}` };
    }
  }

  /**
   * Node 2: Create execution plan
   */
  private async createPlan(state: AgentState): Promise<Partial<AgentState>> {
    try {
      console.log('📋 Creating execution plan...');
      
      if (!state.intent) {
        throw new Error('No intent available');
      }

      const planner = new EnhancedQueryPlanner(state.context);
      const plan = await planner.createPlan(state.userQuery, state.intent);

      console.log(`Plan created with ${plan.steps.length} steps`);
      
      return {
        plan,
        currentStep: 0,
        stepResults: new Map(),
        messages: [...state.messages, new AIMessage(`Plan: ${plan.steps.length} steps`)],
      };
    } catch (error: any) {
      return { error: `Plan creation failed: ${error.message}` };
    }
  }

  /**
   * Node 3: Validate plan
   */
  private async validatePlan(state: AgentState): Promise<Partial<AgentState>> {
    try {
      console.log('✅ Validating plan...');
      
      if (!state.plan) {
        throw new Error('No plan to validate');
      }

      const planner = new EnhancedQueryPlanner(state.context);
      const validation = planner.validatePlan(state.plan);

      if (!validation.valid) {
        console.error('❌ Plan validation failed:', validation.errors);
        return {
          error: `Plan validation failed: ${validation.errors.join(', ')}`,
        };
      }

      if (validation.warnings.length > 0) {
        console.warn('⚠️ Plan warnings:', validation.warnings);
      }

      console.log('✅ Plan validated successfully');
      
      return {
        messages: [...state.messages, new AIMessage('Plan validated')],
      };
    } catch (error: any) {
      return { error: `Plan validation error: ${error.message}` };
    }
  }

  /**
   * Node 4: Execute current step
   */
  private async executeStep(state: AgentState): Promise<Partial<AgentState>> {
    try {
      if (!state.plan) {
        throw new Error('No plan available');
      }

      const step = state.plan.steps[state.currentStep];
      if (!step) {
        throw new Error(`Step ${state.currentStep} not found`);
      }

      console.log(`⚙️  Executing step ${step.stepNumber}: ${step.description}`);

      // Check dependencies and resolve variable references
      const resolvedInput = this.resolveToolInput(step.toolInput, state.stepResults);

      // Get tools
      const tools = createEnhancedTools(state.context);
      const tool = tools.find(t => t.name === step.tool);
      
      if (!tool) {
        throw new Error(`Tool ${step.tool} not found`);
      }

      // Execute tool
      const toolInput = JSON.stringify(resolvedInput);
      const result = await tool._call(toolInput);
      const parsedResult = JSON.parse(result);

      if (!parsedResult.success) {
        throw new Error(`Step ${step.stepNumber} failed: ${parsedResult.error}`);
      }

      console.log(`✅ Step ${step.stepNumber} completed: ${parsedResult.count || 'N/A'} results`);

      // Store result with outputVariable name
      const newStepResults = new Map(state.stepResults);
      const varName = step.outputVariable || `step${step.stepNumber}Result`;
      newStepResults.set(varName, parsedResult);

      return {
        stepResults: newStepResults,
        currentStep: state.currentStep + 1,
        retryCount: 0, // Reset retry on success
        messages: [...state.messages, new AIMessage(`Step ${step.stepNumber}: ✓`)],
      };
    } catch (error: any) {
      console.error('❌ Step execution error:', error);
      return {
        error: `Step execution failed: ${error.message}`,
        retryCount: state.retryCount + 1,
      };
    }
  }

  /**
   * Resolve variable references in tool input
   */
  private resolveToolInput(toolInput: Record<string, any>, stepResults: Map<string, any>): Record<string, any> {
    const resolved = { ...toolInput };

    // Recursively resolve {{variableName}} or {{variableName.field}} references
    const resolveValue = (value: any): any => {
      if (typeof value === 'string' && value.includes('{{')) {
        const match = value.match(/\{\{(.+?)\}\}/);
        if (match) {
          const path = match[1].split('.');
          const varName = path[0];
          const result = stepResults.get(varName);
          
          if (!result) {
            throw new Error(`Variable ${varName} not found in previous steps`);
          }

          // Navigate path
          let resolvedValue = result.data;
          for (let i = 1; i < path.length; i++) {
            resolvedValue = resolvedValue?.[path[i]];
          }

          // If path ends with array field like "_id", extract array of ids
          if (Array.isArray(resolvedValue)) {
            return resolvedValue;
          } else if (Array.isArray(result.data) && path.length > 1) {
            // Extract field from array of objects
            const field = path[path.length - 1];
            return result.data.map((item: any) => item[field]);
          }

          return resolvedValue;
        }
      } else if (Array.isArray(value)) {
        return value.map(resolveValue);
      } else if (typeof value === 'object' && value !== null) {
        const resolved: Record<string, any> = {};
        for (const key in value) {
          resolved[key] = resolveValue(value[key]);
        }
        return resolved;
      }
      return value;
    };

    for (const key in resolved) {
      resolved[key] = resolveValue(resolved[key]);
    }

    return resolved;
  }

  /**
   * Node 5: Handle errors
   */
  private async handleError(state: AgentState): Promise<Partial<AgentState>> {
    console.log(`⚠️ Handling error (attempt ${state.retryCount}/3)`);
    
    // Log error for observability
    return {
      messages: [...state.messages, new AIMessage(`Error: ${state.error}`)],
    };
  }

  /**
   * Conditional: Should retry planning?
   */
  private shouldRetryPlanning(state: AgentState): string {
    if (state.error && state.retryCount < 2) {
      console.log('🔄 Retrying planning...');
      return 'retry';
    }
    if (state.error) {
      return 'error';
    }
    return 'proceed';
  }

  /**
   * Conditional: Should continue executing steps?
   */
  private shouldContinueExecution(state: AgentState): string {
    if (state.error) {
      return 'error';
    }

    if (!state.plan) {
      return 'error';
    }

    // All steps done?
    if (state.currentStep >= state.plan.steps.length) {
      return 'synthesize';
    }

    return 'continue';
  }

  /**
   * Conditional: Should retry execution?
   */
  private shouldRetryExecution(state: AgentState): string {
    if (state.retryCount < 3) {
      console.log('🔄 Retrying execution...');
      return 'retry';
    }
    
    if (state.retryCount < 5) {
      console.log('🔄 Retrying with new plan...');
      return 'replan';
    }
    
    return 'fail';
  }

  /**
   * Node 6: Synthesize final response
   */
  private async synthesizeResponse(state: AgentState): Promise<Partial<AgentState>> {
    try {
      console.log('🎯 Synthesizing final response...');

      if (!state.plan) {
        throw new Error('No plan available');
      }

      // Gather all results
      const resultsContext = Array.from(state.stepResults.entries())
        .map(([varName, result]) => {
          return `${varName}:
${JSON.stringify(result.data, null, 2)}
Sources: ${JSON.stringify(result.sources || {})}`;
        })
        .join('\n\n---\n\n');

      const synthesisPrompt = `
You are a data analyst synthesizing query results for a B2B intelligence platform.

Original Query: "${state.userQuery}"

User Context:
- User ID: ${state.context.userId}
- Session: ${state.context.sessionId?.toString() || 'all sessions'}

Execution Results:
${resultsContext}

Task: Provide a clear, accurate, actionable answer.

Guidelines:
1. Be concise but complete - answer the specific question asked
2. Include key numbers/metrics when relevant
3. If data came from fallback sources (enrichments, GTM intelligence), mention this naturally
4. Format lists/tables clearly for readability
5. If results are empty, explain what was searched
6. NEVER make up data - only use what's in the results
7. For business insights, be specific and actionable
8. Highlight any surprising or notable findings

Response format:
- Start with direct answer
- Support with key data points
- End with insights or recommendations if appropriate`;

      const finalAnswer = await openRouterService.generate(
        synthesisPrompt,
        'You are a helpful B2B data analyst providing insights to business users.',
        'anthropic/claude-3.5-sonnet',
        4096
      );

      console.log('✅ Response synthesized');

      return {
        finalAnswer,
        messages: [...state.messages, new AIMessage(finalAnswer)],
      };
    } catch (error: any) {
      return { error: `Response synthesis failed: ${error.message}` };
    }
  }

  /**
   * Main entry point
   */
  async query(
    userQuery: string,
    userId: string,
    sessionId?: string,
    icpModelId?: string
  ): Promise<{
    answer: string;
    intent?: QueryIntent;
    plan?: QueryPlan;
    steps?: any[];
    error?: string;
    executionTimeMs?: number;
  }> {
    const startTime = Date.now();

    try {
      // Build user-scoped context
      const context = buildAgentContext(userId, sessionId, icpModelId);

      const initialState: AgentState = {
        messages: [new HumanMessage(userQuery)],
        userQuery,
        context,
        stepResults: new Map(),
        currentStep: 0,
        retryCount: 0,
      };

      // Run the graph
      const result = await this.graph.invoke(initialState);

      if (result.error) {
        return {
          answer: `Error: ${result.error}`,
          error: result.error,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Format results
      const steps = Array.from(result.stepResults.entries()).map(([varName, res]) => ({
        variable: varName,
        success: res.success,
        count: res.count,
        sources: res.sources,
      }));

      return {
        answer: result.finalAnswer || 'No answer generated',
        intent: result.intent,
        plan: result.plan,
        steps,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error('❌ Agent query error:', error);
      return {
        answer: `Agent error: ${error.message}`,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export const enhancedLangGraphAgent = new EnhancedLangGraphAgent();

// src/services/agentic/EnhancedQueryPlanner.ts

import { openRouterService } from '../../utils/OpenRouterService';
import { QueryIntent } from './EnhancedIntentClassifier';
import { AgentContext } from './AgentContext';
import { SCHEMA_REGISTRY, validateFilter } from './SchemaRegistry';

export interface QueryPlan {
  steps: QueryStep[];
  expectedOutput: string;
  requiresSynthesis: boolean;
  fallbackStrategy?: FallbackStrategy;
}

export interface QueryStep {
  stepNumber: number;
  tool: string;
  toolInput: Record<string, any>;
  description: string;
  dependsOn?: number[];
  outputVariable?: string; // NEW: variable name to store results
}

export interface FallbackStrategy {
  primarySource: string;
  fallbackSources: string[];
  fields: string[];
}

export class EnhancedQueryPlanner {
  private systemPrompt = `You are a query planning system for a user-scoped RAG database.

**CRITICAL RULES:**
1. ALL queries are automatically scoped to the authenticated user's data via sessionId/icpModelId
2. Use correct field names from schema (e.g., 'annualRevenue' not 'revenue', 'employeeCount' not 'employees')
3. For missing fields, use 'multi_source_query' or 'enhanced_json_path' tools
4. Break complex queries into logical steps with clear dependencies
5. Use outputVariable to chain step results

### AVAILABLE TOOLS ###

**smart_query** - Intelligent query with automatic fallback
- Use for: Finding documents with optional data augmentation
- Input: { collection, filter, projection?, populate?, limit?, sort?, enableFallback? }
- Automatically merges user context filters
- enableFallback: true applies fallback data from enrichments/intelligence

**smart_aggregation** - User-scoped aggregation
- Use for: Statistics, grouping, counting (automatically scoped to user)
- Input: { collection, pipeline, options? }
- Pipeline is automatically prepended with user scope $match

**enhanced_json_path** - Extract from enrichment JSON
- Use for: Deep enrichment fields not in company schema
- Input: { companyId, jsonPath }
- Examples: "$.data.active_job_postings_count", "$.data.funding_rounds[0].amount"

**multi_source_query** - Query with intelligent fallback
- Use for: Ensuring data completeness across sources
- Input: { entity: 'company'|'employee', entityId, fields: string[] }
- Automatically queries: companies → enrichments → gtm_intelligence (for companies)
- Or: employees → enrichments → gtm_persona_intelligence (for employees)

### SCHEMA REFERENCE ###

**companies**: name, domain, description, industry[], employeeCount, annualRevenue, totalFunding, fundingStage, technologies[], linkedinUrl, foundedYear, headquarters

**employees**: fullName, firstName, lastName, headline, activeExperienceTitle, activeExperienceDepartment, isDecisionMaker, locationCountry, locationCity, primaryProfessionalEmail, linkedinUrl, connectionsCount, inferredSkills[], totalExperienceDurationMonths, educationDegrees[]

**enrichments.data** (use enhanced_json_path): 
- employees_count, employees_count_change
- revenue_annual.source_5_annual_revenue.annual_revenue
- last_funding_round_name, last_funding_round_amount_raised, funding_rounds[]
- technologies_used[].name
- active_job_postings[], active_job_postings_count
- key_executives[], key_executive_arrivals[], key_executive_departures[]
- total_website_visits_monthly, visits_change_monthly
- employee_reviews_score_aggregated, product_reviews_aggregate_score

**gtm_intelligence**: overview (markdown text with strategic analysis)
**gtm_persona_intelligence**: overview (markdown text with persona insights)

### PLANNING STRATEGY ###

**For simple queries** (e.g., "companies in fintech"):
Step 1: smart_query with filter

**For queries needing enrichment data** (e.g., "companies with Series A funding"):
Option A (if just filtering): smart_query with enableFallback: true
Option B (if extracting specific fields): 
  Step 1: smart_query to find companies
  Step 2: For each company, multi_source_query or enhanced_json_path

**For joins** (e.g., "CTOs at Series A companies"):
Step 1: smart_query companies with fundingStage filter, enableFallback: true
Step 2: smart_query employees with companyId: { $in: step1Results } AND activeExperienceTitle filter

**For aggregations** (e.g., "average revenue by industry"):
Step 1: smart_aggregation with $group pipeline

**For complex multi-step** (e.g., "decision makers at high-growth companies"):
Step 1: smart_query companies with growth criteria (may use enrichment)
Step 2: smart_query employees where companyId in step1 AND isDecisionMaker: true
Step 3: Optionally smart_aggregation to count/group

### OUTPUT FORMAT ###

Return ONLY valid JSON:
{
  "steps": [
    {
      "stepNumber": 1,
      "tool": "smart_query",
      "toolInput": { 
        "collection": "companies",
        "filter": { "industry": { "$in": ["Financial Services", "Fintech"] } },
        "enableFallback": true,
        "limit": 50
      },
      "description": "Find fintech companies with fallback to enrichment data",
      "outputVariable": "fintechCompanies"
    },
    {
      "stepNumber": 2,
      "tool": "smart_query",
      "toolInput": {
        "collection": "employees",
        "filter": { 
          "companyId": { "$in": "{{fintechCompanies._id}}" },
          "isDecisionMaker": true
        },
        "limit": 100
      },
      "description": "Find decision makers at fintech companies",
      "dependsOn": [1]
    }
  ],
  "expectedOutput": "List of decision makers at fintech companies",
  "requiresSynthesis": true,
  "fallbackStrategy": {
    "primarySource": "companies",
    "fallbackSources": ["enrichments"],
    "fields": ["fundingStage", "totalFunding"]
  }
}

**CRITICAL:**
- Always use correct field names from schema
- Use outputVariable for step chaining
- Set enableFallback: true when query might need enrichment/intelligence data
- For MongoDB operators, use proper syntax: { "$in": [...] }, { "$gte": value }
- dependsOn must reference earlier step numbers`;

  constructor(private context: AgentContext) {}

  async createPlan(query: string, intent: QueryIntent): Promise<QueryPlan> {
    try {
      const contextPrompt = `
User Query: "${query}"

Intent Analysis:
- Category: ${intent.category}
- Complexity: ${intent.complexity}
- Collections: ${intent.collections.join(', ')}
- Requires Join: ${intent.requiresJoin}
- Requires Aggregation: ${intent.requiresAggregation}
- Requires Fallback: ${intent.requiresFallback}
- Primary Entity: ${intent.primaryEntity}
- Suggested Fields: ${intent.suggestedFields?.join(', ') || 'none'}

User Context (automatically applied):
- User ID: ${this.context.userId}
- Session: ${this.context.sessionId?.toString() || 'all'}
- ICP Model: ${this.context.icpModelId?.toString() || 'all'}

Create an execution plan. Remember: all queries are automatically user-scoped.`;

      const plan = await openRouterService.generateJSON<QueryPlan>(
        contextPrompt,
        this.systemPrompt,
        'anthropic/claude-3.5-sonnet',
        4096
      );

      // Validate and enhance plan
      plan.steps = plan.steps.map((step, index) => ({
        stepNumber: step.stepNumber ?? index + 1,
        tool: step.tool ?? 'smart_query',
        toolInput: step.toolInput ?? {},
        description: step.description ?? 'No description provided',
        dependsOn: step.dependsOn ?? [],
        outputVariable: step.outputVariable ?? `step${index + 1}Result`
      }));

      return plan;
    } catch (error: any) {
      console.error('Query planning failed:', error);
      throw new Error(`Failed to create query plan: ${error.message}`);
    }
  }

  validatePlan(plan: QueryPlan): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!plan.steps || plan.steps.length === 0) {
      errors.push('Plan must have at least one step.');
      return { valid: false, errors, warnings };
    }

    const stepNumbers = new Set(plan.steps.map(s => s.stepNumber));
    const validTools = ['smart_query', 'smart_aggregation', 'enhanced_json_path', 'multi_source_query'];

    for (const step of plan.steps) {
      // Validate tool names
      if (!validTools.includes(step.tool)) {
        errors.push(`Invalid tool name: ${step.tool} in step ${step.stepNumber}.`);
      }

      // Validate dependencies
      for (const dep of step.dependsOn || []) {
        if (!stepNumbers.has(dep)) {
          errors.push(`Step ${step.stepNumber} depends on non-existent step ${dep}.`);
        }
        if (dep >= step.stepNumber) {
          errors.push(`Step ${step.stepNumber} cannot depend on a later/same step ${dep}.`);
        }
      }

      // Validate toolInput is an object
      if (!step.toolInput || typeof step.toolInput !== 'object') {
        errors.push(`toolInput must be an object in step ${step.stepNumber}.`);
        continue;
      }

      // Validate collection-specific inputs
      if (step.tool === 'smart_query' || step.tool === 'smart_aggregation') {
        const collection = step.toolInput.collection;
        if (!collection) {
          errors.push(`Step ${step.stepNumber}: collection is required for ${step.tool}.`);
          continue;
        }

        if (!SCHEMA_REGISTRY[collection]) {
          errors.push(`Step ${step.stepNumber}: Unknown collection '${collection}'.`);
          continue;
        }

        // Validate filters
        if (step.toolInput.filter) {
          const validation = validateFilter(collection, step.toolInput.filter);
          errors.push(...validation.errors.map(e => `Step ${step.stepNumber}: ${e}`));
          warnings.push(...validation.warnings.map(w => `Step ${step.stepNumber}: ${w}`));
        }
      }

      // Validate JSON path
      if (step.tool === 'enhanced_json_path') {
        if (!step.toolInput.companyId) {
          errors.push(`Step ${step.stepNumber}: companyId is required for enhanced_json_path.`);
        }
        if (!step.toolInput.jsonPath) {
          errors.push(`Step ${step.stepNumber}: jsonPath is required for enhanced_json_path.`);
        }
      }

      // Validate multi_source_query
      if (step.tool === 'multi_source_query') {
        if (!step.toolInput.entity || !['company', 'employee'].includes(step.toolInput.entity)) {
          errors.push(`Step ${step.stepNumber}: entity must be 'company' or 'employee'.`);
        }
        if (!step.toolInput.entityId) {
          errors.push(`Step ${step.stepNumber}: entityId is required.`);
        }
        if (!step.toolInput.fields || !Array.isArray(step.toolInput.fields)) {
          errors.push(`Step ${step.stepNumber}: fields must be an array.`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}


// src/services/agentic/SchemaRegistry.ts

/**
 * Complete schema registry with field paths and fallback sources
 */
export interface FieldDefinition {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
    arrayType?: string;
    fallbackSources?: Array<{
      collection: string;
      path: string;
    }>;
  }
  
  export interface CollectionSchema {
    name: string;
    fields: FieldDefinition[];
    textSearchFields?: string[];
    fallbackCollections?: string[];
  }
  
  /**
   * Central schema registry with fallback definitions
   */
  export const SCHEMA_REGISTRY: Record<string, CollectionSchema> = {
    companies: {
      name: 'companies',
      fields: [
        { name: '_id', type: 'object' },
        { name: 'sessionId', type: 'object' },
        { name: 'icpModelId', type: 'object' },
        { name: 'name', type: 'string' },
        { name: 'domain', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'industry', type: 'array', arrayType: 'string' },
        { name: 'employeeCount', type: 'number', fallbackSources: [
          { collection: 'enrichments', path: '$.data.employees_count' },
          { collection: 'enrichments', path: '$.data.size_range' }
        ]},
        { name: 'annualRevenue', type: 'number', fallbackSources: [
          { collection: 'enrichments', path: '$.data.revenue_annual.source_5_annual_revenue.annual_revenue' },
          { collection: 'enrichments', path: '$.data.revenue_annual_range' }
        ]},
        { name: 'totalFunding', type: 'number', fallbackSources: [
          { collection: 'enrichments', path: '$.data.last_funding_round_amount_raised' }
        ]},
        { name: 'fundingStage', type: 'string', fallbackSources: [
          { collection: 'enrichments', path: '$.data.last_funding_round_name' }
        ]},
        { name: 'technologies', type: 'array', arrayType: 'string', fallbackSources: [
          { collection: 'enrichments', path: '$.data.technologies_used' }
        ]},
        { name: 'linkedinUrl', type: 'string', fallbackSources: [
          { collection: 'enrichments', path: '$.data.linkedin_url' }
        ]},
        { name: 'foundedYear', type: 'string', fallbackSources: [
          { collection: 'enrichments', path: '$.data.founded_year' }
        ]},
        { name: 'headquarters', type: 'object', fallbackSources: [
          { collection: 'enrichments', path: '$.data.hq_full_address' }
        ]},
        { name: 'createdAt', type: 'date' },
        { name: 'updatedAt', type: 'date' },
      ],
      textSearchFields: ['name', 'description', 'domain'],
      fallbackCollections: ['enrichments', 'gtm_intelligence'],
    },
  
    employees: {
      name: 'employees',
      fields: [
        { name: '_id', type: 'object' },
        { name: 'companyId', type: 'object' },
        { name: 'sessionId', type: 'object' },
        { name: 'icpModelId', type: 'object' },
        { name: 'fullName', type: 'string' },
        { name: 'firstName', type: 'string' },
        { name: 'lastName', type: 'string' },
        { name: 'headline', type: 'string' },
        { name: 'activeExperienceTitle', type: 'string' },
        { name: 'activeExperienceDepartment', type: 'string' },
        { name: 'isDecisionMaker', type: 'boolean' },
        { name: 'locationCountry', type: 'string' },
        { name: 'locationCity', type: 'string' },
        { name: 'primaryProfessionalEmail', type: 'string' },
        { name: 'linkedinUrl', type: 'string' },
        { name: 'connectionsCount', type: 'number' },
        { name: 'inferredSkills', type: 'array', arrayType: 'string' },
        { name: 'totalExperienceDurationMonths', type: 'number' },
        { name: 'educationDegrees', type: 'array', arrayType: 'string' },
        { name: 'createdAt', type: 'date' },
        { name: 'updatedAt', type: 'date' },
      ],
      textSearchFields: ['fullName', 'headline', 'activeExperienceTitle'],
      fallbackCollections: ['gtm_persona_intelligence'],
    },
  
    enrichments: {
      name: 'enrichments',
      fields: [
        { name: '_id', type: 'object' },
        { name: 'companyId', type: 'object' },
        { name: 'sessionId', type: 'object' },
        { name: 'icpModelId', type: 'object' },
        { name: 'data', type: 'object' },
        { name: 'source', type: 'string' },
        { name: 'createdAt', type: 'date' },
        { name: 'updatedAt', type: 'date' },
      ],
    },
  
    gtm_intelligence: {
      name: 'gtm_intelligence',
      fields: [
        { name: '_id', type: 'object' },
        { name: 'sessionId', type: 'object' },
        { name: 'icpModelId', type: 'object' },
        { name: 'companyId', type: 'object' },
        { name: 'overview', type: 'string' },
        { name: 'createdAt', type: 'date' },
        { name: 'updatedAt', type: 'date' },
      ],
      textSearchFields: ['overview'],
    },
  
    gtm_persona_intelligence: {
      name: 'gtm_persona_intelligence',
      fields: [
        { name: '_id', type: 'object' },
        { name: 'sessionId', type: 'object' },
        { name: 'icpModelId', type: 'object' },
        { name: 'companyId', type: 'object' },
        { name: 'employeeId', type: 'object' },
        { name: 'overview', type: 'string' },
        { name: 'createdAt', type: 'date' },
        { name: 'updatedAt', type: 'date' },
      ],
      textSearchFields: ['overview'],
    },
  };
  
  /**
   * Validate if a field exists in a collection
   */
  export function isValidField(collection: string, field: string): boolean {
    const schema = SCHEMA_REGISTRY[collection];
    if (!schema) return false;
    
    return schema.fields.some(f => f.name === field);
  }
  
  /**
   * Get fallback sources for a field
   */
  export function getFallbackSources(
    collection: string,
    field: string
  ): Array<{ collection: string; path: string }> {
    const schema = SCHEMA_REGISTRY[collection];
    if (!schema) return [];
    
    const fieldDef = schema.fields.find(f => f.name === field);
    return fieldDef?.fallbackSources || [];
  }
  
  /**
   * Get all text search fields for a collection
   */
  export function getTextSearchFields(collection: string): string[] {
    return SCHEMA_REGISTRY[collection]?.textSearchFields || [];
  }
  
  /**
   * Validate filter object against schema
   */
  export function validateFilter(
    collection: string,
    filter: Record<string, any>
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const schema = SCHEMA_REGISTRY[collection];
  
    if (!schema) {
      errors.push(`Unknown collection: ${collection}`);
      return { valid: false, errors, warnings };
    }
  
    function checkFields(obj: Record<string, any>, path = '') {
      Object.keys(obj).forEach(key => {
        // Skip MongoDB operators
        if (key.startsWith('$')) {
          if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            checkFields(obj[key], path);
          } else if (Array.isArray(obj[key])) {
            obj[key].forEach((item: any) => {
              if (typeof item === 'object') {
                checkFields(item, path);
              }
            });
          }
          return;
        }
  
        const fullPath = path ? `${path}.${key}` : key;
        
        if (!isValidField(collection, key)) {
          const fallbacks = getFallbackSources(collection, key);
          if (fallbacks.length > 0) {
            warnings.push(
              `Field '${key}' not in ${collection} schema, but available in: ${fallbacks.map(f => f.collection).join(', ')}`
            );
          } else {
            errors.push(`Unknown field '${key}' in ${collection}`);
          }
        }
  
        // Recursive check for nested objects
        if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && obj[key] !== null) {
          checkFields(obj[key], fullPath);
        }
      });
    }
  
    checkFields(filter);
  
    return { valid: errors.length === 0, errors, warnings };
  }

  // src/services/VectorSearchService.ts
  
  import { Company } from "../../models/Company";
  import { OpenAI } from 'openai';
  
  interface VectorSearchResult {
    _id: string;
    name: string;
    description?: string;
    industry: string[];
    score: number;
    [key: string]: any;
  }
  
  /**
   * Vector Search Service for semantic similarity searches
   * This is a simplified implementation - you'd want to use a proper vector database
   * like MongoDB Atlas Vector Search, Pinecone, or Weaviate in production
   */
  export class VectorSearchService {
    private openai: OpenAI;
    
    constructor() {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  
    async generateEmbedding(text: string): Promise<number[]> {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: text,
        dimensions: 1536 // or 3072 for higher accuracy
      });
      
      return response.data[0].embedding;
    }
    /**
     * Semantic search using MongoDB text search (fallback)
     * In production, implement proper vector search
     */
    async semanticSearch(
      query: string,
      limit: number = 10,
      filter?: any
    ): Promise<VectorSearchResult[]> {
      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);
      
      // MongoDB Atlas Vector Search
      const pipeline: any[] = [
        {
          $vectorSearch: {
            index: 'company_embeddings_index',
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: limit * 10,
            limit: limit
          }
        },
        {
          $addFields: {
            score: { $meta: 'vectorSearchScore' }
          }
        }
      ];
      
      if (filter) {
        pipeline.push({ $match: filter });
      }
      
      const results = await Company.aggregate(pipeline);
      return results;
    }
  }
  
    /**
     * Find similar companies to a given company
     */
    async findSimilarCompanies(
      companyId: string,
      limit: number = 5
    ): Promise<VectorSearchResult[]> {
      try {
        const company = await Company.findById(companyId).lean();
        
        if (!company) {
          throw new Error('Company not found');
        }
  
        // Build similarity query based on company attributes
        const query: any = {
          _id: { $ne: companyId },
        };
  
        // Match on industry
        if (company.industry && company.industry.length > 0) {
          query.industry = { $in: company.industry };
        }
  
        // Match on similar employee count (within 2x range)
        if (company.employeeCount) {
          query.employeeCount = {
            $gte: Math.floor(company.employeeCount / 2),
            $lte: company.employeeCount * 2,
          };
        }
  
        // Match on similar funding stage
        if (company.fundingStage) {
          query.fundingStage = company.fundingStage;
        }
  
        const results = await Company.find(query)
          .limit(limit)
          .lean();
  
        return results.map(doc => ({
          _id: doc._id.toString(),
          name: doc.name,
          description: doc.description,
          industry: doc.industry,
          score: 1,
          ...doc,
        }));
      } catch (error: any) {
        console.error('Find similar companies error:', error);
        throw error;
      }
    }
  }
  
  export const vectorSearchService = new VectorSearchService();

now my database schema has documents (companies employees,enrichements,gtmlintelligence,gtmpersonaintelligence,ICPModel,Session)
here is the schemas details :

// src/models/GTMIntelligence.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IGTMIntelligence extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId: Types.ObjectId;
  companyId: Types.ObjectId;
  
  // Text-based analysis fields
  overview: string;
 
  createdAt: Date;
  updatedAt: Date;
}

const GTMIntelligenceSchema = new Schema<IGTMIntelligence>(
  {
    sessionId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Session', 
      required: true, 
      index: true 
    },
    icpModelId: { 
      type: Schema.Types.ObjectId, 
      ref: 'ICPModel', 
      required: true, 
      index: true 
    },
    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Company', 
      required: true, 
      index: true 
    },
    
    // Text-based markdown text analysis fields has analyst of a companies
    overview: { 
      type: String, 
      required: true 
    },
  },
  { 
    timestamps: true,
    collection: 'gtm_intelligence'
  }
);

// src/models/GTMIntelligence.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface GTMPersonaIntelligence extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId: Types.ObjectId;
  companyId: Types.ObjectId;
  employeeId: Types.ObjectId;
  overview: string;
  createdAt: Date;
  updatedAt: Date;
}

const GTMPersonaIntelligenceSchema= new Schema<GTMPersonaIntelligence>(
  {
    sessionId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Session', 
      required: true, 
      index: true 
    },
    icpModelId: { 
      type: Schema.Types.ObjectId, 
      ref: 'ICPModel', 
      required: true, 
      index: true 
    },
    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Company', 
      required: true, 
      index: true 
    },
    employeeId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Employee', 
      required: true, 
      index: true 
    },
    
    // Text-based analysis fields
    overview: { 
      type: String, 
      required: true 
    },
},
  { 
    timestamps: true,
    collection: 'gtm_persona_intelligence'
  }
);

// Indexes for efficient querying
GTMPersonaIntelligenceSchema.index({ sessionId: 1, employeeId: 1, companyId: 1 }, { unique: true });


// Text based markdown text for employees analysis
GTMPersonaIntelligenceSchema.index({
  overview: 'text'
});

// Virtual for easy access to company data
GTMPersonaIntelligenceSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for easy access to ICP model
GTMPersonaIntelligenceSchema.virtual('icpModel', {
  ref: 'ICPModel',
  localField: 'icpModelId',
  foreignField: '_id',
  justOne: true
});

export const GTMPersonaIntelligence = mongoose.model<GTMPersonaIntelligence>('GTMPersonaIntelligence', GTMPersonaIntelligenceSchema);
// Indexes for efficient querying
GTMIntelligenceSchema.index({ sessionId: 1, companyId: 1 }, { unique: true });
GTMIntelligenceSchema.index({ icpModelId: 1, icpFitScore: -1 });
GTMIntelligenceSchema.index({ refreshStatus: 1 });
GTMIntelligenceSchema.index({ lastRefreshed: -1 });

// Text search index for analysis fields
GTMIntelligenceSchema.index({
  overview: 'text',
  employeeAnalysis: 'text',
  financialAnalysis: 'text',
  technologyAnalysis: 'text',
  competitorAnalysis: 'text',
  recommendations: 'text'
});

// Virtual for easy access to company data
GTMIntelligenceSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for easy access to ICP model
GTMIntelligenceSchema.virtual('icpModel', {
  ref: 'ICPModel',
  localField: 'icpModelId',
  foreignField: '_id',
  justOne: true
});

export const GTMIntelligence = mongoose.model<IGTMIntelligence>('GTMIntelligence', GTMIntelligenceSchema);

the employee schema in database schema is :
{
  "_id": "MongoDB ObjectId - Unique database identifier for this employee record",
  "companyId": "MongoDB ObjectId - Reference ID linking to the associated company in your database",
  "coresignalEmployeeId": "integer - CoreSignal's unique numeric identifier for this employee profile",
  
  // ===== ADDED: CoreSignal Metadata Fields =====
  "coresignalCreatedAt": "Date - When CoreSignal created this employee record",
  "coresignalUpdatedAt": "Date - When CoreSignal last updated this record",
  "coresignalCheckedAt": "Date - When CoreSignal last partially checked this record",
  "coresignalChangedAt": "Date - When this record was last changed in CoreSignal",
  "experienceChangeLastIdentifiedAt": "Date - When employee experience change was last identified",
  "isParent": "boolean - True if this is the main employee profile (1=parent, 0=not parent)",
  "historicalIds": "array[integer] - Historical CoreSignal IDs related to the same profile after URL changes",
  
  // ===== Existing Fields =====
  "parentId": "integer - Parent profile ID (253163588 in example - indicates this is likely the main profile)",
  "isDeleted": "boolean - False means this employee profile is active and not deleted",
  "publicProfileId": "integer - LinkedIn's public profile ID number (99049691)",
  "linkedinUrl": "string - The complete LinkedIn profile URL for this employee",
  "linkedinShorthandNames": "array[string] - Alternative URL slugs/shortnames for this LinkedIn profile (jvipin, vipin-jain-50b20829)",
  
  // ===== ADDED: Name Component Fields =====
  "firstNameInitial": "string - First name initial (parsed from first_name)",
  "middleName": "string - Employee's middle name (parsed from full_name)",
  "middleNameInitial": "string - Middle name initial (parsed from middle_name)",
  "lastNameInitial": "string - Last name initial (parsed from last_name)",
  
  // ===== Existing Fields =====
  "fullName": "string - Employee's complete name (Vipin Jain)",
  "firstName": "string - First name only (Vipin)",
  "lastName": "string - Last name only (Jain)",
  "headline": "string - Professional headline/title from LinkedIn (CEO at Konstant Infosolutions Pvt. Ltd.)",
  "summary": "string or null - Detailed professional bio/description (null means not available)",
  "pictureUrl": "string - URL to the employee's LinkedIn profile photo",
  
  // ===== ADDED: Enhanced Location Fields =====
  "locationState": "string - Employee location state/province",
  "locationCountryIso2": "string - ISO 2-letter country code (e.g., 'US')",
  "locationCountryIso3": "string - ISO 3-letter country code (e.g., 'USA')",
  "locationRegions": "array[string] - Associated geographical regions (Americas, Northern America, AMER)",
  
  // ===== Existing Location Fields =====
  "locationCountry": "string - Country where employee is located (United States)",
  "locationCity": "string - City where employee is located (New York)",
  "locationFull": "string - Complete location string (New York, New York, United States)",
  
  // ===== Existing Social Fields =====
  "connectionsCount": "integer - Number of LinkedIn connections (500+ connections)",
  "followersCount": "integer - Number of LinkedIn followers (772 followers)",
  
  // ===== ADDED: Professional Services Field =====
  "services": "string - Professional services offered by the employee",
  
  // ===== Existing Employment Fields =====
  "isWorking": "boolean - True indicates currently employed",
  
  // ===== ADDED: Enhanced Experience Fields =====
  "activeExperienceDescription": "string - Detailed description of current position",
  "activeExperienceManagementLevel": "string - Management level (C-Level, Senior, Manager, etc.)",
  
  // ===== Existing Experience Fields =====
  "activeExperienceTitle": "string - Current job title (CEO)",
  "activeExperienceCompanyId": "integer - CoreSignal ID for current employer company (6703633 = Konstant Infosolutions)",
  "activeExperienceDepartment": "string - Current department/role category (C-Suite = executive leadership)",
  "isDecisionMaker": "boolean - True indicates this person has decision-making authority",
  
  // ===== ADDED: Email Verification Field =====
  "primaryProfessionalEmailStatus": "string - Email confidence level: 'verified', 'matched_email', 'matched_pattern', 'guessed_common_pattern'",
  
  // ===== Existing Contact Fields =====
  "primaryProfessionalEmail": "string - Primary work email address (vipin@konstantinfo.com)",
  "professionalEmails": "array[object] - Collection of professional emails with status and priority",
  
  // ===== Existing Skills & Interests =====
  "interests": "array[string] - Employee's interests listed on LinkedIn",
  "inferredSkills": "array[string] - Skills automatically detected from profile (marketing, management, administration, etc.)",
  "historicalSkills": "array[string] - Historical/superseded skills",
  
  // ===== ADDED: Recent Experience Changes =====
  "experienceRecentlyStarted": "array[object] - Recently started positions with identification dates",
  "experienceRecentlyClosed": "array[object] - Recently ended positions with identification dates",
  
  // ===== Existing Experience Data =====
  "totalExperienceDurationMonths": "integer - Total career experience in months (286 months ≈ 23.8 years)",
  "experienceDepartmentBreakdown": "array[object] - Experience duration by department",
  "experienceManagementBreakdown": "array[object] - Experience duration by management level",
  "experienceHistory": "array[object] - Complete work experience timeline",
  
  // ===== ADDED: Company Details (Nested Object) =====
  "currentCompany": {
      "company_id": "integer - CoreSignal company ID",
      "company_name": "string - Company name",
      "company_type": "string - Company legal type",
      "company_founded_year": "string - Year company was founded",
      "company_size_range": "string - Employee count range",
      "company_employees_count": "integer - Number of LinkedIn employees",
      "company_categories_and_keywords": "array[string] - Business categories and keywords",
      "company_industry": "string - Primary industry",
      "company_is_b2b": "integer - 1=B2B company, 0=B2C company",
      "company_followers_count": "integer - LinkedIn company followers",
      "company_website": "string - Company website URL",
      "company_linkedin_url": "string - Company LinkedIn URL",
      "company_annual_revenue_source_1": "number - Revenue from source 1",
      "company_annual_revenue_currency_source_1": "string - Revenue currency",
      "company_hq_full_address": "string - Company headquarters address",
      "company_hq_country": "string - HQ country",
      "company_hq_city": "string - HQ city",
      "company_hq_state": "string - HQ state"
  },
  
  // ===== ADDED: Education Enhancement =====
  "lastGraduationDate": "string - Most recent graduation date",
  
  // ===== Existing Education Fields =====
  "educationDegrees": "array[string] - Education degrees listed",
  "educationHistory": "array[object] - Detailed education records",
  
  // ===== ADDED: Salary Projection Fields =====
  "projectedBaseSalary": {
      "p25": "number - 25th percentile base salary",
      "median": "number - Median base salary",
      "p75": "number - 75th percentile base salary",
      "period": "string - Pay period (ANNUAL, MONTHLY, etc.)",
      "currency": "string - Salary currency",
      "updated_at": "string - When salary data was last updated"
  },
  "projectedAdditionalSalary": "array[object] - Additional compensation (bonuses, stock, etc.)",
  "projectedTotalSalary": {
      "p25": "number - 25th percentile total compensation",
      "median": "number - Median total compensation",
      "p75": "number - 75th percentile total compensation",
      "period": "string - Pay period",
      "currency": "string - Currency",
      "updated_at": "string - Last update date"
  },
  
  // ===== ADDED: Profile Change Tracking =====
  "profileRootFieldChangesSummary": "array[object] - Field-level change history",
  "profileCollectionFieldChangesSummary": "array[object] - Collection field change history",
  
  // ===== Existing Profile Content Fields =====
  "languages": "array[object] - Language proficiency information",
  "githubUrl": "string - GitHub profile URL",
  "githubUsername": "string - GitHub username (jvipin)",
  "recommendationsCount": "integer - Number of LinkedIn recommendations",
  "recommendations": "array[object] - Recommendation texts and details",
  "activities": "array[object] - LinkedIn posts and activities",
  "awards": "array[object] - Professional awards and recognitions",
  "certifications": "array[object] - Professional certifications and partnerships",
  
  // ===== ADDED: Additional Profile Sections =====
  "courses": "array[object] - Professional courses completed",
  "patents": "array[object] - Patents authored by employee",
  "publications": "array[object] - Publications authored by employee",
  "projects": "array[object] - Professional projects",
  "organizations": "array[object] - Professional organization memberships",
  
  // ===== Database Management Fields =====
  "createdAt": "Date - When this record was created in your database (2025-12-17)",
  "updatedAt": "Date - When this record was last updated in your database (2025-12-17)",
  "__v": "integer - Mongoose version key for document versioning (0 = initial version)"
}


// src/models/Enrichment.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEnrichment extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId?: Types.ObjectId;
  data: Record<string, any>;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const EnrichmentSchema = new Schema<IEnrichment>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    icpModelId: { type: Schema.Types.ObjectId, ref: 'ICPModel', index: true },
    data: { type: Schema.Types.Mixed, required: true },
    source: { type: String, required: true }
  },
  { 
    timestamps: true,
    collection: 'enrichments'
  }
);

// Indexes
EnrichmentSchema.index({ companyId: 1, source: 1 });
EnrichmentSchema.index({ sessionId: 1 });

export const Enrichment = mongoose.model<IEnrichment>('Enrichment', EnrichmentSchema);


and enrichements model in  database has field data this field contains coresignal response json here is the schema of this field:

  "data": {
    "id": "integer - Primary identifier",
    "source_id": "string - LinkedIn company ID",
    "company_name": "string - Business name",
    "company_name_alias": "array[string] - Alternative names",
    "company_legal_name": "string or null - Registered legal name",
    "created_at": "string (YYYY-MM-DD) - Record creation date",
    "last_updated_at": "string (YYYY-MM-DD) - Last update date",
    "website": "string - Primary website URL",
    "website_alias": "array[string] - Alternative website URLs",
    "unique_website": "boolean - Website uniqueness flag",
    "unique_domain": "boolean - Domain uniqueness flag",
    "expired_domain": "boolean - Domain expiration status",
    "linkedin_url": "string - LinkedIn profile URL",
    "facebook_url": "array[string] - Facebook URLs",
    "twitter_url": "array[string] - Twitter URLs",
    "crunchbase_url": "string or null - Crunchbase URL",
    "instagram_url": "array[string] - Instagram URLs",
    "youtube_url": "array[string] - YouTube URLs",
    "github_url": "array[string] - GitHub URLs",
    "reddit_url": "array[string] - Reddit URLs",
    "discord_url": "array[string] - Discord URLs",
    "pinterest_url": "array[string] - Pinterest URLs",
    "tiktok_url": "array[string] - TikTok URLs",
    "company_logo": "string - Base64 encoded logo",
    "company_logo_url": "string - Logo image URL",
    "stock_ticker": "array[object] - Stock ticker information",
    "is_b2b": "integer or null - B2B flag (1=B2B, 0=B2C)",
    "is_public": "boolean - Public company status",
    "description": "string - Company description",
    "description_enriched": "string or null - Enhanced description",
    "description_metadata_raw": "string or null - Raw description",
    "sic_codes": "array[string] - Industry classification codes",
    "naics_codes": "array[string] - NAICS industry codes",
    "industry": "string - Industry category",
    "categories_and_keywords": "array[string] - Business tags",
    "type": "string - Company type",
    "status": {
      "value": "string - Status value",
      "comment": "string - Status description"
    },
    "founded_year": "string - Year founded",
    "size_range": "string - Employee size category",
    "employees_count": "integer - Employee count",
    "followers_count_linkedin": "integer - LinkedIn followers",
    "followers_count_twitter": "integer or null - Twitter followers",
    "followers_count_owler": "integer - Owler followers",
    "hq_region": "array[string] - Headquarters region",
    "hq_country": "string - Headquarters country",
    "hq_country_iso2": "string - ISO 2-letter country code",
    "hq_country_iso3": "string - ISO 3-letter country code",
    "hq_location": "string - Headquarters location",
    "hq_full_address": "string - Full HQ address",
    "hq_city": "string - HQ city",
    "hq_state": "string - HQ state",
    "hq_street": "string - HQ street address",
    "hq_zipcode": "string - HQ zip code",
    "company_locations_full": "array[object] - All company locations",
    "company_updates": "array[object] - Social media posts",
    "num_technologies_used": "integer or null - Tech stack count",
    "technologies_used": "array[object] - Technologies list",
    "ipo_date": "string or null - IPO date",
    "ipo_share_price": "integer or null - IPO price",
    "ipo_share_price_currency": "string or null - IPO currency",
    "stock_information": "array[object] - Stock data",
    "revenue_annual_range": "object or null - Revenue range",
    "revenue_annual": {
      "source_5_annual_revenue": {
        "annual_revenue": "integer",
        "annual_revenue_currency": "string"
      },
      "source_1_annual_revenue": "object or null"
    },
    "revenue_quarterly": "object or null - Quarterly revenue",
    "income_statements": "array[object] - Financial statements",
    "last_funding_round_name": "string or null - Latest funding round",
    "last_funding_round_announced_date": "string or null - Funding date",
    "last_funding_round_lead_investors": "array[string] - Lead investors",
    "last_funding_round_amount_raised": "integer or null - Funding amount",
    "last_funding_round_amount_raised_currency": "string or null - Funding currency",
    "last_funding_round_num_investors": "integer or null - Investor count",
    "funding_rounds": "array[object] - All funding rounds",
    "ownership_status": "string - Ownership type",
    "parent_company_information": "object or null - Parent company",
    "acquired_by_summary": {
      "acquirer_name": "string or null",
      "announced_date": "string or null",
      "price": "integer or null",
      "currency": "string"
    },
    "num_acquisitions_source_1": "integer or null - Acquisition count",
    "acquisition_list_source_1": "array[object] - Acquisitions list",
    "num_acquisitions_source_2": "integer or null - Acquisition count",
    "acquisition_list_source_2": "array[object] - Acquisitions list",
    "num_acquisitions_source_5": "integer or null - Acquisition count",
    "acquisition_list_source_5": "array[object] - Acquisitions list",
    "competitors": "array[object] - Competitor list",
    "competitors_websites": "array[object] - Competitor websites",
    "company_phone_numbers": "array[string] - Phone numbers",
    "company_emails": "array[string] - Email addresses",
    "pricing_available": "boolean or null - Pricing visibility",
    "free_trial_available": "boolean or null - Trial availability",
    "demo_available": "boolean or null - Demo availability",
    "is_downloadable": "boolean or null - Downloadable flag",
    "mobile_apps_exist": "boolean or null - Mobile app flag",
    "online_reviews_exist": "boolean or null - Reviews flag",
    "documentation_exist": "boolean or null - Documentation flag",
    "product_reviews_count": "integer or null - Review count",
    "product_reviews_aggregate_score": "float or null - Average score",
    "product_reviews_score_distribution": "object or null - Score breakdown",
    "product_pricing_summary": "array[object] - Pricing plans",
    "num_news_articles": "integer - News article count",
    "news_articles": "array[object] - News articles",
    "total_website_visits_monthly": "integer or null - Monthly visitors",
    "visits_change_monthly": "float or null - Traffic change",
    "rank_global": "integer or null - Global rank",
    "rank_country": "integer or null - Country rank",
    "rank_category": "integer or null - Category rank",
    "visits_breakdown_by_country": "array[object] - Traffic by country",
    "visits_breakdown_by_gender": "object or null - Gender breakdown",
    "visits_breakdown_by_age": "object or null - Age breakdown",
    "bounce_rate": "float or null - Bounce rate",
    "pages_per_visit": "float or null - Pages per visit",
    "average_visit_duration_seconds": "float or null - Visit duration",
    "similarly_ranked_websites": "array[string] - Similar sites",
    "top_topics": "array[string] - Website topics",
    "company_employee_reviews_count": "integer or null - Employee review count",
    "company_employee_reviews_aggregate_score": "float or null - Employee rating",
    "employee_reviews_score_breakdown": "object or null - Rating categories",
    "employee_reviews_score_distribution": "object or null - Star distribution",
    "active_job_postings_count": "integer - Active job count",
    "active_job_postings": "array[object] - Job postings",
    "active_job_postings_count_change": {
      "current": "integer",
      "change_monthly": "integer",
      "change_monthly_percentage": "float or null",
      "change_quarterly": "integer",
      "change_quarterly_percentage": "float or null",
      "change_yearly": "integer",
      "change_yearly_percentage": "float or null"
    },
    "active_job_postings_count_by_month": "array[object] - Monthly job counts",
    "linkedin_followers_count_change": {
      "current": "integer",
      "change_monthly": "integer",
      "change_monthly_percentage": "float",
      "change_quarterly": "integer",
      "change_quarterly_percentage": "float",
      "change_yearly": "integer",
      "change_yearly_percentage": "float"
    },
    "linkedin_followers_count_by_month": "array[object] - Monthly follower data",
    "base_salary": "array[object] - Salary information",
    "additional_pay": "array[object] - Additional compensation",
    "total_salary": "array[object] - Total compensation",
    "employees_count_inferred": "integer or null - Inferred employee count",
    "employees_count_inferred_by_month": "array[object] - Monthly inferred counts",
    "top_previous_companies": "array[object] - Previous employers",
    "top_next_companies": "array[object] - Next employers",
    "key_executives": "array[object] - Leadership team",
    "key_employee_change_events": "array[object] - Employee events",
    "key_executive_arrivals": "array[object] - New executives",
    "key_executive_departures": "array[object] - Departing executives",
    "employees_count_change": {
      "current": "integer",
      "change_monthly": "integer",
      "change_monthly_percentage": "float",
      "change_quarterly": "integer",
      "change_quarterly_percentage": "float",
      "change_yearly": "integer",
      "change_yearly_percentage": "float"
    },
    "employees_count_by_month": "array[object] - Monthly employee counts",
    "employees_count_breakdown_by_seniority": "object or null - Seniority breakdown",
    "employees_count_breakdown_by_seniority_by_month": "array[object] - Monthly seniority",
    "employees_count_breakdown_by_department": "object or null - Department breakdown",
    "employees_count_breakdown_by_department_by_month": "array[object] - Monthly department",
    "employees_count_breakdown_by_region": "object or null - Region breakdown",
    "employees_count_breakdown_by_region_by_month": "array[object] - Monthly region",
    "employees_count_by_country": "array[object] - Country distribution",
    "employees_count_by_country_by_month": "array[object] - Monthly country",
    "product_reviews_score_change": "object or null - Review score changes",
    "product_reviews_score_by_month": "array[object] - Monthly review scores",
    "total_website_visits_change": "object or null - Traffic changes",
    "total_website_visits_by_month": "array[object] - Monthly traffic",
    "employee_reviews_score_aggregated_change": "object or null - Aggregated rating changes",
    "employee_reviews_score_aggregated_by_month": "array[object] - Monthly aggregated ratings",
    "employee_reviews_score_business_outlook_change": "object or null - Business outlook changes",
    "employee_reviews_score_business_outlook_by_month": "array[object] - Monthly business outlook",
    "employee_reviews_score_career_opportunities_change": "object or null - Career opportunity changes",
    "employee_reviews_score_career_opportunities_by_month": "array[object] - Monthly career opportunities",
    "employee_reviews_score_ceo_approval_change": "object or null - CEO approval changes",
    "employee_reviews_score_ceo_approval_by_month": "array[object] - Monthly CEO approval",
    "employee_reviews_score_compensation_benefits_change": "object or null - Compensation changes",
    "employee_reviews_score_compensation_benefits_by_month": "array[object] - Monthly compensation",
    "employee_reviews_score_culture_values_change": "object or null - Culture changes",
    "employee_reviews_score_culture_values_by_month": "array[object] - Monthly culture",
    "employee_reviews_score_diversity_inclusion_change": "object or null - Diversity changes",
    "employee_reviews_score_diversity_inclusion_by_month": "array[object] - Monthly diversity",
    "employee_reviews_score_recommend_change": "object or null - Recommendation changes",
    "employee_reviews_score_recommend_by_month": "array[object] - Monthly recommendations",
    "employee_reviews_score_senior_management_change": "object or null - Management changes",
    "employee_reviews_score_senior_management_by_month": "array[object] - Monthly management",
    "employee_reviews_score_work_life_balance_change": "object or null - Work-life changes",
    "employee_reviews_score_work_life_balance_by_month": "array[object] - Monthly work-life",
    "requested_id": "integer - Original requested ID"
  }

  the icpmodel Schema
  // src/models/ICPModel.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IICPModel extends Document {
  _id: Types.ObjectId;
  name: string;
  isPrimary: boolean;
  userId: string;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ICPModelSchema = new Schema<IICPModel>(
  {
    name: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
    userId: { type: String, required: true, index: true },
    config: { type: Schema.Types.Mixed, required: true }
  },
  { 
    timestamps: true,
    collection: 'icp_models'
  }
);

// Index for finding primary model per user
ICPModelSchema.index({ userId: 1, isPrimary: 1 });

export const ICPModel = mongoose.model<IICPModel>('ICPModel', ICPModelSchema);


// src/models/Session.ts - Updated version
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRefinementState {
  stage: 'initial' | 'proposed' | 'refining' | 'confirmed' | 'searching';
  currentQuery?: string;
  proposalHistory?: Array<{
    query: string;
    timestamp: Date;
    userFeedback?: string;
  }>;
}

export interface ISearchStatus {
  stage: 'idle' | 'error' | 'refining-query' | 'awaiting-clarification' | 'searching' | 'analyzing' | 'filtering' | 'complete' | 'enriching' | 'scoring';
  message: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  substeps: any[];
}

export interface ISession extends Document {
  _id: Types.ObjectId;
  name: string;
  query: string[];
  resultsCount: number;
  userId: string;
  icpModelId?: Types.ObjectId;
  searchStatus: ISearchStatus;
  
  // 🔄 New fields for refinement
  refinementState: IRefinementState;
  currentProposal?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

// Define the nested schema for refinementState
const RefinementStateSchema = new Schema({
  stage: { 
    type: String, 
    enum: ['initial', 'proposed', 'refining', 'confirmed', 'searching'],
    default: 'initial' 
  },
  currentQuery: { type: String, default: '' },
  proposalHistory: {
    type: [{
      query: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      userFeedback: { type: String }
    }],
    default: []
  }
}, { _id: false });

// Define the nested schema for searchStatus (existing)
const SearchStatusSchema = new Schema({
  stage: { 
    type: String, 
    enum: ['idle', 'error', 'refining-query', 'awaiting-clarification', 'searching', 'analyzing', 'filtering', 'complete', 'enriching', 'scoring'],
    default: 'idle' 
  },
  message: { type: String, default: 'Session created' },
  progress: { type: Number, default: 0 },
  currentStep: { type: Number, default: 0 },
  totalSteps: { type: Number, default: 4 },
  substeps: { type: [Schema.Types.Mixed], default: [] }
}, { _id: false });

const SessionSchema = new Schema<ISession>(
  {
    name: { type: String, required: true },
    query: { type: [String], default: [] },
    resultsCount: { type: Number, default: 0 },
    userId: { type: String, required: true, index: true },
    icpModelId: { type: Schema.Types.ObjectId, ref: 'ICPModel', index: true },
    searchStatus: {
      type: SearchStatusSchema,
      default: () => ({
        stage: 'idle',
        message: 'Session created',
        progress: 0,
        currentStep: 0,
        totalSteps: 4,
        substeps: []
      })
    },
    
    // 🔄 New fields for refinement
    refinementState: {
      type: RefinementStateSchema,
      default: () => ({
        stage: 'initial',
        currentQuery: '',
        proposalHistory: []
      })
    },
    currentProposal: { type: String, default: '' }
  },
  { 
    timestamps: true,
    collection: 'sessions'
  }
);

// Indexes
SessionSchema.index({ userId: 1, createdAt: -1 });
SessionSchema.index({ icpModelId: 1 });

export const Session = mongoose.model<ISession>('Session', SessionSchema);



now you have comprehensive base to understand if my agentic rag performance and accurence is worked well or i should enhance it for better retreaval
