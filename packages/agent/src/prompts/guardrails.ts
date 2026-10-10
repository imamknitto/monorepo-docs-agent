import {
  defineGuardrailPolicy,
  defineInputGuardrail,
  defineOutputGuardrail,
} from '@anvia/core'

/** Prompt-injection / jailbreak patterns blocked before the model runs. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /\b(system\s+prompt|reveal\s+(your\s+)?(system\s+)?(prompt|instructions))\b/i,
  /\b(jailbreak|jail-break|\bDAN\b\s*mode|do\s+anything\s+now)\b/i,
  /forget\s+(all\s+)?(previous|prior)\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+\w+\s+(assistant|ai|model)/i,
]

/** Markers suggesting the model is leaking its own instructions. */
const LEAKAGE_PATTERNS: RegExp[] = [
  /my\s+(system|core)\s+(prompt|instructions)\s+(says?|states?|are)/i,
  /as\s+an\s+ai\b[\s\S]{0,80}my\s+instructions/i,
]

function hit(text: string, patterns: RegExp[]): RegExp | undefined {
  return patterns.find((re) => re.test(text))
}

const injectionGuard = defineInputGuardrail({
  id: 'prompt-injection',
  check({ inputText }, actions) {
    const re = hit(inputText, INJECTION_PATTERNS)
    if (!re) return actions.allow()
    return actions.block({
      reason: `prompt-injection pattern: ${re.source}`,
      message:
        'Permintaan itu terlihat seperti upaya injeksi prompt dan saya tidak bisa memenuhinya. ' +
        'Silakan tanyakan sesuatu tentang isi dokumen ini.',
    })
  },
})

const leakageGuard = defineOutputGuardrail({
  id: 'prompt-leakage',
  check({ outputText }, actions) {
    const re = hit(outputText, LEAKAGE_PATTERNS)
    if (!re) return actions.allow()
    return actions.block({
      reason: `prompt-leakage pattern: ${re.source}`,
      message:
        'Saya tidak bisa membagikan instruksi internal. Silakan tanyakan sesuatu tentang isi dokumen ini.',
    })
  },
})

/**
 * Deterministic safety net around the doc-QA agent. Runs in "enforce" mode:
 * blocked input/outputs are replaced by the refusal message above.
 */
export const docGuardrails = defineGuardrailPolicy({
  id: 'doc-qa-safety',
  mode: 'enforce',
  input: [injectionGuard],
  output: [leakageGuard],
})
