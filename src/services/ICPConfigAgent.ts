// src/services/ICPConfigAgent.ts
import { ICPConfig, ICPModel } from '../core/types.js';
import { claudeService } from '../utils/ClaudeService.js';

export interface AIConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ICPConfigSuggestion {
  config: Partial<ICPConfig>;
  reasoning: string;
  confidence: number;
  questions?: string[];
  isComplete: boolean;
}

export class ICPConfigAgent {
  private conversationHistory: AIConversationMessage[] = [];
  private currentSuggestion?: ICPConfigSuggestion;

  constructor() {}

  async initializeConversation(userBusinessContext?: string): Promise<string> {
    const systemPrompt = this.getSystemPrompt();
    
    this.conversationHistory = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    if (userBusinessContext) {
      this.conversationHistory.push({
        role: 'user',
        content: `Here's my business context: ${userBusinessContext}`
      });
    }

    const welcomeMessage = `👋 **ICP Configuration Assistant** 

I'll help you build the perfect Ideal Customer Profile through conversation.

**To get started, tell me about:**
• What product/service you're selling
• Your target market or ideal customers  
• Any specific company characteristics you're looking for

The more details you provide, the better I can tailor your ICP!`;

    this.conversationHistory.push({
      role: 'assistant',
      content: welcomeMessage
    });

    return welcomeMessage;
  }

  async sendMessage(userMessage: string): Promise<{
    response: string;
    suggestion?: ICPConfigSuggestion;
    isComplete: boolean;
    followUpQuestions: string[];
  }> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    try {
      // Build the conversation context for Ollama
      const conversationContext = this.conversationHistory
        .filter(msg => msg.role !== 'system')
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n\n');

      const systemPrompt = this.getSystemPrompt();
      const fullPrompt = `${systemPrompt}\n\nCurrent Conversation:\n${conversationContext}\n\nassistant:`;

      const response = await claudeService.generate(fullPrompt);
      const parsedResponse = this.parseAIResponse(response);
      
      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: parsedResponse.response
      });

      // Update current suggestion
      if (parsedResponse.suggestion) {
        this.currentSuggestion = parsedResponse.suggestion;
      }

      return parsedResponse;
    } catch (error) {
      console.error('Error in ICP config agent:', error);
      throw new Error('Failed to process ICP configuration request');
    }
  }

  private parseAIResponse(aiResponse: string): {
    response: string;
    suggestion?: ICPConfigSuggestion;
    isComplete: boolean;
    followUpQuestions: string[];
  } {
    // Extract structured data from AI response
    const suggestionMatch = aiResponse.match(/```json\n({.*?})\n```/s);
    let suggestion: ICPConfigSuggestion | undefined;
    
    if (suggestionMatch) {
      try {
        const suggestionData = JSON.parse(suggestionMatch[1]);
        suggestion = {
          config: suggestionData.config || {},
          reasoning: suggestionData.reasoning || 'AI-generated configuration',
          confidence: suggestionData.confidence || 0.8,
          questions: suggestionData.questions || [],
          isComplete: suggestionData.isComplete || false
        };
      } catch (error) {
        console.error('Failed to parse AI suggestion:', error);
      }
    }

    // Extract follow-up questions
    const questionsMatch = aiResponse.match(/Follow-up questions:(.*?)(?=```|$)/s);
    const followUpQuestions = questionsMatch 
      ? questionsMatch[1].split('\n').filter(q => q.trim().startsWith('-')).map(q => q.replace('-', '').trim())
      : [];

    // Check if conversation is complete
    const isComplete = aiResponse.includes('CONVERSATION_COMPLETE') || 
                      (suggestion && suggestion.isComplete);

    // Clean the response text
    const cleanResponse = aiResponse
      .replace(/```json\n.*?\n```/s, '')
      .replace(/Follow-up questions:.*/s, '')
      .replace(/CONVERSATION_COMPLETE/g, '')
      .trim();

    return {
      response: cleanResponse,
      suggestion,
      isComplete,
      followUpQuestions
    };
  }

  private getSystemPrompt(): string {
    return `You are an expert ICP (Ideal Customer Profile) Configuration Assistant. Your goal is to help users create detailed ICP configurations for B2B sales and marketing.

ICP CONFIG STRUCTURE:
- industries: Target industries (array)
- geographies: Target regions/countries (array) 
- employeeRange: Company size (1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5000+ employees)
- annualRevenue: Annual contract value ($1k–$10k, $10k–$50k, $50k–$100k, $100k–$500k, $500k–$1M, $1M+)
- mustHaveTech: Required technologies (array)
- mustHaveCompliance: Compliance requirements (array)
- mustHaveMotion: Sales motion (None, PLG, Enterprise, Mid-Market, SMB)
- excludedIndustries: Industries to avoid (array)
- excludedGeographies: Regions to avoid (array)
- excludedTechnologies: Technologies to avoid (array)
- excludedSizeRange: Company sizes to avoid
- buyingTriggers: Events that indicate purchase intent (array)
- targetPersonas: Decision maker titles (array)
- scoringWeights: Importance of different factors (0-10 each, total 40)

RESPONSE FORMAT:
Provide natural conversation and when you have enough information, output a JSON suggestion in this format:
\`\`\`json
{
  "config": {
    "industries": ["SaaS", "Technology"],
    "geographies": ["North America"],
    "employeeRange": "51-200 employees",
    "annualRevenue": "$1k–$10k",
    "mustHaveTech": ["CRM", "Marketing Automation"],
    "mustHaveMotion": "PLG",
    "excludedIndustries": ["Non-profit"],
    "buyingTriggers": ["new funding", "hiring growth"],
    "targetPersonas": ["CEO", "CTO"],
    "scoringWeights": {
      "firmographic": 8,
      "technographic": 7,
      "intent": 6,
      "behavioral": 5
    }
  },
  "reasoning": "Explanation of why this fits their business",
  "confidence": 0.85,
  "questions": ["Any remaining questions?"],
  "isComplete": false
}
\`\`\`

When the configuration is complete and ready to use, set "isComplete": true.

Follow-up questions: [list specific questions to clarify]

GUIDELINES:
1. Ask clarifying questions to understand their business, product, target market, and goals
2. Suggest realistic, specific ICP configurations based on their context
3. Explain your reasoning clearly
4. Build up the configuration gradually through conversation
5. Focus on actionable, measurable criteria
6. Consider both inclusion and exclusion criteria

Start by understanding their business context and build from there.`;
  }

  async getQuickICPRecommendation(businessContext: string): Promise<ICPConfigSuggestion> {
    const prompt = `Based on this business context, provide a quick ICP configuration recommendation:

Business Context: ${businessContext}

Provide a JSON response with basic ICP configuration including industries, company size, geography, and key technologies.`;

    try {
      const response = await claudeService.generate(prompt, this.getSystemPrompt());
      const parsed = this.parseAIResponse(response);
      
      return parsed.suggestion || {
        config: {
          industries: ['Technology', 'SaaS'],
          employeeRange: '51-200 employees',
          geographies: ['North America'],
          mustHaveTech: [],
          annualRevenue: '$1k–$10k'
        },
        reasoning: 'Quick recommendation based on business context',
        confidence: 0.7,
        isComplete: false
      };
    } catch (error) {
      console.error('Error getting quick recommendation:', error);
      return {
        config: {
          industries: ['Technology', 'SaaS'],
          employeeRange: '51-200 employees', 
          geographies: ['North America'],
          mustHaveTech: [],
          annualRevenue: '$1k–$10k'
        },
        reasoning: 'Fallback configuration',
        confidence: 0.5,
        isComplete: false
      };
    }
  }

  getConversationHistory(): AIConversationMessage[] {
    return this.conversationHistory.filter(msg => msg.role !== 'system');
  }

  getCurrentSuggestion(): ICPConfigSuggestion | undefined {
    return this.currentSuggestion;
  }

  clearConversation(): void {
    this.conversationHistory = this.conversationHistory.filter(msg => msg.role === 'system');
    this.currentSuggestion = undefined;
  }
}

export const icpConfigAgent = new ICPConfigAgent();