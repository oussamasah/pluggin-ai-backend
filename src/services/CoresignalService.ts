import axios, { AxiosInstance } from 'axios';

interface CoreSignalFilters {
  industry?: { in_list: string[] };
  country?: { in_list: string[] };
  employees_count_gte?: number;
  employees_count_lte?: number;
  funding_last_round_type?: string[];
  funding_last_round_date_gte?: string;
  funding_last_round_date_lte?: string;
  technologies?: string[];
  has_active_jobs?: boolean;
}

interface SimpleFilters {
  industry?: string[];
  country?: string[];
  size?: string[];
  funding_last_round_type?: string[];
  // Add more as needed
}

interface PaginationOptions {
  after?: string;
  itemsPerPage?: number;
  sort?: string[];
}

interface SearchResponse {
  data: any[];
  headers: {
    xNextPageAfter?: string;
    xTotalPages?: number;
    xTotalResults?: number;
  };
}

export class CoreSignalService {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = "wL6IDueToFJxpKUaNmrPtzCJGtbRR3cr";
    this.apiKey = "SrU9106Rsg1a5pPbfWUQ3NzWuvWcBfFm";
    
    this.client = axios.create({
      baseURL: 'https://api.coresignal.com/cdapi/v2',
      headers: {
        'apikey': this.apiKey,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * Convert employee count range to CoreSignal size format
   */
  private convertEmployeeRangeToSize(min?: number, max?: number): string[] {
    const sizes: string[] = [];
    
    if (!min && !max) return sizes;
    
    const minVal = min || 0;
    const maxVal = max || Infinity;
    
    // Map to CoreSignal size values
    if (minVal <= 1 && maxVal >= 1) sizes.push("1 employee", "Myself Only");
    if (minVal <= 10 && maxVal >= 2) sizes.push("2-10 employees", "1-10 employees", "2-10");
    if (minVal <= 50 && maxVal >= 11) sizes.push("11-50 employees");
    if (minVal <= 200 && maxVal >= 51) sizes.push("51-200 employees");
    if (minVal <= 500 && maxVal >= 201) sizes.push("201-500 employees");
    if (minVal <= 1000 && maxVal >= 501) sizes.push("501-1,000 employees", "501-1000 employees");
    if (minVal <= 5000 && maxVal >= 1001) sizes.push("1,001-5,000 employees", "1001-5000 employees");
    if (minVal <= 10000 && maxVal >= 5001) sizes.push("5,001-10,000 employees", "5001-10,000 employees");
    if (minVal >= 10001 || maxVal >= 10001) sizes.push("10,001+ employees");
    
    return sizes;
  }

  /**
   * Convert CoreSignalFilters to Simple Filter API format
   */
  private convertToSimpleFilters(filters: CoreSignalFilters): SimpleFilters {
    const simple: SimpleFilters = {};

    // Industry - use exact values from documentation
    if (filters.industry?.in_list?.length) {
      simple.industry = filters.industry.in_list.map(ind => {
        // Map common variations to documented values
        const industryMap: { [key: string]: string } = {
          'SaaS': 'Software Development',
          'Software': 'Software Development',
          'Fintech': 'Financial Services',
          'E-commerce': 'Retail',
          'Healthcare': 'Hospitals and Health Care',
          'EdTech': 'E-learning',
          'AI': 'Technology, Information and Internet',
          'Cryptocurrency': 'Financial Services',
          'Logistics': 'Transportation, Logistics, Supply Chain and Storage',
          'B2B': 'Business Consulting and Services',
          'B2C': 'Consumer Services'
        };
        
        return industryMap[ind] || ind;
      });
    }

    // Country - use exact values from documentation
    if (filters.country?.in_list?.length) {
      simple.country = filters.country.in_list.map(c => {
        // Map country codes to full names
        const countryMap: { [key: string]: string } = {
          'SA': 'Saudi Arabia',
          'AE': 'United Arab Emirates',
          'US': 'United States',
          'GB': 'United Kingdom',
          'DE': 'Germany',
          'FR': 'France'
        };
        
        return countryMap[c] || c;
      });
    }

    // Employee count - convert to size strings
    if (filters.employees_count_gte !== undefined || filters.employees_count_lte !== undefined) {
      simple.size = this.convertEmployeeRangeToSize(
        filters.employees_count_gte,
        filters.employees_count_lte
      );
    }

    // Funding type - map to documented values
    if (filters.funding_last_round_type?.length) {
      simple.funding_last_round_type = filters.funding_last_round_type.map(stage => {
        // Map variations to documented values
        const fundingMap: { [key: string]: string } = {
          'SEED': 'Seed',
          'PRE_SEED': 'Pre seed',
          'SERIES_A': 'Series A',
          'SERIES_B': 'Series B',
          'SERIES_C': 'Series C',
          'SERIES_D': 'Series D',
          'SERIES_E': 'Series E'
        };
        
        return fundingMap[stage] || stage;
      });
    }

    return simple;
  }

  /**
   * Search companies using Simple Filter API (Recommended)
   */
  async searchCompaniesSimple(
    filters: CoreSignalFilters,
    pagination: PaginationOptions = {}
  ): Promise<SearchResponse> {
    try {
      const { after, itemsPerPage = 10 } = pagination;
      
      // Convert to simple filters
      const simpleFilters = this.convertToSimpleFilters(filters);
      
      //console.log('🔍 CoreSignal Simple Filter Search');
      //console.log('Input Filters:', JSON.stringify(filters, null, 2));
      //console.log('Converted Filters:', JSON.stringify(simpleFilters, null, 2));

      // Build URL with pagination params only
      let url = '/company_base/search/filter';
      const params = new URLSearchParams();
      
      if (after) params.append('after', after);
      if (itemsPerPage) params.append('items_per_page', itemsPerPage.toString());
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      // Build request body with filters
      const requestBody: any = {};
      
      if (simpleFilters.industry?.length) {
        requestBody.industry = simpleFilters.industry[0]; // Single value
      }
      if (simpleFilters.country?.length) {
        requestBody.country = simpleFilters.country[0]; // Single value
      }
      if (simpleFilters.size?.length) {
        requestBody.size = simpleFilters.size[0]; // Single value
      }
      if (simpleFilters.funding_last_round_type?.length) {
        requestBody.funding_last_round_type = simpleFilters.funding_last_round_type[0];
      }

      //console.log('📡 API Request URL:', url);
      //console.log('📡 Request Body:', JSON.stringify(requestBody, null, 2));

      const response = await this.client.post(url, requestBody);
      
      // Extract pagination headers
      const headers = {
        xNextPageAfter: response.headers['x-next-page-after'],
        xTotalPages: parseInt(response.headers['x-total-pages'] || '0'),
        xTotalResults: parseInt(response.headers['x-total-results'] || '0')
      };

      //console.log('✅ Success! Found:', response.data?.length || 0, 'companies');
      //console.log('Total Results:', headers.xTotalResults);
      
      return {
        data: response.data || [],
        headers
      };
    } catch (error: any) {
      console.error('❌ CoreSignal API Error:');
      console.error('Status:', error.response?.status);
      console.error('Response:', JSON.stringify(error.response?.data, null, 2));
      
      throw new Error(
        `CoreSignal API failed: ${error.response?.data?.Error || error.message}`
      );
    }
  }

  /**
   * Search companies using Elasticsearch DSL (Advanced)
   */
  async searchCompaniesESL(
    filters: CoreSignalFilters,
    pagination: PaginationOptions = {}
  ): Promise<SearchResponse> {
    try {
      const { after, itemsPerPage = 10, sort = ['_score'] } = pagination;
      
      // Build Elasticsearch query
      const query = this.buildElasticsearchQuery(filters);
      
      //console.log('🔍 CoreSignal ES DSL Search');
      //console.log('ES Query:', JSON.stringify(query, null, 2));

      const requestBody = {
        query: query,
        sort: sort
      };

      let url = '/company_base/search/es_dsl';
      const params = new URLSearchParams();
      
      if (after) params.append('after', after);
      if (itemsPerPage) params.append('items_per_page', itemsPerPage.toString());
      
      if (params.toString()) url += `?${params.toString()}`;

      const response = await this.client.post(url, requestBody);
      
      const headers = {
        xNextPageAfter: response.headers['x-next-page-after'],
        xTotalPages: parseInt(response.headers['x-total-pages'] || '0'),
        xTotalResults: parseInt(response.headers['x-total-results'] || '0')
      };

      //console.log('✅ Success! Found:', response.data?.length || 0, 'companies');
      
      return {
        data: response.data || [],
        headers
      };
    } catch (error: any) {
      console.error('❌ CoreSignal API Error:', error.response?.data);
      throw new Error(
        `CoreSignal API failed: ${error.response?.data?.Error || error.message}`
      );
    }
  }
/**
   * Collect full company data by IDs (enrichment)
   */
  /**
   * Collect full company data by IDs (enrichment)
   * Note: CoreSignal requires individual GET requests per ID
   */
  async collectCompanies(companyIds: number[]): Promise<any[]> {
    try {
      //console.log(`📥 Collecting full data for ${companyIds.length} companies...`);

      const companies: any[] = [];
      const batchSize = 5; // Process in batches to avoid rate limits
      
      for (let i = 0; i < companyIds.length; i += batchSize) {
        const batch = companyIds.slice(i, i + batchSize);
        
        // Collect each company in parallel (within batch)
        const batchPromises = batch.map(async (id) => {
          try {
            const url = `/company_multi_source/collect/${id}`;
            const response = await this.client.get(url);
            return response.data;
          } catch (error: any) {
            console.warn(`⚠️ Failed to collect company ${id}:`, error.response?.status);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        companies.push(...batchResults.filter(c => c !== null));

        // Small delay between batches to respect rate limits
        if (i + batchSize < companyIds.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      //console.log(`✅ Collected ${companies.length}/${companyIds.length} full company records`);

      return companies;
    } catch (error: any) {
      console.error('❌ Collect API Error:', error.response?.data);
      throw new Error(
        `Failed to collect company data: ${error.response?.data?.Error || error.message}`
      );
    }
  }
  /**
   * Build Elasticsearch DSL query
   */
  private buildElasticsearchQuery(filters: CoreSignalFilters): any {
    const filterConditions: any[] = [];

    if (filters.industry?.in_list?.length) {
      filterConditions.push({
        "terms": { "industry": filters.industry.in_list }
      });
    }

    if (filters.country?.in_list?.length) {
      filterConditions.push({
        "terms": { "country": filters.country.in_list }
      });
    }

    if (filters.employees_count_gte !== undefined || filters.employees_count_lte !== undefined) {
      const range: any = {};
      if (filters.employees_count_gte !== undefined) range.gte = filters.employees_count_gte;
      if (filters.employees_count_lte !== undefined) range.lte = filters.employees_count_lte;
      
      filterConditions.push({
        "range": { "employee_count": range }
      });
    }

    if (filterConditions.length === 0) {
      return { "match_all": {} };
    }

    return {
      "bool": {
        "filter": filterConditions
      }
    };
  }

  /**
   * Main search method - uses Simple Filter API by default
   */
  async searchCompanies(
    filters: CoreSignalFilters,
    pagination: PaginationOptions = {}
  ): Promise<SearchResponse> {
    // Use Simple Filter API - it's easier and more reliable
    return this.searchCompaniesSimple(filters, pagination);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.searchCompanies({}, { itemsPerPage: 1 });
      return result.data.length >= 0;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
}

export const createCoreSignalService = () => {
  return new CoreSignalService();
};  