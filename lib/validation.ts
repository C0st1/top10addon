// ============================================================
// Zod Schema Validation — Request body validation
// ============================================================

import { z } from 'zod';

export const saveConfigSchema = z.object({
  tmdbApiKey: z.string().trim().min(1, 'TMDB API key is required'),
  country: z.string().min(1, 'Country is required'),
  rpdbApiKey: z.string().trim().optional(),
  movieType: z.string().trim().max(50).optional(),
  seriesType: z.string().trim().max(50).optional(),
});

export const validateTmdbKeySchema = z.object({
  apiKey: z.string().trim().min(1),
});

export type SaveConfigInput = z.infer<typeof saveConfigSchema>;
export type ValidateTmdbKeyInput = z.infer<typeof validateTmdbKeySchema>;
