// components/chat-bot.js — 浮动聊天机器人组件
import { api } from '../api.js';
import { icon } from '../icons.js';

let initialized = false;
let chatOpen = false;

export function initChatBot() {
  if (initialized) return;
  initialized = true;

  // 创建容器
  const container = document.createElement('div');
  container.id = 'chat-bot-container';
  container.innerHTML = `
    <style>
      #chat-bot-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        font-family: var(--font-sans, 'Inter', system-ui, sans-serif);
      }
      .chat-bot-toggle {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: var(--bg-sidebar, #2C2C2C);
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 1.25rem;
        box-shadow: 0 4px 16px rgba(44,44,44,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
      }
      .chat-bot-toggle:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(44,44,44,0.35);
      }
      .chat-bot-toggle .badge-dot {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 10px;
        height: 10px;
        background: var(--accent-green, #059669);
        border-radius: 50%;
        border: 2px solid #fff;
      }
      .chat-bot-window {
        position: absolute;
        bottom: 64px;
        right: 0;
        width: 360px;
        max-height: 520px;
        background: var(--bg-card, #fff);
        border-radius: var(--radius-xl, 12px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        display: none;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--border-default, #E5E5E4);
      }
      .chat-bot-window.open {
        display: flex;
      }
      .chat-bot-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        background: var(--bg-sidebar, #2C2C2C);
        color: #fff;
        font-weight: 600;
        font-size: var(--text-sm, 13px);
      }
      .chat-bot-header .close-btn {
        background: none;
        border: none;
        color: rgba(255,255,255,0.6);
        cursor: pointer;
        font-size: 1.1rem;
        padding: 2px;
      }
      .chat-bot-header .close-btn:hover {
        color: #fff;
      }
      .chat-bot-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        min-height: 280px;
        max-height: 360px;
        background: var(--bg-base, #F5F3F0);
      }
      .chat-bot-msg {
        margin-bottom: 12px;
        max-width: 85%;
        line-height: 1.5;
        font-size: var(--text-sm, 13px);
        white-space: pre-wrap;
      }
      .chat-bot-msg.bot {
        margin-right: auto;
      }
      .chat-bot-msg.bot .bubble {
        background: var(--bg-card, #fff);
        border: 1px solid var(--border-light, #F0EFED);
        border-radius: 12px 12px 12px 4px;
        padding: 10px 14px;
        color: var(--text-primary, #2C2C2C);
        box-shadow: var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.04));
      }
      .chat-bot-msg.user {
        margin-left: auto;
      }
      .chat-bot-msg.user .bubble {
        background: var(--bg-sidebar, #2C2C2C);
        color: #fff;
        border-radius: 12px 12px 4px 12px;
        padding: 10px 14px;
      }
      .chat-bot-msg .time {
        font-size: 10px;
        color: var(--text-tertiary, #9CA3AF);
        margin-top: 4px;
        padding: 0 4px;
      }
      .chat-bot-msg.user .time {
        text-align: right;
      }
      .chat-bot-input-area {
        display: flex;
        padding: 10px 12px;
        gap: 8px;
        border-top: 1px solid var(--border-default, #E5E5E4);
        background: var(--bg-card, #fff);
      }
      .chat-bot-input-area input {
        flex: 1;
        border: 1px solid var(--border-default, #E5E5E4);
        border-radius: var(--radius-md, 6px);
        padding: 8px 12px;
        font-size: var(--text-sm, 13px);
        outline: none;
        background: var(--bg-input, #F9F9F8);
        color: var(--text-primary, #2C2C2C);
      }
      .chat-bot-input-area input:focus {
        border-color: var(--border-focus, #2C2C2C);
      }
      .chat-bot-input-area button {
        background: var(--bg-sidebar, #2C2C2C);
        color: #fff;
        border: none;
        border-radius: var(--radius-md, 6px);
        padding: 8px 16px;
        font-size: var(--text-sm, 13px);
        cursor: pointer;
        font-weight: 500;
        white-space: nowrap;
      }
      .chat-bot-input-area button:hover {
        background: #3A3A3A;
      }
      .chat-bot-input-area button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    </style>

    <button class="chat-bot-toggle" id="chat-bot-toggle" aria-label="帮助机器人">
      ${icon('robot', 24)}
      <span class="badge-dot"></span>
    </button>

    <div class="chat-bot-window" id="chat-bot-window">
      <div class="chat-bot-header">
        <span>${icon('robot', 16)} 帮助机器人</span>
        <button class="close-btn" id="chat-bot-close">${icon('close', 16)}</button>
      </div>
      <div class="chat-bot-messages" id="chat-bot-messages">
        <div class="chat-bot-msg bot">
          <div class="bubble">您好！我是艾德尔帮助机器人<br>可以问我关于 <strong>工单、价格、邀请返利</strong> 等问题，我会尽力为您解答！</div>
        </div>
      </div>
      <div class="chat-bot-input-area">
        <input type="text" id="chat-bot-input" placeholder="输入您的问题..." maxlength="200">
        <button id="chat-bot-send">发送</button>
      </div>
    </div>`;

  document.body.appendChild(container);

  // ── 事件绑定 ──────────────────
  const toggleBtn = document.getElementById('chat-bot-toggle');
  const window = document.getElementById('chat-bot-window');
  const closeBtn = document.getElementById('chat-bot-close');
  const input = document.getElementById('chat-bot-input');
  const sendBtn = document.getElementById('chat-bot-send');
  const messagesEl = document.getElementById('chat-bot-messages');

  toggleBtn.addEventListener('click', () => {
    chatOpen = !chatOpen;
    window.classList.toggle('open', chatOpen);
    if (chatOpen) input.focus();
  });

  closeBtn.addEventListener('click', () => {
    chatOpen = false;
    window.classList.remove('open');
  });

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    // 添加用户消息
    addMessage('user', text);
    input.value = '';
    sendBtn.disabled = true;

    // 调用 API
    api.askBot(text)
      .then(res => {
        const answer = res.answer || res.reply || res.message || '抱歉，我暂时无法回答这个问题。';
        addMessage('bot', answer);
      })
      .catch(err => {
        addMessage('bot', '抱歉，我暂时无法回答，请稍后再试。');
      })
      .finally(() => {
        sendBtn.disabled = false;
        input.focus();
      });
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  function addMessage(type, text) {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `chat-bot-msg ${type}`;
    div.innerHTML = `<div class="bubble">${text}</div><div class="time">${time}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}
