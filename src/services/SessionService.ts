// src/services/SessionService.ts
import { SearchSession, ICPModel, Company, SearchStatus, SubStep } from '../core/types.js';
import { supabaseService } from './SupabaseService.js';

export class SessionService {
  private static instance: SessionService;

  public static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService();
    }
    return SessionService.instance;
  }

  // Session Management
  async createSession(userId: string, name: string): Promise<SearchSession> {
    return await supabaseService.createSession(userId, name);
  }

  async getSession(sessionId: string): Promise<SearchSession | null> {
    return await supabaseService.getSession(sessionId);
  }

  async getUserSessions(userId: string): Promise<SearchSession[]> {
    return await supabaseService.getUserSessions(userId);
  }

  async updateSessionQuery(sessionId: string, query: string[]): Promise<SearchSession> {
    return await supabaseService.updateSessionQuery(sessionId, query);
  }

  async updateSearchStatus(sessionId: string, status: Partial<SearchStatus>): Promise<SearchSession> {
    return await supabaseService.updateSearchStatus(sessionId, status);
  }

  async updateSubstep(sessionId: string, substep: SubStep): Promise<void> {
    return await supabaseService.updateSubstep(sessionId, substep);
  }

  async saveCompanies(sessionId: string, companies: Company[]): Promise<void> {
    return await supabaseService.saveCompanies(sessionId, companies);
  }

  async getSearchStatus(sessionId: string): Promise<any> {
    return await supabaseService.getSearchStatus(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return await supabaseService.deleteSession(sessionId);
  }

  // ICP Model Management
  async saveIcpModel(modelData: Omit<ICPModel, 'id' | 'createdAt' | 'updatedAt'>): Promise<ICPModel> {
    return await supabaseService.saveIcpModel(modelData);
  }

  async getIcpModels(userId: string): Promise<ICPModel[]> {
    return await supabaseService.getIcpModels(userId);
  }
  async getIcpModelById(icpModelId: string): Promise<ICPModel[]> {
    return await supabaseService.getIcpModels(icpModelId);
  }
  async getIcpModel(modelId: string): Promise<ICPModel | null> {
    return await supabaseService.getIcpModel(modelId);
  }

  async setPrimaryModel(modelId: string, userId: string): Promise<void> {
    return await supabaseService.setPrimaryModel(modelId, userId);
  }

  async deleteIcpModel(modelId: string): Promise<void> {
    return await supabaseService.deleteIcpModel(modelId);
  }
}

export const sessionService = SessionService.getInstance();