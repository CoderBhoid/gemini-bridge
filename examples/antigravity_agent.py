#!/usr/bin/env python3
"""
Gemini Bridge + Google Antigravity SDK Integration
--------------------------------------------------
Demonstrates how to connect the Google Antigravity SDK to Gemini Bridge
using `LocalOpenAIAgentConfig` to run Gemini 4 Hydrogen from your active
Gemini Web or Gemini Chrome PWA chat session.

Prerequisites:
    1. Install Google Antigravity SDK:
       $ pip install google-antigravity

    2. Start Gemini Bridge CLI server:
       $ cd /path/to/gemini-bridge
       $ npm start
       # Listens on http://localhost:8765/v1

    3. Open Gemini in Chrome or Gemini Chrome PWA:
       - Navigate to https://gemini.google.com (or launch your installed PWA).
       - Select 'Gemini 4 Hydrogen' in the model picker.
       - Verify the bottom-left floating badge turns green:
         "Agent Bridge: Ready [Gemini: Gemini 4 Hydrogen | Safe Mode]"

Key Architecture:
    - Google Antigravity SDK manages local agent loops, workspace policies, and tool execution.
    - Gemini Bridge routes OpenAI-compatible chat completion requests to the live browser PWA.
    - .lightweight() preset trims system prompts and scopes tools to conserve webchat context.
    - Full async streaming receives token-by-token output with zero latency.
"""

import asyncio
import sys
from google.antigravity import Agent
from google.antigravity.connections.local.local_openai_connection_config import (
    LocalOpenAIAgentConfig,
)
from google.antigravity.hooks import policy


async def main():
    print("=" * 68)
    print(" Google Antigravity SDK -> Gemini Bridge (Gemini 4 Hydrogen)")
    print("=" * 68)

    bridge_url = "http://localhost:8765/v1"
    target_model = "gemini-4-hydrogen"

    print(f"\n[1] Endpoint:     {bridge_url}")
    print(f"[2] Target Model: {target_model}")
    print("[3] Preset:       .lightweight() (Webchat Context Optimized)\n")

    # Configure Antigravity to point to Gemini Bridge's OpenAI-compatible proxy.
    # The .lightweight() preset optimizes prompts and restricts tool catalogs
    # to protect browser context windows and avoid rate limits.
    config = (
        LocalOpenAIAgentConfig(
            model=target_model,
            base_url=bridge_url,
            api_key="gemini-bridge",
            workspaces=["."],
            policies=[policy.allow_all()],
        )
        .lightweight()
    )

    prompt = (
        "Hello Gemini 4 Hydrogen! You are connected as the reasoning engine for "
        "a Google Antigravity developer agent. Summarize your current capabilities "
        "and provide 3 key architectural guidelines for building resilient agent loops."
    )

    print("Sending prompt to Gemini 4 Hydrogen via Gemini Bridge...\n")
    print(f"--- [Prompt] ---\n{prompt}\n")
    print("--- [Streaming Response] ---")

    try:
        async with Agent(config) as agent:
            # Send prompt and stream tokens asynchronously
            response = await agent.chat(prompt)
            async for token in response:
                print(token, end="", flush=True)
            print("\n----------------------------")
            print("[+] Turn completed successfully.")
    except ConnectionError as conn_err:
        print(f"\n[!] Connection failed: {conn_err}", file=sys.stderr)
        print("    Ensure Gemini Bridge is running: 'npm start'", file=sys.stderr)
        print("    Ensure Gemini Web or PWA is open with the extension active.", file=sys.stderr)
    except Exception as err:
        print(f"\n[!] Agent runtime error: {err}", file=sys.stderr)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[!] Execution stopped by user.")
