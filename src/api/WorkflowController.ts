// src/api/WorkflowController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { CompanyWorkflow } from '../workflows/CompanyWorkflow.js';
import { wsManager } from '../websocket/WebSocketManager.js';
import { mongoDBService } from '../services/MongoDBService.js';

import { sessionService } from '../services/SessionService.js';
import { ConversationContext, intentClassifier } from '../services/IntentClassificationLLM.js';

interface StartWorkflowBody {
  query: string;
  sessionId: string;
  icpModelId?: string;
  count?: string;
}

export async function WorkflowController(
  fastify: FastifyInstance,
  options: { wsManager: WebSocket }
) {
  const { wsManager } = options;
  fastify.post('/process-message', async (request: FastifyRequest<{ 
    Body: { 
      message: string;
      sessionId: string;
      icpModelId?: string;
      context?: ConversationContext;
    } 
  }>, reply) => {
    try {
      const { message, sessionId, icpModelId, context } = request.body;
      
      // Get ICP model if provided
      let icpModel = null;
      if (icpModelId) {
        icpModel = await sessionService.getIcpModel(icpModelId);
      }

      // CLASSIFY EVERY MESSAGE
      const response = await intentClassifier.processMessage(
        message,
        context,
        icpModel
      );
      
      reply.send(response);
      
    } catch (error) {
      console.error('Message processing error:', error);
      reply.status(500).send({ error: 'Failed to process message' });
    }
  });
  fastify.post('/search-companies', async (request: FastifyRequest<{ Body: StartWorkflowBody }>, reply) => {
    const { query, sessionId, icpModelId,count } = request.body;
    const userId = request.headers['x-user-id'] as string || 'demo-user';

    try {
      //console.log("🚀 Starting search via REST API", { sessionId, query, icpModelId });
      //console.log("📊 WebSocketManager state before search:", wsManager.debugInstance());
      
      const icpModel = await getICPModel(icpModelId, userId);
      
      //console.log("📢 Starting workflow execution in background...");
      
      // Start workflow asynchronously
      setTimeout(async () => {
        try {
          const workflow = new CompanyWorkflow(sessionId, userId);
          const companies = await workflow.execute(query, icpModel,count);
          
          //console.log(`✅ Workflow completed for session ${sessionId}, found ${companies.length} companies`);
          
        } catch (error) {
          console.error('❌ Workflow execution error:', error);
        }
      }, 100);

      reply.send({
        success: true,
        sessionId,
        message: 'Workflow started successfully'
      });
    } catch (error) {
      console.error('❌ Workflow start error:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to start workflow'
      });
    }
  });

  fastify.get('/workflow/status/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    const sessionId = request.params.sessionId;
    
    try {
      // Get status from WebSocket manager or database
      const status = await getWorkflowStatus(sessionId);
      
      reply.send({
        sessionId,
        status: status || 'unknown',
        lastUpdated: new Date()
      });
    } catch (error) {
      console.error('Error getting workflow status:', error);
      reply.status(500).send({
        error: 'Failed to get workflow status'
      });
    }
  });
}

async function getICPModel(modelId: string , userId: string): Promise<any> {
  let icpmodel = mongoDBService.getIcpModel(modelId);
  if (icpmodel) {
    return icpmodel
  }
  // In a real implementation, you would fetch this from a database
  return {
    id: modelId || 'default',
    name: 'Default ICP Model',
    config: {
      industries: ['SaaS', 'Technology'],
      geographies: ['North America', 'Europe'],
      employeeRange: '51-200 employees',
      annualRevenue: '$1k–$10k',
      buyingTriggers: ['funding', 'key hires', 'tech change']
    }
  };
}

async function getWorkflowStatus(sessionId: string): Promise<any> {
  // This would typically query your database or in-memory store
  // For now, return a mock status
  return {
    stage: 'active',
    progress: 0,
    message: 'Workflow status not implemented'
  };
}