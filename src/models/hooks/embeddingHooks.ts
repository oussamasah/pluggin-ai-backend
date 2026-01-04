// src/models/hooks/embeddingHooks.ts

import { autoEmbeddingService } from "../../services/vector/AutoEmbeddingService";
import {Company,Enrichment,Employee} from "../index"

export function registerEmbeddingHooks() {
  // Company hooks
  Company.schema.pre('save', async function(this: any) {
    try {
      // Always check if embedding is missing or needs regeneration
      const hasEmbedding = this.embedding && Array.isArray(this.embedding) && this.embedding.length > 0;
      const isNewDocument = this.isNew;
      
      // Trigger embedding generation for:
      // 1. New documents (always generate for new documents)
      // 2. Documents without embeddings
      // 3. Documents with old embeddings (checked inside autoEmbedOnSave)
      if (isNewDocument || !hasEmbedding) {
        console.log(`🔧 [Company Hook] Triggering embedding for ${isNewDocument ? 'NEW' : 'existing'} document: ${this.name || this._id}`);
        await autoEmbeddingService.autoEmbedOnSave(this, 'company');
      } else if (this.isModified() && this.embeddingGeneratedAt) {
        // For existing documents, only regenerate if embedding is older than 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (this.embeddingGeneratedAt < thirtyDaysAgo) {
          console.log(`🔧 [Company Hook] Regenerating old embedding for: ${this.name || this._id}`);
          await autoEmbeddingService.autoEmbedOnSave(this, 'company');
        } else {
          console.log(`⏭️  [Company Hook] Skipping - recent embedding exists for: ${this.name || this._id}`);
        }
      }
    } catch (error) {
      console.error(`❌ [Company Hook] Error in pre-save hook:`, error);
      // Don't throw - allow save to continue even if embedding fails
    }
  });
  
  // Employee hooks
  Employee.schema.pre('save', async function(this: any) {
    try {
      // Trigger embedding generation for:
      // 1. New documents (isNew)
      // 2. Documents without embeddings (!this.embedding)
      // 3. Documents with old embeddings (checked inside autoEmbedOnSave)
      const shouldEmbed = this.isNew || !this.embedding || this.embedding === null || this.embedding === undefined;
      
      if (shouldEmbed) {
        console.log(`🔧 [Employee Hook] Triggering embedding for ${this.isNew ? 'new' : 'existing'} document: ${this.fullName || this._id}`);
        await autoEmbeddingService.autoEmbedOnSave(this, 'employee');
      } else if (this.isModified() && this.embeddingGeneratedAt) {
        // For existing documents, only regenerate if embedding is older than 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (this.embeddingGeneratedAt < thirtyDaysAgo) {
          console.log(`🔧 [Employee Hook] Regenerating old embedding for: ${this.fullName || this._id}`);
          await autoEmbeddingService.autoEmbedOnSave(this, 'employee');
        }
      }
    } catch (error) {
      console.error(`❌ [Employee Hook] Error in pre-save hook:`, error);
      // Don't throw - allow save to continue even if embedding fails
    }
  });
  
  // Enrichment hooks
  Enrichment.schema.pre('save', async function(this: any) {
    try {
      // Trigger embedding generation for:
      // 1. New documents (isNew)
      // 2. Documents without embeddings (!this.embedding)
      // 3. Documents with old embeddings (checked inside autoEmbedOnSave)
      const shouldEmbed = this.isNew || !this.embedding || this.embedding === null || this.embedding === undefined;
      
      if (shouldEmbed) {
        console.log(`🔧 [Enrichment Hook] Triggering embedding for ${this.isNew ? 'new' : 'existing'} document: ${this._id}`);
        await autoEmbeddingService.autoEmbedOnSave(this, 'enrichment');
      } else if (this.isModified() && this.embeddingGeneratedAt) {
        // For existing documents, only regenerate if embedding is older than 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (this.embeddingGeneratedAt < thirtyDaysAgo) {
          console.log(`🔧 [Enrichment Hook] Regenerating old embedding for: ${this._id}`);
          await autoEmbeddingService.autoEmbedOnSave(this, 'enrichment');
        }
      }
    } catch (error) {
      console.error(`❌ [Enrichment Hook] Error in pre-save hook:`, error);
      // Don't throw - allow save to continue even if embedding fails
    }
  });
  
  console.log('✅ Embedding hooks registered');
}