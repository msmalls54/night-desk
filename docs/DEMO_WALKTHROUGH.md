# Two-minute walkthrough

Use the existing recording and one Bitcoin rule. No additional rules are needed.

1. **Rule (about 15 seconds).** Open the connected Night Desk dashboard, then **Rules and preferences**. Show the **BTCUSD** row: **Loss percent: 0.1**, **Missed-call reduction: 10**. Say: "I set one Bitcoin protection rule: call me when my paper position falls 0.1 percent below entry. If I answer, I can discuss the evidence and approve a specific action."
2. **Conversation (about 75 seconds).** Show the recorded call. Ask: "What do Coinbase's price moves and trading volume say about Bitcoin's direction?" Then: "What are the odds on Kalshi's current fifteen-minute Bitcoin market, and when does it settle?" The recording then shows a ten-percent market trim request, exact readback and separate approval.
3. **Result (about 20 seconds).** Show the filled Bitcoin sell in the Alpaca paper account. Match the quantity and order to the receipt.
4. **Receipt (about 10 seconds).** Show the email explaining what was executed and why.

## Where the trigger came from

The saved rule compares **Alpaca paper unrealized percentage P&L** with **-0.1%**. The alert record from September 12, 2026 at **2:25:28 PM Pacific** records **-0.108%**, so it met the rule. Coinbase candle indicators and Kalshi odds supply discussion context; neither was the trigger for this example.

The successful final recording was a callback about that recorded alert. The approved paper order filled at **2:43 PM Pacific**. Do not describe the callback as a second newly detected breach. The live dashboard's latest price may differ from the saved alert.

The creator's connected dashboard already holds this example. A fresh public clone has blank thresholds and execution off; it does not inherit private settings or provider records. The screenshot walkthrough should use the connected dashboard, not the synthetic approval rehearsal.
