# Current State — [UPDATE THIS DATE EVERY SESSION]

## What works right now
- Full UI with Design OS, light + dark mode
- Real Claude API via Vercel serverless function
- Verdict, score, reasons, questions, alternative
- Demo mode off — real AI verdicts live
- Deployed at: https://tellmeitsgood.vercel.app/

## What I'm building next
- Waiting on feedback from 6+ people before deciding

## Known issues
- [anything you noticed while testing]

## How to test right now
1. Open index.html directly in your browser (just double-click the file)
2. Type anything in the input and click submit
3. Demo mode will show a realistic fake verdict after ~2 seconds
4. Test the reset button
5. Check it on your iPhone: in VS Code terminal run `npx serve .`
   then open the IP address it shows on your iPhone browser

## Session prompt for next time (copy-paste to start Claude.ai)

---
You are helping me build tellmeitsgood.com — a pre-purchase decision tool.

WHAT IT DOES: User types what they're thinking of buying, AI returns a
verdict (good/think twice/don't), a score out of 10, 3 key points,
and 3 questions to ask themselves.

CURRENT STACK: Single index.html file. Vanilla JS. No frameworks.
Design OS tokens (CSS variables) in the <style> tag.

DESIGN SYSTEM: Calm Design OS — warm cream bg #FAF8F5, dark mode bg #18161A,
accent blue #2F6FED (light) / #5A8FFF (dark), fonts: DM Serif Display +
DM Sans, radius 6/10/14/20px.

MY LEVEL: HTML/CSS basics, learning JS. Explain anything non-obvious.
Keep code simple and well-commented.

CURRENT STATE: [paste what's working from above]

TODAY'S GOAL: [ONE sentence — what you want to build this session]
---
