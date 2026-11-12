# Project Memory

## Working instructions

- Read this file at the start of project work and update it with technical findings, changes, decisions, and verification results. Do not record routine conversation history.
- Keep all memory entries and session-compression summaries in English. Respond to the user in Vietnamese.
- This repository has a `.codegraph/` index. Use CodeGraph before searching or reading indexed source to locate code, understand behavior, or assess an edit. Use filesystem reads for documentation, configuration, source omitted by the graph, and files without indexed symbols.
- Follow `open-sse/AGENTS.md` when working on the engine and `tests/translator/AGENTS.md` when working on translator tests.

## 2026-11-12: Initial project reconnaissance

### Scope and workspace state

- Request: read and understand the project. Completed an initial architecture and workflow survey; this was not an exhaustive code audit or runtime validation.
- Workspace: `F:\Code\9router`, Windows PowerShell. Node.js `v22.23.4` and npm `10.9.9` were available; `.nvmrc` also specifies `22.23.4`.
- No root `MEMORY.md` or `AGENTS.md` existed at the start. This file was created to persist the technical survey under the user-provided working instructions.
- Git status was clean before this documentation change. Existing directories included `node_modules`, `.next`, and `.next-cli-build`; their presence does not establish that the current source builds successfully.
- Root `.env` and the `cloud/` source directory were absent. The local Vitest executable at `tests/node_modules/vitest/vitest.mjs` was present.
- File inventory counted 1,100 JavaScript-family files under `src`, `open-sse`, and `cli/src`, and 443 `*.test.js` files under `tests`. These are file counts, not executed test-case counts.

### Product and packages

- 9Router is a local AI gateway with a web dashboard. It presents compatibility APIs to coding tools and SDKs, then routes requests to upstream providers with format conversion, model/account fallback, credential refresh, quota tracking, and token-saving features.
- Root package: private `9router-app`, version `0.5.116`. Declared stack: Next.js `^16.4.2`, React/React DOM `19.2.4`, Tailwind CSS 4, JavaScript with ESM imports and JSX. Some server/launcher files use CommonJS.
- Import aliases in `jsconfig.json`: `@/*` maps to `src/*`; `open-sse/*` maps to the sibling engine directory.
- `cli/` is a separate npm package named `9router`, also version `0.5.116` in this snapshot. It launches the bundled standalone app, manages process/tray lifecycle and runtime dependencies, and configures local tools or connects them to a remote server. Its package declares Node >=18; that declaration is not proof that every current dependency supports Node 18.
- `gitbook/` is a separate Next.js documentation site, with development on port 3001 and a Cloudflare Pages deployment script.

### Directory responsibilities

| Area | Responsibility |
| --- | --- |
| `src/app/api/v1`, `src/app/api/v1beta` | OpenAI, Anthropic, Responses, Gemini, and modality compatibility routes |
| `src/app/(dashboard)/dashboard` | Providers, combos, endpoints, CLI tools, basic chat, quota, usage, logs, media, token savers, translator, proxies, MITM, skills, and profile UI |
| `src/sse` | Application glue: settings, key access, model resolution, account selection, refresh, and handler orchestration |
| `open-sse` | Provider registry, models/capabilities, executors, translators, streaming/JSON handlers, token compression, and provider services |
| `src/lib/db` | SQLite adapters, migrations, entity repositories, usage, request details, and import/export |
| `src/lib/auth`, `src/dashboardGuard.js`, `src/proxy.js` | Dashboard sessions, access gates, login limiting, SSO, and account-login proxy handling |
| `src/lib/oauth`, `src/lib/mcp`, `src/lib/tunnel`, `src/mitm` | Provider authentication and host/tool integration services |
| `src/shared` | UI components, constants, utilities, and runtime initialization services |
| `cli`, `scripts`, `.github/workflows` | Launcher packaging, standalone asset handling, portable releases, Docker publishing, docs publishing, and tray binaries |
| `tests` | Independent Vitest package with unit, translator, golden/snapshot, baseline, and live-provider tests |

### Main chat request lifecycle

1. `next.config.mjs` rewrites `/v1/*` to `/api/v1/*`; it also handles `/v1beta/*`, `/responses`, `/codex/*`, and compatibility aliases.
2. `src/app/api/v1/chat/completions/route.js` initializes translators and calls `src/sse/handlers/chat.js::handleChat`. Other compatibility routes also enter shared chat handling.
3. The app handler parses JSON, normalizes the model/context marker and gateway aliases, reads settings, validates keys when required, enforces per-key target access, and bypasses appropriate warmup/naming requests.
4. Model targets resolve to provider/model pairs, stored model aliases, user-defined compatible provider nodes, or combos. Built-in provider prefixes are reserved against custom-node collisions.
5. Combos support configured fallback/rotation, smart session-aware routing, capability-based ordering, and fusion orchestration. `handleComboChat` checks for usable SSE/JSON output before committing to a candidate and can advance after empty or request-specific failures.
6. Single-model handling loops over eligible provider accounts, respects per-model account overrides, refreshes expiring credentials, and calls `open-sse/handlers/chatCore.js` with settings and persistence callbacks.
7. `chatCore` detects the source format, chooses a supported upstream transport, applies reasoning/model overrides, handles native passthrough or translation, normalizes tools/media, and runs enabled token savers.
8. `getExecutor(provider)` selects a specialized executor or a cached `DefaultExecutor`. The executor sends the upstream request. On 401/403, applicable providers get credential-refresh attempts and a retry; rotating refresh tokens are updated between attempts.
9. Response handling chooses native JSON, forced SSE-to-JSON aggregation, or streaming conversion back to the client's format. Usage, latency, errors, and request details feed the database repositories.

### Engine conventions and behavior

- Provider definitions live under `open-sse/providers/registry`; model metadata and runtime constants live under `open-sse/config`.
- Translators register request/response functions by format pair. The pipeline can pivot through OpenAI, use a direct registered pair, or preserve a native provider/client format. Direct routes avoid information loss in fragile format pairs.
- Current `open-sse/translator/index.js` uses static side-effect imports; `initTranslators` is retained as a compatibility entry point. New translators must be imported into that registry entry.
- Special upstream protocols such as Kiro EventStream, Cursor protobuf, and CommandCode NDJSON belong in specialized executors.
- RTK compresses tool results before translation for Cursor because its translator changes their structure; other providers use the final-body pass. Headroom is an optional external compression service. Caveman, Ponytail, custom prompts, and PXPIPE are additional optional transformations.
- RTK/Headroom conventions require compression failures to leave requests usable. Use configuration/schema constants rather than introducing hardcoded models, role names, or block types.
- The registry import list is generated; follow the existing registry-generation workflow when adding providers rather than editing that list by hand.

### Persistence confirmed from current source

- `src/lib/localDb.js` and `src/lib/usageDb.js` are compatibility re-export shims into `src/lib/db/index.js`. Both configuration and usage/request-detail APIs now use SQLite.
- Database path: `<DATA_DIR>/db/data.sqlite`; backups: `<DATA_DIR>/db/backups`. Old JSON paths remain listed for migration.
- `src/lib/dataDir.js` resolves `DATA_DIR`; defaults are `%APPDATA%\9router` on Windows and `~/.9router` elsewhere. Unix-style absolute paths configured on Windows fall back to the Windows default; permission failures can also trigger fallback.
- Driver order depends on runtime: Bun uses `bun:sqlite` then `sql.js`; Node uses `better-sqlite3`, then supported `node:sqlite`, then `sql.js`. Native `better-sqlite3` is skipped on Node >=24. Adapter initialization is kept globally across development reloads.
- Database bound strings pass through a shared NUL-byte sanitizer. Migrations run during adapter initialization.
- Repositories cover settings, provider connections/nodes, proxy pools, keys, combos, aliases/custom models, pricing, disabled/deleted models, model overrides, usage/logs, and request details.

### Access and runtime boundaries

- `custom-server.js` wraps the Next HTTP server, derives peer IP information from the TCP socket, sanitizes incoming internal/forwarded headers, stamps a per-process peer token, and trusts forwarding headers only from a loopback proxy. It also starts background token refresh when its source module is available.
- `src/dashboardGuard.js` gates management APIs and host-sensitive routes. Remote LLM API access requires a valid API key or trusted local CLI token even when handler-level `requireApiKey` is disabled; local requests have a separate path.
- Dashboard sessions use signed 24-hour JWT cookies and bcrypt password comparison. JWT secrets come from the environment or a generated persisted secret. The login route includes rate limiting, SSO modes, tunnel access checks, and refusal to issue remote sessions using an unconfigured default password.
- `src/proxy.js` delegates normal access checking to the dashboard guard and also handles authenticated MiMo account-login proxy sessions.
- `src/shared/services/initializeApp.js` defers heavier startup work, restores configured tunnel/Tailscale/MITM services, starts optional quota pings and background refresh, and manages tunnel recovery/cleanup.
- The remote cloud service implementation is outside this checkout; local sync integration is described in project documentation.

### Development, testing, and packaging workflows

- Root `npm run dev` uses port **20127**. `npm run dev:webpack` explicitly selects webpack on that port. Root `npm run start` also passes port **20127** to `custom-server.js`.
- CLI examples and Docker use port **20128**. Setting `PORT` alone should not be treated as overriding explicit `--port 20127` in root scripts; use an explicit custom-port invocation when needed.
- Build: `npm run build` runs `next build --webpack`; its postbuild script copies standalone assets. `next.config.mjs` uses standalone output and explicitly preserves runtime/native dependencies outside the bundle.
- Bun variants exist as `dev:bun`, `build:bun`, and `start:bun`.
- Tests are a separate package: install root dependencies, then `npm --prefix tests install`. Current `tests/package.json` defines `test` as `vitest run --reporter=verbose`; root package has no test script.
- From the repository root, the existing local runner can be invoked as `node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js tests/unit/<name>.test.js`. The config supplies `@/` and `open-sse` aliases and a Node environment.
- Translator guidance requires importing `tests/translator/registerAll.js`. Live-provider tests have separate credentials/network requirements; do not infer current test health from stored results or historical documentation.
- Regression helpers exist in `tests/__baseline__`: provider, alias, OAuth URL checks, and `verify-no-regression.mjs <current-results.json>`. The latter currently extracts file identities by splitting on `/app/`, so path compatibility needs review when using Windows result files.
- Lint uses ESLint 9 with Next core web vitals (`eslint.config.mjs`); select changed files for targeted checks.
- Root CLI packaging commands are `npm run cli:pack` and `npm run cli:publish`; launcher scripts build and package the standalone app separately.
- Docker is a multi-stage Node 22.23.4 Alpine build using `custom-server.js`, persistent `/app/data`, required traced/lazy dependencies, and runtime user switching. Compose also defines a Headroom service.
- `.github/workflows/build.yml` builds and packages a portable Windows release, checks required runtime files, and smoke-tests the packaged product. Other workflows cover Docker, the docs site, and tray binaries.
- Commands in this workflow section were identified by inspection; build, install, lint, tests, server startup, publishing, and deployment were not executed during this survey.

### Documentation discrepancies

- `docs/ARCHITECTURE.md` is dated 2026-02-06 and describes `db.json` plus separate usage JSON storage. Current source uses SQLite for both.
- `CLAUDE.md` recognizes SQLite for primary state but still says usage/logging remain separate JSON files and describes an obsolete Unix-specific test script. `tests/translator/AGENTS.md` still describes lazy `require` initialization, while the current translator registry uses static imports. Use current shims, package scripts, and translator source as the authority for those details.
- Historical pass/fail totals and entries in `known-fails.txt` are context only; no fresh suite result was obtained.

### Change and verification record

- Read project documentation/configuration and explored indexed source via CodeGraph, including request entry points, model/account/combo routing, chat execution, translation/executor registries, persistence, authentication/access gates, launcher, initialization, and regression workflow.
- Used targeted filesystem reads for source portions omitted by CodeGraph and re-export-only shims that were not returned as indexed symbols.
- Created only this English technical memory file; application source and configuration were not changed.
- Verification: `git diff --check` completed successfully; a direct content check found no trailing whitespace or non-ASCII characters and confirmed a final newline. Git status showed only `?? MEMORY.md`. No runtime correctness claim is made.

## 2026-11-12: AgentRouter Codex proxy analysis

### Reference, scope, and method

- Analyzed `https://github.com/fogydes/agentrouter-codex-proxy` at commit `58ea3133be113474880284e17631cb2451d640f4`, the remote `main` HEAD when cloned.
- Queried GitHub repository metadata and remote HEAD, then shallow-cloned into the ignored directory `F:\Code\9router\.scratch\agentrouter-codex-proxy`. The reference had no `.codegraph`, `AGENTS.md`, or `MEMORY.md`; it was not indexed. Used `rg` and numbered source reads there.
- Read the README, pinned requirements, environment template, all functional proxy areas, supervisor/updater code, launch/autostart scripts, and tests. The README's claimed Azure deployment/load-balancing explanation was not independently verified against the live upstream.
- Used the existing 9Router CodeGraph index to compare its Responses route, `emptyFailover.js`, and `stripContinuityFields` with the reference mechanisms.
- The project's FastAPI app reports version 1.5.0. It is a local Responses compatibility shim with Python/FastAPI/HTTPX, not a multi-provider orchestration layer. Default binding is loopback port 8788.

### Architecture and useful mechanisms

- `proxy.py` handles dedicated Responses routes, generic passthrough, header filtering/environment fallback auth, shared HTTPX connections, image pruning, HTTP/SSE error detection, stateless recovery, cooldown/stagger, health/stats, and DNS/socket/Proactor hooks.
- A request is initially forwarded with its existing state references. Recognized resource/state errors activate sanitization that deletes previous-response pointers and item IDs, drops reasoning/reference items, preserves tool `call_id`, and prunes historical images.
- Pre-commit SSE priming can catch early errors inside HTTP 200 and retry before client headers are committed. Setup frames use a default 3-second grace; idle committed streams emit 15-second ping comments.
- `service.py` supervises a headless worker, rotates logs, and restarts for updates. `updater.py` uses tracked upstreams, clean tracked-worktree checks, fast-forward merges, syntax checks/rollback, and dependency synchronization. PowerShell scripts provide foreground/background launch and at-logon scheduled tasks.

### Reproduced findings

| Finding | Evidence and implication |
| --- | --- |
| Incremental history is not reconstructed | Sanitizer at `proxy.py:654` deletes `previous_response_id` and drops references without retrieving their contents. A scripted mismatch recovery made two POSTs and zero history GETs; the retry retained only one new user message. Complete-history retention depends on complete input already arriving from the client. |
| Retry-After is capped | `proxy.py:533` caps explicit hints at the default 15-second maximum. An upstream hint of 120 seconds became a 15-second wait and returned hint, causing retries before the requested reset. |
| SSE queue is unbounded | `proxy.py:982` creates an unlimited queue. Before downstream consumption, the scripted producer finished with 1,001 queued entries and approximately 4.1 MB of payload. This proves missing backpressure, not a production memory-leak measurement. |
| Dependency failure still activates an update | `updater.py:289` records failed pip installation but returns updated/applied/restart flags. Mocked failure reproduced `applied=true`, `restart_required=true`, `deps_synced=false`; `service.py:373` stops its child on applied updates. No real update/reset or failing package installation was performed. |
| JSON error is labeled SSE | `proxy.py:1288` preserves upstream SSE content-type on a JSONResponse. Five scripted mismatch streams ended in HTTP 400 with JSON bytes and `text/event-stream`. |
| Responses query parameters are dropped | Dedicated send at `proxy.py:1244` omits request query params. A request carrying Azure-style `api-version` reached the mock upstream without the query. Generic passthrough separately forwards query params. |
| Non-object JSON crashes validation | A non-empty JSON array reaches `.get` at `proxy.py:1175`, returning HTTP 500 with no upstream calls; object validation should reject it as invalid input. |

### Additional source observations and integration assessment

- Cooldown/stagger state is global to a process rather than partitioned by key/model; different workers have independent state, and successful requests clear the shared cooldown. Integration into 9Router needs account/model scoping.
- Priming cannot recover after stream commit. Setup grace can add initial delivery delay, and successful-recovery metrics are incremented at commit rather than completion.
- Generic passthrough uses non-streaming upstream reads, so it buffers other SSE endpoints instead of providing general streaming proxy behavior.
- DNS fallback is limited to two AgentRouter names, with static IPs/cached records and no TTL policy. Normal HTTPX TLS verification remains enabled. Global socket/DNS patches and a private CPython Proactor hook add runtime coupling.
- Explicit non-loopback binding has no inbound application authentication; environment fallback keys can be used by reachable clients. Loopback is the default, and this deployment limitation is documented upstream.
- The checkout contains no LICENSE file and GitHub reports no detected license; source reuse terms are not established.
- For 9Router, extend existing upstream Responses SSE error inspection and replay facilities instead of adding another server layer. Preserve original native requests; apply resource recovery only with complete/reconstructed history; retain tool correlations; honor true reset deadlines and scope retry state to credentials/models.
- Existing 9Router `emptyFailover.js` checks usable client-format text/tool content with deadline/replay/cancellation handling. `stripContinuityFields` cleans encrypted fields from translated messages and is a different mechanism from deleting Responses history pointers.

### Validation, artifacts, and changes

- Created a Python 3.11.9 virtual environment inside the ignored reference clone and installed the pinned FastAPI 0.115.6, Starlette 0.41.3, Uvicorn 0.34.0, and HTTPX 0.28.1 requirements.
- Ran `python -m unittest discover -s tests -v`: all 14 upstream tests passed in 6.966 seconds on Windows, including local Proactor/bind tests. `pip check` reported no broken requirements.
- Created and executed `F:\Code\9router\.scratch\analyze-agentrouter.py`; all seven additional scripted edge-case observations reproduced. Results are in `.scratch\agentrouter-edge-cases.json`; the original suite log is `.scratch\agentrouter-upstream-tests.log`.
- Provider traffic was mocked. Temporary listeners and temporary local Git repositories were used by the upstream tests; no live AgentRouter request, real credential, scheduled-task installation, persistent service setup, or auto-update of the reference checkout was performed. The temporary CLI bind test had an unreachable loopback upstream and no fallback key.
- Detailed English report: `F:\Code\9router\.scratch\agentrouter-codex-proxy-analysis.md`. It includes commit-pinned source links, implications, suggested repairs, and a comparison with 9Router.
- The reference checkout remained clean at the analyzed commit. 9Router application/configuration files and the user's Codex configuration were not modified; project-visible change remains this memory file, with reference/report/reproduction artifacts under ignored `.scratch`.
- Final verification: `git diff --check` succeeded; memory, report, and reproduction-script formatting checks passed; the observation JSON confirmed seven reproduced cases; root status remained `?? MEMORY.md` and the reference checkout had no tracked changes.

## 2026-11-13: Responses/SSE backend-resource recovery integration

### Problem and confirmed runtime behavior

- Added recovery for OpenAI Responses requests that fail after AgentRouter/Azure switches the backing OpenAI resource. The observed upstream error was HTTP 400: `The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it.`
- Official OpenAI conversation-state guidance confirms that `previous_response_id` chains response state and that an unavailable previous response must be replaced by `previous_response_id: null` plus full input context. It also recommends preserving all prior output items for stateless reasoning requests: `https://developers.openai.com/api/docs/guides/conversation-state`.
- The production CLI artifact built at 23:12 contained the original recovery code. The running process used `F:\DEV\node22\node_modules\9router\app\.next-cli-build`, so the failure was not caused by accidentally running the pre-feature package.
- Runtime console evidence showed Codex requests already replaying large visible transcripts (44 to more than 200 input items), but a reproduced cross-resource request logged `Backend state mismatch; complete replay history is unavailable, preserving the upstream error` and returned the original 400.
- A small live sequence against `agr/gpt-5.6-sol` reproduced the resource mismatch using a prior AgentRouter response ID. This established that detection worked but the recovery body was rejected when the in-memory parent snapshot was unavailable.
- OpenAI-compatible gateways can also return a bare JSON error while retaining `Content-Type: text/event-stream`; the initial inspector only used the SSE parser in that case and could miss the error completely.

### Implementation

- Added `open-sse/config/responsesRecovery.js` with centralized state fields, encrypted fields, backend-change error patterns, recognized Responses failure codes, setup events, tool-call/output relationships, and SSE framing constants.
- Added bounded, API-key-scoped response history in `open-sse/services/responsesHistory.js`:
  - captures successful JSON and SSE Responses output without teeing or eagerly draining the stream;
  - stores serialized LRU-like snapshots under a global symbol for development reload reuse;
  - enforces TTL, entry count, item count, per-entry byte, and total byte limits;
  - reconstructs `previous_response_id` ancestry and resolves known `item_reference` values;
  - preserves messages, media/file blocks, assistant `phase`, and correlated tool calls while retaining only reasoning item identity rather than encrypted/hidden reasoning payloads.
- Added `open-sse/services/responsesRecovery.js`:
  - inspects HTTP 400/404 bodies and pre-commit Responses SSE frames;
  - retries exactly once only for narrowly matched backend/resource state errors;
  - reconstructs a stateless input, removes stale response/item IDs and encrypted continuity fields, drops reasoning items, and validates tool call/output correlation;
  - replays unread upstream bytes on timeout/byte-cap paths and propagates cancellation through a single pull-driven reader;
  - now accumulates original response bytes even for SSE-labeled responses and falls back to JSON/plain-text error inspection when no SSE frame commits the stream.
- Updated `open-sse/handlers/chatCore.js` to create source-format history contexts before translation, execute the upstream call through the recovery layer before response commitment, and observe the final client-format response for future recovery. Updated `src/sse/handlers/chat.js` and schema/config helpers required by this flow.
- Added a conservative self-contained replay path in `materializeResponsesHistory`: when a cached parent is missing, a client transcript is accepted only if it contains a prior assistant/tool-call output followed by a new user/tool-result item. A lone new message, unresolved item references, and conversation-object state remain fail-closed.
- Added `tests/unit/responses-recovery.test.js` covering strict activation, full-history and tool/media preservation, item references, API-key isolation, single-retry behavior, incomplete-history refusal, SSE fragmentation/replay/cancellation, bounded snapshots, self-contained replay after restart, and bare JSON errors mislabeled as SSE.

### Verification and artifacts

- `node --check` passed for `responsesRecovery.js`, `responsesHistory.js`, and `chatCore.js` during implementation.
- `tests/unit/responses-recovery.test.js` passes 38/38 tests after the follow-up fixes.
- `git diff --check` passed; Git only reported the existing LF-to-CRLF warning for `open-sse/utils/responsesStreamHelpers.js`.
- `npm --prefix cli run build` completed successfully and produced the packaged standalone application. Build-time `better-sqlite3` binding warnings fell back to `node:sqlite`; the skipped temporary Devin trace and missing Windows `du` command were non-fatal.
- End-to-end verification ran the new packaged app temporarily on port 3000 against the configured live AgentRouter node. A request containing a stale `previous_response_id` and foreign item ID first triggered the backend mismatch, logged `Verified backend state mismatch; retrying once with preserved message/tool history`, then returned HTTP 200. The temporary server was stopped afterward.
- Correct install artifact: `F:\Code\9router\9router-0.5.116.tgz`, SHA-256 `48074CB7D56B87FBB1112E9598A075F86FEAF5026EF4BD3E5DF458B6DF7DE78B`. An accidentally packed root-app tarball was deleted before creating this CLI package.
- The currently running port-20128 process was intentionally not restarted during the active Codex turn because that same process carried the conversation. Installing the tarball and restarting 9Router are still required for the live 20128 instance to use the final follow-up patch.

## 2026-11-13: Exact-request retry for regional token-rate-limit errors

### Diagnosis

- Implemented special handling for the dynamic upstream message `Your requests to <model> for <model> in <region> have exceeded token rate limit.` The regex requires the same model identifier on both sides of `for` and captures both the model and region for diagnostics.
- No working message-specific retry implementation existed in the source. The closest existing paths were insufficient:
  - `BaseExecutor.execute` retried only by numeric HTTP status before reading the response body; the default 429 retry count is zero.
  - Provider-specific `computeRetryDelay` hooks can consume `Retry-After`, contrary to this error family's required fixed schedule.
  - An error delivered inside an HTTP-200 SSE stream bypassed status retry completely and reached the streaming handler, where the response could be committed to the client.
  - Responses backend-resource recovery intentionally excludes throttling and mutates stale state for a different error family, so extending it would have stacked unrelated retry semantics.

### Implementation

- Added `TOKEN_RATE_LIMIT_ERROR_PATTERN` and the recognized pre-commit SSE setup events to `open-sse/config/errorConfig.js`.
- Added fixed `TOKEN_RATE_LIMIT_RETRY_CONFIG` to `open-sse/config/runtimeConfig.js`: five retry attempts, linear `attempt * 5000ms` delays, first-chunk timeout as the inspection deadline, and a 256 KiB inspection cap.
- Added `open-sse/services/tokenRateLimitRetry.js` as the single middleware for this error family:
  - detects standard non-2xx JSON/plain-text error bodies without consuming the original response by inspecting a clone;
  - incrementally parses fragmented SSE frames, holds only setup frames before commitment, detects HTTP-200 error events, and reconstructs the original byte stream when no match is found;
  - accepts error-shaped SSE payloads only, preventing an assistant response that merely quotes the sentence from triggering retries;
  - preserves a mid-body socket/read failure by replaying buffered bytes plus the original rejected read rather than converting it into a fetch retry;
  - suppresses a matched attempt, ignores `Retry-After`, waits 5/10/15/20/25 seconds with abort support, and returns the final original error only after all five retries fail;
  - logs an ISO timestamp, exact endpoint, matched model/region, attempt `X/5`, backoff milliseconds, exhaustion state, and the complete parsed upstream error message including trace metadata when available.
- Integrated the middleware into `BaseExecutor.execute` before generic status retry/fallback. The executor serializes and transforms the request once per selected URL, then every special retry reuses the exact URL (including query parameters), the same headers object, the same body string, the same direct transport, and the same proxy selection. Only the per-attempt connect-timeout signal is recreated.
- A final matched failure bypasses the generic retry hook and base-URL fallback, preventing extra requests, `Retry-After` handling, or endpoint changes after the five exact retries.

### Tests and validation

- Added `tests/unit/token-rate-limit-retry.test.js` covering:
  - dynamic model/region captures and rejection when the repeated model differs;
  - standard HTTP 400 error bodies;
  - fragmented HTTP-200 SSE error events;
  - false-positive prevention for assistant output quoting the same sentence;
  - exact URL/query/header/body/context reuse across all retries, including reasoning blocks, tool calls/results, and an assistant trailing message;
  - ignored `Retry-After`, the exact 5/10/15/20/25-second schedule, structured logs, successful retry suppression, and final propagation after five retries without fallback to another endpoint.
- Targeted regression run passed 91/91 tests across the new middleware, BaseExecutor status/network behavior, read-phase `ECONNRESET`, stale keep-alive handling, Antigravity retry hooks, Responses recovery, and compatible-provider API-type routing.
- `node --check` passed for the new service and modified executor. Targeted ESLint completed with no findings. `git diff --check` passed with only the pre-existing LF-to-CRLF warning for `open-sse/utils/responsesStreamHelpers.js`.
- A root `.next` production build became stuck in webpack retry activity and was stopped after sustained CPU/memory use without artifact progress. The actual CLI production workflow `npm --prefix cli run build` subsequently compiled successfully and completed standalone packaging; build-time `better-sqlite3` fallback, one external temporary Devin trace, and missing Windows `du` were non-fatal warnings.
- The user ran `deploy.bat` successfully. Read-only verification found the new middleware string in `F:\DEV\node22\node_modules\9router\app\.next-cli-build\server\chunks\3791.js`; the tray and server processes restarted at 2026-11-13 01:45:50 local time on port 20128.

## 2026-11-13: Feature push and upstream 0.5.119 merge

### Git workflow

- The repository uses `master`, not `main`, as the default branch on both remotes. `origin` is `https://github.com/bonelag/9router`; `decolua` is `https://github.com/decolua/9router.git`.
- Committed the Responses recovery and regional token-rate-limit work as `62769aef` (`feat: recover responses state and retry regional throttling`), fast-forwarded local `master`, and pushed it to `origin/master` before starting the upstream merge as requested.
- Fetched upstream `decolua/master` at `1855aa44` (`v0.5.119`), advancing from the previously known `1339107e` (`v0.5.116`).

### Conflict resolution

- Merged `decolua/master` into the fork and resolved five content conflicts:
  - `open-sse/providers/capabilities.js`: kept the complete upstream NVIDIA capability table and its explicit tools/thinking-disable metadata; restored upstream `qwq` non-disableable thinking and the specific Grok 4.6/4.5 limits instead of the older broad fork pattern.
  - `src/app/(dashboard)/dashboard/providers/components/ModelsCard.js`: retained fork model enable/disable toggles and combined them with upstream Qoder display-name normalization.
  - `src/app/api/providers/[id]/models/route.js`: retained fork custom-header/proxy-aware compatible-provider discovery and no-auth OpenCode catalog, while keeping upstream CommandCode discovery and Claude OAuth live catalog changes.
  - `src/app/api/v1/models/route.js`: retained fork client response adaptation, compatible-provider custom fetch, deleted/disabled/override handling, and added upstream thinking-level publication.
  - `src/shared/components/ModelSelectModal.js`: removed the duplicate local no-auth constant and used upstream `selectableModels.NO_AUTH_PROVIDER_IDS`, which correctly covers all no-auth AI providers rather than only the free-provider category.
- No conflict markers or unmerged index entries remained after resolution.

### Merge verification

- Targeted post-merge Vitest coverage passed 165/165 tests across Responses recovery, exact-request retry, BaseExecutor network behavior, capabilities/combo aggregation, provider custom models, no-auth model selection, Qoder/CommandCode live catalogs, NVIDIA metadata, Grok context limits, and `/v1/models` thinking levels.
- `node --test tests/unit/nvidia-params.test.js` passed 6/6 tests. Its package-type warning is non-fatal.
- Server-side conflict files and the retry middleware passed syntax checks. Targeted ESLint found no server-side merge issues; `ModelSelectModal` and `ModelsCard` still trigger the repository's existing React `setState-in-effect` rules, unrelated to the merge resolution.
- `npm --prefix cli run build` completed successfully at version `0.5.119`, including Next.js compilation, static generation, standalone artifact copying, SQLite fallback packaging, and MITM bundling. The external temporary Devin trace, unavailable build-time `better-sqlite3` binding, and missing Windows `du` utility remained non-fatal warnings.
- Created merge commit `7bfa709f` (`Merge remote-tracking branch 'decolua/master'`) and pushed the resolved 0.5.119 merge to `origin/master`.
