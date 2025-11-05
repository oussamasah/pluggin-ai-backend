// src/controllers/CompaniesController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { supabaseService } from '../services/SupabaseService.js';
import { Company } from '../core/types.js';

interface GetCompaniesQuery {
  // Pagination
  page?: number;
  limit?: number;
  
  // Search
  search?: string;
  
  // Filters
  icpModelId?: string;
  industry?: string;
  country?: string;
  minEmployees?: number;
  maxEmployees?: number;
  fundingStage?: string;
  businessModel?: string;
  targetMarket?: string;
  hasIntentSignals?: boolean;
  isHiring?: boolean;
  minRevenue?: number;
  maxRevenue?: number;
  minFunding?: number;
  maxFunding?: number;
  foundedAfter?: number;
  foundedBefore?: number;
  
  // Sorting
  sortBy?: 'name' | 'employee_count' | 'annual_revenue' | 'total_funding' | 'founded_year' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  
  // Technologies filter (comma-separated)
  technologies?: string;
}

interface SearchCompaniesBody {
  query: string;
  icpModelId?: string;
  filters?: {
    industries?: string[];
    countries?: string[];
    employeeRange?: { min: number; max: number };
    revenueRange?: { min: number; max: number };
    fundingRange?: { min: number; max: number };
    fundingStages?: string[];
    targetMarkets?: string[];
    technologies?: string[];
  };
}

interface MatchCompaniesBody {
  icpModelId: string;
  companies: Partial<Company>[];
}

interface CompaniesResponse {
  success: boolean;
  companies: Company[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters?: {
    availableIndustries: string[];
    availableCountries: string[];
    availableTechnologies: string[];
  };
}

interface CompanyStatsResponse {
  success: boolean;
  stats: {
    totalCompanies: number;
    byIndustry: Record<string, number>;
    byCountry: Record<string, number>;
    byEmployeeRange: Record<string, number>;
    byFundingStage: Record<string, number>;
    byTargetMarket: Record<string, number>;
    averageRevenue: number;
    averageEmployees: number;
    highIntentCount: number;
    highFitCount: number;
    recentAdditions: number;
  };
}

export async function CompaniesController(fastify: FastifyInstance) {
  // Get all companies with advanced filtering, sorting, and pagination
  fastify.get('/companies', async (
    request: FastifyRequest<{ Querystring: GetCompaniesQuery }>, 
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const {
        // Pagination
        page = 1,
        limit = 50,
        
        // Search
        search,
        
        // Filters
        icpModelId,
        industry,
        country,
        minEmployees,
        maxEmployees,
        fundingStage,
        targetMarket,
        hasIntentSignals,
        minRevenue,
        maxRevenue,
        minFunding,
        maxFunding,
        foundedAfter,
        foundedBefore,
        technologies,
        
        // Sorting
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = request.query;

      console.log('📥 Getting companies with filters:', { 
        userId, 
        page, 
        limit,
        search,
        filters: { 
          industry, 
          country, 
          minEmployees, 
          maxEmployees,
          fundingStage,
          targetMarket,
          minRevenue,
          maxRevenue,
          technologies
        },
        sortBy,
        sortOrder
      });

      // Get user's sessions to get session IDs
      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          companies: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false
          },
          filters: {
            availableIndustries: [],
            availableCountries: [],
            availableTechnologies: []
          }
        });
      }

      // Build the query
      let query = supabaseService['supabase']
        .from('companies')
        .select(`
          *,
          employees (*)
        `, { count: 'exact' })
        .in('session_id', sessionIds);

      // Apply search filter
      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,domain.ilike.%${search}%`);
      }

      // Apply ICP model filter
      if (icpModelId) {
        query = query.eq('icp_model_id', icpModelId);
      }

      // Apply industry filter
      if (industry) {
        query = query.contains('industry', [industry]);
      }

      // Apply country filter
      if (country) {
        query = query.ilike('country', `%${country}%`);
      }

      // Apply employee count filters
      if (minEmployees !== undefined) {
        query = query.gte('employee_count', minEmployees);
      }
      if (maxEmployees !== undefined) {
        query = query.lte('employee_count', maxEmployees);
      }

      // Apply revenue filters
      if (minRevenue !== undefined) {
        query = query.gte('annual_revenue', minRevenue);
      }
      if (maxRevenue !== undefined) {
        query = query.lte('annual_revenue', maxRevenue);
      }

      // Apply funding filters
      if (minFunding !== undefined) {
        query = query.gte('total_funding', minFunding);
      }
      if (maxFunding !== undefined) {
        query = query.lte('total_funding', maxFunding);
      }

      // Apply funding stage filter
      if (fundingStage) {
        query = query.eq('funding_stage', fundingStage);
      }

      // Apply target market filter
      if (targetMarket) {
        query = query.eq('target_market', targetMarket);
      }

      // Apply founded year filters
      if (foundedAfter !== undefined) {
        query = query.gte('founded_year', foundedAfter);
      }
      if (foundedBefore !== undefined) {
        query = query.lte('founded_year', foundedBefore);
      }

      // Apply technologies filter
      if (technologies) {
        const techArray = technologies.split(',').map(tech => tech.trim());
        query = query.overlaps('technologies', techArray);
      }

      // Apply intent signals filter
      if (hasIntentSignals !== undefined) {
        if (hasIntentSignals) {
          query = query.not('intent_signals', 'is', null);
        } else {
          query = query.is('intent_signals', null);
        }
      }

      // Apply sorting
      if (sortBy) {
        query = query.order(sortBy, { 
          ascending: sortOrder === 'asc',
          nullsFirst: false
        });
      }

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const { data: companies, error, count } = await query.range(startIndex, startIndex + limit - 1);

      if (error) {
        console.error('Database error:', error);
        throw error;
      }

      // Get available filters for frontend
      const availableFilters = await getAvailableFilters(sessionIds);

      console.log('📤 Companies found:', { 
        total: count || 0,
        showing: companies?.length || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      });

      const response: CompaniesResponse = {
        success: true,
        companies: companies || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
          hasNext: (startIndex + limit) < (count || 0),
          hasPrev: page > 1
        },
        filters: availableFilters
      };

      reply.send(response);
    } catch (error) {
      console.error('Error fetching companies:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch companies'
      });
    }
  });

  // Get specific company by ID
  fastify.get('/companies/:companyId', async (
    request: FastifyRequest<{ Params: { companyId: string } }>,
    reply
  ) => {
    try {
      const { companyId } = request.params;
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      console.log('📥 Getting company:', { companyId, userId });

      // Get user's sessions to verify access
      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      const { data: company, error } = await supabaseService['supabase']
        .from('companies')
        .select('*')
        .eq('company_id', companyId)
        .in('session_id', sessionIds)
        .single();

      if (error || !company) {
        return reply.status(404).send({
          success: false,
          error: 'Company not found'
        });
      }

      reply.send({
        success: true,
        company
      });
    } catch (error) {
      console.error('Error fetching company:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch company'
      });
    }
  });

  // Advanced search with complex filters
  fastify.post('/companies/search', async (
    request: FastifyRequest<{ Body: SearchCompaniesBody }>,
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const { query, icpModelId, filters } = request.body;

      console.log('🔍 Advanced company search:', { userId, query, icpModelId, filters });

      // Get user's sessions
      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          companies: [],
          total: 0
        });
      }

      let searchQuery = supabaseService['supabase']
        .from('companies')
        .select('*', { count: 'exact' })
        .in('session_id', sessionIds);

      // Apply text search
      if (query) {
        searchQuery = searchQuery.or(`name.ilike.%${query}%,description.ilike.%${query}%,domain.ilike.%${query}%,industry.cs.{${query}}`);
      }

      // Apply ICP model filter
      if (icpModelId) {
        searchQuery = searchQuery.eq('icp_model_id', icpModelId);
      }

      // Apply advanced filters
      if (filters) {
        // Industries filter
        if (filters.industries && filters.industries.length > 0) {
          searchQuery = searchQuery.overlaps('industry', filters.industries);
        }

        // Countries filter
        if (filters.countries && filters.countries.length > 0) {
          searchQuery = searchQuery.in('country', filters.countries);
        }

        // Employee range filter
        if (filters.employeeRange) {
          searchQuery = searchQuery
            .gte('employee_count', filters.employeeRange.min)
            .lte('employee_count', filters.employeeRange.max);
        }

        // Revenue range filter
        if (filters.revenueRange) {
          searchQuery = searchQuery
            .gte('annual_revenue', filters.revenueRange.min)
            .lte('annual_revenue', filters.revenueRange.max);
        }

        // Funding range filter
        if (filters.fundingRange) {
          searchQuery = searchQuery
            .gte('total_funding', filters.fundingRange.min)
            .lte('total_funding', filters.fundingRange.max);
        }

        // Funding stages filter
        if (filters.fundingStages && filters.fundingStages.length > 0) {
          searchQuery = searchQuery.in('funding_stage', filters.fundingStages);
        }

        // Target markets filter
        if (filters.targetMarkets && filters.targetMarkets.length > 0) {
          searchQuery = searchQuery.in('target_market', filters.targetMarkets);
        }

        // Technologies filter
        if (filters.technologies && filters.technologies.length > 0) {
          searchQuery = searchQuery.overlaps('technologies', filters.technologies);
        }
      }

      const { data: companies, error, count } = await searchQuery;

      if (error) {
        console.error('Search error:', error);
        throw error;
      }

      console.log('📤 Search results:', { 
        query, 
        totalFound: count || 0 
      });

      reply.send({
        success: true,
        companies: companies || [],
        total: count || 0
      });
    } catch (error) {
      console.error('Error searching companies:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to search companies'
      });
    }
  });

  // Get company statistics
  fastify.get('/companies/stats', async (request: FastifyRequest, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      console.log('📊 Getting company statistics for user:', userId);

      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          stats: getEmptyStats()
        });
      }

      // Get all companies for stats calculation
      const { data: companies, error } = await supabaseService['supabase']
        .from('companies')
        .select('*')
        .in('session_id', sessionIds);

      if (error) {
        console.error('Stats error:', error);
        throw error;
      }

      const stats = calculateCompanyStats(companies || []);

      reply.send({
        success: true,
        stats
      });
    } catch (error) {
      console.error('Error fetching company statistics:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch company statistics'
      });
    }
  });

  // Get available filter options
  fastify.get('/companies/filters/options', async (request: FastifyRequest, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      console.log('🎯 Getting filter options for user:', userId);

      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          filters: getEmptyFilterOptions()
        });
      }

      const filters = await getAvailableFilters(sessionIds);

      reply.send({
        success: true,
        filters
      });
    } catch (error) {
      console.error('Error fetching filter options:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch filter options'
      });
    }
  });

  // Export companies to CSV
  fastify.get('/companies/export', async (
    request: FastifyRequest<{ Querystring: GetCompaniesQuery }>,
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const { search, industry, country, minEmployees, maxEmployees } = request.query;

      console.log('📤 Exporting companies for user:', userId);

      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      if (sessionIds.length === 0) {
        return reply.status(404).send({
          success: false,
          error: 'No companies found to export'
        });
      }

      let query = supabaseService['supabase']
        .from('companies')
        .select('*')
        .in('session_id', sessionIds);

      // Apply filters for export
      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
      }
      if (industry) {
        query = query.contains('industry', [industry]);
      }
      if (country) {
        query = query.ilike('country', `%${country}%`);
      }
      if (minEmployees !== undefined) {
        query = query.gte('employee_count', minEmployees);
      }
      if (maxEmployees !== undefined) {
        query = query.lte('employee_count', maxEmployees);
      }

      const { data: companies, error } = await query;

      if (error) {
        console.error('Export error:', error);
        throw error;
      }

      // Convert to CSV
      const csv = convertToCSV(companies || []);

      reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="companies.csv"')
        .send(csv);

    } catch (error) {
      console.error('Error exporting companies:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to export companies'
      });
    }
  });

  // Bulk update companies
  fastify.patch('/companies/bulk', async (
    request: FastifyRequest<{ Body: { companyIds: string[]; updates: Partial<Company> } }>,
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const { companyIds, updates } = request.body;

      console.log('🔄 Bulk updating companies:', { userId, companyCount: companyIds.length });

      const sessions = await supabaseService.getUserSessions(userId);
      const sessionIds = sessions.map(session => session.id);

      const { data, error } = await supabaseService['supabase']
        .from('companies')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .in('company_id', companyIds)
        .in('session_id', sessionIds)
        .select();

      if (error) {
        console.error('Bulk update error:', error);
        throw error;
      }

      reply.send({
        success: true,
        updatedCount: data?.length || 0,
        companies: data
      });
    } catch (error) {
      console.error('Error bulk updating companies:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to bulk update companies'
      });
    }
  });
}

// Helper functions
async function getAvailableFilters(sessionIds: string[]) {
  // Get unique industries
  const { data: industriesData } = await supabaseService['supabase']
    .from('companies')
    .select('industry')
    .in('session_id', sessionIds);

  const industries = new Set<string>();
  industriesData?.forEach(company => {
    if (Array.isArray(company.industry)) {
      company.industry.forEach(ind => industries.add(ind));
    }
  });

  // Get unique countries
  const { data: countriesData } = await supabaseService['supabase']
    .from('companies')
    .select('country')
    .in('session_id', sessionIds)
    .not('country', 'is', null);

  const countries = new Set(countriesData?.map(c => c.country).filter(Boolean));

  // Get unique technologies
  const { data: techData } = await supabaseService['supabase']
    .from('companies')
    .select('technologies')
    .in('session_id', sessionIds);

  const technologies = new Set<string>();
  techData?.forEach(company => {
    if (Array.isArray(company.technologies)) {
      company.technologies.forEach(tech => technologies.add(tech));
    }
  });

  return {
    availableIndustries: Array.from(industries).sort(),
    availableCountries: Array.from(countries).sort(),
    availableTechnologies: Array.from(technologies).sort()
  };
}

function calculateCompanyStats(companies: Company[]): CompanyStatsResponse['stats'] {
  if (companies.length === 0) {
    return getEmptyStats();
  }

  const stats = {
    totalCompanies: companies.length,
    byIndustry: {} as Record<string, number>,
    byCountry: {} as Record<string, number>,
    byEmployeeRange: {
      '1-10': 0,
      '11-50': 0,
      '51-200': 0,
      '201-500': 0,
      '501-1000': 0,
      '1000+': 0
    },
    byFundingStage: {} as Record<string, number>,
    byTargetMarket: {} as Record<string, number>,
    averageRevenue: 0,
    averageEmployees: 0,
    highIntentCount: 0,
    highFitCount: 0,
    recentAdditions: 0
  };

  let totalRevenue = 0;
  let totalEmployees = 0;
  let revenueCount = 0;
  let employeeCount = 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  companies.forEach(company => {
    // Industry stats
    if (Array.isArray(company.industry)) {
      company.industry.forEach(ind => {
        stats.byIndustry[ind] = (stats.byIndustry[ind] || 0) + 1;
      });
    }

    // Country stats
    if (company.country) {
      stats.byCountry[company.country] = (stats.byCountry[company.country] || 0) + 1;
    }

    // Employee range stats
    const employees = company.employee_count || 0;
    if (employees <= 10) stats.byEmployeeRange['1-10']++;
    else if (employees <= 50) stats.byEmployeeRange['11-50']++;
    else if (employees <= 200) stats.byEmployeeRange['51-200']++;
    else if (employees <= 500) stats.byEmployeeRange['201-500']++;
    else if (employees <= 1000) stats.byEmployeeRange['501-1000']++;
    else stats.byEmployeeRange['1000+']++;

    // Funding stage stats
    if (company.funding_stage) {
      stats.byFundingStage[company.funding_stage] = (stats.byFundingStage[company.funding_stage] || 0) + 1;
    }

    // Target market stats
    if (company.target_market) {
      stats.byTargetMarket[company.target_market] = (stats.byTargetMarket[company.target_market] || 0) + 1;
    }

    // Averages
    if (company.annual_revenue) {
      totalRevenue += company.annual_revenue;
      revenueCount++;
    }
    if (company.employee_count) {
      totalEmployees += company.employee_count;
      employeeCount++;
    }

    // High intent/fit (assuming scoring_metrics has fit_score and intent_score)
    if (company.scoring_metrics?.fit_score?.score >= 80) {
      stats.highFitCount++;
    }
    if (company.scoring_metrics?.intent_score?.score >= 80) {
      stats.highIntentCount++;
    }

    // Recent additions
    if (new Date(company.created_at) > thirtyDaysAgo) {
      stats.recentAdditions++;
    }
  });

  stats.averageRevenue = revenueCount > 0 ? Math.round(totalRevenue / revenueCount) : 0;
  stats.averageEmployees = employeeCount > 0 ? Math.round(totalEmployees / employeeCount) : 0;

  return stats;
}

function getEmptyStats(): CompanyStatsResponse['stats'] {
  return {
    totalCompanies: 0,
    byIndustry: {},
    byCountry: {},
    byEmployeeRange: {
      '1-10': 0,
      '11-50': 0,
      '51-200': 0,
      '201-500': 0,
      '501-1000': 0,
      '1000+': 0
    },
    byFundingStage: {},
    byTargetMarket: {},
    averageRevenue: 0,
    averageEmployees: 0,
    highIntentCount: 0,
    highFitCount: 0,
    recentAdditions: 0
  };
}

function getEmptyFilterOptions() {
  return {
    availableIndustries: [],
    availableCountries: [],
    availableTechnologies: []
  };
}

function convertToCSV(companies: Company[]): string {
  const headers = [
    'Name',
    'Domain',
    'Website',
    'Industry',
    'Country',
    'Employee Count',
    'Annual Revenue',
    'Funding Stage',
    'Target Market',
    'Technologies',
    'Description'
  ];

  const rows = companies.map(company => [
    company.name,
    company.domain,
    company.website,
    Array.isArray(company.industry) ? company.industry.join('; ') : company.industry,
    company.country,
    company.employee_count?.toString() || '',
    company.annual_revenue?.toString() || '',
    company.funding_stage,
    company.target_market,
    Array.isArray(company.technologies) ? company.technologies.join('; ') : '',
    company.description?.replace(/\n/g, ' ') || ''
  ]);

  const escape = (field: string) => `"${field.replace(/"/g, '""')}"`;

  return [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(','))
  ].join('\n');
}