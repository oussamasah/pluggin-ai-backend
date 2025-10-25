import { CoreSignalService } from "../services/CoresignalService";
import { QueryMergerService } from "../services/QueryMergerService";

interface ProgressCallback {
  (progress: {
    step: number;
    totalSteps: number;
    message: string;
    percent: number;
    data?: any;
  }): void;
}

interface SearchResult {
  companies: any[];
  contacts: any[];
  metadata: {
    totalCompanies: number;
    totalContacts: number;
    filters: any;
    query: string;
    executionTime: number;
  };
}

export class SearchOrchestratorWorkflow {
  private coreSignal: CoreSignalService;
  private queryMerger: QueryMergerService;

  constructor(
    coreSignal: CoreSignalService,
    queryMerger: QueryMergerService
  ) {
    this.coreSignal = coreSignal;
    this.queryMerger = queryMerger;
  }

  /**
   * Execute complete search workflow with progress updates
   */
  async executeSearch(
    userQuery: string,
    icpModel: any,
    onProgress: ProgressCallback
  ): Promise<SearchResult> {
    const startTime = Date.now();

    try {
      // Step 0: Merge query with ICP

      const mergedQuery = await this.queryMerger.mergeICPWithUserQuery(
        userQuery,
        icpModel
      );

   

      let companies = await this.coreSignal.searchCompanies(
        this.extractCompanyFilters(mergedQuery.coreSignalFilters)
      );

   

      // Step 2: Filter by technology if needed
      if (mergedQuery.coreSignalFilters.technologies?.length > 0) {


        companies = this.coreSignal.filterByTechnology(
          companies,
          mergedQuery.coreSignalFilters.technologies
        );

      }

      // Step 3: Filter by hiring activity if needed
      let jobPostings: any[] = [];
      if (mergedQuery.coreSignalFilters.has_active_jobs) {


        const companyIds = companies.map(c => c.id);
        jobPostings = await this.coreSignal.searchJobs({
          company_ids: companyIds,
          status: 'active'
        });

        companies = this.coreSignal.filterByHiring(companies, jobPostings);

      }

      // Step 4: Get full company details

      const companyIds = companies.slice(0, 50).map(c => c.id); // Limit to top 50
      const detailedCompanies = await this.coreSignal.getCompanyDetailsBatch(companyIds);

  

      // Step 5: Get decision makers if requested
      let contacts: any[] = [];
      if (mergedQuery.criteria.decisionMakers) {

        contacts = await this.coreSignal.searchEmployees({
          company_ids: companyIds,
          seniority: mergedQuery.coreSignalFilters.employee_seniority,
          job_title: mergedQuery.coreSignalFilters.employee_roles
        });

      }

      // Final step: Complete
      const executionTime = Date.now() - startTime;


      return {
        companies: detailedCompanies,
        contacts,
        metadata: {
          totalCompanies: detailedCompanies.length,
          totalContacts: contacts.length,
          filters: mergedQuery.coreSignalFilters,
          query: mergedQuery.structuredQuery,
          executionTime
        }
      };

    } catch (error: any) {
      console.error('Search execution error:', error);
            throw error;
    }
  }

  /**
   * Extract only company-related filters
   */
  private extractCompanyFilters(allFilters: any): any {
    return {
      industry: allFilters.industry,
      country: allFilters.country,
      location: allFilters.location,
      employees_count_gte: allFilters.employees_count_gte,
      employees_count_lte: allFilters.employees_count_lte,
      funding_last_round_type: allFilters.funding_last_round_type,
      funding_last_round_date_gte: allFilters.funding_last_round_date_gte,
      funding_last_round_date_lte: allFilters.funding_last_round_date_lte,
      funding_rounds_count_gte: allFilters.funding_rounds_count_gte
    };
  }

  /**
   * Quick search without progress (for simple queries)
   */
  async quickSearch(userQuery: string, icpModel: any): Promise<SearchResult> {
    return this.executeSearch(userQuery, icpModel, () => {
      // No-op progress callback
    });
  }
}