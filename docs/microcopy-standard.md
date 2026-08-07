# Microcopy standard

What the app already does well, written down so it stops drifting. Every rule below
is derived from the existing copy rather than imposed on it -- the corpus was mostly
consistent already, and the problems were duplicates and strays, not a wrong voice.

## Voice

Plain, calm, second person. The customer is "you"; the boutique is "we". No
exclamation marks, no apology theatre, no personality where information will do.

This is **reserve-and-collect**, not e-commerce checkout. Avoid "buy", "purchase",
"order" and "shopping" for the reservation flow. The customer reserves an item and
collects it; money is a deposit and a balance, not a payment for goods shipped.

## Errors

The house pattern is:

> Could not *[do the thing]*. Please try again.

- Name what failed in the customer's terms, not the system's. "Could not upload that
  photo", never "Could not upload the image to storage".
- Drop "Please try again" when trying again will not help. A password mismatch needs
  retyping, not retrying, so it is just "Passwords do not match."
- Never surface a raw `error.message`. Log it, show written copy. A Supabase
  `AuthApiError` string is not customer copy.
- One message per failure. If two screens can fail the same way, they say the same
  words -- the same failure described two ways reads as two different bugs.

## Validation

> Please *[do the thing]*.

"Please enter your first and last name." "Please use at least 8 characters." Says
what to do, not what went wrong. Avoid positional wording -- "the field above"
breaks the moment the layout changes.

## Buttons and calls to action

Title Case, and name the destination or the outcome. "Explore Catalog", "Save
Profile", "Update Password", "Reserve Now".

Where several screens send the customer to the same place, they use the same words.
The three empty states that lead to the Explore tab all say **Explore Catalog**;
they previously said "Start Shopping", "Browse Catalog" and "Explore Catalog", which
read as three different destinations.

`accessibilityLabel` should match the visible label. A voice-control user says what
they can see.

## Empty states

Three parts: what is empty, why that is fine, and one way out.

> Your bag is empty
> Looks like you haven't added anything to your bag yet.
> [Explore Catalog]

When a filter is empty rather than the whole screen, quote the filter rather than
interpolating its key: *Nothing under "To pay"*, not *No toPay reservations*.

## Form labels

Sentence case in the string. If the design wants capitals, that is
`textTransform: 'uppercase'` in the style.

This is not a preference. A screen reader given literal `ZIP CODE` reads it letter by
letter; given "Zip code" styled as caps, it reads the words and the customer sees the
same thing. Fifteen labels across the auth and profile forms had caps baked into the
string.

## Status words

Customer-facing status comes from `src/utils/reservationStatus.ts`, never from the
stored value. The database stores `Confirmed` for a reservation that is approved and
unpaid; the customer is told **To pay**, because that is what it means for them, and
because it is what the shop's own dashboard shows staff for the same row.

## Numbers and money

Peso sign, two decimals on money the customer owes: `₱945.00`. Say what the amount
is for -- "Balance on collection", "To pay once accepted (50%)" -- not just "Total".

## Before adding a string

Search for it first. Most of the drift in this app came from writing a second version
of a message that already existed rather than from writing a bad one.
