# Cleanup spike results (samples-heldout.json)

Run 2026-10-18T13:54:54.651Z, Apple M1 Max 64 GB, Ollama 0.40.6 (spike-local), 3 warm runs per sample, temperature 0, think off where supported.

| Model | Median latency (ms) | p90 (ms) | sv median | en median | Cold first call (ms) | Loaded size | Pass (strict) | Mean WER vs ref |
|---|---|---|---|---|---|---|---|---|
| rules (naive regex) | 0 | 7 | 0 | 0 | – | – | 3/10 | 21.7% |
| qwen3.5:2b-q4_K_M | 192 | 376 | 219 | 157 | 3239 | 1.60 GB | 6/10 | 18.4% |
| qwen3:1.7b | 175 | 230 | 197 | 150 | 2430 | 1.21 GB | 5/10 | 17.8% |
| gemma3:1b | 156 | 275 | 182 | 135 | 1838 | 0.88 GB | 2/10 | 79.1% |
| qwen3:4b-instruct-2507-q4_K_M | 304 | 438 | 360 | 245 | 4302 | 2.88 GB | 8/10 | 9.5% |
| gemma3:4b | 317 | 689 | 321 | 284 | 4851 | 2.33 GB | 6/10 | 15.3% |
| gemma4:e2b-it-qat | 230 | 432 | 245 | 204 | 4084 | 0.23 GB | 7/10 | 10.2% |

Pass (strict) = every must-include term present verbatim (case-sensitive) and no retracted phrase or filler left. WER is word-level vs my reference after lowercasing and stripping punctuation.

## rules (naive regex)

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 7 | ✗ | 54% |  | Tailwind, äh, förresten | Jag tror att vi ska använda Tailwind, äh, eller förresten, vi kör på CSS modules för det här projektet. |
| h-sv2 | 2 | ✓ | 0% |  |  | Skriv ett mejl till Lisa och fråga om hon kan ta kundmötet på onsdag, . |
| h-sv3 | 0 | ✗ | 20% |  | stryk det | Sätt timeouten till stryk det, sextio sekunder, i config-filen app.config.ts. |
| h-sv4 | 0 | ✗ | 7% | Vilken typ av index |  | Vilken av index ska vi lägga på kolumnen user_id i Postgres, B-tree eller GIN? |
| h-sv5 | 0 | ✓ | 0% |  |  | Kan du boka ett möte med Erik på fredag klockan tio, och skicka länken i Slack? |
| h-en1 | 0 | ✗ | 21% | Node version to 22 | 20, make that | Let's bump the Node version to 20, make that 22, in the Dockerfile and the CI workflow. |
| h-en2 | 0 | ✓ | 0% |  |  | Write a short reply to Sarah saying the build is green and we can ship tomorrow. |
| h-en3 | 0 | ✗ | 13% | I like the new API design, I'd like the error codes |  | I the new API design, but I'd the error codes to follow RFC 9457. |
| h-en4 | 0 | ✗ | 64% |  | null, no wait | So, the function should return null, no wait, it should throw a ValidationError when the email is invalid. |
| h-en5 | 0 | ✗ | 38% |  | login endpoint, I meant | We need to add rate limiting to the login endpoint, I meant the password reset endpoint, using express-rate-limit. |

## qwen3.5:2b-q4_K_M

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 219 | ✗ | 46% |  | Tailwind, förresten | Jag tror att vi ska använda Tailwind, eller förresten, vi kör på CSS modules för det här projektet. |
| h-sv2 | 210 | ✓ | 0% |  |  | Skriv ett mejl till Lisa och fråga om hon kan ta kundmötet på onsdag. |
| h-sv3 | 159 | ✗ | 20% | sextio sekunder |  | Sett timeouten till 60 sekunder i config-filen app.config.ts. |
| h-sv4 | 229 | ✓ | 7% |  |  | Vilken typ av index ska vi lägga på kolumnen user_id i Postgres: B-tree eller GIN? |
| h-sv5 | 367 | ✗ | 44% | fredag klockan tio | öh, jag menar | Öh, kan du boka ett möte med Erik på fredag klockan 10, ja, jag menar klockan 10, och skicka länken i Slack? |
| h-en1 | 175 | ✓ | 7% |  |  | Bump the Node version to 22 in the Dockerfile and the CI workflow. |
| h-en2 | 145 | ✗ | 38% | Write a short reply to Sarah |  | Reply to Sarah: The build is green, so we can ship tomorrow. |
| h-en3 | 212 | ✓ | 0% |  |  | I like the new API design, but I'd like the error codes to follow RFC 9457. |
| h-en4 | 124 | ✓ | 0% |  |  | The function should throw a ValidationError when the email is invalid. |
| h-en5 | 157 | ✓ | 23% |  |  | We need to add rate limiting to the login and password reset endpoints using express-rate-limit. |

## qwen3:1.7b

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 188 | ✗ | 38% |  | Tailwind | Jag tror att vi ska använda Tailwind, eller vi kör på CSS modules för det här projektet. |
| h-sv2 | 197 | ✓ | 0% |  |  | Skriv ett mejl till Lisa och fråga om hon kan ta kundmötet på onsdag. |
| h-sv3 | 177 | ✗ | 20% |  | trettio | Sätt timeouten till trettio sekunder, sextio sekunder, i config-filen app.config.ts. |
| h-sv4 | 198 | ✓ | 0% |  |  | Vilken typ av index ska vi lägga på kolumnen user_id i Postgres, B-tree eller GIN? |
| h-sv5 | 234 | ✗ | 6% |  | öh | Öh, kan du boka ett möte med Erik på fredag klockan tio, och skicka länken i Slack? |
| h-en1 | 150 | ✓ | 0% |  |  | Let's bump the Node version to 22, in the Dockerfile and the CI workflow. |
| h-en2 | 83 | ✗ | 50% | Write a short reply to Sarah |  | The build is green. We can ship tomorrow. |
| h-en3 | 173 | ✓ | 0% |  |  | I like the new API design, but I'd like the error codes to follow RFC 9457. |
| h-en4 | 164 | ✗ | 64% |  | null, no wait | So, the function should return null, no wait, it should throw a ValidationError when the email is invalid. |
| h-en5 | 131 | ✓ | 0% |  |  | We need to add rate limiting to the password reset endpoint using express-rate-limit. |

## gemma3:1b

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 182 | ✗ | 115% | projektet | Tailwind | We should use Tailwind, uh, or, by the way, we’re using CSS modules for this project. |
| h-sv2 | 158 | ✗ | 114% | Skriv ett mejl till Lisa, kundmötet, onsdag |  | Write an email to Lisa and ask if she can take the customer meeting on Wednesday, like? |
| h-sv3 | 243 | ✗ | 190% | sextio sekunder |  | Set the timeout to 30 seconds, no, delete it. Set the timeout to 60 seconds, in the config file app.config.ts. |
| h-sv4 | 85 | ✗ | 93% | Vilken typ av index, user_id, Postgres, GIN |  | We should use B-tree. |
| h-sv5 | 275 | ✗ | 131% | fredag klockan tio |  | Can you book a meeting with Erik on Friday at 10:00 AM, uh, I mean 10:00 AM, and send the link in Slack? |
| h-en1 | 153 | ✓ | 7% |  |  | Let's bump the Node version to 22 in the Dockerfile and CI workflow. |
| h-en2 | 95 | ✗ | 44% | Write a short reply to Sarah |  | The build is green and we can ship tomorrow. |
| h-en3 | 135 | ✗ | 50% | I like the new API design, I'd like the error codes |  | I’d like the error codes to follow RFC 9457. |
| h-en4 | 107 | ✓ | 0% |  |  | The function should throw a ValidationError when the email is invalid. |
| h-en5 | 203 | ✗ | 46% |  | login endpoint | We need to add rate limiting to the login endpoint, specifically the password reset endpoint, using the express-rate-limit library. |

## qwen3:4b-instruct-2507-q4_K_M

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 347 | ✗ | 38% |  | Tailwind | Jag tror att vi ska använda Tailwind, eller vi kör på CSS modules för det här projektet. |
| h-sv2 | 360 | ✓ | 0% |  |  | Skriv ett mejl till Lisa och fråga om hon kan ta kundmötet på onsdag. |
| h-sv3 | 249 | ✓ | 0% |  |  | Sätt timeouten till sextio sekunder i config-filen app.config.ts. |
| h-sv4 | 381 | ✓ | 0% |  |  | Vilken typ av index ska vi lägga på kolumnen user_id i Postgres, B-tree eller GIN? |
| h-sv5 | 413 | ✓ | 6% |  |  | Kan du boka ett möte med Erik på fredag klockan tiotio och skicka länken i Slack? |
| h-en1 | 269 | ✓ | 0% |  |  | Let's bump the Node version to 22 in the Dockerfile and the CI workflow. |
| h-en2 | 158 | ✗ | 50% | Write a short reply to Sarah |  | The build is green, we can ship tomorrow. |
| h-en3 | 339 | ✓ | 0% |  |  | I like the new API design, but I'd like the error codes to follow RFC 9457. |
| h-en4 | 184 | ✓ | 0% |  |  | The function should throw a ValidationError when the email is invalid. |
| h-en5 | 245 | ✓ | 0% |  |  | We need to add rate limiting to the password reset endpoint, using express-rate-limit. |

## gemma3:4b

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 153 | ✗ | 62% | CSS modules, projektet | Tailwind | Jag tror att vi ska använda Tailwind. |
| h-sv2 | 321 | ✓ | 0% |  |  | Skriv ett mejl till Lisa och fråga om hon kan ta kundmötet på onsdag. |
| h-sv3 | 314 | ✓ | 0% |  |  | Sätt timeouten till sextio sekunder i config-filen app.config.ts. |
| h-sv4 | 393 | ✓ | 0% |  |  | Vilken typ av index ska vi lägga på kolumnen user_id i Postgres, B-tree eller GIN? |
| h-sv5 | 366 | ✓ | 0% |  |  | Kan du boka ett möte med Erik på fredag klockan tio och skicka länken i Slack? |
| h-en1 | 405 | ✗ | 29% | Node version to 22 | 20, make that | Let’s bump the Node version to 20, make that 22, in the Dockerfile and the CI workflow. |
| h-en2 | 166 | ✗ | 56% | Write a short reply to Sarah, build is green |  | Build is green, we can ship tomorrow. |
| h-en3 | 376 | ✗ | 6% | I'd like the error codes |  | I like the new API design, but I’d like the error codes to follow RFC 9457. |
| h-en4 | 210 | ✓ | 0% |  |  | The function should throw a ValidationError when the email is invalid. |
| h-en5 | 284 | ✓ | 0% |  |  | We need to add rate limiting to the password reset endpoint using express-rate-limit. |

## gemma4:e2b-it-qat

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| h-sv1 | 245 | ✗ | 46% |  | Tailwind, förresten | Jag tror att vi ska använda Tailwind, eller förresten, vi kör på CSS modules för det här projektet. |
| h-sv2 | 211 | ✓ | 0% |  |  | Skriv ett mejl till Lisa och fråga om hon kan ta kundmötet på onsdag. |
| h-sv3 | 226 | ✗ | 10% | sextio sekunder | trettio | Sätt timeouten till trettio sekunder i config-filen app.config.ts. |
| h-sv4 | 265 | ✓ | 0% |  |  | Vilken typ av index ska vi lägga på kolumnen user_id i Postgres, B-tree eller GIN? |
| h-sv5 | 254 | ✓ | 0% |  |  | Kan du boka ett möte med Erik på fredag klockan tio och skicka länken i Slack? |
| h-en1 | 235 | ✓ | 0% |  |  | Let's bump the Node version to 22 in the Dockerfile and the CI workflow. |
| h-en2 | 194 | ✓ | 0% |  |  | Write a short reply to Sarah saying the build is green and we can ship tomorrow. |
| h-en3 | 251 | ✓ | 0% |  |  | I like the new API design, but I'd like the error codes to follow RFC 9457. |
| h-en4 | 204 | ✗ | 45% |  | null | The function should return null. Wait, it should throw a ValidationError when the email is invalid. |
| h-en5 | 197 | ✓ | 0% |  |  | We need to add rate limiting to the password reset endpoint using express-rate-limit. |
