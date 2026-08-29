import { z } from 'zod';
import { economy, gameRules } from '@/lib/config';

export const gameModeSchema = z.enum(['QUIZ', 'SONGLESS', 'WORDLESS']);

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(20, 'Name must be 20 characters or fewer')
  .regex(/^[\p{L}\p{N} _.'-]+$/u, 'Name contains unsupported characters');

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,10}$/, 'Invalid room code');

export const createRoomSchema = z.object({
  name: z.string().trim().min(2).max(40),
  mode: gameModeSchema,
  topic: z.string().trim().min(2).max(60),
  difficulty: z.number().int().min(1).max(5),
  questionCount: z.number().int().min(gameRules.minQuestions).max(gameRules.maxQuestions),
  maxPlayers: z.number().int().min(1).max(economy.defaultRoomCap),
  aiGameMasterEnabled: z.boolean().default(true),
});

/** Output type: defaults are already applied, so every field is present. */
export type CreateRoomInput = z.output<typeof createRoomSchema>;

export const joinRoomSchema = z.object({
  displayName: displayNameSchema,
});

export const submitAnswerSchema = z.object({
  roundNumber: z.number().int().min(1),
  answerIndex: z.number().int().min(0).max(9),
  clientTs: z.number().int().nonnegative().optional(),
});

export const generateQuestionsSchema = z.object({
  topic: z.string().trim().min(2).max(60),
  difficulty: z.number().int().min(1).max(5),
  count: z.number().int().min(1).max(gameRules.maxQuestions),
  mode: gameModeSchema,
});

export const editQuestionSchema = z.object({
  question: z.string().trim().min(5).max(240),
  options: z.array(z.string().trim().min(1).max(120)).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(3).max(400),
  difficulty: z.number().int().min(1).max(5),
  topic: z.string().trim().min(2).max(60),
});

export const claimSchema = z.object({
  destination: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Enter a valid EVM address')
    .optional(),
});

/**
 * Structured output contract for the AI Game Master. Anything that fails this
 * check is discarded in favour of the deterministic fallback.
 */
export const aiDecisionSchema = z.object({
  nextDifficulty: z.coerce.number().int().min(1).max(5),
  nextTopic: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(5).max(400),
  questionSelectionStrategy: z.enum(['easier', 'same', 'harder']),
  decisionConfidence: z.coerce.number().min(0).max(1),
});

/**
 * Validation for a single AI-generated question. Enforces the guide's rules:
 * exactly four options, one correct answer, no duplicate options, and a
 * non-empty explanation.
 */
export const aiQuestionSchema = z
  .object({
    question: z.string().trim().min(8).max(240),
    options: z.array(z.string().trim().min(1).max(120)).length(4),
    correctAnswerIndex: z.coerce.number().int().min(0).max(3),
    difficulty: z.coerce.number().int().min(1).max(5).catch(3),
    topic: z.string().trim().min(1).max(60).catch('General'),
    explanation: z.string().trim().min(3).max(400),
  })
  .refine(
    (value) => new Set(value.options.map((o) => o.toLowerCase())).size === 4,
    { message: 'Options must be distinct' },
  );

export const aiQuestionSetSchema = z.object({
  questions: z.array(aiQuestionSchema).min(1),
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request';
}
