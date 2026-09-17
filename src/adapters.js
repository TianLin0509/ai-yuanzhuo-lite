// 精确选择器优先；仅作为三站适配知识迁移，不继承旧版全局补丁与兜底全文扫描。
globalThis.YuanzhuoAdapters = {
  deepseek: {
    input:['#chat-input','textarea[placeholder]'],
    answer:['.ds-markdown','[data-role="assistant"]'],
    user:['[data-virtual-list-item-key]:has(.fbb737a4)','[data-role="user"]','[class*="user-message"]','.fbb737a4'],
    userBody:'.fbb737a4',
    userKeyAttribute:'data-virtual-list-item-key',
    send:['[data-testid="send-button"]','[role="button"].ds-button--primary.ds-button--circle:has(svg path[d^="M8.3125 0.98"])','button[aria-label*="发送"]','button[aria-label*="Send"]','[role="button"][aria-label*="发送"]'],
    stop:['[role="button"].ds-button--circle:has(svg path[d^="M2 4.88C2 3.68009"])','button[aria-label*="停止"]','button[aria-label*="Stop"]','[role="button"][aria-label*="停止"]','[data-testid="stop-button"]'],
    complete:['[data-testid="copy-button"]','[role="button"]:has(svg path[d^="M6.14929 4.02032"])','button[aria-label*="复制"]','[role="button"][aria-label*="复制"]','button[aria-label*="Copy"]'],
    root:['main','[role="main"]'],
    conversation:/\/a\/chat\/s\/[^/]+|\/chat\/[^/]+/
  },
  kimi: {
    input:['.ProseMirror[contenteditable="true"]','[role="textbox"][contenteditable="true"]','[contenteditable="true"]','textarea'],
    chunkedPaste:'.chat-input-editor[data-lexical-editor="true"]',
    // A used-up quota shows in the composer bar before Send, or as a modal after it.
    limit:{selectors:['.chat-editor .chat-input-bar','.modal-container'],text:/quota is used up|credits used up|额度已用完|额度用完|次数已用完/i},
    draftAttachment:['[data-testid="input-attachment-list"] .file-card-container','.chat-editor-attachment-area .file-card-container'],
    answer:['.segment-assistant','[class*="segment-assistant"]','[data-role="assistant"]','[class*="assistant-segment"]'],
    body:'.markdown-container:not(.toolcall-content-text) > .markdown',
    user:['.segment-user','[class*="segment-user"]','[data-role="user"]'],
    userBody:'.user-content__text',
    // Kimi marks a temporarily unusable send control with a class; clicking it is a no-op.
    send:['.send-button-container:not(.disabled):has(svg[name="Send"])','button[aria-label*="发送"]','button[aria-label*="Send"]','button[class*="send"]','[data-testid="send-button"]'],
    stop:['.send-button-container.stop','button[aria-label*="停止"]','button[aria-label*="Stop"]','button[class*="stop"]','[class*="stop-button"]'],
    complete:['.segment-assistant-actions .icon-button','button[aria-label*="复制"]','button[aria-label*="Copy"]','[class*="copy-button"]','[data-testid="copy-button"]'],
    root:['main','[role="main"]','[class*="chat-content"]'],
    conversation:/\/chat\/[^/]+/
  },
  doubao: {
    // 2026-09: the home composer stacks tiptap over a textarea that receives the text.
    input:['textarea.semi-input-textarea','textarea','[contenteditable="true"]'],
    answer:['[class*="v_list_row"][data-observe-row]:not(:has([class*="bg-g-send"]))','[data-role="assistant"]','[class*="assistant"] [class*="content"]'],
    body:'.md-box-root',
    user:['[class*="v_list_row"][data-observe-row]:has([class*="bg-g-send"])','[data-role="user"]'],
    userKeyAttribute:'data-observe-row',
    userBody:'.md-box-root',
    userIdAttribute:'data-message-id',
    // Conversation index entries are buttons whose aria-label is a full earlier prompt.
    send:['#flow-end-msg-send','button[class*="send-msg-btn"]:not([data-index-entry-key])','button[class*="g-send-msg"]:not([data-index-entry-key])','button[aria-label*="发送"]:not([data-index-entry-key])','[data-testid="send-button"]'],
    stop:['[class*="break-btn"]:has(svg path[d^="M12 0.5C18.3513"])','button[aria-label*="停止"]:not([data-index-entry-key])','button[aria-label*="Stop"]:not([data-index-entry-key])','button[class*="stop"]:not([data-index-entry-key])','[data-testid="stop-button"]'],
    complete:['[data-foundation-type="receive-message-action-bar"] button','button[aria-label*="复制"]:not([data-index-entry-key])','[data-testid="copy-button"]','[class*="copy-button"]','button[aria-label*="Copy"]:not([data-index-entry-key])'],
    busy:['.md-box-root[data-streaming="true"]'],
    root:['main','[role="main"]','[class*="message-list"]'],
    blocked:['iframe[src*="verifycenter/captcha"]'],
    unsupported:['[data-feishu-office-current-doc-old-card]'],
    conversation:/\/chat\/[^/?]+/
  }
};
