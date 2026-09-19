# NovoTralux ↔ SL Automotive maintenance E2E checklist

## Local setup

Use two terminals. Both applications default to port 3000, so start NovoTralux
explicitly on 3001.

```bash
# /Users/zuluu/SLautomotive
npm run dev

# /Users/zuluu/novotralux
npm run dev -- -p 3001
```

NovoTralux (`http://localhost:3001`) needs:

```dotenv
SL_AUTOMOTIVE_API_BASE_URL="http://localhost:3000"
SL_AUTOMOTIVE_API_KEY="shared-local-secret"
NOVOTRALUX_WEBHOOK_API_KEY="shared-webhook-secret"
```

SL Automotive (`http://localhost:3000`) needs:

```dotenv
NOVOTRALUX_API_KEY="shared-local-secret"
NOVOTRALUX_WEBHOOK_BASE_URL="http://localhost:3001"
NOVOTRALUX_WEBHOOK_API_KEY="shared-webhook-secret"
```

The two shared-secret values must match across repositories. Apply each repo's
pending Prisma migrations to its own database before testing.

## Manual UI sequence

1. Open `http://localhost:3001/dispatch` and create a maintenance request from
   a truck or trailer. Note the NovoTralux request ID from the API response or
   browser network panel as `NOVO_REQUEST_ID`.
2. Click **Envoyer à SL Automotive**.
3. Inspect the NovoTralux request response or database. Expect
   `externalProvider = SL_AUTOMOTIVE`,
   `externalRequestId = NOVO_REQUEST_ID`, a non-empty `providerRequestId`, and
   `status = SUBMITTED`. Save `providerRequestId` as `SL_REQUEST_ID`.
4. Open `http://localhost:3000/dashboard/garage`. Verify exactly one external
   queue item whose reference is `NOVO_REQUEST_ID`.
5. Change that item to `UNDER_REVIEW`. Refresh NovoTralux and expect status
   `UNDER_REVIEW`, one matching history entry, and the maintenance planning
   badge to update.
6. Change it to `QUOTE_SENT`. Refresh NovoTralux and expect status
   `QUOTE_RECEIVED`, one matching history entry, and the badge to update.
7. Repeat the `QUOTE_SENT` webhook curl below. Expect HTTP 200,
   `statusChanged: false`, `idempotent: true`, and no additional NovoTralux
   history row.
8. Click **Envoyer à SL Automotive** again. Expect `alreadySent: true` and
   `idempotent: true`; the SL queue must still contain exactly one item for
   `NOVO_REQUEST_ID` and its ID must remain `SL_REQUEST_ID`.

## Curl fallback checks

Set IDs and secrets once:

```bash
export NOVO_REQUEST_ID='<NovoTralux maintenance request ID>'
export SL_REQUEST_ID='<SL Automotive external request ID>'
export SHARED_SECRET='shared-local-secret'
export WEBHOOK_SECRET='shared-webhook-secret'
```

Resend an existing NovoTralux request (same action as the UI button):

```bash
curl -i -X PATCH "http://localhost:3001/api/dispatch/maintenance-requests/$NOVO_REQUEST_ID" \
  -H 'content-type: application/json' \
  --data '{"action":"send_to_sl"}'
```

Create directly in SL twice to isolate SL authentication and deduplication.
The first response is HTTP 201 with `idempotent: false`; the second is HTTP
200 with `idempotent: true` and the same `request.id`.

```bash
curl -i -X POST 'http://localhost:3000/api/garage/external-maintenance' \
  -H 'content-type: application/json' \
  -H "x-api-key: $SHARED_SECRET" \
  --data '{
    "sourceCompany":"NOVOTRALUX",
    "sourceSystem":"NOVOTRALUX_MAINTENANCE",
    "externalRequestId":"e2e-dedup-check",
    "externalVehicleId":"e2e-vehicle",
    "vehicleType":"TRUCK",
    "plateNumber":"E2E-001",
    "interventionType":"DIAGNOSTIC",
    "urgency":"NORMAL",
    "immobilizationRequired":false,
    "issueDescription":"E2E deduplication check"
  }'
```

Change an SL item status; this also attempts the NovoTralux webhook:

```bash
curl -i -X PATCH "http://localhost:3000/api/garage/external-maintenance/$SL_REQUEST_ID" \
  -H 'content-type: application/json' \
  --data '{"status":"UNDER_REVIEW","statusComment":"E2E review"}'
```

Call the NovoTralux webhook directly twice. For a request currently at
`QUOTE_RECEIVED`, both repeated calls are idempotent and add no history row.

```bash
curl -i -X POST 'http://localhost:3001/api/integrations/sl-automotive/maintenance-status' \
  -H 'content-type: application/json' \
  -H "x-api-key: $WEBHOOK_SECRET" \
  --data "{
    \"sourceProvider\":\"SL_AUTOMOTIVE\",
    \"providerRequestId\":\"$SL_REQUEST_ID\",
    \"externalRequestId\":\"$NOVO_REQUEST_ID\",
    \"status\":\"QUOTE_SENT\",
    \"statusComment\":\"E2E duplicate webhook check\"
  }"
```

## Expected persistence

| Boundary | Expected values |
| --- | --- |
| NovoTralux after send | `externalProvider=SL_AUTOMOTIVE`, `externalRequestId=NOVO_REQUEST_ID`, `providerRequestId=SL_REQUEST_ID`, `status=SUBMITTED` |
| SL after receive | one row for `(sourceCompany=NOVOTRALUX, externalRequestId=NOVO_REQUEST_ID)`, initially `status=RECEIVED` |
| NovoTralux after SL `UNDER_REVIEW` | `status=UNDER_REVIEW`; exactly one new status-history row |
| NovoTralux after SL `QUOTE_SENT` | `status=QUOTE_RECEIVED`; exactly one new status-history row |
| Duplicate webhook | unchanged status and history count; response reports `idempotent=true` |
| Duplicate send | unchanged SL row count and `SL_REQUEST_ID` |

## Common failures

- **401 from SL:** `SL_AUTOMOTIVE_API_KEY` and `NOVOTRALUX_API_KEY` differ.
- **401 from NovoTralux webhook:** the two
  `NOVOTRALUX_WEBHOOK_API_KEY` values differ.
- **Webhook skipped warning in SL logs:** webhook base URL or key is missing.
- **502 while sending:** SL is not listening on port 3000 or the NovoTralux base
  URL is wrong.
- **Webhook 404:** `externalRequestId` is not the NovoTralux maintenance request
  ID, or the repositories point at unexpected databases.
- **Webhook 409:** `providerRequestId` differs from the SL request ID already
  stored in NovoTralux.
- **Missing tables/enums:** apply the pending Prisma migrations in both repos.
- **Duplicate SL rows despite HTTP idempotency:** verify the SL unique migration
  is applied and requests use the same `sourceCompany + externalRequestId`.

## Webhook reliability and manual retry

SL Automotive persists every outbound maintenance webhook attempt. In the
external maintenance queue, the latest attempt appears as **Synchronisé**,
**Échec synchro**, or **En attente**.

For a failed attempt, click **Réessayer synchro**, or call:

```bash
curl -i -X POST \
  "http://localhost:3000/api/garage/external-maintenance/webhook-deliveries/$DELIVERY_ID/retry"
```

Retry sends the exact stored payload and increments its attempt count. A
delivered row cannot be retried. NovoTralux's receiver remains idempotent, so a
retry of an already-applied status does not create duplicate status history.
There is still no automatic retry queue: failed delivery does not roll back the
SL Automotive business action and requires manual recovery.
