// src/controllers/SessionController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionService } from '../services/SessionService.js';

interface CreateSessionBody {
  name: string;
}

interface UpdateSessionQueryBody {
  query: string[];
}

interface AddMessageBody {
  message: {
    id: string;
    content: string;
    role: 'user' | 'assistant' | 'system';
    timestamp: string;
    type?: 'message' | 'status' | 'search_result';
  };
}

export async function SessionController(fastify: FastifyInstance) {
  // Get all sessions for user
  fastify.get('/sessions', async (request: FastifyRequest, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      const sessions = await sessionService.getUserSessions(userId);
      
      reply.send({ sessions });
    } catch (error) {
      console.error('Error fetching sessions:', error);
      reply.status(500).send({ error: 'Failed to fetch sessions' });
    }
  });

  // Get specific session
  fastify.get('/sessions/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    try {
      const session = await sessionService.getSession(request.params.sessionId);
      
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      reply.send({ session });
    } catch (error) {
      console.error('Error fetching session:', error);
      reply.status(500).send({ error: 'Failed to fetch session' });
    }
  });

  // Create new session
  fastify.post('/sessions', async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply) => {
    try {
      const { name } = request.body;
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      if (!name) {
        return reply.status(400).send({ error: 'Session name is required' });
      }

      const session = await sessionService.createSession(userId, name);
      reply.status(201).send({ session });
    } catch (error) {
      console.error('Error creating session:', error);
      reply.status(500).send({ error: 'Failed to create session' });
    }
  });

  // Update session query
  fastify.patch('/sessions/:sessionId/query', async (request: FastifyRequest<{ 
    Params: { sessionId: string },
    Body: UpdateSessionQueryBody 
  }>, reply) => {
    try {
      const { query } = request.body;
      
      console.log('🚀 API Route - PATCH /sessions/:sessionId/query');
      console.log('  - Session ID:', request.params.sessionId);
      console.log('  - Query received:', query);
      console.log('  - Query type:', typeof query);
      console.log('  - Is array:', Array.isArray(query));
      if (Array.isArray(query)) {
        console.log('  - Array length:', query.length);
        console.log('  - Array contents:');
        query.forEach((q, i) => console.log(`    [${i}]: ${q}`));
      }
  
      // Get current session state before update for comparison
      const currentSession = await sessionService.getSession(request.params.sessionId);
      console.log('  - Current session query:', currentSession?.query);
      console.log('  - Current query type:', typeof currentSession?.query);
      if (currentSession?.query && Array.isArray(currentSession.query)) {
        console.log('  - Current query length:', currentSession.query.length);
        console.log('  - Current query contents:');
        currentSession.query.forEach((q, i) => console.log(`    [${i}]: ${q}`));
      }
  
      const session = await sessionService.updateSessionQuery(request.params.sessionId, query);
      
      console.log('✅ API Route - Update completed:');
      console.log('  - Returned session query:', session.query);
      console.log('  - Returned query type:', typeof session.query);
      if (Array.isArray(session.query)) {
        console.log('  - Returned query length:', session.query.length);
        console.log('  - Returned query contents:');
        session.query.forEach((q, i) => console.log(`    [${i}]: ${q}`));
      }
  
      // Verify the update was successful
      const verifySession = await sessionService.getSession(request.params.sessionId);
      console.log('🔍 API Route - Verification (fresh fetch):');
      console.log('  - Verified query:', verifySession?.query);
      console.log('  - Verified query type:', typeof verifySession?.query);
      if (verifySession?.query && Array.isArray(verifySession.query)) {
        console.log('  - Verified query length:', verifySession.query.length);
      }
  
      reply.send({ session });
    } catch (error) {
      console.error('❌ API Route - Error updating session query:', error);
      reply.status(500).send({ error: 'Failed to update session query' });
    }
  });

  // Delete session
  fastify.delete('/sessions/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    try {
      const success = await sessionService.deleteSession(request.params.sessionId);
      reply.send({ success });
    } catch (error) {
      console.error('Error deleting session:', error);
      reply.status(500).send({ error: 'Failed to delete session' });
    }
  });

  // ✅ CONVERSATION ENDPOINTS

  // Add message to session conversation
  fastify.post('/sessions/:sessionId/conversation', async (
    request: FastifyRequest<{ 
      Params: { sessionId: string },
      Body: AddMessageBody 
    }>, 
    reply
  ) => {
    try {
      const { message } = request.body;
      console.log('💬 Adding message to conversation:', { 
        sessionId: request.params.sessionId, 
        message 
      });

      const session = await sessionService.addMessageToConversation(
        request.params.sessionId, 
        message
      );

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      reply.send({ success: true, session });
    } catch (error) {
      console.error('Error adding message to conversation:', error);
      reply.status(500).send({ error: 'Failed to add message to conversation' });
    }
  });

  // Get session conversation
  fastify.get('/sessions/:sessionId/conversation', async (
    request: FastifyRequest<{ Params: { sessionId: string } }>, 
    reply
  ) => {
    try {
      const session = await sessionService.getSession(request.params.sessionId);
      
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Return the conversation array from the session
      const conversation = session.conversation || [];
      reply.send({ conversation });
    } catch (error) {
      console.error('Error fetching conversation:', error);
      reply.status(500).send({ error: 'Failed to fetch conversation' });
    }
  });

  // Clear session conversation
  fastify.delete('/sessions/:sessionId/conversation', async (
    request: FastifyRequest<{ Params: { sessionId: string } }>, 
    reply
  ) => {
    try {
      const session = await sessionService.clearConversation(request.params.sessionId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      reply.send({ success: true, session });
    } catch (error) {
      console.error('Error clearing conversation:', error);
      reply.status(500).send({ error: 'Failed to clear conversation' });
    }
  });

  // Delete specific message from conversation
  fastify.delete('/sessions/:sessionId/conversation/:messageId', async (
    request: FastifyRequest<{ 
      Params: { sessionId: string; messageId: string } 
    }>, 
    reply
  ) => {
    try {
      const { sessionId, messageId } = request.params;
      
      const session = await sessionService.removeMessageFromConversation(
        sessionId, 
        messageId
      );

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      reply.send({ success: true, session });
    } catch (error) {
      console.error('Error removing message from conversation:', error);
      reply.status(500).send({ error: 'Failed to remove message from conversation' });
    }
  });
}