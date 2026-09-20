import {
  getCustomerReservationDisplayState,
  getReservationCardActions,
} from '../reservationStatus';

describe('getCustomerReservationDisplayState & getReservationCardActions regression suite', () => {
  const futureDue = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  test('1. unpaid To Pay: displays To pay label, shows countdown when active, and provides To Pay action', () => {
    const resActive = {
      status: 'To Pay',
      payment_status: 'Pending',
      countdown: true,
      payment_due_at: futureDue,
    };
    const stateActive = getCustomerReservationDisplayState(resActive);
    expect(stateActive.label).toBe('To pay');
    expect(stateActive.bucket).toBe('toPay');
    expect(stateActive.badgeColorType).toBe('toPay');
    expect(stateActive.showCountdown).toBe(true);
    expect(stateActive.showToPayAction).toBe(true);

    const actionsActive = getReservationCardActions(resActive);
    expect(actionsActive).toEqual(['toPay', 'cancelReservation']);

    // When countdown flag is false (e.g. paused / legacy)
    const resNoCountdown = {
      status: 'To Pay',
      payment_status: 'Pending',
      countdown: false,
      payment_due_at: futureDue,
    };
    const stateNoCountdown = getCustomerReservationDisplayState(resNoCountdown);
    expect(stateNoCountdown.showCountdown).toBe(false);
    expect(stateNoCountdown.showToPayAction).toBe(true);
    expect(getReservationCardActions(resNoCountdown)).toEqual(['toPay', 'cancelReservation']);
  });

  test('2. paid but still To Pay: displays Payment Received, hides countdown, and suppresses To Pay button', () => {
    const resPaid = {
      status: 'To Pay',
      payment_status: 'Paid',
      countdown: false,
      payment_due_at: futureDue,
    };
    const statePaid = getCustomerReservationDisplayState(resPaid);
    expect(statePaid.label).toBe('Payment Received');
    expect(statePaid.bucket).toBe('paymentReceived');
    expect(statePaid.badgeColorType).toBe('paymentReceived');
    expect(statePaid.showCountdown).toBe(false);
    expect(statePaid.showToPayAction).toBe(false);

    const actions = getReservationCardActions(resPaid);
    expect(actions).toEqual([]);
    expect(actions).not.toContain('toPay');
  });

  test('3. receipt submitted/review state: displays Payment Under Review, suppresses To Pay button, respects countdown flag', () => {
    // Submitted with countdown paused/false
    const resSubmitted = {
      status: 'To Pay',
      payment_status: 'submitted',
      countdown: false,
      payment_due_at: futureDue,
    };
    const stateSubmitted = getCustomerReservationDisplayState(resSubmitted);
    expect(stateSubmitted.label).toBe('Payment Under Review');
    expect(stateSubmitted.bucket).toBe('paymentUnderReview');
    expect(stateSubmitted.badgeColorType).toBe('paymentUnderReview');
    expect(stateSubmitted.showCountdown).toBe(false);
    expect(stateSubmitted.showToPayAction).toBe(false);
    expect(getReservationCardActions(resSubmitted)).toEqual([]);

    // Processing with countdown active
    const resProcessingCountdown = {
      status: 'To Pay',
      payment_status: 'processing',
      countdown: true,
      payment_due_at: futureDue,
    };
    const stateProcessing = getCustomerReservationDisplayState(resProcessingCountdown);
    expect(stateProcessing.label).toBe('Payment Under Review');
    expect(stateProcessing.showCountdown).toBe(true);
    expect(stateProcessing.showToPayAction).toBe(false);
    expect(getReservationCardActions(resProcessingCountdown)).toEqual([]);
  });

  test('4. Preparing: displays Preparing your item, hides countdown and To Pay action', () => {
    const resPreparing = {
      status: 'Preparing',
      payment_status: 'Paid',
      countdown: false,
      payment_due_at: futureDue,
    };
    const statePreparing = getCustomerReservationDisplayState(resPreparing);
    expect(statePreparing.label).toBe('Preparing your item');
    expect(statePreparing.bucket).toBe('preparing');
    expect(statePreparing.badgeColorType).toBe('preparing');
    expect(statePreparing.showCountdown).toBe(false);
    expect(statePreparing.showToPayAction).toBe(false);
    expect(getReservationCardActions(resPreparing)).toEqual([]);
  });

  test('4b. Unclaimed: displays Unclaimed label, suppresses Pay and Cancel, retains unclaimed bucket', () => {
    const resUnclaimed = {
      status: 'Unclaimed',
      payment_status: 'Paid',
      countdown: false,
    };
    const state = getCustomerReservationDisplayState(resUnclaimed);
    expect(state.label).toBe('Unclaimed');
    expect(state.bucket).toBe('unclaimed');
    expect(state.filterBucket).toBe('unclaimed');
    expect(state.badgeColorType).toBe('unclaimed');
    expect(state.showCountdown).toBe(false);
    expect(state.showToPayAction).toBe(false);
    // No Pay or Cancel actions for an Unclaimed reservation
    const actions = getReservationCardActions(resUnclaimed);
    expect(actions).toEqual([]);
    expect(actions).not.toContain('toPay');
    expect(actions).not.toContain('cancelReservation');
  });

  test('5. Refund Required: prioritizes refund in progress and offers viewRefund action', () => {
    const resRefundRequired = {
      status: 'Cancelled',
      payment_status: 'Refund Required',
      countdown: false,
    };
    const state = getCustomerReservationDisplayState(resRefundRequired);
    expect(state.label).toBe('Refund in Progress');
    expect(state.bucket).toBe('returnRefund');
    expect(state.badgeColorType).toBe('cancelled');
    expect(state.showCountdown).toBe(false);
    expect(state.showToPayAction).toBe(false);
    expect(getReservationCardActions(resRefundRequired)).toEqual(['viewRefund']);

    // Even if contradictory status is still 'To Pay', priority 1 catches refund required
    const contradictoryRes = {
      status: 'To Pay',
      payment_status: 'Refund Required',
    };
    const contradictoryState = getCustomerReservationDisplayState(contradictoryRes);
    expect(contradictoryState.label).toBe('Refund in Progress');
    expect(contradictoryState.showToPayAction).toBe(false);
    expect(getReservationCardActions(contradictoryRes)).toEqual(['viewRefund']);
  });

  test('6. Refunded: displays Refunded and offers buyAgain action', () => {
    const resRefunded = {
      status: 'Cancelled',
      payment_status: 'Refunded',
    };
    const state = getCustomerReservationDisplayState(resRefunded);
    expect(state.label).toBe('Refunded');
    expect(state.bucket).toBe('returnRefund');
    expect(state.showCountdown).toBe(false);
    expect(state.showToPayAction).toBe(false);
    expect(getReservationCardActions(resRefunded)).toEqual(['buyAgain']);
  });

  test('7. Completed: displays Completed with eligible return/rating actions', () => {
    const now = Date.now();
    const recentDate = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const expiredDate = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const resEligibleUnrated = {
      status: 'Completed',
      payment_status: 'Paid',
      completed_at: recentDate,
      reviewed: false,
    };
    const state = getCustomerReservationDisplayState(resEligibleUnrated);
    expect(state.label).toBe('Completed');
    expect(state.bucket).toBe('completed');
    expect(state.badgeColorType).toBe('completed');
    expect(state.showCountdown).toBe(false);
    expect(state.showToPayAction).toBe(false);
    expect(getReservationCardActions(resEligibleUnrated, { referenceTime: now })).toEqual([
      'returnRefund',
      'rate',
    ]);

    const resEligibleRated = {
      ...resEligibleUnrated,
      reviewed: true,
    };
    expect(getReservationCardActions(resEligibleRated, { referenceTime: now })).toEqual([
      'returnRefund',
    ]);

    const resExpired = {
      status: 'Completed',
      payment_status: 'Paid',
      completed_at: expiredDate,
      reviewed: false,
    };
    expect(getReservationCardActions(resExpired, { referenceTime: now })).toEqual([
      'buyAgain',
      'rate',
    ]);

    const resExpiredRated = {
      ...resExpired,
      reviewed: true,
    };
    expect(getReservationCardActions(resExpiredRated, { referenceTime: now })).toEqual([
      'buyAgain',
    ]);
  });

  test('8. Multi-item review resolution: Rate button stays visible as long as hasUnratedItems is true', () => {
    const now = Date.now();
    const recentDate = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    // Partially rated multi-item order (1 of 2 rated -> hasUnratedItems: true)
    const partiallyRatedOrder = {
      status: 'Completed',
      payment_status: 'Paid',
      completed_at: recentDate,
      hasUnratedItems: true,
      isFullyRated: false,
    };
    expect(getReservationCardActions(partiallyRatedOrder, { referenceTime: now })).toEqual([
      'returnRefund',
      'rate',
    ]);

    // Fully rated multi-item order (2 of 2 rated -> hasUnratedItems: false, isFullyRated: true)
    const fullyRatedOrder = {
      status: 'Completed',
      payment_status: 'Paid',
      completed_at: recentDate,
      hasUnratedItems: false,
      isFullyRated: true,
    };
    expect(getReservationCardActions(fullyRatedOrder, { referenceTime: now })).toEqual([
      'returnRefund',
    ]);
  });

  test('9. Return/refund request operational states: display Under Review and viewRefund action', () => {
    const resSubmitted = {
      status: 'Completed',
      payment_status: 'Paid',
      refund_request_status: 'submitted',
      hasUnratedItems: true,
    };
    const stateSubmitted = getCustomerReservationDisplayState(resSubmitted);
    expect(stateSubmitted.label).toBe('Refund Under Review');
    expect(stateSubmitted.bucket).toBe('returnRefund');
    expect(stateSubmitted.badgeColorType).toBe('paymentUnderReview');
    expect(getReservationCardActions(resSubmitted)).toEqual(['viewRefund', 'rate']);

    const resSubmittedRated = {
      ...resSubmitted,
      hasUnratedItems: false,
      isFullyRated: true,
    };
    expect(getReservationCardActions(resSubmittedRated)).toEqual(['viewRefund']);

    // Admin approved refund request -> Refund in Progress / viewRefund
    const resApproved = {
      status: 'Completed',
      payment_status: 'Refund Required',
      refund_request_status: 'approved',
    };
    const stateApproved = getCustomerReservationDisplayState(resApproved);
    expect(stateApproved.label).toBe('Refund in Progress');
    expect(getReservationCardActions(resApproved)).toEqual(['viewRefund']);

    // Fully refunded -> Refunded / buyAgain
    const resRefunded = {
      status: 'Completed',
      payment_status: 'Refunded',
      refund_request_status: 'refunded',
    };
    const stateRefunded = getCustomerReservationDisplayState(resRefunded);
    expect(stateRefunded.label).toBe('Refunded');
    expect(getReservationCardActions(resRefunded)).toEqual(['buyAgain']);
  });

  test('10. Cancelled reservation: unpaid cancelled reservation with payment_status: Cancelled', () => {
    const resCancelled = {
      status: 'Cancelled',
      payment_status: 'Cancelled',
      countdown: false,
    };
    const state = getCustomerReservationDisplayState(resCancelled);
    expect(state.label).toBe('Cancelled');
    expect(state.bucket).toBe('cancelled');
    expect(state.badgeColorType).toBe('cancelled');
    expect(state.showCountdown).toBe(false);
    expect(state.showToPayAction).toBe(false);
    expect(getReservationCardActions(resCancelled)).toEqual([]);

    // Contradictory status with payment_status = Cancelled
    const contradictoryRes = {
      status: 'To Pay',
      payment_status: 'Cancelled',
      countdown: true,
      payment_due_at: futureDue,
    };
    const contradictoryState = getCustomerReservationDisplayState(contradictoryRes);
    expect(contradictoryState.label).toBe('Cancelled');
    expect(contradictoryState.bucket).toBe('cancelled');
    expect(contradictoryState.showCountdown).toBe(false);
    expect(contradictoryState.showToPayAction).toBe(false);
    expect(getReservationCardActions(contradictoryRes)).toEqual([]);
  });
});
