// src/core/errors/QueryRefinementPauseError.ts
export class QueryRefinementPauseError extends Error {
    public readonly userMessage: string;
    public readonly suggestions?: string[];
    public readonly isRefinementPause = true;
  
    constructor(message: string, userMessage: string, suggestions?: string[]) {
      super(message);
      this.name = 'QueryRefinementPauseError';
      this.userMessage = userMessage;
      this.suggestions = suggestions;
    }
  }