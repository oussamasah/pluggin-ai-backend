// src/models/hooks/embeddingHooks.ts

import { autoEmbeddingService } from "../../services/vector/AutoEmbeddingService";
import {Company,Enrichment,Employee} from "../index"

export function registerEmbeddingHooks() {
  // Company hooks
  Company.schema.pre('save', async function(this: any) {
    // Trigger embedding generation for:
    // 1. New documents (isNew)
    // 2. Documents without embeddings (!this.embedding)
    // 3. Documents with old embeddings (checked inside autoEmbedOnSave)
    if (this.isNew || !this.embedding) {
      await autoEmbeddingService.autoEmbedOnSave(this, 'company');
    } else if (this.isModified() && this.embeddingGeneratedAt) {
      // For existing documents, only regenerate if embedding is older than 30 days
      // This is checked inside autoEmbedOnSave, but we can optimize by checking here first
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (this.embeddingGeneratedAt < thirtyDaysAgo) {
        await autoEmbeddingService.autoEmbedOnSave(this, 'company');
      }
    }
  });
  
  // Employee hooks
  Employee.schema.pre('save', async function(this: any) {
    // Trigger embedding generation for:
    // 1. New documents (isNew)
    // 2. Documents without embeddings (!this.embedding)
    // 3. Documents with old embeddings (checked inside autoEmbedOnSave)
    if (this.isNew || !this.embedding) {
      await autoEmbeddingService.autoEmbedOnSave(this, 'employee');
    } else if (this.isModified() && this.embeddingGeneratedAt) {
      // For existing documents, only regenerate if embedding is older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (this.embeddingGeneratedAt < thirtyDaysAgo) {
        await autoEmbeddingService.autoEmbedOnSave(this, 'employee');
      }
    }
  });
  
  // Enrichment hooks
  Enrichment.schema.pre('save', async function(this: any) {
    // Trigger embedding generation for:
    // 1. New documents (isNew)
    // 2. Documents without embeddings (!this.embedding)
    // 3. Documents with old embeddings (checked inside autoEmbedOnSave)
    if (this.isNew || !this.embedding) {
      await autoEmbeddingService.autoEmbedOnSave(this, 'enrichment');
    } else if (this.isModified() && this.embeddingGeneratedAt) {
      // For existing documents, only regenerate if embedding is older than 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (this.embeddingGeneratedAt < thirtyDaysAgo) {
        await autoEmbeddingService.autoEmbedOnSave(this, 'enrichment');
      }
    }
  });
  
  console.log('✅ Embedding hooks registered');
}