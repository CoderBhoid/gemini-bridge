---
name: hydrogen
description: Consult or talk directly to Gemini 4 Hydrogen running in your Gemini Web or Chrome PWA via Gemini Bridge. Use whenever the user asks questions with /hydrogen, asks to consult Hydrogen, or wants a second opinion from Hydrogen.
---

# /hydrogen Slash Command

When the user invokes `/hydrogen` (or asks to consult/ask Gemini 4 Hydrogen):

1. **Extract Prompt**:
   Take the user's prompt or question following `/hydrogen`.

2. **Execute Query**:
   Execute the query script via `run_command`:
   ```bash
   python3 "$HOME/.gemini/config/skills/hydrogen/scripts/query_hydrogen.py" "<user_prompt>"
   ```

3. **Present Output**:
   Present the exact response returned by the model to the user, formatted clearly under the heading or blockquote:
   `**[Gemini 4 Hydrogen]**:`
   Do not summarize, censor, or rephrase Hydrogen's words unless the user explicitly requested a summary.
