// src/services/OpenAIService.ts
import axios, { AxiosError } from 'axios';
import { config } from '../core/config';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private requestsPerMinute: number;
  private minDelay: number;
  private lastRequestTime = 0;

  constructor(requestsPerMinute: number = 60) {
    this.requestsPerMinute = requestsPerMinute;
    this.minDelay = 60000 / requestsPerMinute;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.minDelay) {
        await new Promise(resolve => 
          setTimeout(resolve, this.minDelay - timeSinceLastRequest)
        );
      }

      const task = this.queue.shift();
      if (task) {
        this.lastRequestTime = Date.now();
        await task();
      }
    }

    this.processing = false;
  }
}

/**
 * OPENAI SERVICE
 * 
 * Features:
 * - FREE tier available with GPT-3.5-turbo ($5 free credit for new accounts)
 * - Compatible with Claude/Gemini service interface
 * - Support for GPT-4 and GPT-4-turbo (paid)
 * - Automatic JSON extraction and validation
 * - Rate limiting and retry logic
 * 
 * FREE Models:
 * - gpt-3.5-turbo: $5 free credit (new accounts), then $0.50/$1.50 per 1M tokens
 * 
 * Paid Models:
 * - gpt-4-turbo: Latest GPT-4, faster and cheaper
 * - gpt-4: Most capable, expensive
 * - gpt-4o: Optimized version
 */
export class OpenAIService {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private rateLimiter: RateLimiter;
  private maxRetries: number = 5;
  private baseRetryDelay: number = 2000;
  private useFreeModel: boolean;

  constructor(useFreeModel: boolean = true) {
    this.apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    this.baseUrl = 'https://api.openai.com/v1';
    this.timeout = 600000; // 10 minutes
    this.rateLimiter = new RateLimiter(60); // 60 requests per minute
    this.useFreeModel = useFreeModel;
  }

  /**
   * Retry logic with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retryCount: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const axiosError = error as AxiosError;
      
      // Check if it's a rate limit error (429)
      if (axiosError.response?.status === 429 && retryCount < this.maxRetries) {
        const retryAfter = axiosError.response.headers['retry-after'];
        const delay = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : this.baseRetryDelay * Math.pow(2, retryCount);
        
        console.log(`OpenAI rate limit hit. Retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryWithBackoff(fn, retryCount + 1);
      }
      
      // Check if it's a timeout or network error
      if (
        (axiosError.code === 'ECONNABORTED' || 
         axiosError.code === 'ETIMEDOUT' ||
         axiosError.response?.status === 503 ||
         axiosError.response?.status === 502) &&
        retryCount < this.maxRetries
      ) {
        const delay = this.baseRetryDelay * Math.pow(2, retryCount);
        console.log(`OpenAI network error. Retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryWithBackoff(fn, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Map model aliases to actual OpenAI model names
   */
  private getModelName(model: string): string {
    const freeModelMap: Record<string, string> = {
      'free': 'gpt-3.5-turbo',
      'turbo': 'gpt-3.5-turbo',
      '3.5': 'gpt-3.5-turbo',
      'gpt-3.5': 'gpt-3.5-turbo',
    };

    const paidModelMap: Record<string, string> = {
      'gpt-4': 'gpt-4-turbo',
      'gpt4': 'gpt-4-turbo',
      '4': 'gpt-4-turbo',
      '4-turbo': 'gpt-4-turbo',
      '4o': 'gpt-4o',
      'gpt-4o': 'gpt-4o',
    };
    
    // Use free model if enabled
    if (this.useFreeModel && freeModelMap[model]) {
      console.log(`💚 Using OpenAI free tier: ${freeModelMap[model]}`);
      return freeModelMap[model];
    }
    
    // Otherwise use paid model map
    if (paidModelMap[model]) {
      return paidModelMap[model];
    }
    
    // If it's a direct model name, use it
    if (model.startsWith('gpt-')) {
      return model;
    }
    
    // Default to free 3.5-turbo
    console.log(`💚 Using OpenAI free tier: gpt-3.5-turbo`);
    return 'gpt-3.5-turbo';
  }

  /**
   * Generate response using OpenAI
   */
  async generate(
    prompt: string, 
    systemPrompt?: string, 
    model: string = 'gpt-3.5-turbo',
    maxTokens: number = 4096
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const modelName = this.getModelName(model);
          
          // Build messages array
          const messages: OpenAIMessage[] = [];
          
          // Add system prompt if provided
          if (systemPrompt) {
            messages.push({
              role: 'system',
              content: systemPrompt
            });
          }
          
          // Add user message
          messages.push({
            role: 'user',
            content: prompt
          });

          const requestBody = {
            model: modelName,
            messages,
            max_tokens: maxTokens,
            temperature: 0.7,
          };

          const response = await axios.post<OpenAIResponse>(
            `${this.baseUrl}/chat/completions`,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              timeout: this.timeout
            }
          );

          if (!response.data.choices || response.data.choices.length === 0) {
            throw new Error('Empty response from OpenAI API');
          }

          const content = response.data.choices[0].message.content;

          // Log token usage
          if (response.data.usage) {
            console.log(`📊 OpenAI tokens: ${response.data.usage.total_tokens} (prompt: ${response.data.usage.prompt_tokens}, completion: ${response.data.usage.completion_tokens})`);
          }

          return content;
        } catch (error: any) {
          const axiosError = error as AxiosError;
          
          if (axiosError.response) {
            console.error('OpenAI API error:', {
              status: axiosError.response.status,
              statusText: axiosError.response.statusText,
              data: axiosError.response.data,
            });
            
            throw new Error(
              `Failed to generate response from OpenAI: ${axiosError.response.status} - ${
                (axiosError.response.data as any)?.error?.message || axiosError.response.statusText
              }`
            );
          } else if (axiosError.request) {
            console.error('OpenAI API network error:', axiosError.message);
            throw new Error(`Network error when calling OpenAI API: ${axiosError.message}`);
          } else {
            console.error('OpenAI API unknown error:', axiosError.message);
            throw new Error(`Failed to generate response from OpenAI: ${axiosError.message}`);
          }
        }
      });
    });
  }

  /**
   * Generate with conversation history
   */
  async generateWithHistory(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt?: string,
    maxTokens: number = 4096
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const openAIMessages: OpenAIMessage[] = [];
          
          // Add system prompt first if provided
          if (systemPrompt) {
            openAIMessages.push({
              role: 'system',
              content: systemPrompt
            });
          }
          
          // Add conversation history
          messages.forEach(msg => {
            openAIMessages.push({
              role: msg.role,
              content: msg.content
            });
          });

          const requestBody = {
            model: this.getModelName('gpt-3.5-turbo'),
            messages: openAIMessages,
            max_tokens: maxTokens,
            temperature: 0.7,
          };

          const response = await axios.post<OpenAIResponse>(
            `${this.baseUrl}/chat/completions`,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              timeout: this.timeout
            }
          );

          return response.data.choices[0].message.content;
          
        } catch (error: any) {
          console.error('OpenAI API error:', error);
          throw new Error(`Failed to generate response from OpenAI: ${error.message}`);
        }
      });
    });
  }

  /**
   * Generate and parse JSON response
   */
  async generateJSON<T>(
    prompt: string, 
    systemPrompt?: string, 
    maxTokens: number = 4096
  ): Promise<T> {
    try {
      // Use 3.5-turbo for faster JSON responses
      const response = await this.generate(
        prompt, 
        systemPrompt, 
        'gpt-3.5-turbo', 
        maxTokens
      );
      
      // Extract JSON from markdown code blocks
      let jsonText = response.trim();
      const jsonMatch = jsonText.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      } else {
        const codeMatch = jsonText.match(/```\n?([\s\S]*?)\n?```/);
        if (codeMatch) {
          jsonText = codeMatch[1];
        }
      }
      
      // Try to find JSON object if response has extra text
      const startIdx = jsonText.indexOf('{');
      const endIdx = jsonText.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        jsonText = jsonText.substring(startIdx, endIdx + 1);
      }
      
      return JSON.parse(jsonText);
    } catch (error: any) {
      console.error('Failed to parse OpenAI JSON response:', error);
      throw new Error(`Invalid JSON response from OpenAI: ${error.message}`);
    }
  }

  /**
   * Generate with response format (JSON mode)
   * OpenAI's built-in JSON mode for reliable structured output
   */
  async generateJSONMode<T>(
    prompt: string,
    systemPrompt?: string,
    maxTokens: number = 4096
  ): Promise<T> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const messages: OpenAIMessage[] = [];
          
          if (systemPrompt) {
            messages.push({
              role: 'system',
              content: systemPrompt
            });
          }
          
          messages.push({
            role: 'user',
            content: prompt
          });

          const requestBody = {
            model: this.getModelName('gpt-3.5-turbo'),
            messages,
            max_tokens: maxTokens,
            temperature: 0.7,
            response_format: { type: 'json_object' }  // Force JSON output
          };

          const response = await axios.post<OpenAIResponse>(
            `${this.baseUrl}/chat/completions`,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              timeout: this.timeout
            }
          );

          const content = response.data.choices[0].message.content;
          return JSON.parse(content);
          
        } catch (error: any) {
          throw new Error(`OpenAI JSON mode failed: ${error.message}`);
        }
      });
    });
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus() {
    return {
      queueLength: (this.rateLimiter as any).queue.length,
      processing: (this.rateLimiter as any).processing,
      usingFreeModel: this.useFreeModel
    };
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Toggle between free and paid models
   */
  setUseFreeModel(useFree: boolean): void {
    this.useFreeModel = useFree;
    console.log(`🔧 OpenAI now using ${useFree ? 'GPT-3.5-turbo (cheaper)' : 'GPT-4 (premium)'}`);
  }

  /**
   * Get current model preference
   */
  isUsingFreeModel(): boolean {
    return this.useFreeModel;
  }
}

// Export with free model (3.5-turbo) enabled by default
export const openaiService = new OpenAIService(true);