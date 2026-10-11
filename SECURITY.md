# Security policy

## Reporting a vulnerability

Open a private security advisory at https://github.com/nirholas/papertrade-x402/security/advisories/new, or contact the maintainer through the address in `/.well-known/security.txt`. Please do not file public issues for vulnerabilities.

## Scope and design

- This service never holds a private key and never signs or sends a transaction. It only returns payment requirements, forwards payments to the PayAI facilitator for verification, and settles after a successful response.
- `X402_SOLANA_PAY_TO` and `X402_BASE_PAY_TO` are public receive addresses read from the environment. Treat changes to them as sensitive: anyone who can edit them redirects revenue.
- All upstream strings are rendered with `textContent` on the landing page, and a strict CSP forbids inline script.
- The service is read-only against Papertrade. Calls that fail validation (400) or upstream (502) are not settled.
- Not affiliated with Papertrade. High leverage can lose your whole margin; nothing here is financial advice.
