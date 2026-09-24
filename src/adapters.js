// 精确选择器优先；站点知识参考 AI-Arena 与 2026-09 实测，不继承旧版全局补丁、兜底全文扫描与自动重发。
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
    // Logged-out states: DeepSeek redirects to /sign_in; the others show a login entry.
    login:{url:/^\/sign_in/},
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
    login:{selectors:['.not-login-icon','.next-sidebar-history-list__login']},
    root:['main','[role="main"]','[class*="chat-content"]'],
    conversation:/\/chat\/[^/]+/
  },
  // Gemini 2026-09: Quill editor. Stop disappears ~1.5 s before the answer body drops
  // aria-busy; message-actions and the "complete" footer appear only after that.
  gemini: {
    input:['rich-textarea .ql-editor[contenteditable="true"]','.ql-editor[contenteditable="true"]','[role="textbox"][contenteditable="true"]'],
    answer:['model-response'],
    body:'.markdown.markdown-main-panel',
    user:['user-query'],
    userBody:'.query-text',
    send:['button[aria-label="Send message"]','button[aria-label*="Send message" i]','button[aria-label*="发送"]','button.send-button'],
    stop:['button[aria-label="Stop response"]','button[aria-label*="Stop response" i]','button[aria-label*="Stop generating" i]','button[aria-label*="停止"]'],
    busy:['model-response .markdown[aria-busy="true"]'],
    complete:['message-actions button[aria-label="Copy"]','message-actions button[aria-label*="Copy" i]','message-actions button[aria-label*="复制"]','.response-footer.complete'],
    code:{block:'code-block',language:'.code-block-decoration > span'},
    exclude:'.cdk-visually-hidden,model-thoughts,sources-list,.response-footer',
    root:['chat-window','main','[role="main"]'],
    conversation:/\/app\/[^/]+/
  },
  // ChatGPT 2026-09 (StyleX build): messages are li[data-message-role]; the assistant item gains
  // data-message-complete when finished. Older builds used data-message-author-role.
  chatgpt: {
    input:['textarea#mobile-composer-prompt','textarea[name="prompt"]','#prompt-textarea[contenteditable="true"]','div.ProseMirror[contenteditable="true"]'],
    answer:['li[data-message-role="assistant"]','[data-message-author-role="assistant"]'],
    body:'[data-assistant-markdown],.markdown',
    user:['li[data-message-role="user"]','[data-message-author-role="user"]'],
    userBody:'[data-user-message-copy],.whitespace-pre-wrap',
    userKeyAttribute:'id',
    send:['button[aria-label="Send message"]','button[aria-label="Send prompt"]','[data-testid="send-button"]','button[aria-label*="发送"]'],
    stop:['button[aria-label="Stop streaming"]','button[aria-label*="Stop generating" i]','[data-testid="stop-button"]','button[aria-label*="Stop" i]:not([aria-label*="dictation" i])','button[aria-label*="停止"]'],
    complete:['[data-message-complete]','[data-assistant-message-actions]','[data-testid="copy-turn-action-button"]'],
    exclude:'[data-message-attribution],[data-message-content-controls],[data-assistant-placeholder-slot]',
    root:['main','[role="main"]'],
    conversation:/\/u?c\/[^/]+/
  },
  // Claude: ProseMirror editor; the answer body reports data-is-streaming while generating.
  claude: {
    input:['div.ProseMirror[contenteditable="true"]','[contenteditable="true"][role="textbox"]'],
    answer:['[data-is-streaming]'],
    body:'.font-claude-response,.font-claude-message',
    user:['[data-testid="user-message"]'],
    send:['button[aria-label="Send message"]','button[aria-label="Send Message"]','button[aria-label*="发送"]'],
    stop:['button[aria-label="Stop response"]','button[aria-label="Stop Response"]','button[aria-label*="停止"]'],
    busy:['[data-is-streaming="true"]'],
    complete:['[data-is-streaming="false"]'],
    exclude:'.sr-only,details,[data-testid*="thinking" i]',
    login:{url:/^\/(login|logout)/},
    root:['main','[role="main"]'],
    conversation:/\/chat\/[^/]+/
  },
  // Grok: guests get a sign-up card instead of an answer after the first prompt.
  grok: {
    input:['textarea[aria-label="Ask Grok anything"]','div.tiptap.ProseMirror[contenteditable="true"]','[contenteditable="true"][role="textbox"]'],
    answer:['[id^="response-"]:has(.response-content-markdown)'],
    body:'.response-content-markdown',
    user:['[id^="response-"]:not(:has(.response-content-markdown))'],
    send:['button[aria-label="Submit"]','button[aria-label="提交"]','button[type="submit"]'],
    stop:['button[aria-label="Stop model response"]','button[aria-label*="Stop" i]','button[aria-label*="停止"]'],
    complete:['.action-buttons button[aria-label="Copy"]','button[aria-label="Regenerate"]'],
    login:{selectors:['[data-testid="anon-paywall-sign-up-card"]']},
    root:['main','[role="main"]'],
    conversation:/\/c\/[^/]+/
  },
  // 元宝: Quill editor; one answer is an ai list item, its toolbar shows once finished.
  yuanbao: {
    input:['.ql-editor[contenteditable="true"]','[contenteditable="true"]'],
    answer:['.agent-chat__list__item--ai'],
    body:'.agent-chat__conv--ai__speech_show',
    user:['.agent-chat__list__item--human'],
    userBody:'.hyc-content-text,.agent-chat__bubble__content',
    send:['#yuanbao-send-btn','[class*="send-btn"]:not([class*="disabled"])','button[aria-label*="发送"]','button[aria-label*="Send" i]'],
    stop:['[aria-label="Stop Answering"]','[aria-label*="停止"]','[class*="stop-btn"]'],
    complete:['.agent-chat__conv--ai__toolbar'],
    exclude:'[class*="think"],[class*="process"],[class*="deep-search"],[class*="timeline"],[class*="sources"]',
    login:{selectors:['.agent-dialogue__tool__login','.agent-dialogue__content--common__header.nologin','.hyc-login__dialog']},
    root:['main','[role="main"]','.agent-chat__list'],
    conversation:/\/chat\/[^/]+\/[^/]+/
  },
  // 千问 (www.qianwen.com) 2026-09: Slate editor; answers carry a feedback toolbar once finished.
  // Recommendation cards after the answer are excluded (AI-Arena qwen-noise-filter).
  qwen: {
    input:['[data-slate-editor="true"][contenteditable="true"]','[role="textbox"][contenteditable="true"]'],
    answer:['[data-chat-answers-wrap]'],
    body:'.qk-markdown',
    user:['[data-chat-question-wrap]'],
    userBody:'.question-text-card',
    userKeyAttribute:'data-chat-question-wrap',
    send:['button[aria-label="发送消息"]','button[data-session-switch-target="send-query"]','button[aria-label*="发送"]'],
    stop:['button[aria-label="停止回答"]','button[aria-label*="停止"]'],
    complete:['[data-answer-feedback-toolbar]'],
    exclude:'script,style,.react-syntax-highlighter-line-number,[class*="video_note_list"],[class*="video-item-"],[class*="note-item-"],[class*="doc-item-"],[class*="web-item-"],[class*="hydrate"]',
    code:{block:'.qw-md-code',language:'.sticky span'},
    root:['main','[role="main"]','.chat-room-outer-wrap'],
    conversation:/\/chat\/[^/]+/
  },
  doubao: {
    // 2026-09: the home composer stacks tiptap over a textarea that receives the text.
    input:['textarea.semi-input-textarea','textarea','[contenteditable="true"]'],
    editorHandoff:true,
    // 2026-09-23: new conversations render send_message / receive_message with the message ID on
    // message_content; older conversations keep v_list_row[data-observe-row]. Support both.
    answer:['[data-testid="receive_message"]','[class*="v_list_row"][data-observe-row]:not(:has([class*="bg-g-send"]))','[data-role="assistant"]','[class*="assistant"] [class*="content"]'],
    body:'.md-box-root',
    user:['[data-testid="send_message"] [data-testid="message_content"][data-message-id]','[class*="v_list_row"][data-observe-row]:has([class*="bg-g-send"])','[data-role="user"]'],
    userKeyAttribute:['data-observe-row','data-message-id'],
    userBody:'.md-box-root',
    userIdAttribute:'data-message-id',
    // Conversation index entries are buttons whose aria-label is a full earlier prompt.
    send:['#flow-end-msg-send','button[class*="send-msg-btn"]:not([data-index-entry-key])','button[class*="g-send-msg"]:not([data-index-entry-key])','button[aria-label*="发送"]:not([data-index-entry-key])','[data-testid="send-button"]'],
    stop:['[class*="break-btn"]:has(svg path[d^="M12 0.5C18.3513"])','button[aria-label*="停止"]:not([data-index-entry-key])','button[aria-label*="Stop"]:not([data-index-entry-key])','button[class*="stop"]:not([data-index-entry-key])','[data-testid="stop-button"]'],
    complete:['[data-foundation-type="receive-message-action-bar"] button','button[aria-label*="复制"]:not([data-index-entry-key])','[data-testid="copy-button"]','[class*="copy-button"]','button[aria-label*="Copy"]:not([data-index-entry-key])'],
    busy:['.md-box-root[data-streaming="true"]'],
    root:['main','[role="main"]','[class*="message-list"]'],
    blocked:['iframe[src*="verifycenter/captcha"]'],
    login:{selectors:['[data-testid="to_login_button"]']},
    unsupported:['[data-feishu-office-current-doc-old-card]'],
    conversation:/\/chat\/[^/?]+/
  }
};
