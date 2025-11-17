import { Company } from "../core/types";

export function mapCoresignalToCompany(coresignalData: any): Company {
    const now = new Date();
    
    return {
      company_id: coresignalData.id?.toString() || generateCompanyId(coresignalData),
      basic_info: mapCoresignalBasicInfo(coresignalData),
      contact_info: mapCoresignalContactInfo(coresignalData),
      business_classification: mapCoresignalBusinessClassification(coresignalData),
      firmographic_data: mapCoresignalFirmographicData(coresignalData),
      technographic_data: mapCoresignalTechnographicData(coresignalData),
      intent_signals: mapCoresignalIntentSignals(coresignalData),
      growth_indicators: mapCoresignalGrowthIndicators(coresignalData),
      relationship_data: mapCoresignalRelationshipData(coresignalData),
      scoring_metrics:{
          fit_score: {
              score: 0,
              reason: 0,
              confidence: 0,
              factors: 0
          }, intent_score: {
              score: 0,
              reason: 0,
              confidence: 0,
              factors: 0
          }
      },
      enrichment_metadata: mapCoresignalEnrichmentMetadata(coresignalData, now),
      compliance_flags: mapCoresignalComplianceFlags(coresignalData)
    };
  }
  
  // Individual mapper functions for Coresignal
  function mapCoresignalBasicInfo(data: any): Company['basic_info'] {
    return {
      name: data.company_name || '',
      legal_name: data.company_legal_name || undefined,
      domain: extractDomainFromWebsite(data.website) || '',
      website: data.website || undefined,
      description: data.description || undefined,
      founded_year: data.founded_year ? parseInt(data.founded_year) : undefined,
      logo_url: data.company_logo_url || undefined
    };
  }
  
  function mapCoresignalContactInfo(data: any): Company['contact_info'] {
    // Extract phone/email from description if available
    const contactInfo = extractContactFromDescription(data.description);
    
    return {
      phone: data.company_phone_numbers?.[0] || contactInfo.phone || undefined,
      email: data.company_emails?.[0] || contactInfo.email || undefined,
      address: data.hq_location ? {
        street: data.hq_street || undefined,
        city: data.hq_city || extractCityFromLocation(data.hq_location),
        state: data.hq_state || extractStateFromLocation(data.hq_location),
        postal_code: data.hq_zipcode || undefined,
        country: data.hq_country || undefined,
        country_code: data.hq_country_iso2 || undefined
      } : undefined,
      social_profiles: {
        linkedin: data.linkedin_url || undefined,
        twitter: data.twitter_url?.[0] || undefined,
        facebook: data.facebook_url?.[0] || undefined,
        crunchbase: data.crunchbase_url || undefined
      }
    };
  }
  
  function mapCoresignalBusinessClassification(data: any): Company['business_classification'] {
    return {
      industry: {
        primary: data.industry ? {
          type: data.industry,
          classification_system: 'Custom'
        } : undefined,
        secondary: [],
        tags: data.categories_and_keywords || []
      },
      business_model: data.is_b2b ? 'B2B' : undefined,
      target_market: mapSizeRangeToTargetMarket(data.size_range)
    };
  }
  function mapCoresignalFirmographicData(data: any): Company['firmographic_data'] {
    // Helper function to extract revenue from all sources
    const extractRevenueData = (revenueAnnual: any) => {
      if (!revenueAnnual) return { estimated: undefined, currency: undefined };
      
      // Check all possible revenue sources
      const sources = [
        revenueAnnual.source_1_annual_revenue,
        revenueAnnual.source_2_annual_revenue,
        revenueAnnual.source_3_annual_revenue,
        revenueAnnual.source_4_annual_revenue,
        revenueAnnual.source_5_annual_revenue,
        revenueAnnual.source_6_annual_revenue,
        revenueAnnual.source_7_annual_revenue,
        revenueAnnual.source_8_annual_revenue,
        revenueAnnual.source_9_annual_revenue,
        revenueAnnual.source_10_annual_revenue
      ].filter(source => source && source.annual_revenue);
  
      if (sources.length === 0) {
        return { estimated: undefined, currency: undefined };
      }
  
      // Use the first available source, or implement priority logic
      const primarySource = sources[0];
      
      return {
        estimated: primarySource.annual_revenue,
        currency: primarySource.annual_revenue_currency || 'USD'
      };
    };
  
    const revenueData = extractRevenueData(data.revenue_annual);
  
    return {
      employee_count: {
        range: data.size_range || undefined,
        exact: data.employees_count || undefined,
        growth_rate: data.employees_count_change?.change_yearly_percentage || undefined
      },
      revenue: {
        range: data.revenue_annual_range || undefined,
        estimated: revenueData.estimated,
        currency: revenueData.currency
      },
      funding_status: data.funding_rounds?.length > 0 ? {
        stage: mapFundingRoundToStage(data.last_funding_round_name),
        total_funding: calculateTotalFunding(data.funding_rounds),
        last_round_amount: data.last_funding_round_amount_raised || undefined,
        last_round_date: data.last_funding_round_announced_date ? 
          new Date(data.last_funding_round_announced_date) : undefined,
        investors: data.last_funding_round_lead_investors || []
      } : undefined,
      ownership_type: data.is_public ? 'Public' : 
                     data.type === 'Privately Held' ? 'Private' : undefined
    };
  }
  
  function mapCoresignalTechnographicData(data: any): Company['technographic_data'] {
    return {
      technology_stack: (data.technologies_used || []).map((tech: any) => ({
        category: tech.category || 'Unknown',
        name: tech.name || 'Unknown',
        vendor: tech.vendor || 'Unknown',
        detected_date: new Date(),
        confidence_score: 0.8 // Default confidence for Coresignal
      })),
      infrastructure: {
        cloud_providers: extractTechnologiesByCategory(data.technologies_used, 'cloud'),
        programming_languages: extractTechnologiesByCategory(data.technologies_used, 'programming'),
        frameworks: extractTechnologiesByCategory(data.technologies_used, 'framework'),
        databases: extractTechnologiesByCategory(data.technologies_used, 'database'),
        cms: extractTechnologiesByCategory(data.technologies_used, 'cms')
      },
      martech_stack: {
        crm: extractTechnologiesByCategory(data.technologies_used, 'crm'),
        marketing_automation: extractTechnologiesByCategory(data.technologies_used, 'marketing'),
        analytics_tools: extractTechnologiesByCategory(data.technologies_used, 'analytics'),
        ad_platforms: extractTechnologiesByCategory(data.technologies_used, 'advertising')
      },
      spend_indicators: data.num_technologies_used ? {
        estimated_tech_budget: estimateTechBudget(data.num_technologies_used, data.employees_count),
        it_team_size: undefined // Coresignal doesn't provide this directly
      } : undefined
    };
  }
  
  function mapCoresignalIntentSignals(data: any): Company['intent_signals'] {
    return {
      hiring_signals: {
        job_postings: (data.active_job_postings || []).map((job: any) => ({
          role: job.title || 'Unknown',
          department: job.department || 'Unknown',
          skills_required: job.skills || [],
          posted_date: job.posted_date ? new Date(job.posted_date) : new Date(),
          seniority_level: mapTitleToSeniority(job.title)
        })),
        team_growth_rate: data.employees_count_change?.change_yearly_percentage || undefined
      },
      digital_footprint: {
        page_views: data.total_website_visits_monthly || undefined,
        session_duration: data.average_visit_duration_seconds || undefined,
        content_engagement: [] // Coresignal doesn't provide this directly
      },
      search_behavior: {
        keywords_searched: data.top_topics || [],
        search_frequency: undefined, // Not provided by Coresignal
        search_intent_score: undefined // Not provided by Coresignal
      },
      social_signals: {
        content_shared: data.company_updates?.map((update: any) => update.content).filter(Boolean) || [],
        competitor_mentions: data.competitors || [],
        pain_points_discussed: [] // Not provided by Coresignal
      }
    };
  }
  
  function mapCoresignalGrowthIndicators(data: any): Company['growth_indicators'] {
    return {
      traffic_metrics: data.total_website_visits_monthly ? {
        monthly_visitors: data.total_website_visits_monthly,
        traffic_growth: data.visits_change_monthly || undefined,
        traffic_sources: undefined // Coresignal doesn't provide breakdown
      } : undefined,
      company_momentum: {
        employee_growth_rate: data.employees_count_change?.change_yearly_percentage || undefined,
        revenue_growth_rate: undefined, // Not provided by Coresignal
        market_share_growth: undefined // Not provided by Coresignal
      },
      expansion_signals: {
        new_locations: data.company_locations_full?.length || undefined,
        new_product_launches: undefined, // Not provided by Coresignal
        partnership_announcements: undefined // Not provided by Coresignal
      }
    };
  }
  
  function mapCoresignalRelationshipData(data: any): Company['relationship_data'] {
    return {
      existing_customers: undefined, // Not provided by Coresignal
      partnerships: undefined, // Not provided by Coresignal
      competitor_relationships: data.competitors?.length > 0 ? {
        uses_competitor: true,
        competitor_name: data.competitors[0],
        contract_expiry: undefined
      } : undefined
    };
  }
  
  function mapCoresignalScoringMetrics(data: any): Company['scoring_metrics'] {
    // Calculate basic scores based on available data
    const employeeScore = data.employees_count ? Math.min(data.employees_count / 1000, 10) : 0;
    const growthScore = data.employees_count_change?.change_yearly_percentage ? 
      Math.min(data.employees_count_change.change_yearly_percentage / 10, 10) : 0;
    const techScore = data.num_technologies_used ? Math.min(data.num_technologies_used / 5, 10) : 0;
    
    return {
      fit_score: {
        overall: (employeeScore + techScore) / 2,
        industry_fit: 5, // Default medium score
        size_fit: employeeScore,
        tech_fit: techScore,
        budget_fit: 5 // Default medium score
      },
      intent_score: {
        overall: growthScore,
        buying_signals: data.active_job_postings_count ? 7 : 3,
        engagement_level: data.linkedin_followers_count ? 
          Math.min(data.linkedin_followers_count / 100, 10) : 0,
        urgency_signals: data.employees_count_change?.change_monthly_percentage ? 
          Math.min(Math.abs(data.employees_count_change.change_monthly_percentage) / 5, 10) : 0
      },
      priority_score: {
        overall: (employeeScore + growthScore + techScore) / 3,
        calculated_date: new Date(),
        score_components: {
          fit_weight: 0.4,
          intent_weight: 0.4,
          opportunity_weight: 0.2
        }
      }
    };
  }
  
  function mapCoresignalEnrichmentMetadata(data: any, timestamp: Date): Company['enrichment_metadata'] {
    return {
      data_sources: ['coresignal'],
      last_updated: data.last_updated_at ? new Date(data.last_updated_at) : timestamp,
      confidence_scores: {
        firmographic: 0.8, // High confidence for basic company data
        technographic: data.num_technologies_used ? 0.7 : 0.3,
        intent: data.employees_count_change ? 0.6 : 0.4
      },
      enrichment_history: [{
        source: 'coresignal',
        enriched_fields: getPopulatedFields(data),
        enrichment_date: timestamp
      }]
    };
  }
  
  function mapCoresignalComplianceFlags(data: any): Company['compliance_flags'] {
    return {
      gdpr_compliant: false, // Assume false unless specified
      do_not_contact: false, // Assume false unless specified
      opt_out_status: false, // Assume false unless specified
      compliance_notes: undefined
    };
  }
  
  // Helper functions
  function extractDomainFromWebsite(website: string): string {
    if (!website) return '';
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      return url.hostname;
    } catch {
      return website;
    }
  }
  
  function extractContactFromDescription(description: string): { phone?: string; email?: string } {
    if (!description) return {};
    
    const emailMatch = description.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    const phoneMatch = description.match(/\+\d{10,}/); // Match international phone numbers
    
    return {
      email: emailMatch?.[0],
      phone: phoneMatch?.[0]
    };
  }
  
  function extractCityFromLocation(location: string): string {
    const parts = location.split(',');
    return parts[0]?.trim() || '';
  }
  
  function extractStateFromLocation(location: string): string {
    const parts = location.split(',');
    return parts[1]?.trim() || '';
  }
  
  function mapSizeRangeToTargetMarket(sizeRange: string): Company['business_classification']['target_market'] {
    if (!sizeRange) return undefined;
    
    if (sizeRange.includes('1-10') || sizeRange.includes('1-50')) return 'SMB';
    if (sizeRange.includes('51-200') || sizeRange.includes('201-500')) return 'Mid-Market';
    if (sizeRange.includes('501-1000') || sizeRange.includes('1000+')) return 'Enterprise';
    
    return undefined;
  }
  
  function mapFundingRoundToStage(roundName: string): Company['firmographic_data']['funding_status']['stage'] {
    if (!roundName) return undefined;
    
    const roundMap: { [key: string]: Company['firmographic_data']['funding_status']['stage'] } = {
      'seed': 'Seed',
      'series a': 'Series A',
      'series b': 'Series B',
      'series c': 'Series C',
      'series d': 'Series D+',
      'series e': 'Series D+',
      'ipo': 'Public'
    };
    
    return roundMap[roundName.toLowerCase()];
  }
  
  function calculateTotalFunding(rounds: any[]): number {
    return rounds.reduce((total, round) => total + (round.amount_raised || 0), 0);
  }
  
  function extractTechnologiesByCategory(technologies: any[], category: string): string[] {
    if (!technologies) return [];
    return technologies
      .filter(tech => tech.category?.toLowerCase().includes(category))
      .map(tech => tech.name)
      .filter(Boolean);
  }
  
  function estimateTechBudget(numTechnologies: number, employeeCount: number): number {
    // Rough estimation: $1000 per technology per employee annually
    return numTechnologies * (employeeCount || 10) * 1000;
  }
  
  function mapTitleToSeniority(title: string): string {
    if (!title) return 'Mid-Level';
    
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('junior') || lowerTitle.includes('entry')) return 'Junior';
    if (lowerTitle.includes('senior') || lowerTitle.includes('lead') || lowerTitle.includes('principal')) return 'Senior';
    if (lowerTitle.includes('director') || lowerTitle.includes('vp') || lowerTitle.includes('head')) return 'Executive';
    
    return 'Mid-Level';
  }
  
  function getPopulatedFields(data: any): string[] {
    const fields: string[] = [];
    for (const key in data) {
      if (data[key] !== null && data[key] !== undefined && data[key] !== '') {
        fields.push(key);
      }
    }
    return fields;
  }
  
  function generateCompanyId(data: any): string {
    const domain = extractDomainFromWebsite(data.website) || data.company_name?.toLowerCase().replace(/\s+/g, '-');
    return `comp_${domain}_${Date.now()}`;
  }
  
  // Usage example:
  // const company = mapCoresignalToCompany(coresignalResponse);