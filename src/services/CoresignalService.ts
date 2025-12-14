import axios, { AxiosInstance } from 'axios';
import { EmployeeSearchResponse } from '../core/types';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../core/config.js';
import { ollamaService } from './OllamaService';


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
    this.apiKey = config.CORESIGNAL_API;
    
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
  async searchCompanies(
    searchText: string,
    after?: string | number,
    itemsPerPage: number = 1,
    excludeUrls?: string[],
    excludeDomains?: string[]
  ): Promise<any> {
    try {
      console.log("searchText=================", searchText);
      console.log("Excluding URLs:", excludeUrls);
      console.log("Excluding domains:", excludeDomains);
  
      const requestBody: any = {
        query: {
          bool: {
            must: [
              {
                query_string: {
                  query: searchText,
                  default_field: "description",
                  default_operator: "and"
                }
              }
            ]
          }
        }
      };
  
      // Add exclusions if provided
      const mustNotClauses: any[] = [];
  
      if (excludeUrls && excludeUrls.length > 0) {
        mustNotClauses.push({
          terms: {
            "website.keyword": excludeUrls
          }
        });
      }
  
      if (excludeDomains && excludeDomains.length > 0) {
        excludeDomains.forEach(domain => {
          mustNotClauses.push({
            wildcard: {
              "website": {
                "value": `*${domain}*`
              }
            }
          });
        });
      }
  
      if (mustNotClauses.length > 0) {
        requestBody.query.bool.must_not = mustNotClauses;
      }
  
      console.log("requestBody=================", JSON.stringify(requestBody, null, 2));
  
      let url = '/company_multi_source/search/es_dsl';
      const params = new URLSearchParams();
      
      if (after) params.append('after', after.toString());
      params.append('items_per_page', itemsPerPage.toString());
      
      if (params.toString()) url += `?${params.toString()}`;
  
      const response = await this.client.post(url, requestBody, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      const headers = {
        xNextPageAfter: response.headers['x-next-page-after'],
        xTotalPages: parseInt(response.headers['x-total-pages'] || '0'),
        xTotalResults: parseInt(response.headers['x-total-results'] || '0')
      };
  
      return {
        data: response.data || [],
        headers
      };
      
    } catch (error: any) {
      console.error('❌ CoreSignal search error:', error);
      return {
        data: [],
        headers: {
          xNextPageAfter: 'None',
          xTotalPages: 0,
          xTotalResults: 0
        }
      };
    }
  }
/**
 * Collect company data by CoreSignal IDs
 */
async collectCompaniesByIds(ids: string[]): Promise<any[]> {
  try {
    console.log(`📥 Collecting data for ${ids.length} companies by IDs...`);

    const collectedCompanies: any[] = [];
    const batchSize = 5; // Process in batches to avoid rate limits
    
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      
      // Collect each company in parallel (within batch)
      const batchPromises = batch.map(async (id) => {
        try {
          // Validate ID
          const cleanId = id;
          if (!cleanId) {
            console.warn(`⚠️ Invalid ID: ${id}`);
            return null;
          }

          const apiUrl = `/company_multi_source/collect/${cleanId}`;
          
          console.log(`🔍 Collecting data for ID: ${cleanId}`);
          const response = await this.client.get(apiUrl);
          
          // Add the original ID to the response for reference
          if (response.data) {
            response.data.requested_id = cleanId;
          }
          
          return response.data;
        } catch (error: any) {
          console.warn(`⚠️ Failed to collect ID ${id}:`, error.response?.status, error.response?.data?.message || error.message);
          
          // Return error information but don't break the entire batch
          return {
            requested_id: id,
            error: true,
            status: error.response?.status,
            message: error.response?.data?.message || error.message
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      collectedCompanies.push(...batchResults.filter(result => result !== null));

      // Small delay between batches to respect rate limits
      if (i + batchSize < ids.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`✅ Successfully collected ${collectedCompanies.filter(c => !c.error).length}/${ids.length} companies`);

    return collectedCompanies;
  } catch (error: any) {
    console.error('❌ Collect API Error:', error.response?.data);
    throw new Error(
      `Failed to collect companies by IDs: ${error.response?.data?.Error || error.message}`
    );
  }
}

  /**
 * Enrich multiple companies by their website URLs
 */
async enrichCompaniesByUrls(urls: string[]): Promise<any[]> {
  try {
    console.log(`📥 Enriching ${urls.length} companies by website URLs...`);

    const enrichedCompanies: any[] = [];
    const batchSize = 5; // Process in batches to avoid rate limits
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      // Enrich each company in parallel (within batch)
      const batchPromises = batch.map(async (url) => {
        try {
          // Clean and validate URL
          const cleanUrl = this.cleanUrl(url);
          if (!cleanUrl) {
            console.warn(`⚠️ Invalid URL: ${url}`);
            return null;
          }

          const encodedUrl = encodeURIComponent(cleanUrl);
          const apiUrl = `/company_multi_source/enrich?website=${encodedUrl}`;
          
          console.log(`🔍 Enriching: ${cleanUrl}`);
          const response = await this.client.get(apiUrl);
          
          // Add the original URL to the response for reference
          if (response.data) {
            response.data.requested_url = cleanUrl;
          }
          
          return response.data;
        } catch (error: any) {
          console.warn(`⚠️ Failed to enrich URL ${url}:`, error.response?.status, error.response?.data?.message || error.message);
          
          // Return error information but don't break the entire batch
          return {
            requested_url: url,
            error: true,
            status: error.response?.status,
            message: error.response?.data?.message || error.message
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      enrichedCompanies.push(...batchResults.filter(result => result !== null));

      // Small delay between batches to respect rate limits
      if (i + batchSize < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`✅ Successfully enriched ${enrichedCompanies.filter(c => !c.error).length}/${urls.length} companies`);

    return enrichedCompanies;
  } catch (error: any) {
    console.error('❌ Enrich API Error:', error.response?.data);
    throw new Error(
      `Failed to enrich companies by URLs: ${error.response?.data?.Error || error.message}`
    );
  }
}

 async saveCompanies( companies: any): Promise<void> {
    try {
      //console.log(`💾 Saving ${companies.length} companies...`);
      
      // Save companies array as JSON file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `emploeyes query -${timestamp}.json`;
      const filePath = path.join(process.cwd(), 'companies-data', filename);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      
      // Simply stringify the entire companies array
      await fs.writeFile(filePath, JSON.stringify(companies, null, 2));
 
      //console.log(`✅ Successfully saved ${companies.length} companies to Supabase`);
      
    } catch (error) {
      console.error('❌ Error saving companies:', error);
      throw error;
    }
  }

/**
 * Executes a search for employees at a company matching job titles.
 * Uses the employee_multi_source endpoint with proper field names.
 * @param companyWebsite Company website (e.g., "aiqintelligence.ai" - without www).
 * @param jobTitles Array of job titles to search for.
 * @param afterId Optional pagination token from previous response.
 * @returns The paginated search response with results and pagination info.
 */
public async searchEmployees(
  companyWebsite: string,
  jobTitles: string[],
  afterId?: string
): Promise<EmployeeSearchResponse> {
  let url = `/employee_multi_source/search/es_dsl`;
  if (afterId && afterId.trim() !== '') {
    url += `?after=${encodeURIComponent(afterId)}`;
  }

  // Validate company website
  if (!companyWebsite || companyWebsite.trim() === '') {
    throw new Error('Company website cannot be empty');
  }

  // Default to CEO if no job titles provided
  const effectiveJobTitles = (jobTitles && jobTitles.length > 0) 
    ? jobTitles 
    : ['CEO'];

  // Build the Elasticsearch DSL Query
  const esQuery = {
    query: {
      bool: {
        must: [
          // Search for active employees (currently working)
          {
            term: {
              is_working: 1
            }
          },
          // Match the company website
          {
            match_phrase: {
              active_experience_company_website: companyWebsite
            }
          },
          // Match any of the job titles using OR logic
          {
            bool: {
              should: effectiveJobTitles.map(title => ({
                match_phrase: {
                  active_experience_title: title
                }
              })),
              minimum_should_match: 1
            }
          }
        ]
      }
    }
  };
  await this.saveCompanies(esQuery);
  
  try {
    console.log(`🔍 Searching employees at: ${companyWebsite}`);
    console.log(`🎯 Job titles: ${effectiveJobTitles.join(', ')}`);
    console.log(`📄 Request URL: ${url}`);
    console.log(`📝 Query: ${JSON.stringify(esQuery, null, 2)}`);

    
    const response = await this.client.post(url, esQuery);
    
    // Extract pagination info from response headers
    const totalResults = parseInt(response.headers['x-total-results'] || '0', 10);
    const totalPages = parseInt(response.headers['x-total-pages'] || '0', 10);
    const nextPageAfter = response.headers['x-next-page-after'];
    
    console.log(`✅ Found ${totalResults} results (${totalPages} pages)`);
    
    return {
      results: response.data || [],
      total_results: totalResults,
      total_pages: totalPages,
      next_page_after: nextPageAfter
    } as EmployeeSearchResponse;
  } catch (error: any) {
    console.error('❌ CoreSignal Employee API Error:');
    console.error('Status:', error.response?.status);
    console.error('Response:', JSON.stringify(error.response?.data, null, 2));
    console.error('Request Query:', JSON.stringify(esQuery, null, 2));
    
    return {
      results:  [],
      total_results: 0,
      total_pages: 0,
      next_page_after: null
    } as EmployeeSearchResponse;
  }
}
/**
 * Alternative method using nested experience query (more complex but more flexible).
 * Use this if you need to search historical positions, not just current ones.
 * @param companyWebsite Company website.
 * @param jobTitles Array of job titles to search for.
 * @param activeOnly If true, only search current positions (default: true).
 * @param afterId Optional pagination token.
 * @returns The search response.
 */
public async searchEmployeesNested(
  companyWebsite: string,
  jobTitles: string[],
  activeOnly: boolean = true,
  afterId?: string
): Promise<EmployeeSearchResponse> {
  let url = `/employee_multi_source/search/es_dsl`;
  if (afterId && afterId.trim() !== '') {
    url += `?after=${encodeURIComponent(afterId)}`;
  }

  // Build must conditions for nested query
  const nestedMust: any[] = [
    {
      match_phrase: {
        "experience.company_website": companyWebsite
      }
    }
  ];

  // Add active experience filter if needed
  if (activeOnly) {
    nestedMust.push({
      term: {
        "experience.active_experience": 1
      }
    });
  }

  // Add job title search with OR logic
  nestedMust.push({
    bool: {
      should: jobTitles.map(title => ({
        match_phrase: {
          "experience.position_title": title
        }
      })),
      minimum_should_match: 1
    }
  });

  const esQuery = {
    query: {
      bool: {
        must: [
          {
            nested: {
              path: "experience",
              query: {
                bool: {
                  must: nestedMust
                }
              }
            }
          }
        ]
      }
    }
  };

  try {
    console.log(`📝 Query: ${JSON.stringify(esQuery, null, 2)}`);

    const response = await this.client.post(url, esQuery);
    
    const totalResults = parseInt(response.headers['x-total-results'] || '0', 10);
    const totalPages = parseInt(response.headers['x-total-pages'] || '0', 10);
    const nextPageAfter = response.headers['x-next-page-after'];
    
    return {
      results: response.data || [],
      total_results: totalResults,
      total_pages: totalPages,
      next_page_after: nextPageAfter
    } as EmployeeSearchResponse;
  } catch (error: any) {
    console.error('❌ CoreSignal Employee API Error:');
    console.error('Status:', error.response?.status);
    console.error('Response:', JSON.stringify(error.response?.data, null, 2));
    return {
      results: [],
      total_results: 0,
      total_pages: 0,
      next_page_after: null
    } as EmployeeSearchResponse;
  
  }
}

/**
 * Search for employees by company ID instead of website.
 * @param companyId The Coresignal company ID.
 * @param jobTitles Array of job titles to search for.
 * @param afterId Optional pagination token.
 * @returns The search response.
 */
public async searchEmployeesByCompanyId(
  companyId: number,
  jobTitles: string[],
  afterId?: string
): Promise<EmployeeSearchResponse> {
  let url = `/employee_multi_source/search/es_dsl`;
  if (afterId && afterId.trim() !== '') {
    url += `?after=${encodeURIComponent(afterId)}`;
  }
if(jobTitles.length==0){
  jobTitles.push("CEO")
}
  const esQuery = {
    query: {
      bool: {
        must: [
          {
            term: {
              is_working: 1
            }
          },
          {
            term: {
              active_experience_company_id: companyId
            }
          },
          {
            bool: {
              should: jobTitles.map(title => ({
                match_phrase: {
                  active_experience_title: title
                }
              })),
              minimum_should_match: 1
            }
          }
        ]
      }
    }
  };
await this.saveCompanies(esQuery)
  try {
    console.log(`📝 Query: ${JSON.stringify(esQuery, null, 2)}`);
    
    const response = await this.client.post(url, esQuery);
    
    const totalResults = parseInt(response.headers['x-total-results'] || '0', 3);
    const totalPages = parseInt(response.headers['x-total-pages'] || '0', 1);
    const nextPageAfter = response.headers['x-next-page-after'];
    
    return {
      results: response.data || [],
      total_results: totalResults,
      total_pages: totalPages,
      next_page_after: nextPageAfter
    } as EmployeeSearchResponse;
  } catch (error: any) {
    console.error('❌ CoreSignal Employee API Error:');
    console.error('Status:', error.response?.status);
    console.error('Response:', JSON.stringify(error.response?.data, null, 2));
    
    return {
      results: [],
      total_results: 0,
      total_pages: 0,
      next_page_after: null
    } as EmployeeSearchResponse;
  }
}

/**
 * Fetches all employees matching the criteria by automatically handling pagination.
 * @param companyWebsite Company website (e.g., "aiqintelligence.ai").
 * @param jobTitles Array of job titles to search for.
 * @param maxPages Optional limit on number of pages to fetch (default: unlimited).
 * @returns Array of all employee results.
 */
public async searchAllEmployees(
  companyWebsite: string,
  jobTitles: string[],
  maxPages?: number
): Promise<any[]> {
  const allResults: any[] = [];
  let afterId: string | undefined = undefined;
  let pageCount = 0;

  do {
    const response = await this.searchEmployees(
      companyWebsite,
      jobTitles,
      afterId
    );
    allResults.push(...response.results);
    
    afterId = response.next_page_after;
    pageCount++;
    
    console.log(`📄 Fetched page ${pageCount}, total results so far: ${allResults.length}`);
    
    // Break if we've reached max pages or no more results
    if (maxPages && pageCount >= maxPages) {
      console.log(`⚠️ Reached maximum page limit: ${maxPages}`);
      break;
    }
    
    // Small delay to avoid rate limiting
    if (afterId) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } while (afterId);

  console.log(`✅ Completed: Fetched ${allResults.length} total employees across ${pageCount} pages`);
  return allResults;
}
/**
 * Collects full details for multiple employees.
 * @param employeeIds Array of employee IDs to collect.
 * @param delayMs Delay between requests in milliseconds (default: 200ms to avoid rate limits).
 * @returns Array of full employee profile data.
 */
public async collectEmployees(
  employeeIds: number[],
  delayMs: number = 200
): Promise<any[]> {
  const employees: any[] = [];
  
  console.log(`📥 Collecting details for ${employeeIds.length} employees...`);
  
  for (let i = 0; i < employeeIds.length; i++) {
    try {
      const employee = await this.collectEmployee(employeeIds[i]);
      employees.push(employee);
      console.log(`✅ Collected ${i + 1}/${employeeIds.length}`);
      
      // Add delay between requests to avoid rate limiting
      if (i < employeeIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      console.error(`⚠️ Skipping employee ${employeeIds[i]} due to error`);
      // Continue with next employee
    }
  }
  
  console.log(`✅ Completed: Collected ${employees.length}/${employeeIds.length} employees`);
  return employees;
}
/**
 * Collects full employee details by ID.
 * @param employeeId The employee ID to collect.
 * @returns Full employee profile data.
 */
public async collectEmployee(employeeId: number): Promise<any> {
  const url = `/employee_multi_source/collect/${employeeId}`;
  
  try {
    console.log(`📥 Collecting employee details for ID: ${employeeId}`);
    const response = await this.client.get(url);
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to collect employee ${employeeId}:`, error.response?.data);
    throw new Error(
      `CoreSignal Collect API failed: ${error.response?.data?.Error || error.message}`
    );
  }
}

/**
 * Clean and normalize URL for API request
 */
private cleanUrl(url: string): string {
  if (!url) return '';
  
  let cleanUrl = url.trim();
  
  // Remove protocol and www for consistency
  cleanUrl = cleanUrl.replace(/^(https?:\/\/)?(www\.)?/, '');
  
  // Remove trailing slashes
  cleanUrl = cleanUrl.replace(/\/+$/, '');
  
  // Basic validation - should contain at least a dot and some characters
  if (!cleanUrl.includes('.') || cleanUrl.length < 3) {
    return '';
  }
  
  return cleanUrl;
}

/**
 * Enrich a single company by website URL (convenience method)
 */
async enrichCompanyByUrl(url: string): Promise<any> {
  const results = await this.enrichCompaniesByUrls([url]);
  return results[0] || null;
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