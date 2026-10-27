// AI 图片输入可行性实测：用应用真实配置（appsettings.Local.json 的 key，绝不打印）
// 测 A：纯图片理解（base64 data URL + mimo-v2.6-flash）
// 测 B：图片 + function calling 同包（模拟应用的真实 payload 形态，含 thinking disabled）
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('D:/projects/checkin/CheckinApp/appsettings.Local.json', 'utf8'));
const key = (cfg.Ai && cfg.Ai.ApiKey) || '';
if (!key) { console.log('NO KEY in appsettings.Local.json'); process.exit(1); }

const BASE = 'https://api.xiaomimimo.com/v1';
const MODEL = 'mimo-v2.6-flash';

const img = fs.readFileSync('D:/projects/checkin/_shots/m2_ai_input.png');
const b64 = img.toString('base64');
const dataUrl = 'data:image/png;base64,' + b64;
console.log('image bytes=' + img.length + ' b64 chars=' + b64.length);

async function call(payload, label) {
  const t0 = Date.now();
  const resp = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': key,
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify(payload),
  });
  const ms = Date.now() - t0;
  const text = await resp.text();
  console.log('--- ' + label + ' ---');
  console.log('HTTP ' + resp.status + '  ' + ms + 'ms');
  if (!resp.ok) { console.log('BODY: ' + text.slice(0, 500)); return null; }
  const doc = JSON.parse(text);
  const msg = doc.choices[0].message;
  console.log('content: ' + (msg.content || '').slice(0, 200).replace(/\n/g, ' '));
  if (msg.tool_calls) {
    console.log('tool_calls: ' + msg.tool_calls.map(c => c.function.name + '(' + c.function.arguments.slice(0, 80) + ')').join(' | '));
  }
  console.log('usage: ' + JSON.stringify(doc.usage));
  return doc;
}

(async () => {
  // 测 A：纯图片理解
  await call({
    model: MODEL,
    messages: [
      { role: 'system', content: '你是生活管家应用的 AI 助手。' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: '一句话说明这张截图里的界面元素。' },
      ] },
    ],
    max_completion_tokens: 200,
    thinking: { type: 'disabled' },
  }, 'A 纯图片理解');

  // 测 B：图片 + function calling（应用真实形态：tools + tool_choice required）
  await call({
    model: MODEL,
    messages: [
      { role: 'system', content: '你是生活管家应用的 AI 助手。需要写数据时调用工具。' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: '截图里这个输入框的提示文字是什么？另外帮我记一条明天下午3点开会的日程。' },
      ] },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'create_schedule',
        description: '创建日程',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '标题' },
            start: { type: 'string', description: '开始时间 ISO' },
          },
          required: ['title', 'start'],
        },
      },
    }],
    tool_choice: 'required',
    max_completion_tokens: 400,
    thinking: { type: 'disabled' },
  }, 'B 图片+function calling 同包');
})();
