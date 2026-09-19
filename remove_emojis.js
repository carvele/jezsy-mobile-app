const fs = require('fs');
const path = require('path');

const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu;

function walk(dir) {
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      walk(file);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      let content = fs.readFileSync(file, 'utf8');
      if (emojiRegex.test(content)) {
        console.log('Removing emojis from ' + file);
        content = content.replace(emojiRegex, '');
        fs.writeFileSync(file, content);
      }
    }
  });
}

walk('components');
console.log('Done');
