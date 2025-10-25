// src/controllers/IntentController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { intentClassifier } from '../services/IntentClassificationLLM.js';
import { sessionService } from '../services/SessionService.js';

interface ClassifyIntentBody {
  message: string;
  sessionId: string;
  icpModelId?: string;
  context?: {
    history?: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: Date;
    }>;
    lastIntent?: any;
    searchContext?: {
      currentQuery: string;
      resultsCount: number;
      activeFilters: any;
    };
  };
}

export async function IntentController(fastify: FastifyInstance) {
  fastify.post('/classify-intent', async (request: FastifyRequest<{ 
    Body: ClassifyIntentBody 
  }>, reply) => {
    try {
      console.log('🔍 Intent classification request received:', {
        message: request.body.message,
        sessionId: request.body.sessionId,
        hasContext: !!request.body.context
      });

      const { message, sessionId, icpModelId, context } = request.body;
      
      // Validate required fields
      if (!message?.trim()) {
        return reply.status(400).send({ error: 'Message is required' });
      }

      if (!sessionId) {
        return reply.status(400).send({ error: 'Session ID is required' });
      }

      // Get ICP model if provided
      let icpModel = null;
      if (icpModelId) {
        try {
          icpModel = await sessionService.getIcpModel(icpModelId);
          console.log('🔍 Using ICP model:', icpModel?.name);
        } catch (error) {
          console.warn('⚠️ Could not load ICP model:', error);
          // Continue without ICP model
        }
      }

      // Classify intent using the backend service
      console.log('🤖 Starting intent classification...');
      const response = await intentClassifier.processMessage(
        message.trim(),
        context || {},
        icpModel
      );

      console.log('✅ Intent classification successful:', {
        intent: response.classification.intent,
        confidence: response.classification.confidence,
        action: response.action?.type
      });
      
      reply.send(response);
      
    } catch (error) {
      console.error('❌ Intent classification error:', error);
      
      // Provide a helpful fallback response
      const fallbackResponse = {
        classification: {
          intent: 'company_search' as const,
          confidence: 0.7,
          enhanced_query: request.body?.message || '',
          reasoning: 'Fallback due to classification error',
          suggested_action: 'search' as const,
          is_follow_up: false,
          references_previous: false
        },
        response: `I'll search for companies based on: "${request.body?.message || 'your query'}"`,
        action: {
          type: 'start_search' as const,
          query: request.body?.message || '',
          confidence: 0.7
        }
      };
      
      reply.send(fallbackResponse);
    }
  });
}