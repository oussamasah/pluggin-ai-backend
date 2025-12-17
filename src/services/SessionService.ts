// src/services/SessionService.ts
import { SearchSession, ICPModel, Company, SearchStatus, SubStep } from '../core/types.js';

import { mongoDBService } from './MongoDBService.js';

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
    return await mongoDBService.createSession(userId, name);
  }

  async getSession(sessionId: string): Promise<SearchSession | null> {
    return await mongoDBService.getSession(sessionId);
  }

  async getUserSessions(userId: string): Promise<SearchSession[]> {
    return await mongoDBService.getUserSessions(userId);
  }

  async updateSessionQuery(sessionId: string, query: string[]): Promise<SearchSession> {
    return await mongoDBService.updateSessionQuery(sessionId, query);
  }

  async updateSearchStatus(sessionId: string, status: Partial<SearchStatus>): Promise<SearchSession> {
    return await mongoDBService.updateSearchStatus(sessionId, status);
  }

  async updateSubstep(sessionId: string, substep: SubStep): Promise<void> {
    return await mongoDBService.updateSubstep(sessionId, substep);
  }

  async saveCompanies(sessionId: string, companies: Company[]): Promise<void> {
    return await mongoDBService.saveCompanies(sessionId, companies);
  }

  async getSearchStatus(sessionId: string): Promise<any> {
    return await mongoDBService.getSearchStatus(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return await mongoDBService.deleteSession(sessionId);
  }

  // ICP Model Management
  async saveIcpModel(modelData: Omit<ICPModel, 'id' | 'createdAt' | 'updatedAt'>): Promise<ICPModel> {
    return await mongoDBService.saveIcpModel(modelData);
  }

  async getIcpModels(userId: string): Promise<ICPModel[]> {
    return await mongoDBService.getIcpModels(userId);
  }
  async getIcpModelById(icpModelId: string): Promise<ICPModel[]> {
    return await mongoDBService.getIcpModels(icpModelId);
  }
  async getIcpModel(modelId: string): Promise<ICPModel | null> {
    return await mongoDBService.getIcpModel(modelId);
  }

  async setPrimaryModel(modelId: string, userId: string): Promise<void> {
    return await mongoDBService.setPrimaryModel(modelId, userId);
  }

  async deleteIcpModel(modelId: string): Promise<void> {
    return await mongoDBService.deleteIcpModel(modelId);
  }
  // In your SessionService.ts - add this method
async updateSessionRefinementState(
  sessionId: string,
  stage: 'initial' | 'proposed' | 'refining' | 'confirmed' | 'searching',
  currentQuery?: string,
  proposalHistory?: Array<{
    query: string;
    timestamp: Date;
    userFeedback?: string;
  }>
): Promise<SearchSession | null> {
  return await mongoDBService.updateSessionRefinementState(
    sessionId,
    stage,
    currentQuery,
    proposalHistory
  );
}
async updateSession(
  sessionId: string, 
  updates: any
): Promise<SearchSession | null> {
  return await mongoDBService.updateSession(sessionId,updates)
}
}

export const sessionService = SessionService.getInstance();