// src/controllers/CompaniesController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { mongoDBService } from '../services/MongoDBService.js';
import { Company } from '../core/types.js';
import { Company as CompanyModel } from '../models/Company.js';
import { Session } from '../models/Session.js';
import { Types } from 'mongoose';
import { log } from 'console';
import { GTMIntelligence } from '../models/GTMIntelligence.js';
import { autoEmbeddingService } from '../services/vector/AutoEmbeddingService.js';
import { Employee } from '../models/Employee.js';
import { Enrichment } from '../models/Enrichment.js';

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
  sortBy?: 'name' | 'employeeCount' | 'annualRevenue' | 'totalFunding' | 'foundedYear' | 'createdAt';
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
        sortBy = 'createdAt',
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
      console.log("===========userId===============")
      console.log(userId)
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

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

      // Build the MongoDB query
      const filter: any = {
        sessionId: { $in: sessionIds }
      };

      // Apply search filter
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { domain: { $regex: search, $options: 'i' } }
        ];
      }

      // Apply ICP model filter
      if (icpModelId && Types.ObjectId.isValid(icpModelId)) {
        filter.icpModelId = new Types.ObjectId(icpModelId);
      }

      // Apply industry filter
      if (industry) {
        filter.industry = { $in: [industry] };
      }

      // Apply country filter
      if (country) {
        filter.country = { $regex: country, $options: 'i' };
      }

      // Apply employee count filters
      if (minEmployees !== undefined || maxEmployees !== undefined) {
        filter.employeeCount = {};
        if (minEmployees !== undefined) {
          filter.employeeCount.$gte = minEmployees;
        }
        if (maxEmployees !== undefined) {
          filter.employeeCount.$lte = maxEmployees;
        }
      }

      // Apply revenue filters
      if (minRevenue !== undefined || maxRevenue !== undefined) {
        filter.annualRevenue = {};
        if (minRevenue !== undefined) {
          filter.annualRevenue.$gte = minRevenue;
        }
        if (maxRevenue !== undefined) {
          filter.annualRevenue.$lte = maxRevenue;
        }
      }

      // Apply funding filters
      if (minFunding !== undefined || maxFunding !== undefined) {
        filter.totalFunding = {};
        if (minFunding !== undefined) {
          filter.totalFunding.$gte = minFunding;
        }
        if (maxFunding !== undefined) {
          filter.totalFunding.$lte = maxFunding;
        }
      }

      // Apply funding stage filter
      if (fundingStage) {
        filter.fundingStage = fundingStage;
      }

      // Apply target market filter
      if (targetMarket) {
        filter.targetMarket = targetMarket;
      }

      // Apply founded year filters
      if (foundedAfter !== undefined || foundedBefore !== undefined) {
        filter.foundedYear = {};
        if (foundedAfter !== undefined) {
          filter.foundedYear.$gte = foundedAfter;
        }
        if (foundedBefore !== undefined) {
          filter.foundedYear.$lte = foundedBefore;
        }
      }

      // Apply technologies filter
      if (technologies) {
        const techArray = technologies.split(',').map(tech => tech.trim());
        filter.technologies = { $in: techArray };
      }

      // Apply intent signals filter
      if (hasIntentSignals !== undefined) {
        if (hasIntentSignals) {
          filter.intentSignals = { $ne: null, $exists: true };
        } else {
          filter.$or = [
            { intentSignals: null },
            { intentSignals: { $exists: false } }
          ];
        }
      }

      // Count total documents
      const total = await CompanyModel.countDocuments(filter);

      // Build sorting
      const sort: any = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

      // Apply pagination
      const skip = (page - 1) * limit;
     // In your GET /companies endpoint, update the populate section:
const companies = await CompanyModel.find(filter)
.sort(sort)
.skip(skip)
.limit(limit)
.populate('sessionId', "*")
.populate('icpModelId', '*')
.populate({
  path: 'employees',
  options: {
    limit: 50,
    sort: { isDecisionMaker: -1, isWorking: -1, fullName: 1 }
  },
  // Select all fields that match your Employee model
  select: `
    fullName firstName lastName headline summary 
    isDecisionMaker isWorking linkedinUrl 
    primaryProfessionalEmail professionalEmails
    activeExperienceTitle activeExperienceDepartment 
    locationCountry locationCity locationFull
    pictureUrl connectionsCount followersCount 
    totalExperienceDurationMonths
    inferredSkills historicalSkills interests
    languages educationHistory educationDegrees
    githubUrl githubUsername
    experienceHistory recommendationsCount
    coresignalEmployeeId publicProfileId
  `
})
.populate('gtmIntelligence')
.lean({ virtuals: true });

      // Get available filters for frontend
      const availableFilters = await getAvailableFilters(sessionIds);

      console.log('📤 Companies found:', { 
        total,
        showing: companies.length,
        page,
        totalPages: Math.ceil(total / limit)
      });

      const response: CompaniesResponse = {
        success: true,
        companies: companies.map(mapCompanyToType),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: skip + limit < total,
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

      if (!Types.ObjectId.isValid(companyId)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid company ID'
        });
      }

      // Get user's sessions to verify access
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

  const company = await CompanyModel.findOne({
  _id: new Types.ObjectId(companyId),
  sessionId: { $in: sessionIds }
})
.populate('icpModelId', 'name')
.populate({
  path: 'employees',
  options: {
    sort: { isDecisionMaker: -1, isWorking: -1, fullName: 1 }
  },
  select: 'fullName firstName lastName headline isDecisionMaker isWorking linkedinUrl primaryProfessionalEmail activeExperienceTitle activeExperienceDepartment locationCountry locationCity pictureUrl connectionsCount followersCount totalExperienceDurationMonths inferredSkills languages education githubUrl professionalEmails educationHistory'
})
.lean({ virtuals: true });
      const overview = await GTMIntelligence.findOne({
        companyId: new Types.ObjectId(companyId),
       
      })
        .populate('icpModelId', 'name')
        .lean();

      if (!company) {
        return reply.status(404).send({
          success: false,
          error: 'Company not found'
        });
      }

      // Merge overview into company before mapping
      const companyWithOverview = overview 
        ? { ...company, gtmIntelligence: overview }
        : company;
      
      const mappedCompany = mapCompanyToType(companyWithOverview);
      
      reply.send({
        success: true,
        company: mappedCompany,
        overview: overview
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
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          companies: [],
          total: 0
        });
      }

      const searchFilter: any = {
        sessionId: { $in: sessionIds }
      };

      // Apply text search
      if (query) {
        searchFilter.$or = [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } },
          { domain: { $regex: query, $options: 'i' } },
          { industry: { $in: [query] } }
        ];
      }

      // Apply ICP model filter
      if (icpModelId && Types.ObjectId.isValid(icpModelId)) {
        searchFilter.icpModelId = new Types.ObjectId(icpModelId);
      }

      // Apply advanced filters
      if (filters) {
        // Industries filter
        if (filters.industries && filters.industries.length > 0) {
          searchFilter.industry = { $in: filters.industries };
        }

        // Countries filter
        if (filters.countries && filters.countries.length > 0) {
          searchFilter.country = { $in: filters.countries };
        }

        // Employee range filter
        if (filters.employeeRange) {
          searchFilter.employeeCount = {
            $gte: filters.employeeRange.min,
            $lte: filters.employeeRange.max
          };
        }

        // Revenue range filter
        if (filters.revenueRange) {
          searchFilter.annualRevenue = {
            $gte: filters.revenueRange.min,
            $lte: filters.revenueRange.max
          };
        }

        // Funding range filter
        if (filters.fundingRange) {
          searchFilter.totalFunding = {
            $gte: filters.fundingRange.min,
            $lte: filters.fundingRange.max
          };
        }

        // Funding stages filter
        if (filters.fundingStages && filters.fundingStages.length > 0) {
          searchFilter.fundingStage = { $in: filters.fundingStages };
        }

        // Target markets filter
        if (filters.targetMarkets && filters.targetMarkets.length > 0) {
          searchFilter.targetMarket = { $in: filters.targetMarkets };
        }

        // Technologies filter
        if (filters.technologies && filters.technologies.length > 0) {
          searchFilter.technologies = { $in: filters.technologies };
        }
      }

      const companies = await CompanyModel.find(searchFilter).lean();
      const total = companies.length;

      console.log('📤 Search results:', { 
        query, 
        totalFound: total 
      });

      reply.send({
        success: true,
        companies: companies.map(mapCompanyToType),
        total
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

      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          stats: getEmptyStats()
        });
      }

      // Get all companies for stats calculation
      const companies = await CompanyModel.find({
        sessionId: { $in: sessionIds }
      }).lean();

      const stats = calculateCompanyStats(companies.map(mapCompanyToType));

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

      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

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

      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      if (sessionIds.length === 0) {
        return reply.status(404).send({
          success: false,
          error: 'No companies found to export'
        });
      }

      const filter: any = {
        sessionId: { $in: sessionIds }
      };

      // Apply filters for export
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }
      if (industry) {
        filter.industry = { $in: [industry] };
      }
      if (country) {
        filter.country = { $regex: country, $options: 'i' };
      }
      if (minEmployees !== undefined) {
        filter.employeeCount = { ...filter.employeeCount, $gte: minEmployees };
      }
      if (maxEmployees !== undefined) {
        filter.employeeCount = { ...filter.employeeCount, $lte: maxEmployees };
      }

      const companies = await CompanyModel.find(filter).lean();

      // Convert to CSV
      const csv = convertToCSV(companies.map(mapCompanyToType));

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

      // Validate ObjectIds
      const validIds = companyIds
        .filter(id => Types.ObjectId.isValid(id))
        .map(id => new Types.ObjectId(id));

      if (validIds.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'No valid company IDs provided'
        });
      }

      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      // Convert updates to MongoDB field names
      const mongoUpdates: any = {
        updatedAt: new Date()
      };

      // Map camelCase to your schema fields
      if (updates.name) mongoUpdates.name = updates.name;
      if (updates.description) mongoUpdates.description = updates.description;
      if (updates.industry) mongoUpdates.industry = updates.industry;
      if (updates.employees !== undefined) mongoUpdates.employeeCount = updates.employees;
      // Add more field mappings as needed

      const result = await CompanyModel.updateMany(
        {
          _id: { $in: validIds },
          sessionId: { $in: sessionIds }
        },
        { $set: mongoUpdates }
      );

      // Fetch updated companies
      const updatedCompanies = await CompanyModel.find({
        _id: { $in: validIds },
        sessionId: { $in: sessionIds }
      }).lean();

      reply.send({
        success: true,
        updatedCount: result.modifiedCount,
        companies: updatedCompanies.map(mapCompanyToType)
      });
    } catch (error) {
      console.error('Error bulk updating companies:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to bulk update companies'
      });
    }
  });

  // 🔧 MANUAL EMBEDDING ENDPOINTS

  // Embed a specific company by ID
  fastify.post('/companies/:companyId/embed', async (
    request: FastifyRequest<{ Params: { companyId: string } }>,
    reply
  ) => {
    try {
      const { companyId } = request.params;
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      console.log(`🔧 Manual embedding requested for company: ${companyId}`);

      if (!Types.ObjectId.isValid(companyId)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid company ID'
        });
      }

      // Verify user has access to this company
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      const company = await CompanyModel.findOne({
        _id: new Types.ObjectId(companyId),
        sessionId: { $in: sessionIds }
      });

      if (!company) {
        return reply.status(404).send({
          success: false,
          error: 'Company not found or access denied'
        });
      }

      // Generate embedding
      await autoEmbeddingService.autoEmbedOnSave(company, 'company');
      await company.save();

      console.log(`✅ Successfully embedded company: ${company.name} (${companyId})`);

      reply.send({
        success: true,
        message: `Embedding generated for ${company.name}`,
        companyId: companyId,
        hasEmbedding: !!company.embedding && Array.isArray(company.embedding) && company.embedding.length > 0,
        embeddingGeneratedAt: company.embeddingGeneratedAt
      });
    } catch (error: any) {
      console.error('Error embedding company:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to generate embedding',
        details: error.message
      });
    }
  });

  // Embed all companies without embeddings (for a specific user)
  fastify.post('/companies/embed/all', async (
    request: FastifyRequest<{ 
      Body?: { 
        limit?: number;
        forceRegenerate?: boolean;
      } 
    }>,
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const { limit = 100, forceRegenerate = false } = request.body || {};

      console.log(`🔧 Batch embedding requested for user: ${userId}, limit: ${limit}, forceRegenerate: ${forceRegenerate}`);

      // Get user's sessions
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      if (sessionIds.length === 0) {
        return reply.send({
          success: true,
          message: 'No sessions found for user',
          embedded: 0,
          failed: 0
        });
      }

      // Find companies without embeddings
      const query: any = {
        sessionId: { $in: sessionIds }
      };

      if (!forceRegenerate) {
        query.$or = [
          { embedding: { $exists: false } },
          { embedding: null },
          { embedding: { $size: 0 } },
          { embeddingGeneratedAt: { $exists: false } }
        ];
      }

      const companies = await CompanyModel.find(query).limit(limit);
      
      console.log(`📊 Found ${companies.length} companies to embed`);

      let embedded = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const company of companies) {
        try {
          await autoEmbeddingService.autoEmbedOnSave(company, 'company');
          await company.save();
          embedded++;
          console.log(`✅ Embedded company ${embedded}/${companies.length}: ${company.name}`);
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          failed++;
          const errorMsg = `Failed to embed ${company.name}: ${error.message}`;
          errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

      reply.send({
        success: true,
        message: `Batch embedding completed`,
        total: companies.length,
        embedded,
        failed,
        errors: errors.slice(0, 10) // Return first 10 errors
      });
    } catch (error: any) {
      console.error('Error in batch embedding:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to batch embed companies',
        details: error.message
      });
    }
  });

  // Embed employees for a specific company
  fastify.post('/companies/:companyId/embed/employees', async (
    request: FastifyRequest<{ Params: { companyId: string } }>,
    reply
  ) => {
    try {
      const { companyId } = request.params;
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      if (!Types.ObjectId.isValid(companyId)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid company ID'
        });
      }

      // Verify user has access
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map(session => session._id);

      const company = await CompanyModel.findOne({
        _id: new Types.ObjectId(companyId),
        sessionId: { $in: sessionIds }
      });

      if (!company) {
        return reply.status(404).send({
          success: false,
          error: 'Company not found or access denied'
        });
      }

      // Find employees without embeddings
      const employees = await Employee.find({
        companyId: new Types.ObjectId(companyId),
        $or: [
          { embedding: { $exists: false } },
          { embedding: null },
          { embedding: { $size: 0 } }
        ]
      }).limit(100);

      console.log(`🔧 Embedding ${employees.length} employees for company: ${company.name}`);

      let embedded = 0;
      let failed = 0;

      for (const employee of employees) {
        try {
          await autoEmbeddingService.autoEmbedOnSave(employee, 'employee');
          await employee.save();
          embedded++;
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          failed++;
          console.error(`❌ Failed to embed employee ${employee.fullName}:`, error);
        }
      }

      reply.send({
        success: true,
        message: `Embedded ${embedded} employees for ${company.name}`,
        embedded,
        failed,
        total: employees.length
      });
    } catch (error: any) {
      console.error('Error embedding employees:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to embed employees',
        details: error.message
      });
    }
  });
}

// Helper functions
async function getAvailableFilters(sessionIds: Types.ObjectId[]) {
  // Get unique industries
  const industriesAgg = await CompanyModel.aggregate([
    { $match: { sessionId: { $in: sessionIds } } },
    { $unwind: '$industry' },
    { $group: { _id: '$industry' } },
    { $sort: { _id: 1 } }
  ]);
  const industries = industriesAgg.map(doc => doc._id).filter(Boolean);

  // Get unique countries
  const countriesAgg = await CompanyModel.aggregate([
    { $match: { sessionId: { $in: sessionIds }, country: { $ne: null, $exists: true } } },
    { $group: { _id: '$country' } },
    { $sort: { _id: 1 } }
  ]);
  const countries = countriesAgg.map(doc => doc._id).filter(Boolean);

  // Get unique technologies
  const techAgg = await CompanyModel.aggregate([
    { $match: { sessionId: { $in: sessionIds } } },
    { $unwind: '$technologies' },
    { $group: { _id: '$technologies' } },
    { $sort: { _id: 1 } }
  ]);
  const technologies = techAgg.map(doc => doc._id).filter(Boolean);

  return {
    availableIndustries: industries,
    availableCountries: countries,
    availableTechnologies: technologies
  };
}

function mapCompanyToType(company: any): Company {
  console.log('🔍 Mapping company:', company.name);
  console.log('📊 Employees data:', {
    employeeCount: company.employeeCount,
    employeesArrayLength: Array.isArray(company.employees) ? company.employees.length : 0,
    hasEmployeesArray: Array.isArray(company.employees)
  });

  // Ensure employees is always an array
  const employeesArray = Array.isArray(company.employees) ? company.employees : [];

  // Calculate employee count - use employeeCount field first, fall back to employees array length
  let employee_count = company.employeeCount || 0;
  
  // If employeeCount is 0 but we have employees in the array, use the array length
  if (employee_count === 0 && employeesArray.length > 0) {
    employee_count = employeesArray.length;
    console.log(`🔄 Using employees array length (${employeesArray.length}) for ${company.name}`);
  }

  // Debug the final employee count
  console.log(`📈 Final employee count for ${company.name}: ${employee_count}`);

  return {
    // Core identifiers
    id: company._id?.toString(),
    company_id: company._id?.toString(),
    session_id: company.sessionId?.toString(),
    icp_model_id: company.icpModelId?.toString(),

    // Basic company info
    name: company.name,
    domain: company.domain || '',
    website: company.website || '',
    logo_url: company.logoUrl || '',
    description: company.description || '',
    about: company.about || '',

    // Location info
    city: company.city || '',
    country: company.country || '',
    country_code: company.countryCode || '',

    // Contact info
    contact_email: company.contactEmail || '',
    contact_phone: company.contactPhone || '',

    // Social links
    linkedin_url: company.linkedinUrl || '',
    twitter_url: company.twitterUrl || '',
    facebook_url: company.facebookUrl || '',
    instagram_url: company.instagramUrl || '',
    crunchbase_url: company.crunchbaseUrl || '',

    // Business info
    industry: Array.isArray(company.industry) ? company.industry : (company.industry ? [company.industry] : []),
    target_market: company.targetMarket || '',
    ownership_type: company.ownershipType || '',
    business_model: company.businessModel || '',
    
    // Financial info - FIXED: Use the calculated employee_count
    employee_count: employee_count,
    employees: employeesArray,
    annual_revenue: company.annualRevenue,
    annual_revenue_currency: company.annualRevenueCurrency || 'USD',
    funding_stage: company.fundingStage || '',
    total_funding: company.totalFunding,

    // Technical info
    technologies: Array.isArray(company.technologies) ? company.technologies : [],

    // Dates
    founded_year: company.foundedYear,
    created_at: company.createdAt?.toISOString() || new Date().toISOString(),
    updated_at: company.updatedAt?.toISOString() || new Date().toISOString(),

    // Additional data
    intent_signals: company.intentSignals || {},
    relationships: company.relationships || {},
    scoring_metrics: company.scoringMetrics || {},
    overview: company.gtmIntelligence || null,

    // Legacy/compatibility fields
    location: company.city && company.country ? `${company.city}, ${company.country}` : (company.country || ''),
    revenue: company.annualRevenue,
    funding: company.totalFunding,
    hiring: company.hiring || false,
    growth_signals: company.growthSignals || [],
    explorium_id: company.exaId || '',
    content: '',
    icp_score: company.scoringMetrics?.fit_score?.score || company.scoringMetrics?.icp_score,
    // Handle both old structure (score) and new Explorium structure (analysis_metadata.final_intent_score)
    intent_score: company.scoringMetrics?.intent_score?.analysis_metadata?.final_intent_score !== undefined
      ? company.scoringMetrics.intent_score.analysis_metadata.final_intent_score
      : company.scoringMetrics?.intent_score?.score
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
      '1000+': 0,
      'Unknown': 0
    },
    byFundingStage: {} as Record<string, number>,
    byTargetMarket: {} as Record<string, number>,
    averageRevenue: 0,
    averageEmployees: 0,
    highIntentCount: 0,
    highFitCount: 0,
    recentAdditions: 0,
    companiesWithEmployeeData: 0, // Added for debugging
    companiesWithRevenueData: 0   // Added for debugging
  };

  let totalRevenue = 0;
  let totalEmployees = 0;
  let revenueCount = 0;
  let employeeCount = 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  companies.forEach(company => {
    // Industry stats
    const industries = typeof company.industry === 'string' 
      ? company.industry.split(',').map(i => i.trim()) 
      : (Array.isArray(company.industry) ? company.industry : []);
    
    industries.forEach(ind => {
      if (ind && ind !== 'Unknown') {
        stats.byIndustry[ind] = (stats.byIndustry[ind] || 0) + 1;
      }
    });

    // Country stats
    if (company.country && company.country !== 'Unknown') {
      stats.byCountry[company.country] = (stats.byCountry[company.country] || 0) + 1;
    }

    // Employee data handling
    const employees = getValidEmployeeCount(company);
    
    if (employees !== null) {
      // Count in employee ranges
      if (employees <= 10) stats.byEmployeeRange['1-10']++;
      else if (employees <= 50) stats.byEmployeeRange['11-50']++;
      else if (employees <= 200) stats.byEmployeeRange['51-200']++;
      else if (employees <= 500) stats.byEmployeeRange['201-500']++;
      else if (employees <= 1000) stats.byEmployeeRange['501-1000']++;
      else stats.byEmployeeRange['1000+']++;
      
      // Add to average calculation
      totalEmployees += employees;
      employeeCount++;
      stats.companiesWithEmployeeData++;
    } else {
      stats.byEmployeeRange['Unknown']++;
    }

    // Revenue data handling
    const revenue = getValidRevenue(company);
    if (revenue !== null) {
      totalRevenue += revenue;
      revenueCount++;
      stats.companiesWithRevenueData++;
    }

    // Funding stage stats
    if (company.funding_stage && company.funding_stage !== 'Unknown') {
      stats.byFundingStage[company.funding_stage] = (stats.byFundingStage[company.funding_stage] || 0) + 1;
    }

    // Target market stats
    if (company.target_market && company.target_market !== 'Unknown') {
      stats.byTargetMarket[company.target_market] = (stats.byTargetMarket[company.target_market] || 0) + 1;
    }

    // High intent/fit
    const fitScore = company.scoring_metrics?.fit_score?.score || company.icp_score;
    if (fitScore && fitScore >= 80) {
      stats.highFitCount++;
    }
    
    const intentScore = company.scoring_metrics?.intent_score?.score || company.intent_score;
    if (intentScore && intentScore >= 80) {
      stats.highIntentCount++;
    }

    // Recent additions
    if (company.created_at && new Date(company.created_at) > thirtyDaysAgo) {
      stats.recentAdditions++;
    }
  });

  // Calculate averages
  stats.averageRevenue = revenueCount > 0 ? Math.round(totalRevenue / revenueCount) : 0;
  stats.averageEmployees = employeeCount > 0 ? Math.round(totalEmployees / employeeCount) : 0;

  // Debug logging
  console.log('📊 Enhanced Stats Calculation:', {
    totalCompanies: stats.totalCompanies,
    companiesWithEmployeeData: stats.companiesWithEmployeeData,
    companiesWithRevenueData: stats.companiesWithRevenueData,
    totalEmployeesSum: totalEmployees,
    calculatedAverageEmployees: stats.averageEmployees,
    totalRevenueSum: totalRevenue,
    calculatedAverageRevenue: stats.averageRevenue,
    employeeRanges: stats.byEmployeeRange
  });

  return stats;
}

// Helper function to get valid employee count
function getValidEmployeeCount(company: Company): number | null {
  const employees = company.employee_count || company.employees;
  
  // Check if employee count is valid (not 0, not null, not undefined, positive number)
  if (employees !== null && employees !== undefined && employees > 0) {
    return employees;
  }
  
  return null;
}

// Helper function to get valid revenue
function getValidRevenue(company: Company): number | null {
  const revenue = company.annual_revenue || company.revenue;
  
  // Check if revenue is valid (not 0, not null, not undefined, positive number)
  if (revenue !== null && revenue !== undefined && revenue > 0) {
    return revenue;
  }
  
  return null;
}

function getEmptyStats() {
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
      '1000+': 0,
      'Unknown': 0
    },
    byFundingStage: {},
    byTargetMarket: {},
    averageRevenue: 0,
    averageEmployees: 0,
    highIntentCount: 0,
    highFitCount: 0,
    recentAdditions: 0,
    companiesWithEmployeeData: 0,
    companiesWithRevenueData: 0
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
    company.name || '',
    company.domain || '',
    company.website || '',
    company.industry || '',
    company.country || '',
    (company.employee_count || company.employees || '').toString(),
    (company.annual_revenue || company.revenue || '').toString(),
    company.funding_stage || '',
    company.target_market || '',
    Array.isArray(company.technologies) ? company.technologies.join('; ') : '',
    (company.description || '').replace(/\n/g, ' ')
  ]);

  const escape = (field: string) => `"${field.replace(/"/g, '""')}"`;

  return [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(','))
  ].join('\n');
}