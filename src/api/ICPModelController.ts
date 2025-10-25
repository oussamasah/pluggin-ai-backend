// src/controllers/ICPModelController.ts
import { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionService } from '../services/SessionService.js';

interface CreateICPModelBody {
  name: string;
  isPrimary: boolean;
  config: any;
}

interface UpdateICPModelBody {
  name?: string;
  isPrimary?: boolean;
  config?: any;
}

interface SetPrimaryParams {
  modelId: string;
}

interface ModelIdParams {
  modelId: string;
}

export async function ICPModelController(fastify: FastifyInstance) {
  // Get all ICP models for user
  fastify.get('/icp-models', async (request: FastifyRequest, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      console.log('📥 Getting ICP models for user:', userId);
      
      const models = await sessionService.getIcpModels(userId);
      console.log('📤 ICP models found:', models.length);
      
      reply.send({ 
        success: true, 
        models 
      });
    } catch (error) {
      console.error('Error fetching ICP models:', error);
      reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch ICP models' 
      });
    }
  });

  // Get specific ICP model
  fastify.get('/icp-models/:modelId', async (
    request: FastifyRequest<{ Params: ModelIdParams }>, 
    reply
  ) => {
    try {
      const { modelId } = request.params;
      console.log('📥 Getting ICP model:', modelId);
      
      const model = await sessionService.getIcpModel(modelId);
      
      if (!model) {
        return reply.status(404).send({ 
          success: false, 
          error: 'ICP model not found' 
        });
      }

      reply.send({ 
        success: true, 
        model 
      });
    } catch (error) {
      console.error('Error fetching ICP model:', error);
      reply.status(500).send({ 
        success: false, 
        error: 'Failed to fetch ICP model' 
      });
    }
  });

  // Create new ICP model
  fastify.post('/icp-models', async (
    request: FastifyRequest<{ Body: CreateICPModelBody }>, 
    reply
  ) => {
    try {
      const { name, isPrimary, config } = request.body;
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      console.log('📥 Creating ICP model:', { name, isPrimary, userId });

      if (!name) {
        return reply.status(400).send({ 
          success: false, 
          error: 'Model name is required' 
        });
      }

      if (!config) {
        return reply.status(400).send({ 
          success: false, 
          error: 'Model config is required' 
        });
      }

      const model = await sessionService.saveIcpModel({
        name,
        isPrimary: isPrimary || false,
        config,
        userId
      });
      
      console.log('✅ ICP model created:', model.id);
      
      reply.status(201).send({ 
        success: true, 
        model 
      });
    } catch (error) {
      console.error('Error creating ICP model:', error);
      reply.status(500).send({ 
        success: false, 
        error: 'Failed to create ICP model' 
      });
    }
  });

  // Update ICP model
  fastify.put('/icp-models/:modelId', async (
    request: FastifyRequest<{ 
      Params: ModelIdParams;
      Body: UpdateICPModelBody 
    }>, 
    reply
  ) => {
    try {
      const { modelId } = request.params;
      const updates = request.body;
      
      console.log('📥 Updating ICP model:', modelId, updates);

      // Get existing model
      const existingModel = await sessionService.getIcpModel(modelId);
      if (!existingModel) {
        return reply.status(404).send({ 
          success: false, 
          error: 'ICP model not found' 
        });
      }

      // For simplicity, delete and recreate
      // In production, you'd implement an update method
      await sessionService.deleteIcpModel(modelId);
      
      const updatedModel = await sessionService.saveIcpModel({
        ...existingModel,
        ...updates,
        userId: existingModel.userId
      });

      reply.send({ 
        success: true, 
        model: updatedModel 
      });
    } catch (error) {
      console.error('Error updating ICP model:', error);
      reply.status(500).send({ 
        success: false, 
        error: 'Failed to update ICP model' 
      });
    }
  });

  // Set primary ICP model
  fastify.patch('/icp-models/:modelId/primary', async (
    request: FastifyRequest<{ Params: SetPrimaryParams }>, 
    reply
  ) => {
    try {
      const { modelId } = request.params;
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      
      console.log('📥 Setting primary model:', { modelId, userId });

      await sessionService.setPrimaryModel(modelId, userId);
      
      reply.send({ 
        success: true, 
        message: 'Primary model updated successfully' 
      });
    } catch (error) {
      console.error('Error setting primary model:', error);
      reply.status(500).send({ 
        success: false, 
        error: 'Failed to set primary model' 
      });
    }
  });

  // Delete ICP model
  fastify.delete('/icp-models/:modelId', async (
    request: FastifyRequest<{ Params: ModelIdParams }>, 
    reply
  ) => {
    try {
      const { modelId } = request.params;
      
      console.log('📥 Deleting ICP model:', modelId);

      await sessionService.deleteIcpModel(modelId);
      
      reply.send({ 
        success: true, 
        message: 'ICP model deleted successfully' 
      });
    } catch (error) {
      console.error('Error deleting ICP model:', error);
      reply.status(500).send({ 
        success: false, 
        error: 'Failed to delete ICP model' 
      });
    }
  });
}