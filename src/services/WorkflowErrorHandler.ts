
import { v4 as uuidv4 } from 'uuid';
import { Types } from 'mongoose';
import { ICPModel } from '../core/types';
import { ollamaService } from './OllamaService';

// Add these new interfaces
interface ErrorContext {
  phase: string;
  step: string;
  query: string;
  icpModel: ICPModel;
  partialResults?: any[];
  errorDetails: any;
}

interface QueryRefinementSuggestion {
  originalQuery: string;
  suggestions: Array<{
    refinedQuery: string;
    reason: string;
    expectedImprovement: string;
  }>;
  diagnostics: {
    issuesDetected: string[];
    dataQualityScore: number;
    recommendations: string[];
  };
}

// Add this new service for error handling and query refinement
export class WorkflowErrorHandler {
  
  /**
   * Generate comprehensive error analysis and recovery suggestions
   */
  static async analyzeError(errorContext: ErrorContext): Promise<{
    errorAnalysis: string;
    recoverySuggestions: string[];
    queryRefinement?: QueryRefinementSuggestion;
    canRetry: boolean;
    partialResultsAvailable: boolean;
    rootCause: string;
  }> {
    const prompt = `
You are an expert at analyzing B2B prospecting workflow failures. Analyze this error and provide actionable insights.

**Error Context:**
- Phase: ${errorContext.phase}
- Step: ${errorContext.step}
- Original Query: "${errorContext.query}"
- Error: ${JSON.stringify(errorContext.errorDetails, null, 2)}
- ICP Model: ${JSON.stringify(errorContext.icpModel.config, null, 2)}
- Partial Results Found: ${errorContext.partialResults?.length || 0}

**Your Task:**
1. Explain what went wrong in simple, non-technical terms
2. Determine if this is recoverable (retry-able)
3. Provide specific, actionable suggestions to fix the issue
4. Identify the root cause category

Respond in JSON format:
{
  "errorAnalysis": "Clear explanation of what happened and why",
  "recoverySuggestions": ["specific action 1", "specific action 2", "specific action 3"],
  "canRetry": true/false,
  "partialResultsAvailable": true/false,
  "rootCause": "technical|query|data|api|configuration|rate_limit|network"
}`;

    try {
      const response = await ollamaService.generate(prompt);
      return JSON.parse(response);
    } catch (error) {
      // Fallback error analysis based on error type
      const errorMessage = errorContext.errorDetails.message || '';
      const isNetworkError = errorMessage.includes('network') || errorMessage.includes('timeout');
      const isAPIError = errorMessage.includes('API') || errorMessage.includes('401') || errorMessage.includes('403');
      const isRateLimit = errorMessage.includes('rate limit') || errorMessage.includes('429');
      
      return {
        errorAnalysis: `An error occurred during ${errorContext.phase}: ${errorContext.errorDetails.message}`,
        recoverySuggestions: isNetworkError ? [
          'Check your internet connection and try again',
          'Verify that external APIs are accessible',
          'Try again in a few moments'
        ] : isAPIError ? [
          'Verify your API credentials are valid and active',
          'Check that API keys have necessary permissions',
          'Contact support if credentials appear correct'
        ] : isRateLimit ? [
          'Wait a few minutes before retrying',
          'Reduce the number of companies requested',
          'Consider upgrading your API plan for higher limits'
        ] : [
          'Try simplifying your search query',
          'Reduce the number of companies requested',
          'Check that your ICP configuration is valid',
          'Try again with different search terms'
        ],
        canRetry: true,
        partialResultsAvailable: (errorContext.partialResults?.length || 0) > 0,
        rootCause: isNetworkError ? 'network' : isAPIError ? 'api' : isRateLimit ? 'rate_limit' : 'technical'
      };
    }
  }

  /**
   * Generate query refinement suggestions
   */
  static async generateQueryRefinements(
    query: string,
    icpModel: ICPModel,
    errorContext?: ErrorContext
  ): Promise<QueryRefinementSuggestion> {
    const prompt = `
You are an expert at crafting effective B2B company search queries. Help refine this search query to get better results.

**Original Query:** "${query}"

**ICP Configuration:**
- Industries: ${icpModel.config.industries?.join(', ') || 'Not specified'}
- Company Size: ${icpModel.config.companySize || 'Not specified'}
- Locations: ${icpModel.config.locations?.join(', ') || 'Not specified'}
- Target Personas: ${icpModel.config.targetPersonas?.join(', ') || 'Not specified'}

${errorContext ? `**Previous Error:** ${errorContext.errorDetails.message}` : ''}

**Your Task:**
Generate 3-5 refined query variations that:
1. Are more specific and targeted to find the right companies
2. Align better with the ICP model specifications
3. Use effective keywords and search terms
4. Address any issues from the previous attempt
5. Are likely to return quality results

Respond in JSON format:
{
  "suggestions": [
    {
      "refinedQuery": "the improved query text",
      "reason": "clear explanation why this is better",
      "expectedImprovement": "what kind of results to expect"
    }
  ],
  "diagnostics": {
    "issuesDetected": ["specific issue 1", "specific issue 2"],
    "dataQualityScore": 0-100,
    "recommendations": ["actionable tip 1", "actionable tip 2"]
  }
}`;

    try {
      const response = await ollamaService.generate(prompt);
      const result = JSON.parse(response);
      return {
        originalQuery: query,
        ...result
      };
    } catch (error) {
      // Fallback suggestions based on ICP config
      const suggestions = [];
      
      // Add industry-specific refinement
      if (icpModel.config.industries && icpModel.config.industries.length > 0) {
        suggestions.push({
          refinedQuery: `${query} ${icpModel.config.industries[0]} companies`,
          reason: 'Added industry focus to narrow results to your target market',
          expectedImprovement: 'More relevant companies in your target industry'
        });
      }
      
      // Add size-specific refinement
      if (icpModel.config.companySize) {
        suggestions.push({
          refinedQuery: `${query} ${icpModel.config.companySize} B2B companies`,
          reason: 'Added company size qualifier to match your ICP',
          expectedImprovement: 'Companies that match your target company size'
        });
      }
      
      // Add location-specific refinement
      if (icpModel.config.locations && icpModel.config.locations.length > 0) {
        suggestions.push({
          refinedQuery: `${query} companies in ${icpModel.config.locations[0]}`,
          reason: 'Added geographic focus to your target region',
          expectedImprovement: 'Companies in your target geographic market'
        });
      }
      
      // Always add a broader search option
      suggestions.push({
        refinedQuery: `${query} B2B enterprise companies`,
        reason: 'Broadened search with B2B and enterprise qualifiers',
        expectedImprovement: 'Wider range of business-focused results'
      });
      
      return {
        originalQuery: query,
        suggestions: suggestions.slice(0, 5), // Max 5 suggestions
        diagnostics: {
          issuesDetected: ['Query may need more specificity', 'Consider adding industry or size filters'],
          dataQualityScore: 50,
          recommendations: [
            'Be more specific about your target market',
            'Include industry-specific terms',
            'Add company size indicators if relevant'
          ]
        }
      };
    }
  }
}
