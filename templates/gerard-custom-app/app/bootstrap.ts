import type { GerardApplicationConsumer } from '@prolific/gerard-core'
import { customApplication } from '../application'
import { manifest } from '../config/manifest'

export const customConsumer: GerardApplicationConsumer = { application: customApplication, manifest }
