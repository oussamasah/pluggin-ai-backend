// src/controllers/EmployeeController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { Types } from 'mongoose';
import { Session } from '../models/Session.js';
import { Employee } from '../models/Employee.js';
import { Company } from '../models/Company.js';
import { GTMPersonaIntelligence } from '../models/GTMPersonaIntelligence.js';

interface GetEmployeeGTMBody {
  employeeId: string;
  icpModelId?: string;
  companyId?: string;
}

export async function EmployeeController(fastify: FastifyInstance) {
  // Get GTM Persona Intelligence for an employee
  fastify.post('/employees/gtm_persona', async (
    request: FastifyRequest<{ Body: GetEmployeeGTMBody }>,
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const { employeeId, icpModelId, companyId } = request.body;

      console.log('🎯 Fetching GTM Persona for employee:', employeeId);

      // Validate employee ID
      if (!Types.ObjectId.isValid(employeeId)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid employee ID'
        });
      }

      // Get user's sessions
   
     

      // Fetch employee with company
      const employee = await Employee.findOne({
        _id: new Types.ObjectId(employeeId)
      })
      .populate('companyId')
      .lean();

      if (!employee) {
        return reply.status(404).send({
          success: false,
          error: 'Employee not found'
        });
      }

      const company = employee.companyId as any;
      if (!company) {
        return reply.status(404).send({
          success: false,
          error: 'Company not found'
        });
      }

      // Build query for GTM Persona
      const gtmQuery: any = {
        employeeId: new Types.ObjectId(employeeId)
      };

      if (icpModelId && Types.ObjectId.isValid(icpModelId)) {
        gtmQuery.icpModelId = new Types.ObjectId(icpModelId);
      }

      // Fetch or generate GTM Persona
      let personaIntelligence = await GTMPersonaIntelligence.findOne(gtmQuery)
        .populate('icpModelId', 'name')
        .lean();

      // If not found, create basic one

      // Transform response
      const response = {
        success: true,
        data: {
          employee: transformEmployee(employee),
          personaIntelligence: transformPersona(personaIntelligence),
          company: {
            id: company._id,
            name: company.name,
            domain: company.domain,
            industry: company.industry
          }
        }
      };

      reply.send(response);

    } catch (error) {
      console.error('Error in GTM Persona:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch GTM Persona'
      });
    }
  });
}

// Helper functions
function generateBasicPersona(employee: any, company: any): string {
  return `# GTM PERSONA REPORT

## PROFILE
**Name:** ${employee.fullName}
**Role:** ${employee.activeExperienceTitle || 'Not specified'}
**Company:** ${company.name}

## INSIGHTS
- **Department:** ${employee.activeExperienceDepartment || 'N/A'}
- **Decision Maker:** ${employee.isDecisionMaker ? 'Yes' : 'No'}
- **Status:** ${employee.isWorking ? 'Active' : 'Not active'}

## RECOMMENDATIONS
1. Engage via LinkedIn
2. Focus on ${employee.isDecisionMaker ? 'ROI' : 'efficiency'}
3. Reference ${company.industry?.[0] || 'industry'} experience`;
}

function transformEmployee(employee: any) {
  return {
    id: employee._id,
    fullName: employee.fullName,
    headline: employee.headline,
    title: employee.activeExperienceTitle,
    department: employee.activeExperienceDepartment,
    isDecisionMaker: employee.isDecisionMaker,
    isWorking: employee.isWorking,
    linkedinUrl: employee.linkedinUrl,
    email: employee.primaryProfessionalEmail,
    skills: employee.inferredSkills || [],
    experience: employee.totalExperienceDurationMonths ? 
      Math.round(employee.totalExperienceDurationMonths / 12) + ' years' : 'Unknown'
  };
}

function transformPersona(persona: any) {
    console.log(persona)
  return {
    id: persona._id,
    overview: persona.overview,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
    icpModel: persona.icpModelId
  };
}