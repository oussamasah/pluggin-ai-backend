// src/controllers/ICPConfigController.ts
/*
import { FastifyInstance, FastifyRequest } from 'fastify';
import { ollamaService } from '../services/OllamaService.js';
import { sessionService } from '../services/SessionService.js';

// LangChain imports
import { BufferMemory } from 'langchain/memory';
import { ConversationChain } from 'langchain/chains';
import { ChatOllama } from '@langchain/community/chat_models/ollama';

interface ICPConfigChatBody {
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  businessContext?: string;
}

interface QuickICPRecommendationBody {
  businessContext: string;
}

// Store memories per user session
const userMemories = new Map<string, BufferMemory>();

function getUserMemory(userId: string): BufferMemory {
  if (!userMemories.has(userId)) {
    userMemories.set(userId, new BufferMemory({
      memoryKey: 'history',
      returnMessages: true,
    }));
  }
  return userMemories.get(userId)!;
}

const icpModel = new ChatOllama({
  model: 'gemma3:4b',
  temperature: 0.7
});

export async function ICPConfigController(fastify: FastifyInstance) {
  // --------------------------
  // 🧠 Start ICP configuration chat
  // --------------------------
  fastify.post('/icp-config/chat', async (
    request: FastifyRequest<{ Body: ICPConfigChatBody }>,
    reply
  ) => {
    try {
      const { message, conversationHistory = [], businessContext } = request.body;
      const userId = request.headers['x-user-id'] as string || 'demo-user';

      console.log('💬 ICP Config Chat Request:', { userId, message });

      if (!message.trim()) {
        return reply.status(400).send({
          success: false,
          error: 'Message is required',
        });
      }

      // Get or create user-specific memory
      const memory = getUserMemory(userId);

      // Build system context (double curly braces to escape them in LangChain templates)
      let systemContext = `You are an ICP (Ideal Customer Profile) configuration expert. Help the user build a comprehensive ICP by asking clarifying questions and providing suggestions.`;
      
      if (businessContext) {
        systemContext += `\n\nBusiness Context: ${businessContext}`;
      }

      systemContext += `\n\nWhen you have enough information, provide a JSON suggestion in this format:
\`\`\`json
{{
  "config": {{
    "industries": ["array of industries"],
    "employeeRange": "range like '51-200 employees'",
    "geographies": ["array of regions"],
    "mustHaveTech": ["array of technologies"],
    "acvRange": "annual contract value range"
  }},
  "reasoning": "brief explanation",
  "confidence": 0.7,
  "isComplete": false
}}
\`\`\`

Also provide 2-3 follow-up questions to gather missing information.
If all required fields are complete, include "CONVERSATION_COMPLETE" in your response.`;

      // Create a custom prompt template
      const prompt = ChatPromptTemplate.fromMessages([
        ['system', systemContext],
        new MessagesPlaceholder('history'),
        ['human', '{input}']
      ]);

      // Create chain with user-specific memory
      const chain = new ConversationChain({
        llm: icpModel,
        memory: memory,
        prompt: prompt,
      });

      // If conversation history is provided (from frontend), restore it
      if (conversationHistory.length > 0 && memory.chatHistory.messages.length === 0) {
        for (const msg of conversationHistory) {
          if (msg.role === 'user') {
            await memory.chatHistory.addUserMessage(msg.content);
          } else if (msg.role === 'assistant') {
            await memory.chatHistory.addAIChatMessage(msg.content);
          }
        }
      }

      // Call the chain
      const response = await chain.call({
        input: message,
      });

      const textResponse = response.response || response.text || '';
      const parsedResponse = parseAIResponse(textResponse);

      console.log('🤖 ICP Config Response:', {
        responseLength: textResponse.length,
        hasSuggestion: !!parsedResponse.suggestion,
        isComplete: parsedResponse.isComplete,
      });

      reply.send({
        success: true,
        response: parsedResponse.response,
        suggestion: parsedResponse.suggestion,
        isComplete: parsedResponse.isComplete,
        followUpQuestions: parsedResponse.followUpQuestions,
      });
    } catch (error) {
      console.error('❌ ICP Config Chat Error:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to process ICP configuration request',
      });
    }
  });

  // --------------------------
  // 🚀 Quick ICP recommendation
  // --------------------------
  fastify.post('/icp-config/quick-recommendation', async (
    request: FastifyRequest<{ Body: QuickICPRecommendationBody }>,
    reply
  ) => {
    try {
      const { businessContext } = request.body;

      if (!businessContext?.trim()) {
        return reply.status(400).send({
          success: false,
          error: 'Business context is required',
        });
      }

      const prompt = `Based on this business context, provide a quick ICP configuration recommendation:

Business Context: ${businessContext}

Provide JSON:
{
  "config": {
    "industries": ["array"],
    "employeeRange": "range",
    "geographies": ["array"],
    "mustHaveTech": ["array"]
  },
  "reasoning": "brief explanation",
  "confidence": 0.7,
  "isComplete": false
}`;

      const systemPrompt = `You are an ICP configuration expert. Provide concise, actionable ICP recommendations based on business context.`;

      const response = await ollamaService.generate(prompt, systemPrompt);
      const parsed = parseJSONResponse(response);

      const suggestion = {
        config: parsed.config || {
          industries: ['Technology', 'SaaS'],
          employeeRange: '51-200 employees',
          geographies: ['North America'],
          mustHaveTech: [],
          acvRange: '$1k–$10k',
        },
        reasoning: parsed.reasoning || 'Quick recommendation based on business context',
        confidence: parsed.confidence || 0.7,
        isComplete: false,
      };

      reply.send({
        success: true,
        suggestion,
        message: 'Quick ICP recommendation generated successfully',
      });
    } catch (error) {
      console.error('❌ Quick ICP Recommendation Error:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to generate quick ICP recommendation',
      });
    }
  });

  // --------------------------
  // 🧩 Validate ICP configuration
  // --------------------------
  fastify.post('/icp-config/validate', async (
    request: FastifyRequest<{ Body: { config: any } }>,
    reply
  ) => {
    try {
      const { config } = request.body;

      const prompt = `Validate this ICP configuration and identify missing or unrealistic fields:
${JSON.stringify(config, null, 2)}

Return JSON:
{
  "isValid": boolean,
  "missingFields": ["field1", "field2"],
  "suggestions": ["text"],
  "confidence": 0.8
}`;

      const systemPrompt = `You are an ICP validation assistant. Identify missing or inconsistent fields, and provide practical improvement suggestions.`;

      const response = await ollamaService.generate(prompt, systemPrompt);
      const validation = parseJSONResponse(response);

      reply.send({
        success: true,
        validation: {
          isValid: validation.isValid !== false,
          missingFields: validation.missingFields || [],
          suggestions: validation.suggestions || [],
          confidence: validation.confidence || 0.8,
        },
      });
    } catch (error) {
      console.error('❌ ICP Config Validation Error:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to validate ICP configuration',
      });
    }
  });

  // --------------------------
  // 🗑️ Clear user memory (optional endpoint)
  // --------------------------
  fastify.post('/icp-config/clear-session', async (
    request: FastifyRequest,
    reply
  ) => {
    try {
      const userId = request.headers['x-user-id'] as string || 'demo-user';
      userMemories.delete(userId);
      reply.send({
        success: true,
        message: 'Session cleared successfully',
      });
    } catch (error) {
      console.error('❌ Clear Session Error:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to clear session',
      });
    }
  });
}

// --------------------------
// 🧠 Helper functions
// --------------------------
function parseAIResponse(aiResponse: string): {
  response: string;
  suggestion?: any;
  isComplete: boolean;
  followUpQuestions: string[];
} {
  const suggestionMatch = aiResponse.match(/```json\n({.*?})\n```/s);
  let suggestion: any;

  if (suggestionMatch) {
    try {
      suggestion = JSON.parse(suggestionMatch[1]);
    } catch (error) {
      console.error('Failed to parse AI suggestion:', error);
    }
  }

  const questionsMatch = aiResponse.match(/Follow-up questions:(.*?)(?=```|$)/s);
  const followUpQuestions = questionsMatch
    ? questionsMatch[1].split('\n').filter(q => q.trim().startsWith('-')).map(q => q.replace('-', '').trim())
    : [];

  const isComplete = aiResponse.includes('CONVERSATION_COMPLETE') ||
    (suggestion && suggestion.isComplete);

  const cleanResponse = aiResponse
    .replace(/```json\n.*?\n```/s, '')
    .replace(/Follow-up questions:.s, '')
    .replace(/CONVERSATION_COMPLETE/g, '')
    .trim();

  return { response: cleanResponse, suggestion, isComplete, followUpQuestions };
}

function parseJSONResponse(response: string): any {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(response);
  } catch (error) {
    console.error('Failed to parse JSON response:', response);
    return {};
  }
}*/