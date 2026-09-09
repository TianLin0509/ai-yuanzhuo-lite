// 精确选择器优先；仅作为三站适配知识迁移，不继承旧版全局补丁与兜底全文扫描。
globalThis.YuanzhuoAdapters = {
  deepseek: {
    input:['#chat-input','textarea[placeholder]'],
    answer:['.ds-markdown','[data-role="assistant"]'],
    user:['[data-role="user"]','[class*="user-message"]','.fbb737a4'],
    send:['[data-testid="send-button"]','button[aria-label*="发送"]','button[aria-label*="Send"]','[role="button"][aria-label*="发送"]'],
    stop:['button[aria-label*="停止"]','button[aria-label*="Stop"]','[role="button"][aria-label*="停止"]','[data-testid="stop-button"]'],
    complete:['[data-testid="copy-button"]','button[aria-label*="复制"]','[role="button"][aria-label*="复制"]','button[aria-label*="Copy"]'],
    root:['main','[role="main"]'],
    conversation:/\/a\/chat\/s\/[^/]+|\/chat\/[^/]+/
  },
  kimi: {
    input:['.ProseMirror[contenteditable="true"]','[role="textbox"][contenteditable="true"]','[contenteditable="true"]','textarea'],
    answer:['.segment-assistant','[class*="segment-assistant"]','[data-role="assistant"]','[class*="assistant-segment"]'],
    user:['.segment-user','[class*="segment-user"]','[data-role="user"]'],
    send:['button[aria-label*="发送"]','button[aria-label*="Send"]','button[class*="send"]','[class*="send-button"]','[data-testid="send-button"]'],
    stop:['button[aria-label*="停止"]','button[aria-label*="Stop"]','button[class*="stop"]','[class*="stop-button"]'],
    complete:['button[aria-label*="复制"]','button[aria-label*="Copy"]','[class*="copy-button"]','[data-testid="copy-button"]'],
    root:['main','[role="main"]','[class*="chat-content"]'],
    conversation:/\/chat\/[^/]+/
  },
  doubao: {
    input:['textarea.semi-input-textarea','[contenteditable="true"]','textarea'],
    answer:['[class*="v_list_row"][data-observe-row]:not(:has([class*="bg-g-send"]))','[data-role="assistant"]','[class*="assistant"] [class*="content"]'],
    user:['[class*="v_list_row"][data-observe-row]:has([class*="bg-g-send"])','[data-role="user"]'],
    send:['button[class*="send-msg-btn"]','button[class*="g-send-msg"]','button[aria-label*="发送"]','[data-testid="send-button"]'],
    stop:['button[aria-label*="停止"]','button[aria-label*="Stop"]','button[class*="stop"]','[data-testid="stop-button"]'],
    complete:['button[aria-label*="复制"]','[data-testid="copy-button"]','[class*="copy-button"]','button[aria-label*="Copy"]'],
    root:['main','[role="main"]','[class*="message-list"]'],
    conversation:/\/chat\/[^/?]+/
  }
};
