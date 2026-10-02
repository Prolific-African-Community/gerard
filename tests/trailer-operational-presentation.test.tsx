import assert from 'node:assert/strict'
// @ts-expect-error No @types/react-dom in this project, as in the existing render suites.
import { renderToStaticMarkup } from 'react-dom/server'
import { getTrailerOperationalPresentation } from '../lib/dispatch/trailer-display'
import { buildTrailerActiveMissions } from '../lib/dispatch/trailer-rotation'
import { TrailerFormModal } from '../components/dispatch/MissionPool'
import { TrailerCard } from '../components/dispatch/TrailerCard'
import { MissionCardVisual } from '../components/dispatch/MissionCard'
import { classifyPlanningMissions, reconcileVisiblePlanningScope } from '../lib/dispatch/auto-planning/mission-scope'
import { reconcileOptimizationOutcomes } from '../lib/dispatch/auto-planning/simulation'
import { validateAutoPlanningSelection } from '../lib/dispatch/auto-planning/selection'
import type { Trailer, Mission, Truck } from '../lib/dispatch/mock-data'
import type { DispatchOptimizationResult, PairProposal } from '../lib/dispatch/optimization'

const trailer: Trailer = { id:'trailer', plateNumber:'RE 2001', type:'CURTAINSIDER', status:'AVAILABLE', loadStatus:'EMPTY', truckId:'truck' }
const truck: Truck = { id:'truck', plateNumber:'LU 0221', status:'EN_ROUTE_TO_PICKUP' }
const active = { missionId:'active',missionReference:'INT-1234',missionStatus:'IN_PROGRESS' }
assert.equal(getTrailerOperationalPresentation(trailer,active).status.label,'Engagée')
assert.equal(getTrailerOperationalPresentation(trailer,active).locationLabel,'En transit')
assert.equal(getTrailerOperationalPresentation(trailer,active).locationEditable,false)
assert.equal(getTrailerOperationalPresentation({...trailer,truckId:null},null).locationEditable,true)
assert.equal(getTrailerOperationalPresentation({...trailer,truckId:null},null).status.label,'Disponible')
assert.equal(getTrailerOperationalPresentation({...trailer,status:'OUT_OF_SERVICE'},active).status.label,'Retirée du parc actif')
assert.equal(getTrailerOperationalPresentation({...trailer,status:'IN_MAINTENANCE'},active).status.label,'Maintenance')
assert.deepEqual(Object.keys(buildTrailerActiveMissions([
  {id:'active',reference:'INT-1234',status:'IN_PROGRESS',trailerId:'trailer'},
  {id:'future',reference:'FUTURE',status:'ASSIGNED',trailerId:'trailer'},
  {id:'old',reference:'OLD',status:'DONE',trailerId:'trailer'},
],m=>m.trailerId)),['trailer'])
assert.equal(buildTrailerActiveMissions([{id:'future',reference:'FUTURE',status:'ASSIGNED',trailerId:'trailer'}],m=>m.trailerId).trailer,undefined)
const form = (value:Trailer) => renderToStaticMarkup(<TrailerFormModal trailer={value} trucks={[truck]} activeMission={active} onClose={()=>{}} onSubmit={async()=>{}} />)
const attached = form(trailer)
assert.match(attached,/En transit.*suit LU 0221/)
assert.doesNotMatch(attached,/<option value="BASE"/)
const detached = form({...trailer,truckId:null})
assert.match(detached,/<option value="BASE"/)
assert.match(detached,/<option value="OTHER"/)
assert.match(renderToStaticMarkup(<TrailerCard trailer={trailer} activeMission={active} truck={truck} dragDisabled />),/Engagée/)
const mission:Mission={id:'mission',reference:'EC-1234',status:'assigned',clientName:'Client QA',pickupCity:'Luxembourg',deliveryCity:'Paris',estimatedKm:300,trailerPlateNumber:'RE 2001'}
const compact=renderToStaticMarkup(<MissionCardVisual mission={mission} compact />)
const automatic=renderToStaticMarkup(<MissionCardVisual mission={{...mission,trailerPlateNumber:undefined}} compact />)
assert.match(compact,/data-compact-reference[\s\S]*EC-1234[\s\S]*data-compact-trailer[\s\S]*RE 2001/)
assert.doesNotMatch(compact,/Remorque/)
assert.equal((compact.match(/<p /g)??[]).length,(automatic.match(/<p /g)??[]).length)
assert.match(compact,/Luxembourg/); assert.match(compact,/Paris/); assert.match(compact,/300 km/)
const ids=Array.from({length:6},(_,i)=>`mission-${i}`)
const source=ids.map(id=>({id,reference:id,status:'PENDING',pickupDate:'2036-06-03T08:00:00Z',deliveryDate:'2036-06-03T16:00:00Z'}))
const scope=classifyPlanningMissions({missions:[...source,
{id:'outside',reference:'OUT',status:'PENDING',pickupDate:'2036-06-12T08:00:00Z'},
{id:'active',reference:'INT',status:'IN_PROGRESS',pickupDate:'2036-06-02T08:00:00Z',assignment:{scheduledDate:'2036-06-02T08:00:00Z'}},
],periodStart:new Date('2036-06-01T22:00:00Z'),periodEnd:new Date('2036-06-08T21:59:59.999Z'),includeExistingForced:false})
assert.equal(scope.exclusions.length,2)
assert.deepEqual(scope.visibleMissionIds,ids)
assert.deepEqual(scope.includedMissionIds,ids)
assert.deepEqual(reconcileVisiblePlanningScope(scope),{excluded:0,poolEquationValid:true})
assert.equal(reconcileVisiblePlanningScope({...scope,includedMissionIds:ids.slice(1)}).poolEquationValid,false)
const proposal={missions:ids.map(missionId=>({missionId,reference:missionId,explanation:{summary:'Feasible with regulatory history warning'}}))} as PairProposal
const result={confirmedProposals:[],conditionalProposals:[proposal],impossibleMissions:[],deferredMissions:[],unassignedMissions:[]} as unknown as DispatchOptimizationResult
const outcomes=reconcileOptimizationOutcomes({result,includedMissionIds:ids})
assert.deepEqual(outcomes.map(o=>o.missionId),ids)
assert.ok(outcomes.every(o=>o.category==='CONDITIONAL'))
assert.equal(validateAutoPlanningSelection(result,ids,ids).length,6)
assert.throws(()=>validateAutoPlanningSelection(result,ids,[]),/conditionnelle/)
assert.throws(()=>reconcileOptimizationOutcomes({result:{...result,conditionalProposals:[proposal,proposal]},includedMissionIds:ids}),/CARDINALITY/)
console.log('A-G manual QA regressions: operational trailer, location form, compact render, six orange outcomes and explicit application consent: OK')
