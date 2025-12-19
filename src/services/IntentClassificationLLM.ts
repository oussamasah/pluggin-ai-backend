// src/services/IntentClassificationLLM.ts
import { openRouterService } from '../utils/OpenRouterService.js';
import { ollamaService, OllamaService } from './OllamaService.js';

export interface IntentClassification {
  intent: 'greeting' | 'company_search' | 'search_refinement' | 'signals' | 'results_actions' | 'thanking' | 'motivation' | 'other';
  confidence: number;
  enhanced_query?: string;
  reasoning: string;
  suggested_action: 'search' | 'refine_search' | 'analyze_signals' | 'handle_results' | 'respond' | 'acknowledge';
  is_follow_up: boolean;
  references_previous: boolean;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface ConversationContext {
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  lastIntent: IntentClassification | null;
  searchContext?: {
    currentQuery: string;
    resultsCount: number;
    activeFilters: any;
  };
}

export interface ClassificationResponse {
  classification: IntentClassification;
  response: string;
  action?: {
    type: 'start_search' | 'refine_search' | 'analyze_signals' | 'handle_results' | 'respond_only' | 'acknowledge_only';
    query?: string;
    scope?: string;
  };
}

export class IntentClassificationLLM {
  private ollamaService: OllamaService;

  constructor(ollamaService: OllamaService) {
    this.ollamaService = ollamaService;
  }

  /**
   * Classify user intent with conversation context
   */
  async classifyIntent(
    message: string, 
    context?: ConversationContext
  ): Promise<IntentClassification> {
    
    const systemPrompt = `You are an intent classifier for a B2B company search platform. 
Analyze user messages and classify their intent with attention to social interactions.

INTENT CATEGORIES:
1. "greeting" - Simple greetings, hellos, conversation starters
2. "company_search" - New requests to find/search for companies, businesses, startups
3. "search_refinement" - Modifications, filters, or follow-ups to current search
4. "signals" - Requests for growth signals, intent data, hiring trends, funding alerts
5. "results_actions" - Actions on results (export, save, compare, analyze details)
6. "thanking" - Expressions of gratitude, appreciation, thanks
7. "motivation" - Positive feedback, compliments, encouragement, praise
8. "other" - Everything else (platform questions, feature requests, unrelated topics)

SPECIAL NOTES:
- "thanking" includes: thanks, thank you, appreciate it, etc.
- "motivation" includes: good job, well done, great work, awesome, excellent, etc.
- These can be combined with other intents (e.g., "thanks for finding those companies")
- Consider sentiment and emotional tone in classification

Be precise and consider conversation context when available.`;

    const prompt = this.buildClassificationPrompt(message, context);

    try {
      const response =await openRouterService.generate(prompt, systemPrompt);
      return this.parseIntentResponse(response, message, context);
    } catch (error) {
      console.error('Intent classification error:', error);
      return this.getFallbackClassification(message, context);
    }
  }

  /**
   * Generate appropriate response based on classified intent
   */
  async generateResponse(
    message: string,
    classification: IntentClassification,
    icpModel?: any,
    context?: ConversationContext
  ): Promise<ClassificationResponse> {
    
    const responseMessage = await this.generateResponseMessage(message, classification, icpModel, context);
    const action = this.determineAction(classification, context);

    return {
      classification,
      response: responseMessage,
      action
    };
  }

  /**
   * Process complete message with classification and response generation
   */
  async processMessage(
    message: string,
    context?: ConversationContext,
    icpModel?: any
  ): Promise<ClassificationResponse> {
    
    const classification = await this.classifyIntent(message, context);
    return this.generateResponse(message, classification, icpModel, context);
  }

  // Private helper methods
  private buildClassificationPrompt(message: string, context?: ConversationContext): string {
    if (!context) {
      return `
USER MESSAGE: "${message}"

CLASSIFY THIS MESSAGE:
- Is this a greeting, thanking, or motivation?
- Is this requesting to find/search for companies?
- Is this asking for signals or market intelligence?
- Is this a platform question or unrelated?
- What is the sentiment (positive, negative, neutral)?

DETECT SOCIAL INTERACTIONS:
- Thanking: thanks, thank you, appreciate, grateful
- Motivation: good job, well done, great work, awesome, excellent, perfect
- Can be combined with other intents

RESPONSE FORMAT:
{
  "intent": "greeting" | "company_search" | "search_refinement" | "signals" | "results_actions" | "thanking" | "motivation" | "other",
  "confidence": 0.95,
  "enhanced_query": "if search-related, provide optimized query",
  "reasoning": "brief explanation including sentiment analysis",
  "suggested_action": "search" | "refine_search" | "analyze_signals" | "handle_results" | "respond" | "acknowledge",
  "is_follow_up": false,
  "references_previous": false,
  "sentiment": "positive" | "negative" | "neutral"
}
`;
    }

    return `
CONVERSATION CONTEXT:
${this.formatConversationContext(context)}

CURRENT USER MESSAGE: "${message}"

PREVIOUS INTENT: ${context.lastIntent?.intent || 'none'}
CURRENT SEARCH: ${context.searchContext?.currentQuery || 'none'}
RESULTS COUNT: ${context.searchContext?.resultsCount || 0}

ANALYSIS QUESTIONS:
- Is this a new search or refining the current one?
- Does this reference previous messages or results?
- Is this thanking or motivation related to previous assistance?
- What is the sentiment and emotional tone?
- Is this asking for actions on current results?
- Is this completely new direction?

SOCIAL INTERACTION DETECTION:
- Look for thanking expressions
- Look for motivational feedback
- Consider if combined with other intents

RESPONSE FORMAT:
{
  "intent": "greeting" | "company_search" | "search_refinement" | "signals" | "results_actions" | "thanking" | "motivation" | "other",
  "confidence": 0.95,
  "enhanced_query": "if search-related, provide optimized query considering context",
  "reasoning": "explanation considering conversation context and sentiment",
  "suggested_action": "search" | "refine_search" | "analyze_signals" | "handle_results" | "respond" | "acknowledge",
  "is_follow_up": boolean,
  "references_previous": boolean,
  "sentiment": "positive" | "negative" | "neutral"
}
`;
  }

  private formatConversationContext(context: ConversationContext): string {
    if (!context.history || context.history.length === 0) {
      return "No previous conversation history.";
    }

    // Show last 3 exchanges for context
    const recentHistory = context.history.slice(-6);
    
    return recentHistory.map(entry => 
      `${entry.role.toUpperCase()}: ${entry.content}`
    ).join('\n');
  }

  private parseIntentResponse(response: string, originalMessage: string, context?: ConversationContext): IntentClassification {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(response);

      return this.validateIntentClassification(parsed, originalMessage, context);
    } catch (error) {
      console.error('Failed to parse intent response:', response);
      return this.getFallbackClassification(originalMessage, context);
    }
  }

  private validateIntentClassification(parsed: any, originalMessage: string, context?: ConversationContext): IntentClassification {
    // Validate intent type
    const validIntents = ['greeting', 'company_search', 'search_refinement', 'signals', 'results_actions', 'thanking', 'motivation', 'other'];
    const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'other';
    
    // Validate confidence
    let confidence = Math.min(1, Math.max(0, parsed.confidence || 0));
    if (confidence === 0) {
      confidence = this.calculateFallbackConfidence(originalMessage, intent);
    }

    // Auto-detect follow-up and references if not provided
    const is_follow_up = parsed.is_follow_up ?? this.detectFollowUp(originalMessage, context);
    const references_previous = parsed.references_previous ?? this.detectPreviousReference(originalMessage, context);
    
    // Auto-detect sentiment if not provided
    const sentiment = parsed.sentiment || this.detectSentiment(originalMessage);

    return {
      intent,
      confidence,
      enhanced_query: parsed.enhanced_query || this.enhanceSearchQuery(originalMessage, intent),
      reasoning: parsed.reasoning || 'Automated classification',
      suggested_action: parsed.suggested_action || this.mapIntentToAction(intent),
      is_follow_up,
      references_previous,
      sentiment
    };
  }

  private detectSentiment(message: string): 'positive' | 'negative' | 'neutral' {
    const lowerMessage = message.toLowerCase();
    
    const positiveWords = [
      'thanks', 'thank you', 'appreciate', 'grateful', 'awesome', 'great', 'good', 'excellent',
      'perfect', 'amazing', 'fantastic', 'wonderful', 'brilliant', 'outstanding', 'impressive',
      'good job', 'well done', 'nice work', 'excellent work', 'great work', 'awesome job'
    ];
    
    const negativeWords = [
      'bad', 'terrible', 'awful', 'horrible', 'useless', 'wrong', 'incorrect', 'disappointing',
      'poor', 'sucks', 'waste', 'frustrating', 'annoying', 'hate', 'dislike'
    ];

    const positiveCount = positiveWords.filter(word => lowerMessage.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerMessage.includes(word)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  private detectFollowUp(message: string, context?: ConversationContext): boolean {
    if (!context || !context.lastIntent) return false;

    const lowerMessage = message.toLowerCase();
    const followUpIndicators = [
      /(more|another|additional)\s+/i,
      /(also|too|as well)\b/i,
      /(what about|how about)\s+/i,
      /\b(and|with)\s+.*\b(too|also)\b/i,
      /(next|then|now)\s+/i,
      /(thanks for|thank you for).*(previous|last|earlier)/i
    ];

    return followUpIndicators.some(pattern => pattern.test(lowerMessage));
  }

  private detectPreviousReference(message: string, context?: ConversationContext): boolean {
    if (!context || !context.searchContext?.currentQuery) return false;

    const lowerMessage = message.toLowerCase();
    const currentQuery = context.searchContext.currentQuery.toLowerCase();
    
    // Check if message references previous search terms
    const searchTerms = currentQuery.split(/\s+/).filter(term => term.length > 3);
    return searchTerms.some(term => lowerMessage.includes(term));
  }

  private enhanceSearchQuery(message: string, intent: string): string | undefined {
    if (intent !== 'company_search' && intent !== 'search_refinement') {
      return undefined;
    }

    let enhanced = message
      .replace(/\b(find|search|look for|show me|get)\b/gi, '')
      .replace(/\b(thanks|thank you|appreciate)\b/gi, '') // Remove thanking words from query
      .replace(/\s+/g, ' ')
      .trim();

    // Add context if missing
    if (!enhanced.includes('compan') && !enhanced.includes('startup') && !enhanced.includes('business')) {
      enhanced = `${enhanced} companies`;
    }

    return enhanced;
  }

  private calculateFallbackConfidence(message: string, intent: string): number {
    const lowerMessage = message.toLowerCase();
    
    // High confidence patterns
    if (intent === 'greeting' && /(hello|hi|hey|greetings)/i.test(lowerMessage)) return 0.95;
    if (intent === 'thanking' && this.isThankingMessage(lowerMessage)) return 0.92;
    if (intent === 'motivation' && this.isMotivationMessage(lowerMessage)) return 0.90;
    if (intent === 'company_search' && /(company|companies|startup|find|search)/i.test(lowerMessage)) return 0.85;
    if (intent === 'signals' && /(signal|trend|hiring|funding|growth)/i.test(lowerMessage)) return 0.80;
    if (intent === 'results_actions' && /(export|download|save|compare|analyze)/i.test(lowerMessage)) return 0.75;
    
    return 0.70;
  }

  private isThankingMessage(message: string): boolean {
    const thankingPatterns = [
      /\b(thanks|thank you|thx|ty)\b/i,
      /\b(appreciate|grateful|gratitude)\b/i,
      /thank.*(help|assist|support)/i,
      /(much appreciated|thanks a lot|thank you very much)/i
    ];
    return thankingPatterns.some(pattern => pattern.test(message));
  }

  private isMotivationMessage(message: string): boolean {
    const motivationPatterns = [
      /\b(good job|well done|great work|nice work)\b/i,
      /\b(awesome|excellent|fantastic|amazing|brilliant)\b.*(work|job)/i,
      /\b(perfect|outstanding|impressive|superb)\b/i,
      /(you.re? (great|awesome|amazing)|love your work)/i,
      /(keep up the good work|doing great)/i
    ];
    return motivationPatterns.some(pattern => pattern.test(message));
  }

  private mapIntentToAction(intent: string): string {
    const actionMap = {
      'greeting': 'respond',
      'company_search': 'search',
      'search_refinement': 'refine_search', 
      'signals': 'analyze_signals',
      'results_actions': 'handle_results',
      'thanking': 'acknowledge',
      'motivation': 'acknowledge',
      'other': 'respond'
    };
    
    return actionMap[intent] || 'respond';
  }

  private async generateResponseMessage(
    message: string,
    classification: IntentClassification,
    icpModel?: any,
    context?: ConversationContext
  ): Promise<string> {
    
    switch (classification.intent) {
      case 'greeting':
        return this.getRandomGreeting();

      case 'thanking':
        return this.getThankingResponse(message, classification, context);

      case 'motivation':
        return this.getMotivationResponse(message, classification, context);

      case 'company_search':
        return await this.generateSearchResponse(message, classification, icpModel, false);

      case 'search_refinement':
        return await this.generateSearchResponse(message, classification, icpModel, true);

      case 'signals':
        return `I'll analyze growth signals and intent data for you.${
          classification.confidence < 0.8 ?
          `\n\n*Note: I'm ${Math.round(classification.confidence * 100)}% sure you're asking for signals.*` :
          ''
        }`;

      case 'results_actions':
        return this.generateResultsActionResponse(message, classification);

      default:
        return "I specialize in company search and market intelligence. You can ask me to:\n• Find specific companies or industries\n• Analyze growth signals and market trends\n• Get detailed company intelligence";
    }
  }

  private getThankingResponse(message: string, classification: IntentClassification, context?: ConversationContext): string {
    const responses = [
      "You're welcome! I'm glad I could help. Is there anything else you'd like me to search for or analyze?",
      "You're very welcome! Happy to assist with your company search needs.",
      "My pleasure! Let me know if you need any more help finding companies or analyzing market data.",
      "Glad to be of help! Feel free to ask if you have more questions about companies or market trends."
    ];

    // Check if thanking is combined with another request
    const hasSearchIntent = message.toLowerCase().includes('compan') || 
                           message.toLowerCase().includes('search') ||
                           message.toLowerCase().includes('find');

    if (hasSearchIntent && classification.enhanced_query) {
      return `${responses[Math.floor(Math.random() * responses.length)]}\n\nI'll continue with: "${classification.enhanced_query}"`;
    }

    return responses[Math.floor(Math.random() * responses.length)];
  }

  private getMotivationResponse(message: string, classification: IntentClassification, context?: ConversationContext): string {
    const responses = [
      "Thank you! I'm here to make company search and market analysis as helpful as possible for you.",
      "I appreciate the feedback! Let me know what else I can help you discover.",
      "That means a lot! I'll keep working to provide you with the best company intelligence.",
      "Thanks for the encouragement! I'm always learning to better serve your business research needs."
    ];

    // Check if motivation is combined with a request
    const hasAdditionalRequest = classification.is_follow_up || 
                                message.toLowerCase().includes('can you') ||
                                message.toLowerCase().includes('please');

    const baseResponse = responses[Math.floor(Math.random() * responses.length)];

    if (hasAdditionalRequest && classification.enhanced_query) {
      return `${baseResponse}\n\nI'll help you with: "${classification.enhanced_query}"`;
    }

    return baseResponse;
  }

  private async generateSearchResponse(
    message: string,
    classification: IntentClassification,
    icpModel?: any,
    isRefinement: boolean = false
  ): Promise<string> {
    const enhancedQuery = classification.enhanced_query || message;
    
    let finalQuery = enhancedQuery;
    if (icpModel) {
      try {
        const merged = await this.ollamaService.mergeICPWithUserQuery(enhancedQuery, icpModel);
        finalQuery = merged.structuredQuery;
      } catch (error) {
        console.error('Error merging ICP with query:', error);
      }
    }

    const baseMessage = isRefinement ? 
      `I'll refine your search to: "${finalQuery}"` :
      `I'll search for companies based on: "${finalQuery}"`;

    // Check if there's thanking/motivation combined
    const hasSocialIntent = classification.intent === 'thanking' || classification.intent === 'motivation';
    const socialPrefix = hasSocialIntent ? 
      `${this.getSocialAcknowledgment(classification.intent)} ` : 
      '';

    return classification.confidence < 0.8 ? 
      `${socialPrefix}${baseMessage}\n\n*Note: I'm ${Math.round(classification.confidence * 100)}% sure this is a company search. If I misunderstood, please clarify!*` :
      `${socialPrefix}${baseMessage}`;
  }

  private getSocialAcknowledgment(intent: 'thanking' | 'motivation'): string {
    if (intent === 'thaking') {
      return "You're welcome!";
    } else {
      return "Thank you!";
    }
  }

  private generateResultsActionResponse(message: string, classification: IntentClassification): string {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('export') || lowerMessage.includes('download')) {
      return "I'll prepare the results for export.";
    } else if (lowerMessage.includes('compare')) {
      return "I'll analyze and compare the companies for you.";
    } else if (lowerMessage.includes('analyze') || lowerMessage.includes('break down')) {
      return "I'll provide a detailed analysis of the results.";
    } else {
      return "I'll help you with these results.";
    }
  }

  private determineAction(
    classification: IntentClassification, 
    context?: ConversationContext
  ): any {
    switch (classification.suggested_action) {
      case 'search':
        return {
          type: 'start_search',
          query: classification.enhanced_query,
          confidence: classification.confidence
        };
        
      case 'refine_search':
        return {
          type: 'refine_search', 
          query: classification.enhanced_query,
          previous_query: context?.searchContext?.currentQuery,
          confidence: classification.confidence
        };
        
      case 'analyze_signals':
        return {
          type: 'analyze_signals',
          scope: 'general',
          confidence: classification.confidence
        };
        
      case 'handle_results':
        return {
          type: 'handle_results',
          action_type: this.determineResultsActionType(classification.enhanced_query || ''),
          confidence: classification.confidence
        };
        
      case 'acknowledge':
        return {
          type: 'acknowledge_only',
          confidence: classification.confidence
        };
        
      default:
        return {
          type: 'respond_only',
          confidence: classification.confidence
        };
    }
  }

  private determineResultsActionType(query: string): string {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('export') || lowerQuery.includes('download')) return 'export';
    if (lowerQuery.includes('compare')) return 'compare';
    if (lowerQuery.includes('analyze')) return 'analyze';
    return 'general';
  }

  private getRandomGreeting(): string {
    const greetings = [
      "Hello! I'm here to help you find companies and analyze market signals. What would you like to search for?",
      "Hi there! Ready to discover some amazing companies and growth opportunities?",
      "Hey! I specialize in company search and market intelligence. How can I assist you today?",
      "Greetings! I can help you find target companies or analyze market trends. What's on your mind?"
    ];
    
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  private getFallbackClassification(message: string, context?: ConversationContext): IntentClassification {
    const lowerMessage = message.toLowerCase();
    
    // Check for thanking first
    if (this.isThankingMessage(lowerMessage)) {
      return {
        intent: 'thanking',
        confidence: 0.9,
        reasoning: 'Fallback: Contains thanking expressions',
        suggested_action: 'acknowledge',
        is_follow_up: this.detectFollowUp(message, context),
        references_previous: this.detectPreviousReference(message, context),
        sentiment: 'positive'
      };
    }
    
    // Check for motivation
    if (this.isMotivationMessage(lowerMessage)) {
      return {
        intent: 'motivation',
        confidence: 0.88,
        reasoning: 'Fallback: Contains motivational feedback',
        suggested_action: 'acknowledge',
        is_follow_up: this.detectFollowUp(message, context),
        references_previous: this.detectPreviousReference(message, context),
        sentiment: 'positive'
      };
    }
    
    // Original fallback logic
    if (/(hello|hi|hey|greetings|good morning|good afternoon)/i.test(lowerMessage)) {
      return {
        intent: 'greeting',
        confidence: 0.9,
        reasoning: 'Fallback: Contains greeting keywords',
        suggested_action: 'respond',
        is_follow_up: false,
        references_previous: false,
        sentiment: 'positive'
      };
    }
    
    if (/(company|companies|business|startup|find|search|locate|list)/i.test(lowerMessage)) {
      const is_follow_up = this.detectFollowUp(message, context);
      
      return {
        intent: is_follow_up ? 'search_refinement' : 'company_search',
        confidence: 0.8,
        enhanced_query: this.enhanceSearchQuery(message, 'company_search'),
        reasoning: 'Fallback: Contains search-related keywords',
        suggested_action: is_follow_up ? 'refine_search' : 'search',
        is_follow_up,
        references_previous: this.detectPreviousReference(message, context),
        sentiment: 'neutral'
      };
    }
    
    if (/(signal|intent|trend|hiring|funding|growth|market|analysis)/i.test(lowerMessage)) {
      return {
        intent: 'signals', 
        confidence: 0.8,
        reasoning: 'Fallback: Contains signal-related keywords',
        suggested_action: 'analyze_signals',
        is_follow_up: this.detectFollowUp(message, context),
        references_previous: this.detectPreviousReference(message, context),
        sentiment: 'neutral'
      };
    }
    
    if (/(export|download|save|compare|analyze)/i.test(lowerMessage)) {
      return {
        intent: 'results_actions',
        confidence: 0.75,
        reasoning: 'Fallback: Contains results action keywords',
        suggested_action: 'handle_results',
        is_follow_up: true,
        references_previous: true,
        sentiment: 'neutral'
      };
    }
    
    return {
      intent: 'other',
      confidence: 0.7,
      reasoning: 'Fallback: Default classification',
      suggested_action: 'respond',
      is_follow_up: false,
      references_previous: false,
      sentiment: 'neutral'
    };
  }
}

// Export singleton instance
export const intentClassifier = new IntentClassificationLLM(ollamaService);