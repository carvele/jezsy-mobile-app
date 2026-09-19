const fs = require('fs');
let content = fs.readFileSync('app/reservations.tsx', 'utf8');

content = content.replace(
  /case 'cancelled': return colors.error;/,
  "case 'cancelled': return colors.error;\n      case 'refunded': return colors.info;"
);

content = content.replace(
  /accessibilityLabel=\{\Reservation \$\{item.display_id \|\| item.id.substring\(0,8\)\}/g,
  "accessibilityLabel={\Reservation \"
);

content = content.replace(
  /ID: \{item.display_id \|\| item.id.substring\(0,8\)\}/g,
  "Reservation #{item.display_id ? item.display_id.split('-').pop() : item.id.substring(0,8)}"
);

fs.writeFileSync('app/reservations.tsx', content);
console.log('done');
