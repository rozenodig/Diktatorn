# Cleanup spike results (samples.json)

Run 2026-10-18T13:53:45.919Z, Apple M1 Max 64 GB, Ollama 0.40.6 (spike-local), 3 warm runs per sample, temperature 0, think off where supported.

| Model | Median latency (ms) | p90 (ms) | sv median | en median | Cold first call (ms) | Loaded size | Pass (strict) | Mean WER vs ref |
|---|---|---|---|---|---|---|---|---|
| rules (naive regex) | 0 | 7 | 0 | 0 | – | – | 8/10 | 9.0% |
| qwen3.5:2b-q4_K_M | 207 | 391 | 205 | 220 | 3244 | 1.60 GB | 4/10 | 36.3% |
| qwen3:1.7b | 199 | 272 | 193 | 203 | 2443 | 1.21 GB | 2/10 | 33.7% |
| gemma3:1b | 203 | 283 | 199 | 214 | 1854 | 0.88 GB | 0/10 | 83.3% |
| qwen3:4b-instruct-2507-q4_K_M | 307 | 408 | 305 | 336 | 4257 | 2.88 GB | 7/10 | 13.0% |
| gemma3:4b | 302 | 716 | 283 | 341 | 5416 | 2.33 GB | 5/10 | 14.9% |
| gemma4:e2b-it-qat | 217 | 469 | 214 | 287 | 4473 | 0.23 GB | 8/10 | 7.4% |

Pass (strict) = every must-include term present verbatim (case-sensitive) and no retracted phrase or filler left. WER is word-level vs my reference after lowercasing and stripping punctuation.

## rules (naive regex)

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 7 | ✓ | 0% |  |  | Vi måste deploya till staging efter standup, så att Johan hinner kolla PR:en. |
| sv2 | 2 | ✓ | 0% |  |  | Kan du köra npm install och sen npm run build för att se om det går igenom. |
| sv3 | 0 | ✓ | 0% |  |  | Funktionen heter getUserById och den returnerar ett Observable från RxJS. |
| sv4 | 0 | ✓ | 0% |  |  | Vi behöver migrera databasen från MySQL till PostgreSQL innan releasen på fredag. |
| sv5 | 0 | ✓ | 6% |  |  | Hej Anna, ja jag har pushat fixen till branchen feature/login, så du kan granska den när du hinner. |
| en1 | 0 | ✓ | 7% |  |  | So I think we should, refactor the useMemo hook, because it re-renders on every keystroke. |
| en2 | 0 | ✓ | 0% |  |  | Can you run kubectl get pods in the production namespace and send me the output. |
| en3 | 0 | ✗ | 35% | user ID |  | The API returns a 400, and we log it to Sentry, . |
| en4 | 0 | ✓ | 13% |  |  | Hey team the deploy is scheduled Wednesday at 10 am so please merge your PRs into the develop branch before then. |
| en5 | 0 | ✗ | 29% | caching | Redis | We could use Redis for let's use Memcached since it's simpler and, we don't need persistence. |

## qwen3.5:2b-q4_K_M

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 209 | ✗ | 131% | deploya, efter standup, PR:en |  | We must deploy to staging before the standup, or wait after the standup so that Johan can check the PR. |
| sv2 | 205 | ✓ | 41% |  |  | Köra `npm install` och sedan `npm run build` för att se om det går igenom. |
| sv3 | 170 | ✓ | 20% |  |  | Funktionen heter `getUserById` och den returnerar ett `Observable` från RxJS. |
| sv4 | 157 | ✗ | 8% | PostgreSQL | MongoDB | Vi behöver migrera databasen från MySQL till MongoDB innan releasen på fredag. |
| sv5 | 304 | ✗ | 35% |  | main, eller vänta, typ | Hej Anna, ja, jag har pushat fixen till main eller vänta till branchen feature/login, så du kan typ granska den när du hinner. |
| en1 | 189 | ✓ | 7% |  |  | So I think we should refactor the useMemo hook, because it re-renders on every keystroke. |
| en2 | 228 | ✗ | 60% |  | staging, sorry | Can you run `kubectl get pods` in the staging namespace? Sorry, I meant the production namespace. Send me the output. |
| en3 | 204 | ✓ | 0% |  |  | The API returns a 400 when the user ID is missing, and we log it to Sentry. |
| en4 | 293 | ✗ | 17% |  | Tuesday | Hey team, the deploy is scheduled for Tuesday; change it to Wednesday at 10 a.m. So, please merge your PRs into the develop branch before then. |
| en5 | 220 | ✗ | 43% |  | Redis | We could use Redis for caching, or actually let's use Memcached since it's simpler and we don't need persistence. |

## qwen3:1.7b

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 193 | ✗ | 15% |  | innan | Vi måste deploya till staging innan standup, efter standup så att Johan hinner kolla PR:en. |
| sv2 | 272 | ✗ | 47% |  | liksom, npm run dev, jag menar | Kan du köra npm install och sedan npm run dev? Nej, jag menar npm run build. Liksom för att se om det går igenom. |
| sv3 | 179 | ✗ | 10% |  | alltså | Alltså funktionen heter getUserById och den returnerar ett Observable från RxJS. |
| sv4 | 199 | ✗ | 25% |  | MongoDB | Vi behöver migrera databasen från MySQL till MongoDB. Nej till PostgreSQL innan releasen på fredag. |
| sv5 | 106 | ✗ | 59% | feature/login, granska | main | Hej Anna, jag har pushat fixen till main. |
| en1 | 203 | ✓ | 14% |  |  | So I think we should, actually, refactor the useMemo hook. Because it re-renders on every keystroke. |
| en2 | 124 | ✗ | 47% | production namespace |  | Run `kubectl get pods --namespace=production` and send me the output. |
| en3 | 241 | ✗ | 35% |  | 404, you know | The API returns a 404, when the user ID is missing, but a 400, and we log it to Sentry, you know. |
| en4 | 200 | ✓ | 13% |  |  | Hey team. The deploy is scheduled for Wednesday at 10 am. Please merge your PRs into the develop branch before then. |
| en5 | 230 | ✗ | 71% |  | I mean, Redis, you know | I mean we could use Redis for caching, or actually let's use Memcached since it's simpler and, you know, we don't need persistence. |

## gemma3:1b

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 207 | ✗ | 138% | deploya, efter standup, PR:en |  | We need to deploy to staging before the standup, or wait, after the standup, so that Johan can check the PR. |
| sv2 | 199 | ✗ | 106% | går igenom | npm run dev | Can you run npm install and then type npm run dev? I mean npm run build, like, to see if it passes? |
| sv3 | 191 | ✗ | 150% | returnerar |  | The function is called `getUserById` and it returns an Observable from RxJS.  Sorry, I meant an Observable. |
| sv4 | 174 | ✗ | 142% | fredag, migrera | MongoDB | We need to migrate the database from MySQL to MongoDB, no to PostgreSQL before the release on Friday, like. |
| sv5 | 246 | ✗ | 129% | Hej Anna, pushat, granska | main | I’ve pushed the fix to the main branch, or wait, to the feature/login branch, so you can review it when you have time. |
| en1 | 219 | ✗ | 50% |  | useEffect | We should refactor the useMemo hook, actually, no, the useEffect hook, because it re-renders on every keystroke. |
| en2 | 143 | ✗ | 7% | production namespace | staging | Can you run kubectl get pods in the staging namespace, and send me the output? |
| en3 | 248 | ✗ | 35% |  | 404 | The API returns a 404 when the user ID is missing, a 400 for missing data, and we log it to Sentry. |
| en4 | 188 | ✗ | 26% | Wednesday | Tuesday | The deploy is scheduled for Tuesday at 10 am, please merge your PRs into the develop branch before then. |
| en5 | 214 | ✗ | 50% |  | Redis | We could use Redis for caching, or let’s use Memcached since it’s simpler and we don’t need persistence. |

## qwen3:4b-instruct-2507-q4_K_M

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 305 | ✗ | 8% | efter standup | innan | Vi måste deploya till staging innan standup så att Johan hinner kolla PR:en. |
| sv2 | 243 | ✗ | 71% | går igenom |  | Can you run npm install and then npm run build to see if it goes through? |
| sv3 | 276 | ✓ | 0% |  |  | Funktionen heter getUserById och den returnerar ett Observable från RxJS. |
| sv4 | 309 | ✓ | 0% |  |  | Vi behöver migrera databasen från MySQL till PostgreSQL innan releasen på fredag. |
| sv5 | 390 | ✓ | 0% |  |  | Hej Anna, jag har pushat fixen till branchen feature/login, så du kan granska den när du hinner. |
| en1 | 286 | ✓ | 7% |  |  | So I think we should refactor the useMemo hook because it re-renders on every keystroke. |
| en2 | 242 | ✓ | 0% |  |  | Can you run kubectl get pods in the production namespace and send me the output? |
| en3 | 336 | ✓ | 0% |  |  | The API returns a 400 when the user ID is missing, and we log it to Sentry. |
| en4 | 392 | ✓ | 9% |  |  | Hey team, the deploy is scheduled for Wednesday at 10 am. So please merge your PRs into the develop branch before then. |
| en5 | 338 | ✗ | 36% |  | Redis | We could use Redis for caching, or let's use Memcached since it's simpler and we don't need persistence. |

## gemma3:4b

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 318 | ✗ | 8% | efter standup | innan | Vi måste deploya till staging innan standup, så att Johan hinner kolla PR:en. |
| sv2 | 206 | ✗ | 41% | går igenom |  | Kan du köra npm install och sen npm run build? |
| sv3 | 248 | ✓ | 0% |  |  | Funktionen heter getUserById och den returnerar ett Observable från RxJS. |
| sv4 | 283 | ✓ | 0% |  |  | Vi behöver migrera databasen från MySQL till PostgreSQL innan releasen på fredag. |
| sv5 | 414 | ✗ | 6% |  | typ | Hej Anna, jag har pushat fixen till branchen feature/login, så du kan typ granska den när du hinner. |
| en1 | 341 | ✓ | 7% |  |  | So I think we should refactor the useMemo hook because it re-renders on every keystroke. |
| en2 | 257 | ✓ | 0% |  |  | Can you run kubectl get pods in the production namespace and send me the output? |
| en3 | 286 | ✗ | 35% | user ID |  | The API returns a 400, and we log it to Sentry. |
| en4 | 413 | ✓ | 9% |  |  | Hey team, the deploy is scheduled for Wednesday at 10 am, so please merge your PRs into the develop branch before then. |
| en5 | 389 | ✗ | 43% |  | Redis | We could use Redis for caching, let's use Memcached since it’s simpler and we don’t need persistence. |

## gemma4:e2b-it-qat

| id | ms (median) | pass | WER | missing | leaked | output |
|---|---|---|---|---|---|---|
| sv1 | 214 | ✓ | 0% |  |  | Vi måste deploya till staging efter standup så att Johan hinner kolla PR:en. |
| sv2 | 215 | ✓ | 0% |  |  | Kan du köra npm install och sen npm run build för att se om det går igenom? |
| sv3 | 171 | ✓ | 0% |  |  | Funktionen heter getUserById och den returnerar ett Observable från RxJS. |
| sv4 | 199 | ✓ | 0% |  |  | Vi behöver migrera databasen från MySQL till PostgreSQL innan releasen på fredag. |
| sv5 | 280 | ✓ | 0% |  |  | Hej Anna, jag har pushat fixen till branchen feature/login, så du kan granska den när du hinner. |
| en1 | 219 | ✓ | 0% |  |  | I think we should refactor the useMemo hook because it re-renders on every keystroke. |
| en2 | 178 | ✓ | 0% |  |  | Can you run kubectl get pods in the production namespace and send me the output? |
| en3 | 330 | ✗ | 29% |  | 404 | The API returns a 404 when the user ID is missing. Wait, no, a 400, and we log it to Sentry. |
| en4 | 287 | ✓ | 9% |  |  | Hey team, the deploy is scheduled for Wednesday at 10 am, so please merge your PRs into the develop branch before then. |
| en5 | 297 | ✗ | 36% |  | Redis | We could use Redis for caching, or let's use Memcached since it's simpler and we don't need persistence. |
