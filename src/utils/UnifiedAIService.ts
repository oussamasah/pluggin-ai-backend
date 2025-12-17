// src/services/UnifiedAIService.ts
import { claudeService, ClaudeService } from './ClaudeService.js';
import { geminiService, GeminiService } from './GeminiService.js';
import { openaiService, OpenAIService } from './OpenAIService.js';

export type AIProvider = 'claude' | 'gemini' | 'openai';
export type AIModel = 
  // Claude models
  | 'claude-sonnet-4-20250514'
  | 'claude-haiku-4-5-20251001'
  | 'claude-opus-4-20250514'
  | 'claude-3-5-haiku-20241022'
  // Gemini models
  | 'gemini-2.0-flash-lite'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'        // FREE model
  | 'gemini-1.5-flash-8b'      // FREE ultra-fast model
  // OpenAI models
  | 'gpt-3.5-turbo'            // Cheap/Free tier
  | 'gpt-4-turbo'              // Latest GPT-4
  | 'gpt-4o'                   // Optimized GPT-4
  | 'gpt-4'                    // Classic GPT-4
  // Aliases
  | 'free' | 'fast' | 'balanced' | 'smart' | 'ultra-fast';

interface GenerateOptions {
  provider?: AIProvider;
  model?: AIModel;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * UNIFIED AI SERVICE - 3 Providers
 * 
 * Automatically selects the best AI provider and model.
 * 
 * FREE/CHEAP Options:
 * - 'free' → Gemini Flash (1M tokens/day FREE) or GPT-3.5-turbo ($0.50/1M)
 * - 'fast' → Gemini Flash (FREE) or GPT-3.5-turbo (cheap)
 * - 'ultra-fast' → Gemini Flash-8B (4M tokens/day FREE)
 * 
 * PAID Options:
 * - 'balanced' → Claude Haiku or GPT-4-turbo
 * - 'smart' → Claude Sonnet or GPT-4
 * 
 * Provider Priority (for 'free'/'fast'):
 * 1. Gemini (completely FREE)
 * 2. OpenAI GPT-3.5 (cheap: $0.50-$1.50/1M tokens)
 * 3. Claude Haiku (more expensive: $0.25-$1.25/1M tokens)
 */
export class UnifiedAIService {
  private claudeService: ClaudeService;
  private geminiService: GeminiService;
  private openaiService: OpenAIService;
  private defaultProvider: AIProvider;
  private preferFreeModels: boolean;

  constructor(defaultProvider?: AIProvider, preferFreeModels: boolean = true) {
    this.claudeService = claudeService;
    this.geminiService = geminiService;
    this.openaiService = openaiService;
    this.preferFreeModels = preferFreeModels;
    
    // Auto-select best available provider
    this.defaultProvider = defaultProvider || this.selectBestProvider();
    
    console.log(`🚀 AI Service initialized: Provider=${this.defaultProvider}, Free Models=${preferFreeModels}`);
  }

  /**
   * Auto-select best available provider based on what's configured
   */
  private selectBestProvider(): AIProvider {
    // Priority: Gemini (FREE) > OpenAI (cheap) > Claude (expensive)
    if (this.geminiService.isConfigured()) {
      return 'gemini';
    }
    if (this.openaiService.isConfigured()) {
      return 'openai';
    }
    return 'claude';
  }

  /**
   * Select optimal provider and model based on task
   */
  private selectProviderAndModel(options?: GenerateOptions): {
    provider: AIProvider;
    model: string;
  } {
    // If explicitly specified, use that
    if (options?.provider && options?.model) {
      return {
        provider: options.provider,
        model: options.model
      };
    }

    // Smart selection based on model alias
    if (options?.model) {
      switch (options.model) {
        
        case 'fast':
          // Priority: Gemini (FREE) > OpenAI (cheap) > Claude
          if (this.geminiService.isConfigured()) {
            return {
              provider: 'gemini',
              model: 'gemini-1.5-flash'  // 1M tokens/day FREE
            };
          }
          if (this.openaiService.isConfigured()) {
            return {
              provider: 'openai',
              model: 'gpt-3.5-turbo'  // $0.50/$1.50 per 1M tokens
            };
          }
          return {
            provider: 'claude',
            model: 'claude-haiku-4-5-20251001'
          };
          
        case 'ultra-fast':
          // Use Gemini Flash-8B (4M tokens/day FREE)
          if (this.geminiService.isConfigured()) {
            return {
              provider: 'gemini',
              model: 'gemini-1.5-flash-8b'
            };
          }
          // Fallback to GPT-3.5
          return {
            provider: 'openai',
            model: 'gpt-3.5-turbo'
          };
          
        case 'balanced':
          // If preferring free/cheap, use OpenAI 3.5, else Claude Haiku
          if (this.preferFreeModels && this.openaiService.isConfigured()) {
            return {
              provider: 'openai',
              model: 'gpt-3.5-turbo'
            };
          }
          return {
            provider: 'claude',
            model: 'claude-haiku-4-5-20251001'
          };
          
        case 'smart':
          // Best quality: GPT-4 or Claude Sonnet
          if (this.openaiService.isConfigured()) {
            return {
              provider: 'openai',
              model: 'gpt-4-turbo'
            };
          }
          return {
            provider: 'claude',
            model: 'claude-sonnet-4-20250514'
          };
          
        default:
          // If it's a specific model, detect provider
          if (options.model.startsWith('claude')) {
            return { provider: 'claude', model: options.model };
          }
          if (options.model.startsWith('gemini')) {
            return { provider: 'gemini', model: options.model };
          }
          if (options.model.startsWith('gpt')) {
            return { provider: 'openai', model: options.model };
          }
      }
    }

    // Provider specified but no model
    if (options?.provider === 'gemini') {
      return {
        provider: 'gemini',
        model: 'gemini-1.5-flash'  // Default to FREE
      };
    }

    if (options?.provider === 'openai') {
      return {
        provider: 'openai',
        model: 'gpt-3.5-turbo'  // Default to cheap
      };
    }

    if (options?.provider === 'claude') {
      return {
        provider: 'claude',
        model: 'claude-sonnet-4-20250514'
      };
    }

    // Default: Use best available provider
    if (this.preferFreeModels) {
      if (this.geminiService.isConfigured()) {
        return {
          provider: 'gemini',
          model: 'gemini-1.5-flash'  // FREE
        };
      }
      if (this.openaiService.isConfigured()) {
        return {
          provider: 'openai',
          model: 'gpt-3.5-turbo'  // Cheap
        };
      }
    }

    // Fallback to Claude
    return {
      provider: 'claude',
      model: 'claude-sonnet-4-20250514'
    };
  }

  /**
   * Generate response (unified interface)
   */
  async generate(
    prompt: string,
    options?: GenerateOptions
  ): Promise<string> {
    const { provider, model } = this.selectProviderAndModel(options);

    switch (provider) {
      case 'gemini':
        return await this.geminiService.generate(
          prompt,
          options?.systemPrompt,
          model,
          options?.maxTokens
        );
      
      case 'openai':
        return await this.openaiService.generate(
          prompt,
          options?.systemPrompt,
          model,
          options?.maxTokens
        );
      
      case 'claude':
      default:
        return await this.claudeService.generate(
          prompt,
          options?.systemPrompt,
          model,
          options?.maxTokens
        );
    }
  }

  /**
   * Generate with conversation history
   */
  async generateWithHistory(
    messages: Message[],
    options?: GenerateOptions
  ): Promise<string> {
    const { provider, model } = this.selectProviderAndModel(options);

    switch (provider) {
      case 'gemini':
        return await this.geminiService.generateWithHistory(
          messages,
          options?.systemPrompt,
          options?.maxTokens
        );
      
      case 'openai':
        return await this.openaiService.generateWithHistory(
          messages,
          options?.systemPrompt,
          options?.maxTokens
        );
      
      case 'claude':
      default:
        return await this.claudeService.generateWithHistory(
          messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          })),
          options?.maxTokens
        );
    }
  }

  /**
   * Generate and parse JSON response (uses FREE/CHEAP model by default)
   */
  async generateJSON<T>(
    prompt: string,
    options?: GenerateOptions
  ): Promise<T> {
    // Force free/cheap model for JSON if not specified
    if (!options?.model && this.preferFreeModels) {
      options = { ...options, model: 'fast' };
    }

    const { provider, model } = this.selectProviderAndModel(options);

    const isFree = model === 'gemini-1.5-flash' || model === 'gemini-1.5-flash-8b';
    const isCheap = model === 'gpt-3.5-turbo';
    console.log(`${isFree ? '💚 FREE' : isCheap ? '💵 CHEAP' : '💰 PAID'} Using ${provider} (${model}) for JSON`);

    switch (provider) {
      case 'gemini':
        return await this.geminiService.generateJSON<T>(
          prompt,
          options?.systemPrompt,
          options?.maxTokens
        );
      
      case 'openai':
        return await this.openaiService.generateJSON<T>(
          prompt,
          options?.systemPrompt,
          options?.maxTokens
        );
      
      case 'claude':
      default:
        return await this.claudeService.generateJSON<T>(
          prompt,
          options?.systemPrompt,
          options?.maxTokens
        );
    }
  }

  /**
   * Check which providers are available
   */
  getAvailableProviders(): AIProvider[] {
    const providers: AIProvider[] = [];
    
    if (this.claudeService) {
      providers.push('claude');
    }
    
    if (this.geminiService && this.geminiService.isConfigured()) {
      providers.push('gemini');
    }
    
    if (this.openaiService && this.openaiService.isConfigured()) {
      providers.push('openai');
    }
    
    return providers;
  }

  /**
   * Get status of all providers
   */
  getStatus() {
    return {
      defaultProvider: this.defaultProvider,
      preferFreeModels: this.preferFreeModels,
      availableProviders: this.getAvailableProviders(),
      claude: {
        available: !!this.claudeService,
        rateLimit: this.claudeService?.getRateLimitStatus()
      },
      gemini: {
        available: this.geminiService?.isConfigured() || false,
        rateLimit: this.geminiService?.getRateLimitStatus(),
        usingFreeModels: this.geminiService?.isUsingFreeModels()
      },
      openai: {
        available: this.openaiService?.isConfigured() || false,
        rateLimit: this.openaiService?.getRateLimitStatus(),
        usingFreeModel: this.openaiService?.isUsingFreeModel()
      }
    };
  }

  /**
   * Set default provider
   */
  setDefaultProvider(provider: AIProvider) {
    if (!this.getAvailableProviders().includes(provider)) {
      throw new Error(`Provider ${provider} is not available`);
    }
    this.defaultProvider = provider;
    console.log(`🔧 Default provider set to: ${provider}`);
  }

  /**
   * Toggle free models preference
   */
  setPreferFreeModels(prefer: boolean) {
    this.preferFreeModels = prefer;
    this.geminiService.setUseFreeModel(prefer);
    this.openaiService.setUseFreeModel(prefer);
    console.log(`🔧 Prefer free/cheap models: ${prefer ? 'YES (💚 FREE/💵 CHEAP)' : 'NO (💰 PAID)'}`);
  }

  /**
   * Get cost estimate for a prompt
   */
  estimateCost(prompt: string, model?: AIModel): { 
    provider: string; 
    model: string; 
    estimatedCost: string;
    costLevel: 'free' | 'cheap' | 'moderate' | 'expensive';
  } {
    const { provider, model: selectedModel } = this.selectProviderAndModel({ model });
    
    // Rough token estimate (1 token ≈ 4 chars)
    const tokens = Math.ceil(prompt.length / 4);
    
    // Free models
    if (selectedModel === 'gemini-1.5-flash' || selectedModel === 'gemini-1.5-flash-8b') {
      return {
        provider,
        model: selectedModel,
        estimatedCost: '$0.00 (FREE)',
        costLevel: 'free'
      };
    }
    
    // Cost per 1M tokens (input/output)
    const costs: Record<string, { input: number; output: number; level: 'cheap' | 'moderate' | 'expensive' }> = {
      // OpenAI
      'gpt-3.5-turbo': { input: 0.50, output: 1.50, level: 'cheap' },
      'gpt-4-turbo': { input: 10.00, output: 30.00, level: 'moderate' },
      'gpt-4o': { input: 5.00, output: 15.00, level: 'moderate' },
      'gpt-4': { input: 30.00, output: 60.00, level: 'expensive' },
      
      // Claude
      'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25, level: 'cheap' },
      'claude-sonnet-4-20250514': { input: 3, output: 15, level: 'moderate' },
      'claude-opus-4-20250514': { input: 15, output: 75, level: 'expensive' },
      
      // Gemini (paid tier)
      'gemini-2.0-flash-lite': { input: 0.075, output: 0.30, level: 'cheap' },
      'gemini-1.5-pro': { input: 1.25, output: 5.00, level: 'moderate' }
    };
    
    const cost = costs[selectedModel] || { input: 0, output: 0, level: 'moderate' as const };
    const estimatedInputCost = (tokens / 1000000) * cost.input;
    const estimatedOutputCost = (tokens / 1000000) * cost.output * 0.5; // Assume output is 50% of input
    
    return {
      provider,
      model: selectedModel,
      estimatedCost: `$${(estimatedInputCost + estimatedOutputCost).toFixed(6)}`,
      costLevel: cost.level
    };
  }
}

// Export singleton instance - auto-selects best provider, prefers free/cheap models
export const aiService = new UnifiedAIService(undefined, true);

// Export individual services for direct access
export { claudeService, geminiService, openaiService };