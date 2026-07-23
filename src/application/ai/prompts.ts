/**
 * Prompt templates for AI tasks.
 * Users can view and edit these in Settings (PRD §14.2).
 * Default prompts are conservative and produce structured output.
 */

export const QUICK_EXPLAIN_PROMPT = `You are a helpful English learning assistant. The user selected text from a webpage while reading.
Provide a concise explanation to help them understand and remember it.

Selected text: {{selectedText}}
Context (surrounding sentences): {{context}}
Page title: {{pageTitle}}

Respond with a JSON object matching this schema:
{
  "type": "word" | "phrase" | "sentence" | "technical_term",
  "chineseMeaning": "brief Chinese meaning",
  "englishMeaning": "brief English meaning",
  "contextMeaning": "what it means in this specific context (optional)",
  "examples": ["1-2 example sentences showing usage"],
  "confidence": "exact" | "likely_same" | "possibly_related" | "insufficient_context"
}

Rules:
- Keep explanations brief and practical.
- If the text is a technical term, set type to "technical_term" and explain the concept.
- If context is insufficient, set confidence to "insufficient_context".
- Only return valid JSON, no markdown or extra text.`;

export const FULL_EXPLAIN_PROMPT = `You are a helpful English learning assistant. Provide a detailed analysis of the selected text.

Selected text: {{selectedText}}
Context: {{context}}
Page title: {{pageTitle}}

Provide:
1. Type classification
2. Chinese and English meanings
3. Meaning in the current context
4. Common collocations or patterns
5. 2-3 example sentences
6. Near-synonyms, antonyms, or easily confused expressions (if applicable)
7. Grammar or usage notes (if relevant)

Respond with structured JSON.`;

export const SIMILAR_CARDS_PROMPT = `You are helping deduplicate English learning cards.
Given the selected text and existing card candidates, assess the relationship.

Selected text: {{selectedText}}
Candidate cards:
{{candidates}}

For each candidate, respond with a JSON array:
[
  {
    "candidateCardId": "...",
    "relation": "exact_duplicate" | "same_word_form" | "same_expression_new_context" | "same_word_different_sense" | "expression_variant" | "near_synonym" | "antonym_or_confusable" | "topic_related" | "unrelated",
    "confidence": "exact" | "likely_same" | "possibly_related" | "insufficient_context",
    "rationale": "one sentence explanation"
  }
]

Only return valid JSON.`;

/**
 * Render a prompt template by substituting {{placeholders}}.
 */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
