const fs = require('fs');
const content = fs.readFileSync('C:/Users/carlv/.gemini/antigravity/brain/3bef4016-6797-48cb-af79-bd0148c5e867/.system_generated/logs/transcript.jsonl', 'utf8');
const lines = content.split('\n');
const userInputs = [];

for (const line of lines) {
  if (line.includes('"type":"USER_INPUT"')) {
    try {
      const obj = JSON.parse(line);
      if (obj.content && obj.content.includes('<USER_REQUEST>')) {
        const text = obj.content.split('<USER_REQUEST>')[1].split('</USER_REQUEST>')[0].trim();
        userInputs.push(text);
      }
    } catch (e) {}
  }
}

console.log(userInputs.slice(-15).map((t, i) => `${i + 1}. ${t.substring(0, 200).replace(/\n/g, ' ')}`).join('\n'));
