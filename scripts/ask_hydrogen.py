#!/usr/bin/env python3
import sys
import json
import urllib.request

def ask_bridge(prompt, model="gemini-4-hydrogen"):
    url = "http://localhost:8765/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": False
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            return res_data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Error connecting to Gemini Bridge: {e}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
    else:
        query = sys.stdin.read().strip()
    
    if not query:
        print("Please provide a prompt.")
        sys.exit(1)
        
    print(ask_bridge(query))
