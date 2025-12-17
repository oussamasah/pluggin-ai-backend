// src/services/ExaService.ts
import { WebSocket } from 'ws';
import { config } from '../core/config.js';
import { ExaWebset, ICPModel } from '../core/types.js';

export interface ExaCompany {
  id: string;
  properties: {
    company: {
      name: string;
      location: string;
      employees: number;
      industry: string;
      about: string;
      logoUrl?: string;
    };
    url: string;
    description: string;
    content: string;
  };
  evaluations: any[];
  enrichments: any[];
}

export interface EnrichmentRequest {
  websetId: string;
  icpModel: ICPModel;
}

export interface EnrichmentResult {
  id: string;
  object: object;
  status: 'pending' | 'canceled' | 'completed';
  websetId: string;
  title: string | null;
  description: string;
  format: 'text' | 'date' | 'number' | 'options' | 'email' | 'phone' | 'url';
  options: Array<{ label: string }> | null;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: any;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export class ExaService {
  private apiKey: string;
  private baseUrl: string = 'https://api.exa.ai';
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 2000,
    maxDelay: 30000,
    backoffMultiplier: 2
  };

  constructor() {
    this.apiKey = config.EXA_API_KEY;
  }

  /**
   * Generic retry wrapper with exponential backoff
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    customRetryConfig?: Partial<RetryConfig>
  ): Promise<T> {
    const config = { ...this.retryConfig, ...customRetryConfig };
    let lastError: Error;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        console.log(`[${operationName}] Attempt ${attempt + 1}/${config.maxRetries + 1}`);
        const result = await operation();
        
        if (attempt > 0) {
          console.log(`[${operationName}] Succeeded on retry attempt ${attempt + 1}`);
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[${operationName}] Attempt ${attempt + 1} failed:`, lastError.message);
        
        if (attempt < config.maxRetries) {
          const delay = Math.min(
            config.initialDelay * Math.pow(config.backoffMultiplier, attempt),
            config.maxDelay
          );
          console.log(`[${operationName}] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`[${operationName}] Failed after ${config.maxRetries + 1} attempts: ${lastError!.message}`);
  }

  async searchCompanies(
    query: any, 
    count: string, 
    excludeDomains: any,
    minCompanies: number = 1
  ): Promise<{
    map(arg0: any): unknown;
    exaCompanies: ExaCompany[];
    websetId: any;
  }> {
    return this.withRetry(
      async () => {
        try {
          const searchBody: any = {
            search: {
              query: query,
              count: Number(count),
              entity: { type: 'company' }
            }
          };
      console.log(excludeDomains)
          if (excludeDomains && excludeDomains.length > 0 && excludeDomains[0]!= undefined) {
            searchBody.search.exclude = excludeDomains.map((id: string) => ({
              "source": "webset",
              "id": id
            }));
          }
          console.log("Exa search body ",searchBody)
          
          const response = await fetch(`${this.baseUrl}/websets/v0/websets`, {
            method: 'POST',
            headers: {
              'x-api-key': this.apiKey,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify(searchBody)
          });
      
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Exa API error: ${response.statusText} - ${errorText}`);
          }
      
          const data = await response.json();
          const websetId = data.id;
      
          // Poll for completion
          const companies = await this.waitForWebsetCompletion(websetId);
          
          // Check if we got enough companies
          if (companies.length === 0) {
            throw new Error(`Search returned 0 companies for query: "${query}"`);
          }
          
          if (companies.length < minCompanies) {
            console.warn(`Warning: Only found ${companies.length} companies, expected at least ${minCompanies}`);
          }
          
          console.log(`Successfully found ${companies.length} companies`);
          return { exaCompanies: companies, websetId: websetId };
        } catch (error) {
          console.error('Exa search error:', error);
          return { exaCompanies: [], websetId: null };

        }
      },
      'searchCompanies',
      { maxRetries: 3 }
    );
  }

  /**
   * Create enrichment for a specific item in a webset
   */
  async createEnrichment(enrichmentRequest: EnrichmentRequest): Promise<EnrichmentResult> {
    return this.withRetry(
      async () => {
        const response = await fetch(`${this.baseUrl}/websets/v0/websets/${enrichmentRequest.websetId}/enrichments`, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: 'Find target persona ' + enrichmentRequest.icpModel.config.targetPersonas.join(','),
            format: 'email',
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Exa enrichment creation error: ${response.status} - ${errorText}`);
        }

        const enrichmentResult: EnrichmentResult = await response.json();
        return enrichmentResult;
      },
      'createEnrichment',
      { maxRetries: 2 }
    );
  }

  /**
   * Get enrichment by ID
   */
  async getEnrichment(websetId: string, enrichmentId: string): Promise<EnrichmentResult> {
    return this.withRetry(
      async () => {
        const response = await fetch(`${this.baseUrl}/websets/v0/websets/${websetId}/enrichments/${enrichmentId}`, {
          method: 'GET',
          headers: {
            'x-api-key': this.apiKey,
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Exa enrichment retrieval error: ${response.status} - ${errorText}`);
        }

        const enrichment: EnrichmentResult = await response.json();
        return enrichment;
      },
      `getEnrichment-${enrichmentId}`,
      { maxRetries: 2 }
    );
  }

  /**
   * Wait for enrichment completion with polling (every 5 seconds)
   */
  private async waitForEnrichmentCompletion(websetId: string, enrichmentId: string): Promise<EnrichmentResult> {
    const pollInterval = 5000;
    const maxPollAttempts = 120; // 10 minutes max
    let pollAttempt = 0;
    
    while (pollAttempt < maxPollAttempts) {
      try {
        pollAttempt++;
        
        const enrichment = await this.getEnrichment(websetId, enrichmentId);

        if (enrichment.status === 'completed') {
          console.log(`Enrichment ${enrichmentId} completed successfully`);
          return enrichment;
        } else if (enrichment.status === 'canceled') {
          throw new Error(`Enrichment was canceled: ${enrichmentId}`);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error('Error during enrichment polling:', error);
        
        if (error instanceof Error && (
          error.message.includes('canceled') || 
          error.message.includes('failed')
        )) {
          throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    throw new Error(`Enrichment ${enrichmentId} timed out after ${maxPollAttempts * pollInterval / 1000} seconds`);
  }

  /**
   * Create enrichment and wait for completion
   */
  async createAndWaitForEnrichment(enrichmentRequest: EnrichmentRequest): Promise<EnrichmentResult> {
    const enrichment = await this.createEnrichment(enrichmentRequest);
    return await this.waitForEnrichmentCompletion(enrichmentRequest.websetId, enrichment.id);
  }

  /**
   * Get all enrichments for a specific item in a webset
   */
  async getEnrichmentsByItem(websetId: string, itemId: string): Promise<EnrichmentResult[]> {
    return this.withRetry(
      async () => {
        const response = await fetch(`${this.baseUrl}/websets/v0/websets/${websetId}/items/${itemId}/enrichments`, {
          method: 'GET',
          headers: {
            'x-api-key': this.apiKey,
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Exa item enrichments retrieval error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.enrichments || data.data || [];
      },
      `getEnrichmentsByItem-${itemId}`,
      { maxRetries: 2 }
    );
  }

  private async waitForWebsetCompletion(websetId: string): Promise<ExaCompany[]> {
    const pollInterval = 5000;
    const maxPollAttempts = 120; // 10 minutes max
    let pollAttempt = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    
    while (pollAttempt < maxPollAttempts) {
      try {
        pollAttempt++;
        
        const statusResponse = await fetch(`${this.baseUrl}/websets/v0/websets/${websetId}`, {
          headers: {
            'x-api-key': this.apiKey,
            "Accept": "application/json"
          }
        });

        if (!statusResponse.ok) {
          consecutiveErrors++;
          console.error(`Webset status check failed with status: ${statusResponse.status}. Consecutive errors: ${consecutiveErrors}/${maxConsecutiveErrors}`);
          
          if (consecutiveErrors >= maxConsecutiveErrors) {
            throw new Error(`Failed to check webset status after ${maxConsecutiveErrors} consecutive errors`);
          }
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        // Reset consecutive errors on success
        consecutiveErrors = 0;
        
        const websetData: ExaWebset = await statusResponse.json();

        if (websetData.status === 'idle') {
          const itemsResponse = await fetch(`${this.baseUrl}/websets/v0/websets/${websetId}/items`, {
            headers: {
              'x-api-key': this.apiKey,
              "Accept": "application/json"
            }
          });

          if (itemsResponse.ok) {
            const itemsData = await itemsResponse.json();
            const companies = itemsData.data as ExaCompany[];
            
            if (companies.length === 0) {
              throw new Error('Webset completed but returned 0 companies');
            }
            
            return companies;
          } else {
            throw new Error(`Webset completed but failed to retrieve items with status: ${itemsResponse.status}`);
          }
        } else if (websetData.status === 'paused') {
          throw new Error(`Webset workflow terminated with status: ${websetData.status}`);
        }

        console.log(`Webset status is ${websetData.status}. Polling again in ${pollInterval / 1000}s... (${pollAttempt}/${maxPollAttempts})`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error('Error during webset polling:', error);
        
        // If it's a terminal error, throw it to trigger retry
        if (error instanceof Error && (
          error.message.includes('0 companies') ||
          error.message.includes('terminated') ||
          error.message.includes('consecutive errors')
        )) {
          throw error;
        }
        
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Too many consecutive errors during webset polling: ${error}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    throw new Error(`Webset ${websetId} timed out after ${maxPollAttempts * pollInterval / 1000} seconds`);
  }
}

export const exaService = new ExaService();