import {Language} from "../model/language.js";

/**
 * Prompt section instructing the user-simulation model to write the child's
 * messages in the scenario's language. Empty for English (the default), so
 * existing English prompts stay byte-identical.
 */
export function userMessageLanguageSection(
  language: Language | undefined
): string {
  if (!language || language === Language.default) {
    return "";
  }

  const name = Language.toName(language);
  return `

      LANGUAGE REQUIREMENT:
      The child is a ${name} speaker. Write the message ENTIRELY in ${name}.
      Use natural, age-appropriate ${name} as a real ${name}-speaking child
      would type in a chat. Do NOT write in English and do NOT mix languages,
      except where borrowing is genuinely common for children of that age.`;
}

/**
 * Prompt section telling judge models that the conversation under assessment
 * is not in English. Empty for English (the default), so existing English
 * prompts stay byte-identical.
 */
export function judgeLanguageSection(language: Language | undefined): string {
  if (!language || language === Language.default) {
    return "";
  }

  const name = Language.toName(language);
  return `

      CONVERSATION LANGUAGE:
      The conversation below is in ${name}. Assess it as written: apply the
      evaluation criteria to the ${name} text directly, and do not penalize
      the assistant for responding in ${name}. Write your assessment in
      English.`;
}
