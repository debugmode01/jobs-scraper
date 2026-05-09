# Naukri Auto-Apply (Self-Learning)

Semi-automatic Naukri job apply tool with a learning Q&A bank.

## How it works

1. Launches Chromium with a persistent profile (so login stays for next runs).
2. Asks you to log in to Naukri once (Google / email / OTP — your call).
3. Iterates each search keyword in `data/profile.json`.
4. For each job:
   - Opens detail page, clicks **Apply**.
   - If a chatbot/questionnaire appears, reads each question.
   - Fuzzy-matches the question against `data/answers.json` (threshold 0.55).
   - If matched → fills automatically.
   - If **not** matched → pauses, prints the question + options in your terminal, you type the answer once. The answer is saved into `answers.json` with the question as a pattern. Future similar questions auto-fill.
5. Logs every job to `data/applied-jobs.csv` (status: applied / skipped / failed).
6. Stops at `maxApplicationsPerRun` (default 50) or when Naukri's daily limit is hit.

## Setup (one-time)

```bash
cd "D:\Manas Kumar\Jobs\jobs-scraper"
npm install
npx playwright install chromium
```

## Run

```bash
npm run start
```

A Chrome window opens. Log in to Naukri. Come back to the terminal and press **ENTER**. The bot starts.

## Files

| File | Purpose |
|---|---|
| `data/profile.json` | Your data (CTC, NP, locations, keywords, skills) |
| `data/answers.json` | Q&A bank — grows as you teach it |
| `data/applied-jobs.csv` | History of every job touched |
| `chrome-profile/` | Persistent browser profile (login cookies) |

## When the bot pauses for an unknown question

```
========== UNKNOWN QUESTION ==========
Job:      Senior Node.js Developer
Question: Are you currently serving notice period?
Type:     radio
   Options: Yes | No
--------------------------------------
Your answer (or "skip" to skip this job): No
Extra patterns to match similar future questions (comma-separated, ENTER to use the question itself): serving notice, on notice period
```

Now any future variation of "Are you currently serving notice period?" auto-fills with "No".

## Tweaking match accuracy

In `data/answers.json`:
- Each entry has a `patterns` array. Add more phrasings to make matching better.
- Lower `_meta.matchThreshold` (e.g., 0.45) for fuzzier matching, raise it (e.g., 0.65) for stricter.

## Stopping

Close the Chrome window or hit `Ctrl+C` in the terminal. Already-applied jobs are saved.

## Notes

- This tool runs `Apply` (Naukri's direct apply). External "Apply on company site" jobs are skipped automatically.
- Naukri's daily apply limit (~50/day) is detected and the bot stops gracefully.
- The bot does **not** falsify answers. If a job asks something you didn't tell it, it pauses and asks you.
