// src/services/GTMIntelligenceService.ts
import { Types } from 'mongoose';
import { GTMIntelligence, IGTMIntelligence } from '../models/GTMIntelligence';
import { Company } from '../models/Company';
import { ICPModel } from '../models/ICPModel';
import { generateGTMAnalysisPrompt } from '../utils/promptGenerator';
import { config } from '../core/config';
import { openRouterService } from '../utils/OpenRouterService';

export interface CoreSignalData {
  [key: string]: any;
}

export class GTMIntelligenceService {
 
  /**
   * Generate complete GTM Intelligence with Claude and save
   */
  async generateCompleteGTMIntelligence(
    sessionId: Types.ObjectId,
    icpModelId: Types.ObjectId,
    companyId: Types.ObjectId,
    coresignalData: CoreSignalData
  ): Promise<IGTMIntelligence> {
    try {
      console.log('Starting GTM Intelligence generation...');
      console.log('coresignalData',coresignalData);

      // Get company and ICP model data
      const company = await Company.findById(companyId);
      const icpModel = await ICPModel.findById(icpModelId);

      if (!company) {
        throw new Error('Company not found');
      }
      if (!icpModel) {
        throw new Error('ICP Model not found');
      }

      console.log('Generating analysis with Claude...');

      // Generate markdown analysis using Claude
      const markdownAnalysis = await this.generateMarkdownAnalysis(coresignalData, icpModel);

      console.log('Creating GTM Intelligence record...');

      // Create and save GTM Intelligence record
      const gtmIntelligenceData = {
        sessionId,
        icpModelId,
        companyId,
        // Save entire markdown in overview field
        overview: markdownAnalysis,
        // Set other fields as empty or default values
        employeeAnalysis: 'Available in overview markdown',
        financialAnalysis: 'Available in overview markdown',
        technologyAnalysis: 'Available in overview markdown',
        intentSignals: 'Available in overview markdown',
        competitorAnalysis: 'Available in overview markdown',
        gtmStrategy: 'Available in overview markdown',
        recommendations: 'Available in overview markdown',
        
        // Scoring
        icpFitScore: this.calculateScoreFromMarkdown(markdownAnalysis),
        confidenceScore: 80,
        dataCompleteness: 85,
        dataSources: ['coresignal', 'claude-haiku'],
        refreshStatus: 'completed' as const,
        lastRefreshed: new Date()
      };

      const gtmIntel = new GTMIntelligence(gtmIntelligenceData);
      const savedIntel = await gtmIntel.save();

      console.log('✅ GTM Intelligence saved successfully');
      console.log(`📊 Markdown analysis saved in overview field (${markdownAnalysis.length} characters)`);

      return savedIntel;
    } catch (error) {
      console.error('❌ Failed to generate complete GTM Intelligence:', error);
      throw new Error(`Failed to generate complete GTM Intelligence: ${error.message}`);
    }
  }

  /**
   * Generate markdown analysis using Claude
   */
  private async generateMarkdownAnalysis(
    coresignalData: CoreSignalData,
    icpModel: any
  ): Promise<string> {
    try {
      // Generate prompt
      const prompt = generateGTMAnalysisPrompt(coresignalData, icpModel);

      console.log('Calling Claude API...');
      // Call Claude service - get the raw markdown response
      const markdownResponse = await openRouterService.generate(prompt, undefined,config.OLLAMA_MODEL);
      

      console.log('Claude response received, saving as markdown...');

      // Return the raw markdown to be saved in overview field
      return markdownResponse;
    } catch (error) {
      console.error('Failed to generate markdown analysis from Claude:', error);
      throw error;
    }
  }

  /**
   * Calculate a simple score based on markdown content quality
   */
  private calculateScoreFromMarkdown(markdown: string): number {
    let score = 50; // Base score
    
    // Add points for comprehensive analysis
    if (markdown.includes('## Executive Summary')) score += 10;
    if (markdown.includes('## Products & Services')) score += 10;
    if (markdown.includes('## Financial Health')) score += 10;
    if (markdown.includes('## Recommendations')) score += 10;
    
    // Add points for data richness
    const wordCount = markdown.split(/\s+/).length;
    if (wordCount > 1000) score += 10;
    if (wordCount > 2000) score += 10;
    
    return Math.min(score, 100);
  }

  /**
   * Get GTM Intelligence by session and company
   */
  async getGTMIntelligenceBySessionAndCompany(
    sessionId: Types.ObjectId,
    companyId: Types.ObjectId
  ): Promise<IGTMIntelligence | null> {
    return await GTMIntelligence.findOne({ sessionId, companyId })
      .populate('company')
      .populate('icpModel');
  }

  /**
   * Get all GTM Intelligence records for a session
   */
  async getGTMIntelligenceBySession(
    sessionId: Types.ObjectId
  ): Promise<IGTMIntelligence[]> {
    return await GTMIntelligence.find({ sessionId })
      .populate('company')
      .populate('icpModel')
      .sort({ icpFitScore: -1 });
  }

  /**
   * Delete GTM Intelligence record
   */
  async deleteGTMIntelligence(id: Types.ObjectId): Promise<boolean> {
    const result = await GTMIntelligence.findByIdAndDelete(id);
    return !!result;
  }
}

export const gtmIntelligenceService = new GTMIntelligenceService();