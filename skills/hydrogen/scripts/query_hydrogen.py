#!/usr/bin/env python3
"""
Query Gemini 4 Hydrogen via Gemini Bridge (http://localhost:8765/v1).
"""

import sys
import json
import urllib.request
import subprocess
import time

BRIDGE_URL = "http://localhost:8765/v1/chat/completions"

def is_bridge_up():
    try:
        with urllib.request.urlopen("http://localhost:8765/v1/models", timeout=1) as resp:
            return resp.status == 200
    except Exception:
        return False

def query_hydrogen(prompt):
    if not is_bridge_up():
        # Attempt to launch the background bridge server
        try:
            subprocess.Popen(
                ["node", "cli.js"],
                cwd="/run/media/bhoid/StorageVault/WEbs/Gemini Bridge",
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True
            )
            time.sleep(2)
        except Exception:
            pass
            
    payload = {
        "model": "gemini-4-hydrogen",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": False
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BRIDGE_URL,
        data=data,
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            if "error" in res_json:
                return f"[Bridge Error]: {res_json['error'].get('message', res_json['error'])}"
            choices = res_json.get("choices", [])
            if choices and "message" in choices[0]:
                return choices[0]["message"].get("content", "")
            return str(res_json)
    except urllib.error.URLError as e:
        return f"[Error connecting to Gemini Bridge on port 8765]: {e}. Please ensure Gemini Bridge is running ('npm start') and your Gemini PWA is open with the extension active."
    except Exception as e:
        return f"[Error]: {e}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_prompt = " ".join(sys.argv[1:])
    else:
        user_prompt = sys.stdin.read().strip()
        
    if not user_prompt:
        print("Please provide a prompt for Gemini 4 Hydrogen.")
        sys.exit(1)
        
    print(query_hydrogen(user_prompt))
