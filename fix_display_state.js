const fs = require('fs');

let content = fs.readFileSync('src/utils/reservationStatus.ts', 'utf8');

const oldEnd = \  // 5. Receipt submitted / under review
  if (bucket === 'toPay' && ['submitted', 'processing'].includes(paymentStatus)) {
    return {
      label: 'Payment Under Review',
      bucket: 'paymentUnderReview',
      filterBucket: 'toPay',
      badgeColorType: 'paymentUnderReview',
      showCountdown: countdown === true && Boolean(reservation.payment_due_at),
      showToPayAction: false,
    };
  }

  // 6. Genuine unpaid To Pay
  return {
    label: 'To pay',
    bucket: 'toPay',
    filterBucket: 'toPay',
    badgeColorType: 'toPay',
    showCountdown: countdown !== false && Boolean(reservation.payment_due_at),
    showToPayAction: true,
  };
}
\;

const newEnd = \  // 5. Receipt submitted / under review
  if (bucket === 'toPay' && ['submitted', 'processing'].includes(paymentStatus)) {
    return {
      label: 'Payment Under Review',
      bucket: 'paymentUnderReview',
      filterBucket: 'toPay',
      badgeColorType: 'paymentUnderReview',
      showCountdown: countdown === true && Boolean(reservation.payment_due_at),
      showToPayAction: false,
    };
  }

  // 6. Payment Window Expired
  // If the deadline passed and payment wasn't submitted, it's expired.
  // The backend cron will sweep it shortly, but the frontend state must immediately
  // revoke payment controls to prevent contradictions.
  const isExpired = reservation.payment_due_at ? new Date(reservation.payment_due_at).getTime() < Date.now() : false;
  
  if (isExpired && bucket === 'toPay') {
    return {
      label: 'Expired',
      bucket: 'cancelled',
      filterBucket: 'cancelled',
      badgeColorType: 'cancelled',
      showCountdown: false,
      showToPayAction: false,
    };
  }

  // 7. Genuine unpaid To Pay
  return {
    label: 'To pay',
    bucket: 'toPay',
    filterBucket: 'toPay',
    badgeColorType: 'toPay',
    showCountdown: countdown !== false && Boolean(reservation.payment_due_at),
    showToPayAction: true,
  };
}
\;

content = content.replace(oldEnd, newEnd);
fs.writeFileSync('src/utils/reservationStatus.ts', content);
console.log('done');
