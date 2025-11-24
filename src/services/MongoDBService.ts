// src/services/MongoDBService.ts
import mongoose, { Types } from 'mongoose';

import { 
  Company as CompanyType, 
  SearchSession, 
  ICPModel as ICPModelType, 
  SearchStatus, 
  SubStep 
} from '../core/types';
import { Session } from '../models/Session';
import { Company } from '../models/Company';
import { SessionSubstep } from '../models/SessionSubstep';
import { Employee } from '../models/Employee';
import { Enrichment } from '../models/Enrichment';
import { ICPModel } from '../models/ICPModel';

export class MongoDBService {
  saveCompanies(sessionId: string, companies: CompanyType[]): void | PromiseLike<void> {
    throw new Error('Method not implemented.');
  }
  
  constructor() {
    // Connection is handled separately in database/connection.ts
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================
  
  async createSession(userId: string, name: string): Promise<SearchSession> {
    const session = await Session.create({
      name,
      userId,
      query: [],
      resultsCount: 0,
      searchStatus: {
        stage: 'idle',
        message: 'Session created',
        progress: 0,
        currentStep: 0,
        totalSteps: 4,
        substeps: []
      }
    });

    return this.mapSessionToType(session);
  }

  async getSession(sessionId: string): Promise<SearchSession | null> {
    try {
      const session = await Session.findById(sessionId)
        .populate('icpModelId')
        .lean();

      if (!session) return null;

      // Get related data
      const companies = await Company.find({ sessionId: session._id }).lean();
      const substeps = await SessionSubstep.find({ sessionId: session._id })
        .sort('stepId')
        .lean();

      return this.mapSessionToType(session, companies, substeps);
    } catch (error) {
      console.error('Error fetching session:', error);
      return null;
    }
  }
  async getUserSessions(userId: string): Promise<SearchSession[]> {
    const MAX_RETRIES = 3
    const RETRY_DELAY = 1000
  
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`🔍 Database query attempt ${attempt} for user ${userId}`)
        
        const sessions = await Session.find({ userId })
          .populate('icpModelId')
          .sort({ createdAt: -1 })
          .lean()
  
        console.log(`🔍 Found ${sessions.length} sessions`)
  
        if (!sessions || sessions.length === 0) {
          console.log('🔍 No sessions found for user')
          return []
        }
  
        const sessionIds = sessions.map((s: any) => s._id)
        console.log('🔍 Session IDs:', sessionIds)
  
        // Add timeout to prevent hanging queries
        const companiesPromise = Company.find({ 
          sessionId: { $in: sessionIds } 
        })
        .populate('employees')
        .lean()
        .maxTimeMS(30000) // 30 second timeout
  
        const [companies, substeps] = await Promise.all([
          companiesPromise,
          SessionSubstep.find({ sessionId: { $in: sessionIds } }).lean()
        ])
  
        console.log(`🔍 Found ${companies.length} companies across all sessions`)
  
        // Debug: Check if companies have data
        companies.forEach((company, index) => {
          console.log(`🔍 Company ${index + 1}:`, {
            name: company.name,
            hasEmployees: !!company.employees,
            employeeCount: company.employees?.length,
            hasScoringMetrics: !!company.scoringMetrics,
            hasIntentSignals: !!company.intentSignals
          })
        })
  
        const result = sessions.map((session: any) => 
          this.mapSessionToType(
            session,
            companies.filter(c => c.sessionId.toString() === session._id.toString()),
            substeps.filter(s => s.sessionId.toString() === session._id.toString())
          )
        )
  
        console.log('🔍 Successfully mapped sessions with companies')
        return result
  
      } catch (error) {
        console.error(`❌ Database query attempt ${attempt} failed:`, error)
        
        if (attempt === MAX_RETRIES) {
          throw new Error(`Failed to fetch user sessions after ${MAX_RETRIES} attempts: ${error.message}`)
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt))
      }
    }
    
    return []
  }

  async updateSessionQuery(sessionId: string, query: string[]): Promise<SearchSession> {
    const session = await Session.findByIdAndUpdate(
      sessionId,
      { 
        query, 
        updatedAt: new Date() 
      },
      { new: true }
    ).lean();

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.mapSessionToType(session);
  }

  async updateSearchStatus(sessionId: string, status: Partial<SearchStatus>): Promise<SearchSession> {
    const session = await Session.findByIdAndUpdate(
      sessionId,
      { 
        searchStatus: status,
        updatedAt: new Date()
      },
      { new: true }
    ).lean();

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return this.mapSessionToType(session);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const sessionObjectId = new Types.ObjectId(sessionId);
      
      // Delete related data
      await Promise.all([
        Company.deleteMany({ sessionId: sessionObjectId }),
        SessionSubstep.deleteMany({ sessionId: sessionObjectId }),
        Enrichment.deleteMany({ sessionId: sessionObjectId }),
        Session.findByIdAndDelete(sessionId)
      ]);

      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  async getSearchStatus(sessionId: string): Promise<SearchStatus | null> {
    try {
      const session = await Session.findById(sessionId)
        .select('searchStatus')
        .lean();

      return session?.searchStatus || null;
    } catch (error) {
      console.error('Error getting search status:', error);
      return null;
    }
  }

  // =====================================================
// COMPANY MANAGEMENT
// =====================================================
async saveCompanyWithSessionAndICP(
    sessionId: string,
    icpModelId: string,
    companyData: any
  ): Promise<any> {  // Return the saved company data directly
    try {
      const result = await this.saveCompanyData(sessionId, icpModelId, companyData);
      return result;  // Return the data directly
    } catch (error) {
      console.error("Exception saving company:", error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to save company data"
      );
    }
  }
  
  private async saveCompanyData(sessionId: string, icpModelId: string, companyData: any) {
    const {
      business_model,
      location,
      contact,
      social_profiles,
      revenue_estimated,
      employees,
      exa_enrichement,
      enrichement,
      // Extract all fields that need special mapping
      name,
      domain,
      website,
      logo_url,
      description,
      founded_year,
      target_market,
      ownership_type,
      employee_count,
      funding_stage,
      total_funding,
      exa_id,
      intent_signals,
      relationships,
      scoring_metrics,
      technologies = [],
      industry = [],
      // Catch-all for any other fields
      ...cleanCompanyData
    } = companyData;
  
    // Validate required fields
    if (!name) {
      throw new Error("Company name is required");
    }
  
    if (!Types.ObjectId.isValid(sessionId)) {
      throw new Error("Invalid session ID");
    }
  
    if (!Types.ObjectId.isValid(icpModelId)) {
      throw new Error("Invalid ICP model ID");
    }
  
    // Prepare company object with comprehensive field mapping
    const companyToSave = {
      // Basic required fields
      name,
      sessionId: new Types.ObjectId(sessionId),
      icpModelId: new Types.ObjectId(icpModelId),
      
      // Direct mappings
      domain: domain || cleanCompanyData.domain,
      website: website || cleanCompanyData.website,
      logoUrl: logo_url || cleanCompanyData.logo_url,
      description: description || cleanCompanyData.description,
      foundedYear: founded_year || cleanCompanyData.founded_year,
      targetMarket: target_market || cleanCompanyData.target_market,
      ownershipType: ownership_type || cleanCompanyData.ownership_type,
      employeeCount: employee_count || employees?.employee_count || cleanCompanyData.employee_count,
      fundingStage: funding_stage || cleanCompanyData.funding_stage,
      totalFunding: total_funding || cleanCompanyData.total_funding,
      exaId: exa_id || cleanCompanyData.exa_id,
      
      // Location data
      city: location?.city || cleanCompanyData.city,
      country: location?.country || cleanCompanyData.country,
      countryCode: location?.country_code || cleanCompanyData.country_code,
      
      // Contact information
      contactEmail: contact?.email || cleanCompanyData.contact_email,
      contactPhone: contact?.phone || cleanCompanyData.contact_phone,
      
      // Social profiles
      linkedinUrl: social_profiles?.linkedin || cleanCompanyData.linkedin_url,
      twitterUrl: social_profiles?.twitter || cleanCompanyData.twitter_url,
      facebookUrl: social_profiles?.facebook || cleanCompanyData.facebook_url,
      instagramUrl: social_profiles?.instagram || cleanCompanyData.instagram_url,
      crunchbaseUrl: social_profiles?.crunchbase || cleanCompanyData.crunchbase_url,
      
      // Revenue data
      annualRevenue: revenue_estimated?.source_5_annual_revenue?.annual_revenue || 
                    cleanCompanyData.annual_revenue,
      annualRevenueCurrency: revenue_estimated?.source_5_annual_revenue?.annual_revenue_currency || 
                            cleanCompanyData.annual_revenue_currency,
      
      // Array fields with proper formatting
      industry: Array.isArray(industry) ? industry : 
                (typeof industry === 'string' ? [industry] : []),
      
      technologies: Array.isArray(technologies) ? technologies : 
                   (typeof technologies === 'string' ? [technologies] : []),
      
      // Object fields with defaults
      intentSignals: intent_signals || cleanCompanyData.intent_signals || {},
      relationships: relationships || cleanCompanyData.relationships || {},
      scoringMetrics: scoring_metrics || cleanCompanyData.scoring_metrics || {},
    };
  
    console.log("💾 Saving company with data:", JSON.stringify(companyToSave, null, 2));
  
    // 1. Save the company with error handling
    let savedCompany;
    try {
      savedCompany = await Company.create(companyToSave);
      console.log("✅ Company saved successfully with ID:", savedCompany._id);
    } catch (dbError) {
      console.error("❌ Database error saving company:", dbError);
      throw new Error(`Failed to save company: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
    }
  
    const companyId = savedCompany._id;
  
    // 2. Save enrichments with error handling
    const enrichmentPromises = [];
    
    if (enrichement && Object.keys(enrichement).length > 0) {
      console.log("💾 Saving Coresignal enrichment");
      enrichmentPromises.push(
        this.saveEnrichment(
          companyId.toString(),
          sessionId,
          icpModelId,
          enrichement,
          "Coresignal"
        ).catch(error => {
          console.error("❌ Failed to save Coresignal enrichment:", error);
          return null; // Continue even if enrichment fails
        })
      );
    }
  
    if (exa_enrichement && Object.keys(exa_enrichement).length > 0) {
      console.log("💾 Saving Exa enrichment");
      enrichmentPromises.push(
        this.saveEnrichment(
          companyId.toString(),
          sessionId,
          icpModelId,
          exa_enrichement,
          "Exa"
        ).catch(error => {
          console.error("❌ Failed to save Exa enrichment:", error);
          return null;
        })
      );
    }
  
    // 3. Save employees with error handling
    let employeesSaved = 0;
    if (employees && Array.isArray(employees) && employees.length > 0) {
      console.log(`💾 Saving ${employees.length} employees`);
      try {
        employeesSaved = await this.saveEmployees(companyId.toString(), employees);
        console.log(`✅ Successfully saved ${employeesSaved} employees`);
      } catch (employeeError) {
        console.error("❌ Failed to save employees:", employeeError);
        // Don't throw - continue with company save
      }
    }
  
    // Wait for all enrichment saves to complete
    if (enrichmentPromises.length > 0) {
      await Promise.allSettled(enrichmentPromises);
    }
  
    // Return comprehensive result
    return {
      ...savedCompany.toObject(),
      metadata: {
        employeesSaved,
        enrichmentsSaved: enrichmentPromises.length
      }
    };
  }
  
  // Enhanced saveEnrichment method
  private async saveEnrichment(
    companyId: string,
    sessionId: string,
    icpModelId: string,
    data: any,
    source: string
  ): Promise<any> {
    try {
      if (!data || Object.keys(data).length === 0) {
        console.log(`⚠️ No enrichment data provided for source: ${source}`);
        return null;
      }
  
      const enrichmentData = {
        companyId: new Types.ObjectId(companyId),
        sessionId: new Types.ObjectId(sessionId),
        icpModelId: new Types.ObjectId(icpModelId),
        data,
        source
      };
  
      const savedEnrichment = await Enrichment.create(enrichmentData);
      console.log(`✅ ${source} enrichment saved successfully`);
      return savedEnrichment;
    } catch (error) {
      console.error(`❌ Error saving ${source} enrichment:`, error);
      throw error;
    }
  }
  
  // Enhanced saveEmployees method
  private async saveEmployees(companyId: string, employees: any[]): Promise<number> {
    let savedCount = 0;
    
    for (const employee of employees) {
      try {
        // Validate required employee fields
        if (!employee.coresignal_employee_id && !employee.full_name) {
          console.warn("⚠️ Skipping employee - missing required fields:", employee);
          continue;
        }
  
        const employeeData = {
          companyId: new Types.ObjectId(companyId),
          coresignalEmployeeId: employee.coresignal_employee_id || 
                              employee.coresignalEmployeeId ||
                              Math.floor(Math.random() * 1000000), // Fallback ID
          parentId: employee.parent_id || employee.parentId,
          isDeleted: employee.is_deleted || employee.isDeleted || false,
          publicProfileId: employee.public_profile_id || employee.publicProfileId,
          linkedinUrl: employee.linkedin_url || employee.linkedinUrl,
          linkedinShorthandNames: employee.linkedin_shorthand_names || employee.linkedinShorthandNames || [],
          fullName: employee.full_name || employee.fullName,
          firstName: employee.first_name || employee.firstName,
          lastName: employee.last_name || employee.lastName,
          headline: employee.headline,
          summary: employee.summary,
          pictureUrl: employee.picture_url || employee.pictureUrl,
          locationCountry: employee.location_country || employee.locationCountry,
          locationCity: employee.location_city || employee.locationCity,
          locationFull: employee.location_full || employee.locationFull,
          connectionsCount: employee.connections_count || employee.connectionsCount,
          followersCount: employee.followers_count || employee.followersCount,
          isWorking: employee.is_working || employee.isWorking || false,
          activeExperienceTitle: employee.active_experience_title || employee.activeExperienceTitle,
          activeExperienceCompanyId: employee.active_experience_company_id || employee.activeExperienceCompanyId,
          activeExperienceDepartment: employee.active_experience_department || employee.activeExperienceDepartment,
          isDecisionMaker: employee.is_decision_maker || employee.isDecisionMaker || false,
          totalExperienceDurationMonths: employee.total_experience_duration_months || employee.totalExperienceDurationMonths,
          primaryProfessionalEmail: employee.primary_professional_email || employee.primaryProfessionalEmail,
          professionalEmails: employee.professional_emails || employee.professionalEmails || [],
          interests: employee.interests || [],
          inferredSkills: employee.inferred_skills || employee.inferredSkills || [],
          historicalSkills: employee.historical_skills || employee.historicalSkills || [],
          experienceDepartmentBreakdown: employee.experience_department_breakdown || employee.experienceDepartmentBreakdown || [],
          experienceManagementBreakdown: employee.experience_management_breakdown || employee.experienceManagementBreakdown || [],
          educationDegrees: employee.education_degrees || employee.educationDegrees || [],
          educationHistory: employee.education_history || employee.educationHistory || [],
          languages: employee.languages || [],
          githubUrl: employee.github_url || employee.githubUrl,
          githubUsername: employee.github_username || employee.githubUsername,
          experienceHistory: employee.experience_history || employee.experienceHistory || [],
          recommendationsCount: employee.recommendations_count || employee.recommendationsCount,
          recommendations: employee.recommendations || [],
          activities: employee.activities || [],
          awards: employee.awards || [],
          certifications: employee.certifications || [],
        };
  
        await Employee.create(employeeData);
        savedCount++;
      } catch (employeeError) {
        console.error("❌ Error saving employee:", employeeError);
        // Continue with next employee
      }
    }
  
    return savedCount;
  }
  /*async saveEmployees(companyId: string, employees: any[], session?: any) {
    try {
      const employeesToSave = employees.map(employeeData => {
        // Use the numeric ID from CoreSignal data
        // The ID field is the numeric value (283772448), not 'id'
        return {
          coresignalEmployeeId: employeeData.id, // This is the numeric ID from CoreSignal
          companyId: new Types.ObjectId(companyId),
          parentId: employeeData.parent_id,
          isDeleted: employeeData.is_deleted === 1 || employeeData.isDeleted,
          publicProfileId: employeeData.public_profile_id,
          linkedinUrl: employeeData.linkedin_url,
          linkedinShorthandNames: employeeData.linkedin_shorthand_names,
          fullName: employeeData.full_name,
          firstName: employeeData.first_name,
          lastName: employeeData.last_name,
          headline: employeeData.headline,
          summary: employeeData.summary,
          pictureUrl: employeeData.picture_url,
          locationCountry: employeeData.location_country,
          locationCity: employeeData.location_city,
          locationFull: employeeData.location_full,
          connectionsCount: employeeData.connections_count,
          followersCount: employeeData.followers_count,
          isWorking: employeeData.is_working === 1 || employeeData.isWorking,
          activeExperienceTitle: employeeData.active_experience_title,
          activeExperienceCompanyId: employeeData.active_experience_company_id,
          activeExperienceDepartment: employeeData.active_experience_department,
          isDecisionMaker: employeeData.is_decision_maker === 1 || employeeData.isDecisionMaker,
          totalExperienceDurationMonths: employeeData.total_experience_duration_months,
          primaryProfessionalEmail: employeeData.primary_professional_email,
          professionalEmails: employeeData.professional_emails_collection || employeeData.professionalEmails,
          interests: employeeData.interests,
          inferredSkills: employeeData.inferred_skills,
          historicalSkills: employeeData.historical_skills,
          experienceDepartmentBreakdown: employeeData.total_experience_duration_months_breakdown_department,
          experienceManagementBreakdown: employeeData.total_experience_duration_months_breakdown_management_level,
          educationDegrees: employeeData.education_degrees,
          educationHistory: employeeData.education,
          languages: employeeData.languages,
          githubUrl: employeeData.github_url,
          githubUsername: employeeData.github_username,
          experienceHistory: employeeData.experience,
          recommendationsCount: employeeData.recommendations_count,
          recommendations: employeeData.recommendations,
          activities: employeeData.activity,
          awards: employeeData.awards,
          certifications: employeeData.certifications
        };
      });
  
      const data = await Employee.create(employeesToSave, session ? { session } : {});
  
      console.log(`✅ Saved ${employeesToSave.length} employees for company ${companyId}`);
      return data;
    } catch (error) {
      console.error("Exception saving employees:", error);
      throw error;
    }
  }*/

  /*async saveEnrichment(
    companyId: string,
    sessionId: string,
    icpModelId: string,
    data: any,
    source: string,
    session?: any
  ) {
    try {
      const enrichment = {
        companyId: new Types.ObjectId(companyId),
        sessionId: new Types.ObjectId(sessionId),
        icpModelId: new Types.ObjectId(icpModelId),
        data,
        source
      };

      const result = await Enrichment.create([enrichment], session ? { session } : {});

      console.log(`✅ Enrichment saved for company ${companyId} from ${source}`);
      return result;
    } catch (error) {
      console.error("Exception saving enrichment:", error);
      throw error;
    }
  }*/

  async getSessionCompanies(sessionId: string): Promise<CompanyType[]> {
    const companies = await Company.find({ 
      sessionId: new Types.ObjectId(sessionId) 
    })
      .sort({ createdAt: -1 })
      .lean();

    return companies.map(this.mapCompanyToType);
  }

  async getCompaniesByUserId(userId: string): Promise<any> {
    try {
      // Find all sessions for this user
      const sessions = await Session.find({ userId }).select('_id').lean();
      const sessionIds = sessions.map((s: { _id: any; }) => s._id);

      // Find companies in those sessions
      const companies = await Company.find({ 
        sessionId: { $in: sessionIds } 
      }).lean();

      return companies;
    } catch (error) {
      console.error('Error fetching companies by user ID:', error);
      throw error;
    }
  }

  // =====================================================
  // ICP MODEL MANAGEMENT
  // =====================================================

  async saveIcpModel(modelData: Omit<ICPModelType, 'id' | 'createdAt' | 'updatedAt'>): Promise<ICPModelType> {
    if (modelData.isPrimary) {
      // Remove primary status from other models
      await ICPModel.updateMany(
        { userId: modelData.userId, isPrimary: true },
        { isPrimary: false }
      );
    }

    const icpModel = await ICPModel.create({
      name: modelData.name,
      isPrimary: modelData.isPrimary,
      userId: modelData.userId,
      config: modelData.config
    });
    console.log("icp created ",icpModel)

    return this.mapIcpModelToType(icpModel);
  }

  async getIcpModels(userId: string): Promise<ICPModelType[]> {
    const models = await ICPModel.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return models.map(this.mapIcpModelToType);
  }

  async getIcpModel(modelId: string): Promise<ICPModelType | null> {
    try {
      const model = await ICPModel.findById(modelId).lean();
      return model ? this.mapIcpModelToType(model) : null;
    } catch (error) {
      return null;
    }
  }

  async setPrimaryModel(modelId: string, userId: string): Promise<void> {
    // Remove primary status from all user models
    await ICPModel.updateMany(
      { userId },
      { isPrimary: false }
    );

    // Set new primary model
    await ICPModel.findByIdAndUpdate(
      modelId,
      { isPrimary: true, updatedAt: new Date() }
    );
  }

  async deleteIcpModel(modelId: string): Promise<void> {
    await ICPModel.findByIdAndDelete(modelId);
  }

  // =====================================================
  // SUBSTEP MANAGEMENT
  // =====================================================

  async updateSubstep(sessionId: string, substep: SubStep): Promise<void> {
    await SessionSubstep.findOneAndUpdate(
      { 
        sessionId: new Types.ObjectId(sessionId),
        stepId: substep.id 
      },
      {
        sessionId: new Types.ObjectId(sessionId),
        stepId: substep.id,
        name: substep.name,
        description: substep.description,
        status: substep.status,
        category: substep.category,
        priority: substep.priority,
        tools: substep.tools,
        message: substep.message,
        progress: substep.progress,
        startedAt: substep.startedAt,
        completedAt: substep.completedAt
      },
      { upsert: true, new: true }
    );
  }

  async getSessionSubsteps(sessionId: string): Promise<SubStep[]> {
    const substeps = await SessionSubstep.find({ 
      sessionId: new Types.ObjectId(sessionId) 
    })
      .sort('stepId')
      .lean();

    return substeps.map(this.mapSubstepToType);
  }

  // =====================================================
  // UTILITY/MAPPING METHODS
  // =====================================================

  private mapSessionToType(
    session: any, 
    companies: any[] = [], 
    substeps: any[] = []
  ): SearchSession {
    return {
      id: session._id.toString(),
      name: session.name,
      query: session.query || [],
      resultsCount: session.resultsCount || 0,
      companies: companies.map(c => this.mapCompanyToType(c)),
      searchStatus: session.searchStatus || {
        stage: 'idle',
        message: 'Session created',
        progress: 0,
        currentStep: 0,
        totalSteps: 4,
        substeps: []
      },
      icpModelId: session.icpModelId?.toString(),
      userId: session.userId,
      createdAt: new Date(session.createdAt)
    };
  }
  private mapCompanyToType(data: any): CompanyType {
    console.log('🔍 Raw company data:', data)
    
    // Debug employees data
    console.log('🔍 Employees data:', {
      rawEmployees: data.employees,
      employeeCount: data.employeeCount,
      isArray: Array.isArray(data.employees),
      type: typeof data.employees
    })
  
    // Handle employees data properly
    let employeeCount = data.employeeCount || 0
    if (Array.isArray(data.employees)) {
      employeeCount = data.employees.length
    }
  
    const mappedCompany = {
      id: data._id?.toString() || data.id,
      name: data.name,
      description: data.description,
      about: data.about,
      industry: data.industry || '',
      employees: employeeCount,
      location: {
        city: data.city,
        country: data.country,
        country_code: data.countryCode
      },
      logo_url: data.logoUrl || data.logo_url,
      website: data.website,
      linkedin_url: data.linkedinUrl || data.linkedin_url,
      icp_score: data.icp_score,
      intent_score: data.intent_score,
      technologies: data.technologies || [],
      funding: data.funding,
      revenue: data.revenue || data.annualRevenue,
      annual_revenue: data.annualRevenue,
      annual_revenue_currency: data.annualRevenueCurrency,
      total_funding: data.totalFunding,
      employee_count: employeeCount,
      founded_year: data.foundedYear,
      funding_stage: data.fundingStage,
      target_market: data.targetMarket,
      ownership_type: data.ownershipType,
      contact_email: data.contactEmail,
      contact_phone: data.contactPhone,
      twitter_url: data.twitterUrl,
      facebook_url: data.facebookUrl,
      instagram_url: data.instagramUrl,
      crunchbase_url: data.crunchbaseUrl,
      scoring_metrics: data.scoringMetrics,
      intent_signals: data.intentSignals,
      relationships: data.relationships,
      company_id: data._id?.toString() || data.id,
      session_id: data.sessionId?.toString(),
      icp_model_id: data.icpModelId?.toString(),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
      last_funding_date: data.last_funding_date,
      hiring: data.hiring || false,
      growth_signals: data.growth_signals || [],
      explorium_id: data.explorium_id,
      content: ''
    }
  
    console.log('🔍 Mapped company:', mappedCompany)
    return mappedCompany
  }
  private mapIcpModelToType(data: any): ICPModelType {
    return {
      id: data._id.toString(),
      name: data.name,
      isPrimary: data.isPrimary,
      userId: data.userId,
      config: data.config,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt)
    };
  }

  private mapSubstepToType(data: any): SubStep {
    return {
      id: data.stepId,
      name: data.name,
      description: data.description,
      status: data.status,
      category: data.category,
      priority: data.priority,
      tools: data.tools || [],
      message: data.message,
      progress: data.progress,
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined
    };
  }

  // Additional method for legacy insertEmployees
// In MongoDBService.ts - fix the insertEmployees method
async insertEmployees(employeesData: any[], targetCompanyId: string) {
    console.log("--------------------------------------");
    console.log("Employees data:", employeesData);
    
    if (!employeesData || !Array.isArray(employeesData) || employeesData.length === 0) {
      console.log("No employees data to save");
      return [];
    }
    
    return await this.saveEmployees(targetCompanyId, employeesData);
  }


}

export const mongoDBService = new MongoDBService();