import assert from 'node:assert/strict'
import { selectActiveOrganizationMembership } from '../lib/auth/organization-context'

const gerard = { organizationId: 'org-gerard-default', role: 'ORG_ADMIN' }
const second = { organizationId: 'org-second', role: 'VIEWER' }

assert.equal(selectActiveOrganizationMembership([gerard]), gerard, 'G one active organization is selected')
assert.equal(selectActiveOrganizationMembership([gerard, second]), null, 'H multiple organizations require selection')
assert.equal(selectActiveOrganizationMembership([]), null, 'F no membership refuses tenant context')
assert.equal(selectActiveOrganizationMembership([gerard, second], 'org-second'), second, 'explicit signed active organization is honored')
assert.equal(selectActiveOrganizationMembership([gerard], 'org-second'), null, 'J arbitrary cross-tenant organization is rejected')
console.log('F-J tenant organization selection rules: OK')
