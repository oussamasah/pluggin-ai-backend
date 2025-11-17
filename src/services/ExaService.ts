// src/services/ExaService.ts
import { WebSocket } from 'ws';
import { config } from '../core/config.js';
import { ExaWebset, ICPModel } from '../core/types.js';
import { ollamaService } from './OllamaService.js';

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
  // Note: The actual result data might be in a different field or endpoint
}
export class ExaService {
  private apiKey: string;
  private baseUrl: string = 'https://api.exa.ai';

  constructor() {
    this.apiKey = config.EXA_API_KEY;
  }
  async searchCompanies(query: any, count: number, excludeDomains: string[]): Promise<{
    map(arg0: any): unknown;
    exaCompanies: ExaCompany[];
    websetId: any;
  }> {
    try {
      const searchBody: any = {
        search: {
          query: query,
          count: count,
          entity: { type: 'company' }
        }
      };
  
      // Add exclude_domains at the search level if provided
   
      if (excludeDomains && excludeDomains.length > 0) {
        searchBody.search.exclude = excludeDomains.map((id: string) => ({
            "source": "webset",
            "id": id
        }));
    }
    console.log('--- Search Body Contents ---');
    console.log(JSON.stringify(searchBody, null, 2));
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
      return { exaCompanies: companies, websetId: websetId };
    } catch (error) {
      console.error('Exa search error:', error);
      throw error;
    }
  }

  /**
   * Create enrichment for a specific item in a webset
   */
  async createEnrichment(enrichmentRequest: EnrichmentRequest): Promise<EnrichmentResult> {
    try {
      //console.log(`Creating enrichment for webset: ${enrichmentRequest.websetId}`);
      
      const response = await fetch(`${this.baseUrl}/websets/v0/websets/${enrichmentRequest.websetId}/enrichments`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          
        },
        body: JSON.stringify({
          description: 'Find target persona '+enrichmentRequest.icpModel.config.targetPersonas.join(','),
          format: 'email',
        
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exa enrichment creation error: ${response.status} - ${errorText}`);
      }

      const enrichmentResult: EnrichmentResult = await response.json();
      //console.log(`Enrichment created with ID: ${enrichmentResult.id}`);
      
      return enrichmentResult;
    } catch (error) {
      console.error('Exa enrichment creation error:', error);
      throw error;
    }
  }

  /**
   * Get enrichment by ID
   */
  async getEnrichment(websetId: string, enrichmentId: string): Promise<EnrichmentResult> {
    try {
      //console.log(`Getting enrichment: ${enrichmentId} from webset: ${websetId}`);
      
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
    } catch (error) {
      console.error('Exa enrichment retrieval error:', error);
      throw error;
    }
  }

  /**
   * Wait for enrichment completion with polling (every 5 seconds)
   * Similar to waitForWebsetCompletion pattern
   */
  private async waitForEnrichmentCompletion(websetId: string, enrichmentId: string): Promise<EnrichmentResult> {
    const pollInterval = 5000; // 5 seconds
    
    while (true) {
      try {
        //console.log(`Checking enrichment status for: ${enrichmentId}`);
        
        const enrichment = await this.getEnrichment(websetId, enrichmentId);

        // Check the status field
        if (enrichment.status === 'completed') {
          //console.log(`Enrichment ${enrichmentId} completed successfully`);
          return enrichment;
        } else if (enrichment.status === 'canceled') {
          throw new Error(`Enrichment was canceled: ${enrichmentId}`);
        } 

        // If still pending, wait and poll again
        //console.log(`Enrichment status is ${enrichment.status}. Polling again in ${pollInterval / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        // Log and continue polling in case of temporary network issues or API errors
        console.error('Error during enrichment polling:', error);
        
        // If it's a terminal error (canceled, failed), re-throw it
        if (error instanceof Error && (
          error.message.includes('canceled') || 
          error.message.includes('failed')
        )) {
          throw error;
        }
        
        // For other errors, continue polling
        //console.log(`Retrying in ${pollInterval / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
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
    try {
      //console.log(`Getting all enrichments for item: ${itemId} in webset: ${websetId}`);
      
      // Note: This endpoint might vary based on Exa API - adjust if needed
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
    } catch (error) {
      console.error('Exa item enrichments retrieval error:', error);
      throw error;
    }
  }

  private async waitForWebsetCompletion(websetId: string): Promise<ExaCompany[]> {
    const pollInterval = 5000;
    while (true) {
      try {
        const statusResponse = await fetch(`${this.baseUrl}/websets/v0/websets/${websetId}`, {
          headers: {
            'x-api-key': this.apiKey,
            "Accept": "application/json"
          }
        });

        if (!statusResponse.ok) {
          console.error(`Webset status check failed with status: ${statusResponse.status}. Retrying in ${pollInterval / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        const websetData: ExaWebset = await statusResponse.json();

        if (websetData.status == 'idle') {
          const itemsResponse = await fetch(`${this.baseUrl}/websets/v0/websets/${websetId}/items`, {
            headers: {
              'x-api-key': this.apiKey,
              "Accept": "application/json"
            }
          });

          if (itemsResponse.ok) {
            const itemsData = await itemsResponse.json();
            return itemsData.data as ExaCompany[];
          } else {
            throw new Error(`Webset FINISHED but failed to retrieve items with status: ${itemsResponse.status}`);
          }
        } else if (websetData.status === 'paused') {
          throw new Error(`Webset workflow terminated with status: ${websetData.status}`);
        }

        //console.log(`Webset status is ${websetData.status}. Polling again in ${pollInterval / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error('Error during webset polling:', error);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  }
}

export const exaService = new ExaService();