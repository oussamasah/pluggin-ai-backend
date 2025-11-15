// src/services/SupabaseService.ts
import { createClient } from '@supabase/supabase-js';
import { Company, SearchSession, ICPModel, SearchStatus, SubStep } from '../core/types.js';
import { v4 as uuidv4} from 'uuid';
export class SupabaseService {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!
    );
  }

  // Session Management
  async createSession(userId: string, name: string): Promise<SearchSession> {
    const { data, error } = await this.supabase
      .from('sessions')
      .insert({
        name,
        user_id: userId,
        search_status: {
          stage: 'idle',
          message: 'Session created',
          progress: 0,
          currentStep: 0,
          totalSteps: 4,
          substeps: []
        }
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapSessionFromDB(data);
  }

  async getSession(sessionId: string): Promise<SearchSession | null> {
    const { data, error } = await this.supabase
      .from('sessions')
      .select(`
        *,
        companies (*),
        session_substeps (*)
      `)
      .eq('id', sessionId)
      .single();

    if (error) return null;
    return this.mapSessionFromDB(data);
  }

// src/services/SupabaseService.ts

async getUserSessions(userId: string): Promise<SearchSession[]> {
  const { data, error } = await this.supabase
    .from('sessions')
    .select(`
      *,
      companies (
        *,
        employees (*)
      ),
      session_substeps (*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching user sessions:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    return [];
  }
console.log("-----------------------------",  data[0])
console.log(data[0])
  return data.map(this.mapSessionFromDB.bind(this));
}
  async updateSessionQuery(sessionId: string, query: string[]): Promise<SearchSession> {
   
  
    const { data, error } = await this.supabase
      .from('sessions')
      .update({ 
        query: query, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', sessionId)
      .select()
      .single();
  
    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }
  
 
  
    const mappedSession = this.mapSessionFromDB(data);
    

  
    return mappedSession;
  }

  async updateSearchStatus(sessionId: string, status: Partial<SearchStatus>): Promise<SearchSession> {
    const { data, error } = await this.supabase
      .from('sessions')
      .update({ 
        search_status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return this.mapSessionFromDB(data);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId);

    return !error;
  }
  async saveCompanyWithSessionAndICP(
    sessionId: string,
    icpModelId: string,
    companyData: any
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      const {
        enrichement,
        business_model,
        location,
        contact,
        social_profiles,
        revenue_estimated,
        ...cleanCompanyData
      } = companyData;
  
      const companyToSave = {
        ...cleanCompanyData,
        company_id:companyData.company_id,
        session_id: sessionId,
        icp_model_id: icpModelId,
        city: location?.city || null,
        country: location?.country || null,
        country_code: location?.country_code || null,
        contact_email: contact?.email || null,
        contact_phone: contact?.phone || null,
        linkedin_url: social_profiles?.linkedin || null,
        twitter_url: social_profiles?.twitter || null,
        facebook_url: social_profiles?.facebook || null,
        instagram_url: social_profiles?.instagram || null,
        crunchbase_url: social_profiles?.crunchbase || null,
        annual_revenue:
          revenue_estimated?.source_5_annual_revenue?.annual_revenue || null,
        annual_revenue_currency:
          revenue_estimated?.source_5_annual_revenue?.annual_revenue_currency ||
          null,
        industry: companyData.industry || [],
        technologies: companyData.technologies || [],
        intent_signals: companyData.intent_signals || [],
        relationships: companyData.relationships || {},
      };
  console.log("saving company =====>",companyToSave)
      const { data, error } = await this.supabase
        .from("companies")
        .insert([companyToSave])
        .select();
  
      if (error) {
        console.error("Error saving company to Supabase:", error);
        return { success: false, error: error.message };
      }
  
      // ✅ Fix: data is an array; get the first element
      const companyId = data?.[0]?.company_id;
  
      if (!companyId) {
        console.error("Company ID missing after insert:", data);
        return { success: false, error: "Missing company ID after insert" };
      }
  
      // Save enrichment linked to the inserted company
      await this.saveEnrichment(
        companyId,
        sessionId,
        icpModelId,
        companyData.enrichement,
        "Coresignal"
      );
  
      return { success: true, data: data[0] };
    } catch (error) {
      console.error("Exception saving company to Supabase:", error);
      return { success: false, error: "Failed to save company data" };
    }
  }
  
  async saveEnrichment(
    company_id: string,
    session_id: string,
    icp_model_id: string,
    data: JSON,
    source: string
  ) {
    const result = await this.supabase
      .from("enrichments")
      .insert([
        {
          company_id,
          session_id,
          icp_model_id,
          data,
          source,
        },
      ])
      .select();
  //console.log("enrichement saved sussessfuly",result)
    if (result.error) {
      console.error("Error inserting enrichment:", result.error);
      throw result.error;
    }
  
    return result.data;
  }
  
  async getSessionCompanies(sessionId: string): Promise<Company[]> {
    const { data, error } = await this.supabase
      .from('companies')
      .select('*')
      .eq('session_id', sessionId)
      .order('icp_score', { ascending: false });

    if (error) throw error;
    return data.map(this.mapCompanyFromDB);
  }

  // ICP Model Management
  async saveIcpModel(modelData: Omit<ICPModel, 'id' | 'createdAt' | 'updatedAt'>): Promise<ICPModel> {
    if (modelData.isPrimary) {
      // Remove primary status from other models
      await this.supabase
        .from('icp_models')
        .update({ is_primary: false })
        .eq('user_id', modelData.userId)
        .eq('is_primary', true);
    }

    const { data, error } = await this.supabase
      .from('icp_models')
      .insert({
        name: modelData.name,
        is_primary: modelData.isPrimary,
        user_id: modelData.userId,
        config: modelData.config
      })
      .select()
      .single();

    if (error) throw error;
    return this.mapIcpModelFromDB(data);
  }

  async getIcpModels(userId: string): Promise<ICPModel[]> {
    const { data, error } = await this.supabase
      .from('icp_models')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(this.mapIcpModelFromDB);
  }

  async getIcpModel(modelId: string): Promise<ICPModel | null> {
    const { data, error } = await this.supabase
      .from('icp_models')
      .select('*')
      .eq('id', modelId)
      .single();

    if (error) return null;
    return this.mapIcpModelFromDB(data);
  }

  async setPrimaryModel(modelId: string, userId: string): Promise<void> {
    // Remove primary status from all user models
    await this.supabase
      .from('icp_models')
      .update({ is_primary: false })
      .eq('user_id', userId);

    // Set new primary model
    const { error } = await this.supabase
      .from('icp_models')
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq('id', modelId)
      .eq('user_id', userId);

    if (error) throw error;
  }

  async deleteIcpModel(modelId: string): Promise<void> {
    const { error } = await this.supabase
      .from('icp_models')
      .delete()
      .eq('id', modelId);

    if (error) throw error;
  }

  // SubStep Management
  async updateSubstep(sessionId: string, substep: SubStep): Promise<void> {
    const { error } = await this.supabase
      .from('session_substeps')
      .upsert({
        session_id: sessionId,
        step_id: substep.id,
        name: substep.name,
        description: substep.description,
        status: substep.status,
        category: substep.category,
        priority: substep.priority,
        tools: substep.tools,
        message: substep.message,
        progress: substep.progress,
        started_at: substep.startedAt,
        completed_at: substep.completedAt
      }, {
        onConflict: 'session_id,step_id'
      });

    if (error) throw error;
  }
  async getSessionSubsteps(sessionId: string): Promise<SubStep[]> {
    const { data, error } = await this.supabase
      .from('session_substeps')
      .select('*')
      .eq('session_id', sessionId)
      .order('step_id');

    if (error) throw error;
    return data.map(this.mapSubstepFromDB);
  }

// Add this method to your SupabaseService class
async getSearchStatus(sessionId: string): Promise<SearchStatus | null> {
  try {
    const { data, error } = await this.supabase
      .from('sessions')
      .select('search_status')
      .eq('id', sessionId)
      .single();

    if (error) {
      console.error('Error getting search status:', error);
      return null;
    }

    return data.search_status as SearchStatus;
  } catch (error) {
    console.error('Error in getSearchStatus:', error);
    return null;
  }
}
  // Utility Methods
  private mapSessionFromDB(data: any): SearchSession {
    return {
      id: data.id,
      name: data.name,
      query: data.query || [], // ←←← FIX: Change '' to []
      resultsCount: data.results_count || 0,
      companies: data.companies ? data.companies.map((c: any) => this.mapCompanyFromDB(c)) : [],
      searchStatus: data.search_status || {
        stage: 'idle',
        message: 'Session created',
        progress: 0,
        currentStep: 0,
        totalSteps: 4,
        substeps: []
      },
      icpModelId: data.icp_model_id,
      userId: data.user_id,
      createdAt: new Date(data.created_at),
    };
  }

  private mapCompanyFromDB(data: any): Company {
    return {
  id: data.id,
  name: data.name,
  description: data.description || undefined,
  about: data.about || undefined,
  industry: data.industry || '',
  employees: data.employees || 0,
  location: data.location || '',
  logo_url: data.logo_url || undefined,
  website: data.website || undefined,
  linkedin_url: data.linkedin_url || undefined,
  icp_score: data.icp_score || undefined,
  intent_score: data.intent_score || undefined,
  technologies: data.technologies || [],
  funding: data.funding || undefined,
  revenue: data.revenue || undefined,
  last_funding_date: data.last_funding_date ? new Date(data.last_funding_date) : undefined,
  hiring: data.hiring || false,
  growth_signals: data.growth_signals || [],
  explorium_id: data.explorium_id || undefined,
  content: ''
};
  }

  private mapIcpModelFromDB(data: any): ICPModel {
    return {
      id: data.id,
      name: data.name,
      isPrimary: data.is_primary,
      userId: data.user_id,
      config: data.config,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  private mapSubstepFromDB(data: any): SubStep {
    return {
      id: data.step_id,
      name: data.name,
      description: data.description,
      status: data.status as any,
      category: data.category,
      priority: data.priority as any,
      tools: data.tools || [],
      message: data.message,
      progress: data.progress,
      startedAt: data.started_at ? new Date(data.started_at) : undefined,
      completedAt: data.completed_at ? new Date(data.completed_at) : undefined
    };
  }


  
async  insertEmployees(employeesData: any[], targetCompanyId: any) {
  console.log("--------------------------------------")
  console.log(employeesData)
  if( !employeesData) return;
  const employeesToInsert = employeesData.map(employee => ({
      id: employee.id,
      company_id: targetCompanyId, // Your target company foreign key
      parent_id: employee.parent_id,
      created_at: employee.created_at,
      updated_at: employee.updated_at,
      is_deleted: employee.is_deleted === 1,
      
      // Profile info
      public_profile_id: employee.public_profile_id,
      linkedin_url: employee.linkedin_url,
      linkedin_shorthand_names: employee.linkedin_shorthand_names,
      full_name: employee.full_name,
      first_name: employee.first_name,
      last_name: employee.last_name,
      headline: employee.headline,
      summary: employee.summary,
      picture_url: employee.picture_url,
      
      // Location
      location_country: employee.location_country,
      location_city: employee.location_city,
      location_full: employee.location_full,
      
      // Social metrics
      connections_count: employee.connections_count,
      followers_count: employee.followers_count,
      
      // Professional info
      is_working: employee.is_working === 1,
      active_experience_title: employee.active_experience_title,
      active_experience_company_id: employee.active_experience_company_id,
      active_experience_department: employee.active_experience_department,
      is_decision_maker: employee.is_decision_maker === 1,
      total_experience_duration_months: employee.total_experience_duration_months,
      
      // Contact
      primary_professional_email: employee.primary_professional_email,
      professional_emails: employee.professional_emails_collection,
      
      // Skills and interests
      interests: employee.interests,
      inferred_skills: employee.inferred_skills,
      historical_skills: employee.historical_skills,
      
      // Experience breakdown
      experience_department_breakdown: employee.total_experience_duration_months_breakdown_department,
      experience_management_breakdown: employee.total_experience_duration_months_breakdown_management_level,
      
      // Education
      education_degrees: employee.education_degrees,
      education_history: employee.education,
      
      // Languages
      languages: employee.languages,
      
      // GitHub
      github_url: employee.github_url,
      github_username: employee.github_username,
      
      // Full experience history
      experience_history: employee.experience,
      
      // Recommendations
      recommendations_count: employee.recommendations_count,
      recommendations: employee.recommendations,
      
      // Activities
      activities: employee.activity,
      
      // Awards
      awards: employee.awards,
      
      // Certifications
      certifications: employee.certifications
  }));

  const { data, error } = await  this.supabase
      .from('employees')
      .insert(employeesToInsert)
      .select();

  if (error) {
      console.error('Error inserting employees:', error);
      return null;
  }

  console.log(`Successfully inserted ${data.length} employees`);
  return data;
}

}

export const supabaseService = new SupabaseService();