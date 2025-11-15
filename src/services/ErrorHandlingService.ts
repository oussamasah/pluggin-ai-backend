// src/services/ErrorHandlingService.ts
import { ollamaService } from './OllamaService.js';

export interface ErrorContext {
  phase: string;
  step: string;
  query?: string;
  icpModel?: any;
  companiesProcessed?: number;
  error: Error;
  sessionId: string;
  additionalContext?: any;
}

export interface UserFriendlyError {
  title: string;
  message: string;
  suggestions: string[];
  technicalDetails?: string; // For internal logging only
  recoverySteps: string[];
  canRetry: boolean;
  estimatedResolutionTime?: string;
}

export class ErrorHandlingService {
  private static instance: ErrorHandlingService;

  public static getInstance(): ErrorHandlingService {
    if (!ErrorHandlingService.instance) {
      ErrorHandlingService.instance = new ErrorHandlingService();
    }
    return ErrorHandlingService.instance;
  }

  /**
   * Generate user-friendly error messages using LLM
   */
  async generateUserFriendlyError(context: ErrorContext): Promise<UserFriendlyError> {
    const systemPrompt = `You are a helpful AI assistant that explains technical errors in a user-friendly way.
    
IMPORTANT SECURITY RULES:
- NEVER mention specific API providers, service names, or technical endpoints
- NEVER reveal API keys, authentication details, or internal system information
- NEVER mention specific database systems or internal infrastructure
- Use generic terms like "data services", "analysis systems", or "processing engines"
- Focus on what the user can do, not technical details

Your goal is to:
1. Explain what happened in simple, non-technical terms
2. Provide actionable suggestions
3. Estimate resolution time if possible
4. Maintain user confidence`;

    const prompt = `
ERROR CONTEXT:
- Phase: ${context.phase}
- Step: ${context.step}
- Query: "${context.query || 'Not specified'}"
- Companies Processed: ${context.companiesProcessed || 0}
- Error Type: ${context.error.name}
- Session: ${context.sessionId}

ADDITIONAL CONTEXT:
${JSON.stringify(context.additionalContext || {}, null, 2)}

ERROR MESSAGE (for context only - do not reveal to user):
${context.error.message}

Please generate a user-friendly error response with:
1. A clear, non-technical title
2. A simple explanation of what happened
3. 3-5 actionable suggestions for the user
4. Recovery steps they can take
5. Whether they can retry the operation
6. Estimated resolution time if applicable

Return ONLY valid JSON in this exact format:
{
  "title": "Clear error title",
  "message": "User-friendly explanation",
  "suggestions": ["array", "of", "suggestions"],
  "recoverySteps": ["step1", "step2"],
  "canRetry": true/false,
  "estimatedResolutionTime": "optional time estimate"
}`;

    try {
      const response = await ollamaService.generate(prompt, systemPrompt);
      const parsedError = this.parseJSONResponse(response);
      
      // Add technical details for internal logging (not shown to user)
      return {
        ...parsedError,
        technicalDetails: this.sanitizeTechnicalDetails(context.error)
      };
    } catch (llmError) {
      console.error('Failed to generate user-friendly error:', llmError);
      return this.getFallbackError(context);
    }
  }

  /**
   * Handle specific workflow phase errors with tailored responses
   */
  async handleWorkflowError(context: ErrorContext): Promise<UserFriendlyError> {
    // Phase-specific error handling
    const phaseHandlers = {
      'Dynamic ICP Discovery': this.handleDiscoveryError.bind(this),
      'Account Intelligence': this.handleAccountIntelligenceError.bind(this),
      'Persona Intelligence': this.handlePersonaIntelligenceError.bind(this),
      'Intent & Timing Intelligence': this.handleIntentIntelligenceError.bind(this)
    };

    const handler = phaseHandlers[context.phase as keyof typeof phaseHandlers] || 
                   this.generateUserFriendlyError.bind(this);
    
    return handler(context);
  }

  private async handleDiscoveryError(context: ErrorContext): Promise<UserFriendlyError> {
    const systemPrompt = `Specialize in ICP discovery errors. Focus on search refinement and data availability.`;

    const prompt = `
ICP DISCOVERY ERROR - User is trying to find companies matching their criteria.

Error Context:
- Query: "${context.query}"
- ICP Model: ${context.icpModel?.name || 'Not specified'}
- Error: ${context.error.message}

Common discovery issues:
1. Overly specific search criteria
2. Limited data for certain industries/regions
3. Temporary data service unavailability
4. Complex query combinations

Provide helpful guidance on refining their search.`;

    const response = await ollamaService.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    return {
      ...parsed,
      technicalDetails: this.sanitizeTechnicalDetails(context.error),
      canRetry: true,
      estimatedResolutionTime: "2-5 minutes"
    };
  }

  private async handleAccountIntelligenceError(context: ErrorContext): Promise<UserFriendlyError> {
    const systemPrompt = `Specialize in data enrichment and analysis errors. Focus on data quality and processing.`;

    const prompt = `
ACCOUNT INTELLIGENCE ERROR - Error occurred during company data analysis.

Progress Made:
- Companies processed: ${context.companiesProcessed}
- Phase: ${context.phase}
- Step: ${context.step}

This typically involves data enrichment, scoring, or analysis. Provide guidance on data quality and alternative approaches.`;

    const response = await ollamaService.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    return {
      ...parsed,
      technicalDetails: this.sanitizeTechnicalDetails(context.error),
      canRetry: context.companiesProcessed > 0, // Can retry if some progress was made
      estimatedResolutionTime: "5-10 minutes"
    };
  }

  private async handlePersonaIntelligenceError(context: ErrorContext): Promise<UserFriendlyError> {
    const systemPrompt = `Specialize in persona and contact data errors. Focus on data availability and quality.`;

    const prompt = `
PERSONA INTELLIGENCE ERROR - Error occurred while processing contact and persona data.

This involves:
- Finding decision makers
- Enriching contact information
- Analyzing professional profiles

Provide guidance on persona targeting and data availability.`;

    const response = await ollamaService.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    return {
      ...parsed,
      technicalDetails: this.sanitizeTechnicalDetails(context.error),
      canRetry: true,
      estimatedResolutionTime: "3-7 minutes"
    };
  }

  private async handleIntentIntelligenceError(context: ErrorContext): Promise<UserFriendlyError> {
    const systemPrompt = `Specialize in intent signal detection errors. Focus on signal availability and analysis.`;

    const prompt = `
INTENT INTELLIGENCE ERROR - Error occurred while detecting buying signals and intent.

This involves:
- Analyzing company signals
- Scoring purchase intent
- Detecting growth patterns

Provide guidance on intent analysis and alternative signal sources.`;

    const response = await ollamaService.generate(prompt, systemPrompt);
    const parsed = this.parseJSONResponse(response);
    
    return {
      ...parsed,
      technicalDetails: this.sanitizeTechnicalDetails(context.error),
      canRetry: context.companiesProcessed > 0,
      estimatedResolutionTime: "5-8 minutes"
    };
  }

  /**
   * Generate retry suggestions based on error type
   */
  async generateRetryStrategy(context: ErrorContext): Promise<{
    canRetry: boolean;
    retryDelay: number;
    suggestedChanges?: string[];
  }> {
    const systemPrompt = `Analyze errors and suggest retry strategies.`;

    const prompt = `
Error Analysis for Retry Strategy:
- Phase: ${context.phase}
- Step: ${context.step}
- Error Type: ${context.error.name}
- Companies Processed: ${context.companiesProcessed}

Should we retry? What changes might help? Consider:
1. Temporary vs permanent errors
2. Data quality issues
3. Rate limiting
4. Service availability

Return JSON: { "canRetry": boolean, "retryDelay": number, "suggestedChanges": string[] }`;

    try {
      const response = await ollamaService.generate(prompt, systemPrompt);
      return this.parseJSONResponse(response);
    } catch {
      // Default retry strategy
      return {
        canRetry: !this.isPermanentError(context.error),
        retryDelay: 30000, // 30 seconds
        suggestedChanges: ['Try a broader search', 'Check your criteria', 'Wait a few minutes']
      };
    }
  }

  /**
   * Generate progress-preserving error messages
   */
  async generatePartialResultsMessage(
    companies: any[], 
    totalExpected: number,
    errorContext: ErrorContext
  ): Promise<string> {
    const systemPrompt = `Explain partial results when a search completes with some data but encountered errors.`;

    const prompt = `
PARTIAL RESULTS EXPLANATION

Search completed with partial results:
- Companies found: ${companies.length}
- Total expected: ${totalExpected}
- Error phase: ${errorContext.phase}

Explain that we have some results but the search couldn't complete fully.
Be positive about the results we have while acknowledging the limitation.

Return a clear, encouraging message about the partial results.`;

    try {
      return await ollamaService.generate(prompt, systemPrompt);
    } catch {
      return `We found ${companies.length} companies that match your criteria. The search encountered some limitations but returned these promising results.`;
    }
  }

  private parseJSONResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(response);
    } catch (error) {
      console.error('Failed to parse error response:', response);
      return {};
    }
  }

  private sanitizeTechnicalDetails(error: Error): string {
    // Remove sensitive information from error messages
    let message = error.message;
    
    // Remove API keys, tokens, and sensitive URLs
    message = message.replace(/(api[_-]?key|token|auth|password)=[^&\s]+/gi, '[REDACTED]');
    message = message.replace(/(https?:\/\/)[^\/]+\/([^?\s]+)/g, '$1[REDACTED]/$2');
    message = message.replace(/(coresignal|exa|perplexity|openrouter)/gi, '[SERVICE]');
    
    return message;
  }

  private isPermanentError(error: Error): boolean {
    const permanentIndicators = [
      'invalid',
      'not found',
      'unauthorized',
      'forbidden',
      'quota exceeded',
      'permission denied'
    ];
    
    return permanentIndicators.some(indicator => 
      error.message.toLowerCase().includes(indicator)
    );
  }

  private getFallbackError(context: ErrorContext): UserFriendlyError {
    const phaseFallbacks = {
      'Dynamic ICP Discovery': {
        title: "Search Refinement Needed",
        message: "We encountered some challenges finding companies that match all your specific criteria.",
        suggestions: [
          "Try broadening your industry or location criteria",
          "Consider adjusting the company size range",
          "Use more general search terms"
        ]
      },
      'Account Intelligence': {
        title: "Data Processing Delay",
        message: "We're experiencing some delays in analyzing company information.",
        suggestions: [
          "Please try again in a few minutes",
          "Check if your criteria might be too specific",
          "Consider splitting your search into multiple queries"
        ]
      },
      'Persona Intelligence': {
        title: "Contact Information Processing",
        message: "We're having temporary issues gathering detailed contact information.",
        suggestions: [
          "The company data is still available - you can proceed with what we have",
          "Try the search again shortly",
          "Consider using the company data with your own contact research"
        ]
      },
      'Intent & Timing Intelligence': {
        title: "Signal Analysis Temporary Issue",
        message: "We're experiencing temporary issues analyzing company growth signals.",
        suggestions: [
          "The core company matches are still valid",
          "Try the analysis again in a few minutes",
          "Proceed with the companies found - you can add signal analysis later"
        ]
      }
    };

    const fallback = phaseFallbacks[context.phase as keyof typeof phaseFallbacks] || {
      title: "Temporary Processing Issue",
      message: "We're experiencing a temporary issue with our analysis systems.",
      suggestions: [
        "Please try again in a few minutes",
        "Check your search criteria",
        "Contact support if the issue persists"
      ]
    };

    return {
      ...fallback,
      recoverySteps: ["Wait a few minutes", "Try your search again", "Adjust criteria if needed"],
      canRetry: true,
      estimatedResolutionTime: "2-5 minutes",
      technicalDetails: this.sanitizeTechnicalDetails(context.error)
    };
  }
}

export const errorHandler = ErrorHandlingService.getInstance();