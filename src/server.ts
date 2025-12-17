// src/server.ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { WorkflowController } from './api/WorkflowController.js';
import { config } from './core/config.js';
import { wsManager } from './websocket/WebSocketManager.js';
import { SessionController } from './api/SessionController.js';
import { ICPModelController } from './api/ICPModelController.js';
import { ICPConfigController } from './api/ICPConfigController.js';
import { AnalysisController } from './api/AnalysisController.js';
import { IntentController } from './api/IntentController.js';
import { CompaniesController } from './api/CompaniesController.js';
import { connectDatabase, disconnectDatabase } from './database/connection.js';
import { RefinementController } from './api/RefinementController.js';

const fastify = Fastify({
  logger: {
    level: 'error',
    transport: {
      target: 'pino-pretty'
    }
  }
});

async function setupServer() {
  await fastify.register(cors, {
    origin: true,
    credentials: true
  });

  await fastify.register(websocket);

  await fastify.register(WorkflowController, { prefix: '/api', wsManager });
  fastify.register(SessionController, { prefix: '/api' });
  fastify.register(ICPModelController, { 
    prefix: '/api' 
  });
  await fastify.register(IntentController, { prefix: '/api' }); 
  await fastify.register(RefinementController, { prefix: '/api' }); 
  await fastify.register(AnalysisController, { prefix: '/api' }); 
  await fastify.register(ICPConfigController, { prefix: '/api' });
  
  await fastify.register(CompaniesController, { prefix: '/api' });
  
  fastify.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/', async () => {
    return { 
      message: 'Workflow API Server new mongodb', 
      version: '1.0.0',
      endpoints: {
        health: '/health',
        websocket: '/ws',
        api: '/api'
      }
    };
  });

  fastify.get('/api/debug/websocket', async () => {
    return wsManager.debugInstance();
  });

  fastify.get('/ws', { websocket: true }, (connection, req) => {
    const userId = (req.headers['x-user-id'] as string) || 'anonymous';

    const clientId = wsManager.addClient(connection.socket, userId);
    
    console.log(`🔗 WebSocket connected: ${clientId} (user: ${userId})`);
    console.log(`📊 WebSocketManager instance:`, wsManager.debugInstance());
    
    connection.socket.send(JSON.stringify({
      type: 'connected',
      clientId,
      userId,
      timestamp: new Date().toISOString()
    }));

    connection.socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log(`📨 Received WebSocket message from ${clientId}:`, data);
        
        await wsManager.handleMessage(clientId, data);
        
      } catch (error) {
        console.error(`❌ WebSocket message error for ${clientId}:`, error);
        connection.socket.send(JSON.stringify({
          type: 'error',
          error: 'Failed to process message'
        }));
      }
    });

    connection.socket.on('close', (code, reason) => {
      console.log(`🔌 WebSocket disconnected: ${clientId} (code: ${code})`);
    });

    connection.socket.on('error', (error) => {
      console.error(`❌ WebSocket error for ${clientId}:`, error);
    });
  });
}

const start = async () => {
  try {
    // Connect to MongoDB before starting server
    console.log('🔌 Connecting to MongoDB...');
    await connectDatabase(process.env.MONGODB_URI!);
    console.log('✅ MongoDB connected successfully');

    await setupServer();
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`🚀 Server running on http://localhost:${config.PORT}`);
    console.log(`🎯 WebSocketManager instance ready:`, wsManager.debugInstance());
  } catch (err) {
    fastify.log.error(err);
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server gracefully...');
  wsManager.destroy();
  await disconnectDatabase();
  await fastify.close();
  console.log('✅ Server shut down complete');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server gracefully...');
  wsManager.destroy();
  await disconnectDatabase();
  await fastify.close();
  console.log('✅ Server shut down complete');
  process.exit(0);
});

// Handle uncaught errors
process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  wsManager.destroy();
  await disconnectDatabase();
  await fastify.close();
  process.exit(1);
});

start();