# Reviewer guide

**Start with `npm test`, then `npm start` and the dashboard's approval rehearsal.** No dependencies, provider accounts or credentials are needed for that path.

## Code tour

| Concern | File |
| --- | --- |
| HTTP server, owner checks, signed voice turn lifecycle | `src/server.mjs`, `src/webhook.mjs`, `src/access.mjs` |
| Configurable model and context/tool loop | `src/brain.mjs`, `src/web-search.mjs` |
| Exact proposal, changed/expired approval, durable submission claim | `src/position-actions.mjs` |
| Paper/demo preflight, market orders and provider reconciliation | `src/action-adapters.mjs` |
| Completed candles, exact intervals, freshness and correct units | `src/crypto-indicators.mjs` |
| Current fifteen-minute Bitcoin contract and implied odds | `src/crypto-market-context.mjs` |
| Written rules and versioned validated settings | `rules.md`, `src/user-settings.mjs`, `src/authority.mjs` |
| First verified unanswered call and cumulative reductions | `src/risk-calls.mjs`, `src/overnight.mjs` |
| Stored memory and plain-English outcome receipts | `src/store.mjs`, `src/memory.mjs`, `src/action-receipts.mjs` |
| Scoped sports test and verified game context | `src/sports-demo-worker.mjs`, `src/football-context.mjs` |

## Recorded demonstration

1. A real Bitcoin entry-loss rule had triggered; the final recording was a callback about that recorded alert.
2. The owner asked what Coinbase price moves and volume said about Bitcoin's direction.
3. The owner asked about the current fifteen-minute Kalshi BTC contract and its measurement-window end.
4. The owner requested a ten-percent Bitcoin market trim, heard the exact quantity, and approved it on the next turn.
5. One paper order filled. The backend reconciled it and the email provider accepted the written receipt.

That is a verified execution workflow, not evidence that the strategy predicts prices. Coinbase returns and Kalshi contract prices measure different things. Kalshi's current fifteen-minute interval may have only a few minutes remaining and uses its own benchmark. A loss below entry can coexist with positive short-term momentum. Holding is a valid outcome; absence of a trim signal is not an add signal.

## Offline checks

Eleven suites cover signatures and duplicate events; exact approval/revision/expiry/replay; owned quantities and open orders; absent quotes for market reductions; distinct units and incomplete candles; scoped missed-call grants; ledger preservation; verified sports names; current fifteen-minute interval selection; source-backed search routing; and supplied phone context. All providers/models in these suites are injected or mocked, with an additional network blocker in the test runner.

## Boundaries reviewers should see

- New clones do not inherit the creator's rules, holdings, calls, approvals or credentials. Execution defaults off.
- The synthetic dashboard rehearsal is separate from the actual provider flow in the recorded video.
- Automatic crypto reductions still use limit orders with configured price concessions; answered-call market reductions do not require a quote feed.
- General sports automation, SMS, multi-user accounts, arbitrary strategy compilation and real-money trading are outside this build.
- Sports mappings and the one-shot Wyoming worker are narrow event examples. New events require explicit verified mappings.
- A model can summarize evidence imperfectly. The server enforces execution permission and quantities; it does not prove investment merit.
- The initial spoken order outcome can be pending/unverified. The later broker readback and email distinguish submitted, filled, partial, rejected and unknown results.
- One SQLite volume and one owner are intentional limits. This is a hackathon application, not a production brokerage service.

The creator handles the video and event submission separately. A public repository is not a submission receipt.
