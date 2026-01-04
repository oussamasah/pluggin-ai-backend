// src/services/OpenRouterService.ts
import axios, { AxiosError } from 'axios';
import { config } from '../core/config';

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
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

  constructor(requestsPerMinute: number = 50) {
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

export class OpenRouterService {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private rateLimiter: RateLimiter;
  private maxRetries: number = 5;
  private baseRetryDelay: number = 2000;
  private siteName?: string;
  private siteUrl?: string;

  constructor() {
    this.apiKey = config.OPENROUTER_API_KEY;
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.timeout = 600000; // 10 minutes
    this.rateLimiter = new RateLimiter(50); // 50 requests per minute
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
        
        console.log(`Rate limit hit. Retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
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
        console.log(`Network error. Retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryWithBackoff(fn, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Generate response using OpenRouter with system prompt and user message
   * 
   * Available Claude models on OpenRouter:
   * - anthropic/claude-3.5-sonnet
   * - anthropic/claude-3-opus
   * - anthropic/claude-3-sonnet
   * - anthropic/claude-3-haiku
   */
  async generate(
    prompt: string, 
    systemPrompt?: string, 
    model: string = "anthropic/claude-3-haiku",
    maxTokens: number = 4096
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const messages: OpenRouterMessage[] = [];
          
          // Add system prompt if provided
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

          const requestBody: any = {
            model: model,
            messages: messages,
            max_tokens: maxTokens,
          };

          const headers: any = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          };

          // Add optional site info for OpenRouter ranking
          if (this.siteName) {
            headers['HTTP-Referer'] = this.siteUrl || 'https://localhost';
            headers['X-Title'] = this.siteName;
          }

          const response = await axios.post<OpenRouterResponse>(
            `${this.baseUrl}/chat/completions`,
            requestBody,
            {
              headers,
              timeout: this.timeout
            }
          );

          if (!response.data.choices || response.data.choices.length === 0) {
            throw new Error('Empty response from OpenRouter API');
          }

          return response.data.choices[0].message.content;
        } catch (error: any) {
          const axiosError = error as AxiosError;
          
          if (axiosError.response) {
            console.error('OpenRouter API error:', {
              status: axiosError.response.status,
              statusText: axiosError.response.statusText,
              data: axiosError.response.data,
            });
            
            throw new Error(
              `Failed to generate response from OpenRouter: ${axiosError.response.status} - ${
                (axiosError.response.data as any)?.error?.message || axiosError.response.statusText
              }`
            );
          } else if (axiosError.request) {
            console.error('OpenRouter API network error:', axiosError.message);
            throw new Error(`Network error when calling OpenRouter API: ${axiosError.message}`);
          } else {
            console.error('OpenRouter API unknown error:', axiosError.message);
            throw new Error(`Failed to generate response from OpenRouter: ${axiosError.message}`);
          }
        }
      });
    });
  }

  /**
   * Generate with conversation history
   */
  async generateWithHistory(
    messages: OpenRouterMessage[],
    model: string = "anthropic/claude-3.5-sonnet",
    maxTokens: number = 4096
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const requestBody: any = {
            model: model,
            messages: messages,
            max_tokens: maxTokens,
          };

          const headers: any = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          };

          if (this.siteName) {
            headers['HTTP-Referer'] = this.siteUrl || 'https://localhost';
            headers['X-Title'] = this.siteName;
          }

          const response = await axios.post<OpenRouterResponse>(
            `${this.baseUrl}/chat/completions`,
            requestBody,
            {
              headers,
              timeout: this.timeout
            }
          );

          return response.data.choices[0].message.content;
        } catch (error: any) {
          console.error('OpenRouter API error:', error);
          throw new Error(`Failed to generate response from OpenRouter: ${error.message}`);
        }
      });
    });
  }

  /**
   * Generate with conversation history and system prompt
   */
  async generateWithContext(
    systemPrompt: string,
    messages: OpenRouterMessage[],
    model: string = "anthropic/claude-3.5-sonnet",
    maxTokens: number = 4096
  ): Promise<string> {
    const allMessages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.filter(m => m.role !== 'system')
    ];
    
    return this.generateWithHistory(allMessages, model, maxTokens);
  }

  /**
   * Generate and parse JSON response
   */
  async generateJSON<T>(
    prompt: string, 
    systemPrompt?: string,
    model: string = "anthropic/claude-3-haiku",
    maxTokens: number = 4096
  ): Promise<T> {
    let rawResponse = "";
    try {
      // 1. Forceful Prompting
      const enhancedPrompt = `${prompt}\n\nCRITICAL: Return ONLY valid JSON. No preamble, no conversational filler, no markdown formatting. Starting with '{' and ending with '}'.`;
      
      rawResponse = await this.generate(enhancedPrompt, systemPrompt, model, maxTokens);
      
      let jsonText = rawResponse.trim();

      // 2. Try Standard Markdown Block Extraction
      const jsonMatch = jsonText.match(/```json\n?([\s\S]*?)\n?```/);
      const genericMatch = jsonText.match(/```\n?([\s\S]*?)\n?```/);
      
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      } else if (genericMatch) {
        jsonText = genericMatch[1];
      } else {
        // 3. BRUTE FORCE EXTRACTION (The "Golden" Fix)
        // This finds the first { and the last } and takes everything in between.
        const firstBracket = jsonText.indexOf('{');
        const lastBracket = jsonText.lastIndexOf('}');
        
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          jsonText = jsonText.substring(firstBracket, lastBracket + 1);
        }
      }

      // 4. Final cleaning: remove any trailing commas or control characters
      jsonText = jsonText.trim();

      return JSON.parse(jsonText) as T;
    } catch (error: any) {
      console.error('--- OPENROUTER PARSE ERROR ---');
      console.error('Error Message:', error.message);
      console.error('Raw Content Received:', rawResponse);
      console.error('-------------------------------');
      
      throw new Error(`Failed to parse OpenRouter JSON: ${error.message}`);
    }
  }

  /**
   * Stream response (for future implementation)
   */
  async *generateStream(
    prompt: string, 
    systemPrompt?: string,
    model: string = "anthropic/claude-3.5-sonnet",
    maxTokens: number = 4096
  ): AsyncGenerator<string> {
    // OpenRouter supports streaming via the 'stream: true' parameter
    throw new Error('Streaming not yet implemented');
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus() {
    return {
      queueLength: (this.rateLimiter as any).queue.length,
      processing: (this.rateLimiter as any).processing
    };
  }

  /**
   * Get available models from OpenRouter
   */
  async getAvailableModels(): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        }
      });
      return response.data;
    } catch (error: any) {
      console.error('Failed to fetch models:', error);
      throw new Error(`Failed to fetch available models: ${error.message}`);
    }
  }
}

export const openRouterService = new responseOpenRouterService();