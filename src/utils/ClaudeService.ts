// src/services/ClaudeService.ts
import axios, { AxiosError } from 'axios';
import { config } from '../core/config';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  content: Array<{ text: string; type: string }>;
  id: string;
  model: string;
  stop_reason: string;
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

export class ClaudeService {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private rateLimiter: RateLimiter;
  private maxRetries: number = 5;
  private baseRetryDelay: number = 2000;

  constructor() {
    this.apiKey = config.ANTHROPIC_API_KEY;
    this.baseUrl = config.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1';
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
        // Get retry-after header or calculate exponential backoff
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
      
      // If we've exhausted retries or it's a different error, throw
      throw error;
    }
  }

  /**
   * Generate response using Claude with rate limiting and retry logic
   */
  async generate(prompt: string, maxTokens: number = 4096): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const response = await axios.post<ClaudeResponse>(
            `${this.baseUrl}/messages`,
            {
              model: 'claude-sonnet-4-20250514',
              max_tokens: maxTokens,
              messages: [
                {
                  role: 'user',
                  content: prompt
                }
              ]
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
              },
              timeout: this.timeout
            }
          );

          if (!response.data.content || response.data.content.length === 0) {
            throw new Error('Empty response from Claude API');
          }

          return response.data.content[0].text;
        } catch (error: any) {
          const axiosError = error as AxiosError;
          
          // Enhanced error logging
          if (axiosError.response) {
            console.error('Claude API error:', {
              status: axiosError.response.status,
              statusText: axiosError.response.statusText,
              data: axiosError.response.data,
              headers: axiosError.response.headers
            });
            
            throw new Error(
              `Failed to generate response from Claude: ${axiosError.response.status} - ${
                (axiosError.response.data as any)?.error?.message || axiosError.response.statusText
              }`
            );
          } else if (axiosError.request) {
            console.error('Claude API network error:', axiosError.message);
            throw new Error(`Network error when calling Claude API: ${axiosError.message}`);
          } else {
            console.error('Claude API unknown error:', axiosError.message);
            throw new Error(`Failed to generate response from Claude: ${axiosError.message}`);
          }
        }
      });
    });
  }

  /**
   * Generate with conversation history
   */
  async generateWithHistory(
    messages: ClaudeMessage[],
    maxTokens: number = 4096
  ): Promise<string> {
    return await this.rateLimiter.execute(async () => {
      return await this.retryWithBackoff(async () => {
        try {
          const response = await axios.post<ClaudeResponse>(
            `${this.baseUrl}/messages`,
            {
              model: 'claude-sonnet-4-20250514',
              max_tokens: maxTokens,
              messages: messages
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
              },
              timeout: this.timeout
            }
          );

          return response.data.content[0].text;
        } catch (error: any) {
          console.error('Claude API error:', error);
          throw new Error(`Failed to generate response from Claude: ${error.message}`);
        }
      });
    });
  }

  /**
   * Generate and parse JSON response
   */
  async generateJSON<T>(prompt: string, maxTokens: number = 4096): Promise<T> {
    try {
      const response = await this.generate(prompt, maxTokens);
      
      // Try to extract JSON from markdown code blocks if present
      let jsonText = response.trim();
      const jsonMatch = jsonText.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      
      return JSON.parse(jsonText);
    } catch (error: any) {
      console.error('Failed to parse Claude JSON response:', error);
      console.error('Raw response:', error.response);
      throw new Error(`Invalid JSON response from Claude: ${error.message}`);
    }
  }

  /**
   * Stream response (for future implementation)
   */
  async *generateStream(prompt: string, maxTokens: number = 4096): AsyncGenerator<string> {
    // Implement streaming if needed
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
}

export const claudeService = new ClaudeService();