// src/services/GTMPersonaIntelligenceService.ts
import { Types } from 'mongoose';
import { Employee } from '../models/Employee';
import { ICPModel } from '../models/ICPModel';
import { generateGTMPersonaPrompt } from '../utils/promptGenerator';
import { config } from '../core/config';
import { openRouterService } from '../utils/OpenRouterService';
import { GTMPersonaIntelligence } from '../models/GTMPersonaIntelligence';

export class GTMPersonaIntelligenceService {
  
  /**
   * Batch generate persona intelligence for employees
   */
  async batchGeneratePersonaIntelligence(
    sessionId: Types.ObjectId,
    icpModelId: Types.ObjectId,
    companyId: Types.ObjectId,
    userId:string
  ): Promise<{
    success: number;
    failed: number;
    total: number;
  }> {
    try {
      console.log(`🎯 Starting persona generation for company: ${companyId}`);
      
      // 1. Get ICP model
      const icpModel = await ICPModel.findById(icpModelId);
      if (!icpModel) {
        throw new Error(`ICP Model not found: ${icpModelId}`);
      }
      
      // 2. Get employees
      const employees = await Employee.find({ companyId });
      
      if (!employees || employees.length === 0) {
        console.log(`⚠️ No employees found for company: ${companyId}`);
        return { success: 0, failed: 0, total: 0 };
      }
      
      console.log(`👥 Found ${employees.length} employees`);
      
      // 3. Prepare product data
      const productData = {
        name: icpModel.config?.productSettings?.productNames?.[0] || 'Your Product',
        value_proposition: icpModel.config?.productSettings?.valueProposition || 'Not specified',
        unique_selling_points: icpModel.config?.productSettings?.uniqueSellingPoints || [],
        pain_points_solved: icpModel.config?.productSettings?.painPointsSolved || []
      };
      
      // 4. Process employees
      let successCount = 0;
      let failedCount = 0;
      
      for (const employee of employees) {
        try {
          await this.processEmployee(
            sessionId,
            icpModelId,
            companyId,
            employee,
            productData,
            userId
          );
          successCount++;
          console.log(`✅ Generated persona for ${employee.fullName}`);
          
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          failedCount++;
          console.error(`❌ Failed for ${employee.fullName}:`, error);
        }
      }
      
      console.log(`🎉 Completed: ${successCount} succeeded, ${failedCount} failed`);
      
      return {
        success: successCount,
        failed: failedCount,
        total: employees.length
      };
      
    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }
  
  /**
   * Process a single employee
   */
  private async processEmployee(
    sessionId: Types.ObjectId,
    icpModelId: Types.ObjectId,
    companyId: Types.ObjectId,
    employee: any,
    productData: any,
    userId:string
  ): Promise<void> {
    try {
      // Check if exists
      const existing = await GTMPersonaIntelligence.findOne({
        sessionId,
        employeeId: employee._id
      });
      
      if (existing) {
        return;
      }
      
      // Prepare employee data
      const employeeData = {
      
        fullName: employee.fullName,
        activeExperienceTitle: employee.activeExperienceTitle,
        headline: employee.headline,
        summary: employee.summary,
        locationFull: employee.locationFull,
        connectionsCount: employee.connectionsCount,
        followersCount: employee.followersCount,
        totalExperienceDurationMonths: employee.totalExperienceDurationMonths,
        inferredSkills: employee.inferredSkills || [],
        primaryProfessionalEmail: employee.primaryProfessionalEmail,
        coresignalEmployeeId: employee.coresignalEmployeeId,
        isDecisionMaker: employee.isDecisionMaker,
        activeExperienceDepartment: employee.activeExperienceDepartment
      };
      
      // Company data (simplified)
      const companyGTMData = {
        high_urgency_pain_points: [],
        industry: 'Unknown'
      };
      
      // Generate prompt and analysis
      const prompt = await generateGTMPersonaPrompt(employeeData, productData, companyGTMData);
      
      const analysis = await openRouterService.generate(
        prompt,
        undefined,
        config.OLLAMA_MODEL || "anthropic/claude-3-haiku",
        2000
      );
      
      // Format overview
      const overview = this.formatEmployeeAnalysis(analysis, employee);
      
      // Save to GTMPersonaIntelligence
      const personaIntel = new GTMPersonaIntelligence({
        userId: userId,
        sessionId,
        icpModelId,
        companyId,
        employeeId: employee._id,
        overview
      });
      
      await personaIntel.save();
      
    } catch (error) {
      console.error(`❌ Failed for ${employee.fullName}:`, error);
      throw error;
    }
  }
  
  /**
   * Format employee analysis for overview
   */
  private formatEmployeeAnalysis(analysis: string, employee: any): string {
    const timestamp = new Date().toISOString();
    return `# PERSONA INTELLIGENCE REPORT
Generated: ${timestamp}
Employee: ${employee.fullName}
Role: ${employee.activeExperienceTitle || 'Not specified'}
Email: ${employee.primaryProfessionalEmail || 'Not available'}

${analysis}`;
  }
  
  /**
   * Get persona for employee
   */
  async getPersonaForEmployee(
    sessionId: Types.ObjectId,
    employeeId: Types.ObjectId
  ): Promise<GTMPersonaIntelligence | null> {
    try {
      const personaIntel = await GTMPersonaIntelligence.findOne({
        sessionId,
        employeeId
      })
      .populate('employeeId', 'fullName activeExperienceTitle')
      .lean();
      
      return personaIntel;
    } catch (error) {
      console.error('Error getting persona:', error);
      return null;
    }
  }
  
  /**
   * Generate persona for single employee (on-demand)
   */
  async generateSinglePersona(
    sessionId: Types.ObjectId,
    icpModelId: Types.ObjectId,
    companyId: Types.ObjectId,
    employeeId: Types.ObjectId
  ): Promise<GTMPersonaIntelligence> {
    try {
      const [employee, icpModel] = await Promise.all([
        Employee.findById(employeeId),
        ICPModel.findById(icpModelId)
      ]);
      
      if (!employee) throw new Error('Employee not found');
      if (!icpModel) throw new Error('ICP model not found');
      
      // Check if exists
      const existing = await GTMPersonaIntelligence.findOne({
        sessionId,
        employeeId
      });
      
      if (existing) {
        return existing;
      }
      
      // Prepare data
      const productData = {
        name: icpModel.config?.productSettings?.productNames?.[0] || 'Your Product',
        value_proposition: icpModel.config?.productSettings?.valueProposition || 'Not specified',
        unique_selling_points: icpModel.config?.productSettings?.uniqueSellingPoints || [],
        pain_points_solved: icpModel.config?.productSettings?.painPointsSolved || []
      };
      
      const employeeData = {
        fullName: employee.fullName,
        activeExperienceTitle: employee.activeExperienceTitle,
        headline: employee.headline,
        summary: employee.summary,
        locationFull: employee.locationFull,
        connectionsCount: employee.connectionsCount,
        followersCount: employee.followersCount,
        totalExperienceDurationMonths: employee.totalExperienceDurationMonths,
        inferredSkills: employee.inferredSkills || [],
        primaryProfessionalEmail: employee.primaryProfessionalEmail,
        coresignalEmployeeId: employee.coresignalEmployeeId,
        isDecisionMaker: employee.isDecisionMaker,
        activeExperienceDepartment: employee.activeExperienceDepartment
      };
      
      const companyGTMData = {
        high_urgency_pain_points: [],
        industry: 'Unknown'
      };
      
      // Generate
      const prompt = await generateGTMPersonaPrompt(employeeData, productData, companyGTMData);
      
      const analysis = await openRouterService.generate(
        prompt,
        undefined,
        config.OLLAMA_MODEL || "anthropic/claude-3-haiku",
        2000
      );
      
      // Save
      const overview = this.formatEmployeeAnalysis(analysis, employee);
      
      const personaIntel = new GTMPersonaIntelligence({
        sessionId,
        icpModelId,
        companyId,
        employeeId,
        overview
      });
      
      await personaIntel.save();
      return personaIntel;
      
    } catch (error) {
      console.error('Error generating single persona:', error);
      throw error;
    }
  }
}

export const gtmPersonaIntelligenceService = new GTMPersonaIntelligenceService();