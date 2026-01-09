// src/services/ExploriumService.ts
import { config } from '../core/config.js';
import { Firmographic, ICPModel } from '../core/types.js';

export interface ExploriumEvent {
  event_id: string;
  event_name: string;
  event_time: string;
  data: any;
  business_id: string;
}

export interface ExploriumProspect {
  prospect_id: string;
  professional_email_hashed: string;
  first_name: string;
  last_name: string;
  full_name: string;
  company_name: string;
  job_title: string;
  job_seniority_level: string;
  linkedin: string;
  business_id: string;
}

export class ExploriumService {
  private apiKey: string;
  private baseUrl: string = 'https://api.explorium.ai/v1';

  constructor() {
    this.apiKey = config.EXPLORIUM_API_KEY;
  }

  async matchBusiness(companyName: string, companyUrl: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/businesses/match`, {
        method: 'POST',
        headers: {
          'api_key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "request_context": {},
          businesses_to_match: [{
            name: companyName,
            url: companyUrl
          }]
        })
      });

      if (!response.ok) {
        console.warn(`Explorium match API returned ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      return data.matched_businesses?.[0]?.business_id || null;
    } catch (error) {
      console.error('Explorium match error:', error);
      return null;
    }
  }

  async getEvents(businessId: string, icpModel: ICPModel): Promise<ExploriumEvent[]> {
    try {
      const now = new Date();

      // Set the date to 90 days ago (approximately 3 months)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(now.getDate() - 240);

      const requestBody: any = {
        business_ids: [businessId],
        timestamp_from: ninetyDaysAgo.toISOString()
      };

      // Only add event_types if buyingTriggers exist and is not empty
      if (icpModel.config.buyingTriggers && icpModel.config.buyingTriggers.length > 0) {
        requestBody.event_types = icpModel.config.buyingTriggers;
      }
      console.log(requestBody, "requestBody===========================")

      const response = await fetch(`${this.baseUrl}/businesses/events`, {
        method: 'POST',
        headers: {
          'API_KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log(`📡 Explorium API Response Status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Explorium API Error Response:', errorText);
        
        if (response.status === 422) {
          try {
            const errorDetails = JSON.parse(errorText);
            console.error('Explorium Validation Error:', JSON.stringify(errorDetails, null, 2));
          } catch (e) {
            console.error('Could not parse 422 error body:', errorText);
          }
        }
        return [];
      }

      // Parse the response body
      const data = await response.json();
      console.log('📦 Explorium API Response Data:', JSON.stringify(data, null, 2));
      console.log('📦 Response keys:', Object.keys(data));
      
      // Try multiple possible response structures
      let events: ExploriumEvent[] = [];
      
      if (data.output_events) {
        events = data.output_events;
        console.log(`✅ Found events in 'output_events': ${events.length} events`);
      } else if (data.events) {
        events = data.events;
        console.log(`✅ Found events in 'events': ${events.length} events`);
      } else if (data.data && Array.isArray(data.data)) {
        events = data.data;
        console.log(`✅ Found events in 'data': ${events.length} events`);
      } else if (Array.isArray(data)) {
        events = data;
        console.log(`✅ Found events as direct array: ${events.length} events`);
      } else {
        console.warn('⚠️ Unknown response structure. Full response:', JSON.stringify(data, null, 2));
      }
      
      // Validate and map events to ExploriumEvent format
      const mappedEvents: ExploriumEvent[] = events
        .filter((event: any) => event && (event.event_id || event.id))
        .map((event: any) => ({
          event_id: event.event_id || event.id || '',
          event_name: event.event_name || event.name || event.event_type || '',
          event_time: event.event_time || event.timestamp || event.time || '',
          data: event.data || event || {},
          business_id: event.business_id || businessId
        }));
      
      console.log(`📊 Mapped ${mappedEvents.length} valid events from ${events.length} total events`);
      
      return mappedEvents;
    } catch (error) {
      console.error('Explorium events error:', error);
      return [];
    }
  }

  async getProspects(businessId: string, icpModel: ICPModel): Promise<ExploriumProspect[]> {
    try {
      const filters: any = {
        business_id: { values: [businessId] },
        has_email: { value: true }
      };

      // Only add job_title filter if targetPersonas exist and is not empty
      if (icpModel.config.targetPersonas && icpModel.config.targetPersonas.length > 0) {
        filters.job_title = { values: icpModel.config.targetPersonas };
      }

      const requestBody = {
        mode: "full",
        size: 5,
        page_size: 5,
        page: 1,
        filters: filters
      };

      const response = await fetch(`${this.baseUrl}/prospects`, {
        method: 'POST',
        headers: {
          'API_KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        if (response.status === 422) {
          console.warn(`Explorium prospects: Unprocessable Entity for business ${businessId} - likely no prospects available`);
          return [];
        }
        console.warn(`Explorium prospects API returned ${response.status}: ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Explorium prospects error:', error);
      return [];
    }
  }

  async getWebsiteTraffic(businessId: string): Promise<any> {
    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month_period = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

      const response = await fetch(`${this.baseUrl}/businesses/website_traffic/enrich`, {
        method: 'POST',
        headers: {
          'api_key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_context: {},
          parameters: {
            month_period: month_period,
          },
          business_id: businessId,
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`Explorium website traffic: Not Found for business ${businessId} - traffic data not available`);
          return null;
        }
        console.warn(`Explorium website traffic API returned ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Explorium website traffic error:', error);
      return null;
    }
  }

  async getFirmographic(businessId: string): Promise<Firmographic | null> {
    try {
      const response = await fetch(`${this.baseUrl}/businesses/firmographics/enrich`, {
        method: 'POST',
        headers: {
          'API_KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_context: {},
          "business_id": businessId,
        })
      });

      if (!response.ok) {
        console.warn(`Explorium firmographics API returned ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      return data.data || null;
    } catch (error) {
      console.error('Explorium firmographics error:', error);
      return null;
    }
  }
}

export const exploriumService = new ExploriumService();