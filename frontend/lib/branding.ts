/**
 * Names used by the IDE assistant panel. Change the assistant's identity here only.
 */
export const PRODUCT_NAME = 'CuBot';

export const AGENT = {
  /** Name shown in the panel header. */
  name: 'AI Assistant',
} as const;

export const AGENT_MODES = {
  build: {
    label: 'Vibe',
    hint: 'The AI edits files and verifies the build on its own.',
    placeholder: 'Ask AI for help… (Shift+Enter for newline)',
    empty: 'Ask questions about your code or get help with programming tasks.',
  },
  plan: {
    label: 'Plan',
    hint: 'Plan mode — AI will break your request into structured steps you can review before applying.',
    placeholder: 'Describe what to build — AI will plan the steps…',
    empty: 'Describe what you want to build and the AI will create a step-by-step plan.',
  },
  tutor: {
    label: 'Tutor',
    hint: 'Coaches you with questions and hints. Reads your code but never writes it for you.',
    placeholder: 'Ask for a hint or an explanation…',
    empty: 'Stuck on something? Ask for a hint. The tutor explains and nudges, you write the code.',
  },
} as const;
