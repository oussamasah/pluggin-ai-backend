// src/core/types.ts
export interface Company {
  company_id?: string;

  // 🏢 Basic Identity
  name: string;
  domain: string;
  website?: string;
  logo_url?: string;
  description?: string;
  founded_year?: number;

  // 📍 Location & Contact
  location?: {
    city?: string;
    country?: string;
    country_code?: string;
  };
  contact?: {
    email?: string;
    phone?: string;
  };
  social_profiles?: {
    linkedin?: string;
    twitter?: string;
    facebook?: string;
    instagram?: string;
    crunchbase?: string;
  };

  // 🧭 Business Profile
  industry: string[];
  business_model?: "B2B" | "B2C" | "B2B2C" | "SaaS" | "E-commerce" | "Service";
  target_market?: "SMB" | "Mid-Market" | "Enterprise" | "Startup";
  ownership_type?: "Public" | "Private" | "Subsidiary";

  // 💰 Firmographics
  employee_count?: number;
  revenue_estimated?: number;
  funding_stage?: "Bootstrapped" | "Seed" | "Series A" | "Series B" | "Series C" | "Public";
  total_funding?: number;

  // 🧠 Technographics
  technologies?: string[]; // list of tech used (e.g., AWS, HubSpot, Shopify)

  // 🔥 Intent & Activity
  intent_signals?: Array<{
    name: string;
    detected_date: Date;
    confidence?: number;
  }>;

  // 🤝 Relationships
  relationships?: {
    customers?: string[];
    partners?: string[];
    competitors?: string[];
  };

  scoring_metrics?: {
    fit_score: {
      score: number;
      reason: number;
      confidence: number;
      factors: number;
    };
    intent_score: {
      score: number;
      reason: number;
      confidence: number;
      factors: number;
    };
  };
  enrichement?:any
}

  
  export interface SearchSession {
    id: string;
    name: string;
    createdAt: Date;
    query: string;
    resultsCount: number;
    companies?: Company[];
    searchStatus?: SearchStatus;
    icpModelId?: string;
    userId: string;
  }
 export interface ExaWebset {
    id: string;
    status: 'idle' | 'pending' | 'running' | 'paused' 
    // other fields like createdAt, etc.
}
  export interface SearchStatus {
    stage: 'refining-query'|'awaiting-clarification'|'searching' | 'analyzing' | 'filtering' | 'complete' | 'error' | 'enriching' | 'scoring';
    message: string | undefined;
    progress: number;
    currentStep?: number;
    totalSteps?: number;
    details?:string,
    companies?: any[];
    substeps?: SubStep[];
  }
  export interface Firmographic {
    business_id: string;
    name: string;
    business_description: string;
    website: string;
    country_name: string;
    region_name: string;
    city_name: string;
    street: string;
    zip_code: string;
    naics: string;
    naics_description: string;
    sic_code: string;
    sic_code_description: string;
    ticker: string;
    number_of_employees_range: string; // e.g. "1-10"
    yearly_revenue_range: string; // e.g. "0-500K"
    linkedin_industry_category: string;
    linkedin_profile: string;
    business_logo:string;
    locations_distribution: Record<string, any>[]; // or a specific type if you know the structure
  }
  

  export interface SubStep {
    id: string;
    name: string;
    description?: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'error';
    category?: string;
    priority?: 'low' | 'medium' | 'high';
    tools?: string[];
    message?: string;
    progress?: number;
    startedAt?: Date;
    completedAt?: Date;
  }
  export interface ICPModel {
    id: string;
    name: string;
    isPrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
    config: ICPConfig;
    userId: string;
  }
  
  export interface ICPConfig {
    modelName: string;
    industries: string[];
    geographies: string[];
    employeeRange: string;
    acvRange: string;
    mustHaveTech: string[];
    mustHaveCompliance: string[];
    mustHaveMotion: string;
    excludedIndustries: string[];
    excludedGeographies: string[];
    excludedTechnologies: string[];
    excludedSizeRange: string;
    buyingTriggers: string[];
    targetPersonas: string[];
    scoringWeights: {
      firmographic: number;
      technographic: number;
      intent: number;
      behavioral: number;
    };
  }
  
  export interface WorkflowProgress {
    sessionId: string;
    status: SearchStatus;
    companies: Company[];
    error?: string;
  }
  
  export interface RealTimeMessage {
    type: 'status' | 'progress' | 'company' | 'error' | 'complete';
    data: any;
    sessionId: string;
    timestamp: Date;
  }
  // Add this interface outside the class or in a common types file
export interface EmployeeSearchQuery {
  companyId: number;       // Use the Coresignal company ID
  jobTitle: string;        // The job title to search for
  page?: number;           // For single-page requests (optional)
}

// Interface for a single employee record (simplified for our use)
export interface EmployeeRecord {
  id: number;
  full_name: string;
  headline: string;
  location_full: string;
  // Add other fields you need from the employee response
  experience: {
      title: string;
      company_name: string;
      is_current: number;
      // ...
  }[];
}

// Update SearchResponse to be more specific for Employee data
export interface EmployeeSearchResponse {
  results: number[];
  total_results: number;
  // The CoreSignal API also includes total_pages, page, and pagination data
}