// src/controllers/RefinementController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionService } from '../services/SessionService.js';
import { QueryRefinementService } from '../services/QueryRefinementService.js';

interface RefinementRequest {
  message: string;
  sessionId: string;
  icpModelId?: string;
  context?: {
    stage: 'initial' | 'proposed' | 'refining' | 'confirmed' | 'ready';
    currentQuery?: string;
  };
}

/**
 * PRODUCTION-GRADE REFINEMENT CONTROLLER
 * 
 * This controller maintains ONE refinement service instance per session
 * to preserve conversation state and removal tracking.
 */

// Session-based service instances
const sessionServices = new Map<string, QueryRefinementService>();

function getOrCreateService(sessionId: string): QueryRefinementService {
  if (!sessionServices.has(sessionId)) {
    sessionServices.set(sessionId, new QueryRefinementService());
  }
  return sessionServices.get(sessionId)!;
}

export async function RefinementController(fastify: FastifyInstance) {
  
  fastify.post('/refine-with-confirmation', async (
    request: FastifyRequest<{ Body: RefinementRequest }>,
    reply
  ) => {
    try {
      const { message, sessionId, icpModelId, context } = request.body;
      
      // Validation
      if (!message?.trim()) {
        return reply.status(400).send({ error: 'Message is required' });
      }
      if (!sessionId) {
        return reply.status(400).send({ error: 'Session ID is required' });
      }

      // Get session
      const session = await sessionService.getSession(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Get or create refinement service for this session
      const refinementService = getOrCreateService(sessionId);

      // Load ICP model if provided
      let icpModel = null;
      if (icpModelId) {
        try {
          icpModel = await sessionService.getIcpModel(icpModelId);
        } catch (error) {
          console.warn('⚠️ Could not load ICP model:', error);
        }
      }

      // Extract current state from context or session
      const currentStage = context?.stage || session.refinementState?.stage || 'initial';
      const currentQuery = context?.currentQuery || session.refinementState?.currentQuery || '';

      console.log('🔄 Processing refinement:', {
        sessionId,
        stage: currentStage,
        message: message.substring(0, 50),
        hasICP: !!icpModel,
        currentQuery: currentQuery.substring(0, 50)
      });

      // Process the message
      const result = await refinementService.handleMessage(
        message.trim(),
        currentStage,
        currentQuery,
        icpModel
      );

      // Update session in database
      await sessionService.updateSession(sessionId, {
        refinementState: {
          stage: result.stage,
          currentQuery: result.currentQuery,
          proposalHistory: [
            ...(session.refinementState?.proposalHistory || []),
            {
              query: result.currentQuery,
              timestamp: new Date(),
              userFeedback: message
            }
          ]
        },
        currentProposal: result.currentQuery,
        query: [
          ...(Array.isArray(session.query) ? session.query : []),
          `CHAT_USER: ${message}`,
          `CHAT_ASSISTANT: ${result.response}`,
          `REFINEMENT_STAGE:${result.stage}:${result.currentQuery}`
        ]
      });

      // Update search status if moving to ready
      if (result.action.type === 'start_search') {
        await sessionService.updateSearchStatus(sessionId, {
          stage: 'refining-query',
          message: 'Preparing to search...',
          progress: 10
        });
      }

      console.log('✅ Refinement complete:', {
        stage: result.stage,
        action: result.action.type,
        queryPreview: result.currentQuery.substring(0, 50)
      });

      return reply.send(result);
      
    } catch (error) {
      console.error('❌ Refinement error:', error);
      
      // Return a safe fallback response
      return reply.send({
        response: "I encountered an error processing your request. Let's start fresh. What companies are you looking for?",
        stage: 'initial',
        action: {
          type: 'request_clarification'
        },
        currentQuery: '',
        context: {
          stage: 'initial',
          currentQuery: ''
        }
      });
    }
  });

  // Clear refinement state (useful for testing or resetting)
  fastify.post('/refine-with-confirmation/reset', async (
    request: FastifyRequest<{ Body: { sessionId: string } }>,
    reply
  ) => {
    try {
      const { sessionId } = request.body;
      
      if (!sessionId) {
        return reply.status(400).send({ error: 'Session ID is required' });
      }

      // Clear the refinement service
      const service = sessionServices.get(sessionId);
      if (service) {
        service.clearState();
        sessionServices.delete(sessionId);
      }

      // Reset session state
      await sessionService.updateSession(sessionId, {
        refinementState: {
          stage: 'initial',
          currentQuery: '',
          proposalHistory: []
        },
        currentProposal: ''
      });

      return reply.send({ 
        success: true, 
        message: 'Refinement state cleared' 
      });
      
    } catch (error) {
      console.error('❌ Reset error:', error);
      return reply.status(500).send({ error: 'Failed to reset refinement state' });
    }
  });

  // Get current refinement state (useful for debugging)
  fastify.get('/refine-with-confirmation/state/:sessionId', async (
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply
  ) => {
    try {
      const { sessionId } = request.params;
      
      const service = sessionServices.get(sessionId);
      if (!service) {
        return reply.send({
          exists: false,
          message: 'No active refinement session'
        });
      }

      const state = service.getState();
      
      return reply.send({
        exists: true,
        stage: state.stage,
        currentQuery: state.currentQuery,
        removedCriteria: Array.from(state.removedCriteria),
        conversationLength: state.conversationHistory.length
      });
      
    } catch (error) {
      console.error('❌ State fetch error:', error);
      return reply.status(500).send({ error: 'Failed to fetch state' });
    }
  });
}