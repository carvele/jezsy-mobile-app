const fs = require('fs');

let content = fs.readFileSync('app/reservations/[id].tsx', 'utf8');

// 1. Update the manual button labels
content = content.replace(
  /if \(gcashEnabled && !bankEnabled\) return 'Pay via GCash transfer \/ Upload receipt';\s+if \(bankEnabled && !gcashEnabled\) return 'Pay via bank transfer \/ Upload receipt';\s+return 'Pay by transfer \/ Upload receipt';/,
  \eturn 'Upload payment receipt';\
);

content = content.replace(
  /if \(gcashEnabled && !bankEnabled\) return 'Pay balance via GCash \/ Upload receipt';\s+if \(bankEnabled && !gcashEnabled\) return 'Pay balance via bank \/ Upload receipt';\s+return 'Pay balance by transfer \/ Upload receipt';/,
  \eturn 'Upload balance receipt';\
);

fs.writeFileSync('app/reservations/[id].tsx', content);
console.log('done labels');
