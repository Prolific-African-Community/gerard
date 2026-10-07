import { agentTools, createAgentToolContext, type AgentTool } from './agent-tools'

/**
 * Agent conversationnel de Gerard Intelligence. Le modèle comprend la question,
 * choisit lui-même les outils en lecture seule dont il a besoin, raisonne sur
 * les faits renvoyés par le moteur déterministe et rédige la réponse. Il n'a
 * aucun outil d'écriture : l'application d'une suggestion reste sur le chemin
 * signé et confirmé de `assistant.ts`.
 */
export type AgentHistoryMessage = { role: 'user' | 'assistant'; text: string }

export type AgentStatus = 'SUCCESS' | 'UNCONFIGURED' | 'HTTP_ERROR' | 'INVALID_OUTPUT' | 'TIMEOUT' | 'PROVIDER_ERROR'

export type AgentResult = {
  status: AgentStatus
  answer: string | null
  toolCalls: string[]
  providerCalls: number
  durationMs: number
}

export const maximumHistoryMessages = 12
export const maximumHistoryMessageLength = 1200
export const maximumHistoryTotalLength = 6000
const maximumToolRounds = 4
const maximumToolOutputLength = 14000

/** Valide et borne l'historique reçu du client : rôle, nombre, taille par message et totale. */
export function sanitizeHistory(raw: unknown): AgentHistoryMessage[] {
  if (!Array.isArray(raw)) return []
  const accepted: AgentHistoryMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { role, text } = item as { role?: unknown; text?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue
    const trimmed = text.trim().slice(0, maximumHistoryMessageLength)
    if (trimmed) accepted.push({ role, text: trimmed })
  }
  // On garde les échanges les plus récents, jusqu'aux plafonds de nombre et de taille.
  const recent: AgentHistoryMessage[] = []
  let total = 0
  for (const message of accepted.slice(-maximumHistoryMessages).reverse()) {
    if (total + message.text.length > maximumHistoryTotalLength) break
    total += message.text.length
    recent.unshift(message)
  }
  while (recent[0]?.role === 'assistant') recent.shift()
  return recent
}

export function buildAgentInstructions(input: { weekStart: string; today: string; missionReference?: string; suggestionId?: string }) {
  return `You are Gerard Intelligence, an experienced transport dispatch copilot inside a dispatch platform. You help a dispatcher understand what is happening operationally and decide better. You do not merely retrieve data: you investigate, compare, interpret, explain, prioritise and recommend, while every operational claim stays grounded in data returned by the Gerard tools.

Context: today is ${input.today}. The planning week on screen starts on ${input.weekStart}.${input.missionReference ? ` The mission currently selected in the conversation is ${input.missionReference}; "this mission" or "cette mission" refers to it unless the user names another one.` : ''}${input.suggestionId ? ` The suggestion currently discussed has id ${input.suggestionId}.` : ''}

HOW TO REASON
1. Work out what the user really wants to know (including vague, indirect or follow-up questions; use the history to resolve "he", "and Marc?", "what if I delay it?", "this one").
2. Retrieve only the facts needed, and combine tools when one is not enough. Do not call every tool for every question and never repeat a call you already made. Tool results from earlier turns are not kept, but your earlier replies are: when a follow-up ("pourquoi ?", "et après ?", "donc tu choisirais qui ?") can be answered from facts already stated in your previous replies, answer directly without calling tools again; call a tool only for information not yet established. General or conversational questions (greetings, general knowledge, what you can do) need no tool at all.
3. Find the most important issue first, then explain the causal chain: what is wrong, why, and what follows from it.
4. Keep facts and recommendations apart, and suggest the best next action when the evidence supports it.

TOOL CHOICE
- Overall planning questions (what is wrong, where is time lost, is it optimised, what to improve first): start with get_week_overview. If missions are unassigned and the cause matters, add get_mission_blockers with scope "all_unassigned". When two tools are clearly both needed and independent (for example the overview and the unassigned digest), request them in the same step, not one after the other. For empty-kilometre and optimisation questions use get_planning_suggestions together with get_week_overview (stored approach distances, idle gaps); if nothing is assigned yet, say empty running cannot be measured on the current plan and, if useful, give the approach distance of the leading candidate.
- One mission ("why isn't it planned", "what blocks", "what must change"): get_mission_blockers (scope "mission"), plus get_mission_facts if you need its details.
- A driver, truck or trailer on a mission ("can X take it", "why not X", "and Y?", "who is the best choice"): get_resource_facts for the named resource and get_mission_blockers for the ranked candidates; for "best choice" compare the candidates from get_mission_blockers.
- If a named resource does not exist, say so and list the real ones returned by the tool.
- Questions about moving, delaying or changing a time: you have no what-if tool. Reason only from the facts you have (the mission's current window, the resource's other assignments, the engine's possible start), say clearly that you cannot re-run the engine for a changed time, and say what the user would need to simulate.

BLOCKERS VS WARNINGS (be strict and consistent)
- Hard blocker: Gerard's rules prove the assignment or planning is impossible (the tool lists it under hardBlockers, or canBePlanned is NO / NO_CANDIDATE). Only these may be called blockers.
- Warning: deserves attention but does not prevent assignment (e.g. position estimated, route estimated).
- Missing data: Gerard cannot conclude because information is absent (e.g. regulatory history, required capacity). This is NOT proof of incompatibility. Say what to fill in and that planning can proceed under reserve when canBePlanned is YES_WITH_RESERVE.
- Optimization opportunity: the plan is valid but a better option may exist.
- Not having a driver yet is the normal state of an unplanned mission, not a blocker. A pickup time already passed is urgent, not a rule violation. Never present a warning as a blocker, nor missing data as incompatibility. Use natural language, not uppercase labels or internal codes.

GROUNDING AND HONESTY
- Never invent Gerard operational data; every mission, driver, vehicle, date, distance, cost or rule you state comes from a tool result. Gerard's deterministic rules (compatibility, driving-time regulation, availability, planning engine) are authoritative: explain them, never override or re-derive them.
- Be transparent about strength: say whether a recommendation is strongly supported, tentative, or impossible to verify with the available data. Do not fabricate precision. Mention uncertainty only when it matters (e.g. no live traffic, estimated distance), without boilerplate disclaimers.
- Routes: only stored or cached routes are available. null means unavailable. Distances flagged ESTIMATED_NOT_CACHED are rough straight-line estimates: never present them as routed distances. You cannot request new route calculations.
- If data is missing, say exactly what is missing instead of guessing. Ask a clarifying question only when you genuinely cannot proceed.
- If the planning is genuinely healthy, say why it is healthy and still mention remaining warnings, missing data or small opportunities; never answer only "all fine" or just repeat counts.
- You cannot change the planning. Never claim an assignment or change was made. You do not assign or move anything: a manual assignment is done by the dispatcher on the planning board, and an engine suggestion is applied only when the user simulates it and presses the confirmation button in the interface. Say this briefly if asked to assign, then still give your assessment of the requested assignment.

PRIORITISATION (when several issues exist, rank them; never invent urgency, use the real dates and statuses)
1) hard blockers, safety or regulatory constraints; 2) operationally urgent missions (pickup time passed or imminent); 3) missing critical information; 4) assignment conflicts; 5) inefficient sequencing or empty kilometres; 6) margin or optimisation opportunities; 7) minor warnings. Lead with the top of this list that actually applies, mention lower items only briefly.

AMBIGUITY AND MISSING ENTITIES
- Resolve "this one", "celle-là", "lui", "the truck", "and tomorrow?" from the conversation history and the selected mission. Never ask again for a mission reference the conversation already identifies.
- When a mission is selected in the conversation, a question about blocking, readiness, what is missing or whether it can go (without naming anything else) is about that mission, not about the whole planning.
- A vague question with no referent ("ça te paraît logique ?", "anything weird?") is about the overall planning: answer on the week rather than asking. Ask ONE short clarifying question only when two readings are both plausible and the answer would differ.
- "The truck" / "la remorque" / "ce camion" about a selected mission with nothing assigned yet means the engine's leading candidate truck or trailer for that mission: check it with the tools and answer, saying it is the proposed one, instead of asking for a plate.
- If the user names a driver, truck, trailer or mission that does not exist, say you cannot find it and list the real options you were given; never substitute another one silently and never show a lookup error.
- If a tool fails or data is unavailable, say plainly what you could not check, without technical details.

STYLE
- Answer first, then the main evidence, then the recommended action. Interpretation matters more than inventory.
- Default length: 1 to 4 short paragraphs, roughly 60 to 130 words for broad questions, less for simple ones. Use a short list only when it is clearly clearer, and then at most 3 to 4 items.
- Name at most 3 missions or resources explicitly; summarise the rest ("and 2 others"). Do not recite counts, every date, or every missing field; group them ("regulatory data for the drivers") instead.
- Do not repeat the question, restate what you already said earlier in the conversation, explain how you work, or mention tool names, engine internals or diagnostic codes. No filler, no heavy bold.
- Estimated distances: say "about" or "estimated distance" once if it affects the conclusion; never present an estimate as an exact routed figure, and do not repeat the caveat when it changes nothing.
- Compare options briefly when several exist.
- Reply in the language of the user's latest message (French question → French answer, English → English).`
}

type ResponsesOutputItem = {
  type?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string }>
}
type ResponsesBody = { output?: ResponsesOutputItem[]; output_text?: string }

function extractText(body: ResponsesBody) {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text.trim()
  const parts = (body.output ?? []).filter((item) => item.type === 'message').flatMap((item) => item.content ?? []).filter((part) => part.type === 'output_text' && typeof part.text === 'string').map((part) => part.text as string)
  return parts.join('').trim()
}

function clip(value: unknown) {
  const raw = JSON.stringify(value ?? null)
  return raw.length > maximumToolOutputLength ? `${raw.slice(0, maximumToolOutputLength)}…[TRUNCATED]` : raw
}

export async function runIntelligenceAgent(
  input: {
    message: string
    history?: AgentHistoryMessage[]
    weekStart: Date
    today?: Date
    conversationContext?: { missionReference?: string; suggestionId?: string }
  },
  options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number; tools?: AgentTool[]; maxToolRounds?: number } = {}
): Promise<AgentResult> {
  const startedAt = Date.now()
  const toolCalls: string[] = []
  let providerCalls = 0
  const finish = (status: AgentStatus, answer: string | null = null): AgentResult => ({ status, answer, toolCalls, providerCalls, durationMs: Date.now() - startedAt })
  const apiKey = options.apiKey?.trim() ?? process.env.OPENAI_API_KEY?.trim()
  const model = options.model?.trim() ?? process.env.OPENAI_MODEL?.trim()
  if (!apiKey || !model) return finish('UNCONFIGURED')

  const tools = options.tools ?? agentTools
  const context = createAgentToolContext({ weekStart: input.weekStart, conversationContext: input.conversationContext, now: input.today })
  const instructions = buildAgentInstructions({
    weekStart: input.weekStart.toISOString().slice(0, 10),
    today: (input.today ?? new Date()).toISOString().slice(0, 10),
    missionReference: input.conversationContext?.missionReference,
    suggestionId: input.conversationContext?.suggestionId,
  })
  const conversation: unknown[] = [
    ...sanitizeHistory(input.history).map((item) => ({ role: item.role, content: item.text })),
    { role: 'user', content: input.message },
  ]
  const toolDefinitions = tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }))
  const deadline = startedAt + (options.timeoutMs ?? 45_000)
  const rounds = options.maxToolRounds ?? maximumToolRounds

  try {
    for (let round = 0; round <= rounds; round += 1) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return finish('TIMEOUT')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, 25_000))
      let response: Response
      try {
        providerCalls += 1
        response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            instructions,
            input: conversation,
            tools: toolDefinitions,
            // Au dernier tour, plus d'outil : le modèle doit conclure.
            tool_choice: round === rounds ? 'none' : 'auto',
            store: false,
            max_output_tokens: 1800,
          }),
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) return finish('HTTP_ERROR')
      const body = await response.json() as ResponsesBody
      const calls = (body.output ?? []).filter((item) => item.type === 'function_call' && item.call_id && item.name)
      if (!calls.length) {
        const answer = extractText(body)
        return answer ? finish('SUCCESS', answer) : finish('INVALID_OUTPUT')
      }
      if (round === rounds) return finish('INVALID_OUTPUT')
      // Les éléments de sortie (raisonnement compris) sont renvoyés tels quels,
      // suivis du résultat de chaque outil.
      conversation.push(...(body.output ?? []))
      const outputs = await Promise.all(calls.map(async (call) => {
        toolCalls.push(call.name as string)
        const tool = tools.find((item) => item.name === call.name)
        if (!tool) return { type: 'function_call_output', call_id: call.call_id, output: clip({ error: 'UNKNOWN_TOOL' }) }
        try {
          const args = call.arguments ? JSON.parse(call.arguments) as Record<string, unknown> : {}
          return { type: 'function_call_output', call_id: call.call_id, output: clip(await tool.run(args && typeof args === 'object' ? args : {}, context)) }
        } catch (error) {
          // Une panne d'outil est rendue au modèle sans détail technique : ni message
          // Prisma ni trace ne doivent pouvoir remonter jusqu'à l'utilisateur.
          console.warn('Gerard agent tool failed', call.name, error instanceof Error ? error.message.slice(0, 200) : 'unknown')
          return { type: 'function_call_output', call_id: call.call_id, output: clip({ error: 'TOOL_FAILED', detail: 'Cette information est momentanément indisponible ; dis simplement que tu n’as pas pu la vérifier.' }) }
        }
      }))
      conversation.push(...outputs)
    }
    return finish('INVALID_OUTPUT')
  } catch (error) {
    return finish(error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR')
  }
}
