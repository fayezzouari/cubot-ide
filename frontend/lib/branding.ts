/**
 * Product names used in the UI. Change the agent's identity here only.
 */
export const PRODUCT_NAME = 'CuBot';

export const AGENT = {
  /** Name of the coding agent that lives in the IDE side panel. */
  name: 'Forge',
  /** Short line under the name. */
  tagline: 'coding agent',
  /** What the empty panel says. */
  intro: 'Reads your project, edits files, compiles, and fixes what breaks.',
} as const;

export const AGENT_MODES = {
  build: {
    label: 'Build',
    hint: 'Forge edits files and verifies the build on its own.',
    placeholder: 'Tell Forge what to build or fix…',
  },
  plan: {
    label: 'Plan',
    hint: 'Forge writes a step-by-step plan you run one step at a time.',
    placeholder: 'Describe the feature. Forge drafts the steps…',
  },
} as const;
