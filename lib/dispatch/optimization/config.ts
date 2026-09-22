import type {
  OptimizationConfiguration,
  OptimizationCostParameters,
  OptimizationStrategy,
} from './types'

export const GERARD_DISPATCH_OPTIMIZATION_ID = 'GERARD_DISPATCH_OPTIMIZATION'
export const LEGACY_DISPATCH_OPTIMIZATION_IDS = ['NOVOTRALUX_DISPATCH_OPTIMIZATION'] as const
export function canonicalizeDispatchOptimizationId(value: string) {
  return value === GERARD_DISPATCH_OPTIMIZATION_ID || (LEGACY_DISPATCH_OPTIMIZATION_IDS as readonly string[]).includes(value)
    ? GERARD_DISPATCH_OPTIMIZATION_ID
    : null
}

export const defaultOptimizationCostParameters: OptimizationCostParameters =
  Object.freeze({
    currency: 'EUR',
    costPerKm: 0.6,
    defaultHourlyCost: 25,
    waitingCostPerHour: 25,
    trailerChangeCost: 15,
  })

export const dispatchOptimizationConfigurationV1: OptimizationConfiguration =
  Object.freeze({
    id: GERARD_DISPATCH_OPTIMIZATION_ID,
    version: '2026-09-19.v2',
    limits: {
      maximumCandidates: 5000,
      maximumIterations: 2000,
      maximumDurationMs: 2500,
      maximumAlternativesPerMission: 12,
    },
    weights: {
      MAX_PROFITABILITY: {
        revenue: 1.2,
        estimatedMargin: 2,
        coverage: 100,
        priority: 8,
        emptyKm: -2.5,
        workBalance: -0.2,
        returnToBase: -30,
        trailerChange: -15,
        lowConfidence: -20,
        habitualTruck: 8,
      },
      BALANCED: {
        revenue: 0.5,
        estimatedMargin: 0.8,
        coverage: 300,
        priority: 20,
        emptyKm: -2,
        workBalance: -1.5,
        returnToBase: -20,
        trailerChange: -10,
        lowConfidence: -40,
        habitualTruck: 12,
      },
      MAX_COVERAGE: {
        revenue: 0.1,
        estimatedMargin: 0.1,
        coverage: 1000,
        priority: 35,
        emptyKm: -0.3,
        workBalance: -0.1,
        returnToBase: -5,
        trailerChange: -3,
        lowConfidence: -25,
        habitualTruck: 3,
      },
    },
  })

export const optimizationStrategies: OptimizationStrategy[] = [
  'MAX_PROFITABILITY',
  'BALANCED',
  'MAX_COVERAGE',
]
