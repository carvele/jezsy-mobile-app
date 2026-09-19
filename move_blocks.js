const fs = require('fs');
let lines = fs.readFileSync('app/reservations/[id].tsx', 'utf8').split('\n');

let appointmentStart = -1;
let locationEnd = -1;
let insertPoint = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('>Appointment</Text>')) {
    appointmentStart = i - 2; // the <View style={[styles.sectionCard... line
  }
  if (lines[i].includes('>Location</Text>')) {
    // Find the end of this block
    for (let j = i; j < lines.length; j++) {
      if (lines[j].includes('      {paymentState === \'refund required\' && (')) {
        locationEnd = j - 2;
        break;
      }
    }
  }
  if (lines[i].includes('{displayItems.length > 1 && (')) {
    insertPoint = i;
  }
}

if (appointmentStart === -1 || locationEnd === -1 || insertPoint === -1) {
  console.log('Failed to find indices', {appointmentStart, locationEnd, insertPoint});
  process.exit(1);
}

const blocks = lines.splice(appointmentStart, locationEnd - appointmentStart + 1);

// We removed elements, so insertPoint might have shifted.
// But since appointmentStart > insertPoint, insertPoint is unchanged!
lines.splice(insertPoint, 0, ...blocks);

fs.writeFileSync('app/reservations/[id].tsx', lines.join('\n'));
console.log('Done');
