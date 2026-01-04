// src/models/hooks/embeddingHooks.ts

import { autoEmbeddingService } from "../../services/vector/AutoEmbeddingService";
import {Company,Enrichment,Employee} from "../index"

export function registerEmbeddingHooks() {
  // Company hooks

  
  Company.schema.pre('save', async function(this: any) {
    if (this.isModified() || !this.embedding) {
      await autoEmbeddingService.autoEmbedOnSave(this, 'company');
    }
  });
  
  // Employee hooks
  
  Employee.schema.pre('save', async function(this: any) {
    if (this.isModified() || !this.embedding) {
      await autoEmbeddingService.autoEmbedOnSave(this, 'employee');
    }
  });
  
  // Enrichment hooks
  
  Enrichment.schema.pre('save', async function(this: any) {
    if (this.isModified() || !this.embedding) {
      await autoEmbeddingService.autoEmbedOnSave(this, 'enrichment');
    }
  });
  
  console.log('✅ Embedding hooks registered');
}