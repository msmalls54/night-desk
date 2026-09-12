# Reviewer guide

**[Watch the 80-second phone demo](https://www.youtube.com/watch?v=1D13MW-iD_M)** · [View the presentation](https://drive.google.com/file/d/1JT6m-zExS88pWpNfdtetS9vlLt5U2QSi/view) · [See the order and receipts](../README.md#the-order-and-the-receipts)

Start with the conversation, then follow its result through the filled order and email. To run the code, use `npm test`, then `npm start` and the dashboard's approval rehearsal.

![Dashboard rules, Railway server, phone conversation, trade execution and saved receipt](assets/how-night-desk-acts.png)

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

The trigger uses Alpaca position P&L. Coinbase supplies short-term price and volume context; Kalshi supplies contract-implied odds and its own settlement benchmark. The owner uses those distinct inputs to choose an action. Holding remains available, and adding requires its own proposal and spending cap.

![The filled Bitcoin paper order](assets/bitcoin-filled-order.png)

The separate Wyoming test followed the verified missed-call path and closed the scoped demo position. The [full receipt screenshots](../README.md#the-order-and-the-receipts) show the explanations sent after both tests.

## Offline checks

Eleven suites cover signatures and duplicate events; exact approval/revision/expiry/replay; owned quantities and open orders; absent quotes for market reductions; distinct units and incomplete candles; scoped missed-call grants; ledger preservation; verified sports names; current fifteen-minute interval selection; source-backed search routing; and supplied phone context. All providers/models in these suites are injected or mocked, with an additional network blocker in the test runner.

## Execution behavior

- New clones do not inherit the creator's rules, holdings, calls, approvals or credentials. Execution defaults off.
- The synthetic dashboard rehearsal is separate from the actual provider flow in the recorded video.
- Automatic crypto reductions still use limit orders with configured price concessions; answered-call market reductions do not require a quote feed.
- General sports automation, SMS, multi-user accounts, arbitrary strategy compilation and real-money trading are outside this build.
- Sports mappings and the one-shot Wyoming worker are narrow event examples. New events require explicit verified mappings.
- The server enforces execution permission and quantities independently of the model's explanation.
- The initial spoken order outcome can be pending/unverified. The later broker readback and email distinguish submitted, filled, partial, rejected and unknown results.
- The application runs for one owner with one server replica and a persistent SQLite volume.

[Setup](../SETUP.md) · [Demo walkthrough](DEMO_WALKTHROUGH.md) · [Presentation sources](MEDIA.md)
