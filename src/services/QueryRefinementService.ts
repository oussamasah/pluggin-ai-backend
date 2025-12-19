// src/services/QueryRefinementService.ts
import { config } from '../core/config.js';
import { ICPModel } from '../core/types.js';
import { openRouterService } from '../utils/OpenRouterService.js';

/**
 * PRODUCTION-GRADE QUERY REFINEMENT SERVICE
 * 
 * Key Improvements:
 * 1. Clear state machine with explicit transitions
 * 2. Structured prompt engineering for precise control
 * 3. JSON-enforced responses for reliability
 * 4. Removal tracking via structured data (not string matching)
 * 5. Validation at multiple levels
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface QueryState {
  stage: 'initial' | 'proposed' | 'refining' | 'confirmed' | 'ready';
  currentQuery: string;
  removedCriteria: Set<string>; // What user explicitly removed
  addedCriteria: string[]; // What user explicitly added
  conversationHistory: ConversationTurn[];
}

interface ClaudeDecision {
  // What to show the user
  userMessage: string;
  
  // The refined query
  query: string;
  
  // Next stage
  nextStage: 'proposed' | 'refining' | 'confirmed' | 'ready';
  
  // What action to take
  action: 'propose' | 'refine' | 'confirm' | 'start_search' | 'clarify';
  
  // Analysis for debugging
  analysis: {
    userIntent: string;
    criteriaChanges: {
      added: string[];
      removed: string[];
      kept: string[];
    };
    confidence: number;
  };
  
  // Optional suggestions
  suggestions?: string[];
}

interface RefinementResult {
  response: string;
  stage: QueryState['stage'];
  action: {
    type: 'propose_query' | 'request_refinement' | 'await_confirmation' | 'start_search' | 'request_clarification';
    query?: string;
  };
  currentQuery: string;
  context: {
    stage: string;
    currentQuery: string;
  };
}

// ============================================================================
// MAIN SERVICE CLASS
// ============================================================================

export class QueryRefinementService {
  private state: QueryState;
  private icpModel?: ICPModel | null;
  
  constructor() {
    this.state = {
      stage: 'initial',
      currentQuery: '',
      removedCriteria: new Set(),
      addedCriteria: [],
      conversationHistory: []
    };
  }
  
  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------
  
  async handleMessage(
    userMessage: string,
    currentStage: QueryState['stage'],
    currentQuery: string,
    icpModel?: ICPModel | null
  ): Promise<RefinementResult> {
    // Update state
    this.state.stage = currentStage;
    this.state.currentQuery = currentQuery;
    this.icpModel = icpModel;
    
    // Add user message to history
    this.addToHistory('user', userMessage);
    
    // Get Claude's decision
    const decision = await this.getClaudeDecision(userMessage);
    
    // Add assistant response to history
    this.addToHistory('assistant', decision.userMessage);
    
    // Update removal tracking
    this.updateRemovals(decision.analysis.criteriaChanges);
    
    // Map to result format
    return this.mapToResult(decision);
  }
  
  clearState(): void {
    this.state = {
      stage: 'initial',
      currentQuery: '',
      removedCriteria: new Set(),
      addedCriteria: [],
      conversationHistory: []
    };
    this.icpModel = undefined;
  }
  
  // -------------------------------------------------------------------------
  // CORE LOGIC
  // -------------------------------------------------------------------------
  
  private async getClaudeDecision(userMessage: string): Promise<ClaudeDecision> {
    const prompt = this.buildPrompt(userMessage);
    
    try {
      const response = await openRouterService.generate(prompt, undefined,config.OLLAMA_MODEL, 4096);
      return this.parseClaudeResponse(response);
    } catch (error) {
      console.error('❌ Claude API error:', error);
      return this.getFallbackDecision(userMessage);
    }
  }
  
  private buildPrompt(userMessage: string): string {
    return `You are a QUERY REFINEMENT EXPERT helping users create precise company search queries.

# YOUR MISSION
Help the user build a perfect search query through conversation. You MUST:
1. Understand what criteria they want (industries, locations, size, signals)
2. Track what they want REMOVED (never re-add removed criteria)
3. Propose clear, specific queries
4. Only start the search when they explicitly confirm

# CURRENT STATE
Stage: ${this.state.stage}
Current Query: "${this.state.currentQuery || 'None yet'}"
Removed Criteria: ${Array.from(this.state.removedCriteria).join(', ') || 'None'}
Conversation History:
${this.formatHistory()}

${this.icpModel ? `# ICP MODEL CONTEXT
${this.formatICP()}` : '# NO ICP MODEL ACTIVE'}

# USER'S LATEST MESSAGE
"${userMessage}"

# YOUR TASK
Analyze the user's message and respond with VALID JSON ONLY (no markdown, no explanations):

{
  "userMessage": "Your friendly response to the user",
  "query": "The refined search query",
  "nextStage": "proposed|refining|confirmed|ready",
  "action": "propose|refine|confirm|start_search|clarify",
  "analysis": {
    "userIntent": "What the user wants to do",
    "criteriaChanges": {
      "added": ["criteria being added"],
      "removed": ["criteria being removed"],
      "kept": ["criteria staying the same"]
    },
    "confidence": 0.95
  },
  "suggestions": ["Optional suggestion 1", "Optional suggestion 2"]
}

# CRITICAL RULES
1. **Removal is Permanent**: If user says "without X" or "remove X", NEVER include X again
2. **Explicit Confirmation Required**: Only set action="start_search" when user says "yes", "start", "go ahead", etc.
3. **Clear Queries**: Make queries specific and actionable (e.g., "Companies in Saudi Arabia with 200-500 employees in software development that recently raised funding")
4. **Track Everything**: Log all criteria changes in the analysis section
5. **Stage Transitions**:
   - initial → proposed: First query suggestion
   - proposed → refining: User wants changes
   - refining → confirmed: User approves after refinement
   - confirmed → ready: User says to start searching

# EXAMPLES

User: "Find software companies in KSA"
Response:
{
  "userMessage": "I'll help you find software companies in Saudi Arabia. Here's my search query:\\n\\n\\"Companies in Saudi Arabia in the software development industry\\"\\n\\nWould you like to add any criteria like company size, funding status, or hiring signals?",
  "query": "Companies in Saudi Arabia in the software development industry",
  "nextStage": "proposed",
  "action": "propose",
  "analysis": {
    "userIntent": "Initial search request",
    "criteriaChanges": {
      "added": ["Saudi Arabia", "software development"],
      "removed": [],
      "kept": []
    },
    "confidence": 0.95
  },
  "suggestions": ["Add company size range", "Include funding signals", "Specify technology stack"]
}

User: "Add 200-500 employees and recently funded, but without revenue requirements"
Response:
{
  "userMessage": "Got it! I've updated the query to include employee count and funding signals, while removing any revenue requirements:\\n\\n\\"Companies in Saudi Arabia with 200-500 employees in software development that recently raised funding\\"\\n\\nIs this what you're looking for?",
  "query": "Companies in Saudi Arabia with 200-500 employees in software development that recently raised funding",
  "nextStage": "proposed",
  "action": "refine",
  "analysis": {
    "userIntent": "Add size and funding, remove revenue",
    "criteriaChanges": {
      "added": ["200-500 employees", "recently funded"],
      "removed": ["revenue"],
      "kept": ["Saudi Arabia", "software development"]
    },
    "confidence": 0.98
  }
}

User: "Yes, start the search"
Response:
{
  "userMessage": "Perfect! Starting the search now for companies in Saudi Arabia with 200-500 employees in software development that recently raised funding. I'll analyze the results and get back to you shortly.",
  "query": "Companies in Saudi Arabia with 200-500 employees in software development that recently raised funding",
  "nextStage": "ready",
  "action": "start_search",
  "analysis": {
    "userIntent": "Confirmed - ready to search",
    "criteriaChanges": {
      "added": [],
      "removed": [],
      "kept": ["Saudi Arabia", "software development", "200-500 employees", "recently funded"]
    },
    "confidence": 1.0
  }
}

NOW RESPOND WITH JSON ONLY:`;
  }
  
  private parseClaudeResponse(response: string): ClaudeDecision {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response.trim();
      
      // Remove markdown code blocks if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      // Find JSON object
      const startIdx = jsonStr.indexOf('{');
      const endIdx = jsonStr.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }
      
      const parsed = JSON.parse(jsonStr);
      
      // Validate structure
      if (!parsed.userMessage || !parsed.query || !parsed.action) {
        throw new Error('Invalid response structure');
      }
      
      // Ensure removed criteria are actually removed from query
      const cleanedQuery = this.enforceRemovals(parsed.query);
      
      return {
        userMessage: parsed.userMessage,
        query: cleanedQuery,
        nextStage: parsed.nextStage || 'proposed',
        action: parsed.action,
        analysis: parsed.analysis || {
          userIntent: 'Unknown',
          criteriaChanges: { added: [], removed: [], kept: [] },
          confidence: 0.5
        },
        suggestions: parsed.suggestions
      };
    } catch (error) {
      console.error('❌ Failed to parse Claude response:', error);
      console.error('Raw response:', response);
      throw error;
    }
  }
  
  private getFallbackDecision(userMessage: string): ClaudeDecision {
    const lowerMsg = userMessage.toLowerCase();
    
    // Check for confirmation
    if (this.isConfirmation(lowerMsg)) {
      return {
        userMessage: `Starting search with: "${this.state.currentQuery}"`,
        query: this.state.currentQuery,
        nextStage: 'ready',
        action: 'start_search',
        analysis: {
          userIntent: 'User confirmed',
          criteriaChanges: { added: [], removed: [], kept: [] },
          confidence: 0.9
        }
      };
    }
    
    // Default: propose a basic query
    const basicQuery = this.createBasicQuery(userMessage);
    return {
      userMessage: `I'll help you search for companies. Here's my proposal:\n\n"${basicQuery}"\n\nWould you like to refine this?`,
      query: basicQuery,
      nextStage: 'proposed',
      action: 'propose',
      analysis: {
        userIntent: 'New search request',
        criteriaChanges: { added: [], removed: [], kept: [] },
        confidence: 0.6
      }
    };
  }
  
  // -------------------------------------------------------------------------
  // HELPER METHODS
  // -------------------------------------------------------------------------
  
  private addToHistory(role: 'user' | 'assistant', content: string): void {
    this.state.conversationHistory.push({
      role,
      content,
      timestamp: new Date()
    });
  }
  
  private formatHistory(): string {
    if (this.state.conversationHistory.length === 0) {
      return '(No previous conversation)';
    }
    
    return this.state.conversationHistory
      .slice(-6) // Last 6 messages for context
      .map(turn => `${turn.role.toUpperCase()}: ${turn.content}`)
      .join('\n');
  }
  
  private formatICP(): string {
    if (!this.icpModel) return '';
    
    const { config } = this.icpModel;
    const parts: string[] = [];
    
    if (config.industries?.length) {
      parts.push(`Industries: ${config.industries.join(', ')}`);
    }
    if (config.geographies?.length) {
      parts.push(`Locations: ${config.geographies.join(', ')}`);
    }
    if (config.employeeRange) {
      parts.push(`Company Size: ${config.employeeRange}`);
    }
    if (config.annualRevenue) {
      parts.push(`Revenue: ${config.annualRevenue}`);
    }
    if (config.mustHaveTech?.length) {
      parts.push(`Technology: ${config.mustHaveTech.join(', ')}`);
    }
    if (config.buyingTriggers?.length) {
      parts.push(`Buying Signals: ${config.buyingTriggers.join(', ')}`);
    }
    
    return parts.join('\n');
  }
  
  private updateRemovals(changes: ClaudeDecision['analysis']['criteriaChanges']): void {
    // Add removed criteria to tracking
    changes.removed.forEach(criteria => {
      this.state.removedCriteria.add(criteria.toLowerCase());
    });
    
    // Track additions
    this.state.addedCriteria.push(...changes.added);
  }
  
  private enforceRemovals(query: string): string {
    if (this.state.removedCriteria.size === 0) return query;
    
    let cleaned = query;
    
    // Remove forbidden criteria
    this.state.removedCriteria.forEach(criteria => {
      const regex = new RegExp(`\\b${this.escapeRegex(criteria)}\\b`, 'gi');
      cleaned = cleaned.replace(regex, '');
    });
    
    // Clean up formatting
    cleaned = cleaned
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      .replace(/,\s*,/g, ',')
      .replace(/\s+(and|with|in)\s+$/i, '')
      .trim();
    
    return cleaned || 'Search for companies';
  }
  
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  private isConfirmation(message: string): boolean {
    const confirmations = [
      'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'correct',
      'start', 'go', 'begin', 'search', 'proceed', 'confirm',
      'looks good', 'perfect', 'that works', 'lets do it'
    ];
    
    return confirmations.some(word => message.includes(word));
  }
  
  private createBasicQuery(message: string): string {
    const lower = message.toLowerCase();
    
    if (lower.includes('software')) {
      return 'Companies in the software development industry';
    }
    if (lower.includes('saas')) {
      return 'SaaS companies';
    }
    if (lower.includes('tech')) {
      return 'Technology companies';
    }
    
    return 'Companies matching your criteria';
  }
  
  private mapToResult(decision: ClaudeDecision): RefinementResult {
    const actionTypeMap: Record<ClaudeDecision['action'], RefinementResult['action']['type']> = {
      'propose': 'propose_query',
      'refine': 'request_refinement',
      'confirm': 'await_confirmation',
      'start_search': 'start_search',
      'clarify': 'request_clarification'
    };
    
    this.state.stage = decision.nextStage;
    this.state.currentQuery = decision.query;
    
    return {
      response: decision.userMessage,
      stage: decision.nextStage,
      action: {
        type: actionTypeMap[decision.action],
        query: decision.query
      },
      currentQuery: decision.query,
      context: {
        stage: decision.nextStage,
        currentQuery: decision.query
      }
    };
  }
  
  // -------------------------------------------------------------------------
  // GETTERS
  // -------------------------------------------------------------------------
  
  getState(): Readonly<QueryState> {
    return { ...this.state };
  }
  
  getCurrentQuery(): string {
    return this.state.currentQuery;
  }
  
  getRemovedCriteria(): string[] {
    return Array.from(this.state.removedCriteria);
  }
}