# API Documentation

## Overview

Base URL: `/api`

All authenticated endpoints require the header:

```
Authorization: Bearer <access_token>
```

**Common success response shape:** `{ success: true, data?: object, message?: string }`

**Common error response shape:**

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  },
  "timestamp": "ISO8601",
  "path": "/api/..."
}
```

Optional: `error.details` for validation errors (array of field/message).

---

## Core

### GET /api

Returns API info and list of endpoints. No authentication.

**Response:** `200` — `{ success, message, version, endpoints: { auth, profile, sessions, ... }, documentation }`

---

### GET /api/health

Health check. No authentication.

**Response:** `200` — `{ success: true, message: "API is healthy", timestamp, version: "1.0.0" }`

---

## Auth

Rate limits apply to auth endpoints (see Rate limiting below). All auth routes under `/api/auth`.

### POST /api/auth/register

Register a new user.

**Auth:** No  
**Rate limit:** Yes (auth)

**Request body:**

| Field    | Type   | Required | Validation                                      |
|----------|--------|----------|-------------------------------------------------|
| email    | string | Yes      | Valid email                                     |
| password | string | Yes      | Min 8 chars; uppercase, lowercase, number, special |

**Response:** `201` — `{ success, message, data: { user, token } }`  
**Errors:** `400` (validation), `409` (email exists)

---

### POST /api/auth/login

Login with email and password.

**Request body:** `{ email: string, password: string }`

**Response:** `200` — `{ success, message, data: { user, token } }`  
**Errors:** `400` (validation), `401` (invalid credentials)

---

### POST /api/auth/logout

Invalidate current token.

**Auth:** Yes (Bearer token in header)

**Response:** `200` — `{ success, message }`  
**Errors:** `400` (missing token), `401` (invalid token)

---

### GET /api/auth/me

Get current user info.

**Auth:** Yes

**Response:** `200` — `{ id, email, subscriptionTier, createdAt, updatedAt }`  
**Errors:** `401`

---

### POST /api/auth/refresh

Refresh JWT using refresh token.

**Request body:** `{ refreshToken: string }`

**Response:** `200` — `{ success, message, data: { token } }`  
**Errors:** `400`, `401`

---

### POST /api/auth/google

Login or register with Google ID token.

**Request body:** `{ idToken: string }`

**Response:** `200` — `{ success, message, data: { user, token } }`  
**Errors:** `400`, `401`

---

### POST /api/auth/forgot-password

Request password reset; sends OTP to email if user exists.

**Rate limit:** Yes (password reset)

**Request body:** `{ email: string }` (valid email)

**Response:** `200` — `{ success, message: "If an account exists..." }`  
**Errors:** `400` (validation)

---

### POST /api/auth/verify-otp

Verify OTP and receive reset token.

**Request body:** `{ email: string, otp: string }` — OTP 6 digits, numeric

**Response:** `200` — `{ success, message, resetToken }`  
**Errors:** `400`, `401`

---

### POST /api/auth/reset-password

Reset password using reset token.

**Request body:** `{ resetToken: string, newPassword: string }` — newPassword same rules as register

**Response:** `200` — `{ success, message }`  
**Errors:** `400`, `401`

---

### POST /api/auth/change-password

Change password (authenticated). Current password required.

**Auth:** Yes  
**Rate limit:** Yes (auth)

**Request body:** `{ currentPassword: string, newPassword: string }`

**Response:** `200` — `{ success, message }`  
**Errors:** `400`, `401`

---

### POST /api/auth/change-email

Change email (authenticated). Password required.

**Request body:** `{ newEmail: string, password: string }`

**Response:** `200` — `{ success, message, user }`  
**Errors:** `400`, `401`

---

### GET /api/auth/validate

Validate JWT. Returns minimal user if valid.

**Auth:** Yes

**Response:** `200` — `{ success, message, user: { id, email, subscriptionTier } }`  
**Errors:** `401`

---

## Profile

All profile routes require authentication and profile data isolation. Base path: `/api/profile`.

### GET /api/profile

Get current user profile.

**Response:** `200` — `{ success, data: profile }`  
Profile fields: id, userId, fullName, currentJobTitle, currentCompany, school, degreeInfo, previousJobTitles, targetIndustry, targetJobTitle, experienceLevel, extractedSkills, resumeS3Key, aiAttributes, createdAt, updatedAt.

**Errors:** `401`, `404` (no profile)

---

### PUT /api/profile

Update profile. At least one field required.

**Request body (all optional, max lengths in validation):**

- fullName, currentJobTitle, currentCompany, school, degreeInfo (strings)
- previousJobTitles (string[])
- targetIndustry, targetJobTitle, experienceLevel (strings)

**Response:** `200` — `{ success, data: profile, message }`  
**Errors:** `400` (validation), `401`, `404`

---

### POST /api/profile/manual-entry

Create/update profile via manual entry. `fullName` required.

**Request body:** Same shape as PUT /api/profile; fullName required.

**Response:** `200` — `{ success, data: profile, message }`  
**Errors:** `400` (e.g. missing fullName), `401`, `404`

---

### POST /api/profile/resume

Upload resume (PDF, DOC, DOCX). Max 10MB. Rate limited (upload).

**Content-Type:** `multipart/form-data`  
**Field:** `resume` (file)

**Response:** `200` — `{ success, data: { resumeS3Key, filename, size }, message }`  
**Errors:** `400` (no file / invalid type / size), `401`, `502` (processing failure)

---

### GET /api/profile/resume/url

Get presigned URL for resume file.

**Query:** `expiresIn` (optional) — seconds, 1–86400, default 3600

**Response:** `200` — `{ success, data: { url, expiresIn, expiresAt }, message }`  
**Errors:** `400` (invalid expiresIn), `401`, `404`

---

### PUT /api/profile/target-role

Set target industry and job title.

**Request body:** `{ targetIndustry: string, targetJobTitle: string }` (both required)

**Response:** `200` — `{ success, message }`  
**Errors:** `400`, `401`, `404`

---

### DELETE /api/profile

Delete user profile and resume from S3.

**Response:** `200` — `{ success, message }`  
**Errors:** `401`, `404`

---

### GET /api/profile/ai-attributes

Get AI-derived attributes for user.

**Response:** `200` — `{ success, data: attributes }`  
**Errors:** `401`, `404`

---

## Sessions

Audio session routes. Base path: `/api/sessions`. All except `POST /start` enforce session ownership. Session `id` must be a valid CUID (e.g. `c` + 24 hex chars).

### POST /api/sessions/start

Start a new audio session. Uses usage limits (subscription tier).

**Auth:** Yes  
**Rate limit:** AI processing

**Response:** `201` — `{ success, data: { sessionId, status, createdAt } }`  
**Errors:** `400`, `404` (USER_NOT_FOUND), `429` (USAGE_LIMIT_EXCEEDED), `500`

---

### POST /api/sessions/:id/audio

Upload audio for a session. Multipart: field `audio`. Audio types accepted (e.g. audio/mpeg, audio/wav). File size limit from config (e.g. 50MB).

**Auth:** Yes  
**Rate limit:** Upload  
**Params:** `id` — session CUID

**Response:** `200` — `{ success, message: "Audio uploaded successfully. Processing started.", data }`  
**Errors:** `400` (MISSING_AUDIO_FILE), `403` (SESSION_ACCESS_DENIED), `404` (SESSION_NOT_FOUND), `500`

---

### PATCH /api/sessions/:id/transcript

Update transcript and re-run AI analysis.

**Auth:** Yes  
**Rate limit:** AI processing  
**Params:** `id` — session CUID  
**Request body:** `{ transcript: string }` — length 1–50000

**Response:** `200` — `{ success, message, data: { id, status, transcript, aiAnalysis, scores, updatedAt } }`  
**Errors:** `400`, `403`, `404`, `500`

---

### PATCH /api/sessions/:id

Update session display name (event label).

**Params:** `id` — session CUID  
**Request body:** `{ displayName?: string }` — max 200 chars, optional or empty string

**Response:** `200` — `{ success, message, data: { id, displayName, updatedAt } }`  
**Errors:** `400`, `403`, `404`, `500`

---

### GET /api/sessions/:id

Get session details.

**Params:** `id` — session CUID

**Response:** `200` — `{ success, data: { id, displayName, status, transcript, aiAnalysis, scores, analysisComplete, processingError, createdAt, updatedAt } }`  
**Errors:** `403`, `404`, `500`

---

### GET /api/sessions/history

List session history for current user.

**Query:**

| Param  | Type   | Default   | Description                                      |
|--------|--------|-----------|--------------------------------------------------|
| limit  | number | 20        | 1–100                                            |
| offset | number | 0         | Optional                                         |
| status | string | completed | completed, processing, failed, pending, all     |

**Response:** `200` — `{ success, data: { sessions: [...], total, filter } }`  
Each session: id, displayName, status, scores, createdAt, updatedAt.  
**Errors:** `400` (INVALID_LIMIT, INVALID_STATUS), `500`

---

### GET /api/sessions/:id/audio-url

Get presigned URL for session audio (e.g. 1 hour).

**Params:** `id` — session CUID

**Response:** `200` — `{ success, data: { url, expiresIn: 3600, expiresAt } }`  
**Errors:** `403` (SESSION_ACCESS_DENIED, S3_ACCESS_DENIED), `404` (SESSION_NOT_FOUND, AUDIO_NOT_FOUND), `500`

---

## Subscription

Base path: `/api/subscription`. All routes require authentication and usage data isolation.

### GET /api/subscription/info

Get current subscription tier and usage.

**Response:** `200` — `{ success, data: { tier, currentUsage, limit, canCreateSession } }`  
**Errors:** `404` (USER_NOT_FOUND), `500`

---

### POST /api/subscription/upgrade

Upgrade subscription tier.

**Request body:** `{ tier: "FREE" | "PAID" }`

**Response:** `200` — `{ success, message, data: { tier } }`  
**Errors:** `400`, `404`, `500`

---

## Dashboard

Base path: `/api/dashboard`. All routes require authentication.

### GET /api/dashboard/stats

Dashboard statistics for current user.

**Response:** `200` — JSON stats object (structure from DashboardService).  
**Errors:** `401`, `500`

---

### GET /api/dashboard/insights

Recent insights from session patterns.

**Query:** `limit` (optional) — number, 1–50

**Response:** `200` — `{ success, data: insights }`  
**Errors:** `400`, `401`, `500`

---

### GET /api/dashboard/trends

Performance trends over time.

**Query:** `days` (optional) — number, 1–365

**Response:** `200` — `{ success, data: trends }`  
**Errors:** `400`, `401`, `500`

---

## Admin

Base path: `/api/admin`. Available only when `ENABLE_ADMIN_ENDPOINTS` is true. All admin routes require authentication and admin access (e.g. ADMIN_EMAILS / ADMIN_DOMAINS).

### GET /api/admin/health

System health plus error-handling status.

**Response:** `200` or `503` — `{ success, data: { status, ...systemStatus, errorHandling: { circuitBreakers, activeDegradations, pendingFileOperations, overallStatus } } }`  
**Errors:** `503` (HEALTH_CHECK_ERROR)

---

### GET /api/admin/metrics

Metrics and performance data.

**Query:** `limit` (optional) — default 10

**Response:** `200` — `{ success, data: { current, history, alerts, errorHandling, apiMetrics, timestamp } }`  
**Errors:** `500` (METRICS_ERROR)

---

### POST /api/admin/reset-usage

Reset monthly usage for all users (or dry run).

**Request body:** `{ month?: number (1–12), year?: number (2020–2030), dryRun?: boolean }` — default current month/year, dryRun false

**Response:** `200` — If dryRun: `{ success, message, data: { affectedUsers, totalSessions, users } }`. Otherwise `{ success, message, data: { affectedRecords, resetDate } }`  
**Errors:** `500` (USAGE_RESET_ERROR)

---

### GET /api/admin/users

User list and stats for admin.

**Query:** `page`, `limit` (1–100), `search`, `subscriptionTier` (FREE | PAID)

**Response:** `200` — `{ success, data: { users, pagination, ... } }`  
**Errors:** `500`

---

### GET /api/admin/system-config

System configuration (env presence only, no secrets).

**Response:** `200` — `{ success, data: { environment, version, database, openai, aws, security, features } }`  
**Errors:** `500` (CONFIG_ERROR)

---

### GET /api/admin/error-handling

Error-handling system status (circuit breakers, degradations, etc.).

**Response:** `200` — `{ success, data: status, timestamp }`  
**Errors:** `500` (ERROR_HANDLING_STATUS_ERROR)

---

### POST /api/admin/circuit-breaker/:serviceName/reset

Reset circuit breaker for a service.

**Params:** `serviceName` — string

**Response:** `200` — `{ success, message, timestamp }`  
**Errors:** `404` (NOT_FOUND), `500` (CIRCUIT_BREAKER_RESET_ERROR)

---

### POST /api/admin/degradation/:serviceName/deactivate

Deactivate graceful degradation for a service.

**Params:** `serviceName` — string

**Response:** `200` — `{ success, message, timestamp }`  
**Errors:** `500` (DEGRADATION_DEACTIVATION_ERROR)

---

### GET /api/admin/system-integration

System integration health check.

**Response:** `200` / `206` / `503` — `{ success, data: integrationReport, timestamp }`  
**Errors:** `500` (SYSTEM_INTEGRATION_ERROR)

---

### GET /api/admin/service-dependencies

Validate service dependency wiring.

**Response:** `200` or `500` — `{ success, data: { valid, issues, dependencies, serviceCount }, timestamp }`  
**Errors:** `500` (DEPENDENCY_VALIDATION_ERROR)

---

### POST /api/admin/test-request-flow

Test end-to-end request/response flow.

**Response:** `200` or `500` — `{ success, data: { overallSuccess, steps, totalDuration, successfulSteps, failedSteps }, timestamp }`  
**Errors:** `500` (REQUEST_FLOW_TEST_ERROR)

---

## Rate limiting

- **Auth:** Login, register, refresh, etc. — limited per window (e.g. 10 attempts per 15 min).
- **Password reset:** forgot-password, verify-otp — separate stricter limit.
- **Upload:** Resume upload, session audio upload.
- **AI processing:** Session start, transcript update (re-analysis).

Responses: `429` with `error.code: "RATE_LIMIT_EXCEEDED"`, optional `retryAfter` (seconds).

---

## Error codes (summary)

| Code                     | HTTP   | Description                    |
|--------------------------|--------|--------------------------------|
| VALIDATION_ERROR         | 400    | Request validation failed      |
| AUTHENTICATION_ERROR     | 401    | Invalid or missing token       |
| SESSION_ACCESS_DENIED    | 403    | Session not owned by user      |
| SESSION_NOT_FOUND        | 404    | Session not found              |
| USER_NOT_FOUND           | 404    | User not found                 |
| USAGE_LIMIT_EXCEEDED     | 429    | Subscription usage limit       |
| RATE_LIMIT_EXCEEDED      | 429    | Too many requests              |
| INTERNAL_ERROR           | 500    | Server error                   |

Additional domain-specific codes are documented per endpoint above.
