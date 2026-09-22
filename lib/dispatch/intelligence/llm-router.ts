import { parseModelIntent } from './intent-router'
import type { GerardAssistantIntentResult } from './types'

const systemPrompt = `Tu es le routeur d'intentions de Gerard, assistant opérationnel dispatch transport.
Tu ne fournis aucun fait métier et tu ne réponds jamais à la question.
Tu extrais uniquement une intention et les entités explicitement citées ou présentes dans le contexte applicatif fourni.
Tu ne devines jamais une disponibilité, un conflit, une compatibilité, une route, un coût, une marge ou une suggestion.
Tu ne complètes jamais une entité absente. Si une entité reste ambiguë, laisse son champ à null.
Une demande d'écriture ou d'application doit avoir requestsMutation=true.
Une référence explicite comme 260916-06 peut être normalisée en GRD-260916-06. Un simple numéro comme "mission 06" reste "06".
"Et Julien à la place ?" correspond à RESOURCE_EXPLANATION avec driverName="Julien".
Réponds uniquement selon le schéma JSON strict.`

export type LlmIntentRoutingResult = {
  intent: GerardAssistantIntentResult | null
  durationMs: number
  status: 'SUCCESS' | 'UNCONFIGURED' | 'HTTP_ERROR' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'PROVIDER_ERROR'
}

export async function classifyIntentWithConfiguredModel(message: string, context: { missionReference?: string; suggestionId?: string } = {}, options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<LlmIntentRoutingResult> {
  const startedAt = Date.now()
  const finish = (intent: GerardAssistantIntentResult | null, status: LlmIntentRoutingResult['status']): LlmIntentRoutingResult => ({ intent, status, durationMs: Date.now() - startedAt })
  const apiKey = options.apiKey?.trim() ?? process.env.OPENAI_API_KEY?.trim()
  const model = options.model?.trim() ?? process.env.OPENAI_MODEL?.trim()
  if (!apiKey || !model) return finish(null, 'UNCONFIGURED')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: `Question utilisateur:\n${message}\n\nContexte applicatif éphémère:\n${JSON.stringify({ missionReference: context.missionReference ?? null, suggestionId: context.suggestionId ?? null })}`,
        max_output_tokens: 180,
        text: { format: { type: 'json_schema', name: 'gerard_intent', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: {
            intent: { type: 'string', enum: ['PLANNING_SUMMARY','MISSION_CONTEXT','MISSION_ALTERNATIVES','RESOURCE_EXPLANATION','PLANNING_SUGGESTIONS','SUGGESTION_EXPLANATION','SIMULATE_SUGGESTION','UNKNOWN'] },
            missionReference: { type: ['string','null'] }, driverName: { type: ['string','null'] },
            truckPlate: { type: ['string','null'] }, trailerPlate: { type: ['string','null'] },
            suggestionId: { type: ['string','null'] }, requestsMutation: { type: 'boolean' },
          },
          required: ['intent','missionReference','driverName','truckPlate','trailerPlate','suggestionId','requestsMutation'],
        } } },
      }),
    })
    if (!response.ok) return finish(null, 'HTTP_ERROR')
    const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
    const raw = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text
    if (!raw) return finish(null, 'INVALID_OUTPUT')
    let decoded: unknown
    try { decoded = JSON.parse(raw) } catch { return finish(null, 'INVALID_OUTPUT') }
    const intent = parseModelIntent(decoded)
    return finish(intent, intent ? 'SUCCESS' : 'INVALID_OUTPUT')
  } catch (error) {
    return finish(null, error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR')
  } finally {
    clearTimeout(timeout)
  }
}

export async function routeIntentWithConfiguredModel(message: string, options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<GerardAssistantIntentResult | null> {
  return (await classifyIntentWithConfiguredModel(message, {}, options)).intent
}
