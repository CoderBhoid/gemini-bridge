/**
 * Universal Webchat Agent Bridge - Content Script
 * Supports: Gemini (gemini.google.com), ChatGPT (chatgpt.com, chat.openai.com), Claude (claude.ai)
 * Connects to local CLI orchestrator via ws://localhost:8765
 */

(() => {
  const WS_URL = 'ws://localhost:8765';
  let socket = null;
  let isGenerating = false;
  let safeModeActive = true;
  const reconnectInterval = 2000;
  let lastReportedModel = '';

  // 1. Platform Detection
  function getPlatform() {
    const host = window.location.hostname;
    if (host.includes('gemini.google.com')) return 'Gemini';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'ChatGPT';
    if (host.includes('claude.ai')) return 'Claude';
    return 'WebChat';
  }

  const platform = getPlatform();

  // 2. Modular Platform DOM Adapters
  const Adapters = {
    Gemini: {
      getModelName() {
        const picker =
          document.querySelector('button[data-test-id="model-selector-button"]') ||
          document.querySelector('button[aria-label*="model" i]') ||
          document.querySelector('.model-pill') ||
          document.querySelector('button span.model-title');
        if (picker) {
          const text = (picker.innerText || picker.textContent || '').trim();
          if (text) return text.split('\n')[0].trim();
        }
        return 'Gemini Web';
      },
      findInputBox() {
        return (
          document.querySelector('rich-textarea div[role="textbox"]') ||
          document.querySelector('div[role="textbox"][contenteditable="true"]') ||
          document.querySelector('.ql-editor[contenteditable="true"]') ||
          document.querySelector('rich-textarea [contenteditable="true"]') ||
          document.querySelector('textarea')
        );
      },
      findSendButton() {
        return (
          document.querySelector('button[aria-label*="Send message"]') ||
          document.querySelector('button[aria-label*="Send"]') ||
          document.querySelector('button.send-button') ||
          document.querySelector('button[data-test-id="send-button"]') ||
          document.querySelector('.send-button-container button')
        );
      },
      findStopButton() {
        return (
          document.querySelector('button[aria-label*="Stop response"]') ||
          document.querySelector('button[aria-label*="Stop"]') ||
          document.querySelector('button.stop-button') ||
          document.querySelector('.stop-button-container button')
        );
      },
      getLatestResponseText() {
        const responses = document.querySelectorAll(
          'model-response, .model-response-text, message-content, [data-message-id], model-turn'
        );
        if (responses.length > 0) {
          const last = responses[responses.length - 1];
          const markdownBody = last.querySelector('.markdown') || last;
          return (markdownBody.innerText || markdownBody.textContent || '').trim();
        }
        const markdowns = document.querySelectorAll('.markdown');
        if (markdowns.length > 0) {
          return (markdowns[markdowns.length - 1].innerText || '').trim();
        }
        return '';
      }
    },

    ChatGPT: {
      getModelName() {
        const modelBtn =
          document.querySelector('button[data-testid="model-switcher-dropdown-button"]') ||
          document.querySelector('button[aria-haspopup="menu"] span') ||
          document.querySelector('div[data-testid="model-switcher"]');
        if (modelBtn) {
          const text = (modelBtn.innerText || modelBtn.textContent || '').trim();
          if (text) return text.split('\n')[0].trim();
        }
        return 'ChatGPT';
      },
      findInputBox() {
        return (
          document.querySelector('#prompt-textarea') ||
          document.querySelector('textarea[data-id="root"]') ||
          document.querySelector('div#prompt-textarea[contenteditable="true"]') ||
          document.querySelector('textarea')
        );
      },
      findSendButton() {
        return (
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[data-testid="fruitjuice-send-button"]') ||
          document.querySelector('button[aria-label*="Send prompt"]') ||
          document.querySelector('button[aria-label*="Send"]')
        );
      },
      findStopButton() {
        return (
          document.querySelector('button[data-testid="stop-button"]') ||
          document.querySelector('button[aria-label*="Stop generating"]') ||
          document.querySelector('button[aria-label*="Stop"]')
        );
      },
      getLatestResponseText() {
        const assistants = document.querySelectorAll('[data-message-author-role="assistant"], .agent-turn');
        if (assistants.length > 0) {
          const last = assistants[assistants.length - 1];
          const markdown = last.querySelector('.markdown') || last;
          return (markdown.innerText || markdown.textContent || '').trim();
        }
        return '';
      }
    },

    Claude: {
      getModelName() {
        const selector =
          document.querySelector('button[aria-haspopup="menu"] [data-testid*="model"]') ||
          document.querySelector('button[data-testid="model-selector-dropdown"]') ||
          document.querySelector('button[aria-haspopup="menu"]');
        if (selector) {
          const text = (selector.innerText || selector.textContent || '').trim();
          if (text && (text.includes('Claude') || text.includes('Sonnet') || text.includes('Opus') || text.includes('Haiku'))) {
            return text.split('\n')[0].trim();
          }
        }
        return 'Claude 3.7 Sonnet';
      },
      findInputBox() {
        return (
          document.querySelector('div[contenteditable="true"].ProseMirror') ||
          document.querySelector('fieldset div[contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"]')
        );
      },
      findSendButton() {
        return (
          document.querySelector('button[aria-label*="Send Message"]') ||
          document.querySelector('button[aria-label*="Send"]') ||
          document.querySelector('button[data-testid="send-button"]')
        );
      },
      findStopButton() {
        return (
          document.querySelector('button[aria-label*="Stop responding"]') ||
          document.querySelector('button[aria-label*="Stop Response"]') ||
          document.querySelector('button[aria-label*="Stop"]')
        );
      },
      getLatestResponseText() {
        const messages = document.querySelectorAll(
          '.font-claude-message, [data-testid="chat-message-assistant"], .prose'
        );
        if (messages.length > 0) {
          const last = messages[messages.length - 1];
          return (last.innerText || last.textContent || '').trim();
        }
        return '';
      }
    }
  };

  const currentAdapter = Adapters[platform] || Adapters.Gemini;

  // 3. Floating Status Badge
  const badge = document.createElement('div');
  badge.id = 'gemini-agent-bridge-badge';
  badge.style.position = 'fixed';
  badge.style.bottom = '16px';
  badge.style.left = '16px';
  badge.style.zIndex = '999999';
  badge.style.display = 'flex';
  badge.style.alignItems = 'center';
  badge.style.gap = '8px';
  badge.style.padding = '8px 14px';
  badge.style.backgroundColor = '#0f172a';
  badge.style.color = '#f8fafc';
  badge.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  badge.style.fontSize = '12px';
  badge.style.fontWeight = '600';
  badge.style.borderRadius = '9999px';
  badge.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.35)';
  badge.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  badge.style.userSelect = 'none';
  badge.style.transition = 'all 0.2s ease-in-out';

  const dot = document.createElement('span');
  dot.style.width = '8px';
  dot.style.height = '8px';
  dot.style.borderRadius = '50%';
  dot.style.backgroundColor = '#ef4444';
  dot.style.display = 'inline-block';

  const textLabel = document.createElement('span');
  textLabel.textContent = 'Agent Bridge: Disconnected';

  badge.appendChild(dot);
  badge.appendChild(textLabel);
  document.body.appendChild(badge);

  function setStatus(status) {
    const activeModel = currentAdapter.getModelName();
    const modeLabel = safeModeActive ? 'Safe Mode' : 'Fast Mode';
    if (status === 'connected' || status === 'ready') {
      dot.style.backgroundColor = '#10b981';
      textLabel.textContent = `Agent Bridge: Ready [${platform}: ${activeModel} | ${modeLabel}]`;
    } else if (status === 'busy') {
      dot.style.backgroundColor = '#f59e0b';
      textLabel.textContent = `Agent Bridge: Busy [${platform}: ${activeModel} | ${modeLabel}]`;
    } else {
      dot.style.backgroundColor = '#ef4444';
      textLabel.textContent = 'Agent Bridge: Disconnected';
    }
  }

  // 4. Human-like Simulated Pointer Events
  function simulateHumanClick(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const offsetX = rect.width * (0.35 + Math.random() * 0.3);
    const offsetY = rect.height * (0.35 + Math.random() * 0.3);
    const clientX = Math.round(rect.left + offsetX);
    const clientY = Math.round(rect.top + offsetY);
    const screenX = Math.round(window.screenX + clientX);
    const screenY = Math.round(window.screenY + clientY);

    const baseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      clientX,
      clientY,
      screenX,
      screenY,
      button: 0
    };

    const downInit = {
      ...baseEventInit,
      buttons: 1
    };

    const upInit = {
      ...baseEventInit,
      buttons: 0
    };

    const pointerDownInit = {
      ...downInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0.5
    };

    const pointerUpInit = {
      ...upInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0
    };

    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerdown', pointerDownInit));
    }
    element.dispatchEvent(new MouseEvent('mousedown', downInit));

    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerup', pointerUpInit));
    }
    element.dispatchEvent(new MouseEvent('mouseup', upInit));
    element.dispatchEvent(new MouseEvent('click', upInit));

    return true;
  }

  // 5. Prompt Injection and Submission
  function injectPrompt(text) {
    const input = currentAdapter.findInputBox();
    if (!input) {
      console.error(`[Agent Bridge] Input element not found on ${platform}`);
      return false;
    }

    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    if (input.tagName.toLowerCase() === 'textarea') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // Rich contenteditable / ProseMirror elements
    while (input.firstChild) {
      input.removeChild(input.firstChild);
    }

    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      input.innerText = text;
    }

    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  function submitPrompt() {
    const sendBtn = currentAdapter.findSendButton();
    if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
      simulateHumanClick(sendBtn);
      return true;
    }

    const input = currentAdapter.findInputBox();
    if (input) {
      input.focus();
      const enterDown = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      const enterPress = new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      const enterUp = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      input.dispatchEvent(enterDown);
      input.dispatchEvent(enterPress);
      input.dispatchEvent(enterUp);
      return true;
    }

    return false;
  }

  // 6. Response Monitor
  function monitorResponse(initialText) {
    return new Promise((resolve) => {
      let settledTimer = null;
      let hasStarted = false;
      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        const stopBtn = currentAdapter.findStopButton();
        const currentText = currentAdapter.getLatestResponseText();

        if (stopBtn) {
          hasStarted = true;
          setStatus('busy');
        }

        if (!hasStarted && currentText !== initialText && currentText.length > 0) {
          hasStarted = true;
          setStatus('busy');
        }

        if (hasStarted && !stopBtn) {
          if (!settledTimer) {
            settledTimer = setTimeout(() => {
              clearInterval(checkInterval);
              const finalText = currentAdapter.getLatestResponseText();
              resolve(finalText);
            }, 1200);
          }
        } else if (stopBtn && settledTimer) {
          clearTimeout(settledTimer);
          settledTimer = null;
        }

        // Safety timeout: 3 minutes max
        if (Date.now() - startTime > 180000) {
          clearInterval(checkInterval);
          if (settledTimer) clearTimeout(settledTimer);
          resolve(currentAdapter.getLatestResponseText());
        }
      }, 400);
    });
  }

  // 7. WebSocket Lifecycle
  function connect() {
    try {
      socket = new WebSocket(WS_URL);
    } catch {
      setStatus('disconnected');
      setTimeout(connect, reconnectInterval);
      return;
    }

    socket.onopen = () => {
      const activeModel = currentAdapter.getModelName();
      lastReportedModel = activeModel;
      console.log(`[Agent Bridge] Connected to CLI orchestrator on ${platform} (${activeModel}) [Safe Mode: ${safeModeActive}]`);
      setStatus('ready');

      socket.send(
        JSON.stringify({
          type: 'HELLO',
          platform,
          model: activeModel,
          safeMode: safeModeActive,
          url: window.location.href
        })
      );
    };

    socket.onclose = () => {
      console.log('[Agent Bridge] Disconnected from CLI orchestrator, retrying...');
      setStatus('disconnected');
      socket = null;
      setTimeout(connect, reconnectInterval);
    };

    socket.onerror = () => {
      setStatus('disconnected');
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'CONFIG') {
          if (msg.safeMode !== undefined) {
            safeModeActive = Boolean(msg.safeMode);
          }
          setStatus(isGenerating ? 'busy' : 'ready');
          return;
        }

        if (msg.type === 'PROMPT') {
          if (msg.safeMode !== undefined) {
            safeModeActive = Boolean(msg.safeMode);
          }

          if (isGenerating) {
            socket.send(
              JSON.stringify({
                type: 'ERROR',
                message: `${platform} is currently busy processing another turn.`
              })
            );
            return;
          }

          isGenerating = true;
          setStatus('busy');

          const baselineText = currentAdapter.getLatestResponseText();
          const injected = injectPrompt(msg.text);

          if (!injected) {
            isGenerating = false;
            setStatus('ready');
            socket.send(
              JSON.stringify({
                type: 'ERROR',
                message: `Failed to inject prompt into ${platform} input element.`
              })
            );
            return;
          }

          // Humanized jitter delay: between 1200ms and 2400ms in safe mode (never 0ms)
          const delayMs = safeModeActive
            ? Math.floor(1200 + Math.random() * 1200)
            : 300;

          setTimeout(async () => {
            submitPrompt();
            const resultText = await monitorResponse(baselineText);
            isGenerating = false;
            setStatus('ready');

            socket.send(
              JSON.stringify({
                type: 'RESPONSE',
                text: resultText
              })
            );
          }, delayMs);
        }
      } catch (err) {
        console.error('[Agent Bridge] Message processing error:', err);
      }
    };
  }

  // Periodic model check to notify CLI if model changes dynamically
  setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const currentModel = currentAdapter.getModelName();
      if (currentModel !== lastReportedModel) {
        lastReportedModel = currentModel;
        setStatus('ready');
        socket.send(
          JSON.stringify({
            type: 'STATUS',
            platform,
            model: currentModel,
            safeMode: safeModeActive
          })
        );
      }
    }
  }, 3000);

  connect();
})();
