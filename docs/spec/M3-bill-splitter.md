# M3 — SHARE → Bill Splitter

Expenses shared with other people: restaurant meals, group trips, hotels,
activities, group shopping, family expenses.

A bill is a **record**, not a calculation. It is saved, it keeps its
participants, and it keeps track of who has paid whom. It is not settled
because the arithmetic is done; it is settled because the money moved.

## Create a bill

Fields: Title · Date · Participants · Paid by · Split method.

    Dinner
    Total:        RM240
    Paid By:      You
    Date:         18 Aug 2026
    Participants: 4

## How a bill is split

One way. Each line goes under the person who had it; anything the table
shared goes in its own card and is divided evenly across everyone.

    You     Pizza    RM50
    John    Pasta    RM40
    Amy     Salad    RM20
    shared  Rice     RM30   → RM10 each

    You RM60 · John RM50 · Amy RM30

A line's name is optional, so somebody who does not want their meal itemised
is one unlabelled figure. That is what became of the methods this module used
to have — equally, by amount, by percentage — and why it does not need them:

| Wanted | Do this |
|---|---|
| An even split | the same figure on every person's line |
| A lump per person | one unlabelled line each |
| A percentage | type the ringgit it comes to |

## Charges

Service charge, SST and a discount apply to every method. Both are taken on the
food after the bill discount, and **SST is not charged on the service charge** —
a Malaysian F&B receipt prints its own tax base and it is the subtotal: RM204.20
of food + 10% service is taxed as "Taxable 204.20 / Tax 12.25", not 6% of 224.62.
A cash bill can be rounded to the nearest 5 sen.

Charges do not change who owes what *proportionally*; they scale every share
by the same factor. They are still part of the bill, so they are part of what
each person pays. The flat fees a delivery adds are the exception, and they
have a section of their own below.

## Delivered rather than sat down

A foodpanda receipt has two lines that are not food and one that is not a
restaurant discount:

    Subtotal              60.00
    Delivery fee           4.99
    Platform fee           1.00
    Voucher              -10.00
    Total                 55.99

**This was a delivery** opens all three. They cannot be said with the
percentages above them, because none of them is a percentage of anything — a
delivery fee is a flat charge for the ride, and the platform fee is a flat
charge for the app.

### How the fees divide

**Evenly, by default.** A flat fee is not bigger because somebody ordered
more; the person who added a drink did not use less of the delivery. The
alternative — dividing them by what each ordered — is the second button, for a
table that would rather they rode on the shares.

    Food     You 40 · JK 15 · Amy 5      fees RM5.99

    evenly            2.00 · 2.00 · 1.99
    by what ordered   3.99 · 1.50 · 0.50

This is the one figure in a person's row that has nothing to do with what they
had, so the row names it rather than letting it read as a share of something
they ordered.

### The voucher, and the discount it is not

The bill already has a discount, and the voucher is not it. Where a discount
sits in the arithmetic is what decides who it moves:

| | Comes off | Because |
|---|---|---|
| a dish's discount | that item, before the weights | it belongs to whoever ate it |
| the bill's discount | the food, before service and SST | a receipt taxes the discounted subtotal |
| the voucher | the order, after the fees | that is where the app takes it off, and "free delivery" has to be able to reach the delivery fee |

Like the bill discount, the voucher scales every share by the same factor, so
it moves nobody's position against anybody else. It is capped at the order, so
no share can go negative — a voucher larger than the bill leaves a bill of
nothing rather than a table owed money.

It is **ringgit by default**, where the bill discount is a percentage by
default, because that is what each of them nearly always is.

A bill saved before any of this has none of the fields, which reads as a bill
nobody delivered — which it was. No migration needed.

## Shared dishes: who had it, and how much

A dish on the **Shared by everyone** card divides between everyone, equally, by
default. That is right for rice, for a jug, for the plate of fries nobody
counted. Two things make it wrong, and each shared dish carries a control for
one of them.

**Not everyone had it.** Four at the table, but only two on the plate. Each
person is a chip under **Shared by**; tap one off and that person is out of
*that dish*, while still sharing everything else.

**They did not have the same amount of it.** Five pao at RM11 where one person
ate three and the other two is **RM6.60 and RM4.40** — splitting it evenly
charges the second person for half a pao they never ate. **Split by portions**
opens a box per person still on the dish, and it divides in that ratio.

They compose: a dish can be shared by two of four, three portions to two.

| | |
|---|---|
| Portions are **counts, not money** | three of five pao, two of three beers, half a slice |
| Portions on, nothing typed | still divides evenly between whoever is on it, and says so |
| A portion of zero | pays nothing for *that dish* — the same answer as tapping the chip off |
| Turned back off | the numbers are kept, so turning it on again finds them |
| The strip | stays quiet and borderless until the dish stops being everyone-equally |

Decisions worth keeping:

- **Both live on the dish, not on the bill.** An even dish, a two-of-four dish
  and a portioned dish all sit in the same bill, which is what a real table
  looks like.
- **Each dish is allocated on its own**, then summed — not allocated over the
  pile of shared dishes at once. Once two dishes divide different ways there is
  no single ratio for the pile, and the odd sen belongs to whoever came up
  short on *that dish*.
- **`out` is an exclusion list, not a guest list.** Somebody added to the bill
  later joins every dish by default, which is what "shared by everyone" has to
  keep meaning. It also makes an untouched bill's field empty.
- **The last person on a dish cannot be dropped.** A dish nobody is on has no
  ratio to divide by and no owner to charge; delete the dish instead. `loadSplit`
  enforces the same rule on the way in, so an edited file cannot produce one.
- **Somebody who sat out every shared dish is not told they had "a share of the
  table"** in the per-person row. They did not.

A bill saved before any of this has none of the fields, which reads as
everyone-equally — exactly what it always was. No migration needed.

### Two kinds of discount

A discount **off the whole bill** scales every share equally and changes
nobody's position relative to anyone else.

A discount **on one dish** does not. It belongs to whoever ate that dish, so it
comes off the item before the shares are worked out, and it moves what that
person owes against everyone else:

    Pizza    RM50 − 40%     → You     RM30
    Dessert  RM40           → John    RM40
    Rice     RM20 shared    → RM10 each

    You pay RM40, John pays RM50.

Per-dish discounts are off by default, because most bills have none and a
column on every line is a lot to carry for a rare case. When they are on, the
tally shows the listed price first and what came off it underneath, the way a
receipt does.

Both discounts are **a percentage by default**, because that is what a promo
almost always is. Ringgit is the second button, for a voucher. Either way the
discount is capped at the thing it comes off, so no share can go negative.

A bill saved before the switch existed recorded ringgit, and is read back as
ringgit — reading it as a percentage would silently rewrite a figure that was
already checked.

## More than one person paid

An evening is often three tills. JK put the pork down at the hotpot, you paid
at NSK, Lavelle bought the drinks at Chagee — one outing, three people out of
pocket, and nothing about it is three separate bills: the shares are worked out
across the whole night and only then does anyone hand anything over.

**More than one person paid** opens a list under the form. One line per
handover — who, what it paid for, how much — because the same person can be at
two counters and a figure per person would lose which was which.

Whatever the list does not account for stays with the person named above it,
which is why the picker stops saying *Paid by* and starts saying *Who paid the
rest*. That single rule is what keeps a bill with no list the same object as
one with it:

| Listed | Left over | Lands on |
|---|---|---|
| nothing | the whole bill | the one payer — which is what this module always was |
| some of it | the remainder | whoever is named under *Who paid the rest* |
| all of it | nothing | nobody; the picker stops mattering |

    Pork    RM90 shared     You     put down RM120 at NSK
    NSK     RM120 shared    JK      RM90 — the rest
    Chagee  RM15 each       Lavelle put down RM45 at Chagee

    Everyone's share: RM85
    net:  You −35 · JK −5 · Lavelle +40

The card reports what the list covers against what the bill comes to, and says
plainly when the two do not meet — payments adding to more than the bill means
a figure is wrong somewhere, not that somebody is owed twice.

### Which lines a payment paid for

A payment names the lines it covered, with the same chips a shared dish uses
for **Shared by** — there it is who was on the dish, here it is which dishes
were on the till. A line belongs to one payment; tapping one another payment
already holds moves it, because the alternative is a dead chip and a reader
hunting for which row has it.

A payment that names lines is **worth what those lines come to**, charges and
all, and its box stops being a field. Typing a second answer beside one the
bill already knows is the thing this module refuses to do everywhere else —
there is no total field on the form for exactly that reason. A payment that
names nothing is a lump, and is worth what was typed.

## Settlement

Two honest ways to clear the same debts, and the table picks:

| | |
|---|---|
| **Fewest handovers** | net every share against what that person put down, then match the biggest debt to the biggest credit |
| **Pay back whoever paid** | everyone pays their share of each line to whoever paid for that line |

Netting is the default because it is the fewest transfers. Paying each till
back is the one nobody has to check: every figure in it is somebody's own
share of one thing one person bought, so there is no arithmetic to take on
trust. It costs handovers — eleven against four on a five-person, three-till
hotpot — and it lets the same two people owe each other in both directions,
which is what actually happened when you paid at NSK and Pan bought the paste.

    Kaon paid NSK RM 68.75 — collects RM 55.00
       Lavelle RM 13.75 · Pan RM 13.75 · JK RM 13.75 · Agatha RM 13.75
       (Kaon's own share of it: RM 13.75)

A pair still settles **once**, however many of that payer's lines they were on
— a person hands money over once — so the lines are carried on the handover
and named under it rather than each becoming a handover of its own.

Each person's total is divided across the lines they are on rather than each
line being worked out on its own, so the pieces add back to exactly what they
pay: no line is a sen out and no sen falls between two of them.

A bill saved before the choice existed has no `settleStyle`, which reads as
netted — anything else would show a reader a different set of debts from the
one they ticked off.

### Netting

Each person owes their share less whatever they already put down. Those
figures add to zero — every ringgit somebody is short is a ringgit somebody
else is up — so the handovers always come out even however many people paid.

The biggest debt is matched against the biggest credit until both sides are
empty, which is the shortest list of handovers there is:

    Lavelle → You  RM35
    Lavelle → JK   RM5

rather than Lavelle paying RM40 to one person who then passes RM5 on. Ties
break on position in the bill, so the same bill always produces the same pairs
and a tick cannot land on a handover nobody made.

With one payer this is the list it always was — they are the only person owed,
so everybody else pays them.

Read back **a block per person**, not a list of arrows. A flat list names two
people on every line, so finding your own means scanning both ends of all of
them — and somebody paying two people reads as two unrelated debts rather than
one debt split to clear two creditors. Under a person's own name sits their
share, what they put in, and the figure those two produce:

    JK — share RM 43.45, put in nothing
       pays Kaon   RM 17.79
       pays Agatha RM 25.66

    Agatha — share RM 43.44, put in RM 112.55
       collects RM 69.11
       from Lavelle RM 43.45
       from JK      RM 25.66

The collected figure is printed because it is the one a person being paid back
wants, and the one the netting has to be checked against.

A handover is ticked on its own, and each tick is keyed by **the two people in
it**. It used to be keyed by the debtor alone, which named the handover only
because there was one person to owe; a saved bill's ticks are read forward as
that person owing whoever paid the bill, which is who they owed.

The payer is owed by everyone else. Their own share is what they keep.

    You paid RM240.
    Your own share: RM60

    John owes you   RM60
    Amy owes you    RM60
    David owes you  RM60

Each debt is marked settled on its own. When the last one is marked, the bill
is Settled.

If somebody else paid, the direction reverses: *You owe John RM60.*

## Expense integration

A bill is not an expense until the reader says so, and even then only what was
actually theirs.

    Your share is RM60.
    → Add your share to Expense Recorder?

    Expense    RM60
    Category:  Food & Drinks
    Account:   Maybank

**RM60 is recorded, not RM240.** The other RM180 was never the reader's money
— it was lent for the length of a dinner.

The other switch, *the whole bill*, records what actually left the reader's
account, so that it matches a bank statement and repayments come back off it.
Where several people paid, that is their part of the night rather than the
bill total — the RM120 at NSK, not the RM255 the table came to.

The bill remembers the entry it created. Removing the link deletes that entry;
it never leaves a second copy behind. This is the *record once* rule: the
ledger entry is the record, and every total in the app reads it from there.

## Bill history

Saved bills, newest first: date · title · total · your share · status.

Filters: Open · Settled · All.

Actions: open · duplicate · delete.

## Persistence

`bills`, `bill participants`, `bill payments` and `bill settlements` are saved
together under one key and included in the backup file.

A bill saved before there could be more than one payer has no payment list,
which reads as the one payer covering the lot — the same bill it always was.
No migration needed beyond the settlement keys above.

### Methods that no longer exist

The module shipped with four ways to split and ended with one. Every retired
method is read forward on load, because a saved bill is a record and a record
must never come back reading differently.

`equal`, `custom`, `percent` and `share` all stored **a number per person and
no lines**. Each is turned into one unlabelled line under its owner:

| Saved as | Becomes |
|---|---|
| `equal` RM100 ÷ 3 | `33.34` · `33.33` · `33.33` |
| `custom` 80 / 40 / 20 | `80` · `40` · `20` |
| `percent` 40/20/20/20 of RM240 | `96` · `48` · `48` · `48` |
| `share` + `shareUnit` | whichever of the two it was |

The division goes through `allocateSen`, so the sen that will not split three
ways still lands somewhere and the shares add back to the total exactly.
