// src/services/GeminiService.ts
import axios, { AxiosError } from 'axios';
import { config } from '../core/config';

interface GeminiMessage {
  role: 'user' | 'model'; // Gemini uses 'model' instead of 'assistant'
  parts: Array<{ text: string }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    safetyRatings: any[];
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiGenerationConfig {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
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
 * GEMINI SERVICE - Google AI
 * 
 * Features:
 * - Compatible with Claude service interface
 * - Support for Gemini 2.0 Flash and Pro models
 * - Automatic JSON extraction and validation
 * - Rate limiting and retry logic
 * - Token usage tracking
 * 
 * Models:
 * - gemini-2.0-flash-exp: Fast, efficient (like Claude Haiku)
 * - gemini-1.5-pro: Most capable (like Claude Sonnet)
 * - gemini-1.5-flash: Balanced speed/quality
 */
export class GeminiService {
  isUsingFreeModels() {
      throw new Error('Method not implemented.');
  }
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private rateLimiter: RateLimiter;
  private maxRetries: number = 5;
  private baseRetryDelay: number = 2000;
  private useFreeModel: boolean;
  constructor(useFreeModel: boolean = true) {
    this.apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
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
        
        console.log(`Gemini rate limit hit. Retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
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
        console.log(`Gemini network error. Retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryWithBackoff(fn, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Map model aliases to actual Gemini model names
   */
  private getModelName(model: string): string {
    const modelMap: Record<string, string> = {
      'flash': 'gemini-2.0-flash-exp',
      'pro': 'gemini-1.5-pro',
      'flash-1.5': 'gemini-1.5-flash',
      'gemini-flash': 'gemini-2.0-flash-exp',
      'gemini-pro': 'gemini-1.5-pro',
    };
    
    return modelMap[model] || model || 'gemini-2.0-flash-exp';
  }
  

  /**
   * Generate response using Gemini (Claude-compatible interface)
   */
  async generate(
    prompt: string, 
    systemPrompt?: string, 
    model: string = 'gemini-2.0-flash-exp',
    maxTokens: number = 4096
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const modelName = this.getModelName(model);
          
          // Build the request body
          const contents: GeminiMessage[] = [];
          
          // Add user message
          contents.push({
            role: 'user',
            parts: [{ text: prompt }]
          });

          const requestBody: any = {
            contents,
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.7,
            }
          };

          // Add system instruction if provided (Gemini 1.5+ feature)
          if (systemPrompt) {
            requestBody.systemInstruction = {
              parts: [{ text: systemPrompt }]
            };
          }

          const url = `${this.baseUrl}/models/${modelName}:generateContent?key=${this.apiKey}`;

          const response = await axios.post<GeminiResponse>(
            url,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: this.timeout
            }
          );

          if (!response.data.candidates || response.data.candidates.length === 0) {
            throw new Error('Empty response from Gemini API');
          }

          const candidate = response.data.candidates[0];
          
          // Check for safety blocks
          if (candidate.finishReason === 'SAFETY') {
            throw new Error('Response blocked by Gemini safety filters');
          }

          const text = candidate.content.parts
            .map(part => part.text)
            .join('');

          return text;
        } catch (error: any) {
          const axiosError = error as AxiosError;
          
          if (axiosError.response) {
            console.error('Gemini API error:', {
              status: axiosError.response.status,
              statusText: axiosError.response.statusText,
              data: axiosError.response.data,
            });
            
            throw new Error(
              `Failed to generate response from Gemini: ${axiosError.response.status} - ${
                (axiosError.response.data as any)?.error?.message || axiosError.response.statusText
              }`
            );
          } else if (axiosError.request) {
            console.error('Gemini API network error:', axiosError.message);
            throw new Error(`Network error when calling Gemini API: ${axiosError.message}`);
          } else {
            console.error('Gemini API unknown error:', axiosError.message);
            throw new Error(`Failed to generate response from Gemini: ${axiosError.message}`);
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
          // Convert messages to Gemini format
          const contents: GeminiMessage[] = messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }));

          const requestBody: any = {
            contents,
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.7,
            }
          };

          if (systemPrompt) {
            requestBody.systemInstruction = {
              parts: [{ text: systemPrompt }]
            };
          }

          const url = `${this.baseUrl}/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`;

          const response = await axios.post<GeminiResponse>(
            url,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: this.timeout
            }
          );

          const candidate = response.data.candidates[0];
          return candidate.content.parts.map(p => p.text).join('');
          
        } catch (error: any) {
          console.error('Gemini API error:', error);
          throw new Error(`Failed to generate response from Gemini: ${error.message}`);
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
      // Use Flash model for faster JSON responses
      const response = await this.generate(
        prompt, 
        systemPrompt, 
        'gemini-2.0-flash-exp', 
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
      console.error('Failed to parse Gemini JSON response:', error);
      throw new Error(`Invalid JSON response from Gemini: ${error.message}`);
    }
  }

  /**
   * Generate with custom generation config
   */
  async generateWithConfig(
    prompt: string,
    systemPrompt: string | undefined,
    config: GeminiGenerationConfig,
    model: string = 'gemini-2.0-flash-exp'
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const modelName = this.getModelName(model);
          
          const requestBody: any = {
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: config
          };

          if (systemPrompt) {
            requestBody.systemInstruction = {
              parts: [{ text: systemPrompt }]
            };
          }

          const url = `${this.baseUrl}/models/${modelName}:generateContent?key=${this.apiKey}`;

          const response = await axios.post<GeminiResponse>(
            url,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: this.timeout
            }
          );

          const candidate = response.data.candidates[0];
          return candidate.content.parts.map(p => p.text).join('');
          
        } catch (error: any) {
          throw new Error(`Gemini generation failed: ${error.message}`);
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
      processing: (this.rateLimiter as any).processing
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
    console.log(`🔧 Gemini now using ${useFree ? 'Gemini Flash' : 'Flash 2.5 pro'}`);
  }
  
  /**
   * Get current model preference
   */
  isUsingFreeModel(): boolean {
    return this.useFreeModel;
  }
}

export const geminiService = new GeminiService();