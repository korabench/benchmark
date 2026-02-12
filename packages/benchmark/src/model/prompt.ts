export interface SystemUserPrompt {
  system: string;
  user: string;
}

export interface InputPrompt {
  input: string;
}

export type Prompt = SystemUserPrompt | InputPrompt;
