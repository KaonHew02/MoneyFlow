/**
 * ====================================================================
 * MoneyFlow — Understand Your Money. Manage Your Future.
 * --------------------------------------------------------------------
 * Four modules share one page, one stylesheet and one set of helpers:
 *
 *   Expenses        — the daily ledger the whole app is really for
 *   Bill Split      — a Malaysian restaurant bill, split by what you ate
 *   Planner         — where a period's income should go, and where it went
 *   Card Payoff     — how long a credit card balance really takes to clear
 *
 * The ledger is the one that keeps data; the other three only ever read what
 * is on their own screen.
 *
 * Everything recalculates live as the user types — there is no submit step.
 * ====================================================================
 */
/**
 * Read a saved blob. Anything written before the app was renamed sits under
 * the old "moneysplitor." prefix, so a missing key falls back to it once —
 * the next save writes it back under the current name.
 */
/** Records come from `MFStore`, which mirrors them in memory so this can stay
 *  synchronous whatever it is sitting on. See store.js. */
function storedRaw(key) {
    return MFStore.get(key);
}

/**
 * --------------------------------------------------------------------
 * Writing, and admitting when it did not work
 * --------------------------------------------------------------------
 * Every store used to end in `catch (err) { /* storage unavailable *\/ }`. That
 * is right about a private window, where nothing can be written and the
 * session should still work. It is badly wrong about a full quota: the app
 * would keep running, showing everything typed, and lose the lot on reload —
 * and a Drive copy is no help, because it uploads what was *written*, not
 * what is on screen.
 *
 * So there is one door out, it remembers whether the last write landed, and
 * the topbar says so when it did not.
 */
let storeBroken = false;
let storeBrokenWhy = '';
let storeMeasured = 0;

function storeWrite(key, value) {
    MFStore.set(key, value);
    if (Date.now() - storeMeasured > 10000) paintStoreAlert();

    // On the localStorage fallback the write has already happened by now, so
    // this is the truth. On IndexedDB it is optimistic — the flush lands a
    // moment later, and `storeReport` is what says otherwise.
    if (storeBroken) return false;

    // Tell the Drive layer a record moved. It does nothing unless the reader
    // has switched auto-push on, and it is absent entirely when drive.js did
    // not load — so this stays a one-way nudge. A write that did not land must
    // not trigger one, or Drive would be sent a copy that is already stale.
    stampSaved();
    if (typeof window.MFDriveTouch === 'function') window.MFDriveTouch();
    return true;
}

/**
 * --------------------------------------------------------------------
 * "Saved 20:02"
 * --------------------------------------------------------------------
 * There is no Save button here — everything typed is in the store before you
 * look up from the keyboard. That is the right behaviour and it is completely
 * invisible, which leaves people asking the reasonable question of whether any
 * of it is being kept at all. One time in the corner answers it.
 *
 * The stamp lives in localStorage rather than alongside the records: it
 * belongs to this browser and not to the book, and an exported file carrying
 * somebody else's save time would be a small lie.
 */
const SAVED_KEY = 'moneyflow.savedAt';

function stampSaved() {
    try { localStorage.setItem(SAVED_KEY, new Date().toISOString()); } catch (err) { /* not vital */ }
    paintSaveStamp();
}

function paintSaveStamp() {
    const el = document.getElementById('saveStamp');
    if (!el) return;

    let stamp = null;
    try { stamp = localStorage.getItem(SAVED_KEY); } catch (err) { stamp = null; }
    if (!stamp) { el.textContent = ''; return; }

    // A bare time is only the truth on the day it was written — "Saved 20:02"
    // beside a book last touched last week reads as tonight. Older than today
    // and it becomes a date instead.
    const then = new Date(stamp);
    const today = then.toDateString() === new Date().toDateString();
    el.textContent = 'Saved ' + (today
        ? then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
}

/** Handed to `MFStore` at start-up: the one place a write's fate is noticed.
 *  `null` means the last one landed, which is how the warning clears. */
function storeReport(err) {
    if (!err) {
        if (!storeBroken) return;
        storeBroken = false;
        storeBrokenWhy = '';
        paintStoreAlert();
        return;
    }
    storeBroken = true;
    storeBrokenWhy = (err && err.name === 'QuotaExceededError')
        || /quota|exceeded|full/i.test(String(err && err.message))
        ? 'quota'
        : 'blocked';
    paintStoreAlert();
}

/**
 * Roughly what MoneyFlow is using, in bytes, broken down by store.
 *
 * `navigator.storage.estimate()` reports the whole origin and is a promise,
 * and neither helps someone deciding what to prune. A per-store figure does:
 * "your bill splits are 2.6 MB of it" is advice you can act on, where
 * "you are at 82%" is only an alarm.
 */
const STORE_LABELS = {
    'moneyflow.ledger.v1':     'entries in Expenses',
    'moneyflow.split.v1':      'saved bill splits',
    'moneyflow.budget.v1':     'saved budgets',
    'moneyflow.goals.v1':      'savings goals',
    'moneyflow.commit.v1':     'instalment plans',
    'moneyflow.card.v1':       'credit cards',
    'moneyflow.grow.v1':       'investments',
    'moneyflow.categories.v1': 'categories and accounts',
};

function storeUsage() {
    return MFStore.usage().map((row) => ({
        key: row.key,
        label: STORE_LABELS[row.key] || row.key,
        bytes: row.bytes,
    }));
}

function storeUsedBytes() {
    return storeUsage().reduce((sum, row) => sum + row.bytes, 0);
}

/** The two or three worth naming when space is running short. */
function storeBiggest(total) {
    return storeUsage()
        .filter((row) => row.bytes / total >= 0.1)
        .slice(0, 3)
        .map((row) => (row.bytes / 1024 / 1024).toFixed(2) + ' MB of ' + row.label);
}

/**
 * What the store will actually take. On IndexedDB the browser is asked and
 * answers in gigabytes; on the localStorage fallback it is the five megabytes
 * every browser allows and none of them will tell you.
 */
const storeBudgetBytes = () => MFStore.budgetBytes();

function paintStoreAlert() {
    const bar = document.getElementById('storeAlert');
    if (!bar) return;

    storeMeasured = Date.now();
    const used = storeUsedBytes();
    const share = used / storeBudgetBytes() * 100;
    const text = document.getElementById('storeAlertText');

    if (storeBroken) {
        bar.hidden = false;
        bar.dataset.tone = 'red';
        if (text) {
            text.textContent = storeBrokenWhy === 'quota'
                ? 'This browser is full, so the last change was NOT saved. Export now, or send a copy ' +
                  'to Drive from another tab, before closing this one — anything typed since the last ' +
                  'successful save exists only on this screen.'
                : 'This browser is refusing to save — a private window does that. Nothing typed here ' +
                  'will survive a reload. Export it to a file before you close the tab.';
        }
        return;
    }

    // Quiet until it is worth saying. Under four fifths of the budget there is
    // nothing useful to tell anyone.
    if (share >= 80) {
        bar.hidden = false;
        bar.dataset.tone = 'amber';
        if (text) {
            const big = storeBiggest(used);
            // Nothing is ever deleted for you. Naming what is large turns a
            // warning into something you can act on.
            text.textContent = 'MoneyFlow is using about ' + Math.round(share) + '% of the space this ' +
                'browser allows (' + (used / 1024 / 1024).toFixed(1) + ' MB) — mostly ' +
                big.join(', ') + '. Nothing is deleted for you: Export a copy to a file first — the ' +
                'Drive copy is overwritten on every save, so deleting here would delete there too — ' +
                'then remove what you no longer need from those tabs.';
        }
        return;
    }

    bar.hidden = true;
}

// Money is counted in sen so the shares can never drift by a fraction of a cent.
const toSen   = (x) => Math.round((Number(x) || 0) * 100);
const fromSen = (s) => s / 100;

/**
 * Divide `totalSen` across `weights` so the parts add back up to exactly the
 * total. Rounding each share on its own leaves the bill a sen or two short or
 * over, so instead every share is floored and the leftover sen go to whoever
 * was rounded down hardest (largest-remainder). Weights that are all zero fall
 * back to an even split, otherwise a table that ordered nothing yet would take
 * the whole charge on one head.
 */
function allocateSen(totalSen, weights) {
    if (!weights.length || totalSen <= 0) return weights.map(() => 0);

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const exact = totalWeight > 0
        ? weights.map((w) => totalSen * w / totalWeight)
        : weights.map(() => totalSen / weights.length);

    const parts = exact.map(Math.floor);
    const order = exact
        .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
        .sort((a, b) => b.remainder - a.remainder);

    let leftover = totalSen - parts.reduce((sum, p) => sum + p, 0);
    for (let k = 0; leftover > 0; k++, leftover--) parts[order[k % order.length].index]++;
    return parts;
}

/**
 * ====================================================================
 * VIEW HELPERS
 * ====================================================================
 */
const $  = (id) => document.getElementById(id);
const fmt   = (x, dp = 2) => x.toLocaleString('en-MY', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const money = (x) => 'RM ' + fmt(x);
const pct   = (x, dp = 1) => fmt(x, dp) + '%';
const set   = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const num   = (id) => parseFloat(($(id) || {}).value) || 0;

/** Names come from the keyboard, so they are escaped before going near innerHTML. */
const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** One id counter for every row the user can add, in either module. */
let seq = 0;
const nextId = (prefix) => prefix + (++seq);

/**
 * ====================================================================
 * BILL SPLIT
 * ====================================================================
 * This module used to be a calculator: type the table's order in, read the
 * four numbers out, close the tab. It answered the easy half of the question.
 * The half anyone is still thinking about on Thursday is *has Amy paid me
 * back yet*, and no amount of arithmetic answers that.
 *
 * So a bill is a record now. It is saved, it keeps the people who were at the
 * table, and each debt is marked settled on its own when the money actually
 * moves. The sums are the same sums; they just no longer disappear when the
 * page closes.
 *
 * One way to divide a bill, arrived at by deleting three.
 *
 * It began as four methods — equally, by amount, by percentage, by item — and
 * the reader took them apart one at a time, each time on the same observation:
 * the buttons were not four different questions, they were one question with
 * the answer written four ways. What is left is a list of lines, each under
 * the person who had it, plus a card of lines the table shared. From those
 * come the weights, one per person:
 *
 *     weight = their own lines + an even cut of the shared ones
 *
 * Everything the deleted methods did survives inside that:
 *
 *   an even split      the same figure on every person's line
 *   a lump per person   one unnamed line each — a label is optional
 *   by percentage       type the ringgit it works out to
 *
 * Everything after the weights — dish discounts, the bill discount, service
 * charge, SST, cash rounding, the sen that will not divide — is one pipeline.
 *
 * The two kinds of discount are the reason the last two methods could merge
 * rather than one of them simply going: a discount off the bill is shared out
 * with the charges, and a discount on a dish stays with the dish. Both live
 * here now, so there is nothing left for a second method to be.
 *
 * `people[0]` is always the reader. It is what "your share" and "owed to you"
 * are measured from, and it is the only share that may ever become an expense.
 *
 */
const SPLIT_KEY = 'moneyflow.split.v1';

const CHARGE_PRESETS = {
    none: { service: 0,  tax: 0 },
    tax:  { service: 0,  tax: 6 },
    svc:  { service: 10, tax: 0 },
    both: { service: 10, tax: 6 },
};

const newItem   = () => ({ id: nextId('i'), label: '', amount: '', off: '' });
const newPerson = () => ({ id: nextId('p'), name: '', items: [newItem()] });
// `items` is which lines this payment paid for. Naming them is what lets the
// bill say "everyone pays back whoever paid" — without them a payment is just
// an amount, and an amount cannot be handed back to the till it came from.
// A line belongs to at most one payment.
const newPayment = () => ({ id: nextId('y'), by: '', label: '', amount: '', items: [] });

/** A blank bill. Two people, because a bill split one way is not a split. */
function newBill() {
    return {
        id: '', seq: 0,
        title: '',
        date: todayIso(),
        people: [newPerson(), newPerson()],
        shared: [],
        paidBy: '',
        // An evening is rarely one till. JK put the pork down at the hotpot,
        // you paid at NSK, Lavelle bought the drinks — one outing, three
        // people out of pocket. `payments` is who handed over what; `paidBy`
        // is whoever covered whatever the list does not account for, which is
        // why a bill with no list at all still reads exactly as it always did:
        // one person paying the lot.
        multiPay: false,
        payments: [],
        // 'net'  — the fewest handovers that leaves everybody square
        // 'till' — everyone pays back whoever paid for what they had, which is
        //          more handovers and no arithmetic anybody has to trust
        settleStyle: 'net',
        service: '0', tax: '0', discount: '', discountUnit: 'pct', round: false,
        itemDiscounts: false, offUnit: 'pct',
        // Ordered in rather than sat down: two flat fees that are not food,
        // and a voucher that comes off once everything else is on the order.
        // Off by default, because most bills are not a delivery and four more
        // fields on every one of them is a lot to carry for the ones that are.
        delivery: false,
        deliveryFee: '', platformFee: '',
        voucher: '', voucherUnit: 'rm',
        // 'even'  — a flat fee is not bigger because somebody ordered more
        // 'order' — unless the table would rather it rode on the shares
        feeSplit: 'even',
        settled: {},
        account: '',
        // 'full' — the whole bill went into Expenses, the way the bank
        //          statement reads it, and a repayment comes back off it.
        // 'share' — only your own share went in, and a repayment is money
        //          moving between two of your own accounts.
        recorded: 'full',
        entryId: '',
        created: '', updated: '',
    };
}

let splitSeq = 0;
let splitState = { bills: [], draft: null, editing: null, filter: 'open' };

/** The bill on screen. Built on first use rather than at load: a blank one
 *  wants today's date, and the date helpers are declared further down. */
const draft = () => splitState.draft || (splitState.draft = newBill());

/** Person 1 is the reader, whether or not they bothered to type a name. */
const personName = (person, index) =>
    person.name.trim() || (index === 0 ? 'You' : 'Person ' + (index + 1));

/** The payer, as an index. A bill whose payer has since been removed falls
 *  back to the reader rather than to nobody. */
function payerIndex(bill) {
    const at = bill.people.findIndex((p) => p.id === bill.paidBy);
    return at >= 0 ? at : 0;
}

/**
 * --------------------------------------------------------------------
 * Reading the form
 * --------------------------------------------------------------------
 * Values are read back out of the inputs on every keystroke — rebuilding the
 * rows mid-typing would throw away the caret, so the DOM is only rebuilt when
 * a row is added or removed, or the method changes shape underneath it.
 */
function readItemRow(line, item) {
    if (!item) return;
    item.label  = line.querySelector('.split-item-label').value;
    item.amount = line.querySelector('.split-item-amount').value;

    // Absent from the row when the per-dish column is off, and the figure
    // already typed into it is kept rather than wiped — turning the column
    // back on should find the discounts where they were left.
    const off = line.querySelector('.split-item-off');
    if (off) item.off = off.value;
}

/** The portions strip under a shared dish, when it has one. */
function readPortions(block, item) {
    if (!item) return;
    item.units = item.units || {};
    block.querySelectorAll('.split-unit').forEach((input) => {
        item.units[input.dataset.person] = input.value;
    });
}

function readSplitState() {
    const bill = draft();

    bill.title  = ($('splitTitle') || {}).value || '';
    bill.date   = ($('splitDate')  || {}).value || bill.date;
    bill.service  = String(num('splitService'));
    bill.tax      = String(num('splitTax'));
    bill.discount = ($('splitDiscount') || {}).value || '';
    bill.round    = !!($('splitRound') || {}).checked;
    bill.itemDiscounts = !!($('splitItemOff') || {}).checked;
    bill.discountUnit = (($('splitDiscountUnit') || {}).dataset || {}).value === 'rm' ? 'rm' : 'pct';
    bill.offUnit      = (($('splitItemOffUnit')  || {}).dataset || {}).value === 'rm' ? 'rm' : 'pct';

    bill.delivery    = !!($('splitDelivery') || {}).checked;
    bill.deliveryFee = ($('splitDeliveryFee') || {}).value || '';
    bill.platformFee = ($('splitPlatformFee') || {}).value || '';
    bill.voucher     = ($('splitVoucher') || {}).value || '';
    bill.voucherUnit = (($('splitVoucherUnit') || {}).dataset || {}).value === 'pct' ? 'pct' : 'rm';
    bill.feeSplit    = (($('splitFeeSplit') || {}).dataset || {}).value === 'order' ? 'order' : 'even';

    const paidBy = ($('splitPaidBy') || {}).value;
    if (bill.people.some((p) => p.id === paidBy)) bill.paidBy = paidBy;

    bill.multiPay = !!($('splitMultiPay') || {}).checked;
    bill.settleStyle = (($('splitSettleStyle') || {}).dataset || {}).value === 'till' ? 'till' : 'net';

    document.querySelectorAll('#splitPayments .split-pay').forEach((row) => {
        const pay = bill.payments.find((x) => x.id === row.dataset.pay);
        if (!pay) return;
        pay.by    = row.querySelector('.split-pay-who').value;
        pay.label = row.querySelector('.split-pay-label').value;

        // A payment that names lines is worth what those lines come to — the
        // box is a readout, not a field, and reading it back would write a
        // formatted figure over the number it was formatted from.
        const amount = row.querySelector('.split-pay-amount');
        if (amount && !amount.readOnly) pay.amount = amount.value;
    });

    document.querySelectorAll('#splitPeople .split-person').forEach((card) => {
        const person = bill.people.find((p) => p.id === card.dataset.person);
        if (!person) return;

        person.name = card.querySelector('.split-name').value;

        card.querySelectorAll('.split-item').forEach((line) => {
            readItemRow(line, person.items.find((item) => item.id === line.dataset.item));
        });
    });

    document.querySelectorAll('#splitShared .split-item').forEach((line) => {
        readItemRow(line, bill.shared.find((item) => item.id === line.dataset.item));
    });

    document.querySelectorAll('#splitShared .split-portions').forEach((block) => {
        readPortions(block, bill.shared.find((item) => item.id === block.dataset.item));
    });
}

/**
 * --------------------------------------------------------------------
 * Building the rows
 * --------------------------------------------------------------------
 */
function splitItemRow(item, placeholder) {
    const perItem = !!draft().itemDiscounts;

    const line = document.createElement('div');
    line.className = 'split-item' + (perItem ? ' has-off' : '');
    line.dataset.item = item.id;
    line.innerHTML =
        '<input type="text" class="split-item-label">' +
        '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
        '<input type="number" class="split-item-amount" min="0" step="0.10" placeholder="0.00" inputmode="decimal"></div>' +
        (perItem
            ? '<div class="money-input money-input-sm is-off' +
              (draft().offUnit === 'rm' ? '' : ' is-suffix') + '"><span class="affix">' +
              (draft().offUnit === 'rm' ? '−RM' : '%') + '</span>' +
              '<input type="number" class="split-item-off" min="0" step="0.10" placeholder="0.00" ' +
              'inputmode="decimal" aria-label="Discount on this dish"></div>'
            : '') +
        '<button type="button" class="split-x" data-remove-item aria-label="Remove item">' +
        '<i class="bi bi-x-lg"></i></button>';

    // Assigned rather than interpolated — these are user-typed strings.
    const label = line.querySelector('.split-item-label');
    label.value = item.label;
    label.placeholder = placeholder;
    line.querySelector('.split-item-amount').value = item.amount;

    const off = line.querySelector('.split-item-off');
    if (off) off.value = item.off;
    return line;
}

function buildSplitPeople() {
    const host = $('splitPeople');
    if (!host) return;

    const bill = draft();
    host.innerHTML = '';


    bill.people.forEach((person, index) => {
        const card = document.createElement('div');
        card.className = 'split-person' + (index === 0 ? ' is-me' : '');
        card.dataset.person = person.id;
        card.innerHTML =
            '<div class="split-person-head">' +
            '<input type="text" class="split-name">' +
            (index === 0 ? '<span class="split-you">you</span>' : '') +
            '<span class="split-person-sum" id="sum_' + person.id + '">RM 0.00</span>' +
            // The reader is the one row that cannot leave: every figure the
            // module reports about the bill is measured from it.
            (index > 0
                ? '<button type="button" class="split-x" data-remove-person aria-label="Remove person">' +
                  '<i class="bi bi-x-lg"></i></button>'
                : '') +
            '</div>' +
            '<div class="split-items"></div>' +
            '<button type="button" class="split-add" data-add-item>' +
            '<i class="bi bi-plus-lg"></i> Add item</button>';

        const nameField = card.querySelector('.split-name');
        nameField.value = person.name;
        nameField.placeholder = index === 0 ? 'You' : 'Person ' + (index + 1);

        const items = card.querySelector('.split-items');
        person.items.forEach((item) => items.appendChild(splitItemRow(item, 'What they had')));

        host.appendChild(card);
    });

    buildPaidByOptions();
    buildSplitPayments();
}

/**
 * Who put money down, and how much.
 *
 * A line per till rather than a figure per person: one evening is often three
 * counters — the pork at the hotpot, the groceries at NSK, the drinks at
 * Chagee — and the same person can be at two of them. Labelling the line is
 * what makes the list read back as the evening actually went.
 *
 * Whatever the lines do not add up to is carried by the person named under
 * **Paid by**, which is what keeps a bill with no lines at all the same
 * object as this one: nothing listed, so the whole bill is left over, so it
 * all lands on the one person who paid.
 */
/** A fresh line, pointed at somebody who is not already carrying the rest. */
function nextPaymentFor(bill) {
    const pay = newPayment();
    const rest = bill.people[payerIndex(bill)];
    const other = bill.people.find((person) => person.id !== rest.id);
    pay.by = (other || rest).id;
    return pay;
}

function buildSplitPayments() {
    const host = $('splitPayments');
    if (!host) return;

    const bill = draft();
    host.innerHTML = '';

    if (!bill.payments.length) {
        host.innerHTML = '<p class="split-empty">Nothing listed yet, so the whole bill is down ' +
            'to whoever is named under <b>Paid by</b>. Add a line for each of the others.</p>';
        return;
    }

    const rows = document.createElement('div');
    rows.className = 'split-items';

    bill.payments.forEach((pay) => {
        const row = document.createElement('div');
        row.className = 'split-pay';
        row.dataset.pay = pay.id;
        row.innerHTML =
            '<select class="split-pay-who" aria-label="Who paid"></select>' +
            '<input type="text" class="split-pay-label" aria-label="What this payment was for">' +
            '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
            '<input type="number" class="split-pay-amount" min="0" step="0.10" placeholder="0.00" ' +
            'inputmode="decimal" aria-label="How much they put down"></div>' +
            '<button type="button" class="split-x" data-remove-pay aria-label="Remove payment">' +
            '<i class="bi bi-x-lg"></i></button>';

        const who = row.querySelector('.split-pay-who');
        bill.people.forEach((person, index) => {
            const option = document.createElement('option');
            option.value = person.id;
            option.textContent = personName(person, index);
            who.appendChild(option);
        });
        // A payment by somebody who has since left the table goes back to the
        // reader rather than to nobody — the same rule `paidBy` follows.
        if (!bill.people.some((x) => x.id === pay.by)) pay.by = bill.people[0].id;
        who.value = pay.by;

        // Assigned rather than interpolated — these are user-typed strings.
        const label = row.querySelector('.split-pay-label');
        label.value = pay.label;
        label.placeholder = 'What they paid for';

        // A payment that names lines is worth what those lines come to, so the
        // box stops being a field and becomes a readout — typing a second
        // answer beside one the bill already knows is the thing this module
        // refuses to do anywhere else.
        const named = (pay.items || []).length > 0;
        const amount = row.querySelector('.split-pay-amount');
        amount.readOnly = named;
        amount.classList.toggle('is-read', named);
        if (!named) amount.value = pay.amount;

        rows.appendChild(row);
        rows.appendChild(splitPayLineRow(pay, billLines(bill)));
    });

    host.appendChild(rows);
}

/** Every line worth paying for: the ones with a figure against them. */
function billLines(bill) {
    const out = [];
    bill.people.forEach((person, index) => person.items.forEach((item) => {
        if ((parseFloat(item.amount) || 0) > 0) {
            out.push({ id: item.id, label: (item.label.trim() || 'Item') + ' — ' + personName(person, index) });
        }
    }));
    bill.shared.forEach((item) => {
        if ((parseFloat(item.amount) || 0) > 0) {
            out.push({ id: item.id, label: item.label.trim() || 'Shared dish' });
        }
    });
    return out;
}

/**
 * Which lines a payment paid for.
 *
 * The same chips as **Shared by** under a dish, doing the same job one level
 * up: there it is who was on the dish, here it is which dishes were on the
 * till. Naming them is what lets everyone pay back the person who actually
 * paid, rather than whoever the arithmetic happens to leave short.
 *
 * A line belongs to one payment, so tapping a line another payment has already
 * claimed moves it here rather than doing nothing — the alternative is a dead
 * chip and a reader hunting for which other row is holding it.
 */
function splitPayLineRow(pay, lines) {
    const mine = pay.items || [];

    const block = document.createElement('div');
    block.className = 'split-pay-lines';
    block.dataset.pay = pay.id;

    if (!lines.length) {
        block.innerHTML = '<span class="split-share-label">Paid for</span>' +
            '<p class="split-empty">Nothing on the bill yet.</p>';
        return block;
    }

    block.innerHTML =
        '<span class="split-share-label">Paid for</span>' +
        '<div class="split-chips">' +
        lines.map((line) => {
            const on = mine.includes(line.id);
            return '<button type="button" class="split-chip' + (on ? ' is-in' : '') + '" ' +
                'data-line="' + escapeHtml(line.id) + '" aria-pressed="' + on + '">' +
                '<i class="bi ' + (on ? 'bi-check-lg' : 'bi-plus-lg') + '"></i>' +
                '<span>' + escapeHtml(line.label) + '</span></button>';
        }).join('') +
        '</div>';

    return block;
}

function buildSplitShared() {
    const host = $('splitShared');
    if (!host) return;
    const bill = draft();
    host.innerHTML = '';

    if (!bill.shared.length) {
        host.innerHTML = '<p class="split-empty">Nothing shared yet &mdash; rice, a plate of fries, ' +
            'drinks for the table: anything everyone chips in for.</p>';
        return;
    }

    const items = document.createElement('div');
    items.className = 'split-items';
    bill.shared.forEach((item) => {
        items.appendChild(splitItemRow(item, 'Shared dish'));
        items.appendChild(splitPortionRow(item, bill));
    });
    host.appendChild(items);
}

/**
 * Who had a shared dish, and how much of it.
 *
 * Two questions, one strip, because they are the same axis. A table of four
 * where only two shared the plate is the same arithmetic as a dish nobody
 * divided equally — somebody's share is zero.
 *
 *   Shared by   a chip per person, tap to drop them out of this dish
 *   Portions    how many each had, when "evenly" is not true either
 *
 * The case portions exist for: five pao at RM11, one person had three and the
 * other two. Splitting that evenly charges the second person for half a pao
 * they never ate. Portions are counts, not money — you say how many, and the
 * dish divides in that ratio, so the same boxes handle two slices of cake,
 * three of five beers, or anything else measured in helpings.
 *
 * Both default to "everyone, equally", which is what a shared dish always was
 * — so a bill that never touches this strip behaves exactly as it did.
 */
function splitPortionRow(item, bill) {
    const out   = item.out || [];
    const units = item.units || {};
    const isIn  = (person) => !out.includes(person.id);

    const block = document.createElement('div');
    block.className = 'split-portions' + (item.byUnits ? ' is-on' : '') +
        (out.length ? ' has-out' : '');
    block.dataset.item = item.id;

    const chips = bill.people.map((person, index) =>
        '<button type="button" class="split-chip' + (isIn(person) ? ' is-in' : '') + '" ' +
        'data-share="' + person.id + '" aria-pressed="' + isIn(person) + '">' +
        '<i class="bi ' + (isIn(person) ? 'bi-check-lg' : 'bi-plus-lg') + '"></i>' +
        '<span data-person-label="' + person.id + '">' +
        escapeHtml(personName(person, index)) + '</span></button>').join('');

    const boxes = bill.people.filter(isIn).map((person, index) =>
        '<label class="split-portion">' +
            '<span data-person-label="' + person.id + '">' +
                escapeHtml(personName(person, bill.people.indexOf(person))) + '</span>' +
            '<input type="number" class="split-unit" data-person="' + person.id + '" ' +
            'min="0" step="1" placeholder="0" inputmode="decimal" ' +
            'aria-label="Portions for ' + escapeHtml(personName(person, bill.people.indexOf(person))) + '">' +
        '</label>').join('');

    block.innerHTML =
        '<div class="split-share">' +
            '<span class="split-share-label">Shared by</span>' +
            '<div class="split-chips">' + chips + '</div>' +
            '<button type="button" class="split-portion-toggle' + (item.byUnits ? ' is-on' : '') + '" ' +
                'data-portions>' +
                (item.byUnits
                    ? '<i class="bi bi-arrow-left-right"></i> Back to an even split'
                    : '<i class="bi bi-diagram-2"></i> Split by portions') +
            '</button>' +
        '</div>' +
        (item.byUnits
            ? '<div class="split-portion-head">' +
                  '<span>Portions <b id="pn_' + item.id + '">&mdash;</b></span>' +
              '</div>' +
              '<div class="split-portion-row">' + boxes + '</div>'
            : '') +
        '<p class="split-portion-foot" id="pf_' + item.id + '">&mdash;</p>';

    block.querySelectorAll('.split-unit').forEach((input) => {
        input.value = units[input.dataset.person] || '';
    });
    return block;
}

/** Who paid. Rebuilt with the people, since it is a list of them. */
function buildPaidByOptions() {
    const select = $('splitPaidBy');
    if (!select) return;

    const bill = draft();
    select.innerHTML = '';
    bill.people.forEach((person, index) => {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = personName(person, index);
        select.appendChild(option);
    });

    if (!bill.people.some((p) => p.id === bill.paidBy)) bill.paidBy = bill.people[0].id;
    select.value = bill.paidBy;
}

/**
 * --------------------------------------------------------------------
 * The sums
 * --------------------------------------------------------------------
 * One pipeline, whatever the method: weights in, a bill total and a row of
 * shares out. The weights are the only thing the four methods disagree about.
 */
/**
 * The fewest handovers that clear the table.
 *
 * `net` is what each person owes less what they already put down, so it adds
 * to zero: every ringgit somebody is short is a ringgit somebody else is up.
 * The biggest debt is matched against the biggest credit until both sides are
 * empty, which is the shortest list there is — two people who are RM30 apart
 * settle between themselves instead of passing it through a third.
 *
 * With one payer it is the list this module always had: they are the only
 * person owed, so everybody else pays them, and nothing about a saved bill
 * reads differently.
 *
 * A handover is keyed by the two people in it rather than by its position, so
 * a tick stays attached to the pair as the figures around it move.
 */
function settleTransfers(bill, netSen) {
    const owes = [];
    const owed = [];
    netSen.forEach((sen, index) => {
        if (sen > 0) owes.push({ index, left: sen });
        else if (sen < 0) owed.push({ index, left: -sen });
    });

    // Biggest first on both sides, position in the bill breaking a tie: the
    // same bill has to produce the same pairs every time it is worked out, or
    // a tick would find itself against a handover nobody made.
    owes.sort((a, b) => b.left - a.left || a.index - b.index);
    owed.sort((a, b) => b.left - a.left || a.index - b.index);

    const out = [];
    let i = 0;
    let j = 0;
    while (i < owes.length && j < owed.length) {
        const amount = Math.min(owes[i].left, owed[j].left);
        if (amount > 0) {
            const fromPerson = bill.people[owes[i].index];
            const toPerson   = bill.people[owed[j].index];
            const key = fromPerson.id + '>' + toPerson.id;
            out.push({
                key,
                from: owes[i].index, to: owed[j].index,
                fromPerson, toPerson,
                amount,
                settled: !!bill.settled[key],
            });
        }
        owes[i].left -= amount;
        owed[j].left -= amount;
        if (owes[i].left <= 0) i++;
        if (owed[j].left <= 0) j++;
    }

    // Read in the order the table is written in, whatever order they matched.
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Everyone pays back whoever paid, till by till.
 *
 * The other way round from `settleTransfers`: nothing is netted, so the same
 * two people can owe each other in both directions — you paid at NSK and Pan
 * paid for the paste, so Pan owes you RM13.75 and you owe Pan RM1.56. That is
 * more handovers, and it is the point: nobody has to take the arithmetic on
 * trust, because every figure is their own share of one thing one person
 * bought.
 *
 * A pair still settles once, because a person hands money over once however
 * many of the payer's lines they were on — so the lines are carried on the
 * handover as `parts` rather than each becoming a handover of its own.
 */
function tillTransfers(bill, lines, pieces, ownerOf) {
    const found = new Map();

    lines.forEach((line, at) => {
        const owner = ownerOf[at];
        bill.people.forEach((person, index) => {
            if (index === owner) return;
            const sen = pieces[index][at];
            if (sen <= 0) return;

            const fromPerson = person;
            const toPerson   = bill.people[owner];
            const key = fromPerson.id + '>' + toPerson.id;

            const move = found.get(key) || {
                key,
                from: index, to: owner,
                fromPerson, toPerson,
                amount: 0,
                parts: [],
                settled: !!bill.settled[key],
            };
            move.amount += sen;
            move.parts.push({ label: line.label, amount: sen });
            found.set(key, move);
        });
    });

    return [...found.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}

/** "Amy", "Amy & John", "Amy, John & David" — a list said the way it is said. */
const nameList = (names) => (names.length < 2
    ? (names[0] || '')
    : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1]);

function splitCompute(source) {
    const bill = source || draft();
    const grossSen = (item) => Math.max(0, toSen(parseFloat(item.amount) || 0));

    // A discount on one dish is not the same animal as a discount on the bill.
    // The bill's scales every share by the same factor and so changes nobody's
    // position; a dish's belongs to whoever ate that dish, and moves what they
    // owe against everyone else. So it comes off the item, before the weights
    // are taken, and never off the total.
    const offSen = (item) => {
        if (!bill.itemDiscounts) return 0;
        const typed = Math.max(0, parseFloat(item.off) || 0);
        const raw = bill.offUnit === 'rm'
            ? toSen(typed)
            : Math.round(grossSen(item) * typed / 100);
        return Math.min(raw, grossSen(item));
    };
    const itemSen = (item) => grossSen(item) - offSen(item);

    const all = bill.people.reduce((list, p) => list.concat(p.items), []).concat(bill.shared);
    const listedSen  = all.reduce((sum, item) => sum + grossSen(item), 0);
    const itemOffSen = all.reduce((sum, item) => sum + offSen(item), 0);

    const ownSen = bill.people.map((p) => p.items.reduce((sum, item) => sum + itemSen(item), 0));
    const sharedSen = bill.shared.reduce((sum, item) => sum + itemSen(item), 0);

    // How one shared dish divides. Evenly unless the dish says otherwise, in
    // which case it divides by portions: five pao at RM11, three eaten by one
    // person and two by another, is 6.60 and 4.40 — not 5.50 each.
    //
    // A dish set to portions with nothing typed in yet has no ratio to divide
    // by; `allocateSen` splits a zero total weight equally, which is the only
    // honest answer until a number appears.
    // A dish somebody sat out weighs nothing for them, whichever way the rest
    // of it divides. `out` is the exclusion list rather than the guest list so
    // that a person added to the bill later joins every dish by default —
    // which is what "shared by everyone" has to keep meaning.
    const unitsOf = (item) => bill.people.map((p) => {
        if ((item.out || []).includes(p.id)) return 0;
        if (!item.byUnits) return 1;
        return Math.max(0, parseFloat((item.units || {})[p.id]) || 0);
    });

    // Allocated dish by dish rather than over the pile: once two dishes divide
    // different ways there is no single ratio to allocate the pile by, and the
    // odd sen belongs to whoever was short on *that* dish.
    const sharedParts = bill.people.map(() => 0);
    const sharedSplits = bill.shared.map((item) => {
        const units = unitsOf(item);
        const parts = allocateSen(itemSen(item), units);
        parts.forEach((sen, i) => { sharedParts[i] += sen; });
        return { item, units, parts, total: units.reduce((sum, u) => sum + u, 0) };
    });

    const weights = ownSen.map((own, i) => own + (sharedParts[i] || 0));
    // Shared items count towards the bill even before anyone is listed to carry them.
    const foodSen = ownSen.reduce((sum, v) => sum + v, 0) + sharedSen;

    const serviceRate = Math.max(0, parseFloat(bill.service) || 0);
    const taxRate     = Math.max(0, parseFloat(bill.tax) || 0);

    const discountTyped = Math.max(0, parseFloat(bill.discount) || 0);
    const discountSen = Math.min(bill.discountUnit === 'rm'
        ? toSen(discountTyped)
        : Math.round(foodSen * discountTyped / 100), foodSen);
    const netSen      = foodSen - discountSen;
    const serviceSen  = Math.round(netSen * serviceRate / 100);
    // SST is charged on the food, *not* on the service charge. Malaysian F&B
    // receipts print the tax base and it is the subtotal every time: a bill of
    // RM204.20 + 10% service shows "Taxable 204.20 / Tax 12.25", not 6% of
    // 224.62. Taxing the sum overcharged the table by 6% of the service charge
    // — RM1.23 on that bill — and every share with it.
    const taxSen      = Math.round(netSen * taxRate / 100);

    // What the food comes to once the place has had its say. This is the part
    // that divides by what each person actually ordered.
    const foodPoolSen = netSen + serviceSen + taxSen;

    // --- delivery ---------------------------------------------------------
    // Two flat fees, neither of them food: one for the ride, one for the app.
    // Neither gets bigger because somebody ordered more, which is why they
    // divide evenly by default instead of riding on the shares — the person
    // who ordered a drink did not use less of the delivery.
    const deliverySen = bill.delivery ? Math.max(0, toSen(parseFloat(bill.deliveryFee) || 0)) : 0;
    const platformSen = bill.delivery ? Math.max(0, toSen(parseFloat(bill.platformFee) || 0)) : 0;
    const feesSen = deliverySen + platformSen;

    // The voucher comes off the order once everything is on it — the food,
    // the charges and the fees — because that is where the app takes it off,
    // and because "free delivery" has to be able to reach the delivery fee.
    // Like the bill discount it scales every share by the same factor, so it
    // moves nobody's position against anybody else, and it is capped at the
    // order so no share can go negative.
    const orderSen = foodPoolSen + feesSen;
    const voucherTyped = bill.delivery ? Math.max(0, parseFloat(bill.voucher) || 0) : 0;
    const voucherSen = Math.min(bill.voucherUnit === 'pct'
        ? Math.round(orderSen * voucherTyped / 100)
        : toSen(voucherTyped), orderSen);

    let grandSen = orderSen - voucherSen;
    if (bill.round) grandSen = Math.round(grandSen / 5) * 5;

    // How the total lands on each person: their food, plus their cut of the
    // fees, and then the voucher off the lot in proportion.
    //
    // With no fees there is nothing to add to the weights, so the division is
    // literally the one it always was — which is what keeps a saved bill
    // reading the same to the sen rather than to the ringgit.
    const feeWeights = bill.feeSplit === 'order' ? weights : bill.people.map(() => 1);
    const feeParts   = allocateSen(feesSen, feeWeights);
    const foodParts  = allocateSen(foodPoolSen, weights);
    const spread = feesSen > 0 ? foodParts.map((sen, index) => sen + feeParts[index]) : weights;

    const paysSen = allocateSen(grandSen, spread);
    const payer   = payerIndex(bill);

    // --- the bill, line by line -------------------------------------------
    // Every line on the bill in reading order, and what each person's share of
    // it comes to once the charges are on. A person's total is divided across
    // the lines they are on rather than each line being worked out on its own,
    // so the pieces add back to exactly what they pay — no line is a sen out
    // and no sen goes missing between them.
    const lines = [];
    bill.people.forEach((person, index) => person.items.forEach((item) => lines.push({
        item, id: item.id, owner: index,
        label: (item.label.trim() || 'Item') + ' (' + personName(person, index) + ')',
    })));
    bill.shared.forEach((item) => lines.push({
        item, id: item.id, owner: -1,
        label: item.label.trim() || 'Shared dish',
    }));

    const rawShare = bill.people.map(() => lines.map(() => 0));
    lines.forEach((line, at) => {
        if (line.owner >= 0) {
            rawShare[line.owner][at] = itemSen(line.item);
            return;
        }
        const split = sharedSplits.find((one) => one.item === line.item);
        bill.people.forEach((person, index) => { rawShare[index][at] = split ? split.parts[index] : 0; });
    });

    const pieces = bill.people.map((person, index) => allocateSen(paysSen[index], rawShare[index]));
    const lineSen = lines.map((line, at) =>
        bill.people.reduce((sum, person, index) => sum + pieces[index][at], 0));

    // Which payment claimed which line. A line belongs to at most one — the
    // first that claims it — or nobody would know whose till it was on, and
    // the same money would be counted twice.
    const lineAt = new Map(lines.map((line, at) => [line.id, at]));
    const ownerOf = lines.map(() => payer);
    const claimed = new Set();
    const payAmountSen = new Map();

    if (bill.multiPay) {
        (bill.payments || []).forEach((pay) => {
            const seatAt = bill.people.findIndex((person) => person.id === pay.by);
            const by = seatAt >= 0 ? seatAt : payer;
            let sen = 0;

            (pay.items || []).forEach((id) => {
                const at = lineAt.get(id);
                if (at === undefined || claimed.has(id)) return;
                claimed.add(id);
                ownerOf[at] = by;
                sen += lineSen[at];
            });

            // Nothing named: it is a lump, and worth whatever was typed.
            payAmountSen.set(pay.id, (pay.items || []).length ? sen
                : Math.max(0, toSen(parseFloat(pay.amount) || 0)));
        });
    }

    // --- who put the money down -------------------------------------------
    // The listed payments as typed, and whatever they leave over goes to the
    // primary payer. That single rule is what makes a bill with no payment
    // list the same object as one with it: nothing listed leaves the whole
    // bill over, and the whole bill lands on the one person who paid.
    const seat = new Map(bill.people.map((person, index) => [person.id, index]));
    const paidSen = bill.people.map(() => 0);
    let listedPaidSen = 0;

    if (bill.multiPay) {
        (bill.payments || []).forEach((pay) => {
            const sen = payAmountSen.get(pay.id) || 0;
            if (!sen) return;
            paidSen[seat.has(pay.by) ? seat.get(pay.by) : payer] += sen;
            listedPaidSen += sen;
        });
    }

    const restSen = grandSen - listedPaidSen;
    paidSen[payer] += restSen;

    const payers = paidSen.reduce((count, sen) => count + (sen > 0 ? 1 : 0), 0);

    // What each person owes against what they are already out of pocket by.
    // These add to zero by construction, which is what lets the handovers
    // below always come out even however many people paid.
    const dueSen = paysSen.map((pays, index) => pays - paidSen[index]);

    // What is still outstanding, and to whom — in whichever of the two shapes
    // the bill asks for. Netting is the default because it is the fewest
    // handovers; paying each till back is the one nobody has to check.
    const perTill = bill.multiPay && bill.settleStyle === 'till';
    const transfers = perTill
        ? tillTransfers(bill, lines, pieces, ownerOf)
        : settleTransfers(bill, dueSen);

    const openSen = transfers.filter((t) => !t.settled).reduce((sum, t) => sum + t.amount, 0);
    const owedToMeSen = transfers.filter((t) => t.to === 0 && !t.settled)
        .reduce((sum, t) => sum + t.amount, 0);
    const iOweSen = transfers.filter((t) => t.from === 0 && !t.settled)
        .reduce((sum, t) => sum + t.amount, 0);

    return {
        bill, weights, ownSen, sharedSen, sharedSplits, sharedParts, foodSen, discountSen, serviceSen, taxSen, grandSen,
        serviceRate, taxRate, payer,
        // Delivery: what was added on, what came off, and whose it was.
        deliverySen, platformSen, feesSen, feeParts, orderSen, voucherSen, voucherTyped,
        // What the menu said, and what came off it dish by dish. Both zero
        // for every method but item-based, which has no dishes to discount.
        listedSen, itemOffSen,
        discountTyped,
        // Each person's slice of the bill before charges, and after.
        shareSen: allocateSen(foodSen, weights),
        paysSen,
        // Who paid what, what that leaves each person net, and the handovers
        // that clear it. One payer or five, this is the same shape.
        paidSen, netSen: dueSen, payers, listedPaidSen, restSen,
        // The bill line by line: what each line came to with charges on, whose
        // till it was on, and each person's piece of it.
        lines, pieces, lineSen, ownerOf, perTill,
        payAmountSen,
        transfers,
        openSen, owedToMeSen, iOweSen,
        mySen: paysSen[0] || 0,
        myPaidSen: paidSen[0] || 0,
        // A bill with nothing left to chase is done, but an empty one is not
        // "settled" — it has simply not been filled in yet.
        isSettled: grandSen > 0 && transfers.every((t) => t.settled),
    };
}

const billIsSettled = (bill) => splitCompute(bill).isSettled;

/** Keep the preset buttons in step with the two percentage fields. */
function syncChargePreset() {
    const seg = $('splitCharges');
    if (!seg) return;
    const service = num('splitService');
    const tax     = num('splitTax');
    const match = Object.entries(CHARGE_PRESETS)
        .find(([, preset]) => preset.service === service && preset.tax === tax);
    setSegment(seg, match ? match[0] : 'custom');
}

function applyChargePreset(key) {
    const preset = CHARGE_PRESETS[key];
    if (!preset) return;
    if ($('splitService')) $('splitService').value = String(preset.service);
    if ($('splitTax'))     $('splitTax').value     = String(preset.tax);
}

/** Which fields the chosen method actually needs on screen. */
/** The few controls that appear and disappear with what is switched on. */
function syncSplitForm() {
    const bill = draft();

    // No unit to choose until there are dish discounts to put one on.
    if ($('splitItemOffUnit')) $('splitItemOffUnit').hidden = !bill.itemDiscounts;

    // With a list of payments up, the single picker above it stops meaning
    // "who paid" and starts meaning "who covered the rest" — so it says so.
    const many = !!bill.multiPay;
    if ($('splitPayCard'))   $('splitPayCard').hidden = !many;
    if ($('splitPayNote'))   $('splitPayNote').hidden = !many;
    if ($('splitPaidByLabel')) set('splitPaidByLabel', many ? 'Who paid the rest' : 'Paid by');

    const asPct = bill.discountUnit !== 'rm';
    if ($('splitDiscountBox')) $('splitDiscountBox').classList.toggle('is-suffix', asPct);
    set('splitDiscountAffix', asPct ? '%' : 'RM');

    // The fees and the voucher only exist on an order that was delivered.
    if ($('splitDeliveryCard')) $('splitDeliveryCard').hidden = !bill.delivery;

    const voucherPct = bill.voucherUnit === 'pct';
    if ($('splitVoucherBox')) $('splitVoucherBox').classList.toggle('is-suffix', voucherPct);
    set('splitVoucherAffix', voucherPct ? '%' : 'RM');
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
function paintSplit(bill) {
    const b = bill.bill;
    const pax = b.people.length;

    // Everybody who actually put money down, in the order they sit in the
    // bill. With no payment list that is the one person under "Paid by",
    // which is what it has always said.
    const putDown = b.people
        .map((person, index) => ({ person, index, sen: bill.paidSen[index] }))
        .filter((row) => row.sen > 0);

    set('splitTotal', money(fromSen(bill.grandSen)));
    set('splitPaxFoot', pax
        ? pax + (pax === 1 ? ' person' : ' people') + ' · ' +
          'paid by ' + (putDown.length
              ? nameList(putDown.map((row) => personName(row.person, row.index)))
              : personName(b.people[bill.payer], bill.payer))
        : 'Add someone to split with');

    // A payment that named lines shows what they come to. Repainted rather
    // than rebuilt, because the row beside it is being typed into.
    (b.payments || []).forEach((pay) => {
        const box = document.querySelector('#splitPayments .split-pay[data-pay="' +
            pay.id + '"] .split-pay-amount');
        if (box && box.readOnly) box.value = fmt(fromSen(bill.payAmountSen.get(pay.id) || 0));
    });

    // The payments card's own running total: what the list accounts for, and
    // what that leaves for the person carrying the rest.
    set('splitPayNote', bill.grandSen > 0
        ? money(fromSen(bill.listedPaidSen)) + ' of ' + money(fromSen(bill.grandSen)) + ' listed'
        : 'Nothing on the bill yet');

    const restName = personName(b.people[bill.payer], bill.payer);
    set('splitPayHint', bill.restSen > 0
        ? money(fromSen(bill.restSen)) + ' of the bill is not on this list, so it is down to ' +
          restName + '. Add a line for each of the other tills and it comes to nothing.'
        : bill.restSen < 0
            ? 'These payments come to ' + money(fromSen(-bill.restSen)) + ' more than the bill does. ' +
              'Either a figure is too high, or something is missing from what everyone had.'
            : 'Every ringgit of the bill is accounted for.');

    set('splitYourShare', money(fromSen(bill.mySen)));
    set('splitYourShareFoot', bill.grandSen > 0
        ? pct(bill.mySen / bill.grandSen * 100) + ' of ' + money(fromSen(bill.grandSen))
        : 'Nothing to split yet');

    // The direction of the debt is the whole point of the figure, so the
    // label changes with it rather than making the reader work it out.
    // Whoever paid what, a person is on one side of it or the other — never
    // both — because the net is a single figure.
    const iAmOwed = bill.netSen[0] <= 0;
    set('splitOwedLabel', iAmOwed ? 'Owed to you' : 'You owe');
    if (iAmOwed) {
        const mine = bill.transfers.filter((t) => t.to === 0);
        const done = mine.filter((t) => t.settled).length;
        set('splitOwed', money(fromSen(bill.owedToMeSen)));
        set('splitOwedFoot', mine.length
            ? done + ' of ' + mine.length + ' paid you back'
            : 'Nobody owes you anything');
    } else {
        const mine = bill.transfers.filter((t) => t.from === 0);
        const left = mine.filter((t) => !t.settled);
        set('splitOwed', money(fromSen(bill.iOweSen)));
        set('splitOwedFoot', !mine.length ? 'Nothing outstanding'
            : !left.length ? 'Paid back'
            : 'to ' + nameList(left.map((t) => personName(t.toPerson, t.to))));
    }

    // --- the tally ---
    set('splitTallyFood', money(fromSen(bill.itemOffSen > 0 ? bill.listedSen : bill.foodSen)));
    set('splitTallyItemOff', '− ' + money(fromSen(bill.itemOffSen)));
    set('splitTallyDiscount', '− ' + money(fromSen(bill.discountSen)));
    set('splitTallyDiscountLabel', b.discountUnit === 'pct' && bill.discountTyped
        ? 'Discount ' + pct(bill.discountTyped, bill.discountTyped % 1 ? 1 : 0)
        : 'Discount');
    set('splitTallyService', money(fromSen(bill.serviceSen)));
    set('splitTallyTax', money(fromSen(bill.taxSen)));
    set('splitTallyTotal', money(fromSen(bill.grandSen)));
    set('splitTallyServiceLabel', 'Service charge ' + pct(bill.serviceRate, 0));
    set('splitTallyTaxLabel', 'SST ' + pct(bill.taxRate, 0));

    set('splitTallyDelivery', money(fromSen(bill.deliverySen)));
    set('splitTallyPlatform', money(fromSen(bill.platformSen)));
    set('splitTallyVoucher', '− ' + money(fromSen(bill.voucherSen)));
    set('splitTallyVoucherLabel', b.voucherUnit === 'pct' && bill.voucherTyped
        ? 'Voucher ' + pct(bill.voucherTyped, bill.voucherTyped % 1 ? 1 : 0)
        : 'Voucher');

    const showRow = (id, show) => { const row = $(id); if (row) row.hidden = !show; };
    showRow('splitRowItemOff', bill.itemOffSen > 0);
    showRow('splitRowDiscount', bill.discountSen > 0);
    showRow('splitRowService', bill.serviceRate > 0);
    showRow('splitRowTax', bill.taxRate > 0);
    showRow('splitRowDelivery', bill.deliverySen > 0);
    showRow('splitRowPlatform', bill.platformSen > 0);
    showRow('splitRowVoucher', bill.voucherSen > 0);

    const chargeBits = [
        bill.serviceRate ? 'service ' + pct(bill.serviceRate, 0) : '',
        bill.taxRate ? 'SST ' + pct(bill.taxRate, 0) : '',
        bill.discountSen ? '− ' + (b.discountUnit === 'pct'
            ? pct(bill.discountTyped, bill.discountTyped % 1 ? 1 : 0) : money(fromSen(bill.discountSen))) +
            ' off the bill' : '',
        bill.itemOffSen ? '− ' + money(fromSen(bill.itemOffSen)) + ' off dishes' : '',
        b.itemDiscounts && !bill.itemOffSen ? 'per-dish discounts on' : '',
        bill.deliverySen ? 'delivery ' + money(fromSen(bill.deliverySen)) : '',
        bill.platformSen ? 'platform ' + money(fromSen(bill.platformSen)) : '',
        bill.voucherSen ? '− ' + money(fromSen(bill.voucherSen)) + ' voucher' : '',
        b.delivery && bill.feesSen > 0 && b.feeSplit === 'order' ? 'fees by what each ordered' : '',
        b.round ? 'rounded' : '',
    ].filter(Boolean);
    set('splitChargeSummary', chargeBits.length ? chargeBits.join(' · ') : 'None');

    // --- per-person running totals, and whether the method adds up ---
    b.people.forEach((person, index) => {
        set('sum_' + person.id, money(fromSen(bill.paysSen[index])));
    });
    set('splitSharedTotal', money(fromSen(bill.sharedSen)));
    paintPortions(bill);

    set('splitPeopleNote', bill.foodSen > 0
        ? 'Ordered ' + money(fromSen(bill.foodSen - bill.sharedSen))
        : 'Nothing on the bill yet');

    set('splitEvenNote', bill.grandSen > 0 ? 'Charges and discounts included' : '');

    // --- the answer table ---
    const body = $('splitBody');
    if (!body) return;
    body.innerHTML = '';

    if (bill.grandSen <= 0) {
        body.appendChild(emptyRow(
            'Put in what everyone had and the split works itself out.', 4));
        return;
    }

    b.people.forEach((person, index) => {
        const share  = bill.shareSen[index];
        const pays   = bill.paysSen[index];
        const charge = pays - share;

        const lines = person.items.filter((item) => (parseFloat(item.amount) || 0) > 0).length;

        // "A share of the table" is only true of a dish that divided evenly.
        // Once a dish went by portions, saying it of someone who ate three of
        // five pao understates what they had and why they owe more.
        const portions = (bill.sharedSplits || [])
            .filter((split) => split.item.byUnits && split.total)
            .reduce((sum, split) => sum + (split.units[index] || 0), 0);

        // And somebody who sat out every shared dish had no share of the
        // table at all — saying they did would be the plainest kind of wrong.
        const sharedNote = portions > 0
            ? ' + ' + fmt(portions, portions % 1 ? 1 : 0) +
              (portions === 1 ? ' portion shared' : ' portions shared')
            : (bill.sharedParts || [])[index] > 0 ? ' + a share of the table' : '';

        // A flat fee divided evenly is the one figure in the row that has
        // nothing to do with what they ordered, so it is named rather than
        // left to look like a share of something they had.
        const feeShare = (bill.feeParts || [])[index] || 0;

        const detail = (lines ? lines + (lines === 1 ? ' item' : ' items') : 'Nothing ordered') +
            sharedNote +
            (feeShare > 0 ? ' + ' + money(fromSen(feeShare)) + ' of the fees' : '');

        // What they put down at the till, which is a different question from
        // what they owe — and with several people paying it is the only place
        // the two can be seen against each other.
        const put = bill.paidSen[index];

        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong>' + escapeHtml(personName(person, index)) + '</strong>' +
            (put > 0
                ? '<span class="tag is-paid">' +
                  (bill.payers > 1 ? 'paid ' + escapeHtml(money(fromSen(put))) : 'paid') +
                  '</span>'
                : '') +
            '<small>' + detail + '</small>'
        ));
        tr.appendChild(cell(fmt(fromSen(share))));
        tr.appendChild(cell(
            (charge < 0 ? '− ' : charge > 0 ? '+ ' : '') + fmt(Math.abs(fromSen(charge))),
            charge < 0 ? 'is-minus' : 'is-muted'
        ));
        tr.appendChild(cell(fmt(fromSen(pays)), 'is-strong'));
        body.appendChild(tr);
    });

    // A voucher can take more off than the fees and charges put on, so this
    // cell can be a minus — and it has to say so the way the rows above it do.
    const totalCharge = bill.grandSen - bill.foodSen;

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Bill total'));
    totalRow.appendChild(cell(fmt(fromSen(bill.foodSen))));
    totalRow.appendChild(cell(
        (totalCharge < 0 ? '− ' : totalCharge > 0 ? '+ ' : '') + fmt(Math.abs(fromSen(totalCharge))),
        totalCharge < 0 ? 'is-minus' : ''));
    totalRow.appendChild(cell(fmt(fromSen(bill.grandSen))));
    body.appendChild(totalRow);
}

/**
 * Who still owes whom, and the one button that moves a debt from one state to
 * the other. Marking a debt settled writes straight to disk: it is a fact
 * about the world, not a figure being drafted, and losing it to a closed tab
 * would be worse than losing a half-typed bill.
 */
function paintSettle(bill) {
    const b = bill.bill;
    const list = $('splitSettleList');
    const saved = !!splitState.editing;

    set('splitSettleNote', !saved
        ? (bill.transfers.length
            ? money(fromSen(bill.openSen)) + ' to settle · not saved yet'
            : 'Not saved yet')
        : bill.isSettled ? '✅ Settled'
        : bill.transfers.length ? money(fromSen(bill.openSen)) + ' outstanding'
        : '—');

    const putDown = b.people
        .map((person, index) => ({ person, index, sen: bill.paidSen[index] }))
        .filter((row) => row.sen > 0);

    // One till reads as it always did. Several read as a list, because
    // "somebody paid RM245" is not what happened — three people did, and each
    // of them is owed for their own part of it.
    const only     = putDown[0];
    const onlyAt   = only ? only.index : bill.payer;
    const onlyName = personName(b.people[onlyAt], onlyAt);
    const onlyIsMe = onlyAt === 0;

    set('splitSettleLead', bill.grandSen <= 0
        ? 'Nothing to settle yet.'
        : putDown.length > 1
            ? putDown.map((row) => (row.index === 0 ? 'You put down ' : personName(row.person, row.index) + ' put down ') +
                  money(fromSen(row.sen))).join(' · ') +
              '. Your own share is ' + money(fromSen(bill.mySen)) + '.'
            : (onlyIsMe ? 'You paid ' : onlyName + ' paid ') + money(fromSen(bill.grandSen)) +
              '. ' + (onlyIsMe ? 'Your own share is ' : 'Their own share is ') +
              money(fromSen(bill.paysSen[onlyAt])) + '.');

    if (list) {
        list.innerHTML = '';

        if (!bill.transfers.length) {
            list.innerHTML = '<p class="split-empty">' + (bill.grandSen > 0
                ? 'Nobody owes anything on this bill.'
                : 'Put in what everyone had and who paid, and the handovers work themselves out.') +
                '</p>';
        } else {
            // Grouped, once several people paid, because a flat list names two
            // people on every line and reading your own out of it means
            // scanning both ends of all of them.
            //
            // Netted, the group is the person handing money over — somebody
            // paying two people is one debt split to clear two creditors, not
            // two debts. Per till it is the person being paid, because the
            // till is the thing being paid back and everyone on it belongs
            // together. With one payer every line is a different person
            // already, and a heading per row would be a heading per row.
            const order = bill.perTill
                ? bill.transfers.slice().sort((a, b) => a.to - b.to || a.from - b.from)
                : bill.transfers;

            let heading = -1;

            order.forEach((move) => {
                const group = bill.perTill ? move.to : move.from;

                if (bill.payers > 1 && group !== heading) {
                    heading = group;
                    const head = document.createElement('p');
                    head.className = 'settle-group';
                    const who = group === 0 ? 'You' : personName(bill.bill.people[group], group);

                    if (bill.perTill) {
                        const tills = bill.lines
                            .map((line, at) => ({ line, at }))
                            .filter((one) => bill.ownerOf[one.at] === group && bill.lineSen[one.at] > 0)
                            .map((one) => one.line.label + ' ' + money(fromSen(bill.lineSen[one.at])));
                        const takes = bill.transfers.filter((one) => one.to === group)
                            .reduce((sum, one) => sum + one.amount, 0);

                        head.textContent = who + (group === 0 ? ' paid ' : ' paid ') +
                            (tills.length ? tills.join(' + ') : 'the rest') +
                            ' — ' + (group === 0 ? 'you collect ' : 'collects ') + money(fromSen(takes));
                    } else {
                        head.textContent = who +
                            ' — share ' + money(fromSen(bill.paysSen[group])) + ', put in ' +
                            (bill.paidSen[group] > 0 ? money(fromSen(bill.paidSen[group])) : 'nothing') +
                            ', so ' + money(fromSen(bill.netSen[group])) + ' to hand over';
                    }
                    list.appendChild(head);
                }

                const row = document.createElement('div');
                row.className = 'settle-row' + (move.settled ? ' is-done' : '');
                const fromName = personName(move.fromPerson, move.from);
                const toName   = personName(move.toPerson, move.to);

                // Said from the reader's side wherever they are in it — and
                // with several payers there are handovers they are not part of
                // at all, which are simply reported.
                const iOwe     = move.from === 0;
                const owedToMe = move.to === 0;

                const sentence = iOwe
                    ? '<strong>You</strong> owe ' + escapeHtml(toName)
                    : owedToMe
                        ? '<strong>' + escapeHtml(fromName) + '</strong> owes you'
                        : '<strong>' + escapeHtml(fromName) + '</strong> owes ' + escapeHtml(toName);

                // One handover can cover two of the same person's lines — you
                // hand money over once, however many of their tills you were
                // on — so the lines it is made of are named under it.
                const parts = (move.parts || []).length > 1
                    ? '<small>' + move.parts.map((part) => escapeHtml(part.label) + ' ' +
                        escapeHtml(money(fromSen(part.amount)))).join(' · ') + '</small>'
                    : '';

                // Two directions, both needing an account. Money coming back
                // to you moves between two of your own pockets — a transfer.
                // Money you hand over is your share leaving for good — an
                // expense, recorded on the day you actually pay it.
                const held = b.settled[move.key];
                const landed = held && held.account ? accountById(held.account) : null;

                row.innerHTML =
                    '<span class="settle-who">' + sentence + parts + '</span>' +
                    '<b>' + money(fromSen(move.amount)) + '</b>' +
                    (!saved ? ''
                        : move.settled
                        ? '<span class="settle-done"><i class="bi bi-check-circle-fill"></i> Settled' +
                              // "into" for money arriving, "from" for money leaving.
                              (landed ? (iOwe ? ' from ' : ' into ') +
                                  escapeHtml(accountName(landed.id)) : '') + '</span>' +
                          '<button type="button" class="ghost-btn is-small" data-unsettle="' + escapeHtml(move.key) + '">Undo</button>'
                        : (owedToMe || iOwe
                            ? '<label class="settle-into-field"><span>' +
                              (iOwe ? 'Paid from' : 'Paid back into') + '</span>' +
                              '<select class="settle-into" aria-label="' +
                              (iOwe ? 'Which account you paid them from' : 'Which account they paid you back into') +
                              '">' + settleAccountOptions(iOwe ? '' : billPaidFromAccount(b)) + '</select></label>'
                            : '') +
                          '<button type="button" class="ghost-btn is-small" data-settle="' + escapeHtml(move.key) + '">' +
                          '<i class="bi bi-check-lg"></i> Mark settled</button>');
                list.appendChild(row);
            });

            // Once several people have paid, a handover can go to somebody who
            // did not buy the thing being paid for. That reads as a mistake
            // until it is said out loud, so it is said here — and the figure
            // each of them ends up with is put where they can check it.
            if (bill.payers > 1) {
                const collects = b.people
                    .map((person, index) => ({
                        person, index,
                        sen: bill.transfers.filter((move) => move.to === index)
                            .reduce((sum, move) => sum + move.amount, 0),
                    }))
                    .filter((row) => row.sen > 0);

                if (collects.length) {
                    const totals = document.createElement('p');
                    totals.className = 'settle-collects';
                    totals.textContent = collects.map((row) =>
                        (row.index === 0 ? 'You collect ' : personName(row.person, row.index) + ' collects ') +
                        money(fromSen(row.sen))).join(' · ');
                    list.appendChild(totals);
                }

                const why = document.createElement('p');
                why.className = 'hint';
                why.textContent = bill.perTill
                    ? 'Everyone pays back whoever paid for what they had, till by till — so the ' +
                      'same two people can owe each other both ways. More handovers, and no ' +
                      'arithmetic anybody has to take on trust.'
                    : 'Everybody owes their share less whatever they put down, and the biggest ' +
                      'debt is matched against the biggest credit. So this is the fewest ' +
                      'handovers that leaves everyone square — not one payment per till.';
                list.appendChild(why);
            }

            // The ticks are what wait for a save, not the figures: a tick is a
            // fact about the world and has to be kept somewhere, while who
            // owes whom is known the moment the bill is typed.
            if (!saved) {
                const note = document.createElement('p');
                note.className = 'split-empty';
                note.textContent = 'Save the bill and each of these gets its own tick, so a month ' +
                    'later you can still see who paid you back.';
                list.appendChild(note);
            }
        }
    }

    paintExpenseLink(bill);
}

/**
 * The link into the ledger. Only the reader's own share may cross — the rest
 * of the bill was lent for the length of a dinner, and putting it in the
 * ledger would tell every total in the app they spent four times what they did.
 */
function paintExpenseLink(bill) {
    const body  = $('splitExpBody');
    const state = $('splitExpState');
    const hint  = $('splitExpHint');
    const saved = !!splitState.editing;
    const entry = bill.bill.entryId
        && ledgerState.entries.find((e) => e.id === bill.bill.entryId);

    // What actually left the reader's own pocket at the till. With one payer
    // that is either the whole bill or nothing; with several it is their part
    // of it, and that — not the bill total — is what a bank statement shows.
    const putSen = bill.myPaidSen;
    const many   = bill.payers > 1;

    const mode = (($('splitExpMode') || {}).dataset || {}).value === 'share' ? 'share' : 'full';
    set('splitExpAmount', money(fromSen(mode === 'share' ? bill.mySen : putSen)));

    // The button said "my share" whichever way the switch was set, which is
    // the one place this could quietly do something other than what it says.
    const add = $('splitExpAdd');
    if (add) {
        add.innerHTML = '<i class="bi bi-plus-lg"></i> ' +
            (mode === 'share' ? 'Record my share'
                : many ? 'Record what I paid' : 'Record the whole bill');
    }

    // "The whole bill" is only the whole bill when one person paid it.
    const fullBtn = $('splitExpMode') && $('splitExpMode').querySelector('[data-val="full"]');
    if (fullBtn) fullBtn.textContent = many ? 'What I paid' : 'The whole bill';

    if (!body || !state) return;

    // A bill can lose its entry the ordinary way — deleted from the Expenses
    // list — and the link has to notice rather than keep claiming it is there.
    if (bill.bill.entryId && !entry) {
        bill.bill.entryId = '';
        commitBill();
    }

    // Whose money left the table. When you put nothing down, none of it was
    // yours yet: you owe them, and the money leaves your account on the day
    // you hand it over — which is the tick down in Settle up, not this card.
    const iPaid = putSen > 0;

    const linked = !!entry;
    body.hidden = linked || !saved || (bill.mySen <= 0 && putSen <= 0) || !iPaid;
    state.hidden = !linked;

    if (linked) {
        state.innerHTML = '<i class="bi bi-check-circle-fill"></i> ' +
            escapeHtml(money(parseFloat(entry.amount) || 0)) + ' recorded on ' +
            escapeHtml(dayShort(entry.date)) +
            ' <button type="button" class="ghost-btn is-small" id="splitExpUndo">Remove</button>';
    }

    if (hint) {
        // Who you would be paying back, rather than "the payer" — with
        // several people out of pocket there is no single one of those.
        const owedTo = nameList(bill.transfers.filter((move) => move.from === 0)
            .map((move) => personName(move.toPerson, move.to)));

        hint.textContent = !saved
            ? 'Save the bill first — the entry it creates is linked back to it, so it can be undone from here.'
            : bill.mySen <= 0 && putSen <= 0
                ? 'Your share is nothing, so there is no expense to record.'
                : linked
                    ? 'Removing this deletes that entry from Expenses. There is only ever one copy — the bill points at it rather than keeping its own.'
                    : !iPaid
                        ? (owedTo || 'Somebody else') + ' paid, so none of your money has moved yet. Tick your own line under ' +
                          'Settle up when you pay them back and pick the account it came out of — the expense ' +
                          'is recorded then, on the day it actually left.'
                        : many
                            ? 'Your share, or the ' + money(fromSen(putSen)) + ' you actually put down — the rest ' +
                              'of what you paid was lent for the length of an evening, and comes back off it as ' +
                              'they settle up.'
                            : 'Your share only. The rest of the bill was never your money, so recording all of it ' +
                              'would tell every total in the app that you spent far more than you did.';
    }
}

/** Saved bills, newest first. */
function paintBills() {
    const body = $('splitBills');
    if (!body) return;

    const filter = splitState.filter;
    const rows = splitState.bills
        .map((bill) => ({ bill, sums: splitCompute(bill) }))
        .filter((row) => filter === 'all'
            || (filter === 'settled' ? row.sums.isSettled : !row.sums.isSettled))
        .sort((a, b) => (a.bill.date === b.bill.date
            ? b.bill.seq - a.bill.seq
            : (a.bill.date < b.bill.date ? 1 : -1)));

    const open = splitState.bills.filter((bill) => !billIsSettled(bill));
    const owed = open.reduce((sum, bill) => sum + splitCompute(bill).owedToMeSen, 0);
    set('splitBillsNote', splitState.bills.length
        ? splitState.bills.length + (splitState.bills.length === 1 ? ' bill' : ' bills') +
          (owed > 0 ? ' · ' + money(fromSen(owed)) + ' owed to you' : '')
        : 'Nothing saved yet');

    body.innerHTML = '';

    if (!rows.length) {
        body.appendChild(emptyRow(splitState.bills.length
            ? 'No ' + filter + ' bills.'
            : 'Saved bills land here, and stay until you delete them.', 6));
        return;
    }

    rows.forEach(({ bill, sums }) => {
        const tr = document.createElement('tr');
        if (splitState.editing === bill.id) tr.className = 'is-current';

        tr.appendChild(cell('<strong>' + escapeHtml(dayShort(bill.date)) + '</strong>' +
            '<small>' + escapeHtml(String(bill.date).slice(0, 4)) + '</small>'));

        tr.appendChild(cell('<strong>' + escapeHtml(bill.title.trim() || 'Untitled bill') + '</strong>' +
            '<small>' + bill.people.length + ' people' +
            (bill.entryId ? ' · recorded' : '') + '</small>'));

        tr.appendChild(cell(fmt(fromSen(sums.grandSen))));
        tr.appendChild(cell(fmt(fromSen(sums.mySen)), 'is-strong'));

        tr.appendChild(cell(sums.isSettled
            ? '<span class="tag is-done">Settled</span>'
            : '<span class="tag is-open">' + money(fromSen(sums.openSen)) + '</span>'));

        tr.appendChild(cell(
            '<button type="button" class="split-x" data-open-bill="' + bill.id + '" aria-label="Open bill">' +
            '<i class="bi bi-pencil"></i></button>' +
            '<button type="button" class="split-x" data-copy-bill="' + bill.id + '" aria-label="Duplicate bill">' +
            '<i class="bi bi-files"></i></button>' +
            '<button type="button" class="split-x" data-drop-bill="' + bill.id + '" aria-label="Delete bill">' +
            '<i class="bi bi-x-lg"></i></button>', 'row-actions'));

        body.appendChild(tr);
    });
}

function renderSplit() {
    readSplitState();
    syncChargePreset();
    syncSplitForm();

    const bill = splitCompute();
    paintSplit(bill);
    paintSettle(bill);
    paintBills();

    set('splitFormTitle', splitState.editing ? 'Editing a saved bill' : 'New bill');
    if ($('splitSave')) {
        $('splitSave').innerHTML = splitState.editing
            ? '<i class="bi bi-check-lg"></i> Update bill'
            : '<i class="bi bi-check-lg"></i> Save bill';
    }
    if ($('splitCancel')) $('splitCancel').hidden = !splitState.editing;
    if ($('splitDirtyNote')) $('splitDirtyNote').hidden = !!splitState.editing;
}

/** Plain-text recap, sized to paste straight into the group chat. */
function splitSummaryText() {
    const bill = splitCompute();
    const b = bill.bill;

    const many = bill.payers > 1;

    const putDown = b.people
        .map((person, index) => ({ person, index, sen: bill.paidSen[index] }))
        .filter((row) => row.sen > 0);

    // One payer fits in the title: "Dinner — RM240, paid by You". Three do
    // not — run into the same sentence they turn the one line a reader skims
    // into three facts at once, so who paid gets a line of its own.
    const lines = [(b.title.trim() || 'Bill split') + ' — ' + money(fromSen(bill.grandSen)) +
        (many ? '' : ', paid by ' + personName(b.people[bill.payer], bill.payer))];

    if (many) {
        lines.push('Paid: ' + putDown
            .map((row) => personName(row.person, row.index) + ' ' + money(fromSen(row.sen)))
            .join(' · '));
    }

    // One payer: a line per person is the whole answer, because everybody in
    // it owes the same person. Several payers: every one of these figures is
    // said again in the blocks below, against what that person put in and who
    // they hand it to — so printing them here as well is the same list twice.
    if (!many) {
        b.people.forEach((person, index) => {
            const owes = bill.transfers.filter((move) => move.from === index);
            lines.push(personName(person, index) + ': ' + money(fromSen(bill.paysSen[index])) +
                (!owes.length ? (bill.paidSen[index] > 0 ? ' (paid)' : '')
                    : owes.every((move) => move.settled) ? ' — settled'
                    : ''));
        });
    }

    // A dish split by portions is the one thing a reader cannot reconstruct
    // from the per-person totals, so the summary spells it out.
    (bill.sharedSplits || []).filter((split) => split.item.byUnits && split.total).forEach((split) => {
        lines.push('  ' + (split.item.label.trim() || 'Shared dish') + ' ' +
            money(fromSen(Math.max(0, toSen(parseFloat(split.item.amount) || 0)))) + ' by portions: ' +
            b.people
                .map((person, index) => ({ person, index, units: split.units[index], sen: split.parts[index] }))
                .filter((row) => row.units > 0)
                .map((row) => personName(row.person, row.index) + ' ' + fmt(row.units, row.units % 1 ? 1 : 0) +
                    ' → ' + money(fromSen(row.sen)))
                .join(', '));
    });

    const parts = ['ordered ' + money(fromSen(bill.foodSen))];
    if (bill.discountSen) parts.push('less ' + money(fromSen(bill.discountSen)) + ' discount');
    if (bill.serviceSen)  parts.push('service ' + pct(bill.serviceRate, 0) + ' ' + money(fromSen(bill.serviceSen)));
    if (bill.taxSen)      parts.push('SST ' + pct(bill.taxRate, 0) + ' ' + money(fromSen(bill.taxSen)));
    if (bill.deliverySen) parts.push('delivery ' + money(fromSen(bill.deliverySen)));
    if (bill.platformSen) parts.push('platform fee ' + money(fromSen(bill.platformSen)));
    if (bill.voucherSen)  parts.push('less ' + money(fromSen(bill.voucherSen)) + ' voucher');
    lines.push('(' + parts.join(', ') + ')');

    // Whose the fees were is not something the shares above can be read back
    // to, so a delivery says how they were divided.
    if (bill.feesSen > 0) {
        lines.push('Fees ' + money(fromSen(bill.feesSen)) + (b.feeSplit === 'order'
            ? ' divided by what each ordered.'
            : ' divided evenly between ' + b.people.length + '.'));
    }

    // Who hands what to whom. With one payer that is every line above said
    // backwards, so it is only worth printing once more than one person paid.
    //
    // A block per person rather than a list of arrows. The flat list was four
    // lines that each named two people, and reading your own out of it meant
    // scanning both ends of every one; here a reader finds their own name once
    // and everything under it is theirs. It also puts the share and what they
    // put in right above the figure those two produce, which is the question
    // anybody actually asks of a bill somebody else added up.
    if (many && bill.transfers.length) {
        lines.push('');
        lines.push('Who pays who');

        // Per till, the unit is the till: one block per thing somebody bought,
        // with everyone who was on it under it. That is the shape a reader
        // asked for it in, and it is the one they can check without trusting
        // any arithmetic but a division they watched happen.
        if (bill.perTill) {
            const tills = [];
            bill.lines.forEach((line, at) => {
                if (bill.lineSen[at] <= 0) return;
                const owner = bill.ownerOf[at];
                const found = tills.find((one) => one.owner === owner);
                if (found) found.on.push({ line, at });
                else tills.push({ owner, on: [{ line, at }] });
            });
            tills.sort((a, b) => a.owner - b.owner);

            tills.forEach((till) => {
                const who = personName(b.people[till.owner], till.owner);
                const sum = (index) => till.on.reduce((total, one) => total + bill.pieces[index][one.at], 0);
                const takes = b.people.reduce((total, person, index) =>
                    total + (index === till.owner ? 0 : sum(index)), 0);

                lines.push('');
                lines.push(who + ' paid ' + till.on
                    .map((one) => one.line.label + ' ' + money(fromSen(bill.lineSen[one.at])))
                    .join(' + ') + ' — collects ' + money(fromSen(takes)));

                b.people.forEach((person, index) => {
                    if (index === till.owner) return;
                    const sen = sum(index);
                    if (sen > 0) lines.push('   ' + personName(person, index) + ' ' + money(fromSen(sen)));
                });

                const own = sum(till.owner);
                if (own > 0) lines.push('   (' + who + "'s own share of it: " + money(fromSen(own)) + ')');
            });

            lines.push('');
            lines.push(bill.transfers.length + ' handovers in all — everyone pays back whoever paid ' +
                'for what they had.');
            return lines.join('\n');
        }


        b.people.forEach((person, index) => {
            const pays     = bill.transfers.filter((move) => move.from === index);
            const collects = bill.transfers.filter((move) => move.to === index);

            lines.push('');
            lines.push(personName(person, index) + ' — share ' + money(fromSen(bill.paysSen[index])) +
                ', put in ' + (bill.paidSen[index] > 0 ? money(fromSen(bill.paidSen[index])) : 'nothing'));

            if (collects.length) {
                lines.push('   collects ' + money(fromSen(
                    collects.reduce((sum, move) => sum + move.amount, 0))));
                collects.forEach((move) => lines.push('   from ' +
                    personName(move.fromPerson, move.from) + ' ' + money(fromSen(move.amount)) +
                    (move.settled ? ' (settled)' : '')));
            }

            pays.forEach((move) => lines.push('   pays ' + personName(move.toPerson, move.to) +
                ' ' + money(fromSen(move.amount)) + (move.settled ? ' (settled)' : '')));

            // Somebody who put down exactly their own share is in nobody's
            // list, and saying nothing about them reads as an omission.
            if (!pays.length && !collects.length) lines.push('   square');
        });

        lines.push('');
        lines.push(bill.transfers.length + (bill.transfers.length === 1 ? ' handover' : ' handovers') +
            ' in all — the fewest that leaves everybody square, so some of it goes to somebody ' +
            'other than whoever paid for that dish.');
    }

    return lines.join('\n');
}

/**
 * --------------------------------------------------------------------
 * Editing
 * --------------------------------------------------------------------
 */
/** Structural edits: read what is on screen first so nothing typed is lost. */
function onSplitEdit(event) {
    const btn = event.target.closest('button');
    if (!btn) return;

    readSplitState();
    const bill = draft();
    const card = btn.closest('.split-person');
    const person = card && bill.people.find((p) => p.id === card.dataset.person);

    if (btn.hasAttribute('data-share')) {
        const item = bill.shared.find((x) => x.id === btn.closest('.split-portions').dataset.item);
        if (!item) return;
        const who = btn.dataset.share;
        const out = item.out || [];

        if (out.includes(who)) {
            item.out = out.filter((id) => id !== who);
        } else {
            // A dish nobody is on has no ratio to divide by and no owner to
            // charge. The last person stays.
            if (bill.people.length - out.length <= 1) {
                splitHint('Someone has to be on the dish — drop it instead if nobody had it.');
                return;
            }
            item.out = out.concat(who);
        }
    } else if (btn.hasAttribute('data-portions')) {
        const item = bill.shared.find((x) => x.id === btn.closest('.split-portions').dataset.item);
        if (!item) return;
        item.byUnits = !item.byUnits;
        // The numbers are kept when the dish goes back to an even split, so
        // turning portions on again finds them where they were left.
        item.units = item.units || {};
    } else if (btn.hasAttribute('data-add-item') && person) {
        person.items.push(newItem());
    } else if (btn.hasAttribute('data-remove-item')) {
        const itemId = btn.closest('.split-item').dataset.item;
        if (person) {
            person.items = person.items.filter((item) => item.id !== itemId);
            if (!person.items.length) person.items.push(newItem());
        } else {
            bill.shared = bill.shared.filter((item) => item.id !== itemId);
        }
        // A line that has gone cannot still be on somebody's till.
        bill.payments.forEach((pay) => {
            pay.items = (pay.items || []).filter((one) => one !== itemId);
        });
    } else if (btn.hasAttribute('data-remove-person') && person) {
        bill.people = bill.people.filter((p) => p.id !== person.id);
        // Every handover they were either end of goes with them, and so does
        // anything they put down at a till.
        Object.keys(bill.settled).forEach((key) => {
            if (key.split('>').includes(person.id)) delete bill.settled[key];
        });
        bill.payments = bill.payments.filter((pay) => pay.by !== person.id);
        // Their own lines went with them, so no till can still be claiming one.
        const gone = new Set(person.items.map((item) => item.id));
        bill.payments.forEach((pay) => {
            pay.items = (pay.items || []).filter((one) => !gone.has(one));
        });
        // Their portions go with them, or a dish would keep dividing by a
        // share nobody at the table is carrying.
        bill.shared.forEach((item) => {
            if (item.units) delete item.units[person.id];
            if (item.out) item.out = item.out.filter((id) => id !== person.id);
        });
    } else {
        return;
    }

    buildSplitPeople();
    buildSplitShared();
    commitBill();
    renderSplit();
}

/** Settling, and unsettling. Both are facts, so both go straight to disk. */
/**
 * Accounts a repayment can land in. The one the bill was paid from is offered
 * first and says so — money coming back where it left needs no entry at all,
 * and that is worth being the easy answer.
 */
function settleAccountOptions(fromId) {
    return openAccounts().map((account, index) => {
        const name = account.name.trim() || 'Account ' + (index + 1);
        return '<option value="' + escapeHtml(account.id) + '"' +
            (account.id === fromId ? ' selected' : '') + '>' +
            escapeHtml(name) + (account.id === fromId ? ' (where you paid from)' : '') +
            '</option>';
    }).join('');
}

function onSettleClick(event) {
    const btn = event.target.closest('button[data-settle], button[data-unsettle]');
    if (!btn) return;

    readSplitState();
    const bill = draft();
    const id = btn.dataset.settle || btn.dataset.unsettle;

    if (btn.dataset.settle) {
        const row = btn.closest('.settle-row');
        const select = row && row.querySelector('.settle-into');
        const into = select ? select.value : '';

        const sums = splitCompute(bill);
        const debt = sums.transfers.find((move) => move.key === id);
        const mine = debt && debt.from === 0;

        // Your own line: this is the moment your money leaves, so this is the
        // moment the expense is written — from the account you actually used.
        if (mine && into) {
            const entryId = settleWriteShare(bill, debt, into);
            bill.settled[id] = { account: into, entryId, date: todayIso() };
            splitHint('Recorded ' + money(fromSen(debt.amount)) + ' from ' + accountName(into) +
                ' under Expenses — your share, on the day you paid it.');
        } else {
            const entryId = debt && into && !mine ? settleWriteEntry(bill, debt, into) : '';
            bill.settled[id] = { account: into, entryId, date: todayIso() };

            if (entryId) {
                splitHint(bill.recorded === 'share'
                    ? money(fromSen(debt.amount)) + ' moved to ' + accountName(into) +
                      ' — a transfer, so it changes the two balances and no total.'
                    : money(fromSen(debt.amount)) + ' back into ' + accountName(into) +
                      ' — taken off what the bill cost you, not counted as income.');
            }
        }
    } else {
        // Un-ticking takes back what the tick wrote. Leaving the transfer
        // behind would quietly overstate the account it landed in.
        const held = bill.settled[id];
        if (held && held.entryId) {
            ledgerState.entries = ledgerState.entries.filter((e) => e.id !== held.entryId);
            // If that was the bill's own expense, the bill stops claiming it.
            if (bill.entryId === held.entryId) { bill.entryId = ''; bill.account = ''; }
            saveLedger();
        }
        delete bill.settled[id];
    }

    commitBill();
    saveSplit();
    renderSplit();
    renderLedger();
    renderDash();
}

/**
 * --------------------------------------------------------------------
 * Saving
 * --------------------------------------------------------------------
 */
/**
 * Write the draft back into the saved list. A draft that has never been saved
 * is left alone — an unsaved bill is a sketch, and half-typed sketches do not
 * belong in a history the reader browses.
 */
function commitBill() {
    if (!splitState.editing) return;
    const bill = draft();
    bill.updated = todayIso();

    const at = splitState.bills.findIndex((x) => x.id === bill.id);
    if (at >= 0) splitState.bills[at] = bill;
    else splitState.bills.push(bill);

    // Typing into a saved bill edits it in place, and a keystroke is not a
    // moment worth writing to disk for. Facts — a debt settled, an expense
    // recorded — call `saveSplit` themselves and do not wait.
    saveSplitSoon();
}

let splitSaveTimer = null;
function saveSplitSoon() {
    clearTimeout(splitSaveTimer);
    splitSaveTimer = setTimeout(saveSplit, 400);
}

/** Any ordinary edit: read it, keep it if this bill is a saved one, repaint. */
function onSplitFormEdit() {
    readSplitState();
    commitBill();
    renderSplit();
}

function splitSaveBill() {
    readSplitState();
    const bill = draft();
    const sums = splitCompute(bill);

    if (sums.grandSen <= 0) {
        splitHint('Put an amount in first — a bill with nothing on it is not a bill.');
        return;
    }

    if (!bill.id) {
        bill.id = nextId('b');
        bill.seq = ++splitSeq;
        bill.created = todayIso();
        splitState.editing = bill.id;
    }

    commitBill();
    saveSplit();
    splitHint('Saved. Each debt can be ticked off below as it is paid.');
    renderSplit();
}

function splitHint(message) {
    const hint = $('splitSaveHint');
    if (!hint) return;
    hint.innerHTML = '<i class="bi bi-info-circle"></i> ' + escapeHtml(message);
    clearTimeout(splitHint.timer);
    splitHint.timer = setTimeout(() => {
        hint.innerHTML = '<i class="bi bi-hdd"></i> Saved on this device only ' +
            '&mdash; nothing leaves your browser.';
    }, 4000);
}

function splitOpenBill(id) {
    const bill = splitState.bills.find((b) => b.id === id);
    if (!bill) return;

    splitState.editing = bill.id;
    splitState.draft = bill;
    paintSplitForm();
    renderSplit();
    const form = $('split-form');
    if (form) reveal(form).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** A copy of last month's dinner, with the debts wiped: same table, new night. */
function splitCopyBill(id) {
    const bill = splitState.bills.find((b) => b.id === id);
    if (!bill) return;

    const copy = JSON.parse(JSON.stringify(bill));
    copy.id = '';
    copy.seq = 0;
    copy.date = todayIso();
    copy.settled = {};
    copy.account = '';
    copy.entryId = '';
    copy.created = '';
    // New ids all the way down, or the copy and the original share rows.
    const remap = {};
    // Lines are remapped too, because a payment names the ones it paid for and
    // a copy pointing at the original's lines is two bills sharing a till.
    const lineMap = {};
    copy.people.forEach((p) => { remap[p.id] = nextId('p'); p.id = remap[p.id];
        p.items.forEach((i) => { lineMap[i.id] = nextId('i'); i.id = lineMap[i.id]; }); });
    copy.shared.forEach((i) => { lineMap[i.id] = nextId('i'); i.id = lineMap[i.id]; });
    copy.paidBy = remap[bill.paidBy] || copy.people[0].id;
    copy.payments = (copy.payments || []).map((pay) => ({
        id: nextId('y'),
        by: remap[pay.by] || copy.people[0].id,
        label: pay.label,
        amount: pay.amount,
        items: (pay.items || []).map((one) => lineMap[one]).filter(Boolean),
    }));

    splitState.editing = null;
    splitState.draft = copy;
    paintSplitForm();
    renderSplit();
}

function splitDropBill(id) {
    const bill = splitState.bills.find((b) => b.id === id);
    if (!bill) return;

    if (bill.entryId && ledgerState.entries.some((e) => e.id === bill.entryId)) {
        // Refusing at the bottom of the page while printing the reason at the
        // top of it reads as the button being broken. So: open the bill, take
        // the reader to the button that undoes the entry, and flash the row
        // that would not go.
        if (splitState.editing !== bill.id) {
            splitState.editing = bill.id;
            splitState.draft = bill;
            paintSplitForm();
        }
        renderSplit();

        splitHint('That bill has an expense in Expenses. Press Remove under Settle up first, then delete it.');

        const btn = document.querySelector('#splitBills [data-drop-bill="' + bill.id + '"]');
        const row = btn && btn.closest('tr');
        if (row) {
            row.classList.add('is-locked');
            setTimeout(() => row.classList.remove('is-locked'), 1600);
        }

        const target = $('splitExpState') || $('splitSettleList');
        if (target) reveal(target).scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    splitState.bills = splitState.bills.filter((b) => b.id !== id);
    if (splitState.editing === id) splitNewBill();
    saveSplit();
    renderSplit();
}

function splitNewBill() {
    splitState.editing = null;
    splitState.draft = newBill();
    paintSplitForm();
    renderSplit();
}

/** Put the draft on screen. The inverse of `readSplitState`. */
/**
 * The portions strip: the count, who ends up paying what, and the names —
 * repainted rather than rebuilt, because a name is typed one letter at a time
 * and rebuilding would take the caret with it.
 */
function paintPortions(bill) {
    const b = bill.bill;

    b.people.forEach((person, index) => {
        document.querySelectorAll('[data-person-label="' + person.id + '"]').forEach((el) => {
            el.textContent = personName(person, index);
        });

        // The two pickers name people as well, and an <option> is not caught
        // by the loop above. Without this a name typed after the lists were
        // built sits stale in "Paid by" and in every payment line until
        // something else happens to rebuild them.
        document.querySelectorAll('#splitPaidBy option[value="' + person.id + '"], ' +
            '#splitPayments option[value="' + person.id + '"]').forEach((option) => {
            option.textContent = personName(person, index);
        });
    });

    (bill.sharedSplits || []).forEach((split) => {
        const out   = split.item.out || [];
        const plain = !split.item.byUnits && !out.length;

        if (split.item.byUnits) {
            set('pn_' + split.item.id, split.total
                ? fmt(split.total, split.total % 1 ? 1 : 0)
                : '—');
        }

        const foot = $('pf_' + split.item.id);
        if (!foot) return;

        // A dish shared by everyone, equally, needs no explanation — that is
        // what a shared dish is. Anything else does.
        foot.hidden = plain;
        if (plain) return;

        if (split.item.byUnits && !split.total) {
            foot.textContent = out.length
                ? 'No portions typed yet, so this is splitting evenly between the ' +
                  (b.people.length - out.length) + ' still on it.'
                : 'Nobody has a portion yet, so this dish is still splitting evenly.';
            return;
        }

        const named = b.people
            .map((person, index) => ({ person, index, sen: split.parts[index] || 0 }))
            .filter((row) => row.sen > 0);

        foot.textContent = named.length
            ? named.map((row) => personName(row.person, row.index) + ' ' + money(fromSen(row.sen))).join(' · ')
            : 'Nobody is on this dish yet.';
    });
}

function paintSplitForm() {
    const bill = draft();

    if ($('splitTitle'))    $('splitTitle').value = bill.title;
    if ($('splitDate'))     $('splitDate').value = bill.date;
    if ($('splitService'))  $('splitService').value = bill.service;
    if ($('splitTax'))      $('splitTax').value = bill.tax;
    if ($('splitDiscount')) $('splitDiscount').value = bill.discount;
    if ($('splitRound'))    $('splitRound').checked = !!bill.round;
    if ($('splitItemOff'))  $('splitItemOff').checked = !!bill.itemDiscounts;
    if ($('splitMultiPay')) $('splitMultiPay').checked = !!bill.multiPay;
    if ($('splitSettleStyle')) setSegment($('splitSettleStyle'), bill.settleStyle);
    if ($('splitDiscountUnit')) setSegment($('splitDiscountUnit'), bill.discountUnit);
    if ($('splitItemOffUnit'))  setSegment($('splitItemOffUnit'), bill.offUnit);

    if ($('splitDelivery'))    $('splitDelivery').checked = !!bill.delivery;
    if ($('splitDeliveryFee')) $('splitDeliveryFee').value = bill.deliveryFee;
    if ($('splitPlatformFee')) $('splitPlatformFee').value = bill.platformFee;
    if ($('splitVoucher'))     $('splitVoucher').value = bill.voucher;
    if ($('splitVoucherUnit')) setSegment($('splitVoucherUnit'), bill.voucherUnit);
    if ($('splitFeeSplit'))    setSegment($('splitFeeSplit'), bill.feeSplit);

    const fold = $('splitChargeFold');
    if (fold) fold.open = (parseFloat(bill.service) || 0) > 0 || (parseFloat(bill.tax) || 0) > 0
        || (parseFloat(bill.discount) || 0) > 0 || !!bill.round || !!bill.itemDiscounts
        || !!bill.delivery;

    buildSplitPeople();
    buildSplitShared();
    syncSplitForm();
}

/**
 * --------------------------------------------------------------------
 * Into the ledger
 * --------------------------------------------------------------------
 */
function splitRecordShare() {
    readSplitState();
    const bill = draft();
    const sums = splitCompute(bill);

    if (!splitState.editing) { splitHint('Save the bill first.'); return; }
    if (bill.entryId)        { return; }

    const category = ($('splitExpCategory') || {}).value || '';
    const account  = ($('splitExpAccount') || {}).value || '';
    if (!account) { splitHint('Add an account under Expenses first — an expense has to come from somewhere.'); return; }

    // Whole bill or own share. Whole bill is what left the account, so it is
    // what a bank statement shows; the rest comes back off it as people pay.
    // "The whole bill" means the money that actually left this reader's
    // account, which is the whole bill only when they were the only one at a
    // till. With several payers it is their part of it.
    const mode = (($('splitExpMode') || {}).dataset || {}).value === 'share' ? 'share' : 'full';
    bill.recorded = mode;
    const senToRecord = mode === 'share' ? sums.mySen : sums.myPaidSen;

    if (senToRecord <= 0) {
        splitHint(mode === 'share'
            ? 'Your share is nothing — there is no expense to record.'
            : 'You did not put anything down on this bill, so there is nothing to record yet.');
        return;
    }

    const stamp = todayIso();
    const entry = {
        id: ledgerId('e'),
        seq: ++ledgerSeq,
        type: 'expense',
        amount: String(fromSen(senToRecord)),
        currency: BASE_CURRENCY,
        base: '', rate: '',
        date: bill.date,
        category, sub: '',
        account, toAccount: '',
        note: (bill.title.trim() || 'Bill split') +
            (mode === 'share' ? ' — my share'
                : sums.payers > 1 ? ' — what I paid' : ' — the whole bill'),
        created: stamp, updated: stamp,
    };

    ledgerState.entries.push(entry);
    ledgerState.month = monthOf(entry.date);
    saveLedger();

    bill.entryId = entry.id;
    // Kept on the bill as well as on the entry: when somebody pays you back
    // into a different account, this is the account the money has to come
    // *from* for the two balances to end up right.
    bill.account = account;
    commitBill();
    saveSplit();

    splitHint(mode === 'share'
        ? 'Recorded ' + money(fromSen(sums.mySen)) + ' under Expenses — your share only.'
        : 'Recorded ' + money(fromSen(senToRecord)) + ' under Expenses — ' +
          (sums.payers > 1 ? 'what you put down. ' : 'the whole bill. ') +
          'Each repayment comes back off it as they pay you.');
    renderSplit();
    renderLedger();
    renderDash();
}

/**
 * --------------------------------------------------------------------
 * Being paid back
 * --------------------------------------------------------------------
 * You paid RM60 out of Maybank and three people hand you RM45 back into Touch
 * 'n Go. Only your own RM15 is an expense — the app has always been right
 * about that — but the two *balances* are wrong until the ledger is told that
 * RM45 of what left Maybank arrived somewhere else.
 *
 * That is a transfer, and a transfer is exactly the right shape: it is
 * neither income nor spending, it touches no total, and it moves the two
 * balances by the same amount. The money was never really theirs to give you;
 * it passed through your account on its way back.
 *
 * When they pay you back into the same account you paid from, nothing has to
 * be written at all — the money came back where it left.
 */
const billPaidFromAccount = (bill) => {
    const entry = bill.entryId && ledgerState.entries.find((e) => e.id === bill.entryId);
    if (entry && accountById(entry.account)) return entry.account;
    if (accountById(bill.account)) return bill.account;

    const picked = ($('splitExpAccount') || {}).value || '';
    if (accountById(picked)) return picked;

    const open = openAccounts();
    return open.length ? open[0].id : '';
};

/**
 * Your share, leaving your account on the day you hand it over. Somebody else
 * put the money down at the table; this is the moment it becomes yours to
 * have spent, which is why it is written here rather than when the bill was
 * typed in.
 */
function settleWriteShare(bill, move, fromAccount) {
    if (!accountById(fromAccount) || move.amount <= 0) return '';

    const stamp = todayIso();
    const entry = {
        id: ledgerId('e'),
        seq: ++ledgerSeq,
        type: 'expense',
        amount: String(fromSen(move.amount)),
        currency: BASE_CURRENCY,
        base: '', rate: '',
        date: stamp,
        category: ($('splitExpCategory') || {}).value || '',
        sub: '',
        account: fromAccount, toAccount: '',
        // Named when there is more than one person to pay back, or two
        // top-ups on the same bill would land in Expenses reading the same.
        note: (bill.title.trim() || 'Bill split') + ' — my share' +
            (splitCompute(bill).transfers.filter((t) => t.from === 0).length > 1
                ? ' to ' + personName(move.toPerson, move.to) : ''),
        created: stamp, updated: stamp,
    };

    ledgerState.entries.push(entry);
    ledgerState.month = monthOf(entry.date);
    saveLedger();

    // The bill claims this as its entry only if it has none. Where several
    // people paid, the reader can both have recorded what they put down and
    // still owe somebody a top-up — two entries, and the second must not
    // shove the first out of the link.
    if (!bill.entryId) {
        bill.entryId = entry.id;
        bill.account = fromAccount;
    }
    return entry.id;
}

/**
 * A repayment, in whichever shape the bill was recorded.
 *
 *   the whole bill  → money back: it raises the account it lands in and takes
 *                     its amount off the category the bill was filed under,
 *                     so what you spent settles down to what you consumed.
 *   your share only → a transfer: the money you fronted leaving the account it
 *                     really left, and arriving where they actually paid you.
 */
function settleWriteEntry(bill, move, toAccount) {
    if (!toAccount || !accountById(toAccount)) return '';

    const stamp = todayIso();
    const who = personName(move.fromPerson, move.from) || 'someone';
    const note = (bill.title.trim() || 'Bill split') + ' — ' + who + ' paid back';

    const common = {
        id: ledgerId('e'),
        seq: ++ledgerSeq,
        amount: String(fromSen(move.amount)),
        currency: BASE_CURRENCY,
        base: '', rate: '',
        date: stamp,
        note,
        created: stamp, updated: stamp,
    };

    let entry;
    if (bill.recorded === 'share') {
        const fromAccount = billPaidFromAccount(bill);
        // Same account both ends means the money came back where it left, and
        // nothing has to be written at all.
        if (!fromAccount || fromAccount === toAccount) return '';
        entry = { ...common, type: 'transfer', category: '', sub: '', account: fromAccount, toAccount };
    } else {
        const linked = bill.entryId && ledgerState.entries.find((e) => e.id === bill.entryId);
        entry = {
            ...common,
            type: 'refund',
            // Filed where the bill was, so it comes off the right category.
            category: (linked && linked.category) || ($('splitExpCategory') || {}).value || '',
            sub: '',
            account: toAccount, toAccount: '',
        };
    }

    ledgerState.entries.push(entry);
    ledgerState.month = monthOf(entry.date);
    saveLedger();
    return entry.id;
}

function splitRemoveShare() {
    readSplitState();
    const bill = draft();
    if (!bill.entryId) return;

    ledgerState.entries = ledgerState.entries.filter((e) => e.id !== bill.entryId);
    saveLedger();

    bill.entryId = '';
    commitBill();
    saveSplit();

    splitHint('Entry removed from Expenses.');
    renderSplit();
    renderLedger();
    renderDash();
}

/** The two pickers the expense needs. Rebuilt whenever either list changes. */
function buildSplitExpenseOptions() {
    const cats = $('splitExpCategory');
    if (cats) {
        const previous = cats.value;
        cats.innerHTML = '';
        categoryListFor('expense').forEach((category) => {
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.label;
            cats.appendChild(option);
        });
        if ([...cats.options].some((o) => o.value === previous)) cats.value = previous;
    }

    const accounts = $('splitExpAccount');
    if (accounts) {
        const previous = accounts.value;
        accounts.innerHTML = '';
        openAccounts().forEach((account, index) => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.name.trim() || 'Account ' + (index + 1);
            accounts.appendChild(option);
        });
        if ([...accounts.options].some((o) => o.value === previous)) accounts.value = previous;
    }
}

/**
 * --------------------------------------------------------------------
 * Persistence
 * --------------------------------------------------------------------
 */
function saveSplit() {
    try {
        storeWrite(SPLIT_KEY, JSON.stringify({
            seq: splitSeq,
            filter: splitState.filter,
            bills: splitState.bills,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

function loadSplit() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(SPLIT_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};

    splitSeq = Number(saved.seq) || 0;
    splitState.filter = ['open', 'settled', 'all'].includes(saved.filter) ? saved.filter : 'open';

    const readItem = (item) => ({
        id: String((item && item.id) || nextId('i')),
        label: String((item && item.label) || ''),
        amount: String((item && item.amount) || ''),
        off: String((item && item.off) || ''),
    });

    /** A shared dish may also carry portions. Absent means the bill predates
     *  them, which is an even split — exactly what it always was. */
    const readShared = (item, known) => {
        const row = readItem(item);
        const units = {};
        Object.entries((item && item.units) || {}).forEach(([id, value]) => {
            if (known.has(id)) units[id] = String(value || '');
        });
        row.units = units;
        row.byUnits = !!(item && item.byUnits);

        // Anyone excluded who is no longer at the table cannot stay excluded,
        // and a dish that ended up with nobody on it goes back to everyone —
        // an untrusted file must not be able to produce a dish that divides by
        // nothing.
        const out = (Array.isArray(item && item.out) ? item.out : [])
            .map(String).filter((id) => known.has(id));
        row.out = out.length >= known.size ? [] : out;
        return row;
    };

    splitState.bills = (Array.isArray(saved.bills) ? saved.bills : [])
        .filter((b) => b && b.id && Array.isArray(b.people) && b.people.length)
        .map((b, index) => {
            // Every method that ever existed here, read forward into the only
            // one that still does.
            //
            //   equal    no figure per person at all — it divided the total by
            //            the number of heads when it painted
            //   custom   ringgit against each name
            //   percent  a percentage of a separately typed bill total
            //   share    either of those two, after they merged
            //   items    already lines under people; nothing to do
            //
            // The first four kept a *number per person* and no lines, and this
            // module now reads nothing but lines. Mapping them across without
            // writing those numbers down as lines would read every one of
            // those bills as zero and quietly wipe a record — so the figure is
            // worked out once, here, and becomes an unlabelled line under its
            // owner. Same total, same share each, spelled out instead of
            // implied. `allocateSen` does the dividing so the sen that will
            // not split three ways still lands somewhere.
            const rmWas  = b.method === 'custom' || (b.method === 'share' && b.shareUnit === 'rm');
            const pctWas = b.method === 'percent' || (b.method === 'share' && b.shareUnit !== 'rm');
            const lump = b.method !== 'items';

            const billSen = Math.max(0, toSen(parseFloat(b.amount) || 0));
            const lumpSen = !lump ? null
                : rmWas
                    ? b.people.map((p) => Math.max(0, toSen(parseFloat(p.share || p.custom) || 0)))
                    // Percentages, and the even split, are both a division of
                    // the bill total — by the figures typed, or by the heads.
                    : allocateSen(billSen, b.people.map((p) => (pctWas
                        ? Math.max(0, Math.round((parseFloat(p.share || p.percent) || 0) * 100))
                        : 1)));

            const people = b.people.map((p, at) => {
                const items = (Array.isArray(p.items) ? p.items : []).map(readItem);
                if (lumpSen && lumpSen[at]) {
                    items.unshift({ id: nextId('i'), label: '', amount: String(fromSen(lumpSen[at])), off: '' });
                }
                return { id: String(p.id), name: String(p.name || ''), items };
            });
            people.forEach((p) => { if (!p.items.length) p.items.push(newItem()); });

            const known = new Set(people.map((p) => p.id));
            const paidBy = known.has(b.paidBy) ? String(b.paidBy) : people[0].id;

            // Who put money down at which till. A bill saved before there
            // could be more than one has none of this, which reads as the one
            // payer covering the lot — exactly what it always was.
            // Lines a payment names have to still be on the bill, and no line
            // may be on two tills — an edited file must not be able to make the
            // same money come back twice.
            const lineIds = new Set(people.reduce((list, person) =>
                list.concat(person.items.map((item) => item.id)), [])
                .concat((Array.isArray(b.shared) ? b.shared : []).map((item) => String((item || {}).id || ''))));
            const taken = new Set();

            const payments = (Array.isArray(b.payments) ? b.payments : [])
                .filter((pay) => pay && known.has(String(pay.by)))
                .map((pay) => ({
                    id: String(pay.id || nextId('y')),
                    by: String(pay.by),
                    label: String(pay.label || ''),
                    amount: String(pay.amount || ''),
                    items: (Array.isArray(pay.items) ? pay.items : []).map(String)
                        .filter((one) => lineIds.has(one) && !taken.has(one) && taken.add(one) !== false),
                }));

            // A tick used to be `true` and nothing more. Now it remembers the
            // account the money came back into and the transfer that moved it,
            // so an older bill reads as settled with neither.
            //
            // It was also keyed by the person who owed, because with one payer
            // that named the handover on its own. It cannot any more — the
            // same person can owe two people — so a tick belongs to the pair,
            // and an older key is read forward as that person owing whoever
            // paid the bill, which is who they owed.
            const settled = {};
            Object.keys(b.settled || {}).forEach((raw) => {
                const ends = String(raw).split('>');
                const pair = ends.length === 2 ? ends : [String(raw), paidBy];
                if (!known.has(pair[0]) || !known.has(pair[1]) || pair[0] === pair[1]) return;

                const held = b.settled[raw];
                settled[pair[0] + '>' + pair[1]] = (held && typeof held === 'object')
                    ? {
                        account: String(held.account || ''),
                        entryId: String(held.entryId || ''),
                        date: /^\d{4}-\d{2}-\d{2}$/.test(held.date || '') ? String(held.date) : '',
                    }
                    : { account: '', entryId: '', date: '' };
            });

            return {
                id: String(b.id),
                seq: Number(b.seq) || index + 1,
                title: String(b.title || ''),
                date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? String(b.date) : todayIso(),
                people,
                shared: (Array.isArray(b.shared) ? b.shared : []).map((item) => readShared(item, known)),
                paidBy,
                multiPay: !!b.multiPay,
                payments,
                // Absent means the bill predates the choice, and what it did
                // was net — reading it the other way would show a reader a
                // different set of debts than the one they ticked off.
                settleStyle: b.settleStyle === 'till' ? 'till' : 'net',
                service: String(b.service || '0'),
                tax: String(b.tax || '0'),
                discount: String(b.discount || ''),
                round: !!b.round,
                // Absent means the bill predates the unit switch, and what it
                // recorded was ringgit. Reading it as a percentage would
                // silently rewrite a figure the reader already checked.
                discountUnit: b.discountUnit === 'pct' ? 'pct' : 'rm',
                itemDiscounts: !!b.itemDiscounts,
                offUnit: b.offUnit === 'rm' ? 'rm' : 'pct',
                // A bill saved before the module knew about delivery has none
                // of these, which reads as a bill nobody delivered — which it
                // was. Nothing to migrate.
                delivery: !!b.delivery,
                deliveryFee: String(b.deliveryFee || ''),
                platformFee: String(b.platformFee || ''),
                voucher: String(b.voucher || ''),
                // Unlike the bill discount, this one has never been anything
                // but ringgit, so an absent unit is the ringgit it always was.
                voucherUnit: b.voucherUnit === 'pct' ? 'pct' : 'rm',
                feeSplit: b.feeSplit === 'order' ? 'order' : 'even',
                settled,
                entryId: String(b.entryId || ''),
                account: String(b.account || ''),
                // Bills written before there were two ways only ever held a
                // share, so one with an entry already against it keeps that
                // reading rather than being re-interpreted underneath itself.
                recorded: b.recorded === 'share' || (!b.recorded && b.entryId) ? 'share' : 'full',
                created: String(b.created || b.date || ''),
                updated: String(b.updated || b.date || ''),
            };
        });

    // Never hand out an id that is already in the book.
    splitState.bills.forEach((b) => { splitSeq = Math.max(splitSeq, b.seq); });
    if ($('splitFilter')) setSegment($('splitFilter'), splitState.filter);
}

/**
 * ====================================================================
 * CATEGORIES
 * ====================================================================
 * One list, owned by the reader, shared by every module that names a
 * category. It used to be two constants — eight fixed budget lines and six
 * income labels — which meant a category could not be renamed, and a name
 * changed in one place would not have followed into the other.
 *
 * A category carries:
 *
 *   bucket   needs | wants | save | income. The first three are what makes
 *            the 50/30/20 reading possible; `income` puts the category on
 *            the Received list instead, where buckets mean nothing.
 *   enabled  a category with history behind it must not be deleted — the
 *            entries would lose their name. Disabling takes it out of the
 *            pickers and leaves every record intact.
 *   subs     sub-categories: the same idea one level down.
 *
 * Ids are stable and never derived from the label, so renaming "Food &
 * Drinks" to "Makan" does not orphan a year of entries. The default ids that
 * overlap the Budget Planner's old lines are deliberately unchanged, so a
 * book recorded before this existed still reads against its plan.
 */
const CATEGORY_KEY = 'moneyflow.categories.v1';

const CATEGORY_BUCKETS = {
    needs:  'Needs',
    wants:  'Wants',
    save:   'Savings & debt',
    income: 'Money coming in',
};

/** Only the first three are spending, so only those three are what the
 *  50/30/20 reading divides. `BUDGET_BUCKETS` below keeps their tones. */
const SPENDING_BUCKETS = ['needs', 'wants', 'save'];

/** Tints a category may carry — names, not hex, so the palette moves with
 *  the stylesheet rather than being frozen into saved data. */
const CATEGORY_TONES = ['jade', 'amber', 'indigo', 'red', 'violet', 'sky', 'rose', 'slate'];

/** Icons offered by the picker. Bootstrap Icons is already loaded for the
 *  chrome, so this costs nothing but the list itself. */
const CATEGORY_ICONS = [
    'bi-tag', 'bi-cup-hot', 'bi-basket', 'bi-car-front', 'bi-bag', 'bi-house-door',
    'bi-controller', 'bi-heart-pulse', 'bi-airplane', 'bi-receipt', 'bi-mortarboard',
    'bi-people', 'bi-bank', 'bi-shield-check', 'bi-piggy-bank', 'bi-credit-card',
    'bi-cash-stack', 'bi-gift', 'bi-briefcase', 'bi-envelope-heart', 'bi-phone',
    'bi-lightning-charge', 'bi-droplet', 'bi-wifi', 'bi-heart', 'bi-star',
    'bi-cart', 'bi-scissors', 'bi-tools', 'bi-three-dots',
];

const DEFAULT_CATEGORIES = [
    { id: 'food',          label: 'Food & Drinks',  bucket: 'needs',  icon: 'bi-cup-hot',      tone: 'amber',
      hint: 'Groceries, kopitiam, food delivery',
      subs: ['Breakfast', 'Lunch', 'Dinner', 'Drinks', 'Snacks'] },
    { id: 'transport',     label: 'Transportation', bucket: 'needs',  icon: 'bi-car-front',    tone: 'sky',
      hint: 'Petrol, tolls, parking, Grab, car loan',
      subs: ['Petrol', 'Toll', 'Parking', 'Grab', 'Public Transport', 'Car Maintenance'] },
    { id: 'shopping',      label: 'Shopping',       bucket: 'wants',  icon: 'bi-bag',          tone: 'rose',
      hint: 'Clothes, electronics, the weekly run',
      subs: ['Clothes', 'Electronics', 'Groceries', 'Personal Items'] },
    { id: 'housing',       label: 'Housing',        bucket: 'needs',  icon: 'bi-house-door',   tone: 'jade',
      hint: 'Rent, mortgage, maintenance fee',
      subs: ['Rent', 'Maintenance', 'Utilities', 'Household'] },
    { id: 'entertainment', label: 'Entertainment',  bucket: 'wants',  icon: 'bi-controller',   tone: 'violet',
      hint: 'Outings, hobbies, going out',
      subs: ['Movies', 'Games', 'Events', 'Hobbies'] },
    { id: 'healthcare',    label: 'Healthcare',     bucket: 'needs',  icon: 'bi-heart-pulse',  tone: 'red',
      hint: 'Clinic, pharmacy, dentist',
      subs: ['Clinic', 'Medicine', 'Dental'] },
    { id: 'travel',        label: 'Travel',         bucket: 'wants',  icon: 'bi-airplane',     tone: 'sky',
      hint: 'Flights, hotels, the holiday itself',
      subs: ['Flight', 'Hotel', 'Activities', 'Food', 'Transportation'] },
    { id: 'bills',         label: 'Bills',          bucket: 'needs',  icon: 'bi-receipt',      tone: 'amber',
      hint: 'TNB, water, Unifi, phone, subscriptions',
      subs: ['Electricity', 'Water', 'Internet', 'Phone', 'Subscriptions'] },
    { id: 'education',     label: 'Education',      bucket: 'needs',  icon: 'bi-mortarboard',  tone: 'indigo',
      hint: 'Courses, books, training',
      subs: ['Courses', 'Books', 'Training'] },
    { id: 'family',        label: 'Family',         bucket: 'needs',  icon: 'bi-people',       tone: 'rose',
      hint: 'Parents, children, gifts',
      subs: ['Parents', 'Children', 'Gifts'] },
    { id: 'finance',       label: 'Finance',        bucket: 'needs',  icon: 'bi-bank',         tone: 'slate',
      hint: 'Bank charges and interest paid',
      subs: ['Bank Fees', 'Interest'] },
    { id: 'insurance',     label: 'Insurance',      bucket: 'needs',  icon: 'bi-shield-check', tone: 'jade',
      hint: 'Medical, life, motor, takaful',
      subs: ['Medical', 'Life', 'Motor', 'Takaful'] },
    { id: 'savings',       label: 'Savings',        bucket: 'save',   icon: 'bi-piggy-bank',   tone: 'indigo',
      hint: 'ASB, unit trust, emergency fund, gold',
      subs: ['Emergency fund', 'ASB', 'Unit trust', 'Gold'] },
    { id: 'debt',          label: 'Debt',           bucket: 'save',   icon: 'bi-credit-card',  tone: 'indigo',
      hint: 'Credit card, PTPTN, personal loan',
      subs: ['Credit card', 'PTPTN', 'Personal loan'] },
    { id: 'instalment',    label: 'Instalment',     bucket: 'save',   icon: 'bi-calendar2-check', tone: 'indigo',
      hint: 'Phone, car, BNPL, personal financing',
      subs: ['Phone', 'Car', 'Electronics', 'Furniture', 'BNPL'] },
    { id: 'other',         label: 'Others',         bucket: 'wants',  icon: 'bi-three-dots',   tone: 'slate',
      hint: 'Anything that does not fit', subs: [] },

    { id: 'salary',        label: 'Salary',         bucket: 'income', icon: 'bi-cash-stack',   tone: 'jade',
      hint: 'What lands after EPF, SOCSO and PCB', subs: [] },
    { id: 'bonus',         label: 'Bonus',          bucket: 'income', icon: 'bi-gift',         tone: 'jade',
      hint: 'Yearly, contractual or otherwise', subs: [] },
    { id: 'side',          label: 'Side income',    bucket: 'income', icon: 'bi-briefcase',    tone: 'jade',
      hint: 'Freelance, part-time, a small business', subs: [] },
    { id: 'refund',        label: 'Refund',         bucket: 'income', icon: 'bi-arrow-counterclockwise', tone: 'jade',
      hint: 'Claims, returns, money coming back', subs: [] },
    { id: 'gift',          label: 'Angpao',         bucket: 'income', icon: 'bi-envelope-heart', tone: 'rose',
      hint: 'Gifts and angpao', subs: [] },
    { id: 'other-in',      label: 'Other',          bucket: 'income', icon: 'bi-three-dots',   tone: 'slate',
      hint: 'Anything else that came in', subs: [] },
];

let categorySeq = 0;
const newCategoryId = (prefix) => prefix + (++categorySeq);

let categoryState = { list: [] };

const seedCategories = () => DEFAULT_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    bucket: cat.bucket,
    icon: cat.icon,
    tone: cat.tone,
    hint: cat.hint,
    enabled: true,
    subs: cat.subs.map((label, i) => ({ id: cat.id + '-s' + (i + 1), label, enabled: true })),
}));

/**
 * Categories a module cannot work without. A default that arrives after
 * someone has already been using the app would otherwise never reach them:
 * `seedCategories` only runs on a first visit. So these are topped up on load
 * — by id, so one that has been retired stays retired and one that has been
 * renamed keeps its name.
 */
const INSTALMENT_CATEGORY = 'instalment';
const REQUIRED_CATEGORIES = [INSTALMENT_CATEGORY];

const categoryById = (id) => categoryState.list.find((c) => c.id === id) || null;

/** A category with no name yet is still a category; it just has no name yet. */
const categoryLabel = (cat, index) => (cat.label || '').trim() || 'Category ' + (index + 1);

const shapedCategoryRow = (cat, i) => ({
    id: cat.id,
    label: categoryLabel(cat, i),
    bucket: cat.bucket,
    icon: cat.icon,
    tone: cat.tone,
    hint: cat.hint,
});

/**
 * What a picker should offer for a transaction type: enabled, on the right
 * side of the ledger, and "Other" last — `categoryOf` falls back to the final
 * row when an id no longer resolves, and Other is the only honest place for
 * an orphaned entry to land.
 */
function categoryListFor(type) {
    const wantIncome = type === 'income';
    const rows = categoryState.list
        .map((cat, i) => (cat.enabled && (cat.bucket === 'income') === wantIncome
            ? shapedCategoryRow(cat, i) : null))
        .filter(Boolean);

    const catchAll = wantIncome ? 'other-in' : 'other';
    const tail = rows.filter((cat) => cat.id === catchAll);
    return rows.filter((cat) => cat.id !== catchAll).concat(tail);
}

/** Sub-categories of one category, for the second picker. */
function subListFor(id) {
    const cat = categoryById(id);
    return cat ? cat.subs.filter((sub) => sub.enabled && sub.label.trim()) : [];
}

/** The name to print for a sub-category id, or '' if it no longer resolves. */
function subLabelOf(categoryId, subId) {
    const cat = categoryById(categoryId);
    const sub = cat && cat.subs.find((s) => s.id === subId);
    return sub ? sub.label.trim() : '';
}

function saveCategories() {
    try {
        storeWrite(CATEGORY_KEY, JSON.stringify({
            seq: categorySeq,
            list: categoryState.list,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

function loadCategories() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(CATEGORY_KEY) || 'null'); } catch (err) { saved = null; }

    const rows = saved && Array.isArray(saved.list) ? saved.list : null;
    categorySeq = Number(saved && saved.seq) || 0;

    if (!rows || !rows.length) { categoryState.list = seedCategories(); return; }

    categoryState.list = rows.filter((c) => c && c.id).map((c) => ({
        id: String(c.id),
        label: String(c.label || ''),
        bucket: CATEGORY_BUCKETS[c.bucket] ? c.bucket : 'wants',
        icon: String(c.icon || 'bi-tag'),
        tone: CATEGORY_TONES.includes(c.tone) ? c.tone : 'jade',
        hint: String(c.hint || ''),
        enabled: c.enabled !== false,
        subs: (Array.isArray(c.subs) ? c.subs : []).filter((s) => s && s.id).map((s) => ({
            id: String(s.id),
            label: String(s.label || ''),
            enabled: s.enabled !== false,
        })),
    }));

    // A category a module depends on, added to the app after this book was
    // started, would otherwise never appear — `seedCategories` runs on the
    // first visit only. Missing by id is the test, so a retired one stays
    // retired and a renamed one keeps its name.
    REQUIRED_CATEGORIES.forEach((id) => {
        if (categoryState.list.some((c) => c.id === id)) return;
        const seed = DEFAULT_CATEGORIES.find((c) => c.id === id);
        if (!seed) return;
        categoryState.list.push({
            id: seed.id, label: seed.label, bucket: seed.bucket, icon: seed.icon,
            tone: seed.tone, hint: seed.hint, enabled: true,
            subs: seed.subs.map((label, i) => ({ id: seed.id + '-s' + (i + 1), label, enabled: true })),
        });
    });
}

/**
 * ====================================================================
 * FINANCIAL PLANNER
 * ====================================================================
 * The module that runs before the money does. The Expense Recorder answers
 * "where did it go"; this one answers "where should it go", and then holds
 * the two side by side.
 *
 * The rows are the reader's own categories, so this module owns none of them
 * — it owns the amounts. Those are still read straight off the DOM, which is
 * what keeps the caret where it was while a figure is being typed.
 *
 * Every category belongs to one of three spending buckets, which is what makes
 * the 50/30/20 comparison possible:
 *
 *   needs — the month happens whether you like it or not
 *   wants — the part you could cut this month if you had to
 *   save  — money that is still yours afterwards, or debt being cleared
 *
 * Debt sits in `save` rather than `needs` on purpose: paying down a card is
 * building net worth the same way a deposit does, and 50/30/20 treats it that
 * way too.
 *
 * --------------------------------------------------------------------
 * A budget is a record, not a setting
 * --------------------------------------------------------------------
 * The first version of this module held one budget and saved it silently as
 * you typed. That is a setting: there was no August to compare September
 * against, and no moment where you decided the plan was finished. So a budget
 * is now one record per period, the form is a draft until "Save plan" is
 * pressed, and the draft is persisted separately so that closing the tab does
 * not lose an afternoon's work — it simply is not history yet.
 *
 * `Used` is never stored. It is summed out of the ledger at paint time, for
 * exactly the dates the period covers. A budget that carried its own copy of
 * what was spent would be a second version of the truth.
 */
/** The planner plans against the reader's own categories, so that a rename
 *  in the Expense Recorder is the same rename here. Only spending is planned:
 *  income categories have nothing to budget. */
const budgetCategories = () => categoryState.list
    .map((cat, i) => (cat.enabled && cat.bucket !== 'income' ? shapedCategoryRow(cat, i) : null))
    .filter(Boolean);

const BUDGET_BUCKETS = {
    needs: { label: 'Needs',           tone: 'jade' },
    wants: { label: 'Wants',           tone: 'amber' },
    save:  { label: 'Savings & debt',  tone: 'indigo' },
};

/** Targets as percentages of income. `off` plans without a yardstick. */
const BUDGET_RULES = {
    '502030': { name: '50/30/20', needs: 50, wants: 30, save: 20 },
    '702010': { name: '70/20/10', needs: 70, wants: 20, save: 10 },
};

const BUDGET_KEY = 'moneyflow.budget.v1';

const BUDGET_PERIODS = { week: 1, month: 1, year: 1, custom: 1 };

/** Where a used-versus-budget figure crosses from calm into a warning, and
 *  then into red. 100% is the line itself, so it belongs to amber. */
const budgetTone = (pct) => (pct > 100 ? 'red' : pct >= 80 ? 'amber' : 'jade');

let planState = { budgets: [], draft: null, seq: 0 };

const blankPlan = () => ({
    period: 'month',
    anchor: todayIso(),
    from: '', to: '',
    income: '', extra: '', rule: '502030',
    lines: {},
});

const planDraft = () => planState.draft || (planState.draft = blankPlan());

const budgetRule = () => BUDGET_RULES[(($('budgetRule') || {}).dataset || {}).value] || null;

/**
 * --------------------------------------------------------------------
 * The period
 * --------------------------------------------------------------------
 * Weeks start on Monday, the same as the Dashboard. A custom range with one
 * end missing is the other end: a range needs two ends to be a range, and ends
 * typed backwards are swapped rather than refused, because the intent is never
 * in doubt.
 */
function planRange(plan) {
    const anchor = plan.anchor || todayIso();

    if (plan.period === 'week') {
        const from = weekStart(anchor);
        const to   = isoShift(from, 6);
        return { from, to, label: 'Week of ' + dayShort(from), sub: dayShort(from) + ' – ' + dayLabel(to) };
    }

    if (plan.period === 'year') {
        const [y] = isoNums(anchor);
        return { from: isoOf(y, 1, 1), to: isoOf(y, 12, 31), label: String(y), sub: 'The whole of ' + y };
    }

    if (plan.period === 'custom') {
        let from = plan.from || '';
        let to   = plan.to   || '';
        if (!from && !to) { from = anchor; to = anchor; }
        if (!from) from = to;
        if (!to)   to   = from;
        if (from > to) { const held = from; from = to; to = held; }
        return {
            from, to,
            label: 'Custom range',
            sub: from === to ? dayLabel(from) : dayLabel(from) + ' – ' + dayLabel(to),
        };
    }

    const [y, m] = isoNums(anchor);
    return {
        from: monthFirst(y, m), to: monthLast(y, m),
        label: MONTH_NAMES[m - 1] + ' ' + y,
        sub: 'The whole of ' + MONTH_NAMES[m - 1],
    };
}

/** Two budgets are the same budget when they cover the same dates the same
 *  way — which is what makes "save again" an update rather than a duplicate. */
const planKey = (plan, range) => plan.period + ':' + range.from + ':' + range.to;

/** One period forward or back. Custom ranges have no next, so they sit still. */
function shiftPlan(plan, delta) {
    if (plan.period === 'custom') return plan.anchor;
    if (plan.period === 'week')   return isoShift(plan.anchor || todayIso(), delta * 7);

    const [y, m, d] = isoNums(plan.anchor || todayIso());
    if (plan.period === 'year')   return isoOf(y + delta, m, d);

    // Month. Anchoring on the 1st keeps a 31st from skidding past February.
    const moved = new Date(y, m - 1 + delta, 1);
    return isoOfDate(moved);
}

/**
 * --------------------------------------------------------------------
 * The sums
 * --------------------------------------------------------------------
 */
/** Every ringgit the ledger says was spent inside the period, by category. */
function budgetUsedIn(from, to) {
    const used = {};
    ledgerState.entries.forEach((entry) => {
        if (!isSpend(entry)) return;
        if (entry.date < from || entry.date > to) return;
        const cat = categoryOf(entry);
        if (!cat) return;
        used[cat.id] = (used[cat.id] || 0) + spendSen(entry);
    });
    return used;
}

/** The categories in play, in one flat list, each carrying what was planned
 *  for it and what actually happened. A retired category with spending on it
 *  still appears — the money went somewhere and hiding it would not help. */
function budgetRowValues(used) {
    const rows = budgetCategories().map((cat) => ({
        id: cat.id,
        label: cat.label,
        bucket: cat.bucket,
        icon: cat.icon,
        hint: cat.hint,
        sen: Math.max(0, toSen(num('bgt_' + cat.id))),
        usedSen: used[cat.id] || 0,
    }));

    const known = new Set(rows.map((r) => r.id));
    Object.keys(used).forEach((id) => {
        if (known.has(id)) return;
        const cat = categoryById(id);
        if (!cat || cat.bucket === 'income') return;
        rows.push({
            id, label: categoryLabel(cat, 0), bucket: cat.bucket, icon: cat.icon,
            hint: cat.hint, sen: 0, usedSen: used[id], retired: true,
        });
    });

    return rows;
}

function budgetCompute() {
    const plan  = planDraft();
    const range = planRange(plan);
    const used  = budgetUsedIn(range.from, range.to);

    const incomeSen = Math.max(0, toSen(num('budgetIncome'))) + Math.max(0, toSen(num('budgetExtra')));
    const rows = budgetRowValues(used);

    const bucketSen = { needs: 0, wants: 0, save: 0 };
    rows.forEach((row) => { bucketSen[row.bucket] += row.sen; });

    const plannedSen = bucketSen.needs + bucketSen.wants + bucketSen.save;
    const spendSen   = bucketSen.needs + bucketSen.wants;   // money that is gone once spent
    const leftSen    = incomeSen - plannedSen;
    const usedSen    = rows.reduce((sum, row) => sum + row.usedSen, 0);

    const share = (sen) => (incomeSen > 0 ? sen / incomeSen * 100 : 0);

    return {
        plan, range, used, incomeSen, rows, bucketSen, plannedSen, spendSen, leftSen, usedSen,
        rule: budgetRule(),
        spendPct: share(spendSen),
        saveRate: share(bucketSen.save),
        leftPct:  share(leftSen),
        usedPct:  plannedSen > 0 ? usedSen / plannedSen * 100 : 0,
        share,
        key: planKey(plan, range),
        saved: planState.budgets.find((b) => b.key === planKey(plan, range)) || null,
    };
}

/**
 * --------------------------------------------------------------------
 * Draft in, draft out
 * --------------------------------------------------------------------
 * The form is the truth while it is being typed in — reading it back rather
 * than rebuilding it is the only way the caret survives a keystroke.
 */
function readBudgetState() {
    const plan = planDraft();

    plan.period = (($('budgetPeriod') || {}).dataset || {}).value || 'month';
    if (!BUDGET_PERIODS[plan.period]) plan.period = 'month';
    plan.from   = ($('budgetFrom')   || {}).value || '';
    plan.to     = ($('budgetTo')     || {}).value || '';
    plan.income = ($('budgetIncome') || {}).value || '';
    plan.extra  = ($('budgetExtra')  || {}).value || '';
    plan.rule   = (($('budgetRule')  || {}).dataset || {}).value || '502030';

    plan.lines = {};
    budgetCategories().forEach((cat) => {
        const value = ($('bgt_' + cat.id) || {}).value || '';
        if (value !== '') plan.lines[cat.id] = value;
    });
}

/** The other direction: a saved plan, or a period switch, poured into the form. */
function fillBudgetForm() {
    const plan = planDraft();

    if ($('budgetPeriod')) setSegment($('budgetPeriod'), plan.period);
    if ($('budgetRule'))   setSegment($('budgetRule'), plan.rule);
    if ($('budgetFrom'))   $('budgetFrom').value   = plan.from;
    if ($('budgetTo'))     $('budgetTo').value     = plan.to;
    if ($('budgetIncome')) $('budgetIncome').value = plan.income;
    if ($('budgetExtra'))  $('budgetExtra').value  = plan.extra;

    budgetCategories().forEach((cat) => {
        const el = $('bgt_' + cat.id);
        if (el) el.value = plan.lines[cat.id] || '';
    });
}

/** What makes two plans the same plan, for the purpose of "unsaved changes".
 *  Empty and "0" are the same nothing, or every blank row would read dirty. */
function planSignature(plan) {
    const lines = {};
    Object.entries(plan.lines || {}).forEach(([id, value]) => {
        const sen = Math.max(0, toSen(parseFloat(value) || 0));
        if (sen > 0) lines[id] = sen;
    });
    return JSON.stringify({
        income: Math.max(0, toSen(parseFloat(plan.income) || 0)),
        extra:  Math.max(0, toSen(parseFloat(plan.extra)  || 0)),
        rule:   plan.rule,
        lines,
    });
}

const planIsEmpty = (plan) => planSignature(plan) === planSignature(blankPlan());

/**
 * --------------------------------------------------------------------
 * Saving, stepping, copying
 * --------------------------------------------------------------------
 */
function saveBudgetPlan() {
    readBudgetState();
    const plan  = planDraft();
    const range = planRange(plan);
    const key   = planKey(plan, range);

    if (planIsEmpty(plan)) {
        planHint('There is nothing in this plan yet — put in an income or a category first.');
        return;
    }

    const body = {
        key,
        period: plan.period,
        anchor: plan.anchor,
        from: range.from, to: range.to,
        income: plan.income, extra: plan.extra, rule: plan.rule,
        lines: Object.assign({}, plan.lines),
    };

    const existing = planState.budgets.find((b) => b.key === key);
    if (existing) {
        Object.assign(existing, body, { updated: todayIso() });
    } else {
        planState.budgets.push(Object.assign({
            id: 'b' + (++planState.seq),
            seq: planState.seq,
            created: todayIso(),
            updated: todayIso(),
        }, body));
    }

    persistPlan();
    renderBudget();
    flashButton($('budgetSave'), '<i class="bi bi-check-lg"></i> Saved');
}

/** Back to the saved version of this period, throwing the edits away. */
function revertBudgetPlan() {
    const compute = budgetCompute();
    if (!compute.saved) return;
    planState.draft = planFromRecord(compute.saved);
    fillBudgetForm();
    persistPlan();
    renderBudget();
}

const planFromRecord = (rec) => ({
    period: rec.period,
    anchor: rec.anchor,
    from: rec.period === 'custom' ? rec.from : '',
    to:   rec.period === 'custom' ? rec.to   : '',
    income: rec.income, extra: rec.extra, rule: rec.rule,
    lines: Object.assign({}, rec.lines),
});

/** Move to another period. A period with a saved budget opens it; one without
 *  opens blank, and the foot offers last month's as a starting point. */
function stepBudgetPeriod(delta) {
    readBudgetState();
    const plan = planDraft();
    plan.anchor = shiftPlan(plan, delta);
    loadPeriodIntoForm();
}

function loadPeriodIntoForm() {
    const plan  = planDraft();
    const range = planRange(plan);
    const saved = planState.budgets.find((b) => b.key === planKey(plan, range));

    if (saved) {
        planState.draft = planFromRecord(saved);
    } else {
        planState.draft = Object.assign(blankPlan(), {
            period: plan.period, anchor: plan.anchor, from: plan.from, to: plan.to, rule: plan.rule,
        });
    }

    fillBudgetForm();
    persistPlan();
    renderBudget();
}

/** The most recent saved plan of the same shape, so "copy" copies like for
 *  like — a weekly budget is not a starting point for a yearly one. */
function previousPlanFor(plan) {
    const range = planRange(plan);
    return planState.budgets
        .filter((b) => b.period === plan.period && b.to < range.from)
        .sort((a, b) => (a.to < b.to ? 1 : -1))[0] || null;
}

function copyPreviousPlan() {
    readBudgetState();
    const plan = planDraft();
    const last = previousPlanFor(plan);
    if (!last) return;

    plan.income = last.income;
    plan.extra  = last.extra;
    plan.rule   = last.rule;
    plan.lines  = Object.assign({}, last.lines);

    fillBudgetForm();
    persistPlan();
    renderBudget();
    planHint('Copied the plan from ' + planRangeLabelOf(last) + '. Nothing is saved until you press Save plan.');
}

const planRangeLabelOf = (rec) => planRange({
    period: rec.period, anchor: rec.anchor, from: rec.from, to: rec.to,
}).label;

function openSavedPlan(id) {
    const rec = planState.budgets.find((b) => b.id === id);
    if (!rec) return;
    planState.draft = planFromRecord(rec);
    fillBudgetForm();
    persistPlan();
    renderBudget();
    const form = $('budget-form');
    if (form) reveal(form).scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function dropSavedPlan(id) {
    const rec = planState.budgets.find((b) => b.id === id);
    if (!rec) return;

    askConfirm(
        'Delete this budget?',
        'The plan for ' + planRangeLabelOf(rec) + ' will be removed. Nothing in your Expenses is touched — ' +
        'only the plan goes.',
        'Delete budget',
        () => {
            planState.budgets = planState.budgets.filter((b) => b.id !== id);
            persistPlan();
            renderBudget();
        });
}

/**
 * --------------------------------------------------------------------
 * The rows
 * --------------------------------------------------------------------
 * Built once per structural change, never on a keystroke: the name is an
 * input now, and rebuilding it mid-word would take the caret with it. Paint
 * only ever writes the derived parts — the bar, the sub-line and the badge.
 */
function buildBudgetRows() {
    const host = $('budgetRows');
    if (!host) return;
    host.innerHTML = '';

    budgetCategories().forEach((cat) => {
        const row = document.createElement('div');
        row.className = 'bgt-row is-plan';
        row.dataset.cat = cat.id;
        row.dataset.bucket = cat.bucket;
        row.innerHTML =
            '<span class="bgt-icon"><i class="bi ' + cat.icon + '"></i></span>' +
            '<div class="bgt-meta">' +
                '<input type="text" class="bgt-name" aria-label="Category name">' +
                '<small id="sub_' + cat.id + '">&mdash;</small>' +
                '<div class="bgt-bar"><i id="bar_' + cat.id + '" style="width:0%"></i></div>' +
            '</div>' +
            '<select class="bgt-bucket" aria-label="Bucket">' +
                Object.entries(BUDGET_BUCKETS).map(([key, b]) =>
                    '<option value="' + key + '">' + b.label + '</option>').join('') +
            '</select>' +
            '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                '<input type="number" class="bgt-amount" id="bgt_' + cat.id + '" ' +
                'min="0" step="10" placeholder="0" inputmode="decimal"></div>' +
            '<span class="bgt-pct" id="pct_' + cat.id + '">&mdash;</span>' +
            '<button type="button" class="split-x" data-drop-budget-cat aria-label="Delete category">' +
                '<i class="bi bi-x-lg"></i></button>';

        // Assigned rather than interpolated — a category name is user-typed.
        const name = row.querySelector('.bgt-name');
        name.value = cat.label;
        name.placeholder = 'Category name';
        row.querySelector('.bgt-bucket').value = cat.bucket;

        host.appendChild(row);
    });

    fillBudgetForm();
}

/** The planner's own feedback line. `ledgerHint` writes into the Expenses
 *  form, which nobody can see from this tab. */
let planHintIdle = '';
function planHint(text) {
    const hint = $('budgetRowsHint');
    if (!hint) return;
    if (!planHintIdle) planHintIdle = hint.innerHTML;
    hint.textContent = text;
    clearTimeout(planHint.timer);
    planHint.timer = setTimeout(() => { hint.innerHTML = planHintIdle; }, 6000);
}

/**
 * Renaming and re-bucketing act on the one shared category list, so a rename
 * here is the same rename in the Expense Recorder — the entries point at the
 * id, never at the name.
 *
 * The category manager holds the *other* copy of these two fields, and
 * `renderLedger` reads it back on every paint. Writing the new value into that
 * row first is what stops the manager's stale input from undoing the edit a
 * keystroke later. Both are inputs on purpose; neither is rebuilt while it is
 * being typed in, which is what keeps the caret.
 */
function mirrorToCategoryManager(cat) {
    const row = document.querySelector('#categoryList .cat-row[data-cat="' + cat.id + '"]');
    if (!row) return;
    const name = row.querySelector('.cat-name');
    const bucket = row.querySelector('.cat-bucket');
    if (name) name.value = cat.label;
    if (bucket) bucket.value = cat.bucket;
}

function onBudgetRowInput(event) {
    const field = event.target.closest('.bgt-name');
    if (!field) return;
    const cat = categoryById(field.closest('.bgt-row').dataset.cat);
    if (!cat) return;
    cat.label = field.value;
    mirrorToCategoryManager(cat);
    saveCategories();
    renderLedger();
}

function onBudgetRowChange(event) {
    const select = event.target.closest('.bgt-bucket');
    if (!select) return;
    const row = select.closest('.bgt-row');
    const cat = categoryById(row.dataset.cat);
    if (!cat) return;
    cat.bucket = select.value;
    row.dataset.bucket = select.value;
    mirrorToCategoryManager(cat);
    saveCategories();
    renderLedger();
}

/** Delete, with the same bargain the category manager strikes: anything with
 *  entries behind it is retired instead, or a year of records would silently
 *  be renamed to "Other". */
function onBudgetRowClick(event) {
    const btn = event.target.closest('button[data-drop-budget-cat]');
    if (!btn) return;
    readBudgetState();

    const row = btn.closest('.bgt-row');
    const cat = categoryById(row.dataset.cat);
    if (!cat) return;

    const held = ledgerState.entries.filter((e) => e.category === cat.id).length;
    if (held) {
        askConfirm(
            'Retire ' + categoryLabel(cat, 0) + '?',
            held + (held === 1 ? ' entry is' : ' entries are') + ' filed under this category, so deleting it ' +
            'would rewrite that history. Retiring it instead takes it out of the plan and out of the pickers, ' +
            'and every entry behind it stays exactly as it is.',
            'Retire it',
            () => {
                cat.enabled = false;
                afterCategoryChange(true);
                planHint(categoryLabel(cat, 0) + ' is retired — bring it back from the category list under Expenses.');
            });
        return;
    }

    if (categoryState.list.filter((c) => c.bucket !== 'income').length <= 1) {
        planHint('Keep at least one spending category — an expense has to be called something.');
        return;
    }

    categoryState.list = categoryState.list.filter((c) => c.id !== cat.id);
    afterCategoryChange(true);
}

/** A budget category is a real category. It has to be, or nothing could ever
 *  be spent on it and Used would read RM 0.00 for the rest of time. */
function addBudgetCategory() {
    readBudgetState();
    categoryState.list.push({
        id: newCategoryId('c'),
        label: '',
        bucket: 'wants',
        icon: 'bi-tag',
        tone: 'jade',
        hint: '',
        enabled: true,
        subs: [],
    });
    afterCategoryChange(true);

    const fresh = document.querySelector('#budgetRows .bgt-row:last-child .bgt-name');
    if (fresh) { reveal(fresh).focus({ preventScroll: true }); reveal(fresh).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    planHint('New categories show up in the Expenses picker straight away — that is what lets spending count against them.');
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
/** The stacked bar. Over-budget months are drawn against what was planned,
 *  not against income, so the overspend is visible instead of clipped. */
function paintBudgetDist(plan) {
    const dist = $('budgetDist');
    const legend = $('budgetLegend');
    if (!dist || !legend) return;

    const baseSen = Math.max(plan.incomeSen, plan.plannedSen);
    const segments = ['needs', 'wants', 'save']
        .map((key) => ({
            key,
            label: BUDGET_BUCKETS[key].label,
            tone: BUDGET_BUCKETS[key].tone,
            sen: plan.bucketSen[key],
        }))
        .filter((s) => s.sen > 0);

    if (plan.leftSen > 0) {
        segments.push({ key: 'left', label: 'Left over', tone: 'left', sen: plan.leftSen });
    }

    dist.innerHTML = '';
    legend.innerHTML = '';

    if (!baseSen) {
        dist.innerHTML = '<span class="dist-left" style="width:100%"></span>';
        legend.innerHTML = '<span class="legend-empty">Put in your income and what the period costs — ' +
            'the bar fills itself in.</span>';
        return;
    }

    segments.forEach((s) => {
        const bar = document.createElement('span');
        bar.className = 'dist-' + s.tone;
        bar.style.width = (s.sen / baseSen * 100) + '%';
        bar.title = s.label + ' · ' + money(fromSen(s.sen));
        dist.appendChild(bar);

        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML =
            '<i class="dot dot-' + s.tone + '"></i>' +
            '<span>' + s.label + ' <b>' + money(fromSen(s.sen)) + '</b> ' +
            '<small>' + pct(plan.share(s.sen)) + '</small></span>';
        legend.appendChild(item);
    });
}

function paintBudgetGuide(plan) {
    const block = $('budgetGuideBlock');
    const body  = $('budgetGuideBody');
    if (!block || !body) return;

    block.hidden = !plan.rule;
    if (!plan.rule) return;

    set('budgetGuideNote', plan.incomeSen
        ? plan.rule.name + ' of ' + money(fromSen(plan.incomeSen))
        : 'Add your income to see the targets');

    body.innerHTML = '';

    Object.keys(BUDGET_BUCKETS).forEach((key) => {
        const targetPct = plan.rule[key];
        const targetSen = Math.round(plan.incomeSen * targetPct / 100);
        const gotSen    = plan.bucketSen[key];
        const diffSen   = gotSen - targetSen;
        const overIsBad = key !== 'save';
        const bad = overIsBad ? diffSen > 0 : diffSen < 0;

        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong><i class="dot dot-' + BUDGET_BUCKETS[key].tone + '"></i>' +
            BUDGET_BUCKETS[key].label + '</strong>' +
            '<small>' + (plan.incomeSen ? pct(plan.share(gotSen)) + ' of income now' : 'No income yet') + '</small>'
        ));
        tr.appendChild(cell(pct(targetPct, 0) + ' · ' + fmt(fromSen(targetSen)), 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(gotSen)), 'is-strong'));
        tr.appendChild(cell(
            (diffSen > 0 ? '+ ' : diffSen < 0 ? '− ' : '') + fmt(Math.abs(fromSen(diffSen))),
            !plan.incomeSen ? 'is-muted' : bad ? 'is-minus' : 'is-plus'
        ));
        body.appendChild(tr);
    });
}

function paintBudgetTable(plan) {
    const body = $('budgetBody');
    if (!body) return;
    body.innerHTML = '';

    const rows = plan.rows
        .filter((row) => row.sen > 0 || row.usedSen > 0)
        .sort((a, b) => (b.sen - a.sen) || (b.usedSen - a.usedSen));

    const over = rows.filter((row) => row.sen > 0 && row.usedSen > row.sen).length;

    set('budgetTableNote', rows.length
        ? rows.length + (rows.length === 1 ? ' category in play' : ' categories in play') +
          (over ? ' · ' + over + ' over budget' : '')
        : '');

    if (!rows.length) {
        body.appendChild(emptyRow('Fill in a category or two — the breakdown builds as you go.', 6));
        return;
    }

    rows.forEach((row) => {
        const bucket = BUDGET_BUCKETS[row.bucket];
        const leftSen = row.sen - row.usedSen;
        const usedPct = row.sen > 0 ? row.usedSen / row.sen * 100 : 0;

        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong>' + escapeHtml(row.label) + (row.retired ? ' <span class="tag">retired</span>' : '') + '</strong>' +
            '<small>' + (plan.incomeSen ? pct(plan.share(row.sen)) + ' of income' : 'No income yet') + '</small>'
        ));
        tr.appendChild(cell('<i class="dot dot-' + bucket.tone + '"></i>' + bucket.label, 'is-muted'));
        tr.appendChild(cell(row.sen ? fmt(fromSen(row.sen)) : '—', row.sen ? 'is-strong' : 'is-muted'));
        tr.appendChild(cell(row.usedSen ? fmt(fromSen(row.usedSen)) : '—', row.usedSen ? '' : 'is-muted'));
        tr.appendChild(cell(
            row.sen ? (leftSen < 0 ? '− ' : '') + fmt(Math.abs(fromSen(leftSen))) : '—',
            !row.sen ? 'is-muted' : leftSen < 0 ? 'is-minus' : 'is-plus'
        ));
        tr.appendChild(cell(
            row.sen ? pct(usedPct, 0) : (row.usedSen ? 'unbudgeted' : '—'),
            row.sen ? 'is-' + budgetTone(usedPct) : 'is-muted'
        ));
        body.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Planned'));
    totalRow.appendChild(cell(''));
    totalRow.appendChild(cell(fmt(fromSen(plan.plannedSen))));
    totalRow.appendChild(cell(fmt(fromSen(plan.usedSen))));
    totalRow.appendChild(cell(
        ((plan.plannedSen - plan.usedSen) < 0 ? '− ' : '') + fmt(Math.abs(fromSen(plan.plannedSen - plan.usedSen))),
        (plan.plannedSen - plan.usedSen) < 0 ? 'is-minus' : 'is-plus'
    ));
    totalRow.appendChild(cell(plan.plannedSen ? pct(plan.usedPct, 0) : '—'));
    body.appendChild(totalRow);

    const leftRow = document.createElement('tr');
    leftRow.className = 'total-row is-quiet';
    leftRow.appendChild(cell(plan.leftSen < 0 ? 'Over budget' : 'Unassigned income'));
    leftRow.appendChild(cell(''));
    leftRow.appendChild(cell(fmt(Math.abs(fromSen(plan.leftSen))), plan.leftSen < 0 ? 'is-minus' : 'is-plus'));
    leftRow.appendChild(cell(''));
    leftRow.appendChild(cell(''));
    leftRow.appendChild(cell(plan.incomeSen ? pct(Math.abs(plan.leftPct)) : '—'));
    body.appendChild(leftRow);
}

/** Every budget ever saved, newest period first. */
function paintBudgetPlans(plan) {
    const body = $('budgetPlans');
    if (!body) return;
    body.innerHTML = '';

    const rows = planState.budgets.slice().sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : b.seq - a.seq));

    set('budgetPlansNote', rows.length
        ? rows.length + (rows.length === 1 ? ' plan saved' : ' plans saved')
        : 'Nothing saved yet');

    if (!rows.length) {
        body.appendChild(emptyRow('Press Save plan and this period joins the list — that is what makes it a record ' +
            'rather than a sketch.', 6));
        return;
    }

    rows.forEach((rec) => {
        const plannedSen = Object.values(rec.lines || {})
            .reduce((sum, v) => sum + Math.max(0, toSen(parseFloat(v) || 0)), 0);
        const incomeSen  = Math.max(0, toSen(parseFloat(rec.income) || 0)) +
                           Math.max(0, toSen(parseFloat(rec.extra)  || 0));
        const usedSen = Object.values(budgetUsedIn(rec.from, rec.to)).reduce((sum, v) => sum + v, 0);
        const usedPct = plannedSen > 0 ? usedSen / plannedSen * 100 : 0;

        const tr = document.createElement('tr');
        if (rec.key === plan.key) tr.className = 'is-you';

        tr.appendChild(cell(
            '<strong>' + escapeHtml(planRangeLabelOf(rec)) + (rec.key === plan.key ? ' <span class="tag">open</span>' : '') + '</strong>' +
            '<small>' + (BUDGET_RULES[rec.rule] ? BUDGET_RULES[rec.rule].name : 'No guide') + '</small>'
        ));
        tr.appendChild(cell(dayShort(rec.from) + ' – ' + dayLabel(rec.to), 'is-muted'));
        tr.appendChild(cell(incomeSen ? fmt(fromSen(incomeSen)) : '—', incomeSen ? '' : 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(plannedSen)), 'is-strong'));
        tr.appendChild(cell(
            fmt(fromSen(usedSen)) + (plannedSen ? ' · ' + pct(usedPct, 0) : ''),
            plannedSen ? 'is-' + budgetTone(usedPct) : 'is-muted'
        ));
        tr.appendChild(cell(
            '<button type="button" class="split-x" data-open-plan="' + rec.id + '" aria-label="Open plan">' +
            '<i class="bi bi-pencil"></i></button>' +
            '<button type="button" class="split-x" data-drop-plan="' + rec.id + '" aria-label="Delete plan">' +
            '<i class="bi bi-x-lg"></i></button>', 'row-actions'));

        body.appendChild(tr);
    });
}

function paintBudget(plan) {
    // --- the period stepper ---
    set('budgetPeriodLabel', plan.range.label);
    const nav = $('budgetNav');
    if (nav) nav.classList.toggle('is-off', plan.plan.period === 'custom');
    const dates = $('budgetCustomDates');
    if (dates) dates.hidden = plan.plan.period !== 'custom';

    // --- stat tiles ---
    set('budgetLeft', (plan.leftSen < 0 ? '− ' : '') + money(Math.abs(fromSen(plan.leftSen))));
    set('budgetLeftFoot', budgetVerdict(plan));

    set('budgetSpend', money(fromSen(plan.spendSen)));
    set('budgetSpendFoot', plan.incomeSen
        ? pct(plan.spendPct) + ' of income goes on living'
        : 'Needs + wants, before savings');

    set('budgetRate', plan.incomeSen ? pct(plan.saveRate) : '—');
    set('budgetRateFoot', plan.incomeSen
        ? money(fromSen(plan.bucketSen.save)) + ' set aside · ' + plan.range.sub
        : 'Savings + debt cleared, over income');

    // --- side panel tally ---
    set('budgetTallyIncome', money(fromSen(plan.incomeSen)));
    set('budgetTallySpend', '− ' + money(fromSen(plan.spendSen)));
    set('budgetTallySave', '− ' + money(fromSen(plan.bucketSen.save)));
    set('budgetTallyLeft', (plan.leftSen < 0 ? '− ' : '') + money(Math.abs(fromSen(plan.leftSen))));
    const leftTally = $('budgetTallyLeft');
    if (leftTally) leftTally.classList.toggle('is-minus', plan.leftSen < 0);

    set('budgetRowsNote', plan.plannedSen
        ? 'Planned ' + money(fromSen(plan.plannedSen)) + ' · used ' + money(fromSen(plan.usedSen))
        : 'Nothing planned yet');
    set('budgetDistNote', plan.incomeSen
        ? pct(plan.share(plan.plannedSen)) + ' of income assigned'
        : 'Nothing assigned yet');

    // --- per-row bars, sub-lines and badges ---
    plan.rows.forEach((row) => {
        const leftSen = row.sen - row.usedSen;
        const usedPct = row.sen > 0 ? row.usedSen / row.sen * 100 : 0;

        const bar = $('bar_' + row.id);
        if (bar) {
            bar.style.width = (row.sen > 0 ? Math.min(100, usedPct) : 0) + '%';
            bar.className = 'is-' + budgetTone(usedPct);
        }

        const badge = $('pct_' + row.id);
        if (badge) {
            badge.textContent = row.sen > 0 ? pct(usedPct, 0) : '—';
            badge.className = 'bgt-pct' + (row.sen > 0 ? ' is-' + budgetTone(usedPct) : '');
        }

        set('sub_' + row.id, row.sen > 0
            ? 'Used ' + money(fromSen(row.usedSen)) +
              ' · ' + (leftSen < 0 ? money(fromSen(-leftSen)) + ' over' : money(fromSen(leftSen)) + ' left')
            : row.usedSen > 0
                ? money(fromSen(row.usedSen)) + ' spent with nothing budgeted'
                : (row.hint || BUDGET_BUCKETS[row.bucket].label));
    });

    paintBudgetState(plan);
    paintBudgetDist(plan);
    paintBudgetGuide(plan);
    paintBudgetTable(plan);
    paintBudgetPlans(plan);
}

/** Draft · Saved · Unsaved changes — and the buttons that go with each. */
function paintBudgetState(plan) {
    const pill   = $('budgetPlanState');
    const save   = $('budgetSave');
    const revert = $('budgetRevert');
    const copy   = $('budgetCopyPrev');

    const dirty = !plan.saved || planSignature(plan.plan) !== planSignature(planFromRecord(plan.saved));
    const state = !plan.saved ? 'draft' : dirty ? 'dirty' : 'saved';

    if (pill) {
        pill.dataset.state = state;
        pill.textContent = state === 'saved' ? 'Saved'
            : state === 'dirty' ? 'Unsaved changes'
            : 'Draft';
    }
    if (save) {
        save.innerHTML = '<i class="bi bi-check-lg"></i> ' + (plan.saved ? 'Update plan' : 'Save plan');
        // Nothing to save covers two cases: this period matches what is already
        // filed, or nothing has been typed at all. An empty plan that *is*
        // saved stays saveable — clearing a budget is a decision too.
        save.disabled = state === 'saved' || (!plan.saved && planIsEmpty(plan.plan));
    }
    if (revert) revert.hidden = state !== 'dirty';
    if (copy) {
        const last = !plan.saved && planIsEmpty(plan.plan) ? previousPlanFor(plan.plan) : null;
        copy.hidden = !last;
        if (last) copy.innerHTML = '<i class="bi bi-files"></i> Copy ' + escapeHtml(planRangeLabelOf(last));
    }
}

/** The one line that says whether the period works. */
function budgetVerdict(plan) {
    if (!plan.incomeSen && !plan.plannedSen) return 'Start with your take-home pay';
    if (!plan.incomeSen) return 'Add your income to see if this fits';
    if (plan.leftSen < 0) return 'Overspent by ' + pct(Math.abs(plan.leftPct)) + ' — trim or earn more';
    if (plan.leftSen === 0) return 'Every ringgit has a job';

    const days = Math.max(1, rangeDays(plan.range.from, plan.range.to));
    return pct(plan.leftPct) + ' unassigned · about ' +
        money(fromSen(Math.round(plan.leftSen / days))) + ' a day';
}

function budgetSummaryText() {
    const plan = budgetCompute();
    const lines = [plan.range.label + ' budget — income ' + money(fromSen(plan.incomeSen))];

    plan.rows
        .filter((row) => row.sen > 0 || row.usedSen > 0)
        .sort((a, b) => b.sen - a.sen)
        .forEach((row) => {
            lines.push(row.label + ': ' + money(fromSen(row.sen)) +
                ' · used ' + money(fromSen(row.usedSen)) +
                (row.sen ? ' (' + pct(row.usedSen / row.sen * 100, 0) + ')' : ' (unbudgeted)'));
        });

    lines.push('Planned ' + money(fromSen(plan.plannedSen)) + ', used ' + money(fromSen(plan.usedSen)));
    lines.push(plan.leftSen < 0
        ? 'Over budget by ' + money(fromSen(-plan.leftSen))
        : 'Left over ' + money(fromSen(plan.leftSen)));

    return lines.join('\n');
}

function renderBudget() {
    readBudgetState();
    paintBudget(budgetCompute());
    paintGoals();
    persistPlan();
}

/**
 * --------------------------------------------------------------------
 * Persistence
 * --------------------------------------------------------------------
 * A budget you have to retype every visit is not a budget. Private mode and
 * file:// in some browsers throw on access — the app has to work either way,
 * so every call is guarded.
 */
function persistPlan() {
    try {
        storeWrite(BUDGET_KEY, JSON.stringify({
            version: 2,
            seq: planState.seq,
            budgets: planState.budgets,
            draft: planState.draft,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

/** Kept for the reset button and anything that still calls it by its old name. */
const saveBudget = persistPlan;

function loadBudget() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(BUDGET_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') { planState.draft = blankPlan(); return; }

    if (saved.version === 2) {
        planState.seq = Number(saved.seq) || 0;
        planState.budgets = (Array.isArray(saved.budgets) ? saved.budgets : [])
            .filter((b) => b && b.key && BUDGET_PERIODS[b.period])
            .map((b) => ({
                id: String(b.id || ('b' + (++planState.seq))),
                seq: Number(b.seq) || 0,
                key: String(b.key),
                period: b.period,
                anchor: String(b.anchor || b.from || todayIso()),
                from: String(b.from || ''), to: String(b.to || ''),
                income: String(b.income || ''), extra: String(b.extra || ''),
                rule: BUDGET_RULES[b.rule] ? b.rule : 'off',
                lines: (b.lines && typeof b.lines === 'object') ? b.lines : {},
                created: String(b.created || ''), updated: String(b.updated || ''),
            }));
        planState.budgets.forEach((b) => { planState.seq = Math.max(planState.seq, b.seq); });

        const draft = saved.draft;
        planState.draft = (draft && BUDGET_PERIODS[draft.period]) ? {
            period: draft.period,
            anchor: String(draft.anchor || todayIso()),
            from: String(draft.from || ''), to: String(draft.to || ''),
            income: String(draft.income || ''), extra: String(draft.extra || ''),
            rule: BUDGET_RULES[draft.rule] ? draft.rule : (draft.rule === 'off' ? 'off' : '502030'),
            lines: (draft.lines && typeof draft.lines === 'object') ? draft.lines : {},
        } : blankPlan();
        return;
    }

    migrateBudgetV1(saved);
}

/**
 * The shape before budgets were records: one plan, `amounts` keyed by category
 * id, plus `custom` rows that existed only here. Those custom rows are the
 * problem — nothing in the ledger could ever point at one, so `Used` against
 * them would read RM 0.00 forever. Each becomes a real category, and its
 * amount carries into the plan under that category's new id.
 *
 * The same rule applies to any future removal: dropping a shape is a data
 * migration, every time.
 */
function migrateBudgetV1(saved) {
    const lines = {};
    Object.entries(saved.amounts || {}).forEach(([id, value]) => {
        if (value !== '' && value != null) lines[id] = String(value);
    });

    (Array.isArray(saved.custom) ? saved.custom : []).forEach((row) => {
        const label  = String((row && row.label) || '').trim();
        const amount = String((row && row.amount) || '');
        if (!label && !amount) return;

        const bucket = BUDGET_BUCKETS[row.bucket] ? row.bucket : 'wants';
        const id = newCategoryId('c');
        categoryState.list.push({
            id, label: label || 'Untitled', bucket,
            icon: 'bi-tag', tone: 'jade',
            hint: 'Carried over from your old budget',
            enabled: true, subs: [],
        });
        if (amount) lines[id] = amount;
    });
    saveCategories();

    const rule = BUDGET_RULES[saved.rule] ? saved.rule : (saved.rule === 'off' ? 'off' : '502030');
    const draft = Object.assign(blankPlan(), {
        income: String(saved.income || ''),
        extra:  String(saved.extra  || ''),
        rule, lines,
    });
    planState.draft = draft;

    // The old plan was always a monthly one, and it was in force now — so it
    // becomes this month's saved budget rather than an unsaved draft. Anything
    // else would read as "you never had a budget".
    if (!planIsEmpty(draft)) {
        const range = planRange(draft);
        planState.seq = 1;
        planState.budgets = [{
            id: 'b1', seq: 1, key: planKey(draft, range),
            period: 'month', anchor: draft.anchor,
            from: range.from, to: range.to,
            income: draft.income, extra: draft.extra, rule,
            lines: Object.assign({}, lines),
            created: todayIso(), updated: todayIso(),
        }];
    }
    persistPlan();
}

/**
 * --------------------------------------------------------------------
 * What the other modules ask
 * --------------------------------------------------------------------
 * The Dashboard and the Expense Recorder each have their own period, which is
 * rarely the one the Planner happens to be showing. So they ask by dates, and
 * the answer is the saved budget for exactly those dates — falling back to the
 * draft on screen only when it covers the same stretch. Answering with another
 * period's plan would put a figure on the Dashboard that no budget ever said.
 */
function budgetLinesFor(from, to) {
    const rec = planState.budgets.find((b) => b.from === from && b.to === to);
    if (rec) return rec.lines || {};
    const plan  = planDraft();
    const range = planRange(plan);
    return (range.from === from && range.to === to) ? (plan.lines || {}) : null;
}

const budgetLineSen = (lines, id) =>
    (lines && lines[id] != null) ? Math.max(0, toSen(parseFloat(lines[id]) || 0)) : 0;

function budgetPlannedSenIn(from, to) {
    const lines = budgetLinesFor(from, to);
    if (!lines) return 0;
    return Object.values(lines).reduce((sum, v) => sum + Math.max(0, toSen(parseFloat(v) || 0)), 0);
}

/**
 * ====================================================================
 * SAVINGS GOALS
 * ====================================================================
 * A target, what is in it, and the arithmetic that says whether you will get
 * there.
 *
 * `Current` is the sum of the contributions and never a typed figure. A goal
 * that only holds a total cannot answer "am I actually putting in RM500 a
 * month?" — a dated log can, and it is the same principle the ledger runs on.
 *
 * The two figures that matter sit side by side: **needed** monthly, which the
 * target date demands, and **planned** monthly, which is what you said you
 * would do. When the second is smaller than the first the goal says so, in
 * red, rather than quietly reporting a finish date that will not happen.
 */
const GOALS_KEY = 'moneyflow.goals.v1';

const GOAL_KINDS = [
    { id: 'emergency', label: 'Emergency fund', icon: 'bi-life-preserver' },
    { id: 'travel',    label: 'Travel',         icon: 'bi-airplane' },
    { id: 'house',     label: 'House',          icon: 'bi-house-door' },
    { id: 'car',       label: 'Car',            icon: 'bi-car-front' },
    { id: 'gadget',    label: 'Gadget',         icon: 'bi-phone' },
    { id: 'education', label: 'Education',      icon: 'bi-mortarboard' },
    { id: 'wedding',   label: 'Wedding',        icon: 'bi-gem' },
    { id: 'other',     label: 'Something else', icon: 'bi-bullseye' },
];

const goalKind = (id) => GOAL_KINDS.find((k) => k.id === id) || GOAL_KINDS[GOAL_KINDS.length - 1];

let goalState = { list: [], seq: 0 };
const goalOpen = new Set();

const goalId = (prefix) => prefix + (++goalState.seq);

const newGoal = () => ({
    id: goalId('g'), name: '', kind: 'emergency',
    target: '', targetDate: '', monthly: '',
    contributions: [],
    created: todayIso(),
});

const goalById = (id) => goalState.list.find((g) => g.id === id) || null;
const goalName = (goal, index) => (goal.name || '').trim() || 'Goal ' + (index + 1);

/** Whole months from one date to another, floored at one: a target inside this
 *  month still needs a month's saving to reach. */
function monthsUntil(fromIso, toIso) {
    const [ay, am, ad] = isoNums(fromIso);
    const [by, bm, bd] = isoNums(toIso);
    if (!ay || !by) return 0;
    let months = (by * 12 + bm) - (ay * 12 + am);
    if (bd < ad) months -= 1;
    return months;
}

function addMonthsIso(iso, months) {
    const [y, m, d] = isoNums(iso);
    const moved = new Date(y, m - 1 + months, d);
    return isoOfDate(moved);
}

function goalCompute(goal) {
    const targetSen  = Math.max(0, toSen(parseFloat(goal.target) || 0));
    const currentSen = goal.contributions
        .reduce((sum, c) => sum + Math.max(0, toSen(parseFloat(c.amount) || 0)), 0);

    const remainingSen = Math.max(0, targetSen - currentSen);
    const progress = targetSen > 0 ? Math.min(100, currentSen / targetSen * 100) : 0;
    const done = targetSen > 0 && currentSen >= targetSen;

    const monthlySen = Math.max(0, toSen(parseFloat(goal.monthly) || 0));

    // What the target date demands, if there is one.
    const months = goal.targetDate ? monthsUntil(todayIso(), goal.targetDate) : null;
    const neededSen = (months !== null && remainingSen > 0)
        ? (months > 0 ? Math.ceil(remainingSen / months) : remainingSen)
        : 0;

    // What the planned monthly actually reaches, if there is one. A plan that
    // never moves is not a plan, so zero is "never" rather than infinity.
    const monthsNeeded = (monthlySen > 0 && remainingSen > 0)
        ? Math.ceil(remainingSen / monthlySen)
        : (remainingSen > 0 ? null : 0);
    const finishIso = monthsNeeded !== null ? addMonthsIso(todayIso(), monthsNeeded) : '';

    return {
        targetSen, currentSen, remainingSen, progress, done,
        monthlySen, months, neededSen, monthsNeeded, finishIso,
        // The plan falls short when a date is set and the monthly will not meet it.
        short: neededSen > 0 && monthlySen > 0 && monthlySen < neededSen,
        late: !!(goal.targetDate && finishIso && finishIso > goal.targetDate),
    };
}

/** Reached goals sink to the bottom; the rest keep the order they were made. */
const goalOrder = () => goalState.list
    .map((goal, index) => ({ goal, index, done: goalCompute(goal).done }))
    .sort((a, b) => (a.done === b.done ? a.index - b.index : (a.done ? 1 : -1)));

function buildGoals() {
    const host = $('goalList');
    if (!host) return;
    host.innerHTML = '';

    if (!goalState.list.length) {
        host.innerHTML = '<p class="split-empty">No goals yet — an emergency fund, a trip, a house deposit: ' +
            'anything you are putting money aside for. Add one and the arithmetic follows.</p>';
        return;
    }

    goalOrder().forEach(({ goal, index }) => {
        const kind = goalKind(goal.kind);
        const open = goalOpen.has(goal.id);

        const card = document.createElement('article');
        card.className = 'goal';
        card.dataset.goal = goal.id;
        card.innerHTML =
            '<div class="goal-head">' +
                '<span class="goal-icon"><i class="bi ' + kind.icon + '"></i></span>' +
                '<div class="goal-id">' +
                    '<input type="text" class="goal-name" aria-label="Goal name">' +
                    '<small id="gsub_' + goal.id + '">&mdash;</small>' +
                '</div>' +
                '<span class="goal-pct" id="gpct_' + goal.id + '">&mdash;</span>' +
                '<button type="button" class="split-x" data-drop-goal aria-label="Delete goal">' +
                    '<i class="bi bi-x-lg"></i></button>' +
            '</div>' +

            '<div class="goal-bar"><i id="gbar_' + goal.id + '" style="width:0%"></i></div>' +

            '<div class="goal-fields">' +
                '<label class="goal-field"><span>Kind</span>' +
                    '<select class="goal-kind">' +
                        GOAL_KINDS.map((k) => '<option value="' + k.id + '">' + k.label + '</option>').join('') +
                    '</select></label>' +
                '<label class="goal-field"><span>Target</span>' +
                    '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                    '<input type="number" class="goal-target" min="0" step="100" placeholder="0" inputmode="decimal">' +
                    '</div></label>' +
                '<label class="goal-field"><span>Save monthly</span>' +
                    '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                    '<input type="number" class="goal-monthly" min="0" step="50" placeholder="0" inputmode="decimal">' +
                    '</div></label>' +
                '<label class="goal-field"><span>By</span>' +
                    '<input type="date" class="goal-date"></label>' +
            '</div>' +

            '<div class="goal-facts" id="gfacts_' + goal.id + '"></div>' +

            '<details class="fold goal-log"' + (open ? ' open' : '') + '>' +
                '<summary><span>Contributions</span><b id="glog_' + goal.id + '">&mdash;</b></summary>' +
                '<div class="goal-log-body">' +
                    '<div class="goal-log-list" id="glist_' + goal.id + '"></div>' +
                    '<div class="goal-add">' +
                        '<input type="date" class="goal-c-date" aria-label="Date">' +
                        '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                            '<input type="number" class="goal-c-amount" min="0" step="50" placeholder="0" ' +
                            'inputmode="decimal" aria-label="Amount"></div>' +
                        '<input type="text" class="goal-c-note" placeholder="Note (optional)" aria-label="Note">' +
                        '<button type="button" class="ghost-btn" data-add-contribution>' +
                            '<i class="bi bi-plus-lg"></i> Add</button>' +
                    '</div>' +
                '</div>' +
            '</details>';

        const name = card.querySelector('.goal-name');
        name.value = goal.name;
        name.placeholder = goalName(goal, index);
        card.querySelector('.goal-kind').value = goal.kind;
        card.querySelector('.goal-target').value = goal.target;
        card.querySelector('.goal-monthly').value = goal.monthly;
        card.querySelector('.goal-date').value = goal.targetDate;
        card.querySelector('.goal-c-date').value = todayIso();

        host.appendChild(card);
        buildGoalLog(goal);
    });

    // Goals is the one module that builds date boxes of its own, so the cards
    // it has just made get the same treatment the page got at startup.
    enhanceDateInputs(host);
}

function buildGoalLog(goal) {
    const host = $('glist_' + goal.id);
    if (!host) return;
    host.innerHTML = '';

    if (!goal.contributions.length) {
        host.innerHTML = '<p class="goal-log-empty">Nothing put in yet. Every top-up you log here is what ' +
            '&ldquo;current&rdquo; is made of.</p>';
        return;
    }

    goal.contributions
        .slice()
        .sort((a, b) => (a.date === b.date ? b.seq - a.seq : (a.date < b.date ? 1 : -1)))
        .forEach((c) => {
            const row = document.createElement('div');
            row.className = 'goal-c';
            row.dataset.contribution = c.id;
            row.innerHTML =
                '<span class="goal-c-when">' + dayLabel(c.date) + '</span>' +
                '<span class="goal-c-what">' + (c.note ? escapeHtml(c.note) : '<i>No note</i>') + '</span>' +
                '<b>' + money(fromSen(Math.max(0, toSen(parseFloat(c.amount) || 0)))) + '</b>' +
                '<button type="button" class="split-x" data-drop-contribution aria-label="Remove contribution">' +
                    '<i class="bi bi-x-lg"></i></button>';
            host.appendChild(row);
        });
}

/** Only the derived parts, so typing a target does not rebuild the card. */
function paintGoals() {
    const reached = goalState.list.filter((g) => goalCompute(g).done).length;
    const totalTarget = goalState.list.reduce((sum, g) => sum + goalCompute(g).targetSen, 0);
    const totalNow    = goalState.list.reduce((sum, g) => sum + goalCompute(g).currentSen, 0);

    set('goalNote', goalState.list.length
        ? money(fromSen(totalNow)) + ' of ' + money(fromSen(totalTarget)) +
          (reached ? ' · ' + reached + ' reached' : '')
        : 'Nothing set aside yet');

    goalState.list.forEach((goal, index) => {
        const g = goalCompute(goal);

        const bar = $('gbar_' + goal.id);
        if (bar) {
            bar.style.width = g.progress + '%';
            bar.className = g.done ? 'is-done' : g.short || g.late ? 'is-short' : '';
        }

        const badge = $('gpct_' + goal.id);
        if (badge) {
            badge.textContent = g.targetSen ? pct(g.progress, 0) : '—';
            badge.className = 'goal-pct' + (g.done ? ' is-done' : g.short || g.late ? ' is-short' : '');
        }

        set('gsub_' + goal.id, g.targetSen
            ? money(fromSen(g.currentSen)) + ' of ' + money(fromSen(g.targetSen)) +
              (g.done ? ' · reached' : ' · ' + money(fromSen(g.remainingSen)) + ' to go')
            : 'Put in a target and this fills itself in');

        set('glog_' + goal.id, goal.contributions.length
            ? goal.contributions.length + (goal.contributions.length === 1 ? ' top-up · ' : ' top-ups · ') +
              money(fromSen(g.currentSen))
            : 'None yet');

        paintGoalFacts(goal, g, index);
    });
}

function paintGoalFacts(goal, g, index) {
    const host = $('gfacts_' + goal.id);
    if (!host) return;

    const facts = [];
    const add = (label, value, tone) => facts.push(
        '<span class="goal-fact' + (tone ? ' is-' + tone : '') + '">' +
        '<small>' + label + '</small><b>' + value + '</b></span>');

    add('Current', money(fromSen(g.currentSen)));
    add('Remaining', g.targetSen ? money(fromSen(g.remainingSen)) : '—');

    if (g.done) {
        add('Status', 'Reached', 'done');
    } else if (goal.targetDate) {
        add('Needed monthly',
            g.neededSen ? money(fromSen(g.neededSen)) : '—',
            g.short ? 'short' : '');
        add(g.months !== null && g.months < 0 ? 'Was due' : 'Target date',
            dayLabel(goal.targetDate) +
            (g.months !== null ? ' · ' + Math.abs(g.months) + (Math.abs(g.months) === 1 ? ' month' : ' months') +
                (g.months < 0 ? ' ago' : '') : ''),
            g.months !== null && g.months < 0 ? 'short' : '');
    } else {
        add('Needed monthly', 'Set a date', '');
    }

    if (!g.done) {
        add('Finishes',
            g.monthsNeeded === null ? 'Not while nothing goes in'
                : g.monthsNeeded === 0 ? 'Already there'
                : dayLabel(g.finishIso) + ' · ' + g.monthsNeeded +
                  (g.monthsNeeded === 1 ? ' month' : ' months'),
            g.late ? 'short' : '');
    }

    host.innerHTML = facts.join('');

    if (g.short) {
        host.innerHTML += '<p class="goal-warn"><i class="bi bi-exclamation-triangle"></i> ' +
            money(fromSen(g.monthlySen)) + ' a month will not reach ' + escapeHtml(goalName(goal, index)) +
            ' by ' + dayLabel(goal.targetDate) + ' — it needs ' + money(fromSen(g.neededSen)) + '.</p>';
    }
}

/**
 * --------------------------------------------------------------------
 * Goal editing
 * --------------------------------------------------------------------
 */
function readGoalCards() {
    document.querySelectorAll('#goalList .goal').forEach((card) => {
        const goal = goalById(card.dataset.goal);
        if (!goal) return;
        goal.name       = card.querySelector('.goal-name').value;
        goal.kind       = card.querySelector('.goal-kind').value;
        goal.target     = card.querySelector('.goal-target').value;
        goal.monthly    = card.querySelector('.goal-monthly').value;
        goal.targetDate = card.querySelector('.goal-date').value;
    });
}

function renderGoals(rebuild) {
    if (rebuild) buildGoals();
    paintGoals();
    saveGoals();
}

function addGoal() {
    readGoalCards();
    const goal = newGoal();
    goalState.list.push(goal);
    goalOpen.add(goal.id);
    renderGoals(true);

    const fresh = document.querySelector('#goalList .goal[data-goal="' + goal.id + '"] .goal-name');
    if (fresh) { reveal(fresh).focus({ preventScroll: true }); reveal(fresh).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

function onGoalInput(event) {
    if (!event.target.closest('#goalList')) return;
    readGoalCards();
    paintGoals();
    saveGoals();
}

function onGoalClick(event) {
    const card = event.target.closest('.goal');
    if (!card) return;
    const goal = goalById(card.dataset.goal);
    if (!goal) return;

    const details = event.target.closest('summary');
    if (details) {
        // `open` flips after this handler, so record the state it is heading for.
        if (goalOpen.has(goal.id)) goalOpen.delete(goal.id); else goalOpen.add(goal.id);
        return;
    }

    if (event.target.closest('[data-add-contribution]')) {
        readGoalCards();
        const amount = card.querySelector('.goal-c-amount').value;
        const sen = Math.max(0, toSen(parseFloat(amount) || 0));
        if (!sen) {
            card.querySelector('.goal-c-amount').focus();
            return;
        }
        goal.contributions.push({
            id: goalId('gc'),
            seq: goalState.seq,
            date: card.querySelector('.goal-c-date').value || todayIso(),
            amount: String(amount),
            note: card.querySelector('.goal-c-note').value.trim(),
        });
        goalOpen.add(goal.id);
        renderGoals(true);
        return;
    }

    const dropC = event.target.closest('[data-drop-contribution]');
    if (dropC) {
        readGoalCards();
        const id = dropC.closest('.goal-c').dataset.contribution;
        goal.contributions = goal.contributions.filter((c) => c.id !== id);
        renderGoals(true);
        return;
    }

    if (event.target.closest('[data-drop-goal]')) {
        readGoalCards();
        const index = goalState.list.indexOf(goal);
        askConfirm(
            'Delete ' + goalName(goal, index) + '?',
            goal.contributions.length
                ? 'This goal and its ' + goal.contributions.length +
                  (goal.contributions.length === 1 ? ' logged top-up' : ' logged top-ups') + ' will be removed. ' +
                  'Nothing in your Expenses is touched.'
                : 'This goal will be removed. Nothing in your Expenses is touched.',
            'Delete goal',
            () => {
                goalState.list = goalState.list.filter((g) => g.id !== goal.id);
                goalOpen.delete(goal.id);
                renderGoals(true);
            });
    }
}

function saveGoals() {
    try {
        storeWrite(GOALS_KEY, JSON.stringify({ seq: goalState.seq, list: goalState.list }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

/** The stored copy is untrusted: a goal whose contributions went missing, or
 *  whose dates are malformed, would put a wrong figure on screen. */
function loadGoals() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(GOALS_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || !Array.isArray(saved.list)) return;

    goalState.seq = Number(saved.seq) || 0;
    goalState.list = saved.list
        .filter((g) => g && g.id)
        .map((g) => ({
            id: String(g.id),
            name: String(g.name || ''),
            kind: goalKind(g.kind).id,
            target: String(g.target || ''),
            targetDate: /^\d{4}-\d{2}-\d{2}$/.test(g.targetDate || '') ? g.targetDate : '',
            monthly: String(g.monthly || ''),
            created: String(g.created || ''),
            contributions: (Array.isArray(g.contributions) ? g.contributions : [])
                .filter((c) => c && c.id && /^\d{4}-\d{2}-\d{2}$/.test(c.date || ''))
                .map((c) => ({
                    id: String(c.id), seq: Number(c.seq) || 0,
                    date: c.date, amount: String(c.amount || ''), note: String(c.note || ''),
                })),
        }));

    // Ids never collide, however the file was edited.
    goalState.list.forEach((g) => {
        const n = parseInt(String(g.id).replace(/\D/g, ''), 10);
        if (n > goalState.seq) goalState.seq = n;
        g.contributions.forEach((c) => {
            const cn = parseInt(String(c.id).replace(/\D/g, ''), 10);
            if (cn > goalState.seq) goalState.seq = cn;
        });
    });
}

/**
 * ====================================================================
 * INSTALMENT TRACKER
 * ====================================================================
 * Money already promised. A phone on 24 months, a car, SPayLater — and the
 * other direction, the RM3,000 lent to a friend who is paying it back RM500 a
 * month. Those are the same arithmetic pointed opposite ways, which is why
 * they are one module and not two: `direction` is the only thing that differs,
 * and every figure on the page reads off it.
 *
 * Three decisions worth keeping:
 *
 *   Two figures, and the third follows. Nobody has both the total and the
 *   monthly to hand — `basis` says which you typed and the other is derived.
 *
 *   The schedule always sums to the total, exactly. Months go through
 *   `allocateSen`, so RM1,000 over three months is 333.34 / 333.33 / 333.33
 *   rather than three figures that quietly lose two sen.
 *
 *   Payments are keyed by their number, not their date. Changing a 24-month
 *   term to 30 leaves the eight already paid exactly where they were.
 *
 * Late fees are flagged, never calculated. An overdue payment turns red and
 * says how many days late; what the bank charges for it is the bank's to say,
 * and a figure this app invented would sit on screen looking like a fact.
 */
const COMMIT_KEY = 'moneyflow.commit.v1';

/** 50 years of monthly payments. Past that it is a typo, not a plan. */
const COMMIT_MAX_MONTHS = 600;

const COMMIT_STATUS = {
    upcoming:  { label: 'Upcoming',  tone: 'slate' },
    active:    { label: 'Active',    tone: 'jade'  },
    overdue:   { label: 'Overdue',   tone: 'red'   },
    completed: { label: 'Completed', tone: 'done'  },
    cancelled: { label: 'Cancelled', tone: 'slate' },
};

const PAYMENT_STATUS = {
    paid:     { label: 'Paid',     icon: 'bi-check-circle-fill', tone: 'jade'  },
    due:      { label: 'Due today', icon: 'bi-exclamation-circle-fill', tone: 'amber' },
    overdue:  { label: 'Overdue',  icon: 'bi-exclamation-triangle-fill', tone: 'red' },
    upcoming: { label: 'Upcoming', icon: 'bi-hourglass', tone: 'slate' },
};

let commitState = { plans: [], draft: null, editing: null, seq: 0, filter: 'live' };

const newPlan = () => ({
    id: '', seq: 0,
    name: '',
    direction: 'out',
    who: '',
    basis: 'total',
    total: '', monthly: '', months: '',
    paidAhead: '',
    firstDue: todayIso(),
    autoRecord: true,
    account: '', category: '',
    cancelled: false,
    payments: {},
    created: '', updated: '',
});

const commitDraft = () => commitState.draft || (commitState.draft = newPlan());
const planById = (id) => commitState.plans.find((p) => p.id === id) || null;
const planName = (plan) => (plan.name || '').trim() || 'Untitled plan';

/**
 * --------------------------------------------------------------------
 * Dates
 * --------------------------------------------------------------------
 */
/** The same day of the month, `n` months on. The 31st clamps to the last day
 *  of a shorter month rather than skidding into the next one — a due date of
 *  31 January must not become 3 March. */
function addMonthsClamped(iso, n) {
    const [y, m, d] = isoNums(iso);
    if (!y) return iso;
    const target = new Date(y, m - 1 + n, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return isoOf(target.getFullYear(), target.getMonth() + 1, Math.min(d, lastDay));
}

/** Whole days between two dates, signed. Built from the parts rather than from
 *  `new Date(iso)`, which parses as UTC and lands on the wrong day east of
 *  Greenwich — the difference between "due today" and "one day late". */
function daysBetween(fromIso, toIso) {
    const [ay, am, ad] = isoNums(fromIso);
    const [by, bm, bd] = isoNums(toIso);
    if (!ay || !by) return 0;
    return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

/**
 * --------------------------------------------------------------------
 * The sums
 * --------------------------------------------------------------------
 */
function planCompute(plan) {
    const months = Math.min(COMMIT_MAX_MONTHS, Math.max(0, Math.floor(parseFloat(plan.months) || 0)));

    // Two figures in, the third out. Whichever was typed is the one that holds.
    const typedTotal   = Math.max(0, toSen(parseFloat(plan.total) || 0));
    const typedMonthly = Math.max(0, toSen(parseFloat(plan.monthly) || 0));
    const totalSen = plan.basis === 'monthly' ? typedMonthly * months : typedTotal;
    const monthlySen = months > 0 ? Math.round(totalSen / months) : 0;

    // The schedule adds up to the total exactly; the odd sen lands on the
    // earliest payments, which is the way a bank rounds it too.
    const scheduled = months > 0 ? allocateSen(totalSen, Array(months).fill(1)) : [];
    const today = todayIso();

    // "How many months paid" is not a button that ticks things — it is part of the
    // answer to "is this month paid". Marking the schedule when the plan was
    // saved meant a plan you had not saved yet sat there in red saying every
    // month was overdue, which is exactly what it is not.
    const ahead = Math.max(0, Math.min(months, Math.floor(parseFloat(plan.paidAhead) || 0)));

    let paidSen = 0, paidCount = 0, overdueCount = 0, dueTodayCount = 0;
    const rows = [];

    for (let i = 0; i < months; i++) {
        const n = i + 1;
        const rec = plan.payments[n] || {};
        const due = addMonthsClamped(plan.firstDue || today, i);

        // A payment the bank charged differently is typed over; everything
        // else takes its slice of the schedule.
        const amountSen = (rec.amount !== undefined && rec.amount !== '')
            ? Math.max(0, toSen(parseFloat(rec.amount) || 0))
            : (scheduled[i] || 0);

        // Ticked by hand wins either way — `true` and `false` are both
        // decisions, and only an absent one falls back to the count.
        const caughtUp = rec.paid !== true && rec.paid !== false && n <= ahead;
        const paid = rec.paid === true || caughtUp;
        const late = daysBetween(due, today);
        const status = paid ? 'paid' : late > 0 ? 'overdue' : late === 0 ? 'due' : 'upcoming';

        if (paid) { paidSen += amountSen; paidCount++; }
        else if (status === 'overdue') overdueCount++;
        else if (status === 'due') dueTodayCount++;

        rows.push({
            n, due, amountSen, paid, status, late, caughtUp,
            // A caught-up month was paid before any of this was being tracked,
            // so its own due date is the only date anyone can honestly claim.
            paidOn: caughtUp ? due : (rec.date || ''),
            entryId: rec.entryId || '',
            override: rec.amount !== undefined && rec.amount !== '',
        });
    }

    const scheduledSen = rows.reduce((sum, r) => sum + r.amountSen, 0);
    const leftSen = Math.max(0, scheduledSen - paidSen);
    const next = rows.find((r) => !r.paid) || null;
    const last = rows.length ? rows[rows.length - 1] : null;

    const status = plan.cancelled ? 'cancelled'
        : !months || !scheduledSen ? 'upcoming'
        : paidCount >= months ? 'completed'
        : overdueCount ? 'overdue'
        : (next && daysBetween(today, next.due) > 0 && paidCount === 0) ? 'upcoming'
        : 'active';

    // Cancelled and completed plans are history: they stop counting towards
    // what is still owed, or the hero would keep chasing a settled debt.
    const live = status !== 'cancelled' && status !== 'completed';

    return {
        plan, months, ahead, totalSen: scheduledSen, monthlySen, rows,
        paidSen, paidCount, leftSen,
        leftCount: Math.max(0, months - paidCount),
        overdueCount, dueTodayCount,
        next, last, status, live,
        progress: scheduledSen > 0 ? Math.min(100, paidSen / scheduledSen * 100) : 0,
        daysToNext: next ? daysBetween(today, next.due) : null,
        finishIso: last ? last.due : '',
    };
}

/** Every plan, costed. One pass, because five things on this page want it. */
const commitAll = () => commitState.plans.map(planCompute);

function commitBook() {
    const all = commitAll();
    const live = all.filter((p) => p.live);

    const owingSen = live.filter((p) => p.plan.direction === 'out').reduce((s, p) => s + p.leftSen, 0);
    const owedSen  = live.filter((p) => p.plan.direction === 'in').reduce((s, p) => s + p.leftSen, 0);

    // Everything unpaid across every live plan, soonest first — the answer to
    // "what is coming", and the source of the Dashboard's upcoming figure.
    const due = [];
    live.forEach((p) => p.rows.filter((r) => !r.paid).forEach((r) => due.push({ plan: p, row: r })));
    due.sort((a, b) => (a.row.due < b.row.due ? -1 : a.row.due > b.row.due ? 1 : 0));

    return {
        all, live, owingSen, owedSen, due,
        overdue: due.filter((d) => d.row.status === 'overdue'),
        next: due.find((d) => d.plan.plan.direction === 'out') || due[0] || null,
        monthlyOutSen: live.filter((p) => p.plan.direction === 'out')
            .reduce((s, p) => s + p.monthlySen, 0),
    };
}

/** What falls due between two dates and has not been paid. The Dashboard asks
 *  by its own period, the same way it asks the Planner. */
function commitDueBetween(from, to) {
    let sen = 0, count = 0, soonest = '';
    commitAll().filter((p) => p.live && p.plan.direction === 'out').forEach((p) => {
        p.rows.forEach((r) => {
            if (r.paid || r.due < from || r.due > to) return;
            sen += r.amountSen;
            count++;
            if (!soonest || r.due < soonest) soonest = r.due;
        });
    });
    return { sen, count, soonest };
}

/** What is still owed on live outgoing plans, whatever the period. */
const commitOutstandingSen = () => commitAll()
    .filter((p) => p.live && p.plan.direction === 'out')
    .reduce((sum, p) => sum + p.leftSen, 0);

/**
 * --------------------------------------------------------------------
 * Form in, form out
 * --------------------------------------------------------------------
 */
function readCommitForm() {
    const plan = commitDraft();
    plan.direction = (($('commitDirection') || {}).dataset || {}).value === 'in' ? 'in' : 'out';
    plan.basis     = (($('commitBasis') || {}).dataset || {}).value === 'monthly' ? 'monthly' : 'total';
    plan.name      = ($('commitName')     || {}).value || '';
    plan.who       = ($('commitWho')      || {}).value || '';
    plan.total     = ($('commitTotal')    || {}).value || '';
    plan.monthly   = ($('commitMonthly')  || {}).value || '';
    plan.months    = ($('commitMonths')   || {}).value || '';
    plan.paidAhead = ($('commitPaidCount') || {}).value || '';
    plan.firstDue  = ($('commitFirstDue') || {}).value || plan.firstDue;
    plan.autoRecord = !!($('commitAuto') || {}).checked;
    plan.account   = ($('commitAccount')  || {}).value || '';
    plan.category  = ($('commitCategory') || {}).value || '';
}

function fillCommitForm() {
    const plan = commitDraft();
    if ($('commitDirection')) setSegment($('commitDirection'), plan.direction);
    if ($('commitBasis'))     setSegment($('commitBasis'), plan.basis);
    if ($('commitName'))      $('commitName').value     = plan.name;
    if ($('commitWho'))       $('commitWho').value      = plan.who;
    if ($('commitTotal'))     $('commitTotal').value    = plan.total;
    if ($('commitMonthly'))   $('commitMonthly').value  = plan.monthly;
    if ($('commitMonths'))    $('commitMonths').value   = plan.months;
    if ($('commitPaidCount')) $('commitPaidCount').value = plan.paidAhead;
    if ($('commitFirstDue'))  $('commitFirstDue').value = plan.firstDue;
    if ($('commitAuto'))      $('commitAuto').checked   = plan.autoRecord;
    buildCommitOptions();
    // Same rule as the cards: never write a stored blank over a chosen default.
    if ($('commitAccount')  && plan.account)  $('commitAccount').value  = plan.account;
    if ($('commitCategory') && plan.category) $('commitCategory').value = plan.category;
}

/** The account and category pickers, rebuilt whenever either list changes.
 *  An `in` plan is money arriving, so it offers the income categories. */
function buildCommitOptions() {
    const plan = commitDraft();

    const accounts = $('commitAccount');
    if (accounts) {
        const held = accounts.value || plan.account;
        accounts.innerHTML = '';
        ledgerState.accounts.filter((a) => a.status !== 'closed').forEach((account) => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.name.trim() || 'Unnamed account';
            accounts.appendChild(option);
        });
        if (held && Array.from(accounts.options).some((o) => o.value === held)) accounts.value = held;
    }

    const cats = $('commitCategory');
    if (cats) {
        const held = cats.value || plan.category;
        cats.innerHTML = '';
        categoryListFor(plan.direction === 'in' ? 'income' : 'expense').forEach((cat) => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.label;
            cats.appendChild(option);
        });
        if (held && Array.from(cats.options).some((o) => o.value === held)) cats.value = held;
        else if (plan.direction === 'out' && categoryById(INSTALMENT_CATEGORY)) cats.value = INSTALMENT_CATEGORY;
    }
}

/**
 * --------------------------------------------------------------------
 * Catching up
 * --------------------------------------------------------------------
 * Most plans are picked up part-way through — a phone paid since January,
 * entered in August. Ticking eight months one at a time is work the app should
 * be doing, so the form takes the count instead.
 *
 * It is **derived, not applied**: `planCompute` treats the first N months as
 * settled, live, whether or not the plan has been saved. The first cut ticked
 * them on save, which meant a plan you were still filling in sat there in red
 * insisting every past month was overdue — the opposite of what you had just
 * told it. Nothing is written down, so nothing has to be undone.
 *
 * Ticking by hand wins over the count in both directions: `paid: true` on a
 * month past N, `paid: false` on one inside it. Only an absent decision falls
 * back to the count.
 *
 * Caught-up months are deliberately **not** written to Expenses. They were paid
 * months ago; eight entries all dated today would put RM1,600 of spending into
 * this month that never happened, and every report reading the ledger would
 * inherit it.
 */
/**
 * --------------------------------------------------------------------
 * Saving
 * --------------------------------------------------------------------
 * The form is a draft until it is saved, and a draft has no schedule to tick:
 * history is for records, not sketches. Same bargain as the Bill Splitter.
 */
function commitSavePlan() {
    readCommitForm();
    const plan = commitDraft();
    const sums = planCompute(plan);

    if (!plan.name.trim())  { commitHint('Give it a name first — "iPhone", "Ali", something you will recognise.'); return; }
    if (!sums.months)       { commitHint('How many months does it run for?'); return; }
    if (!sums.totalSen)     { commitHint('Put in an amount — a plan for nothing is not a plan.'); return; }

    const stamp = todayIso();
    if (!plan.id) {
        plan.id = 'ip' + (++commitState.seq);
        plan.seq = commitState.seq;
        plan.created = stamp;
        commitState.plans.push(plan);
        commitState.editing = plan.id;
    } else {
        const at = commitState.plans.findIndex((p) => p.id === plan.id);
        if (at >= 0) commitState.plans[at] = plan;
    }
    plan.updated = stamp;

    saveCommit();
    renderCommit();
    flashButton($('commitSave'), '<i class="bi bi-check-lg"></i> Saved');
}

function commitOpenPlan(id) {
    const plan = planById(id);
    if (!plan) return;
    commitState.draft = plan;          // edited in place; Save writes it back
    commitState.editing = plan.id;
    fillCommitForm();
    renderCommit();
    const form = $('commit-form');
    if (form) reveal(form).scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function commitNewPlan() {
    commitState.draft = newPlan();
    commitState.editing = null;
    fillCommitForm();
    renderCommit();
}

function commitCancelPlan() {
    const plan = commitDraft();
    if (!plan.id) return;

    if (plan.cancelled) {
        plan.cancelled = false;
        saveCommit();
        renderCommit();
        return;
    }

    askConfirm(
        'Cancel ' + planName(plan) + '?',
        'It stops counting towards what you owe and drops out of what is coming up. Every payment ' +
        'already ticked stays exactly as it is, and you can un-cancel it later.',
        'Cancel the plan',
        () => { plan.cancelled = true; saveCommit(); renderCommit(); });
}

function commitDropPlan(id) {
    const plan = planById(id);
    if (!plan) return;
    const sums = planCompute(plan);
    const linked = sums.rows.filter((r) => r.entryId).length;

    askConfirm(
        'Delete ' + planName(plan) + '?',
        'The plan and its ' + sums.paidCount + ' ticked ' +
        (sums.paidCount === 1 ? 'payment go' : 'payments go') + ' for good.' +
        (linked ? ' The ' + linked + (linked === 1 ? ' entry it wrote' : ' entries it wrote') +
            ' into Expenses stay where they are — delete those there if you want them gone.' : '') +
        ' To stop it counting without losing it, cancel it instead.',
        'Delete plan',
        () => {
            commitState.plans = commitState.plans.filter((p) => p.id !== id);
            if (commitState.editing === id) commitNewPlan();
            saveCommit();
            renderCommit();
        });
}

/**
 * --------------------------------------------------------------------
 * Ticking a payment
 * --------------------------------------------------------------------
 * The one place in this module that touches the ledger. Ticking writes one
 * entry; un-ticking takes the same entry back out. The id is held on the
 * payment, so nothing is ever written twice and nothing else is ever removed.
 */
function commitTogglePayment(n) {
    const plan = commitDraft();
    if (!plan.id) { commitHint('Save the plan first — a sketch has nothing to tick.'); return; }

    const sums = planCompute(plan);
    const row = sums.rows.find((r) => r.n === n);
    if (!row) return;

    const rec = plan.payments[n] || (plan.payments[n] = {});

    // `row.paid`, not `rec.paid`: a month settled by the count has no record
    // of its own, and clicking it has to un-settle it rather than pay it twice.
    if (row.paid) {
        if (rec.entryId) {
            ledgerState.entries = ledgerState.entries.filter((e) => e.id !== rec.entryId);
            saveLedger();
        }
        rec.paid = false;
        rec.date = '';
        rec.entryId = '';
        commitHint('Payment ' + n + ' un-ticked' + (row.entryId ? ' and taken back out of Expenses.' : '.'));
    } else if (n <= sums.ahead) {
        // Inside the "already paid" count, so ticking it back on means "yes,
        // that one was settled before I started tracking" — not "I paid it
        // today". Writing an expense here would date a March payment to now.
        delete rec.paid;
        rec.date = '';
        rec.entryId = '';
        if (rec.amount === undefined) delete plan.payments[n];
        commitHint('Payment ' + n + ' is back under the ' + sums.ahead +
            ' you had already paid — nothing was written to Expenses.');
    } else {
        rec.paid = true;
        rec.date = todayIso();
        rec.entryId = plan.autoRecord ? commitWriteEntry(plan, row) : '';
        commitHint('Payment ' + n + ' ticked' +
            (rec.entryId ? ' and recorded under Expenses.' : '.'));
    }

    plan.updated = todayIso();
    saveCommit();
    renderCommit();
    renderLedger();
    renderDash();
}

function commitWriteEntry(plan, row) {
    if (!plan.account) {
        commitHint('Ticked — but there is no account set, so nothing was written to Expenses.');
        return '';
    }

    const stamp = todayIso();
    const entry = {
        id: ledgerId('e'),
        seq: ++ledgerSeq,
        type: plan.direction === 'in' ? 'income' : 'expense',
        amount: String(fromSen(row.amountSen)),
        currency: BASE_CURRENCY,
        base: '', rate: '',
        date: stamp,
        category: plan.category, sub: '',
        account: plan.account, toAccount: '',
        note: planName(plan) + ' — payment ' + row.n + ' of ' + plan.months,
        created: stamp, updated: stamp,
    };

    ledgerState.entries.push(entry);
    ledgerState.month = monthOf(entry.date);
    saveLedger();
    return entry.id;
}

/** Type over one payment when the bank charged something else. Blank puts it
 *  back on the schedule rather than setting it to zero. */
function commitSetAmount(n, value) {
    const plan = commitDraft();
    if (!plan.id) return;
    const rec = plan.payments[n] || (plan.payments[n] = {});
    if (String(value).trim() === '') delete rec.amount;
    else rec.amount = String(value);
    if (!rec.paid && !rec.amount) delete plan.payments[n];
    saveCommit();
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
const commitHint = (text) => {
    const hint = $('commitSaveHint');
    if (!hint) return;
    hint.innerHTML = '<i class="bi bi-info-circle"></i> ' + escapeHtml(text);
    clearTimeout(commitHint.timer);
    commitHint.timer = setTimeout(() => {
        hint.innerHTML = '<i class="bi bi-hdd"></i> Saved on this device only — nothing leaves your browser.';
    }, 6000);
};

/** "in 12 days", "today", "9 days late" — the countdown in words. */
function daysWord(days) {
    if (days === 0) return 'due today';
    if (days > 0) return 'in ' + days + (days === 1 ? ' day' : ' days');
    return Math.abs(days) + (days === -1 ? ' day late' : ' days late');
}

function paintCommit() {
    const book = commitBook();
    const sums = planCompute(commitDraft());

    // --- hero ---
    set('commitOwing', money(fromSen(book.owingSen)));
    const outPlans = book.live.filter((p) => p.plan.direction === 'out').length;
    set('commitOwingFoot', outPlans
        ? outPlans + (outPlans === 1 ? ' plan running · ' : ' plans running · ') +
          money(fromSen(book.monthlyOutSen)) + ' a month'
        : 'Nothing on instalment yet');

    if (book.next) {
        set('commitNext', dayShort(book.next.row.due));
        set('commitNextFoot', planName(book.next.plan.plan) + ' · ' +
            money(fromSen(book.next.row.amountSen)) + ' · ' +
            daysWord(daysBetween(todayIso(), book.next.row.due)));
    } else {
        set('commitNext', '—');
        set('commitNextFoot', 'Nothing due');
    }

    set('commitOwed', money(fromSen(book.owedSen)));
    const inPlans = book.live.filter((p) => p.plan.direction === 'in').length;
    set('commitOwedFoot', inPlans
        ? inPlans + (inPlans === 1 ? ' person owes you' : ' people owe you')
        : 'Nobody owes you on instalment');

    paintCommitForm(sums);
    paintCommitSchedule(sums);
    paintCommitUpcoming(book);
    paintCommitPlans(book);
}

function paintCommitForm(sums) {
    const plan = sums.plan;
    const incoming = plan.direction === 'in';

    set('commitFormTitle', plan.id ? 'Editing ' + planName(plan) : 'New plan');
    set('commitDirectionHint', incoming
        ? 'Money you lent that is coming back to you in instalments.'
        : 'A phone, a car, SPayLater — anything you are paying off over months.');

    const whoLabel = $('commitWhoLabel');
    if (whoLabel) {
        whoLabel.innerHTML = (incoming ? 'Who owes you' : 'Who to') +
            ' <span class="per">optional</span>';
    }
    const who = $('commitWho');
    if (who) who.placeholder = incoming ? 'Ali' : 'SPayLater';

    set('commitPaidCountHint', incoming
        ? 'Already had some of it back? Put the number of months here and they settle straight away — ' +
          'nothing goes into your Expenses for them, since they came in before you started tracking.'
        : 'Picking this up part-way through? Put the number of months here and they settle straight away — ' +
          'nothing goes into your Expenses for them, since you paid them before you started tracking. ' +
          'Tick the months after that as you pay them.');

    const totalField   = $('commitTotalField');
    const monthlyField = $('commitMonthlyField');
    if (totalField)   totalField.hidden   = plan.basis !== 'total';
    if (monthlyField) monthlyField.hidden = plan.basis !== 'monthly';

    set('commitTallyTotal', money(fromSen(sums.totalSen)));
    set('commitTallyMonthly', money(fromSen(sums.monthlySen)));
    set('commitTallyPaid', money(fromSen(sums.paidSen)));
    set('commitTallyLeftLabel', incoming ? 'Still owed to you' : 'Still to pay');
    set('commitTallyLeft', money(fromSen(sums.leftSen)));

    // --- the expense link ---
    const auto = $('commitAuto');
    set('commitAutoLabel', incoming
        ? 'Write an income entry every time I tick a payment'
        : 'Write an expense every time I tick a payment');
    set('commitLinkHint', incoming
        ? 'Off by default: money coming back from a loan is your own capital returning, not income, ' +
          'and counting it as income would inflate a year of earnings. Turn it on and pick the ' +
          'category yourself if you want it in the book anyway.'
        : 'Ticking a payment files it under Expenses; un-ticking takes it back out. Nothing is written twice.');
    set('commitLinkSummary', !auto || !auto.checked ? 'Off'
        : !plan.account ? 'No account set'
        : (accountById(plan.account) || {}).name || 'On');

    // --- the buttons ---
    const save = $('commitSave');
    if (save) save.innerHTML = '<i class="bi bi-check-lg"></i> ' + (plan.id ? 'Update plan' : 'Save plan');

    const pill = $('commitState');
    if (pill) {
        const state = !plan.id ? 'draft' : plan.cancelled ? 'dirty' : 'saved';
        pill.dataset.state = state;
        pill.textContent = !plan.id ? 'Draft' : COMMIT_STATUS[sums.status].label;
    }

    const fresh = $('commitNew');
    if (fresh) fresh.hidden = !plan.id;

    const cancel = $('commitCancelPlan');
    if (cancel) {
        cancel.hidden = !plan.id;
        cancel.innerHTML = plan.cancelled
            ? '<i class="bi bi-arrow-counterclockwise"></i> Un-cancel this plan'
            : '<i class="bi bi-slash-circle"></i> Cancel this plan';
    }
}

/**
 * The month-by-month list. Rebuilt on every paint, which is safe because the
 * only field in it is the amount override — and that is committed on `change`,
 * when the caret has already left.
 */
function paintCommitSchedule(sums) {
    const host = $('commitMonthsList');
    const plan = sums.plan;
    if (!host) return;

    set('commitScheduleNote', sums.months
        ? sums.paidCount + ' of ' + sums.months + ' paid · ' + money(fromSen(sums.paidSen)) +
          ' of ' + money(fromSen(sums.totalSen)) + (plan.id ? '' : ' · not saved yet')
        : 'Nothing to schedule yet');

    const bar = $('commitProgressBar');
    if (bar) {
        bar.style.width = sums.progress + '%';
        bar.className = 'is-' + (sums.status === 'overdue' ? 'red'
            : sums.status === 'completed' ? 'done' : 'jade');
    }

    set('commitCountdown', commitCountdownText(sums));

    host.innerHTML = '';
    if (!sums.months) {
        host.innerHTML = '<p class="split-empty">Put in an amount and a number of months — ' +
            'the schedule builds itself.</p>';
        return;
    }

    sums.rows.forEach((row) => {
        const look = PAYMENT_STATUS[row.status];
        const line = document.createElement('div');
        line.className = 'commit-month is-' + look.tone + (row.paid ? ' is-paid' : '');
        line.dataset.n = String(row.n);
        line.innerHTML =
            '<button type="button" class="commit-tick" data-tick="' + row.n + '" ' +
                'aria-pressed="' + row.paid + '" ' +
                'aria-label="' + (row.paid ? 'Un-tick' : 'Tick') + ' payment ' + row.n + '">' +
                '<i class="bi ' + look.icon + '"></i></button>' +
            '<div class="commit-month-id">' +
                '<b>' + monthKeyLabel(monthOf(row.due)) + '</b>' +
                '<small>#' + row.n + ' · due ' + dayLabel(row.due) +
                    (row.paid && row.paidOn ? ' · paid ' + dayShort(row.paidOn) : '') +
                    (row.entryId ? ' · in Expenses' : row.caughtUp ? ' · caught up' : '') + '</small>' +
            '</div>' +
            '<div class="money-input money-input-sm' + (row.override ? ' is-set' : '') + '">' +
                '<span class="affix">RM</span>' +
                '<input type="number" class="commit-amount" data-n="' + row.n + '" min="0" step="0.01" ' +
                'inputmode="decimal" aria-label="Amount for payment ' + row.n + '"></div>' +
            '<span class="commit-flag is-' + look.tone + '">' +
                (row.paid ? 'Paid' : row.status === 'upcoming' ? daysWord(-row.late) : look.label) +
            '</span>';

        line.querySelector('.commit-amount').value = fmt(fromSen(row.amountSen));
        host.appendChild(line);
    });
}

function commitCountdownText(sums) {
    const plan = sums.plan;
    if (!plan.id) {
        return 'A preview — the months above follow what you type. Save the plan to keep it, ' +
            'and to start ticking them off as you pay.';
    }
    if (plan.cancelled) return 'Cancelled — it counts towards nothing, and everything already ticked is kept.';
    if (!sums.months) return '—';
    if (sums.status === 'completed') {
        return 'All ' + sums.months + ' paid — ' + money(fromSen(sums.paidSen)) +
            ', finished ' + dayLabel(sums.finishIso) + '.';
    }

    const verb = plan.direction === 'in' ? 'still owed to you' : 'still to pay';
    const parts = [];

    if (sums.next) {
        parts.push('Next: ' + money(fromSen(sums.next.amountSen)) + ' on ' + dayLabel(sums.next.due) +
            ' — ' + daysWord(sums.daysToNext) + '.');
    }
    parts.push(sums.leftCount + (sums.leftCount === 1 ? ' payment left, ' : ' payments left, ') +
        money(fromSen(sums.leftSen)) + ' ' + verb + '.');
    if (sums.finishIso) parts.push('Finishes ' + monthKeyLabel(monthOf(sums.finishIso)) + '.');
    if (sums.overdueCount) {
        parts.push(sums.overdueCount + (sums.overdueCount === 1 ? ' payment is' : ' payments are') +
            ' past its date.');
    }

    return parts.join(' ');
}

function paintCommitUpcoming(book) {
    const body = $('commitUpcoming');
    if (!body) return;
    body.innerHTML = '';

    const rows = book.due.slice(0, 12);
    set('commitUpcomingNote', book.due.length
        ? book.due.length + ' unpaid · ' +
          (book.overdue.length ? book.overdue.length + ' overdue' : 'none overdue')
        : 'Nothing outstanding');

    if (!rows.length) {
        body.appendChild(emptyRow('Nothing due. Save a plan and its months line up here, soonest first.', 5));
        return;
    }

    rows.forEach(({ plan, row }) => {
        const look = PAYMENT_STATUS[row.status];
        const incoming = plan.plan.direction === 'in';

        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong>' + dayShort(row.due) + '</strong>' +
            '<small>' + daysWord(daysBetween(todayIso(), row.due)) + '</small>'
        ));
        tr.appendChild(cell(
            '<strong>' + escapeHtml(planName(plan.plan)) + '</strong>' +
            '<small>' + (incoming ? 'owed to you' : 'you pay') +
            (plan.plan.who.trim() ? ' · ' + escapeHtml(plan.plan.who.trim()) : '') + '</small>'
        ));
        tr.appendChild(cell('#' + row.n + ' of ' + plan.months, 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(row.amountSen)), 'is-strong'));
        tr.appendChild(cell('<span class="tag is-' + look.tone + '">' + look.label + '</span>'));
        body.appendChild(tr);
    });

    if (book.due.length > rows.length) {
        const more = book.due.length - rows.length;
        body.appendChild(emptyRow('and ' + more + ' further ' + (more === 1 ? 'payment' : 'payments') +
            ' after these — open a plan to see its whole schedule.', 5));
    }
}

function paintCommitPlans(book) {
    const body = $('commitPlans');
    if (!body) return;
    body.innerHTML = '';

    const rows = (commitState.filter === 'all' ? book.all : book.all.filter((p) => p.live))
        .slice()
        .sort((a, b) => {
            const an = a.next ? a.next.due : '9999';
            const bn = b.next ? b.next.due : '9999';
            return an < bn ? -1 : an > bn ? 1 : b.plan.seq - a.plan.seq;
        });

    set('commitPlansNote', book.all.length
        ? book.all.length + (book.all.length === 1 ? ' plan' : ' plans') +
          (book.overdue.length ? ' · ' + book.overdue.length + ' payment overdue' : '')
        : 'Nothing saved yet');

    if (!rows.length) {
        body.appendChild(emptyRow(commitState.filter === 'all'
            ? 'Nothing saved yet. Fill in the form above and press Save plan.'
            : 'Nothing running. Switch to All to see finished and cancelled plans.', 6));
        return;
    }

    rows.forEach((sums) => {
        const plan = sums.plan;
        const look = COMMIT_STATUS[sums.status];
        const incoming = plan.direction === 'in';

        const tr = document.createElement('tr');
        if (commitState.editing === plan.id) tr.className = 'is-you';

        tr.appendChild(cell(
            '<strong>' + escapeHtml(planName(plan)) +
            (incoming ? ' <span class="tag">owed to you</span>' : '') + '</strong>' +
            '<small>' + (plan.who.trim() ? escapeHtml(plan.who.trim()) + ' · ' : '') +
            sums.months + ' months from ' + dayShort(plan.firstDue) + '</small>'
        ));
        tr.appendChild(cell('<span class="tag is-' + look.tone + '">' + look.label + '</span>'));
        tr.appendChild(cell(
            '<strong>' + sums.paidCount + ' / ' + sums.months + '</strong>' +
            '<small>' + money(fromSen(sums.paidSen)) + ' paid</small>'
        ));
        tr.appendChild(cell(fmt(fromSen(sums.monthlySen)), 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(sums.leftSen)), sums.leftSen ? 'is-strong' : 'is-plus'));
        tr.appendChild(cell(
            '<button type="button" class="split-x" data-open-plan="' + plan.id + '" aria-label="Open plan">' +
            '<i class="bi bi-pencil"></i></button>' +
            '<button type="button" class="split-x" data-drop-plan="' + plan.id + '" aria-label="Delete plan">' +
            '<i class="bi bi-x-lg"></i></button>', 'row-actions'));

        body.appendChild(tr);
    });
}

function commitSummaryText() {
    const sums = planCompute(commitDraft());
    const plan = sums.plan;
    if (!sums.months) return 'Nothing to copy yet.';

    const lines = [planName(plan) + ' — ' + money(fromSen(sums.totalSen)) +
        ' over ' + sums.months + ' months, ' + money(fromSen(sums.monthlySen)) + ' each' +
        (plan.who.trim() ? (plan.direction === 'in' ? ' — owed by ' : ' — to ') + plan.who.trim() : '')];

    lines.push(sums.paidCount + ' paid (' + money(fromSen(sums.paidSen)) + '), ' +
        sums.leftCount + ' left (' + money(fromSen(sums.leftSen)) + ')');

    if (sums.next) {
        lines.push('Next ' + money(fromSen(sums.next.amountSen)) + ' on ' + dayLabel(sums.next.due) +
            ' — ' + daysWord(sums.daysToNext));
    }
    if (sums.finishIso) lines.push('Finishes ' + monthKeyLabel(monthOf(sums.finishIso)));

    sums.rows.forEach((row) => {
        lines.push('  #' + row.n + ' ' + dayLabel(row.due) + '  ' +
            money(fromSen(row.amountSen)) + '  ' +
            (row.paid ? 'paid' : row.status === 'overdue' ? 'OVERDUE' : 'upcoming'));
    });

    return lines.join('\n');
}

function renderCommit() {
    readCommitForm();
    paintCommit();
}

/**
 * --------------------------------------------------------------------
 * Persistence
 * --------------------------------------------------------------------
 */
function saveCommit() {
    try {
        storeWrite(COMMIT_KEY, JSON.stringify({
            seq: commitState.seq,
            filter: commitState.filter,
            editing: commitState.editing,
            plans: commitState.plans,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

/** The stored copy is untrusted. A payment numbered past the end of the term,
 *  a term of "banana", a due date that is not a date: each of those puts a
 *  wrong figure on screen, so each is dropped on the way in. */
function loadCommit() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(COMMIT_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || !Array.isArray(saved.plans)) { commitState.draft = newPlan(); return; }

    commitState.seq = Number(saved.seq) || 0;
    commitState.filter = saved.filter === 'all' ? 'all' : 'live';

    commitState.plans = saved.plans.filter((p) => p && p.id).map((p) => {
        const months = Math.min(COMMIT_MAX_MONTHS, Math.max(0, Math.floor(parseFloat(p.months) || 0)));
        const payments = {};
        Object.entries((p.payments && typeof p.payments === 'object') ? p.payments : {}).forEach(([key, rec]) => {
            const n = parseInt(key, 10);
            if (!(n >= 1 && n <= months) || !rec) return;
            // Three-valued on purpose: ticked, un-ticked, or never decided —
            // and only the third falls back to the "already paid" count.
            const out = {
                date: /^\d{4}-\d{2}-\d{2}$/.test(rec.date || '') ? rec.date : '',
                entryId: String(rec.entryId || ''),
            };
            if (rec.paid === true || rec.paid === false) out.paid = rec.paid;
            if (rec.amount !== undefined && rec.amount !== '') out.amount = String(rec.amount);
            // A record holding no decision, no figure and no link says nothing.
            if (out.paid === undefined && out.amount === undefined && !out.entryId) return;
            payments[n] = out;
        });

        return {
            id: String(p.id),
            seq: Number(p.seq) || 0,
            name: String(p.name || ''),
            direction: p.direction === 'in' ? 'in' : 'out',
            who: String(p.who || ''),
            basis: p.basis === 'monthly' ? 'monthly' : 'total',
            total: String(p.total || ''),
            monthly: String(p.monthly || ''),
            months: String(months || ''),
            paidAhead: String(Math.max(0, Math.floor(parseFloat(p.paidAhead) || 0)) || ''),
            firstDue: /^\d{4}-\d{2}-\d{2}$/.test(p.firstDue || '') ? p.firstDue : todayIso(),
            autoRecord: p.autoRecord !== false,
            account: String(p.account || ''),
            category: String(p.category || ''),
            cancelled: !!p.cancelled,
            payments,
            created: String(p.created || ''),
            updated: String(p.updated || ''),
        };
    });

    // An entry the ledger no longer holds is not a link, and leaving the id
    // would make un-ticking try to delete something that is not there.
    const entryIds = new Set(ledgerState.entries.map((e) => e.id));
    commitState.plans.forEach((p) => {
        Object.values(p.payments).forEach((rec) => {
            if (rec.entryId && !entryIds.has(rec.entryId)) rec.entryId = '';
        });
    });

    commitState.plans.forEach((p) => { commitState.seq = Math.max(commitState.seq, p.seq); });

    const open = commitState.plans.find((p) => p.id === saved.editing);
    commitState.draft = open || newPlan();
    commitState.editing = open ? open.id : null;
}

/**
 * ====================================================================
 * CREDIT CARD PAYOFF
 * ====================================================================
 * A card is not a loan: nobody hands you a term. The balance is whatever is
 * left, interest lands on it every month, and the minimum due shrinks as the
 * balance does — which is exactly why minimum-only payments drag on for
 * decades. So the module simulates month by month rather than solving a
 * formula, and every plan is run through the same loop.
 *
 * Bank Negara caps card interest at 18% a year, tiered down to 17% and 15%
 * on a good payment record, and requires a minimum payment of 5% of the
 * outstanding balance. Those are the defaults.
 */
const CARD_KEY = 'moneyflow.card.v1';

// 60 years. Anything still running at that point is not a payoff plan.
const CARD_MAX_MONTHS = 720;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 2026", `offset` months from this month. */
function monthLabel(offset) {
    const when = new Date();
    when.setDate(1);
    when.setMonth(when.getMonth() + offset);
    return MONTH_NAMES[when.getMonth()] + ' ' + when.getFullYear();
}

function monthsText(months) {
    if (!isFinite(months)) return 'Never';
    if (months <= 0) return 'Already clear';
    if (months < 12) return months + (months === 1 ? ' month' : ' months');
    const years = Math.floor(months / 12);
    const rest  = months % 12;
    return years + ' yr' + (rest ? ' ' + rest + ' mo' : '');
}

/**
 * Run a balance down to zero, one month at a time.
 *
 * `payFn(balanceSen, interestSen, statementSen)` decides that month's payment,
 * which lets the same loop serve both a fixed monthly amount and the shrinking
 * minimum. A payment that never exceeds the interest leaves the balance flat
 * or growing — that is reported rather than looped over forever.
 */
function cardRun(balanceSen, monthlyRate, payFn) {
    const rows = [];
    let bal = balanceSen;
    let interestSen = 0;
    let paidSen = 0;

    if (bal <= 0) return { rows, months: 0, interestSen: 0, paidSen: 0, stalls: false };

    for (let m = 1; m <= CARD_MAX_MONTHS && bal > 0; m++) {
        const monthInterest = Math.round(bal * monthlyRate);
        const statement = bal + monthInterest;
        const pay = Math.min(Math.max(0, payFn(bal, monthInterest, statement)), statement);

        // Not even covering the interest: the balance never falls.
        if (pay <= monthInterest) {
            return { rows, months: Infinity, interestSen: Infinity, paidSen: Infinity, stalls: true };
        }

        bal = statement - pay;
        interestSen += monthInterest;
        paidSen += pay;
        rows.push({ month: m, paySen: pay, interestSen: monthInterest, principalSen: pay - monthInterest, balanceSen: bal });
    }

    if (bal > 0) return { rows, months: Infinity, interestSen: Infinity, paidSen: Infinity, stalls: true };
    return { rows, months: rows.length, interestSen, paidSen, stalls: false };
}

/**
 * The smallest monthly payment that clears the balance within `months`.
 *
 * The textbook annuity payment lands in the right neighbourhood but not
 * reliably on the right month: interest is rounded to the sen every month, and
 * those fractions can leave a few sen outstanding that tip the plan into one
 * extra payment — so "clear it in a year" would quietly come back as 13. The
 * answer is settled against the same simulation everything else uses instead.
 * More money each month always means fewer months, so a binary search lands on
 * the exact boundary.
 */
function cardPaymentFor(balanceSen, monthlyRate, months) {
    if (months <= 0 || balanceSen <= 0) return balanceSen;

    const fits = (paySen) => {
        const run = cardRun(balanceSen, monthlyRate, () => paySen);
        return !run.stalls && run.months <= months;
    };

    let lo = 0;                                                   // clears nothing
    let hi = balanceSen + Math.round(balanceSen * monthlyRate);   // clears in one go

    while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid)) hi = mid; else lo = mid;
    }
    return hi;
}

/** Collapse the month rows into one row per calendar year of the plan. */
function cardYearRows(rows) {
    const years = [];
    rows.forEach((row, index) => {
        const year = Math.floor(index / 12);
        if (!years[year]) years[year] = { year: year + 1, paySen: 0, interestSen: 0, principalSen: 0, balanceSen: 0, months: 0 };
        years[year].paySen       += row.paySen;
        years[year].interestSen  += row.interestSen;
        years[year].principalSen += row.principalSen;
        years[year].balanceSen    = row.balanceSen;
        years[year].months       += 1;
    });
    return years;
}

/**
 * --------------------------------------------------------------------
 * A book of cards
 * --------------------------------------------------------------------
 * The module began as one card and a calculator. Nobody has one card. So the
 * cards are records now — name, limit, outstanding, rate, minimum, due day —
 * and the plan is worked out across all of them from a single monthly budget.
 *
 * `opening` is what was owed when the card was first written down, and it is
 * the only thing progress can honestly be measured against. Interest and new
 * spending push the outstanding back up, and this app can see neither, so the
 * outstanding stays the reader's to correct from the statement. Logging a
 * payment is the one thing that moves it down by itself.
 */
let cardState = { cards: [], draft: null, editing: null, seq: 0, filter: 'open' };

const newCard = () => ({
    id: '', seq: 0,
    name: '',
    limit: '', opening: '', balance: '',
    rate: '18', minPct: '5', minFloor: '25',
    dueDay: '15',
    autoRecord: true, account: '', category: '',
    closed: false,
    payments: [],
    created: '', updated: '',
});

const cardDraft = () => cardState.draft || (cardState.draft = newCard());
const cardById = (id) => cardState.cards.find((c) => c.id === id) || null;
const cardName = (card) => (card.name || '').trim() || 'Untitled card';

/** One card, costed. Every figure here is derived; none of it is stored. */
function cardFigures(card) {
    const limitSen   = Math.max(0, toSen(parseFloat(card.limit) || 0));
    const balanceSen = Math.max(0, toSen(parseFloat(card.balance) || 0));
    const openingSen = Math.max(0, toSen(parseFloat(card.opening) || 0)) || balanceSen;

    const annualRate  = Math.max(0, parseFloat(card.rate) || 0);
    const monthlyRate = annualRate / 100 / 12;
    const minPct      = Math.max(0, parseFloat(card.minPct) || 0);
    const minFloorSen = Math.max(0, toSen(parseFloat(card.minFloor) || 0));

    const paidSen = card.payments.reduce((sum, p) => sum + Math.max(0, toSen(parseFloat(p.amount) || 0)), 0);

    const interestSen = Math.round(balanceSen * monthlyRate);
    const statementSen = balanceSen + interestSen;
    const minimumSen = balanceSen > 0
        ? Math.min(statementSen, Math.max(Math.round(statementSen * minPct / 100), minFloorSen))
        : 0;

    return {
        card, limitSen, balanceSen, openingSen, annualRate, monthlyRate, minPct, minFloorSen,
        paidSen, interestSen, statementSen, minimumSen,
        availableSen: Math.max(0, limitSen - balanceSen),
        usedPct: limitSen > 0 ? balanceSen / limitSen * 100 : 0,
        // Progress can pass 100% on a card that keeps being used. The bar caps;
        // the figure beside it does not, because that is the honest one.
        progress: openingSen > 0 ? Math.min(100, paidSen / openingSen * 100) : 0,
        progressRaw: openingSen > 0 ? paidSen / openingSen * 100 : 0,
        live: !card.closed && balanceSen > 0,
        nextDue: cardNextDue(card),
    };
}

/** The next date this card falls due, from its day of the month. */
function cardNextDue(card) {
    const day = Math.min(31, Math.max(1, Math.floor(parseFloat(card.dueDay) || 0)));
    if (!day) return '';
    const today = todayIso();
    const [y, m] = isoNums(today);
    const clamp = (yy, mm) => isoOf(yy, mm, Math.min(day, new Date(yy, mm, 0).getDate()));
    const thisMonth = clamp(y, m);
    if (thisMonth >= today) return thisMonth;
    const next = new Date(y, m, 1);
    return clamp(next.getFullYear(), next.getMonth() + 1);
}

const cardsLive = () => cardState.cards.map(cardFigures).filter((c) => c.live);
const cardTotalDebtSen = () => cardsLive().reduce((sum, c) => sum + c.balanceSen, 0);
const cardTotalMinimumSen = () => cardsLive().reduce((sum, c) => sum + c.minimumSen, 0);

/**
 * --------------------------------------------------------------------
 * Paying more than one card
 * --------------------------------------------------------------------
 * One budget, every month: charge each card its interest, pay every card its
 * minimum, then throw whatever is left at exactly one of them. Which one is
 * the strategy — and as each card clears, its minimum joins the pile going at
 * the next. That rolling-up is the whole reason a plan beats paying each card
 * on its own, and it is why this cannot be a per-card sum.
 *
 * `minimum` spends nothing extra: it is the baseline the other two are
 * measured against, and the behaviour this module exists to argue with.
 */
const CARD_STRATEGIES = {
    avalanche: { label: 'Avalanche', note: 'Highest interest rate first' },
    snowball:  { label: 'Snowball',  note: 'Smallest balance first' },
    minimum:   { label: 'Minimum only', note: 'What the bank asks for, and nothing more' },
};

function payoffOrder(live, strategy) {
    const rows = live.slice();
    if (strategy === 'snowball') {
        rows.sort((a, b) => (a.bal - b.bal) || (b.monthlyRate - a.monthlyRate));
    } else if (strategy === 'avalanche') {
        rows.sort((a, b) => (b.monthlyRate - a.monthlyRate) || (a.bal - b.bal));
    }
    return rows;
}

function payoffRun(figures, budgetSen, strategy) {
    const cards = figures
        .filter((f) => f.balanceSen > 0)
        .map((f) => ({
            id: f.card.id, name: cardName(f.card),
            bal: f.balanceSen, startSen: f.balanceSen,
            monthlyRate: f.monthlyRate, annualRate: f.annualRate,
            minPct: f.minPct, minFloorSen: f.minFloorSen,
            paid: 0, interest: 0, clearedMonth: 0,
        }));

    const empty = {
        rows: [], cards, months: 0, interestSen: 0, paidSen: 0,
        stalls: false, short: false, shortSen: 0, startSen: 0,
    };
    if (!cards.length) return empty;

    const startSen = cards.reduce((sum, c) => sum + c.bal, 0);
    const rows = [];
    let interestSen = 0, paidSen = 0;

    for (let m = 1; m <= CARD_MAX_MONTHS; m++) {
        const live = cards.filter((c) => c.bal > 0);
        if (!live.length) break;

        live.forEach((c) => {
            c.monthInterest = Math.round(c.bal * c.monthlyRate);
            c.statement = c.bal + c.monthInterest;
            c.min = Math.min(c.statement,
                Math.max(Math.round(c.statement * c.minPct / 100), c.minFloorSen));
        });

        const minsSen = live.reduce((sum, c) => sum + c.min, 0);
        const budget = strategy === 'minimum' ? minsSen : Math.max(budgetSen, 0);

        // A budget that will not cover the minimums is not a slow plan, it is
        // no plan. Saying how far short beats simulating a fiction.
        if (budget < minsSen) {
            return Object.assign({}, empty, {
                cards, startSen, stalls: true, short: true,
                shortSen: minsSen - budget, needSen: minsSen,
                months: Infinity, interestSen: Infinity, paidSen: Infinity,
            });
        }

        live.forEach((c) => { c.thisPay = c.min; });
        let spare = budget - minsSen;

        payoffOrder(live, strategy).forEach((c) => {
            if (spare <= 0) return;
            const room = c.statement - c.thisPay;
            const extra = Math.min(room, spare);
            c.thisPay += extra;
            spare -= extra;
        });

        let monthPay = 0, monthInterest = 0;
        live.forEach((c) => {
            c.bal = c.statement - c.thisPay;
            c.interest += c.monthInterest;
            c.paid += c.thisPay;
            monthPay += c.thisPay;
            monthInterest += c.monthInterest;
            if (c.bal <= 0 && !c.clearedMonth) c.clearedMonth = m;
        });

        interestSen += monthInterest;
        paidSen += monthPay;
        const owed = cards.reduce((sum, c) => sum + Math.max(0, c.bal), 0);
        rows.push({
            month: m, paySen: monthPay, interestSen: monthInterest,
            principalSen: monthPay - monthInterest, balanceSen: owed,
        });

        // Nothing moved and nothing will: every card's minimum is being eaten
        // by its own interest.
        if (monthPay <= monthInterest && owed > 0) {
            return Object.assign({}, empty, {
                rows, cards, startSen, stalls: true,
                months: Infinity, interestSen: Infinity, paidSen: Infinity,
            });
        }
    }

    if (cards.some((c) => c.bal > 0)) {
        return Object.assign({}, empty, {
            rows, cards, startSen, stalls: true,
            months: Infinity, interestSen: Infinity, paidSen: Infinity,
        });
    }

    return { rows, cards, months: rows.length, interestSen, paidSen, stalls: false, short: false, startSen };
}

function cardCompute() {
    const figures = cardState.cards.map(cardFigures);
    const live = figures.filter((f) => f.live);
    const budgetSen = Math.max(0, toSen(num('cardPayment')));
    const strategy = (($('cardStrategy') || {}).dataset || {}).value === 'snowball' ? 'snowball' : 'avalanche';

    const minimumSen = live.reduce((sum, c) => sum + c.minimumSen, 0);
    // An empty payment field means "I pay what they ask" — the baseline.
    const onMinimum = budgetSen <= 0;
    const spendSen = onMinimum ? minimumSen : budgetSen;

    const plans = {
        minimum:   payoffRun(figures, 0, 'minimum'),
        avalanche: payoffRun(figures, spendSen, 'avalanche'),
        snowball:  payoffRun(figures, spendSen, 'snowball'),
    };
    const plan = onMinimum ? plans.minimum : plans[strategy];

    return {
        figures, live, plans, plan, strategy, onMinimum,
        budgetSen, spendSen, minimumSen,
        debtSen: live.reduce((sum, c) => sum + c.balanceSen, 0),
        limitSen: live.reduce((sum, c) => sum + c.limitSen, 0),
        paidSen: figures.reduce((sum, c) => sum + c.paidSen, 0),
        openingSen: figures.reduce((sum, c) => sum + c.openingSen, 0),
        view: (($('cardView') || {}).dataset || {}).value || 'year',
        draft: cardFigures(cardDraft()),
    };
}

/**
 * --------------------------------------------------------------------
 * Form in, form out
 * --------------------------------------------------------------------
 */
function readCardForm() {
    const card = cardDraft();
    card.name     = ($('cardName')     || {}).value || '';
    card.limit    = ($('cardLimit')    || {}).value || '';
    card.balance  = ($('cardBalance')  || {}).value || '';
    card.rate     = ($('cardRate')     || {}).value || '';
    card.minPct   = ($('cardMinPct')   || {}).value || '';
    card.minFloor = ($('cardMinFloor') || {}).value || '';
    card.dueDay   = ($('cardDueDay')   || {}).value || '';
    card.autoRecord = !!($('cardAuto') || {}).checked;
    card.account  = ($('cardAccount')  || {}).value || '';
    card.category = ($('cardCategory') || {}).value || '';
}

function fillCardForm() {
    const card = cardDraft();
    if ($('cardName'))     $('cardName').value     = card.name;
    if ($('cardLimit'))    $('cardLimit').value    = card.limit;
    if ($('cardBalance'))  $('cardBalance').value  = card.balance;
    if ($('cardRate'))     $('cardRate').value     = card.rate;
    if ($('cardMinPct'))   $('cardMinPct').value   = card.minPct;
    if ($('cardMinFloor')) $('cardMinFloor').value = card.minFloor;
    if ($('cardDueDay'))   $('cardDueDay').value   = card.dueDay;
    if ($('cardAuto'))     $('cardAuto').checked   = card.autoRecord;
    buildCardOptions();
    // Only when the card names one. `buildCardOptions` has already picked a
    // sensible default, and writing a stored blank over it leaves the select
    // with nothing selected — which saves as "no account" and quietly stops
    // every payment reaching Expenses.
    if ($('cardAccount')  && card.account)  $('cardAccount').value  = card.account;
    if ($('cardCategory') && card.category) $('cardCategory').value = card.category;
    syncCardTier();
}

function buildCardOptions() {
    const card = cardDraft();

    const accounts = $('cardAccount');
    if (accounts) {
        const held = accounts.value || card.account;
        accounts.innerHTML = '';
        ledgerState.accounts.filter((a) => a.status !== 'closed').forEach((account) => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.name.trim() || 'Unnamed account';
            accounts.appendChild(option);
        });
        if (held && Array.from(accounts.options).some((o) => o.value === held)) accounts.value = held;
    }

    const cats = $('cardCategory');
    if (cats) {
        const held = cats.value || card.category;
        cats.innerHTML = '';
        categoryListFor('expense').forEach((cat) => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.label;
            cats.appendChild(option);
        });
        if (held && Array.from(cats.options).some((o) => o.value === held)) cats.value = held;
        else if (categoryById('debt')) cats.value = 'debt';
    }
}

/** Keep the rate preset in step with the rate field. */
function syncCardTier() {
    const seg = $('cardTier');
    if (!seg) return;
    const rate = String(num('cardRate'));
    setSegment(seg, ['15', '17', '18'].includes(rate) ? rate : 'custom');
}

const cardHint = (text) => {
    const hint = $('cardSaveHint');
    if (!hint) return;
    hint.innerHTML = '<i class="bi bi-info-circle"></i> ' + escapeHtml(text);
    clearTimeout(cardHint.timer);
    cardHint.timer = setTimeout(() => {
        hint.innerHTML = '<i class="bi bi-hdd"></i> Saved on this device only — nothing leaves your browser.';
    }, 6000);
};

/**
 * --------------------------------------------------------------------
 * Saving
 * --------------------------------------------------------------------
 */
function cardSaveCard() {
    readCardForm();
    const card = cardDraft();

    if (!card.name.trim()) { cardHint('Give the card a name — "Maybank Visa", something you will recognise.'); return; }

    const stamp = todayIso();
    if (!card.id) {
        card.id = 'cc' + (++cardState.seq);
        card.seq = cardState.seq;
        card.created = stamp;
        // What was owed when it was first written down. Everything the payment
        // log reports as progress is measured against this.
        if (!card.opening) card.opening = card.balance;
        cardState.cards.push(card);
        cardState.editing = card.id;
    } else {
        const at = cardState.cards.findIndex((c) => c.id === card.id);
        if (at >= 0) cardState.cards[at] = card;
    }
    card.updated = stamp;

    saveCard();
    renderCard();
    renderDash();
    flashButton($('cardSave'), '<i class="bi bi-check-lg"></i> Saved');
}

function cardOpenCard(id) {
    const card = cardById(id);
    if (!card) return;
    cardState.draft = card;
    cardState.editing = card.id;
    fillCardForm();
    renderCard();
    const form = $('card-form');
    if (form) reveal(form).scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function cardNewCard() {
    cardState.draft = newCard();
    cardState.editing = null;
    fillCardForm();
    renderCard();
}

function cardToggleClosed() {
    const card = cardDraft();
    if (!card.id) return;

    if (card.closed) {
        card.closed = false;
        saveCard();
        renderCard();
        renderDash();
        return;
    }

    askConfirm(
        'Close ' + cardName(card) + '?',
        'It drops out of the payoff plan and out of what you owe. Its payment history stays exactly ' +
        'as it is, and you can open it again later.',
        'Close the card',
        () => { card.closed = true; saveCard(); renderCard(); renderDash(); });
}

function cardDropCard(id) {
    const card = cardById(id);
    if (!card) return;
    const linked = card.payments.filter((p) => p.entryId).length;

    askConfirm(
        'Delete ' + cardName(card) + '?',
        'The card and its ' + card.payments.length +
        (card.payments.length === 1 ? ' logged payment go' : ' logged payments go') + ' for good.' +
        (linked ? ' The ' + linked + (linked === 1 ? ' entry it wrote' : ' entries it wrote') +
            ' into Expenses stay where they are.' : '') +
        ' To take it out of the plan without losing it, close it instead.',
        'Delete card',
        () => {
            cardState.cards = cardState.cards.filter((c) => c.id !== id);
            if (cardState.editing === id) cardNewCard();
            saveCard();
            renderCard();
            renderDash();
        });
}

/**
 * --------------------------------------------------------------------
 * Payments
 * --------------------------------------------------------------------
 * A payment is a record, and it does two things: it comes off the card's
 * outstanding, and — if the card says so — it writes one entry into Expenses.
 * The entry id lives on the payment, so removing the payment removes exactly
 * that entry and nothing else.
 */
function cardAddPayment() {
    readCardForm();
    const card = cardDraft();
    if (!card.id) { cardHint('Save the card first — a payment has to be against something.'); return; }

    const raw = ($('cardPayAmount') || {}).value || '';
    const sen = Math.max(0, toSen(parseFloat(raw) || 0));
    if (!sen) { if ($('cardPayAmount')) $('cardPayAmount').focus(); return; }

    const payment = {
        id: 'cp' + (++cardState.seq),
        date: ($('cardPayDate') || {}).value || todayIso(),
        amount: String(raw),
        note: (($('cardPayNote') || {}).value || '').trim(),
        entryId: '',
    };
    if (card.autoRecord) payment.entryId = cardWriteEntry(card, payment, sen);

    card.payments.push(payment);

    // The outstanding comes down by what was paid. Interest and new spending
    // push it back up and this app sees neither — that is the reader's to
    // correct, and the hint under the field says so.
    card.balance = String(Math.max(0, fromSen(Math.max(0, toSen(parseFloat(card.balance) || 0)) - sen)));
    card.updated = todayIso();

    saveCard();
    fillCardForm();
    if ($('cardPayAmount')) $('cardPayAmount').value = '';
    if ($('cardPayNote'))   $('cardPayNote').value = '';
    renderCard();
    renderLedger();
    renderDash();
    cardHint('Logged ' + money(fromSen(sen)) + (payment.entryId ? ' and recorded under Expenses.' : '.'));
}

function cardDropPayment(id) {
    const card = cardDraft();
    const payment = card.payments.find((p) => p.id === id);
    if (!payment) return;

    const sen = Math.max(0, toSen(parseFloat(payment.amount) || 0));
    if (payment.entryId) {
        ledgerState.entries = ledgerState.entries.filter((e) => e.id !== payment.entryId);
        saveLedger();
    }
    card.payments = card.payments.filter((p) => p.id !== id);
    card.balance = String(fromSen(Math.max(0, toSen(parseFloat(card.balance) || 0)) + sen));
    card.updated = todayIso();

    saveCard();
    fillCardForm();
    renderCard();
    renderLedger();
    renderDash();
    cardHint('Payment removed, and put back on the outstanding.');
}

function cardWriteEntry(card, payment, sen) {
    if (!card.account) {
        cardHint('Logged — but there is no account set, so nothing was written to Expenses.');
        return '';
    }
    const stamp = todayIso();
    const entry = {
        id: ledgerId('e'),
        seq: ++ledgerSeq,
        type: 'expense',
        amount: String(fromSen(sen)),
        currency: BASE_CURRENCY,
        base: '', rate: '',
        date: payment.date,
        category: card.category, sub: '',
        account: card.account, toAccount: '',
        note: cardName(card) + ' — card payment',
        created: stamp, updated: stamp,
    };
    ledgerState.entries.push(entry);
    ledgerState.month = monthOf(entry.date);
    saveLedger();
    return entry.id;
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
/** Where the money goes: principal against interest, over the whole plan. */
function paintCardDist(book) {
    const dist = $('cardDist');
    const legend = $('cardLegend');
    if (!dist || !legend) return;

    dist.innerHTML = '';
    legend.innerHTML = '';

    const plan = book.plan;
    if (!book.debtSen || plan.stalls) {
        dist.innerHTML = '<span class="dist-left" style="width:100%"></span>';
        legend.innerHTML = '<span class="legend-empty">' +
            (!book.debtSen
                ? 'Add a card with something owed on it and the split appears here.'
                : 'This payment never clears the cards, so there is nothing to split.') +
            '</span>';
        return;
    }

    const parts = [
        { label: 'What you owe now', tone: 'indigo', sen: plan.startSen },
        { label: 'Interest on top',  tone: 'red',    sen: plan.interestSen },
    ];
    const total = plan.paidSen || 1;

    parts.forEach((part) => {
        const bar = document.createElement('span');
        bar.className = 'dist-' + part.tone;
        bar.style.width = (part.sen / total * 100) + '%';
        bar.title = part.label + ' · ' + money(fromSen(part.sen));
        dist.appendChild(bar);

        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML = '<i class="dot dot-' + part.tone + '"></i>' +
            '<span>' + part.label + ' <b>' + money(fromSen(part.sen)) + '</b> ' +
            '<small>' + pct(part.sen / total * 100) + '</small></span>';
        legend.appendChild(item);
    });
}

/** Which card clears when, under the plan on screen. */
function paintCardOrder(book) {
    const body = $('cardOrderBody');
    const block = $('cardOrderCard');
    if (!body || !block) return;

    const plan = book.plan;
    block.hidden = !book.live.length;
    body.innerHTML = '';

    if (!book.live.length) return;

    set('cardOrderNote', plan.stalls
        ? 'No plan to order yet'
        : CARD_STRATEGIES[book.onMinimum ? 'minimum' : book.strategy].note);

    const rows = plan.cards.slice().sort((a, b) =>
        (a.clearedMonth || Infinity) - (b.clearedMonth || Infinity) || b.startSen - a.startSen);

    rows.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.appendChild(cell(plan.stalls ? '—' : String(index + 1), 'is-muted'));
        tr.appendChild(cell('<strong>' + escapeHtml(row.name) + '</strong>' +
            '<small>' + fmt(row.annualRate, 1) + '% a year</small>'));
        tr.appendChild(cell(fmt(fromSen(row.startSen)), 'is-strong'));
        tr.appendChild(cell(fmt(row.annualRate, 1) + '%', 'is-muted'));
        tr.appendChild(cell(plan.stalls ? '—' : fmt(fromSen(row.interest)),
            plan.stalls ? 'is-muted' : 'is-minus'));
        tr.appendChild(cell(plan.stalls || !row.clearedMonth
            ? 'Never'
            : monthLabel(row.clearedMonth - 1) + ' · ' + monthsText(row.clearedMonth),
            plan.stalls ? 'is-minus' : ''));
        body.appendChild(tr);
    });
}

/** Snowball against avalanche, both against doing nothing extra. */
function paintCardCompare(book) {
    const body = $('cardCompareBody');
    const block = $('cardCompareCard');
    if (!body || !block) return;

    block.hidden = book.live.length < 1;
    body.innerHTML = '';
    if (!book.live.length) return;

    const base = book.plans.minimum;
    const chosen = book.onMinimum ? 'minimum' : book.strategy;

    const cheapest = ['avalanche', 'snowball']
        .filter((k) => !book.plans[k].stalls)
        .sort((a, b) => book.plans[a].interestSen - book.plans[b].interestSen)[0];

    set('cardCompareNote', book.onMinimum
        ? 'Put in a monthly payment to compare them'
        : book.plans.avalanche.stalls ? 'That payment does not clear them'
        : 'Avalanche saves ' +
          money(fromSen(Math.max(0, book.plans.snowball.interestSen - book.plans.avalanche.interestSen))) +
          ' over snowball');

    ['minimum', 'avalanche', 'snowball'].forEach((key) => {
        const plan = book.plans[key];
        const look = CARD_STRATEGIES[key];

        const tr = document.createElement('tr');
        if (key === chosen) tr.className = 'is-you';

        tr.appendChild(cell(
            '<strong>' + look.label +
            (key === chosen ? ' <span class="tag">yours</span>' : '') +
            (key === cheapest && key !== 'minimum' ? ' <span class="tag is-done">cheapest</span>' : '') +
            '</strong><small>' + look.note + '</small>'
        ));
        tr.appendChild(cell(plan.stalls ? 'Never' : monthsText(plan.months),
            plan.stalls ? 'is-minus' : 'is-strong'));
        tr.appendChild(cell(plan.stalls ? '—' : fmt(fromSen(plan.interestSen)),
            plan.stalls ? 'is-muted' : 'is-minus'));
        tr.appendChild(cell(plan.stalls ? '—' : fmt(fromSen(plan.paidSen)), 'is-muted'));

        // Measured against the minimum, which is the thing anyone is actually
        // choosing to stop doing.
        let saved = '—';
        let tone = 'is-muted';
        if (key !== 'minimum' && !plan.stalls) {
            if (base.stalls) { saved = 'The minimum never clears them'; }
            else {
                const diff = base.interestSen - plan.interestSen;
                const sooner = base.months - plan.months;
                saved = (diff > 0 ? '− ' : diff < 0 ? '+ ' : '') + fmt(Math.abs(fromSen(diff))) +
                    ' interest' + (sooner > 0 ? ', ' + monthsText(sooner) + ' sooner' : '');
                tone = diff > 0 ? 'is-plus' : diff < 0 ? 'is-minus' : 'is-muted';
            }
        }
        tr.appendChild(cell(saved, tone));
        body.appendChild(tr);
    });
}

function paintCardList(book) {
    const body = $('cardListBody');
    if (!body) return;
    body.innerHTML = '';

    const rows = cardState.filter === 'all'
        ? book.figures
        : book.figures.filter((f) => !f.card.closed);

    set('cardListNote', book.figures.length
        ? book.figures.length + (book.figures.length === 1 ? ' card' : ' cards') + ' · ' +
          money(fromSen(book.debtSen)) + ' owed' +
          (book.limitSen ? ' of ' + money(fromSen(book.limitSen)) : '')
        : 'Nothing saved yet');

    if (!rows.length) {
        body.appendChild(emptyRow(cardState.filter === 'all'
            ? 'No cards yet. Fill in the form below and press Save card.'
            : 'No open cards. Switch to All to see the closed ones.', 8));
        return;
    }

    rows.forEach((f) => {
        const tr = document.createElement('tr');
        if (cardState.editing === f.card.id) tr.className = 'is-you';

        tr.appendChild(cell(
            '<strong>' + escapeHtml(cardName(f.card)) +
            (f.card.closed ? ' <span class="tag is-paid">closed</span>' : '') + '</strong>' +
            '<small>' + fmt(f.annualRate, 1) + '% a year</small>'
        ));
        tr.appendChild(cell(f.limitSen ? fmt(fromSen(f.limitSen)) : '—', 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(f.balanceSen)), f.balanceSen ? 'is-minus' : 'is-plus'));
        tr.appendChild(cell(f.limitSen ? fmt(fromSen(f.availableSen)) : '—', 'is-muted'));
        tr.appendChild(cell(f.limitSen ? pct(f.usedPct, 0) : '—',
            !f.limitSen ? 'is-muted' : 'is-' + cardUsedTone(f.usedPct)));
        tr.appendChild(cell(f.minimumSen ? fmt(fromSen(f.minimumSen)) : '—', 'is-strong'));
        tr.appendChild(cell(f.nextDue && f.balanceSen ? dayShort(f.nextDue) : '—', 'is-muted'));
        tr.appendChild(cell(
            '<button type="button" class="split-x" data-open-card="' + f.card.id + '" aria-label="Open card">' +
            '<i class="bi bi-pencil"></i></button>' +
            '<button type="button" class="split-x" data-drop-card="' + f.card.id + '" aria-label="Delete card">' +
            '<i class="bi bi-x-lg"></i></button>', 'row-actions'));
        body.appendChild(tr);
    });

    if (rows.length > 1) {
        const total = rows.filter((f) => !f.card.closed);
        const tr = document.createElement('tr');
        tr.className = 'total-row';
        tr.appendChild(cell('All open cards'));
        tr.appendChild(cell(fmt(fromSen(total.reduce((s, f) => s + f.limitSen, 0)))));
        tr.appendChild(cell(fmt(fromSen(total.reduce((s, f) => s + f.balanceSen, 0)))));
        tr.appendChild(cell(fmt(fromSen(total.reduce((s, f) => s + f.availableSen, 0)))));
        const limit = total.reduce((s, f) => s + f.limitSen, 0);
        const owed  = total.reduce((s, f) => s + f.balanceSen, 0);
        tr.appendChild(cell(limit ? pct(owed / limit * 100, 0) : '—'));
        tr.appendChild(cell(fmt(fromSen(total.reduce((s, f) => s + f.minimumSen, 0)))));
        tr.appendChild(cell(''));
        tr.appendChild(cell(''));
        body.appendChild(tr);
    }
}

/** Under 30% is the figure the credit bureaus reward; over 90% is trouble. */
const cardUsedTone = (used) => (used > 90 ? 'red' : used >= 30 ? 'amber' : 'jade');

function paintCardForm(book) {
    const f = book.draft;
    const card = f.card;

    set('cardFormTitle', card.id ? 'Editing ' + cardName(card) : 'New card');

    const pill = $('cardState');
    if (pill) {
        pill.dataset.state = !card.id ? 'draft' : card.closed ? 'dirty' : 'saved';
        pill.textContent = !card.id ? 'Draft' : card.closed ? 'Closed' : 'Saved';
    }

    const save = $('cardSave');
    if (save) save.innerHTML = '<i class="bi bi-check-lg"></i> ' + (card.id ? 'Update card' : 'Save card');

    const fresh = $('cardNew');
    if (fresh) fresh.hidden = !card.id;

    const close = $('cardClose');
    if (close) {
        close.hidden = !card.id;
        close.innerHTML = card.closed
            ? '<i class="bi bi-arrow-counterclockwise"></i> Re-open this card'
            : '<i class="bi bi-archive"></i> Close this card';
    }

    set('cardDueHint', f.nextDue && card.dueDay
        ? 'Next one falls on ' + dayLabel(f.nextDue) + '.'
        : 'Day of the month.');

    const auto = $('cardAuto');
    set('cardLinkSummary', !auto || !auto.checked ? 'Off'
        : !card.account ? 'No account set'
        : (accountById(card.account) || {}).name || 'On');
}

function paintCardPayments(book) {
    const f = book.draft;
    const card = f.card;
    const host = $('cardPayList');
    const add = $('cardPayAdd');
    if (!host) return;

    set('cardPaymentsTitle', card.id ? 'Payments — ' + cardName(card) : 'Payments');
    if (add) add.hidden = !card.id;

    const bar = $('cardProgressBar');
    if (bar) {
        bar.style.width = f.progress + '%';
        bar.className = f.balanceSen <= 0 && f.paidSen > 0 ? 'is-done' : '';
    }

    set('cardPaymentsNote', card.id
        ? card.payments.length + (card.payments.length === 1 ? ' payment logged' : ' payments logged')
        : 'Open a card to log its payments');

    set('cardProgressText', !card.id
        ? 'Save a card and every payment you make against it is kept here.'
        : !f.openingSen
            ? 'Put an outstanding figure on the card and progress starts counting.'
            : 'Started at ' + money(fromSen(f.openingSen)) + ' · paid ' + money(fromSen(f.paidSen)) +
              ' · ' + money(fromSen(f.balanceSen)) + ' still owed · ' +
              pct(f.progressRaw, 2) + ' cleared' +
              (f.progressRaw > 100 ? ' of what it started at — it has been used again since' : ''));

    host.innerHTML = '';
    if (!card.id) return;

    if (!card.payments.length) {
        host.innerHTML = '<p class="goal-log-empty">Nothing logged yet. Every payment here comes off the ' +
            'outstanding above, and is the honest answer to &ldquo;am I actually paying that much a month?&rdquo;</p>';
        return;
    }

    card.payments
        .slice()
        .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1)))
        .forEach((p) => {
            const row = document.createElement('div');
            row.className = 'goal-c';
            row.dataset.payment = p.id;
            row.innerHTML =
                '<span class="goal-c-when">' + dayLabel(p.date) + '</span>' +
                '<span class="goal-c-what">' + (p.note ? escapeHtml(p.note) : '<i>No note</i>') +
                    (p.entryId ? ' · in Expenses' : '') + '</span>' +
                '<b>' + money(fromSen(Math.max(0, toSen(parseFloat(p.amount) || 0)))) + '</b>' +
                '<button type="button" class="split-x" data-drop-payment aria-label="Remove payment">' +
                    '<i class="bi bi-x-lg"></i></button>';
            host.appendChild(row);
        });
}

function paintCardPlanTable(book) {
    const body = $('cardPlanBody');
    const block = $('cardScheduleCard');
    if (!body || !block) return;

    const plan = book.plan;
    block.hidden = !book.live.length || plan.stalls;
    body.innerHTML = '';
    if (block.hidden) return;

    const byMonth = book.view === 'month';
    set('cardScheduleHead', byMonth ? 'Month' : 'Year');
    set('cardScheduleNote', plan.rows.length + ' payments · ' +
        'last one ' + monthLabel(plan.rows.length - 1));

    const rows = byMonth
        ? plan.rows.map((row) => ({
            label: monthLabel(row.month - 1),
            paySen: row.paySen, interestSen: row.interestSen,
            principalSen: row.principalSen, balanceSen: row.balanceSen,
        }))
        : cardYearRows(plan.rows).map((row) => ({
            label: 'Year ' + row.year + (row.months < 12 ? ' · ' + row.months + ' mo' : ''),
            paySen: row.paySen, interestSen: row.interestSen,
            principalSen: row.principalSen, balanceSen: row.balanceSen,
        }));

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.appendChild(cell('<strong>' + row.label + '</strong>'));
        tr.appendChild(cell(fmt(fromSen(row.paySen))));
        tr.appendChild(cell(fmt(fromSen(row.interestSen)), 'is-minus'));
        tr.appendChild(cell(fmt(fromSen(row.principalSen)), 'is-plus'));
        tr.appendChild(cell(fmt(fromSen(row.balanceSen)), 'is-strong'));
        body.appendChild(tr);
    });

    const total = document.createElement('tr');
    total.className = 'total-row';
    total.appendChild(cell('Altogether'));
    total.appendChild(cell(fmt(fromSen(plan.paidSen))));
    total.appendChild(cell(fmt(fromSen(plan.interestSen))));
    total.appendChild(cell(fmt(fromSen(plan.paidSen - plan.interestSen))));
    total.appendChild(cell('0.00'));
    body.appendChild(total);
}

function paintCard(book) {
    const plan = book.plan;

    // --- hero ---
    set('cardMonths', plan.stalls ? 'Never' : !book.debtSen ? '—' : monthsText(plan.months));
    set('cardMonthsFoot', !book.debtSen ? 'No card debt on the books'
        : plan.short ? money(fromSen(plan.shortSen)) + ' short of the minimums'
        : plan.stalls ? 'This payment never clears them'
        : 'Clear by ' + monthLabel(plan.months - 1));

    set('cardTotalDebt', money(fromSen(book.debtSen)));
    set('cardTotalDebtFoot', book.limitSen
        ? pct(book.debtSen / book.limitSen * 100, 0) + ' of ' + money(fromSen(book.limitSen)) + ' in limits'
        : book.live.length + (book.live.length === 1 ? ' card' : ' cards') + ' with a balance');

    set('cardInterest', plan.stalls ? '—' : money(fromSen(plan.interestSen)));
    set('cardInterestFoot', plan.stalls || !book.debtSen ? 'Nothing to work out yet'
        : pct(plan.interestSen / Math.max(1, plan.startSen) * 100, 0) + ' on top of what you owe');

    // --- the plan card ---
    set('cardPlanNote', !book.debtSen ? 'Add a card to get started'
        : book.onMinimum ? 'Paying the minimum: ' + money(fromSen(book.minimumSen)) + ' this month'
        : money(fromSen(book.spendSen)) + ' a month, ' +
          CARD_STRATEGIES[book.strategy].label.toLowerCase());

    set('cardPaymentHint', book.minimumSen
        ? 'The minimums come to ' + money(fromSen(book.minimumSen)) + ' this month. Leave it empty to see what paying only those costs.'
        : 'Leave it empty to see what paying only the minimums costs.');

    const notice = $('cardNotice');
    if (notice) {
        notice.hidden = !plan.stalls || !book.debtSen;
        set('cardNoticeText', plan.short
            ? money(fromSen(book.spendSen)) + ' does not cover the minimums, which come to ' +
              money(fromSen(plan.needSen)) + ' this month — ' + money(fromSen(plan.shortSen)) +
              ' short. Nothing here is a plan until it does.'
            : 'At this payment the interest swallows everything and the balance never falls. ' +
              'It needs more than ' + money(fromSen(book.live.reduce((s, c) => s + c.interestSen, 0))) +
              ' a month just to stand still.');
    }

    set('cardTallyDate', plan.stalls || !book.debtSen ? '—' : monthLabel(plan.months - 1));
    set('cardTallyInterest', plan.stalls ? '—' : money(fromSen(plan.interestSen)));
    set('cardTallyMin', money(fromSen(book.minimumSen)));
    set('cardTallyPaid', plan.stalls ? '—' : money(fromSen(plan.paidSen)));

    paintCardDist(book);
    paintCardOrder(book);
    paintCardCompare(book);
    paintCardList(book);
    paintCardForm(book);
    paintCardPayments(book);
    paintCardPlanTable(book);
}

function cardSummaryText() {
    const book = cardCompute();
    if (!book.live.length) return 'No cards with a balance yet.';

    const lines = ['Credit cards — ' + money(fromSen(book.debtSen)) + ' owed across ' +
        book.live.length + (book.live.length === 1 ? ' card' : ' cards')];

    book.live.forEach((f) => {
        lines.push('  ' + cardName(f.card) + ': ' + money(fromSen(f.balanceSen)) +
            ' at ' + fmt(f.annualRate, 1) + '%, minimum ' + money(fromSen(f.minimumSen)) +
            (f.nextDue ? ', due ' + dayLabel(f.nextDue) : ''));
    });

    const plan = book.plan;
    lines.push(book.onMinimum
        ? 'Paying the minimums, ' + money(fromSen(book.minimumSen)) + ' a month:'
        : 'Paying ' + money(fromSen(book.spendSen)) + ' a month, ' +
          CARD_STRATEGIES[book.strategy].label.toLowerCase() + ':');

    if (plan.stalls) {
        lines.push(plan.short
            ? '  ' + money(fromSen(plan.shortSen)) + ' short of the minimums — no plan yet'
            : '  never clears — the interest swallows it');
    } else {
        lines.push('  cleared in ' + monthsText(plan.months) + ' (' + monthLabel(plan.months - 1) + ')');
        lines.push('  interest ' + money(fromSen(plan.interestSen)) +
            ', paid altogether ' + money(fromSen(plan.paidSen)));
    }

    ['avalanche', 'snowball'].forEach((key) => {
        const other = book.plans[key];
        if (other.stalls || book.onMinimum) return;
        lines.push('  ' + CARD_STRATEGIES[key].label + ': ' + monthsText(other.months) +
            ', ' + money(fromSen(other.interestSen)) + ' interest');
    });

    return lines.join('\n');
}

function renderCard() {
    readCardForm();
    paintCard(cardCompute());
    saveCard();
}

/**
 * --------------------------------------------------------------------
 * Persistence
 * --------------------------------------------------------------------
 */
function saveCard() {
    try {
        storeWrite(CARD_KEY, JSON.stringify({
            version: 2,
            seq: cardState.seq,
            filter: cardState.filter,
            editing: cardState.editing,
            payment: ($('cardPayment') || {}).value || '',
            strategy: (($('cardStrategy') || {}).dataset || {}).value || 'avalanche',
            view: (($('cardView') || {}).dataset || {}).value || 'year',
            cards: cardState.cards,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

function loadCard() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(CARD_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') { cardState.draft = newCard(); return; }

    if (saved.version !== 2) { migrateCardV1(saved); return; }

    cardState.seq = Number(saved.seq) || 0;
    cardState.filter = saved.filter === 'all' ? 'all' : 'open';

    cardState.cards = (Array.isArray(saved.cards) ? saved.cards : [])
        .filter((c) => c && c.id)
        .map((c) => ({
            id: String(c.id),
            seq: Number(c.seq) || 0,
            name: String(c.name || ''),
            limit: String(c.limit || ''),
            opening: String(c.opening || ''),
            balance: String(c.balance || ''),
            rate: String(c.rate || '18'),
            minPct: String(c.minPct || '5'),
            minFloor: String(c.minFloor || '25'),
            dueDay: String(c.dueDay || ''),
            autoRecord: c.autoRecord !== false,
            account: String(c.account || ''),
            category: String(c.category || ''),
            closed: !!c.closed,
            payments: (Array.isArray(c.payments) ? c.payments : [])
                .filter((p) => p && p.id && /^\d{4}-\d{2}-\d{2}$/.test(p.date || ''))
                .map((p) => ({
                    id: String(p.id), date: p.date,
                    amount: String(p.amount || ''), note: String(p.note || ''),
                    entryId: String(p.entryId || ''),
                })),
            created: String(c.created || ''),
            updated: String(c.updated || ''),
        }));

    // An entry the ledger no longer holds is not a link.
    const entryIds = new Set(ledgerState.entries.map((e) => e.id));
    cardState.cards.forEach((c) => c.payments.forEach((p) => {
        if (p.entryId && !entryIds.has(p.entryId)) p.entryId = '';
    }));

    cardState.cards.forEach((c) => { cardState.seq = Math.max(cardState.seq, c.seq); });

    if ($('cardPayment')) $('cardPayment').value = String(saved.payment || '');
    if ($('cardStrategy') && ['avalanche', 'snowball'].includes(saved.strategy)) {
        setSegment($('cardStrategy'), saved.strategy);
    }
    if ($('cardView') && ['year', 'month'].includes(saved.view)) setSegment($('cardView'), saved.view);

    const open = cardState.cards.find((c) => c.id === saved.editing);
    cardState.draft = open || newCard();
    cardState.editing = open ? open.id : null;
}

/**
 * The shape before there were cards: one balance, one rate, one minimum, all
 * read straight off the form. It becomes a single saved card, because that is
 * what it was — and the payment field carries over as the budget, since a
 * one-card budget is still a budget.
 */
function migrateCardV1(saved) {
    const balance = String(saved.balance || '');
    const hasCard = Math.max(0, toSen(parseFloat(balance) || 0)) > 0;

    if (hasCard) {
        cardState.seq = 1;
        cardState.cards = [{
            id: 'cc1', seq: 1,
            name: 'My card',
            limit: '', opening: balance, balance,
            rate: String(saved.rate || '18'),
            minPct: String(saved.minPct || '5'),
            minFloor: String(saved.minFloor || '25'),
            dueDay: '',
            autoRecord: true, account: '', category: '',
            closed: false, payments: [],
            created: todayIso(), updated: todayIso(),
        }];
        cardState.editing = 'cc1';
        cardState.draft = cardState.cards[0];
    } else {
        cardState.draft = newCard();
    }

    if ($('cardPayment')) $('cardPayment').value = String(saved.payment || '');
    if ($('cardView') && ['year', 'month'].includes(saved.view)) setSegment($('cardView'), saved.view);
    saveCard();
}


/**
 * ====================================================================
 * SAVINGS & INVESTMENT
 * ====================================================================
 * Two questions. What proportion of what came in is still yours at the end of
 * the month, and what is everything you put away actually worth.
 *
 * --------------------------------------------------------------------
 * The savings half holds no records of its own
 * --------------------------------------------------------------------
 * This is the decision the module turns on. Three places already record money
 * being set aside — the ledger's `save` bucket, the Planner's goal
 * contributions, and this module's investment contributions — and they are
 * disjoint **by construction**, because goal and investment contributions
 * deliberately never write a ledger entry. So they can simply be added, and
 * the breakdown says which is which rather than presenting one figure nobody
 * can check.
 *
 * A fourth savings store here would have been a second version of the truth,
 * which is the one thing this app refuses to keep.
 */
const GROW_KEY = 'moneyflow.grow.v1';

/* What a browser starts with. The list is the reader's after that: kinds are
   added, renamed and removed on the investment form, and the live list is
   saved with the holdings. A holding points at the kind's id, never at its
   wording, so renaming one touches nothing else.

   'fd' is the one id the app knows by name — it is what opens the fixed
   deposit projection. Renaming it keeps that; removing it only takes away a
   wording nothing was using. */
const DEFAULT_INVESTMENT_TYPES = [
    { id: 'asb',   label: 'ASB / ASNB',   icon: 'bi-flower1' },
    { id: 'epf',   label: 'EPF / KWSP',   icon: 'bi-bank' },
    { id: 'fd',    label: 'Fixed deposit', icon: 'bi-safe' },
    { id: 'stock', label: 'Stocks',       icon: 'bi-graph-up' },
    { id: 'etf',   label: 'ETF',          icon: 'bi-boxes' },
    { id: 'unit',  label: 'Unit trust',   icon: 'bi-pie-chart' },
    { id: 'gold',  label: 'Gold',         icon: 'bi-gem' },
    { id: 'other', label: 'Something else', icon: 'bi-three-dots' },
];

/* The last option in the Type picker: a way into the editor, never a kind. */
const INV_TYPE_EDIT = '__edit_inv_types__';

/* A kind the reader adds needs a face. Clicking it walks this list, which is
   short on purpose — enough to tell one row from another at a glance, not a
   whole icon library to browse. */
const INVESTMENT_ICONS = [
    'bi-piggy-bank', 'bi-flower1', 'bi-bank', 'bi-safe', 'bi-graph-up', 'bi-boxes',
    'bi-pie-chart', 'bi-gem', 'bi-cash-coin', 'bi-house', 'bi-shield-check', 'bi-three-dots',
];

const investmentType = (id) =>
    growState.types.find((t) => t.id === id) ||
    growState.types[growState.types.length - 1] ||
    DEFAULT_INVESTMENT_TYPES[DEFAULT_INVESTMENT_TYPES.length - 1];

/** What a new holding is, until it is told otherwise. */
const defaultInvestmentTypeId = () => (growState.types[0] || {}).id || 'asb';

let growState = {
    investments: [], draft: null, editing: null, seq: 0, filter: 'open',
    types: DEFAULT_INVESTMENT_TYPES.map((t) => ({ ...t })),
    target: { value: '', unit: 'pct' },
};

const newInvestment = () => ({
    id: '', seq: 0,
    name: '', type: defaultInvestmentTypeId(),
    opened: todayIso(),
    opening: '',
    source: '',
    value: '', valueDate: todayIso(),
    note: '', closed: false,
    fd: { rate: '', months: '' },
    grow: { monthly: '', rate: '', years: '' },
    contributions: [],
    earnings: [],
});

const growDraft = () => growState.draft || (growState.draft = newInvestment());
const investmentById = (id) => growState.investments.find((i) => i.id === id) || null;
const investmentName = (inv) => (inv.name || '').trim() || 'Untitled investment';

/**
 * --------------------------------------------------------------------
 * A figure in ringgit, or a percentage of something
 * --------------------------------------------------------------------
 * EPF is 11% of salary; a savings target is as often "20% of what I earn" as
 * it is "RM1,000". So both carry a unit, and nothing is stored resolved — the
 * unit, the figure and the base are kept, and the ringgit is worked out at
 * read time. A stored ringgit would go stale the moment the base changed.
 */
const unitSen = (figure, unit, baseSen) => {
    const n = Math.max(0, parseFloat(figure) || 0);
    if (!n) return 0;
    return unit === 'pct' ? Math.round(baseSen * n / 100) : toSen(n);
};

/** What the ledger says came in during a month. The default base for a
 *  percentage contribution, because "11% of salary" means that month's. */
function growIncomeIn(from, to) {
    return ledgerState.entries
        .filter((e) => e.type === 'income' && e.date >= from && e.date <= to)
        .reduce((sum, e) => sum + entrySen(e), 0);
}

const growMonthIncome = (iso) => {
    const [y, m] = isoNums(iso);
    if (!y || !m) return 0;
    return growIncomeIn(monthFirst(y, m), monthLast(y, m));
};

/**
 * One contribution, in sen.
 *
 * The unit, the figure and the base are all kept — the ringgit is worked out
 * from them and never stored. But the **base is captured when the
 * contribution is logged**, not looked up forever: "11% of my salary" is how
 * you worked the figure out on the day, not a standing formula. Leaving it to
 * follow the ledger meant editing an old income entry silently rewrote how
 * much you had put in three months ago, which is not something history should
 * do. The ledger only ever supplies the *default*, at the moment of typing.
 */
function contribSen(c) {
    if (c.unit !== 'pct') return unitSen(c.figure, 'rm', 0);
    return unitSen(c.figure, 'pct', contribBaseSen(c));
}

const contribBaseSen = (c) => Math.max(0, toSen(parseFloat(c.base) || 0));

/**
 * --------------------------------------------------------------------
 * Money the ledger already recorded
 * --------------------------------------------------------------------
 * The app's own rule is record once, analyze many times — and a monthly EPF
 * top-up is already an entry in Expenses. Typing it here as well would be two
 * versions of the same money, and they would drift the first time one was
 * corrected.
 *
 * So a holding can name a spending category instead: every expense filed
 * under it is money into this holding, read straight from the ledger. The
 * rows are not editable here, because the record is over there.
 */
const linkedEntries = (inv) => (inv.source
    ? ledgerState.entries.filter((e) => isSpend(e) && e.category === inv.source)
    : []);

const linkedSen = (inv) => linkedEntries(inv).reduce((sum, e) => sum + spendSen(e), 0);

/**
 * --------------------------------------------------------------------
 * What a holding paid out
 * --------------------------------------------------------------------
 * An ASNB dividend and an EPF crediting are not money you put in — they are
 * what the money did while it sat there. Filing one as a contribution would
 * say you saved it, inflate what you put in, and hide the return behind it.
 * So they are their own list: they never count towards savings, and they are
 * already inside the profit, because a payout is credited into the holding
 * and so raises what it is worth.
 *
 * The declared rate is kept beside the ringgit because that is how these are
 * announced and remembered — "5.75% for 2024" — but nothing is worked out
 * from it. The amount is the record; the rate is a note.
 */
const earningSen = (e) => Math.max(0, toSen(parseFloat(e.figure) || 0));

const investmentEarnedSen = (inv) =>
    (inv.earnings || []).reduce((sum, e) => sum + earningSen(e), 0);

/** Payouts by calendar year, newest first — the way a dividend is reviewed. */
function earningYears(inv) {
    const years = new Map();
    (inv.earnings || []).forEach((e) => {
        const year = String(e.date).slice(0, 4);
        if (!years.has(year)) years.set(year, { year, rows: [], totalSen: 0 });
        const held = years.get(year);
        held.rows.push(e);
        held.totalSen += earningSen(e);
    });

    return [...years.values()]
        .sort((a, b) => (a.year < b.year ? 1 : -1))
        .map((y) => ({ ...y, rows: y.rows.slice().sort((a, b) => (a.date === b.date
            ? (a.id < b.id ? 1 : -1)
            : (a.date < b.date ? 1 : -1))) }));
}

/**
 * --------------------------------------------------------------------
 * One investment
 * --------------------------------------------------------------------
 */
function investmentFigures(inv) {
    // Nobody starts tracking on the day they opened an EPF account. What was
    // already in it is money put in — it is just not money put in *this*
    // month, so it never reaches the savings figures, which only ever read
    // contributions. Without it, a holding with a balance and no history
    // reads as pure profit: RM 50,000 put in as "worth now" against RM 0 in.
    const openingSen = Math.max(0, toSen(parseFloat(inv.opening) || 0));
    const manualSen = inv.contributions.reduce((sum, c) => sum + contribSen(c), 0);
    const fromLedgerSen = linkedSen(inv);
    const contributedSen = manualSen + fromLedgerSen;
    const investedSen = openingSen + contributedSen;

    // An empty "worth now" means it is worth what went in — which is true of a
    // fixed deposit on day one, and the least misleading thing to assume.
    const typedValue = String(inv.value || '').trim();
    const valueSen = typedValue === '' ? investedSen : Math.max(0, toSen(parseFloat(inv.value) || 0));

    const profitSen = valueSen - investedSen;

    return {
        inv, investedSen, openingSen, contributedSen, manualSen, fromLedgerSen, valueSen, profitSen,
        earnedSen: investmentEarnedSen(inv),
        valued: typedValue !== '',
        returnPct: investedSen > 0 ? profitSen / investedSen * 100 : 0,
        live: !inv.closed,
        type: investmentType(inv.type),
    };
}

/**
 * A Malaysian fixed deposit pays simple interest at maturity, not monthly —
 * the linked calculator does not say what it does, so this says what it does.
 * A tenure over a year is what a rolled-over placement is: successive one-year
 * terms that compound, then a part-year at simple interest.
 */
function fdProjection(principalSen, ratePct, months) {
    const rate = Math.max(0, parseFloat(ratePct) || 0) / 100;
    const term = Math.max(0, Math.floor(parseFloat(months) || 0));
    if (!principalSen || !rate || !term) return null;

    const years = Math.floor(term / 12);
    const rest  = term % 12;

    let value = principalSen;
    for (let y = 0; y < years; y++) value += Math.round(value * rate);
    if (rest) value += Math.round(value * rate * rest / 12);

    return {
        principalSen, ratePct: Math.max(0, parseFloat(ratePct) || 0), months: term,
        maturitySen: value, interestSen: value - principalSen,
        rolled: years >= 1 && term > 12,
    };
}

/**
 * Every ringgit that has gone into a holding, in date order — what it was
 * opened with, what has been paid in since, and what it has been paid.
 */
function investmentInflows(inv) {
    const rows = [];

    const openingSen = Math.max(0, toSen(parseFloat(inv.opening) || 0));
    if (openingSen) rows.push({ date: inv.opened || todayIso(), sen: openingSen });

    inv.contributions.forEach((c) => rows.push({ date: c.date, sen: contribSen(c) }));
    linkedEntries(inv).forEach((e) => rows.push({ date: e.date, sen: entrySen(e) }));
    (inv.earnings || []).forEach((e) => rows.push({ date: e.date, sen: earningSen(e) }));

    return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * What a declared rate comes to in ringgit.
 *
 * EPF and ASNB pay on the balance as it stood *through* the year, not on the
 * balance at the end of it — money paid in during November has earned two
 * months of dividend, not twelve. So this walks the year a month at a time
 * and takes a twelfth of the rate on the balance standing in each one.
 *
 * It is an arithmetic answer to "what does 5.75% come to", not a statement.
 * The figure it offers can be typed over.
 */
function dividendFromRate(inv, iso, ratePct) {
    const rate = Math.max(0, parseFloat(ratePct) || 0) / 100;
    const year = Number(String(iso || '').slice(0, 4));
    if (!rate || !year) return null;

    const rows = investmentInflows(inv);
    let balance = rows.filter((r) => r.date < isoOf(year, 1, 1)).reduce((sum, r) => sum + r.sen, 0);
    let sen = 0;

    for (let m = 1; m <= 12; m++) {
        const from = monthFirst(year, m);
        const to   = monthLast(year, m);
        balance += rows.filter((r) => r.date >= from && r.date <= to).reduce((sum, r) => sum + r.sen, 0);
        sen += balance * rate / 12;
    }

    return { sen: Math.round(sen), year, closingSen: balance, ratePct: Math.max(0, parseFloat(ratePct) || 0) };
}

/**
 * What a regular saver grows to.
 *
 * EPF and ASNB declare a rate once a year against the balance held, so this
 * compounds annually rather than monthly. Money paid in during the year has
 * only been there for part of it, so the year's top-ups are counted at half —
 * the standard approximation, and near enough for a figure whose real rate is
 * not announced until December.
 *
 * It is a projection. It fills the current value only when the button is
 * pressed, so what sits on the record stays something the reader chose.
 */
function growthProjection(startSen, monthlyRm, ratePct, years) {
    const monthlySen = Math.max(0, toSen(parseFloat(monthlyRm) || 0));
    const rate = Math.max(0, parseFloat(ratePct) || 0) / 100;
    const term = Math.max(0, Math.floor(parseFloat(years) || 0));
    if (!term || (!startSen && !monthlySen)) return null;

    let balance = startSen;
    let paidInSen = 0;

    for (let y = 0; y < term; y++) {
        const inYear = monthlySen * 12;
        balance += inYear + Math.round((balance + inYear / 2) * rate);
        paidInSen += inYear;
    }

    return {
        startSen, monthlySen, paidInSen, years: term,
        ratePct: Math.max(0, parseFloat(ratePct) || 0),
        endSen: balance,
        growthSen: balance - startSen - paidInSen,
    };
}

/**
 * --------------------------------------------------------------------
 * The savings half
 * --------------------------------------------------------------------
 */
/** Money the ledger says was set aside: expense entries filed under a category
 *  in the `save` bucket. That is the app's own definition of "still yours
 *  afterwards", so this module does not invent a second one. */
function growLedgerSavedIn(from, to) {
    return ledgerState.entries
        .filter((e) => {
            if (!isSpend(e) || e.date < from || e.date > to) return false;
            const cat = categoryOf(e);
            return cat && cat.bucket === 'save';
        })
        .reduce((sum, e) => sum + spendSen(e), 0);
}

const growGoalsSavedIn = (from, to) => goalState.list.reduce((sum, goal) =>
    sum + goal.contributions
        .filter((c) => c.date >= from && c.date <= to)
        .reduce((s, c) => s + Math.max(0, toSen(parseFloat(c.amount) || 0)), 0), 0);

/**
 * What went into investments in a period — and only once.
 *
 * A contribution typed here is this module's own record, so it is added. An
 * entry the holding takes from the ledger is not: if it is filed under a
 * savings category, `growLedgerSavedIn` has already counted it, and adding it
 * again would say the money was put away twice. Filed anywhere else the
 * ledger has *not* counted it as saving, so it is added here — which is what
 * keeps the total exact either way.
 *
 * Entries are counted once across all holdings, in case two of them are ever
 * fed by the same category.
 */
function growInvestedIn(from, to) {
    let sen = 0;
    const seen = new Set();

    growState.investments.forEach((inv) => {
        sen += inv.contributions
            .filter((c) => c.date >= from && c.date <= to)
            .reduce((s, c) => s + contribSen(c), 0);

        linkedEntries(inv)
            .filter((e) => e.date >= from && e.date <= to && !seen.has(e.id))
            .forEach((e) => {
                seen.add(e.id);
                const cat = categoryOf(e);
                if (!cat || cat.bucket !== 'save') sen += entrySen(e);
            });
    });

    return sen;
}

function growSavedIn(from, to) {
    const ledgerSen = growLedgerSavedIn(from, to);
    const goalsSen  = growGoalsSavedIn(from, to);
    const investSen = growInvestedIn(from, to);
    return { ledgerSen, goalsSen, investSen, totalSen: ledgerSen + goalsSen + investSen };
}

function growRange() {
    const which = (($('growPeriod') || {}).dataset || {}).value || 'month';
    const [y, m] = isoNums(todayIso());

    if (which === 'year') {
        return { from: isoOf(y, 1, 1), to: isoOf(y, 12, 31), label: String(y), months: 12 };
    }
    if (which === 'lastmonth') {
        const prev = new Date(y, m - 2, 1);
        const py = prev.getFullYear(), pm = prev.getMonth() + 1;
        return { from: monthFirst(py, pm), to: monthLast(py, pm), label: monthKeyLabel(isoOf(py, pm, 1).slice(0, 7)), months: 1 };
    }
    return { from: monthFirst(y, m), to: monthLast(y, m), label: monthKeyLabel(monthOf(todayIso())), months: 1 };
}

function growCompute() {
    const range  = growRange();
    const saved  = growSavedIn(range.from, range.to);
    const incomeSen = growIncomeIn(range.from, range.to);

    const target = growState.target;
    const targetSen = unitSen(target.value, target.unit, incomeSen);

    const figures = growState.investments.map(investmentFigures);
    const live = figures.filter((f) => f.live);

    // Twelve months back, this month last, so the trend reads left to right.
    const trend = [];
    const [ty, tm] = isoNums(todayIso());
    for (let back = 11; back >= 0; back--) {
        const when = new Date(ty, tm - 1 - back, 1);
        const y = when.getFullYear(), m = when.getMonth() + 1;
        const from = monthFirst(y, m), to = monthLast(y, m);
        const bit = growSavedIn(from, to);
        trend.push({
            key: isoOf(y, m, 1).slice(0, 7),
            label: MONTH_NAMES[m - 1],
            savedSen: bit.totalSen,
            incomeSen: growIncomeIn(from, to),
        });
    }

    return {
        range, saved, incomeSen, target, targetSen,
        rate: incomeSen > 0 ? saved.totalSen / incomeSen * 100 : 0,
        gapSen: saved.totalSen - targetSen,
        figures, live, trend,
        investedSen: live.reduce((sum, f) => sum + f.investedSen, 0),
        valueSen:    live.reduce((sum, f) => sum + f.valueSen, 0),
        profitSen:   live.reduce((sum, f) => sum + f.profitSen, 0),
        draft: investmentFigures(growDraft()),
    };
}

/** What every live investment is worth. The Dashboard asks by this name. */
const growTotalValueSen = () => growState.investments
    .filter((i) => !i.closed)
    .reduce((sum, i) => sum + investmentFigures(i).valueSen, 0);

/**
 * The two halves of what is in an investment: the part you put there, and the
 * part it made. They are kept apart because the Dashboard reports them as two
 * tiles that add up rather than as two overlapping totals — money you set
 * aside is savings, and what it earned on top is the return.
 *
 *     put in  = opening balance + every contribution
 *     gain    = worth now − put in, which is the dividends and the growth
 */
const growTotalInvestedSen = () => growState.investments
    .filter((i) => !i.closed)
    .reduce((sum, i) => sum + investmentFigures(i).investedSen, 0);

const growTotalGainSen = () => growState.investments
    .filter((i) => !i.closed)
    .reduce((sum, i) => sum + investmentFigures(i).profitSen, 0);

/**
 * --------------------------------------------------------------------
 * Form in, form out
 * --------------------------------------------------------------------
 */
function readGrowForm() {
    const inv = growDraft();
    inv.name      = ($('growName')      || {}).value || '';
    const picked  = ($('growType') || {}).value || '';
    if (picked && picked !== INV_TYPE_EDIT) inv.type = picked;
    inv.opened    = ($('growOpened')    || {}).value || inv.opened;
    inv.opening   = ($('growOpening')    || {}).value || '';
    inv.source    = ($('growSource')      || {}).value || '';
    inv.value     = ($('growValue')     || {}).value || '';
    inv.valueDate = ($('growValueDate') || {}).value || '';
    inv.note      = ($('growNote')      || {}).value || '';
    inv.fd = {
        rate:   ($('growFdRate')   || {}).value || '',
        months: ($('growFdMonths') || {}).value || '',
    };
    inv.grow = {
        monthly: ($('growProjMonthly') || {}).value || '',
        rate:    ($('growProjRate')    || {}).value || '',
        years:   ($('growProjYears')   || {}).value || '',
    };

    growState.target = {
        value: ($('growTarget') || {}).value || '',
        unit: (($('growTargetUnit') || {}).dataset || {}).value === 'rm' ? 'rm' : 'pct',
    };
}

function fillGrowForm() {
    const inv = growDraft();
    buildGrowTypes();
    if ($('growName'))      $('growName').value      = inv.name;
    if ($('growType'))      $('growType').value      = inv.type;
    if ($('growOpened'))    $('growOpened').value    = inv.opened;
    if ($('growOpening'))   $('growOpening').value   = inv.opening;
    buildGrowSources();
    if ($('growSource'))    $('growSource').value    = inv.source;
    if ($('growValue'))     $('growValue').value     = inv.value;
    if ($('growValueDate')) $('growValueDate').value = inv.valueDate;
    if ($('growNote'))      $('growNote').value      = inv.note;
    if ($('growFdRate'))    $('growFdRate').value    = inv.fd.rate;
    if ($('growFdMonths'))  $('growFdMonths').value  = inv.fd.months;
    if ($('growProjMonthly')) $('growProjMonthly').value = inv.grow.monthly;
    if ($('growProjRate'))    $('growProjRate').value    = inv.grow.rate;
    if ($('growProjYears'))   $('growProjYears').value   = inv.grow.years;

    if ($('growTarget')) $('growTarget').value = growState.target.value;
    if ($('growTargetUnit')) setSegment($('growTargetUnit'), growState.target.unit);
    if ($('growCDate')) $('growCDate').value = todayIso();
    if ($('growEDate')) $('growEDate').value = todayIso();
}

function buildGrowTypes() {
    const select = $('growType');
    if (!select) return;

    // Rebuilt rather than built once: the list is editable now, and a picker
    // that was filled at startup would still be offering a kind that is gone.
    const chosen = select.value && select.value !== INV_TYPE_EDIT ? select.value : '';
    select.innerHTML = '';

    growState.types.filter((t) => t.label.trim()).forEach((t) => {
        const option = document.createElement('option');
        option.value = t.id;
        // The wording is user-typed, so it is set as text rather than markup.
        option.textContent = t.label;
        select.appendChild(option);
    });

    const edit = document.createElement('option');
    edit.value = INV_TYPE_EDIT;
    edit.textContent = 'Edit types\u2026';
    select.appendChild(edit);

    if (chosen && growState.types.some((t) => t.id === chosen)) select.value = chosen;
}

/**
 * --------------------------------------------------------------------
 * Kinds of investment
 * --------------------------------------------------------------------
 * The same bargain the Accounts card's kinds get, for the same reasons. A
 * holding is always one of these, so the list can never be emptied and a kind
 * with holdings behind it is not removed out from under them. Renaming is
 * free: a holding points at the id.
 */
const invTypeById = (id) => growState.types.find((t) => t.id === id) || null;

function buildInvTypeRows() {
    const host = $('growTypes');
    if (!host) return;
    host.innerHTML = '';

    growState.types.forEach((type, index) => {
        const held = growState.investments.filter((i) => i.type === type.id).length;

        const row = document.createElement('div');
        row.className = 'purpose-row is-icon';
        row.dataset.type = type.id;
        row.innerHTML =
            '<button type="button" class="type-icon" data-cycle-icon title="Click for another icon" ' +
                'aria-label="Change the icon"><i class="bi ' + escapeHtml(type.icon) + '"></i></button>' +
            '<input type="text" class="inv-type-name" placeholder="Kind ' + (index + 1) +
                '" aria-label="Name of this kind of investment">' +
            '<small>' + (held ? held + (held === 1 ? ' holding' : ' holdings') : 'unused') + '</small>' +
            '<button type="button" class="split-x" data-drop-inv-type aria-label="Remove kind">' +
                '<i class="bi bi-x-lg"></i></button>';

        // Assigned rather than interpolated — the wording is user-typed.
        row.querySelector('.inv-type-name').value = type.label;
        host.appendChild(row);
    });
}

/** Everything that shows a kind, after the list has moved under it. */
function afterInvTypeChange() {
    const inv = growDraft();
    buildGrowTypes();
    if ($('growType')) $('growType').value = investmentType(inv.type).id;
    buildInvTypeRows();
    saveGrow();
    renderGrow();
    renderDash();
}

function invTypeEditor(open) {
    const panel = $('growTypeEdit');
    if (!panel) return;
    const show = open === undefined ? panel.hidden : open;

    panel.hidden = !show;
    const button = $('growEditTypes');
    if (button) button.setAttribute('aria-expanded', String(show));
    if (show) buildInvTypeRows();
}

function addInvType() {
    readGrowForm();
    growState.types.push({ id: 'it' + (++growState.seq), label: '', icon: 'bi-piggy-bank' });
    buildInvTypeRows();

    const fresh = document.querySelector('#growTypes .purpose-row:last-child .inv-type-name');
    if (fresh) {
        reveal(fresh).focus({ preventScroll: true });
        fresh.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function renameInvType(input) {
    const row  = input.closest('.purpose-row');
    const type = invTypeById(row.dataset.type);
    if (!type) return;

    const name = input.value.trim();

    if (!name) {
        // Never named: the Add was abandoned. Named once: emptying the box is
        // not how a kind is removed.
        if (!type.label) {
            growState.types = growState.types.filter((t) => t.id !== type.id);
            buildInvTypeRows();
            return;
        }
        input.value = type.label;
        growHint('A kind needs a name — use the ✕ to remove one.');
        return;
    }

    if (growState.types.some((t) => t.id !== type.id && t.label.toLowerCase() === name.toLowerCase())) {
        input.value = type.label;
        growHint('There is already a kind called “' + name + '”.');
        return;
    }

    if (name === type.label) { input.value = name; return; }

    readGrowForm();
    type.label = name;
    afterInvTypeChange();
}

function cycleInvTypeIcon(row) {
    const type = invTypeById(row.dataset.type);
    if (!type) return;

    const at = INVESTMENT_ICONS.indexOf(type.icon);
    type.icon = INVESTMENT_ICONS[(at + 1) % INVESTMENT_ICONS.length];

    // The row is not rebuilt: a name half-typed beside it would go with it.
    const icon = row.querySelector('.type-icon i');
    if (icon) icon.className = 'bi ' + type.icon;
    saveGrow();
    renderGrow();
}

/**
 * A kind with holdings filed under it does not go: removing it would move
 * their figures into a kind the reader never chose. It stays until they are
 * moved, and the row says so rather than failing quietly.
 */
function dropInvType(row) {
    const type = invTypeById(row.dataset.type);
    if (!type) return;

    readGrowForm();
    const held = growState.investments.filter((i) => i.type === type.id).length;

    if (held || growState.types.length <= 1) {
        row.classList.add('is-locked');
        setTimeout(() => row.classList.remove('is-locked'), 1400);
        growHint(held
            ? held + (held === 1 ? ' holding is' : ' holdings are') + ' that kind — move ' +
              (held === 1 ? 'it' : 'them') + ' to another kind first.'
            : 'Keep at least one kind — an investment has to be something.');
        return;
    }

    growState.types = growState.types.filter((t) => t.id !== type.id);
    afterInvTypeChange();
    growHint('“' + type.label + '” is gone.');
}

/** The last option in the Type picker asks for the editor, not for a kind. */
function onInvTypePick() {
    const select = $('growType');
    if (!select || select.value !== INV_TYPE_EDIT) return;

    select.value = investmentType(growDraft().type).id;
    invTypeEditor(true);

    const panel = $('growTypeEdit');
    if (panel) reveal(panel).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * What to fill in, for the kind of thing being recorded. A form of general
 * fields cannot say what an EPF account wants in them; this can.
 */
function growGuideLines(type) {
    if (type === 'fd') {
        return [
            ['Started', 'the day you placed it'],
            ['Opening balance', 'what you placed'],
            ['Worth now', 'leave it empty — the projection below works out the maturity'],
            ['Fixed deposit projection', 'the rate and how many months, then press the button'],
        ];
    }

    if (type === 'epf' || type === 'asb') {
        const who = type === 'epf' ? 'EPF' : 'ASNB';
        return [
            ['Opening balance', 'what your latest ' + who + ' statement says, with Started as the date it is from'],
            ['Fed from', 'the Expenses category you file top-ups under — they are then read from there, ' +
                'so you never type them twice'],
            ['Worth now', 'update it whenever a statement arrives; it is the only figure the app cannot work out'],
            ['Dividends & interest', 'when ' + who + ' announce the rate, put the rate in and leave the amount ' +
                'empty — the ringgit is worked out from the balance you held that year'],
        ];
    }

    return [
        ['Opening balance', 'what it already held the day you started tracking it'],
        ['Worth now', "today's balance, from wherever you can read it. Empty means worth exactly what went in"],
        ['Contributions', 'every top-up — or name a category under Fed from and they come from Expenses'],
        ['Dividends & interest', 'anything it paid you, which is counted as return rather than as saving'],
    ];
}

function paintGrowGuide(inv) {
    const host = $('growGuide');
    if (!host) return;

    const type = investmentType(inv.type);
    host.innerHTML =
        '<h3><i class="bi bi-lightbulb"></i> What to fill in for ' + escapeHtml(type.label) + '</h3>' +
        '<ul>' + growGuideLines(inv.type).map(([field, what]) =>
            '<li><b>' + escapeHtml(field) + '</b> — ' + escapeHtml(what) + '</li>').join('') + '</ul>';
}

/**
 * The categories a holding can be fed from. Spending categories only — money
 * going into an investment leaves an account, so it is an expense in the
 * ledger's terms even though it is not spending in anyone else's.
 */
function buildGrowSources() {
    const select = $('growSource');
    if (!select) return;
    const chosen = select.value;

    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Nothing — I log contributions here';
    select.appendChild(none);

    categoryState.list
        .filter((cat) => cat.bucket !== 'income')
        .forEach((cat, index) => {
            const option = document.createElement('option');
            option.value = cat.id;
            // Labels are user-typed, so they are set as text rather than markup.
            option.textContent = categoryLabel(cat, index) + ' · ' + CATEGORY_BUCKETS[cat.bucket];
            select.appendChild(option);
        });

    if (chosen && categoryState.list.some((c) => c.id === chosen)) select.value = chosen;
}

const growHint = (text) => {
    const hint = $('growSaveHint');
    if (!hint) return;
    hint.innerHTML = '<i class="bi bi-info-circle"></i> ' + escapeHtml(text);
    clearTimeout(growHint.timer);
    growHint.timer = setTimeout(() => {
        hint.innerHTML = '<i class="bi bi-hdd"></i> Saved on this device only — nothing leaves your browser.';
    }, 6000);
};

/**
 * --------------------------------------------------------------------
 * Saving
 * --------------------------------------------------------------------
 */
function growSaveInvestment() {
    readGrowForm();
    const inv = growDraft();
    if (!inv.name.trim()) { growHint('Give it a name — "ASB", "EPF", something you will recognise.'); return; }

    if (!inv.id) {
        inv.id = 'iv' + (++growState.seq);
        inv.seq = growState.seq;
        growState.investments.push(inv);
        growState.editing = inv.id;
    } else {
        const at = growState.investments.findIndex((i) => i.id === inv.id);
        if (at >= 0) growState.investments[at] = inv;
    }

    saveGrow();
    renderGrow();
    renderDash();
    flashButton($('growSave'), '<i class="bi bi-check-lg"></i> Saved');
}

function growOpenInvestment(id) {
    const inv = investmentById(id);
    if (!inv) return;
    growState.draft = inv;
    growState.editing = inv.id;
    fillGrowForm();
    renderGrow();
    const form = $('grow-form');
    if (form) reveal(form).scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function growNewInvestment() {
    growState.draft = newInvestment();
    growState.editing = null;
    fillGrowForm();
    renderGrow();
}

function growToggleClosed() {
    const inv = growDraft();
    if (!inv.id) return;

    if (inv.closed) {
        inv.closed = false;
        saveGrow(); renderGrow(); renderDash();
        return;
    }
    askConfirm(
        'Close ' + investmentName(inv) + '?',
        'It drops out of what your investments are worth and out of the savings figures from here on. ' +
        'Every contribution already logged stays exactly as it is.',
        'Close it',
        () => { inv.closed = true; saveGrow(); renderGrow(); renderDash(); });
}

function growDropInvestment(id) {
    const inv = investmentById(id);
    if (!inv) return;
    askConfirm(
        'Delete ' + investmentName(inv) + '?',
        'It and its ' + inv.contributions.length +
        (inv.contributions.length === 1 ? ' contribution go' : ' contributions go') + ' for good, ' +
        'and the savings figures for those months change with them. To take it out of the totals ' +
        'without losing it, close it instead.',
        'Delete it',
        () => {
            growState.investments = growState.investments.filter((i) => i.id !== id);
            if (growState.editing === id) growNewInvestment();
            saveGrow(); renderGrow(); renderDash();
        });
}

/**
 * --------------------------------------------------------------------
 * Contributions
 * --------------------------------------------------------------------
 */
function growAddContribution() {
    readGrowForm();
    const inv = growDraft();
    if (!inv.id) { growHint('Save the investment first — a contribution has to go into something.'); return; }

    const unit = (($('growCUnit') || {}).dataset || {}).value === 'pct' ? 'pct' : 'rm';
    const figure = ($('growCFigure') || {}).value || '';
    if (!(parseFloat(figure) > 0)) { if ($('growCFigure')) $('growCFigure').focus(); return; }

    const when = ($('growCDate') || {}).value || todayIso();
    // Whatever the base is at this moment is written down with it. The ledger
    // is only the default; from here on the record stands on its own.
    const typedBase = Math.max(0, toSen(parseFloat(($('growCBase') || {}).value || '') || 0));
    const baseSen = unit === 'pct' ? (typedBase || growMonthIncome(when)) : 0;

    if (unit === 'pct' && !baseSen) {
        growHint('There is no income recorded for that month, so a percentage has nothing to be a ' +
            'percentage of — put the figure it is a share of in the box beside it.');
        return;
    }

    const contribution = {
        id: 'ic' + (++growState.seq),
        date: when,
        unit,
        figure: String(figure),
        base: unit === 'pct' ? String(fromSen(baseSen)) : '',
        note: (($('growCNote') || {}).value || '').trim(),
    };

    inv.contributions.push(contribution);
    saveGrow();
    if ($('growCFigure')) $('growCFigure').value = '';
    if ($('growCNote'))   $('growCNote').value = '';
    renderGrow();
    renderDash();
    growHint('Added ' + money(fromSen(contribSen(contribution))) + ' to ' + investmentName(inv) + '.');
}

/* There was a "repeat last month" here. It went: a contribution is a
   different figure most months — a bonus month, a rate change, whatever was
   left over — so a copy of last month's was one more thing to correct before
   it could be right. Each one is typed. */

function growDropContribution(id) {
    const inv = growDraft();
    inv.contributions = inv.contributions.filter((c) => c.id !== id);
    saveGrow();
    renderGrow();
    renderDash();
}

/**
 * --------------------------------------------------------------------
 * Dividends and interest
 * --------------------------------------------------------------------
 */
/** Worth-now, moved by something the reader did rather than typed by hand. */
function growSetValue(inv, sen, when) {
    inv.value = String(fromSen(Math.max(0, sen)));
    if (when && (!inv.valueDate || when > inv.valueDate)) inv.valueDate = when;

    if ($('growValue'))     $('growValue').value     = inv.value;
    if ($('growValueDate')) $('growValueDate').value = inv.valueDate;
}

function growAddEarning() {
    readGrowForm();
    const inv = growDraft();
    if (!inv.id) { growHint('Save the investment first — a dividend has to be paid into something.'); return; }

    const when = ($('growEDate') || {}).value || todayIso();
    const rate = String(($('growERate') || {}).value || '');
    let figure = ($('growEFigure') || {}).value || '';

    // A rate on its own is enough: the amount it comes to is worked out from
    // the balance held through that year. Typing an amount overrides it —
    // when the statement arrives, the statement wins.
    if (!(parseFloat(figure) > 0)) {
        const worked = dividendFromRate(inv, when, rate);
        if (!worked || !worked.sen) {
            if ($('growEFigure')) $('growEFigure').focus();
            return;
        }
        figure = String(fromSen(worked.sen));
    }

    const earning = {
        id: 'ie' + (++growState.seq),
        date: when,
        figure: String(figure),
        rate,
        note: (($('growENote') || {}).value || '').trim(),
    };

    inv.earnings.push(earning);

    // A payout is credited into the holding, so what it is worth goes up by
    // exactly that much. The figure stays yours to correct against a
    // statement — this only saves doing the addition by hand.
    const before = investmentFigures(inv).valueSen;
    growSetValue(inv, before + earningSen(earning), earning.date);

    saveGrow();
    ['growEFigure', 'growERate', 'growENote'].forEach((id) => { if ($(id)) $(id).value = ''; });
    renderGrow();
    renderDash();

    growHint('Logged ' + money(fromSen(earningSen(earning))) + ' from ' + investmentName(inv) +
        ' — worth-now is up to ' + money(fromSen(before + earningSen(earning))) + '.');
}

function growDropEarning(id) {
    readGrowForm();
    const inv = growDraft();
    const gone = (inv.earnings || []).find((e) => e.id === id);
    if (!gone) return;

    inv.earnings = inv.earnings.filter((e) => e.id !== id);

    // It was added to what the holding is worth when it was logged, so it
    // comes back off. Leaving it would overstate the holding quietly, which
    // is the worst way to be wrong about money.
    growSetValue(inv, investmentFigures(inv).valueSen - earningSen(gone), '');

    saveGrow();
    renderGrow();
    renderDash();
}

function growApplyProjection() {
    readGrowForm();
    const inv = growDraft();
    const f = investmentFigures(inv);
    const proj = growthProjection(f.valueSen, inv.grow.monthly, inv.grow.rate, inv.grow.years);
    if (!proj) { growHint('Put in a rate and how many years first, and something to grow.'); return; }

    growSetValue(inv, proj.endSen, addMonthsClamped(todayIso(), proj.years * 12));
    saveGrow();
    renderGrow();
    renderDash();
    growHint('Worth-now set to the projected ' + money(fromSen(proj.endSen)) + ' in ' + proj.years +
        (proj.years === 1 ? ' year' : ' years') + ' — a projection, not a statement.');
}

function growApplyFd() {
    readGrowForm();
    const inv = growDraft();
    const f = investmentFigures(inv);
    const fd = fdProjection(f.investedSen, inv.fd.rate, inv.fd.months);
    if (!fd) { growHint('Put in a rate and a tenure first, and something to place.'); return; }

    inv.value = String(fromSen(fd.maturitySen));
    inv.valueDate = addMonthsClamped(inv.opened || todayIso(), fd.months);
    if ($('growValue'))     $('growValue').value = inv.value;
    if ($('growValueDate')) $('growValueDate').value = inv.valueDate;
    saveGrow();
    renderGrow();
    growHint('Worth-now set to the projected maturity of ' + money(fromSen(fd.maturitySen)) +
        ' — a projection, not a statement.');
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
function paintGrowRate(book) {
    set('growRate', book.incomeSen ? pct(book.rate, 2) : '—');
    set('growRateFoot', !book.incomeSen
        ? 'No income recorded for ' + book.range.label + ' to measure against'
        : money(fromSen(book.saved.totalSen)) + ' of ' + money(fromSen(book.incomeSen)) +
          ' · ' + book.range.label);

    set('growSaved', money(fromSen(book.saved.totalSen)));

    // A tile reading RM 0.00 above a bare month name says nothing about why.
    // Empty, it names the three things it counts; full, it stays out of the way.
    set('growSavedFoot', book.saved.totalSen
        ? book.range.label + (book.range.months > 1
            ? ' · ' + money(fromSen(Math.round(book.saved.totalSen / book.range.months))) + ' a month'
            : '')
        : 'Savings entries, goal top-ups and contributions — none in ' + book.range.label);

    set('growWorth', money(fromSen(book.valueSen)));
    set('growWorthFoot', book.live.length
        ? book.live.length + (book.live.length === 1 ? ' investment · ' : ' investments · ') +
          (book.profitSen >= 0 ? '+' : '−') + money(Math.abs(fromSen(book.profitSen)))
        : 'Nothing recorded yet');

    set('growTallyIncome', money(fromSen(book.incomeSen)));
    set('growTallySaved', money(fromSen(book.saved.totalSen)));

    const unit = book.target.unit;
    set('growTallyTargetLabel', unit === 'pct' && book.target.value
        ? 'Target · ' + fmt(parseFloat(book.target.value) || 0, 0) + '% of income'
        : 'Target');
    set('growTallyTarget', book.targetSen ? money(fromSen(book.targetSen)) : '—');

    const gap = $('growTallyGap');
    set('growTallyGapLabel', book.gapSen >= 0 ? 'Over target by' : 'Short by');
    set('growTallyGap', book.targetSen ? money(Math.abs(fromSen(book.gapSen))) : '—');
    if (gap) gap.classList.toggle('is-minus', !!book.targetSen && book.gapSen < 0);

    const affix = $('growTargetAffix');
    if (affix) affix.textContent = unit === 'rm' ? 'RM' : '%';
    set('growTargetHint', unit === 'pct'
        ? 'A share of whatever comes in — ' + (book.incomeSen
            ? fmt(parseFloat(book.target.value) || 0, 0) + '% of ' + money(fromSen(book.incomeSen)) +
              ' is ' + money(fromSen(book.targetSen))
            : 'it needs some income recorded before it means a figure')
        : 'A flat figure for ' + book.range.label + '. Switch to % to make it follow what you earn.');

    paintGrowDist(book);
}

/** Income split into what was kept and what was spent. */
function paintGrowDist(book) {
    const dist = $('growDist');
    const legend = $('growLegend');
    if (!dist || !legend) return;

    dist.innerHTML = '';
    legend.innerHTML = '';

    const base = Math.max(book.incomeSen, book.saved.totalSen);
    if (!base) {
        dist.innerHTML = '<span class="dist-left" style="width:100%"></span>';
        legend.innerHTML = '<span class="legend-empty">Record some income and something set aside — ' +
            'the split appears here.</span>';
        return;
    }

    const rest = Math.max(0, book.incomeSen - book.saved.totalSen);
    const parts = [
        { label: 'Put away', tone: 'indigo', sen: book.saved.totalSen },
        { label: 'Everything else', tone: 'left', sen: rest },
    ].filter((p) => p.sen > 0);

    parts.forEach((p) => {
        const bar = document.createElement('span');
        bar.className = 'dist-' + p.tone;
        bar.style.width = (p.sen / base * 100) + '%';
        bar.title = p.label + ' · ' + money(fromSen(p.sen));
        dist.appendChild(bar);

        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML = '<i class="dot dot-' + (p.tone === 'left' ? 'slate' : p.tone) + '"></i>' +
            '<span>' + p.label + ' <b>' + money(fromSen(p.sen)) + '</b> ' +
            '<small>' + pct(p.sen / base * 100) + '</small></span>';
        legend.appendChild(item);
    });
}

function paintGrowSources(book) {
    const body = $('growSourceBody');
    if (!body) return;
    body.innerHTML = '';

    const total = book.saved.totalSen;
    set('growSourceNote', total
        ? money(fromSen(total)) + ' in ' + book.range.label
        : 'Nothing set aside in ' + book.range.label);

    const rows = [
        { label: 'Filed under savings or debt', where: 'Expenses', sen: book.saved.ledgerSen,
          note: 'Entries in the savings & debt bucket' },
        { label: 'Into savings goals', where: 'Planner', sen: book.saved.goalsSen,
          note: 'Goal contributions' },
        { label: 'Into investments', where: 'Grow', sen: book.saved.investSen,
          note: 'Contributions logged below' },
    ];

    if (!total) {
        body.appendChild(emptyRow('Nothing set aside in ' + book.range.label +
            ' — file an expense under Savings, top up a goal, or log a contribution below.', 4));
        return;
    }

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.appendChild(cell('<strong>' + row.label + '</strong><small>' + row.note + '</small>'));
        tr.appendChild(cell(row.where, 'is-muted'));
        tr.appendChild(cell(row.sen ? fmt(fromSen(row.sen)) : '—', row.sen ? 'is-strong' : 'is-muted'));
        tr.appendChild(cell(row.sen ? pct(row.sen / total * 100, 0) : '—', 'is-muted'));
        body.appendChild(tr);
    });

    const tr = document.createElement('tr');
    tr.className = 'total-row';
    tr.appendChild(cell('Altogether'));
    tr.appendChild(cell(''));
    tr.appendChild(cell(fmt(fromSen(total))));
    tr.appendChild(cell(book.incomeSen ? pct(book.rate, 2) + ' of income' : '—'));
    body.appendChild(tr);
}

function paintGrowTrend(book) {
    const host = $('growTrend');
    if (!host) return;
    host.innerHTML = '';

    const peak = Math.max(1, ...book.trend.map((t) => Math.max(t.savedSen, t.incomeSen)));
    const months = book.trend.filter((t) => t.savedSen > 0).length;
    const savedSen = book.trend.reduce((s, t) => s + t.savedSen, 0);

    set('growTrendNote', months
        ? money(fromSen(savedSen)) + ' over ' + months + (months === 1 ? ' month' : ' months')
        : 'Nothing yet');

    // Twelve rows of dashes is not a chart of nothing, it is twelve rows of
    // dashes. Until there is a month with something in it, say so once.
    const anyIncome = book.trend.some((t) => t.incomeSen > 0);
    if (!months && !anyIncome) {
        paintEmpty(host, 'Nothing to chart yet',
            'This draws what you kept against what came in, month by month. It fills itself in ' +
            'as you record income in Expenses and set money aside.', 'bi-bar-chart');
        return;
    }
    clearEmpty(host);

    book.trend.forEach((row) => {
        const rate = row.incomeSen > 0 ? row.savedSen / row.incomeSen * 100 : 0;
        const line = document.createElement('div');
        line.className = 'grow-month';
        line.innerHTML =
            '<span class="grow-month-id">' + row.label + '</span>' +
            '<div class="grow-bar">' +
                '<i class="grow-bar-income" style="width:' + (row.incomeSen / peak * 100) + '%"></i>' +
                '<i class="grow-bar-saved"  style="width:' + (row.savedSen / peak * 100) + '%"></i>' +
            '</div>' +
            '<b>' + (row.savedSen ? money(fromSen(row.savedSen)) : '—') + '</b>' +
            '<span class="grow-month-rate">' + (row.incomeSen ? pct(rate, 0) : '—') + '</span>';
        host.appendChild(line);
    });
}

function paintGrowList(book) {
    const body = $('growListBody');
    if (!body) return;
    body.innerHTML = '';

    const rows = growState.filter === 'all' ? book.figures : book.figures.filter((f) => f.live);

    set('growListNote', book.figures.length
        ? money(fromSen(book.valueSen)) + ' across ' + book.live.length +
          (book.live.length === 1 ? ' investment' : ' investments')
        : 'Nothing saved yet');

    if (!rows.length) {
        body.appendChild(emptyRow(growState.filter === 'all'
            ? 'Nothing yet. Fill in the form below and press Save investment.'
            : 'Nothing open. Switch to All to see the closed ones.', 7));
        return;
    }

    rows.forEach((f) => {
        const tr = document.createElement('tr');
        if (growState.editing === f.inv.id) tr.className = 'is-you';

        tr.appendChild(cell(
            '<strong>' + escapeHtml(investmentName(f.inv)) +
            (f.inv.closed ? ' <span class="tag is-paid">closed</span>' : '') + '</strong>' +
            '<small>' + f.inv.contributions.length +
            (f.inv.contributions.length === 1 ? ' contribution' : ' contributions') +
            (f.valued && f.inv.valueDate ? ' · valued ' + dayShort(f.inv.valueDate) : '') + '</small>'
        ));
        tr.appendChild(cell('<i class="bi ' + f.type.icon + '"></i> ' + f.type.label, 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(f.investedSen)), 'is-strong'));
        tr.appendChild(cell(fmt(fromSen(f.valueSen)), f.valued ? '' : 'is-muted'));
        tr.appendChild(cell(
            (f.profitSen > 0 ? '+ ' : f.profitSen < 0 ? '− ' : '') + fmt(Math.abs(fromSen(f.profitSen))),
            f.profitSen > 0 ? 'is-plus' : f.profitSen < 0 ? 'is-minus' : 'is-muted'
        ));
        tr.appendChild(cell(f.investedSen ? pct(f.returnPct, 2) : '—',
            !f.investedSen ? 'is-muted' : f.returnPct > 0 ? 'is-plus' : f.returnPct < 0 ? 'is-minus' : 'is-muted'));
        tr.appendChild(cell(
            '<button type="button" class="split-x" data-open-inv="' + f.inv.id + '" aria-label="Open">' +
            '<i class="bi bi-pencil"></i></button>' +
            '<button type="button" class="split-x" data-drop-inv="' + f.inv.id + '" aria-label="Delete">' +
            '<i class="bi bi-x-lg"></i></button>', 'row-actions'));
        body.appendChild(tr);
    });

    if (rows.length > 1) {
        const live = rows.filter((f) => f.live);
        const tr = document.createElement('tr');
        tr.className = 'total-row';
        tr.appendChild(cell('All open'));
        tr.appendChild(cell(''));
        tr.appendChild(cell(fmt(fromSen(live.reduce((s, f) => s + f.investedSen, 0)))));
        tr.appendChild(cell(fmt(fromSen(live.reduce((s, f) => s + f.valueSen, 0)))));
        const profit = live.reduce((s, f) => s + f.profitSen, 0);
        const put    = live.reduce((s, f) => s + f.investedSen, 0);
        tr.appendChild(cell((profit > 0 ? '+ ' : profit < 0 ? '− ' : '') + fmt(Math.abs(fromSen(profit))),
            profit > 0 ? 'is-plus' : profit < 0 ? 'is-minus' : ''));
        tr.appendChild(cell(put ? pct(profit / put * 100, 2) : '—'));
        tr.appendChild(cell(''));
        body.appendChild(tr);
    }
}

function paintGrowForm(book) {
    const f = book.draft;
    const inv = f.inv;

    set('growFormTitle', inv.id ? 'Editing ' + investmentName(inv) : 'New investment');

    const pill = $('growState');
    if (pill) {
        pill.dataset.state = !inv.id ? 'draft' : inv.closed ? 'dirty' : 'saved';
        pill.textContent = !inv.id ? 'Draft' : inv.closed ? 'Closed' : 'Saved';
    }

    const save = $('growSave');
    if (save) save.innerHTML = '<i class="bi bi-check-lg"></i> ' + (inv.id ? 'Update investment' : 'Save investment');

    const fresh = $('growNew');
    if (fresh) fresh.hidden = !inv.id;

    const close = $('growClose');
    if (close) {
        close.hidden = !inv.id;
        close.innerHTML = inv.closed
            ? '<i class="bi bi-arrow-counterclockwise"></i> Re-open this one'
            : '<i class="bi bi-archive"></i> Close this one';
    }

    set('growTallyIn', money(fromSen(f.investedSen)));
    set('growTallyEarned', money(fromSen(f.earnedSen)));
    set('growTallyWorth', money(fromSen(f.valueSen)));
    set('growTallyProfit', (f.profitSen < 0 ? '− ' : '') + money(Math.abs(fromSen(f.profitSen))));
    const profit = $('growTallyProfit');
    if (profit) profit.classList.toggle('is-minus', f.profitSen < 0);
    set('growTallyReturn', f.investedSen ? pct(f.returnPct, 2) : '—');

    set('growValueHint', f.valued
        ? (f.earnedSen
            ? 'Yours to update — ' + money(fromSen(f.earnedSen)) + ' of it was added by the payouts logged below.'
            : 'This app cannot see a unit trust price or an EPF dividend, so this figure is yours to update.')
        : 'Empty, so it is being read as worth exactly what went in — ' +
          money(fromSen(f.investedSen)) + '.');

    paintGrowGuide(inv);

    // --- the growth fold: every kind but a fixed deposit, which has its own ---
    const grow = $('growProjFold');
    if (grow) grow.hidden = inv.type === 'fd';
    if (inv.type !== 'fd') {
        const proj = growthProjection(f.valueSen, inv.grow.monthly, inv.grow.rate, inv.grow.years);
        set('growProjSummary', proj
            ? money(fromSen(proj.endSen)) + ' in ' + proj.years + (proj.years === 1 ? ' year' : ' years')
            : 'Monthly, rate and years');
        set('growProjText', !proj
            ? 'What it grows to if you keep topping it up. A rate and how many years, and a monthly ' +
              'top-up if you make one — EPF at 11% of salary, ASB at whatever you put in.'
            : money(fromSen(proj.startSen)) + ' now' +
              (proj.monthlySen ? ' plus ' + money(fromSen(proj.monthlySen)) + ' a month' : '') +
              ' at ' + fmt(proj.ratePct, 2) + '% comes to ' + money(fromSen(proj.endSen)) + ' after ' +
              proj.years + (proj.years === 1 ? ' year' : ' years') + ' — ' +
              money(fromSen(proj.paidInSen)) + ' of that put in by you and ' +
              money(fromSen(proj.growthSen)) + ' earned. The rate is applied once a year, with each ' +
              'year\u2019s top-ups counted at half, because they were only there for part of it.');
    }

    // --- the fixed deposit fold ---
    const fold = $('growFdFold');
    if (fold) fold.hidden = inv.type !== 'fd';
    if (inv.type === 'fd') {
        const fd = fdProjection(f.investedSen, inv.fd.rate, inv.fd.months);
        set('growFdSummary', fd ? money(fromSen(fd.maturitySen)) + ' at maturity' : 'Rate and tenure');
        set('growFdText', !fd
            ? 'Put in a rate and a tenure, and a placement to work on. A Malaysian FD pays simple interest ' +
              'at maturity, not monthly — that is what this works out.'
            : money(fromSen(fd.principalSen)) + ' at ' + fmt(fd.ratePct, 2) + '% for ' +
              monthsText(fd.months) + ' matures at ' + money(fromSen(fd.maturitySen)) + ' — ' +
              money(fromSen(fd.interestSen)) + ' of interest' +
              (fd.rolled ? ', treating each year as a placement rolled over.' :
               '. Simple interest, paid at maturity.'));
    }
}

function paintGrowContributions(book) {
    const f = book.draft;
    const inv = f.inv;
    const host = $('growCList');
    const add = $('growContribAdd');
    if (!host) return;

    const card = $('growContribCard');
    if (card) card.hidden = !inv.id;

    set('growContribTitle', inv.id ? 'Contributions — ' + investmentName(inv) : 'Contributions');
    if (add) add.hidden = !inv.id;

    const linked = linkedEntries(inv);
    const rows = inv.contributions.length + linked.length;

    set('growContribNote', inv.id
        ? rows + (rows === 1 ? ' contribution · ' : ' contributions · ') +
          money(fromSen(f.contributedSen)) +
          (f.fromLedgerSen ? ' · ' + money(fromSen(f.fromLedgerSen)) + ' from Expenses' : '') +
          (f.openingSen ? ' · opened with ' + money(fromSen(f.openingSen)) : '')
        : 'Save an investment to log what goes into it');

    // The unit switch, and what a percentage would be a percentage of.
    const unit = (($('growCUnit') || {}).dataset || {}).value === 'pct' ? 'pct' : 'rm';
    const affix = $('growCAffix');
    if (affix) affix.textContent = unit === 'rm' ? 'RM' : '%';
    const baseWrap = $('growCBaseWrap');
    if (baseWrap) baseWrap.hidden = unit !== 'pct';

    const when = ($('growCDate') || {}).value || todayIso();
    const monthIncome = growMonthIncome(when);
    const typedBase = Math.max(0, toSen(parseFloat(($('growCBase') || {}).value || '') || 0));
    const baseSen = typedBase || monthIncome;
    const figure = parseFloat(($('growCFigure') || {}).value || '') || 0;

    set('growCHint', !inv.id
        ? 'Nothing can be logged against a draft — save the investment first.'
        : unit === 'rm'
            ? 'A flat amount. Switch to % for anything worked out as a share — EPF at 11% of salary, for instance.'
            : monthIncome && !typedBase
                ? fmt(figure, 0) + '% of the ' + money(fromSen(monthIncome)) + ' the ledger has for ' +
                  monthKeyLabel(monthOf(when)) + ' is ' + money(fromSen(unitSen(figure, 'pct', baseSen))) +
                  '. Type your own figure beside it to use a different base.'
                : typedBase
                    ? fmt(figure, 0) + '% of ' + money(fromSen(typedBase)) + ' is ' +
                      money(fromSen(unitSen(figure, 'pct', baseSen))) + '.'
                    : 'No income is recorded for ' + monthKeyLabel(monthOf(when)) +
                      ', so put the figure it is a percentage of in the box beside it.');

    host.innerHTML = '';
    if (!inv.id) return;

    if (!inv.contributions.length && !linked.length) {
        host.innerHTML = '<p class="goal-log-empty">Nothing in yet. Every contribution here counts towards ' +
            'your savings for the month it is dated' +
            (inv.source ? ', and anything you file under that category in Expenses shows up here.' : '.') +
            '</p>';
        return;
    }

    // One list, both sources, newest first — where a row came from is a tag on
    // it rather than a second card to look in.
    const all = inv.contributions
        .map((c) => ({ date: c.date, key: c.id, sen: contribSen(c), row: c, ledger: null }))
        .concat(linked.map((e) => ({ date: e.date, key: e.id, sen: entrySen(e), row: null, ledger: e })))
        .sort((a, b) => (a.date === b.date ? (a.key < b.key ? 1 : -1) : (a.date < b.date ? 1 : -1)));

    all.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'goal-c';

        if (item.ledger) {
            const note = (item.ledger.note || '').trim();
            row.classList.add('is-linked');
            row.innerHTML =
                '<span class="goal-c-when">' + dayLabel(item.date) + '</span>' +
                '<span class="goal-c-what">' + (note ? escapeHtml(note) : '<i>No note</i>') +
                    ' <em class="from-tag">Expenses</em></span>' +
                '<b>' + money(fromSen(item.sen)) + '</b>' +
                // No ✕: the record is in Expenses, and a button here that
                // deleted an entry over there would be a trap.
                '<span></span>';
            host.appendChild(row);
            return;
        }

        const c = item.row;
        row.dataset.contribution = c.id;
        row.innerHTML =
            '<span class="goal-c-when">' + dayLabel(c.date) + '</span>' +
            '<span class="goal-c-what">' +
                (c.unit === 'pct'
                    ? fmt(parseFloat(c.figure) || 0, 0) + '% of ' + money(fromSen(contribBaseSen(c)))
                    : (c.note ? escapeHtml(c.note) : '<i>No note</i>')) +
                (c.unit === 'pct' && c.note ? ' · ' + escapeHtml(c.note) : '') +
            '</span>' +
            '<b>' + money(fromSen(item.sen)) + '</b>' +
            '<button type="button" class="split-x" data-drop-contrib aria-label="Remove contribution">' +
                '<i class="bi bi-x-lg"></i></button>';
        host.appendChild(row);
    });
}

/**
 * The payout card. Grouped by year, because a dividend is an annual event and
 * "what did this pay me in 2025" is the whole question.
 */
function paintGrowEarnings(book) {
    const f = book.draft;
    const inv = f.inv;
    const host = $('growEList');
    const add = $('growEarnAdd');
    if (!host) return;

    const card = $('growEarnCard');
    if (card) card.hidden = !inv.id;

    set('growEarnTitle', inv.id ? 'Dividends & interest — ' + investmentName(inv) : 'Dividends & interest');
    if (add) add.hidden = !inv.id;

    const years = earningYears(inv);
    set('growEarnNote', inv.id
        ? (inv.earnings.length
            ? inv.earnings.length + (inv.earnings.length === 1 ? ' payout · ' : ' payouts · ') +
              money(fromSen(f.earnedSen)) + ' · ' + years[0].year + ' ' + money(fromSen(years[0].totalSen))
            : 'Nothing paid out yet')
        : 'Save an investment to log what it pays you');

    const when = ($('growEDate') || {}).value || todayIso();
    const rate = ($('growERate') || {}).value || '';
    const typed = parseFloat(($('growEFigure') || {}).value || '') || 0;
    const worked = inv.id ? dividendFromRate(inv, when, rate) : null;

    set('growEHint', !inv.id
        ? 'Nothing can be logged against a draft — save the investment first.'
        : worked && worked.sen && !typed
            ? fmt(worked.ratePct, 2) + '% on the balance held through ' + worked.year + ' works out to ' +
              money(fromSen(worked.sen)) + ' — press Add to log that, or type your own amount over it. ' +
              'A rate is paid on the balance as it stood each month, so money paid in during the year ' +
              'earns only the part of it that it was there for.'
            : typed && worked && worked.sen
                ? 'Logging ' + money(fromSen(toSen(typed))) + '. The rate would have worked out to ' +
                  money(fromSen(worked.sen)) + ' — yours wins, because a statement beats arithmetic.'
                : 'What the holding paid you. It never counts towards your savings for the month, and ' +
                  'logging one raises Worth now by the same amount. Put in the rate on its own and the ' +
                  'ringgit is worked out from the balance you held through that year.');

    host.innerHTML = '';
    if (!inv.id) return;

    if (!inv.earnings.length) {
        host.innerHTML = '<p class="goal-log-empty">Nothing yet. An ASNB dividend, an EPF crediting, ' +
            'FD interest at maturity — whatever the holding paid you, dated the day it was paid.</p>';
        return;
    }

    years.forEach((year) => {
        const head = document.createElement('div');
        head.className = 'grow-year';
        head.innerHTML = '<span>' + escapeHtml(year.year) + '</span><b>' +
            money(fromSen(year.totalSen)) + '</b>';
        host.appendChild(head);

        year.rows.forEach((e) => {
            const rate = parseFloat(e.rate) || 0;
            const row = document.createElement('div');
            row.className = 'goal-c';
            row.dataset.earning = e.id;
            row.innerHTML =
                '<span class="goal-c-when">' + dayLabel(e.date) + '</span>' +
                '<span class="goal-c-what">' +
                    (rate ? fmt(rate, 2) + '%' + (e.note ? ' · ' : '') : '') +
                    (e.note ? escapeHtml(e.note) : (rate ? '' : '<i>No note</i>')) +
                '</span>' +
                '<b>' + money(fromSen(earningSen(e))) + '</b>' +
                '<button type="button" class="split-x" data-drop-earning aria-label="Remove payout">' +
                    '<i class="bi bi-x-lg"></i></button>';
            host.appendChild(row);
        });
    });
}

function paintGrow(book) {
    paintGrowRate(book);
    paintGrowSources(book);
    paintGrowTrend(book);
    paintGrowList(book);
    paintGrowForm(book);
    paintGrowContributions(book);
    paintGrowEarnings(book);
}

function growSummaryText() {
    const book = growCompute();
    const lines = ['Savings — ' + book.range.label];

    lines.push('Income ' + money(fromSen(book.incomeSen)) +
        ', put away ' + money(fromSen(book.saved.totalSen)) +
        (book.incomeSen ? ' — a rate of ' + pct(book.rate, 2) : ''));

    if (book.saved.ledgerSen) lines.push('  under savings & debt: ' + money(fromSen(book.saved.ledgerSen)));
    if (book.saved.goalsSen)  lines.push('  into goals: ' + money(fromSen(book.saved.goalsSen)));
    if (book.saved.investSen) lines.push('  into investments: ' + money(fromSen(book.saved.investSen)));

    if (book.targetSen) {
        lines.push(book.gapSen >= 0
            ? 'Target ' + money(fromSen(book.targetSen)) + ' — over by ' + money(fromSen(book.gapSen))
            : 'Target ' + money(fromSen(book.targetSen)) + ' — short by ' + money(fromSen(-book.gapSen)));
    }

    if (book.live.length) {
        lines.push('');
        lines.push('Investments — ' + money(fromSen(book.valueSen)) + ' worth, ' +
            money(fromSen(book.investedSen)) + ' put in');
        book.live.forEach((f) => {
            lines.push('  ' + investmentName(f.inv) + ' (' + f.type.label + '): ' +
                money(fromSen(f.investedSen)) + ' → ' + money(fromSen(f.valueSen)) +
                (f.investedSen ? ' · ' + (f.profitSen >= 0 ? '+' : '−') +
                    money(Math.abs(fromSen(f.profitSen))) + ' · ' + pct(f.returnPct, 2) : '') +
                (f.earnedSen ? ' · paid out ' + money(fromSen(f.earnedSen)) : ''));
        });
    }

    return lines.join('\n');
}

function renderGrow() {
    readGrowForm();
    paintGrow(growCompute());
    saveGrow();
}

/**
 * --------------------------------------------------------------------
 * Persistence
 * --------------------------------------------------------------------
 */
function saveGrow() {
    try {
        storeWrite(GROW_KEY, JSON.stringify({
            seq: growState.seq,
            filter: growState.filter,
            editing: growState.editing,
            types: growState.types.filter((t) => t.label.trim()),
            period: (($('growPeriod') || {}).dataset || {}).value || 'month',
            target: growState.target,
            investments: growState.investments,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

function loadGrow() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(GROW_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') { growState.draft = newInvestment(); return; }

    growState.seq = Number(saved.seq) || 0;
    growState.filter = saved.filter === 'all' ? 'all' : 'open';
    growState.target = {
        value: String((saved.target && saved.target.value) || ''),
        unit: (saved.target && saved.target.unit) === 'rm' ? 'rm' : 'pct',
    };

    // The kinds are read first: a holding is checked against them, and one
    // pointing at a kind that is no longer there has to land somewhere real.
    growState.types = (Array.isArray(saved.types) ? saved.types : DEFAULT_INVESTMENT_TYPES)
        .filter((t) => t && t.id && String(t.label || '').trim())
        .map((t) => ({
            id: String(t.id),
            label: String(t.label).trim(),
            icon: /^bi-[a-z0-9-]+$/.test(String(t.icon || '')) ? String(t.icon) : 'bi-piggy-bank',
        }))
        .filter((t, i, list) => list.findIndex((x) => x.id === t.id) === i);
    if (!growState.types.length) growState.types = DEFAULT_INVESTMENT_TYPES.map((t) => ({ ...t }));

    growState.investments = (Array.isArray(saved.investments) ? saved.investments : [])
        .filter((i) => i && i.id)
        .map((i) => ({
            id: String(i.id),
            seq: Number(i.seq) || 0,
            name: String(i.name || ''),
            type: investmentType(i.type).id,
            opened: /^\d{4}-\d{2}-\d{2}$/.test(i.opened || '') ? i.opened : todayIso(),
            opening: String(i.opening || ''),
            // A category that has since been deleted is no link at all.
            source: categoryById(String(i.source || '')) ? String(i.source) : '',
            value: String(i.value || ''),
            valueDate: /^\d{4}-\d{2}-\d{2}$/.test(i.valueDate || '') ? i.valueDate : '',
            note: String(i.note || ''),
            closed: !!i.closed,
            fd: {
                rate: String((i.fd && i.fd.rate) || ''),
                months: String((i.fd && i.fd.months) || ''),
            },
            grow: {
                monthly: String((i.grow && i.grow.monthly) || ''),
                rate: String((i.grow && i.grow.rate) || ''),
                years: String((i.grow && i.grow.years) || ''),
            },
            contributions: (Array.isArray(i.contributions) ? i.contributions : [])
                .filter((c) => c && c.id && /^\d{4}-\d{2}-\d{2}$/.test(c.date || ''))
                .map((c) => ({
                    id: String(c.id), date: c.date,
                    unit: c.unit === 'pct' ? 'pct' : 'rm',
                    figure: String(c.figure || ''),
                    base: String(c.base || ''),
                    note: String(c.note || ''),
                })),
            // Payouts arrived after the first holdings were written, so an
            // older record has none and reads as none rather than as broken.
            earnings: (Array.isArray(i.earnings) ? i.earnings : [])
                .filter((e) => e && e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''))
                .map((e) => ({
                    id: String(e.id), date: e.date,
                    figure: String(e.figure || ''),
                    rate: String(e.rate || ''),
                    note: String(e.note || ''),
                })),
        }));

    growState.investments.forEach((i) => { growState.seq = Math.max(growState.seq, i.seq); });

    if ($('growPeriod') && ['month', 'lastmonth', 'year'].includes(saved.period)) {
        setSegment($('growPeriod'), saved.period);
    }

    const open = growState.investments.find((i) => i.id === saved.editing);
    growState.draft = open || newInvestment();
    growState.editing = open ? open.id : null;
}

/**
 * ====================================================================
 * DAILY EXPENSES — the ledger
 * ====================================================================
 * The other three modules answer a question; this one keeps a record. Every
 * entry is one of three things:
 *
 *   expense  — money left an account and is gone
 *   income   — money arrived in an account
 *   transfer — money moved between two of your own accounts
 *
 * A transfer is neither income nor spending, so it stays out of both totals
 * while still moving the two balances. Getting that wrong is what makes a
 * ledger disagree with the bank.
 *
 * Spending categories are the Budget Planner's own list, so what you recorded
 * reads straight against what you planned — that is the last two columns of
 * "Where it went".
 */
const LEDGER_KEY = 'moneyflow.ledger.v1';

/**
 * --------------------------------------------------------------------
 * Accounts and wallets
 * --------------------------------------------------------------------
 * An account is a place money sits. `type` is what kind of place, and it is
 * what the balance panel groups by. `purpose` is the reader's own note about
 * what the account is *for* — salary in, savings, day-to-day spending — which
 * is the thing that actually explains a transfer six months later. `status`
 * retires an account without deleting its history: a closed account keeps
 * every entry against it and stops appearing in the pickers.
 */
/* What a browser starts with. The kinds are the reader's too — they are added,
   renamed and removed on the Accounts card, and the live list is saved with the
   ledger. Each keeps an id of its own: an account points at the id, so renaming
   a kind never touches an account, and the balance panels keep their grouping.

   'credit' is the one id the app knows by name: a credit account carrying a
   negative balance is what the dashboard reads as money owed on a card. It can
   be renamed like any other, and removing it only takes away the wording. */
const DEFAULT_TYPES = [
    { id: 'bank',    label: 'Bank' },
    { id: 'cash',    label: 'Cash' },
    { id: 'ewallet', label: 'E-wallet' },
    { id: 'credit',  label: 'Credit card' },
    { id: 'other',   label: 'Other' },
];

/* The way into the kinds editor, from any account's kind picker. */
const TYPE_EDIT = '__edit_types__';

/* Savings was a type of its own before accounts had a purpose. It is a purpose,
   not a kind of institution, so it moves — and old data is migrated on load.

   These are only what a browser starts with. The list belongs to the reader:
   purposes are added, renamed and removed on the Accounts card, and the live
   list is saved with the ledger. */
const DEFAULT_PURPOSES = ['Salary', 'Savings', 'Daily expenses', 'Bills', 'Emergency fund', 'Investment'];

/* The last option in every purpose picker. It is a way into the editor rather
   than a purpose, so it is never read back as one. */
const PURPOSE_EDIT = '__edit_purposes__';

const ACCOUNT_STATUSES = { active: 'Active', closed: 'Closed' };

/**
 * Every ISO 4217 currency in circulation: code, name, the symbol where one is
 * commonly written, and the countries that use it. That fourth column is the
 * whole point — nobody remembers that Thailand's money is called the Baht,
 * they remember Thailand, and "Thai Baht" does not contain the word they
 * would type.
 *
 * A symbol is only ever printed for the amount being recorded. Totals stay
 * in the base currency: converting at entry would freeze one day's rate into
 * a permanent record, and a rate is not a thing this app is allowed to
 * invent.
 */
const BASE_CURRENCY = 'MYR';

const CURRENCY_TABLE = [
    ['MYR', 'Malaysian Ringgit', 'RM', 'Malaysia'],
    ['SGD', 'Singapore Dollar', 'S$', 'Singapore'],
    ['USD', 'US Dollar', '$', 'United States America USA'],
    ['EUR', 'Euro', '€', 'Eurozone Europe Germany France Spain Italy Netherlands Ireland Portugal Greece Austria Belgium Finland'],
    ['GBP', 'Pound Sterling', '£', 'United Kingdom Britain England Scotland Wales'],
    ['JPY', 'Japanese Yen', '¥', 'Japan'],
    ['CNY', 'Chinese Yuan', 'CN¥', 'China'],
    ['HKD', 'Hong Kong Dollar', 'HK$', 'Hong Kong'],
    ['TWD', 'New Taiwan Dollar', 'NT$', 'Taiwan'],
    ['KRW', 'South Korean Won', '₩', 'South Korea'],
    ['THB', 'Thai Baht', '฿', 'Thailand'],
    ['IDR', 'Indonesian Rupiah', 'Rp', 'Indonesia'],
    ['PHP', 'Philippine Peso', '₱', 'Philippines'],
    ['VND', 'Vietnamese Dong', '₫', 'Vietnam'],
    ['BND', 'Brunei Dollar', 'B$', 'Brunei'],
    ['KHR', 'Cambodian Riel', '៛', 'Cambodia'],
    ['LAK', 'Lao Kip', '₭', 'Laos'],
    ['MMK', 'Myanmar Kyat', 'K', 'Myanmar Burma'],
    ['INR', 'Indian Rupee', '₹', 'India'],
    ['PKR', 'Pakistani Rupee', '₨', 'Pakistan'],
    ['BDT', 'Bangladeshi Taka', '৳', 'Bangladesh'],
    ['LKR', 'Sri Lankan Rupee', 'Rs', 'Sri Lanka'],
    ['NPR', 'Nepalese Rupee', 'Rs', 'Nepal'],
    ['AUD', 'Australian Dollar', 'A$', 'Australia'],
    ['NZD', 'New Zealand Dollar', 'NZ$', 'New Zealand'],
    ['CAD', 'Canadian Dollar', 'C$', 'Canada'],
    ['CHF', 'Swiss Franc', '', 'Switzerland Liechtenstein'],
    ['SEK', 'Swedish Krona', 'kr', 'Sweden'],
    ['NOK', 'Norwegian Krone', 'kr', 'Norway'],
    ['DKK', 'Danish Krone', 'kr', 'Denmark'],
    ['ISK', 'Icelandic Krona', 'kr', 'Iceland'],
    ['PLN', 'Polish Zloty', 'zł', 'Poland'],
    ['CZK', 'Czech Koruna', 'Kč', 'Czechia Czech Republic'],
    ['HUF', 'Hungarian Forint', 'Ft', 'Hungary'],
    ['RON', 'Romanian Leu', 'lei', 'Romania'],
    ['BGN', 'Bulgarian Lev', 'лв', 'Bulgaria'],
    ['HRK', 'Croatian Kuna', 'kn', 'Croatia'],
    ['RSD', 'Serbian Dinar', '', 'Serbia'],
    ['TRY', 'Turkish Lira', '₺', 'Turkey Turkiye'],
    ['RUB', 'Russian Ruble', '₽', 'Russia'],
    ['UAH', 'Ukrainian Hryvnia', '₴', 'Ukraine'],
    ['KZT', 'Kazakhstani Tenge', '₸', 'Kazakhstan'],
    ['GEL', 'Georgian Lari', '₾', 'Georgia'],
    ['AMD', 'Armenian Dram', '֏', 'Armenia'],
    ['AZN', 'Azerbaijani Manat', '₼', 'Azerbaijan'],
    ['ILS', 'Israeli New Shekel', '₪', 'Israel'],
    ['AED', 'UAE Dirham', '', 'United Arab Emirates Dubai Abu Dhabi'],
    ['SAR', 'Saudi Riyal', '', 'Saudi Arabia'],
    ['QAR', 'Qatari Riyal', '', 'Qatar'],
    ['KWD', 'Kuwaiti Dinar', '', 'Kuwait'],
    ['BHD', 'Bahraini Dinar', '', 'Bahrain'],
    ['OMR', 'Omani Rial', '', 'Oman'],
    ['JOD', 'Jordanian Dinar', '', 'Jordan'],
    ['LBP', 'Lebanese Pound', '', 'Lebanon'],
    ['EGP', 'Egyptian Pound', '', 'Egypt'],
    ['IQD', 'Iraqi Dinar', '', 'Iraq'],
    ['IRR', 'Iranian Rial', '', 'Iran'],
    ['AFN', 'Afghan Afghani', '؋', 'Afghanistan'],
    ['ZAR', 'South African Rand', 'R', 'South Africa'],
    ['NGN', 'Nigerian Naira', '₦', 'Nigeria'],
    ['KES', 'Kenyan Shilling', 'KSh', 'Kenya'],
    ['TZS', 'Tanzanian Shilling', 'TSh', 'Tanzania'],
    ['UGX', 'Ugandan Shilling', 'USh', 'Uganda'],
    ['GHS', 'Ghanaian Cedi', '₵', 'Ghana'],
    ['ETB', 'Ethiopian Birr', '', 'Ethiopia'],
    ['MAD', 'Moroccan Dirham', '', 'Morocco'],
    ['DZD', 'Algerian Dinar', '', 'Algeria'],
    ['TND', 'Tunisian Dinar', '', 'Tunisia'],
    ['LYD', 'Libyan Dinar', '', 'Libya'],
    ['SDG', 'Sudanese Pound', '', 'Sudan'],
    ['XOF', 'West African CFA Franc', '', 'Senegal Ivory Coast Mali Benin Burkina Faso Niger Togo'],
    ['XAF', 'Central African CFA Franc', '', 'Cameroon Chad Gabon Congo Central African Republic'],
    ['MUR', 'Mauritian Rupee', '', 'Mauritius'],
    ['BWP', 'Botswana Pula', 'P', 'Botswana'],
    ['ZMW', 'Zambian Kwacha', '', 'Zambia'],
    ['MZN', 'Mozambican Metical', '', 'Mozambique'],
    ['AOA', 'Angolan Kwanza', '', 'Angola'],
    ['NAD', 'Namibian Dollar', '', 'Namibia'],
    ['RWF', 'Rwandan Franc', '', 'Rwanda'],
    ['MWK', 'Malawian Kwacha', '', 'Malawi'],
    ['BRL', 'Brazilian Real', 'R$', 'Brazil'],
    ['MXN', 'Mexican Peso', 'MX$', 'Mexico'],
    ['ARS', 'Argentine Peso', '', 'Argentina'],
    ['CLP', 'Chilean Peso', '', 'Chile'],
    ['COP', 'Colombian Peso', '', 'Colombia'],
    ['PEN', 'Peruvian Sol', 'S/', 'Peru'],
    ['UYU', 'Uruguayan Peso', '', 'Uruguay'],
    ['BOB', 'Bolivian Boliviano', 'Bs', 'Bolivia'],
    ['PYG', 'Paraguayan Guarani', '₲', 'Paraguay'],
    ['VES', 'Venezuelan Bolivar', '', 'Venezuela'],
    ['CRC', 'Costa Rican Colon', '₡', 'Costa Rica'],
    ['GTQ', 'Guatemalan Quetzal', 'Q', 'Guatemala'],
    ['PAB', 'Panamanian Balboa', '', 'Panama'],
    ['DOP', 'Dominican Peso', '', 'Dominican Republic'],
    ['JMD', 'Jamaican Dollar', 'J$', 'Jamaica'],
    ['TTD', 'Trinidad and Tobago Dollar', '', 'Trinidad Tobago'],
    ['BBD', 'Barbadian Dollar', '', 'Barbados'],
    ['BSD', 'Bahamian Dollar', '', 'Bahamas'],
    ['CUP', 'Cuban Peso', '', 'Cuba'],
    ['HNL', 'Honduran Lempira', 'L', 'Honduras'],
    ['NIO', 'Nicaraguan Cordoba', 'C$', 'Nicaragua'],
    ['BZD', 'Belize Dollar', '', 'Belize'],
    ['XCD', 'East Caribbean Dollar', '', 'Antigua Dominica Grenada Saint Lucia Saint Vincent'],
    ['MNT', 'Mongolian Tugrik', '₮', 'Mongolia'],
    ['UZS', 'Uzbekistani Som', '', 'Uzbekistan'],
    ['KGS', 'Kyrgyzstani Som', '', 'Kyrgyzstan'],
    ['TJS', 'Tajikistani Somoni', '', 'Tajikistan'],
    ['TMT', 'Turkmenistani Manat', '', 'Turkmenistan'],
    ['MVR', 'Maldivian Rufiyaa', '', 'Maldives'],
    ['BTN', 'Bhutanese Ngultrum', '', 'Bhutan'],
    ['MOP', 'Macanese Pataca', '', 'Macau Macao'],
    ['PGK', 'Papua New Guinean Kina', '', 'Papua New Guinea'],
    ['FJD', 'Fijian Dollar', '', 'Fiji'],
    ['WST', 'Samoan Tala', '', 'Samoa'],
    ['TOP', 'Tongan Paanga', '', 'Tonga'],
    ['VUV', 'Vanuatu Vatu', '', 'Vanuatu'],
    ['SBD', 'Solomon Islands Dollar', '', 'Solomon Islands'],
    ['XPF', 'CFP Franc', '', 'French Polynesia New Caledonia Tahiti'],
    ['ALL', 'Albanian Lek', '', 'Albania'],
    ['MKD', 'Macedonian Denar', '', 'North Macedonia'],
    ['BAM', 'Bosnia and Herzegovina Mark', '', 'Bosnia Herzegovina'],
    ['MDL', 'Moldovan Leu', '', 'Moldova'],
    ['BYN', 'Belarusian Ruble', '', 'Belarus'],
    ['SYP', 'Syrian Pound', '', 'Syria'],
    ['YER', 'Yemeni Rial', '', 'Yemen'],
    ['SOS', 'Somali Shilling', '', 'Somalia'],
    ['DJF', 'Djiboutian Franc', '', 'Djibouti'],
    ['ERN', 'Eritrean Nakfa', '', 'Eritrea'],
    ['SSP', 'South Sudanese Pound', '', 'South Sudan'],
    ['GMD', 'Gambian Dalasi', '', 'Gambia'],
    ['GNF', 'Guinean Franc', '', 'Guinea'],
    ['SLE', 'Sierra Leonean Leone', '', 'Sierra Leone'],
    ['LRD', 'Liberian Dollar', '', 'Liberia'],
    ['CVE', 'Cape Verdean Escudo', '', 'Cape Verde'],
    ['STN', 'Sao Tome and Principe Dobra', '', 'Sao Tome Principe'],
    ['SCR', 'Seychellois Rupee', '', 'Seychelles'],
    ['MGA', 'Malagasy Ariary', '', 'Madagascar'],
    ['KMF', 'Comorian Franc', '', 'Comoros'],
    ['BIF', 'Burundian Franc', '', 'Burundi'],
    ['CDF', 'Congolese Franc', '', 'Congo Kinshasa DRC'],
    ['ZWL', 'Zimbabwean Dollar', '', 'Zimbabwe'],
    ['LSL', 'Lesotho Loti', '', 'Lesotho'],
    ['SZL', 'Eswatini Lilangeni', '', 'Eswatini Swaziland'],
    ['GIP', 'Gibraltar Pound', '', 'Gibraltar'],
    ['FKP', 'Falkland Islands Pound', '', 'Falkland Islands'],
    ['SHP', 'Saint Helena Pound', '', 'Saint Helena'],
    ['AWG', 'Aruban Florin', '', 'Aruba'],
    ['ANG', 'Netherlands Antillean Guilder', '', 'Curacao Sint Maarten'],
    ['SRD', 'Surinamese Dollar', '', 'Suriname'],
    ['GYD', 'Guyanese Dollar', '', 'Guyana'],
    ['HTG', 'Haitian Gourde', '', 'Haiti'],
    ['KYD', 'Cayman Islands Dollar', '', 'Cayman Islands'],
    ['BMD', 'Bermudian Dollar', '', 'Bermuda'],
    ['XDR', 'IMF Special Drawing Rights', '', 'International Monetary Fund'],
];

const CURRENCIES = CURRENCY_TABLE.map(([code]) => code);

const currencyRow = (code) => CURRENCY_TABLE.find(([c]) => c === code) || null;

const currencySymbol = (code) => {
    const row = currencyRow(code);
    return (row && row[2]) || code || BASE_CURRENCY;
};

const currencyName = (code) => {
    const row = currencyRow(code);
    return row ? row[1] : '';
};

const DEFAULT_ACCOUNTS = [
    { name: 'Cash',        type: 'cash',    purpose: 'Daily expenses', opening: '' },
    { name: 'Bank',        type: 'bank',    purpose: 'Salary',         opening: '' },
    { name: "Touch 'n Go", type: 'ewallet', purpose: 'Daily expenses', opening: '' },
    { name: 'Credit card', type: 'credit',  purpose: '',               opening: '' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Ids have to survive a reload, so the counter is persisted with the data. */
let ledgerSeq = 0;
const ledgerId = (prefix) => prefix + (++ledgerSeq);

let ledgerState = { entries: [], accounts: [], types: [], purposes: [], month: '', editing: null };

/**
 * --------------------------------------------------------------------
 * Dates. Held as 'YYYY-MM-DD' and split by hand — passing a date-only
 * string to `new Date()` parses it as UTC, which lands on the wrong day
 * for anyone east of Greenwich, Malaysia included.
 * --------------------------------------------------------------------
 */
const pad2 = (n) => (n < 10 ? '0' : '') + n;

function todayIso() {
    const now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

const monthOf = (iso) => (iso || '').slice(0, 7);

function monthKeyLabel(key) {
    const [year, month] = (key || '').split('-').map(Number);
    if (!year || !month) return '—';
    return MONTH_NAMES[month - 1] + ' ' + year;
}

function shiftMonthKey(key, delta) {
    const [year, month] = key.split('-').map(Number);
    const moved = new Date(year, month - 1 + delta, 1);
    return moved.getFullYear() + '-' + pad2(moved.getMonth() + 1);
}

function dayParts(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return { day, weekday: DAY_NAMES[new Date(year, month - 1, day).getDay()] };
}

/**
 * --------------------------------------------------------------------
 * Accounts
 * --------------------------------------------------------------------
 */
const accountById = (id) => ledgerState.accounts.find((a) => a.id === id) || null;
const accountName = (id) => (accountById(id) || {}).name.trim() || 'Unnamed account';

function seedAccounts() {
    ledgerState.accounts = DEFAULT_ACCOUNTS.map((a) => ({
        id: ledgerId('a'), name: a.name, type: a.type, purpose: a.purpose,
        currency: BASE_CURRENCY, opening: a.opening, status: 'active',
    }));
}

/**
 * A closed account leaves the pickers and nothing else. It keeps every entry
 * filed against it, and it keeps its balance on the account panels — money in
 * a closed account is still money, and hiding it there would leave the rows
 * no longer adding up to Total Balance.
 */
const openAccounts = () => ledgerState.accounts.filter((a) => a.status !== 'closed');



/** Opening balance, then every entry that touched the account. */
function accountBalances() {
    const balances = {};
    ledgerState.accounts.forEach((a) => { balances[a.id] = toSen(parseFloat(a.opening) || 0); });

    ledgerState.entries.forEach((entry) => {
        const amount = entrySen(entry);
        if (!amount) return;

        if (entry.type === 'income' || entry.type === 'refund') {
            // Both put money into an account. What they mean by it differs,
            // and that difference is spent in the totals, not here.
            if (entry.account in balances) balances[entry.account] += amount;
        } else if (entry.type === 'expense') {
            if (entry.account in balances) balances[entry.account] -= amount;
        } else {
            if (entry.account in balances)   balances[entry.account]   -= amount;
            if (entry.toAccount in balances) balances[entry.toAccount] += amount;
        }
    });

    return balances;
}

/** Account rows are user-shaped, so they are read back before any rebuild. */
function readLedgerAccounts() {
    document.querySelectorAll('#ledgerAccounts .bgt-row').forEach((row) => {
        const account = accountById(row.dataset.cat);
        if (!account) return;
        account.name     = row.querySelector('.bgt-label').value;
        account.opening  = row.querySelector('.bgt-amount').value;
        const type       = row.querySelector('.acct-type').value;
        if (type !== TYPE_EDIT) account.type = type;
        // The picker's last option opens the editor instead of naming a
        // purpose, so it never becomes one.
        const purpose = row.querySelector('.acct-purpose').value;
        if (purpose !== PURPOSE_EDIT) account.purpose = purpose;
        account.currency = row.querySelector('.acct-currency').value;
        account.status   = row.querySelector('.acct-status').value;
    });
}

function buildLedgerAccounts() {
    const host = $('ledgerAccounts');
    if (!host) return;
    host.innerHTML = '';

    ledgerState.accounts.forEach((account, index) => {
        const row = document.createElement('div');
        row.className = 'bgt-row is-custom is-acct' + (account.status === 'closed' ? ' is-off' : '');
        row.dataset.cat = account.id;
        const options = (map, chosen) => Object.entries(map).map(([key, label]) =>
            '<option value="' + key + '"' + (key === chosen ? ' selected' : '') + '>' +
            escapeHtml(label) + '</option>').join('');
        const plainOptions = (list, chosen, blank) => list.map((value) =>
            '<option value="' + escapeHtml(value) + '"' + (value === chosen ? ' selected' : '') + '>' +
            escapeHtml(value || blank) + '</option>').join('');

        row.innerHTML =
            '<span class="bgt-icon"><i class="bi bi-wallet2"></i></span>' +
            '<div class="bgt-meta"><input type="text" class="bgt-label"></div>' +
            '<select class="bgt-bucket acct-type" aria-label="Kind of account">' +
                typeOptions(account.type) + '</select>' +
            '<div class="money-input money-input-sm"><span class="affix">' +
                escapeHtml(currencySymbol(account.currency)) + '</span>' +
                '<input type="number" class="bgt-amount" step="10" placeholder="0" inputmode="decimal"></div>' +
            '<button type="button" class="split-x" data-remove-account aria-label="Remove account">' +
                '<i class="bi bi-x-lg"></i></button>' +

            '<div class="acct-more">' +
                '<select class="acct-purpose" aria-label="What the account is for">' +
                    purposeOptions(account.purpose) + '</select>' +
                '<select class="acct-currency" aria-label="Currency">' +
                    plainOptions(CURRENCIES, account.currency, BASE_CURRENCY) + '</select>' +
                '<select class="acct-status" aria-label="Status">' +
                    options(ACCOUNT_STATUSES, account.status) + '</select>' +
            '</div>';

        // Assigned rather than interpolated — these are user-typed strings.
        const label = row.querySelector('.bgt-label');
        label.value = account.name;
        label.placeholder = 'Account ' + (index + 1);
        row.querySelector('.bgt-amount').value = account.opening;

        host.appendChild(row);
    });
}

/**
 * --------------------------------------------------------------------
 * Kinds of account
 * --------------------------------------------------------------------
 * A kind is what sort of place the money sits in, and it is what the balance
 * panels group by. Unlike a purpose it is not a note: every account is one, so
 * the list can never be emptied, and a kind that accounts are filed under is
 * not removed out from under them — the same bargain a category with entries
 * behind it gets.
 *
 * Renaming is free, though: an account points at the kind's id, never at its
 * wording, so a rename is a rename and nothing more.
 */
const typeById = (id) => ledgerState.types.find((t) => t.id === id) || null;

/** The wording for a kind, and something honest when the kind is gone. */
const typeLabel = (id) => {
    const type = typeById(id);
    if (type) return type.label;
    return ledgerState.types.length ? ledgerState.types[0].label : 'Bank';
};

/** What a new account is, until it is told otherwise. */
const defaultTypeId = () => (ledgerState.types[0] || {}).id || 'bank';

function typeOptions(chosen) {
    const list = ledgerState.types.filter((t) => t.label.trim());

    return list.map((type) =>
        '<option value="' + escapeHtml(type.id) + '"' + (type.id === chosen ? ' selected' : '') + '>' +
        escapeHtml(type.label) + '</option>').join('') +
        '<option value="' + TYPE_EDIT + '">Edit kinds\u2026</option>';
}

/** One row per kind, with how many accounts stand behind it. */
function buildTypeRows() {
    const host = $('ledgerTypes');
    if (!host) return;
    host.innerHTML = '';

    ledgerState.types.forEach((type, index) => {
        const held = ledgerState.accounts.filter((a) => a.type === type.id).length;

        const row = document.createElement('div');
        row.className = 'purpose-row';
        row.dataset.type = type.id;
        row.innerHTML =
            '<input type="text" class="type-name" placeholder="Kind ' + (index + 1) +
                '" aria-label="Name of this kind of account">' +
            '<small>' + (held ? held + (held === 1 ? ' account' : ' accounts') : 'unused') + '</small>' +
            '<button type="button" class="split-x" data-drop-type aria-label="Remove kind">' +
                '<i class="bi bi-x-lg"></i></button>';

        // Assigned rather than interpolated — the wording is user-typed.
        row.querySelector('.type-name').value = type.label;
        host.appendChild(row);
    });
}

/** Everything that shows a kind, after the list has moved under it. */
function afterTypeChange() {
    buildLedgerAccounts();
    buildCategoryManager();
    buildTypeRows();
    renderLedger();
}

/** Open, close, or toggle the kinds editor. A kind left unnamed keeps its old
 *  wording, so there is nothing to tidy on the way out. */
function typeEditor(open) {
    const panel = $('ledgerTypeEdit');
    if (!panel) return;
    const show = open === undefined ? panel.hidden : open;

    panel.hidden = !show;
    const button = $('ledgerEditTypes');
    if (button) button.setAttribute('aria-expanded', String(show));
    if (show) buildTypeRows();
}

function addType() {
    readLedgerAccounts();
    ledgerState.types.push({ id: ledgerId('t'), label: '' });
    buildTypeRows();

    const fresh = document.querySelector('#ledgerTypes .purpose-row:last-child .type-name');
    if (fresh) {
        reveal(fresh).focus({ preventScroll: true });
        fresh.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

/**
 * A kind with no wording cannot be picked, so a blank name is either an
 * abandoned Add — which goes — or an edit that has to be put back.
 */
function renameType(input) {
    const row  = input.closest('.purpose-row');
    const type = typeById(row.dataset.type);
    if (!type) return;

    const name = input.value.trim();

    if (!name) {
        if (!type.label) {
            ledgerState.types = ledgerState.types.filter((t) => t.id !== type.id);
            buildTypeRows();
            return;
        }
        input.value = type.label;
        ledgerHint('A kind needs a name — use the ✕ to remove one.');
        return;
    }

    if (ledgerState.types.some((t) => t.id !== type.id && t.label.toLowerCase() === name.toLowerCase())) {
        input.value = type.label;
        ledgerHint('There is already a kind called “' + name + '”.');
        return;
    }

    if (name === type.label) { input.value = name; return; }

    readLedgerAccounts();
    type.label = name;
    afterTypeChange();
}

/**
 * Accounts are filed under a kind, so removing one with accounts behind it
 * would move balances into a group the reader never chose. It stays until
 * those accounts are moved, and the row says so rather than failing quietly.
 */
function dropType(row) {
    const type = typeById(row.dataset.type);
    if (!type) return;

    readLedgerAccounts();
    const held = ledgerState.accounts.filter((a) => a.type === type.id).length;

    if (held || ledgerState.types.length <= 1) {
        row.classList.add('is-locked');
        setTimeout(() => row.classList.remove('is-locked'), 1400);
        ledgerHint(held
            ? held + (held === 1 ? ' account is' : ' accounts are') +
              ' that kind — move ' + (held === 1 ? 'it' : 'them') + ' to another kind first.'
            : 'Keep at least one kind — an account has to be something.');
        return;
    }

    ledgerState.types = ledgerState.types.filter((t) => t.id !== type.id);
    afterTypeChange();
    ledgerHint('“' + type.label + '” is gone.');
}

/** The last option in a kind picker asks for the editor, not for a kind. */
function onAccountTypePick(event) {
    const select = event.target.closest('.acct-type');
    if (!select || select.value !== TYPE_EDIT) return;

    const account = accountById(select.closest('.bgt-row').dataset.cat);
    select.value = account ? account.type : defaultTypeId();

    typeEditor(true);
    const panel = $('ledgerTypeEdit');
    if (panel) reveal(panel).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * --------------------------------------------------------------------
 * Purposes
 * --------------------------------------------------------------------
 * A purpose is the reader's own word for what an account is for, so the list
 * is theirs to add to, rename and shorten. It is a label on an account and
 * nothing else — no entry points at one — so renaming a purpose only has to
 * carry the accounts holding it, and removing one only has to let them go.
 * That is why this list can be edited freely where a category cannot.
 */
const purposeList = () => ledgerState.purposes.filter(Boolean);

/** The blank, the reader's list, and the way into the editor. */
function purposeOptions(chosen) {
    const list = purposeList();
    // A purpose an account still carries but the list has lost would drop the
    // row back to blank without a word. It stays on the row until cleared.
    if (chosen && !list.includes(chosen)) list.push(chosen);

    return ['', ...list].map((value) =>
        '<option value="' + escapeHtml(value) + '"' + (value === chosen ? ' selected' : '') + '>' +
        escapeHtml(value || 'No stated purpose') + '</option>').join('') +
        '<option value="' + PURPOSE_EDIT + '">Edit purposes\u2026</option>';
}

/** One row per purpose, with what it is holding — the count is the warning. */
function buildPurposeRows() {
    const host = $('ledgerPurposes');
    if (!host) return;
    host.innerHTML = '';

    if (!ledgerState.purposes.length) {
        host.innerHTML = '<p class="combo-none">No purposes yet. An account can go without one \u2014 ' +
            'add a purpose when there is something worth saying about what it is for.</p>';
        return;
    }

    ledgerState.purposes.forEach((purpose, index) => {
        const held = purpose
            ? ledgerState.accounts.filter((a) => a.purpose === purpose).length
            : 0;

        const row = document.createElement('div');
        row.className = 'purpose-row';
        row.dataset.index = String(index);
        row.innerHTML =
            '<input type="text" class="purpose-name" placeholder="Purpose ' + (index + 1) +
                '" aria-label="Purpose name">' +
            '<small>' + (held ? held + (held === 1 ? ' account' : ' accounts') : 'unused') + '</small>' +
            '<button type="button" class="split-x" data-drop-purpose aria-label="Remove purpose">' +
                '<i class="bi bi-x-lg"></i></button>';

        // Assigned rather than interpolated — the name is user-typed.
        row.querySelector('.purpose-name').value = purpose;
        host.appendChild(row);
    });
}

/** Everything that shows a purpose, after the list has moved under it. */
function afterPurposeChange() {
    buildLedgerAccounts();
    buildCategoryManager();
    buildPurposeRows();
    renderLedger();
}

/**
 * Open, close, or toggle the editor. Closing drops rows that were added and
 * never named: a blank purpose is an abandoned Add, not a nameless purpose.
 */
function purposeEditor(open) {
    const panel = $('ledgerPurposeEdit');
    if (!panel) return;
    const show = open === undefined ? panel.hidden : open;

    if (!show && ledgerState.purposes.length !== purposeList().length) {
        ledgerState.purposes = purposeList();
        afterPurposeChange();
    }

    panel.hidden = !show;
    const button = $('ledgerEditPurposes');
    if (button) button.setAttribute('aria-expanded', String(show));
    if (show) buildPurposeRows();
}

function addPurpose() {
    readLedgerAccounts();
    ledgerState.purposes.push('');
    buildPurposeRows();

    const fresh = document.querySelector('#ledgerPurposes .purpose-row:last-child .purpose-name');
    if (fresh) {
        reveal(fresh).focus({ preventScroll: true });
        fresh.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

/**
 * Renaming carries every account holding the old word across — that is the
 * whole point of a shared list. Two purposes with one name would be two rows
 * the picker cannot tell apart, so the second one is refused rather than
 * quietly merged.
 */
function renamePurpose(input) {
    const row   = input.closest('.purpose-row');
    const index = Number(row.dataset.index);
    const was   = ledgerState.purposes[index];
    if (was === undefined) return;

    const name = input.value.trim();

    if (!name) {
        // Never named: the Add was abandoned. Named once: emptying the box is
        // not how a purpose is removed, and the ✕ is right there.
        if (!was) { ledgerState.purposes.splice(index, 1); buildPurposeRows(); return; }
        input.value = was;
        ledgerHint('A purpose needs a name — use the ✕ to remove one.');
        return;
    }

    if (name.toLowerCase() === PURPOSE_EDIT) { input.value = was; return; }

    if (ledgerState.purposes.some((p, i) => i !== index && p.toLowerCase() === name.toLowerCase())) {
        input.value = was;
        ledgerHint('There is already a purpose called “' + name + '”.');
        return;
    }

    if (name === was) { input.value = name; return; }

    readLedgerAccounts();
    if (was) ledgerState.accounts.forEach((a) => { if (a.purpose === was) a.purpose = name; });
    ledgerState.purposes[index] = name;
    afterPurposeChange();
}

/**
 * Removing a purpose takes it off the accounts carrying it. Nothing else
 * points at a purpose, so nothing is lost but the note — and the accounts
 * that lost it are told out loud rather than changed quietly.
 */
function dropPurpose(row) {
    const index = Number(row.dataset.index);
    const name  = ledgerState.purposes[index];
    if (name === undefined) return;

    readLedgerAccounts();
    const held = name ? ledgerState.accounts.filter((a) => a.purpose === name) : [];
    held.forEach((account) => { account.purpose = ''; });
    ledgerState.purposes.splice(index, 1);
    afterPurposeChange();

    if (name) {
        ledgerHint(held.length
            ? '“' + name + '” is gone — ' + held.length +
              (held.length === 1 ? ' account is' : ' accounts are') + ' back to no stated purpose.'
            : '“' + name + '” is gone.');
    }
}

/**
 * Picking the last option in an account's purpose list is a request to edit
 * the list, so the picker is put back where it was and the editor opens.
 */
function onAccountPurposePick(event) {
    const select = event.target.closest('.acct-purpose');
    if (!select || select.value !== PURPOSE_EDIT) return;

    const account = accountById(select.closest('.bgt-row').dataset.cat);
    select.value = account ? account.purpose : '';

    purposeEditor(true);
    const panel = $('ledgerPurposeEdit');
    if (panel) reveal(panel).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * --------------------------------------------------------------------
 * The categories card
 * --------------------------------------------------------------------
 * Rows are the state, so they are read back before anything structural
 * happens to them — the same rule the accounts card follows. A row that is
 * being typed into is never rebuilt underneath the caret; only the pickers
 * that read the list are.
 */
/** Which of the three lists the card is showing. */
const categorySide = () => (($('categorySide') || {}).dataset || {}).value || 'spend';

function readCategoryRows() {
    // Payment methods are accounts, and accounts are read back by their own
    // reader — the one the Accounts card uses, so the two cannot drift.
    document.querySelectorAll('#categoryList .cat-row[data-account]').forEach((row) => {
        const account = accountById(row.dataset.account);
        if (account) account.name = row.querySelector('.cat-name').value;
    });

    document.querySelectorAll('#categoryList .cat-row[data-cat]').forEach((row) => {
        const cat = categoryById(row.dataset.cat);
        if (!cat) return;
        cat.label  = row.querySelector('.cat-name').value;
        cat.bucket = row.querySelector('.cat-bucket').value;

        row.querySelectorAll('.cat-sub').forEach((subRow) => {
            const sub = cat.subs.find((x) => x.id === subRow.dataset.sub);
            if (sub) sub.label = subRow.querySelector('.cat-sub-name').value;
        });
    });
}

/** Which categories have their sub-list open. Not saved: it is a view, not data. */
const categoryOpen = new Set();

function categoryRowHtml(cat, index, useCount) {
    const label = categoryLabel(cat, index);
    const subs  = cat.subs.length;

    const bucketOptions = Object.entries(CATEGORY_BUCKETS).map(([key, name]) =>
        '<option value="' + key + '"' + (key === cat.bucket ? ' selected' : '') + '>' +
        escapeHtml(name) + '</option>').join('');

    const subRows = cat.subs.map((sub) =>
        '<div class="cat-sub" data-sub="' + sub.id + '">' +
            '<input type="text" class="cat-sub-name" value="' + escapeHtml(sub.label) +
                '" placeholder="Sub-category" aria-label="Sub-category name">' +
            '<button type="button" class="split-x" data-drop-sub aria-label="Remove sub-category">' +
                '<i class="bi bi-x-lg"></i></button>' +
        '</div>').join('');

    return '' +
        '<div class="cat-main">' +
            '<button type="button" class="cat-disc tone-' + cat.tone + '" data-open-look ' +
                'aria-label="Icon and colour for ' + escapeHtml(label) + '">' +
                '<i class="bi ' + escapeHtml(cat.icon) + '"></i></button>' +

            '<div class="cat-id">' +
                '<input type="text" class="cat-name" value="' + escapeHtml(cat.label) +
                    '" placeholder="Category ' + (index + 1) + '" aria-label="Category name">' +
                '<small>' + escapeHtml(CATEGORY_BUCKETS[cat.bucket]) + ' · ' + (useCount
                    ? useCount + (useCount === 1 ? ' entry' : ' entries')
                    : 'nothing recorded yet') +
                    (subs ? ' · ' + subs + (subs === 1 ? ' sub-category' : ' sub-categories') : '') +
                '</small>' +
            '</div>' +

            '<button type="button" class="cat-act" data-toggle-subs aria-expanded="' +
                (categoryOpen.has(cat.id) ? 'true' : 'false') + '" title="Sub-categories">' +
                '<i class="bi bi-diagram-2"></i><b>' + subs + '</b></button>' +

            '<button type="button" class="cat-act" data-toggle-on title="' +
                (cat.enabled ? 'In use — click to retire it' : 'Retired — click to bring it back') + '">' +
                '<i class="bi ' + (cat.enabled ? 'bi-eye' : 'bi-eye-slash') + '"></i></button>' +

            '<button type="button" class="split-x" data-drop-cat aria-label="Delete category">' +
                '<i class="bi bi-trash3"></i></button>' +
        '</div>' +

        '<div class="cat-look" hidden>' +
            '<label class="cat-look-row"><span>Bucket</span>' +
                '<select class="cat-bucket" aria-label="Bucket">' + bucketOptions + '</select>' +
            '</label>' +
            '<div class="cat-swatches">' + CATEGORY_TONES.map((tone) =>
                '<button type="button" class="cat-swatch tone-' + tone + (tone === cat.tone ? ' is-on' : '') +
                '" data-tone="' + tone + '" aria-label="' + tone + '"></button>').join('') + '</div>' +
            '<div class="cat-icons">' + CATEGORY_ICONS.map((icon) =>
                '<button type="button" class="cat-icon' + (icon === cat.icon ? ' is-on' : '') +
                '" data-icon="' + icon + '"><i class="bi ' + icon + '"></i></button>').join('') + '</div>' +
        '</div>' +

        '<div class="cat-subs"' + (categoryOpen.has(cat.id) ? '' : ' hidden') + '>' +
            subRows +
            '<button type="button" class="field-add" data-add-sub>' +
                '<i class="bi bi-plus-circle"></i> Add sub-category</button>' +
        '</div>';
}

/**
 * Closing a payment method takes it out of the pickers and leaves every entry
 * against it alone — the same bargain a retired category gets, for the same
 * reason: the history is a record of what happened, not of what is current.
 */
function onMethodClick(event, row) {
    const account = accountById(row.dataset.account);
    if (!account) return;

    if (event.target.closest('[data-toggle-on]')) {
        readCategoryRows();
        readLedgerAccounts();

        const open = ledgerState.accounts.filter((a) => a.status !== 'closed');
        if (account.status !== 'closed' && open.length <= 1) {
            ledgerHint('Keep one open — an entry has to come out of something.');
            return;
        }

        account.status = account.status === 'closed' ? 'active' : 'closed';
        buildLedgerAccounts();
        buildCategoryManager();
        renderLedger();
        return;
    }

    if (!event.target.closest('[data-drop-cat]')) return;

    readCategoryRows();
    readLedgerAccounts();

    const held = ledgerState.entries.filter(
        (e) => e.account === account.id || e.toAccount === account.id).length;

    if (held || ledgerState.accounts.length <= 1) {
        row.classList.add('is-locked');
        setTimeout(() => row.classList.remove('is-locked'), 1400);
        ledgerHint(held
            ? held + (held === 1 ? ' entry is' : ' entries are') +
              ' paid from that — close it with the eye instead, or move them first.'
            : 'Keep at least one: an entry has to come out of something.');
        return;
    }

    ledgerState.accounts = ledgerState.accounts.filter((a) => a.id !== account.id);
    buildLedgerAccounts();
    buildCategoryManager();
    renderLedger();
}

/**
 * A payment method row. Narrower than a category's: an account has no bucket,
 * no sub-categories and no tint, and its money — opening balance, kind,
 * currency — belongs on the Accounts card rather than here. This is for
 * naming them, which is the part that gets done often.
 */
function accountRowHtml(account, index, useCount) {
    const balance = accountBalances()[account.id] || 0;

    return '' +
        '<div class="cat-main">' +
            '<span class="cat-disc tone-jade"><i class="bi bi-wallet2"></i></span>' +
            '<div class="cat-id">' +
                '<input type="text" class="cat-name" value="' + escapeHtml(account.name) +
                    '" placeholder="Account ' + (index + 1) + '" aria-label="Payment method name">' +
                '<small>' + escapeHtml(typeLabel(account.type)) +
                    (account.purpose ? ' \u00b7 ' + escapeHtml(account.purpose) : '') +
                    ' \u00b7 ' + signedMoney(balance) +
                    ' \u00b7 ' + (useCount ? useCount + (useCount === 1 ? ' entry' : ' entries')
                                            : 'nothing recorded yet') +
                '</small>' +
            '</div>' +
            '<button type="button" class="cat-act" data-toggle-on title="' +
                (account.status !== 'closed' ? 'In use — click to close it'
                                             : 'Closed — click to reopen it') + '">' +
                '<i class="bi ' + (account.status !== 'closed' ? 'bi-eye' : 'bi-eye-slash') + '"></i></button>' +
            '<button type="button" class="split-x" data-drop-cat aria-label="Delete payment method">' +
                '<i class="bi bi-trash3"></i></button>' +
        '</div>';
}

function buildMethodManager(host) {
    const used = {};
    ledgerState.entries.forEach((e) => {
        used[e.account] = (used[e.account] || 0) + 1;
        if (e.toAccount) used[e.toAccount] = (used[e.toAccount] || 0) + 1;
    });

    host.innerHTML = '';
    if (!ledgerState.accounts.length) {
        paintEmpty(host, 'No payment methods yet',
            'Add one — an entry has to come out of something.', 'bi-wallet2');
        return;
    }
    clearEmpty(host);

    ledgerState.accounts.forEach((account, i) => {
        const row = document.createElement('div');
        row.className = 'cat-row is-method' + (account.status === 'closed' ? ' is-off' : '');
        row.dataset.account = account.id;
        row.innerHTML = accountRowHtml(account, i, used[account.id] || 0);
        host.appendChild(row);
    });
}

function buildCategoryManager() {
    const host = $('categoryList');
    if (!host) return;

    const side = categorySide();
    // The card explains two different lists, so it carries two closing lines
    // and shows whichever one is being looked at.
    if ($('categoryMethodHint')) $('categoryMethodHint').hidden = side !== 'method';
    if ($('categoryListHint'))   $('categoryListHint').hidden = side === 'method';

    if (side === 'method') { buildMethodManager(host); return; }

    // How often each category is actually used decides whether it may be
    // deleted, so it is counted once here rather than per row.
    const used = {};
    ledgerState.entries.forEach((e) => { used[e.category] = (used[e.category] || 0) + 1; });

    const rows = categoryState.list
        .map((cat, i) => ({ cat, i }))
        .filter(({ cat }) => (cat.bucket === 'income') === (side === 'income'));

    host.innerHTML = '';

    if (!rows.length) {
        paintEmpty(host, 'No categories on this side yet',
            'Add one and it joins the picker straight away.', 'bi-tags');
        return;
    }
    clearEmpty(host);

    rows.forEach(({ cat, i }) => {
        const row = document.createElement('div');
        row.className = 'cat-row' + (cat.enabled ? '' : ' is-off');
        row.dataset.cat = cat.id;
        row.innerHTML = categoryRowHtml(cat, i, used[cat.id] || 0);
        host.appendChild(row);
    });
}

/** Everything that reads a category has to be told when one changes. */
function afterCategoryChange(rebuildRows) {
    saveCategories();
    if (rebuildRows) buildCategoryManager();
    buildCategoryOptions();
    buildCommitOptions();
    buildCardOptions();
    buildBudgetRows();
    renderLedger();
    renderBudget();
    renderCommit();
    renderCard();
}

function addCategory() {
    readCategoryRows();
    const side = categorySide();

    if (side === 'method') {
        ledgerState.accounts.push({
            id: ledgerId('a'), name: '', type: defaultTypeId(), purpose: '',
            currency: BASE_CURRENCY, opening: '', status: 'active',
        });
        buildLedgerAccounts();
        buildCategoryManager();
        renderLedger();
        const fresh = document.querySelector('#categoryList .cat-row:last-child .cat-name');
        if (fresh) { reveal(fresh).focus({ preventScroll: true }); reveal(fresh).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return;
    }

    categoryState.list.push({
        id: newCategoryId('c'),
        label: '',
        bucket: side === 'income' ? 'income' : 'wants',
        icon: 'bi-tag',
        tone: 'jade',
        hint: '',
        enabled: true,
        subs: [],
    });
    afterCategoryChange(true);

    const input = document.querySelector('#categoryList .cat-row:last-child .cat-name');
    if (input) { reveal(input).focus({ preventScroll: true }); reveal(input).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

function onCategoryClick(event) {
    const row = event.target.closest('.cat-row');
    if (!row) return;

    if (row.dataset.account) { onMethodClick(event, row); return; }

    const cat = categoryById(row.dataset.cat);
    if (!cat) return;

    const hit = (sel) => event.target.closest(sel);

    if (hit('[data-toggle-subs]')) {
        if (categoryOpen.has(cat.id)) categoryOpen.delete(cat.id); else categoryOpen.add(cat.id);
        const subs = row.querySelector('.cat-subs');
        subs.hidden = !categoryOpen.has(cat.id);
        row.querySelector('[data-toggle-subs]').setAttribute('aria-expanded', String(!subs.hidden));
        return;
    }

    if (hit('[data-open-look]')) {
        const look = row.querySelector('.cat-look');
        look.hidden = !look.hidden;
        return;
    }

    const swatch = hit('[data-tone]');
    if (swatch) {
        readCategoryRows();
        cat.tone = swatch.dataset.tone;
        afterCategoryChange(true);
        return;
    }

    const icon = hit('[data-icon]');
    if (icon) {
        readCategoryRows();
        cat.icon = icon.dataset.icon;
        afterCategoryChange(true);
        return;
    }

    if (hit('[data-toggle-on]')) {
        readCategoryRows();
        cat.enabled = !cat.enabled;
        afterCategoryChange(true);
        ledgerHint(cat.enabled
            ? categoryLabel(cat, 0) + ' is back in the pickers.'
            : categoryLabel(cat, 0) + ' is retired — its entries keep it, new ones cannot pick it.');
        return;
    }

    if (hit('[data-add-sub]')) {
        readCategoryRows();
        cat.subs.push({ id: newCategoryId('s'), label: '', enabled: true });
        categoryOpen.add(cat.id);
        afterCategoryChange(true);
        const last = document.querySelector('.cat-row[data-cat="' + cat.id + '"] .cat-sub:last-of-type .cat-sub-name');
        if (last) last.focus({ preventScroll: true });
        return;
    }

    const dropSub = hit('[data-drop-sub]');
    if (dropSub) {
        readCategoryRows();
        const subRow = dropSub.closest('.cat-sub');
        const subId  = subRow.dataset.sub;

        // A sub-category with entries behind it would take their detail with
        // it, so it stays until those entries are moved.
        const held = ledgerState.entries.filter((e) => e.sub === subId).length;
        if (held) {
            subRow.classList.add('is-locked');
            setTimeout(() => subRow.classList.remove('is-locked'), 1400);
            ledgerHint(held + (held === 1 ? ' entry is' : ' entries are') +
                ' filed under that sub-category — move those first.');
            return;
        }

        cat.subs = cat.subs.filter((s) => s.id !== subId);
        afterCategoryChange(true);
        return;
    }

    if (hit('[data-drop-cat]')) {
        readCategoryRows();
        const held = ledgerState.entries.filter((e) => e.category === cat.id).length;

        // Deleting a category with history would rename a year of entries to
        // "Other" behind the reader's back. Retiring it is the honest move,
        // and the button says so rather than failing silently.
        if (held) {
            row.classList.add('is-locked');
            setTimeout(() => row.classList.remove('is-locked'), 1400);
            ledgerHint(held + (held === 1 ? ' entry is' : ' entries are') +
                ' filed under that category — retire it with the eye instead, or move them first.');
            return;
        }

        const spending = categoryState.list.filter((c) => c.bucket !== 'income');
        if (cat.bucket !== 'income' && spending.length <= 1) {
            ledgerHint('Keep at least one spending category — an expense has to be called something.');
            return;
        }

        categoryState.list = categoryState.list.filter((c) => c.id !== cat.id);
        afterCategoryChange(true);
    }
}

/** Keep the two account pickers in step with the account list. */
function buildAccountOptions() {
    ['ledgerAccount', 'ledgerTo'].forEach((id) => {
        const select = $(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '';
        openAccounts().forEach((account, index) => {
            const option = document.createElement('option');
            option.value = account.id;
            // Names are user-typed, so they are set as text rather than markup.
            option.textContent = account.name.trim() || 'Account ' + (index + 1);
            select.appendChild(option);
        });
        if (ledgerState.accounts.some((a) => a.id === previous)) select.value = previous;
    });
    buildSplitExpenseOptions();
}

function buildCategoryOptions() {
    const select = $('ledgerCategory');
    if (!select) return;
    const list = categoryListFor(ledgerFormType());
    const previous = select.value;

    select.innerHTML = '';
    list.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.label;
        select.appendChild(option);
    });
    if (list.some((c) => c.id === previous)) select.value = previous;
    buildSubOptions();
    buildSplitExpenseOptions();
}

/** The currency list never changes while the app is open, so it is built
 *  once at start-up rather than on every repaint. */
function buildStaticOptions() {
    buildCurrencyList();
    setLedgerCurrency(BASE_CURRENCY);
}

/** The second picker. Rebuilt whenever the first one moves, and hidden
 *  entirely for a category that has no sub-categories under it. */
function buildSubOptions() {
    const select = $('ledgerSub');
    const field  = $('ledgerFieldSub');
    if (!select) return;

    const subs = subListFor((($('ledgerCategory') || {}).value) || '');
    const previous = select.value;

    select.innerHTML = '<option value="">' + (subs.length ? 'No sub-category' : 'None') + '</option>';
    subs.forEach((sub) => {
        const option = document.createElement('option');
        option.value = sub.id;
        option.textContent = sub.label.trim();
        select.appendChild(option);
    });

    if (subs.some((sub) => sub.id === previous)) select.value = previous;
    if (field) field.hidden = !subs.length;
}

/**
 * Any category by id, retired or not. Only the pickers filter on `enabled` —
 * a record keeps the name it was filed under, or retiring a category would
 * quietly rewrite a year of history as "Others". The fallback is for an id
 * that is genuinely gone, which is the only case where there is nothing
 * truthful left to print.
 */
function resolveCategory(id, type) {
    const cat = categoryById(id);
    if (cat) return shapedCategoryRow(cat, categoryState.list.indexOf(cat));
    const list = categoryListFor(type || 'expense');
    return list[list.length - 1] || null;
}

const categoryOf = (entry) => resolveCategory(entry.category, entry.type);

/**
 * --------------------------------------------------------------------
 * Reading the book
 * --------------------------------------------------------------------
 */
/**
 * --------------------------------------------------------------------
 * Money in two currencies
 * --------------------------------------------------------------------
 * An entry spent abroad carries two figures: `amount`, in the currency it was
 * actually paid in, and `base`, what that cost in ringgit. Every total in the
 * app is built from `base`, because 80,000 is a fortune in ringgit and lunch
 * in dong, and a column that mixes them is not a column of anything.
 *
 * The rate is not fetched and not guessed. It is whatever the two figures
 * imply, frozen at the moment of the transaction — which is also the truthful
 * one: you really did part with that many ringgit that day, whatever the rate
 * did afterwards. A rate looked up today would rewrite last year's holiday.
 */
const isForeign = (entry) => !!entry.currency && entry.currency !== BASE_CURRENCY;

/** A foreign entry with no ringgit figure cannot be totalled. It is not worth
 *  zero and it is not worth its face value — it is worth "not yet said". */
const entryNeedsRate = (entry) => isForeign(entry) && !(parseFloat(entry.base) > 0);

const entrySen = (entry) => {
    if (isForeign(entry)) return Math.max(0, toSen(parseFloat(entry.base) || 0));
    return Math.max(0, toSen(parseFloat(entry.amount) || 0));
};

/**
 * --------------------------------------------------------------------
 * Money back
 * --------------------------------------------------------------------
 * A fourth kind of entry, and the one the other three could not say.
 *
 * You pay RM71.20 for a lunch three people share, and record all of it,
 * because that is what left your account and what the bank statement says.
 * Then they pay you back. That money is not income — nobody paid you for
 * anything — and it is not a transfer, because it came from someone else's
 * pocket into yours. It is the expense partly coming back.
 *
 * So a refund raises the account it lands in *and* takes its amount back off
 * the category it is filed under. After all three have paid, the lunch reads
 * as the RM17.80 you actually ate, in the month you ate it, and your income
 * never mentions it. A shop return and a cancelled order are the same shape.
 *
 * Everywhere spending is added up, it is added up with `spendSen`, which is
 * an expense as a plus and a refund as a minus. Nothing else has to know.
 */
const isSpend = (entry) => entry.type === 'expense' || entry.type === 'refund';

/** Spending, signed: what was spent, less what came back. */
const spendSen = (entry) => (entry.type === 'refund' ? -entrySen(entry) : entrySen(entry));

/** What was handed over, in the currency it was handed over in. */
const entryFaceValue = (entry) =>
    currencySymbol(entry.currency) + ' ' + fmt(parseFloat(entry.amount) || 0);

/** Newest day first, and within a day the most recently added sits on top. */
function ledgerEntriesFor(monthKey) {
    return ledgerState.entries
        .filter((entry) => monthOf(entry.date) === monthKey)
        .sort((a, b) => (a.date === b.date ? b.seq - a.seq : (a.date < b.date ? 1 : -1)));
}

function ledgerTotals(entries) {
    let incomeSen = 0, expenseSen = 0, movedSen = 0, backSen = 0;
    entries.forEach((entry) => {
        const amount = entrySen(entry);
        if (entry.type === 'income') incomeSen += amount;
        else if (entry.type === 'expense') expenseSen += amount;
        else if (entry.type === 'refund') backSen += amount;
        else movedSen += amount;
    });

    // Spending is what went out less what came back. Reported that way it is
    // the figure a reader can check against what they actually consumed.
    return {
        incomeSen, movedSen, backSen,
        grossExpenseSen: expenseSen,
        expenseSen: expenseSen - backSen,
        netSen: incomeSen - (expenseSen - backSen),
    };
}

function ledgerCompute() {
    const month   = ledgerState.month || monthOf(todayIso());
    const entries = ledgerEntriesFor(month);
    const totals  = ledgerTotals(entries);

    const byCategory = {};
    entries.filter(isSpend).forEach((entry) => {
        const cat = categoryOf(entry);
        byCategory[cat.id] = (byCategory[cat.id] || 0) + spendSen(entry);
    });

    const categories = Object.entries(byCategory)
        .map(([id, sen]) => ({ cat: resolveCategory(id, 'expense'), sen }))
        .filter((row) => row.cat)
        .sort((a, b) => b.sen - a.sen);

    return {
        month, entries, categories, balances: accountBalances(),
        incomeSen: totals.incomeSen, expenseSen: totals.expenseSen,
        movedSen: totals.movedSen, netSen: totals.netSen,
    };
}

/** What the Planner set aside for a category, for the month the ledger is
 *  showing — not for whichever period the Planner is open on. */
function budgetedSenFor(categoryId) {
    const [y, m] = isoNums((ledgerState.month || monthOf(todayIso())) + '-01');
    if (!y || !m) return 0;
    return budgetLineSen(budgetLinesFor(monthFirst(y, m), monthLast(y, m)), categoryId);
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
function paintLedgerList(book) {
    const host = $('ledgerList');
    if (!host) return;
    host.innerHTML = '';

    set('ledgerListTitle', monthKeyLabel(book.month));
    const unrated = book.entries.filter(entryNeedsRate).length;

    set('ledgerListNote', book.entries.length
        ? book.entries.length + (book.entries.length === 1 ? ' entry' : ' entries') +
          (book.movedSen ? ' · ' + money(fromSen(book.movedSen)) + ' moved between accounts' : '')
        : '');

    const warn = $('ledgerRateWarn');
    if (warn) {
        warn.hidden = !unrated;
        warn.textContent = unrated + (unrated === 1
            ? ' entry was paid in another currency and has no ringgit figure, so it counts as nothing in every total below. Open it and say what it cost.'
            : ' entries were paid in another currency and have no ringgit figure, so they count as nothing in every total below. Open each one and say what it cost.');
    }

    if (!book.entries.length) {
        paintEmpty(host, 'Nothing written down for ' + monthKeyLabel(book.month),
            'Put in what you spent above — amount, what it was, done.', 'bi-journal-text');
        return;
    }

    clearEmpty(host);

    // Group by day, keeping the order the entries already arrived in.
    const days = [];
    book.entries.forEach((entry) => {
        let day = days[days.length - 1];
        if (!day || day.date !== entry.date) {
            day = { date: entry.date, entries: [] };
            days.push(day);
        }
        day.entries.push(entry);
    });

    days.forEach((day) => {
        const totals = ledgerTotals(day.entries);
        const parts = dayParts(day.date);

        const head = document.createElement('div');
        head.className = 'led-day';
        head.innerHTML =
            '<span class="led-date"><b>' + parts.day + '</b><em>' + parts.weekday + '</em></span>' +
            '<span class="led-day-sums">' +
                (totals.incomeSen ? '<i class="is-in">+ ' + money(fromSen(totals.incomeSen)) + '</i>' : '') +
                (totals.expenseSen ? '<i class="is-out">− ' + money(fromSen(totals.expenseSen)) + '</i>' : '') +
                (!totals.incomeSen && !totals.expenseSen ? '<i class="is-move">moved only</i>' : '') +
            '</span>';
        host.appendChild(head);

        day.entries.forEach((entry) => {
            const cat = categoryOf(entry);
            const row = document.createElement('div');
            row.className = 'led-entry' + (entryNeedsRate(entry) ? ' needs-rate' : '');
            row.dataset.entry = entry.id;

            const sign = entry.type === 'income' || entry.type === 'refund' ? '+ '
                : entry.type === 'expense' ? '− ' : '';
            const tone = entry.type === 'income' ? 'is-in'
                : entry.type === 'refund' ? 'is-back'
                : entry.type === 'expense' ? 'is-out' : 'is-move';

            row.innerHTML =
                '<span class="led-icon led-' + entry.type + '"><i class="bi ' +
                    (entry.type === 'transfer' ? 'bi-arrow-left-right' : cat.icon) + '"></i></span>' +
                '<button type="button" class="led-meta" data-edit-entry>' +
                    '<b></b><small></small></button>' +
                '<span class="led-amount ' + tone + '">' + sign +
                    money(fromSen(entrySen(entry))) +
                    (isForeign(entry)
                        ? '<em>' + escapeHtml(entryFaceValue(entry)) + '</em>'
                        : '') +
                '</span>' +
                '<button type="button" class="split-x" data-remove-entry aria-label="Delete entry">' +
                    '<i class="bi bi-x-lg"></i></button>';

            // Notes and account names are user-typed, so they go in as text.
            row.querySelector('.led-meta b').textContent = entry.note.trim() || cat.label;
            row.querySelector('.led-meta small').textContent = entry.type === 'transfer'
                ? accountName(entry.account) + ' → ' + accountName(entry.toAccount)
                : cat.label + ' · ' + accountName(entry.account);

            host.appendChild(row);
        });
    });
}

function paintLedgerCategories(book) {
    const dist   = $('ledgerDist');
    const legend = $('ledgerLegend');
    const body   = $('ledgerCatBody');
    if (!dist || !legend || !body) return;

    dist.innerHTML = '';
    legend.innerHTML = '';
    body.innerHTML = '';

    const table = body.closest('.table-wrap');
    showWithData(!!book.expenseSen, dist, legend, table);

    if (!book.expenseSen) {
        paintEmpty(dist, 'Nothing spent in ' + monthKeyLabel(book.month),
            'File an entry above and the breakdown builds itself.', 'bi-pie-chart');
        dist.hidden = false;
        set('ledgerCatNote', '');
        return;
    }

    clearEmpty(dist);

    set('ledgerCatNote', book.categories.length +
        (book.categories.length === 1 ? ' category' : ' categories') +
        ' · biggest is ' + book.categories[0].cat.label);

    // Split by bucket, so the bar reads the same way as the Budget Planner's.
    const buckets = { needs: 0, wants: 0, save: 0 };
    book.categories.forEach((row) => { buckets[row.cat.bucket] += row.sen; });

    Object.entries(BUDGET_BUCKETS).forEach(([key, bucket]) => {
        if (!buckets[key]) return;

        const bar = document.createElement('span');
        bar.className = 'dist-' + bucket.tone;
        bar.style.width = (buckets[key] / book.expenseSen * 100) + '%';
        bar.title = bucket.label + ' · ' + money(fromSen(buckets[key]));
        dist.appendChild(bar);

        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML =
            '<i class="dot dot-' + bucket.tone + '"></i>' +
            '<span>' + bucket.label + ' <b>' + money(fromSen(buckets[key])) + '</b> ' +
            '<small>' + pct(buckets[key] / book.expenseSen * 100) + '</small></span>';
        legend.appendChild(item);
    });

    let budgetedTotal = 0;
    book.categories.forEach((row) => {
        const bucket = BUDGET_BUCKETS[row.cat.bucket];
        const budgeted = budgetedSenFor(row.cat.id);
        const left = budgeted - row.sen;
        budgetedTotal += budgeted;

        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong><i class="dot dot-' + bucket.tone + '"></i>' + escapeHtml(row.cat.label) + '</strong>' +
            '<small>' + bucket.label + '</small>'
        ));
        tr.appendChild(cell(fmt(fromSen(row.sen)), 'is-strong'));
        tr.appendChild(cell(pct(row.sen / book.expenseSen * 100), 'is-muted'));
        tr.appendChild(cell(budgeted ? fmt(fromSen(budgeted)) : '—', 'is-muted'));
        tr.appendChild(cell(
            budgeted ? (left < 0 ? '− ' : '') + fmt(Math.abs(fromSen(left))) : '—',
            !budgeted ? 'is-muted' : left < 0 ? 'is-minus' : 'is-plus'
        ));
        body.appendChild(tr);
    });

    const leftTotal = budgetedTotal - book.expenseSen;
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Spent'));
    totalRow.appendChild(cell(fmt(fromSen(book.expenseSen))));
    totalRow.appendChild(cell('100.0%'));
    totalRow.appendChild(cell(budgetedTotal ? fmt(fromSen(budgetedTotal)) : '—'));
    totalRow.appendChild(cell(budgetedTotal
        ? (leftTotal < 0 ? '− ' : '') + fmt(Math.abs(fromSen(leftTotal)))
        : '—'));
    body.appendChild(totalRow);
}

function paintLedgerBalances(book) {
    const host = $('ledgerBalances');
    if (!host) return;
    host.innerHTML = '';

    let assetsSen = 0, owingSen = 0;
    ledgerState.accounts.forEach((account) => {
        const balance = book.balances[account.id] || 0;
        if (balance >= 0) assetsSen += balance; else owingSen -= balance;
    });

    const signed = (sen) => (sen < 0 ? '− ' : '') + money(Math.abs(fromSen(sen)));

    set('ledgerAssets', money(fromSen(assetsSen)));
    set('ledgerOwing', owingSen ? '− ' + money(fromSen(owingSen)) : money(0));
    set('ledgerWorth', signed(assetsSen - owingSen));
    set('ledgerWorthNote', ledgerState.accounts.length +
        (ledgerState.accounts.length === 1 ? ' account' : ' accounts'));

    ledgerState.types.forEach(({ id: key, label }) => {
        const inGroup = ledgerState.accounts.filter((a) => a.type === key);
        if (!inGroup.length) return;

        const groupSen = inGroup.reduce((sum, a) => sum + (book.balances[a.id] || 0), 0);

        const head = document.createElement('div');
        head.className = 'acct-group';
        head.innerHTML = '<span>' + label + '</span><b>' + signed(groupSen) + '</b>';
        host.appendChild(head);

        inGroup.forEach((account, index) => {
            const balance = book.balances[account.id] || 0;
            const row = document.createElement('div');
            row.className = 'acct-row';
            row.innerHTML = '<span></span><b class="' + (balance < 0 ? 'is-minus' : '') + '">' +
                signed(balance) + '</b>';
            row.querySelector('span').textContent = account.name.trim() || 'Account ' + (index + 1);
            host.appendChild(row);
        });
    });
}

function paintLedger(book) {
    set('ledgerMonthLabel', monthKeyLabel(book.month));

    const spendingDays = new Set(
        book.entries.filter((e) => e.type === 'expense').map((e) => e.date)).size;

    set('ledgerSpent', money(fromSen(book.expenseSen)));
    set('ledgerSpentFoot', book.expenseSen
        ? spendingDays + (spendingDays === 1 ? ' day' : ' days') + ' with spending · ' +
          money(fromSen(Math.round(book.expenseSen / Math.max(1, spendingDays)))) + ' on an average one'
        : 'Nothing spent yet this month');

    set('ledgerIncome', money(fromSen(book.incomeSen)));
    set('ledgerIncomeFoot', book.incomeSen ? 'Salary, side jobs, refunds' : 'Nothing came in this month');

    set('ledgerNet', (book.netSen < 0 ? '− ' : '') + money(Math.abs(fromSen(book.netSen))));
    set('ledgerNetFoot', !book.incomeSen && !book.expenseSen ? '—'
        : book.netSen < 0 ? 'Spent more than came in'
        : book.incomeSen ? pct(book.netSen / book.incomeSen * 100) + ' of what came in'
        : 'No income recorded to measure against');

    paintLedgerList(book);
    paintLedgerCategories(book);
    paintLedgerBalances(book);
}

function renderLedger() {
    readLedgerAccounts();
    readCategoryRows();
    buildAccountOptions();
    // The tracker and the cards name an account and a category too, and a
    // select has no caret to lose — so they are rebuilt with the rest.
    buildCommitOptions();
    buildCardOptions();
    // The picker is rebuilt, the rows are not: rebuilding the rows would take
    // the caret with them while a name is still being typed.
    buildCategoryOptions();
    paintLedger(ledgerCompute());
    saveLedger();
}

/**
 * --------------------------------------------------------------------
 * Writing in the book
 * --------------------------------------------------------------------
 */
const ledgerFormType = () => (($('ledgerType') || {}).dataset || {}).value || 'expense';

const ledgerHint = (text) => {
    const hint = $('ledgerFormHint');
    if (hint) hint.textContent = text;
};

const ledgerStoreHint = () => {
    const hint = $('ledgerFormHint');
    if (hint) hint.innerHTML = '<i class="bi bi-hdd"></i> Saved on this device only — nothing leaves your browser.';
};

/**
 * Text to a currency code, for anything that arrives as words rather than as a
 * choice — a restored backup, or an older record. Returns null when nothing
 * matches, never the base currency: silently calling an unknown currency
 * "ringgit" would rewrite the record rather than reject the input.
 */
function normaliseCurrency(raw) {
    const text = String(raw || '').trim();
    if (!text) return BASE_CURRENCY;

    const upper = text.toUpperCase();
    if (CURRENCIES.includes(upper)) return upper;

    // The datalist shows "MYR · Malaysian Ringgit", so a pick arrives whole.
    const head = upper.split(/[^A-Z]/)[0];
    if (CURRENCIES.includes(head)) return head;

    const lower = text.toLowerCase();
    const startsWord = (hay) => (' ' + hay.toLowerCase()).indexOf(' ' + lower) >= 0;

    const hit = CURRENCY_TABLE.find(([, name]) => name.toLowerCase().startsWith(lower))
        || CURRENCY_TABLE.find(([, , , country]) => startsWord(country))
        || CURRENCY_TABLE.find(([, name]) => name.toLowerCase().includes(lower))
        || CURRENCY_TABLE.find(([, , , country]) => country.toLowerCase().includes(lower));

    // Null, not the base currency. Text that resolves to nothing must not
    // quietly become ringgit — that records a currency the reader never
    // chose, on an entry they believed they had got right.
    return hit ? hit[0] : null;
}

/**
 * --------------------------------------------------------------------
 * Exchange rates
 * --------------------------------------------------------------------
 * Fetched once a day and kept in localStorage, so the app still converts on
 * a plane with the wifi off — it just says how old the rate it used is.
 *
 * The converted figure is filled in, not enforced. What a bank actually takes
 * is the mid-market rate plus a spread plus whatever fee, and no public rate
 * knows any of that. So the box stays editable, and typing in it stops the
 * conversion overwriting you: the statement wins over the estimate, always.
 *
 * `rate` is stored on the entry alongside the two amounts. A record that
 * carries the rate it was converted at can be checked years later; one that
 * only carries the result cannot.
 */
const FX_KEY = 'moneyflow.fx.v1';
const FX_URL = 'https://open.er-api.com/v6/latest/' + BASE_CURRENCY;

let fxState = { fetched: '', rates: {}, pending: false };

function loadRates() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(FX_KEY) || 'null'); } catch (err) { saved = null; }
    if (saved && saved.rates && typeof saved.rates === 'object') {
        fxState.rates = saved.rates;
        fxState.fetched = String(saved.fetched || '');
    }
}

/** How many units of `code` one ringgit buys, or 0 when it is not known. */
const rateFor = (code) => Number(fxState.rates[code]) || 0;

const ratesAreStale = () => fxState.fetched !== todayIso();

/**
 * Asks for today's rates, at most once at a time. Failure is not an error
 * worth shouting about — it just means the reader types the figure themselves,
 * which is what they were doing before this existed.
 */
function fetchRates(onDone) {
    if (fxState.pending) return;
    fxState.pending = true;
    paintRateState();

    fetch(FX_URL, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
        .then((data) => {
            if (!data || data.result !== 'success' || !data.rates) throw new Error('bad payload');
            fxState.rates = data.rates;
            fxState.fetched = todayIso();
            try {
                localStorage.setItem(FX_KEY, JSON.stringify({
                    fetched: fxState.fetched,
                    stamp: String(data.time_last_update_utc || ''),
                    rates: data.rates,
                }));
            } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
        })
        .catch(() => { /* offline, blocked, or down — the cached rates stand */ })
        .then(() => {
            fxState.pending = false;
            if (onDone) onDone();
            paintRateState();
        });
}

/**
 * Fill the ringgit box from the day's rate — unless the reader has typed in
 * it, in which case what they typed is the better number and stays.
 */
function convertLedgerAmount() {
    const box = $('ledgerBase');
    const code = ledgerCurrency();
    if (!box || code === BASE_CURRENCY) return;
    if (box.dataset.touched === '1') { paintRateState(); return; }

    const rate = rateFor(code);
    const paid = parseFloat(($('ledgerAmount') || {}).value) || 0;

    box.value = rate && paid ? (paid / rate).toFixed(2) : '';
    paintRateState();
}

/** Where the number in the box came from, and how much to trust it. */
function paintRateState() {
    const note = $('ledgerRateNote');
    const box = $('ledgerBase');
    if (!note || !box) return;

    const code = ledgerCurrency();
    if (code === BASE_CURRENCY) { note.textContent = ''; return; }

    if (fxState.pending && !rateFor(code)) {
        note.textContent = 'Looking up today\u2019s rate\u2026';
        return;
    }

    const rate = rateFor(code);
    if (!rate) {
        note.textContent = 'No rate for ' + code + ' — put in what it cost you and the entry is still exact.';
        return;
    }

    const typed = box.dataset.touched === '1';
    const age = fxState.fetched === todayIso() ? 'today'
        : fxState.fetched ? dayShort(fxState.fetched) : 'an earlier session';

    note.textContent = (typed ? 'Yours, kept. ' : 'Converted at ') +
        '1 ' + currencySymbol(BASE_CURRENCY) + ' = ' + fmt(rate) + ' ' + code +
        ', rates from ' + age + '. Your bank will differ — its spread is not in any public rate, so correct this from your statement when you have it.';
}

/** The affix in front of the amount is the currency actually being recorded. */
function syncLedgerCurrency() {
    const code = ledgerCurrency();

    const affix = document.querySelector('#ledgerFieldAmount .affix');
    if (affix) affix.textContent = currencySymbol(code);

    document.querySelectorAll('#ledgerCurrencyList .combo-row').forEach((row) => {
        row.classList.toggle('is-on', row.dataset.code === code);
    });

    const note = $('ledgerCurrencyNote');
    if (!note) return;

    const foreign = code !== BASE_CURRENCY;
    if ($('ledgerFieldBase')) $('ledgerFieldBase').hidden = !foreign;

    // Rates are fetched the first time one is actually wanted, not at start-up:
    // most entries are in ringgit and need no network at all.
    if (foreign && !rateFor(code) && ratesAreStale()) fetchRates(convertLedgerAmount);
    else convertLedgerAmount();

    note.hidden = code === BASE_CURRENCY;
    note.textContent = code === BASE_CURRENCY ? '' : currencyName(code) +
        ' — recorded as paid. Totals are in ' + currencySymbol(BASE_CURRENCY) +
        ', so this entry needs what it actually cost you.';
}

/**
 * The currency combobox.
 *
 * A <datalist> was tried first and rendered every option as the whole string
 * it filters on — "MYR · Malaysian Ringgit · Malaysia" and the symbol beneath
 * it — which is a search index, not a menu. A real popup keeps the two apart:
 * the closed control reads like the select it replaced, and the words that
 * make searching work live in the list rather than in the field.
 */
function buildCurrencyList() {
    const list = $('ledgerCurrencyList');
    if (!list) return;

    list.innerHTML = '';
    CURRENCY_TABLE.forEach(([code, name, symbol, country]) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'combo-row';
        row.dataset.code = code;
        row.setAttribute('role', 'option');
        // Everything searchable, in one place, out of sight.
        row.dataset.find = (code + ' ' + name + ' ' + country).toLowerCase();
        row.innerHTML =
            '<b>' + code + '</b>' +
            '<span>' + escapeHtml(name) + '</span>' +
            '<small>' + escapeHtml(country) + '</small>' +
            '<i>' + escapeHtml(symbol || code) + '</i>';
        list.appendChild(row);
    });
}

/** The code the form will record. The hidden input is the single truth. */
const ledgerCurrency = () => {
    const raw = ($('ledgerCurrency') || {}).value;
    return CURRENCIES.includes(raw) ? raw : BASE_CURRENCY;
};

function setLedgerCurrency(code) {
    const valid = CURRENCIES.includes(code) ? code : BASE_CURRENCY;
    if ($('ledgerCurrency')) $('ledgerCurrency').value = valid;
    set('ledgerCurrencyLabel', valid + ' \u00b7 ' + currencySymbol(valid));
    syncLedgerCurrency();
}

/** Filter the list to what was typed. Matches a code, a currency or a country. */
function filterCurrencyList(query) {
    const q = String(query || '').trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('#ledgerCurrencyList .combo-row').forEach((row) => {
        const hit = !q || row.dataset.find.includes(q);
        row.hidden = !hit;
        if (hit) shown++;
    });
    if ($('ledgerCurrencyNone')) $('ledgerCurrencyNone').hidden = shown > 0;
}

function openCurrencyPop(open) {
    const pop = $('ledgerCurrencyPop');
    const btn = $('ledgerCurrencyBtn');
    if (!pop || !btn) return;

    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open) return;

    const search = $('ledgerCurrencySearch');
    if (search) { search.value = ''; filterCurrencyList(''); search.focus(); }

    // Bring the current choice into view rather than reopening at the top.
    const current = document.querySelector('#ledgerCurrencyList .combo-row.is-on');
    if (current) reveal(current).scrollIntoView({ block: 'center' });
}

/** A transfer swaps the category picker for a second account. */
function syncLedgerForm() {
    const type = ledgerFormType();
    const transfer = type === 'transfer';

    // Money back keeps its category: that is the whole point of it — the
    // amount comes off whatever it was spent on in the first place.
    if ($('ledgerFieldCategory')) $('ledgerFieldCategory').hidden = transfer;
    if ($('ledgerFieldSub'))      $('ledgerFieldSub').hidden = transfer;
    if ($('ledgerFieldTo'))       $('ledgerFieldTo').hidden = !transfer;

    set('ledgerAccountLabel',
        transfer ? 'Out of'
        : type === 'income' ? 'Received into'
        : type === 'refund' ? 'Back into'
        : 'Payment method');

    const hint = $('ledgerCategoryHint');
    if (hint) {
        hint.hidden = type !== 'refund';
        hint.textContent = 'File it under whatever it is coming back off — the amount is taken off ' +
            'that category, so what you spent there reads as what you actually kept spending.';
    }

    buildCategoryOptions();
}

function ledgerClearForm() {
    ledgerState.editing = null;
    if ($('ledgerAmount')) $('ledgerAmount').value = '';
    if ($('ledgerNote'))   $('ledgerNote').value = '';
    if ($('ledgerDate'))   $('ledgerDate').value = todayIso();
    if ($('ledgerSub'))    $('ledgerSub').value = '';
    if ($('ledgerBase'))   { $('ledgerBase').value = ''; delete $('ledgerBase').dataset.touched; }
    setLedgerCurrency(BASE_CURRENCY);

    set('ledgerFormTitle', 'Add an entry');
    if ($('ledgerSubmit')) $('ledgerSubmit').innerHTML = '<i class="bi bi-plus-lg"></i> Add entry';
    if ($('ledgerCancel')) $('ledgerCancel').hidden = true;
    ledgerStoreHint();
}

function ledgerSubmit() {
    const amount = parseFloat(($('ledgerAmount') || {}).value) || 0;
    const type   = ledgerFormType();
    const from   = ($('ledgerAccount') || {}).value;
    const into   = ($('ledgerTo') || {}).value;

    if (amount <= 0) {
        ledgerHint('Put an amount in first — that is the one thing an entry cannot do without.');
        if ($('ledgerAmount')) $('ledgerAmount').focus();
        return;
    }

    if (type === 'transfer' && from === into) {
        ledgerHint('Pick two different accounts — a transfer has to land somewhere else.');
        return;
    }

    const currency = ledgerCurrency();
    const base = parseFloat(($('ledgerBase') || {}).value) || 0;

    // Filing a foreign amount with nothing to convert it by would put a number
    // into a ringgit total that is not ringgit. Better to stop and ask.
    if (currency !== BASE_CURRENCY && base <= 0) {
        ledgerHint('Put in what it cost you in ' + currencySymbol(BASE_CURRENCY) +
            ' — without it, ' + currencySymbol(currency) + ' ' + fmt(amount) +
            ' would be counted as ringgit.');
        if ($('ledgerBase')) $('ledgerBase').focus();
        return;
    }

    const existing = ledgerState.entries.find((e) => e.id === ledgerState.editing);
    const stamp = todayIso();

    const entry = {
        id:        ledgerState.editing || ledgerId('e'),
        seq:       ++ledgerSeq,
        type:      type,
        amount:    String(amount),
        currency:  currency,
        base:      currency === BASE_CURRENCY ? '' : String(base),
        rate:      currency === BASE_CURRENCY || !base ? '' : String(amount / base),
        date:      ($('ledgerDate') || {}).value || todayIso(),
        category:  type === 'transfer' ? '' : ($('ledgerCategory') || {}).value,
        sub:       type === 'transfer' ? '' : ($('ledgerSub') || {}).value || '',
        account:   from,
        toAccount: type === 'transfer' ? into : '',
        note:      ($('ledgerNote') || {}).value || '',
        created:   existing ? existing.created : stamp,
        updated:   stamp,
    };

    const at = ledgerState.entries.findIndex((e) => e.id === entry.id);
    if (at >= 0) {
        entry.seq = ledgerState.entries[at].seq;   // keep its place within the day
        ledgerState.entries[at] = entry;
    } else {
        ledgerState.entries.push(entry);
    }

    // Follow the entry to its month, or it would be filed out of sight.
    ledgerState.month = monthOf(entry.date);

    ledgerClearForm();
    renderLedger();
    if ($('ledgerAmount')) $('ledgerAmount').focus();
}

function ledgerEdit(id) {
    const entry = ledgerState.entries.find((e) => e.id === id);
    if (!entry) return;

    ledgerState.editing = id;

    if ($('ledgerType')) setSegment($('ledgerType'), entry.type);
    syncLedgerForm();

    if ($('ledgerAmount')) $('ledgerAmount').value = entry.amount;
    // A saved entry's figure is the reader's own, whatever produced it.
    if ($('ledgerBase')) {
        $('ledgerBase').value = entry.base || '';
        if (entry.base) $('ledgerBase').dataset.touched = '1';
        else delete $('ledgerBase').dataset.touched;
    }
    setLedgerCurrency(entry.currency || BASE_CURRENCY);
    if ($('ledgerDate'))   $('ledgerDate').value = entry.date;
    if ($('ledgerNote'))   $('ledgerNote').value = entry.note;
    if ($('ledgerCategory') && entry.category) $('ledgerCategory').value = entry.category;

    // The sub-category list depends on the category that was just restored.
    buildSubOptions();
    if ($('ledgerSub') && entry.sub) $('ledgerSub').value = entry.sub;

    if ($('ledgerAccount')) $('ledgerAccount').value = entry.account;
    if ($('ledgerTo') && entry.toAccount) $('ledgerTo').value = entry.toAccount;
    syncLedgerCurrency();

    set('ledgerFormTitle', 'Edit this entry');
    if ($('ledgerSubmit')) $('ledgerSubmit').innerHTML = '<i class="bi bi-check-lg"></i> Save changes';
    if ($('ledgerCancel')) $('ledgerCancel').hidden = false;
    ledgerHint('Changing the entry from ' + entry.date + '. Cancel leaves it as it was.');

    const field = $('ledgerAmount');
    if (field) { field.focus(); field.select(); }
}

function ledgerDelete(id) {
    ledgerState.entries = ledgerState.entries.filter((e) => e.id !== id);
    if (ledgerState.editing === id) ledgerClearForm();
    renderLedger();
}

/** Clicks in the day list: edit an entry, or drop it. */
function onLedgerListClick(event) {
    const remove = event.target.closest('button[data-remove-entry]');
    if (remove) { ledgerDelete(remove.closest('.led-entry').dataset.entry); return; }

    const edit = event.target.closest('button[data-edit-entry]');
    if (edit) ledgerEdit(edit.closest('.led-entry').dataset.entry);
}

function onLedgerAccountsClick(event) {
    const btn = event.target.closest('button[data-remove-account]');
    if (!btn) return;

    readLedgerAccounts();
    const row = btn.closest('.bgt-row');
    const id  = row.dataset.cat;

    // Entries pointing at a deleted account would have nowhere to sit, and the
    // form needs somewhere to spend from — so neither is allowed to go.
    const used = ledgerState.entries.some((e) => e.account === id || e.toAccount === id);
    if (used || ledgerState.accounts.length <= 1) {
        row.classList.add('is-locked');
        setTimeout(() => row.classList.remove('is-locked'), 1400);
        ledgerHint(used
            ? 'That account still has entries against it — move or delete those first.'
            : 'Keep at least one account: an entry has to come out of something.');
        return;
    }

    ledgerState.accounts = ledgerState.accounts.filter((a) => a.id !== id);
    buildLedgerAccounts();
    renderLedger();
}

function ledgerSummaryText() {
    const book = ledgerCompute();
    const head = monthKeyLabel(book.month) + ' — spent ' + money(fromSen(book.expenseSen)) +
        ', received ' + money(fromSen(book.incomeSen));

    if (!book.entries.length) return head + ' (nothing recorded)';

    const lines = [head];
    book.categories.forEach((row) => {
        lines.push(row.cat.label + ': ' + money(fromSen(row.sen)) +
            ' (' + pct(row.sen / book.expenseSen * 100, 0) + ')');
    });
    lines.push(book.netSen < 0
        ? 'Short by ' + money(fromSen(-book.netSen))
        : 'Kept ' + money(fromSen(book.netSen)));

    return lines.join('\n');
}

/**
 * --------------------------------------------------------------------
 * Persistence. This is the one module holding data worth losing, so the
 * whole book is written on every change — guarded, because private mode
 * and file:// can throw on access.
 *
 * Loading treats the stored copy as untrusted: an entry pointing at an
 * account that no longer exists, or a transfer that lost its far side,
 * would corrupt every balance on the screen.
 * --------------------------------------------------------------------
 */
function saveLedger() {
    try {
        storeWrite(LEDGER_KEY, JSON.stringify({
            seq: ledgerSeq,
            month: ledgerState.month,
            types: ledgerState.types.filter((t) => t.label.trim()),
            purposes: purposeList(),
            accounts: ledgerState.accounts,
            entries: ledgerState.entries,
        }));
    } catch (err) { /* unreachable: storeWrite swallows it and reports it */ }
}

function loadLedger() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(LEDGER_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};

    ledgerSeq = Number(saved.seq) || 0;
    ledgerState.month = /^\d{4}-\d{2}$/.test(saved.month || '') ? saved.month : monthOf(todayIso());

    // The kinds are read first: an account is checked against them, and one
    // pointing at a kind that is no longer there has to land somewhere real.
    ledgerState.types = (Array.isArray(saved.types) ? saved.types : DEFAULT_TYPES)
        .filter((t) => t && t.id && String(t.label || '').trim())
        .map((t) => ({ id: String(t.id), label: String(t.label).trim() }))
        .filter((t, i, list) => list.findIndex((x) => x.id === t.id) === i);
    if (!ledgerState.types.length) ledgerState.types = DEFAULT_TYPES.map((t) => ({ ...t }));

    ledgerState.accounts = (Array.isArray(saved.accounts) ? saved.accounts : [])
        .filter((a) => a && a.id)
        .map((a) => {
            // Accounts used to carry a `group`, and "Savings" was one of its
            // values. Savings is what an account is *for*, not what kind of
            // thing it is, so it becomes a bank account with that purpose.
            const legacy = a.type ? '' : String(a.group || 'bank');
            return {
                id: String(a.id),
                name: String(a.name || ''),
                type: typeById(a.type) ? a.type
                    : legacy === 'savings' ? (typeById('bank') ? 'bank' : defaultTypeId())
                    : typeById(legacy) ? legacy : defaultTypeId(),
                purpose: String(a.purpose || (legacy === 'savings' ? 'Savings' : '')),
                currency: CURRENCIES.includes(a.currency) ? a.currency : BASE_CURRENCY,
                opening: String(a.opening || ''),
                status: ACCOUNT_STATUSES[a.status] ? a.status : 'active',
            };
        });
    if (!ledgerState.accounts.length) seedAccounts();

    // The purpose list only started being saved after the first books were
    // written, so an older one falls back to the starting list. Either way it
    // ends up holding every purpose the accounts already carry: a purpose on
    // an account that is missing from the list is a picker that cannot show
    // what the row it sits on says.
    ledgerState.purposes = [];
    (Array.isArray(saved.purposes) ? saved.purposes : DEFAULT_PURPOSES)
        .concat(ledgerState.accounts.map((a) => a.purpose))
        .forEach((raw) => {
            const name = String(raw || '').trim();
            if (name && !ledgerState.purposes.some((p) => p.toLowerCase() === name.toLowerCase())) {
                ledgerState.purposes.push(name);
            }
        });

    const known = new Set(ledgerState.accounts.map((a) => a.id));
    ledgerState.entries = (Array.isArray(saved.entries) ? saved.entries : [])
        .filter((e) => e && e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && known.has(e.account))
        .map((e, index) => ({
            id: String(e.id),
            seq: Number(e.seq) || index + 1,
            type: ['expense', 'income', 'transfer', 'refund'].includes(e.type) ? e.type : 'expense',
            amount: String(e.amount || '0'),
            // Everything below arrived after the first entries were written,
            // so every one of them has to read as absent rather than wrong.
            currency: CURRENCIES.includes(e.currency) ? e.currency : BASE_CURRENCY,
            base: String(e.base || ''),
            rate: String(e.rate || ''),
            date: String(e.date),
            category: String(e.category || ''),
            sub: String(e.sub || ''),
            account: String(e.account),
            toAccount: known.has(e.toAccount) ? String(e.toAccount) : '',
            note: String(e.note || ''),
            created: String(e.created || e.date),
            updated: String(e.updated || e.date),
        }))
        // A transfer that lost its far side is no longer a transfer.
        .filter((e) => e.type !== 'transfer' || e.toAccount);

    // Never hand out an id that is already in the book.
    ledgerState.entries.forEach((e) => { ledgerSeq = Math.max(ledgerSeq, e.seq); });
}

/**
 * ====================================================================
 * SHARED TABLE + CLIPBOARD HELPERS
 * ====================================================================
 */
function cell(html, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.innerHTML = html;
    return td;
}

/**
 * A card with nothing to show says so once, in a block with real height —
 * not with an empty chart, an empty legend and a table head over no rows.
 * `hide` takes the furniture that only makes sense with data off the page
 * entirely; passing it nothing is fine for a card with none.
 */
function paintEmpty(host, title, line, icon) {
    if (!host) return;
    host.classList.add('is-empty');
    host.innerHTML = '<div class="empty-state"><i class="bi ' + (icon || 'bi-inbox') + '"></i>' +
        '<p><b>' + escapeHtml(title) + '</b>' + escapeHtml(line) + '</p></div>';
}

/** The other half of it: this host has data again and must stop stretching. */
const clearEmpty = (host) => { if (host) host.classList.remove('is-empty'); };

/** Show or hide the parts of a card that only mean anything with data in it. */
function showWithData(has, ...nodes) {
    nodes.forEach((node) => { if (node) node.hidden = !has; });
}

function emptyRow(message, span) {
    const tr = document.createElement('tr');
    const td = cell(message, 'is-muted');
    td.colSpan = span;
    tr.appendChild(td);
    return tr;
}

/** Copies `text`, then flashes the outcome on the button that asked for it. */
function copySummary(btn, text, idleLabel) {
    const idle = '<i class="bi bi-clipboard"></i> ' + idleLabel;
    const done = (ok) => {
        btn.innerHTML = ok
            ? '<i class="bi bi-check-lg"></i> Copied'
            : '<i class="bi bi-exclamation-triangle"></i> Copy failed';
        setTimeout(() => { btn.innerHTML = idle; }, 1600);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
        return;
    }

    // file:// and plain http have no async clipboard — fall back to the old trick.
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(scratch);
    done(ok);
}

/**
 * ====================================================================
 * DASHBOARD — M1, UNDERSTAND
 * --------------------------------------------------------------------
 * The one screen that reads every other module and writes nothing of its
 * own. Every figure here is computed from the ledger at the moment it is
 * painted — "record once, analyze many times". There is no dashboard
 * store and there must never be one: a saved total is a second version of
 * the truth, and it goes stale the moment an entry is edited.
 *
 * Three of the ten KPIs have no module behind them yet — investments
 * (Grow), instalments and upcoming payments (Commit). They are drawn as
 * pending rather than as zero, because "RM 0.00" is a claim about your
 * money and "—" is not.
 *
 * Sub-category and payment method are the same story one level down: the
 * spec asks the breakdown to split by them, the ledger does not record
 * them yet, so the breakdown offers the three dimensions that are real
 * and says plainly what is missing.
 * ====================================================================
 */
const DASH_DIMS = {
    category: 'Category',
    bucket:   'Bucket',
    account:  'Account',
};

/** "3 categories" reads; "3 categorys" does not. */
const DASH_DIM_PLURAL = {
    category: 'categories',
    bucket:   'buckets',
    account:  'accounts',
};

/** How far back each grain of the trend chart looks. Twelve months is a
 *  year of seasons; fourteen days is a fortnight either side of payday. */
const DASH_TREND_SPAN = { daily: 14, weekly: 12, monthly: 12, yearly: 5 };

/** The account whose history is open, if any. Everything else the
 *  dashboard needs is read off the controls at paint time. */
let dashState = { account: null };

/**
 * --------------------------------------------------------------------
 * Dates, continued. Same rule as the ledger: 'YYYY-MM-DD' strings split
 * by hand, never handed to `new Date()` whole, or every figure lands a
 * day out east of Greenwich. ISO strings also sort and compare as text,
 * which is what makes every range filter a plain `>=` / `<=`.
 * --------------------------------------------------------------------
 */
const isoNums   = (iso) => (iso || '').split('-').map(Number);
const isoOf     = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);
const isoOfDate = (dt) => isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());

function isoShift(iso, days) {
    const [y, m, d] = isoNums(iso);
    return isoOfDate(new Date(y, m - 1, d + days));
}

/** Weeks start on Monday — a spending week that splits the weekend across
 *  two rows tells you nothing useful about weekends. */
function weekStart(iso) {
    const [y, m, d] = isoNums(iso);
    const weekday = new Date(y, m - 1, d).getDay();      // 0 = Sunday
    return isoShift(iso, weekday === 0 ? -6 : 1 - weekday);
}

const monthFirst = (y, m) => isoOf(y, m, 1);
const monthLast  = (y, m) => isoOfDate(new Date(y, m, 0));   // day 0 of next month

function dayLabel(iso) {
    const [y, m, d] = isoNums(iso);
    if (!y || !m || !d) return '—';
    return d + ' ' + MONTH_NAMES[m - 1] + ' ' + y;
}

function dayShort(iso) {
    const [, m, d] = isoNums(iso);
    return m ? d + ' ' + MONTH_NAMES[m - 1] : '—';
}

function rangeDays(from, to) {
    const [ay, am, ad] = isoNums(from);
    const [by, bm, bd] = isoNums(to);
    if (!ay || !by) return 1;
    const span = new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad);
    return Math.max(1, Math.round(span / 86400000) + 1);
}

const quarterOf = (month) => Math.floor((month - 1) / 3) + 1;

/**
 * --------------------------------------------------------------------
 * The selected period
 * --------------------------------------------------------------------
 */
const dashPeriod = () => (($('dashPeriod') || {}).dataset || {}).value || 'month';

function monthRange(y, m, label) {
    return {
        from: monthFirst(y, m), to: monthLast(y, m), label,
        sub: MONTH_NAMES[m - 1] + ' ' + y,
        monthly: true,
    };
}

function dashRange() {
    const today = todayIso();
    const [ty, tm] = isoNums(today);
    const period = dashPeriod();

    if (period === 'today') {
        return { from: today, to: today, label: 'Today', sub: dayLabel(today) };
    }

    if (period === 'week') {
        const from = weekStart(today);
        return { from, to: isoShift(from, 6), label: 'This week', sub: dayShort(from) + ' – ' + dayLabel(isoShift(from, 6)) };
    }

    if (period === 'month') return monthRange(ty, tm, 'This month');

    if (period === 'lastmonth') {
        const prev = new Date(ty, tm - 2, 1);
        return monthRange(prev.getFullYear(), prev.getMonth() + 1, 'Last month');
    }

    if (period === 'year')     return { from: isoOf(ty, 1, 1),     to: isoOf(ty, 12, 31),     label: 'This year', sub: String(ty) };
    if (period === 'lastyear') return { from: isoOf(ty - 1, 1, 1), to: isoOf(ty - 1, 12, 31), label: 'Last year', sub: String(ty - 1) };

    // Custom. An empty side means "open ended on that side", which in practice
    // is the other side — a range needs two ends to be a range at all. Ends
    // entered backwards are swapped rather than refused: the intent is never in
    // doubt, and an empty dashboard would be the only other answer.
    let from = ($('dashFrom') || {}).value || '';
    let to   = ($('dashTo')   || {}).value || '';
    if (!from && !to) return monthRange(ty, tm, 'Custom range');
    if (!from) from = to;
    if (!to)   to   = from;
    if (from > to) { const held = from; from = to; to = held; }

    return {
        from, to, label: 'Custom range',
        sub: from === to ? dayLabel(from) : dayLabel(from) + ' – ' + dayLabel(to),
        custom: true,
    };
}

/** Every entry the period covers, newest day first. */
function dashEntriesIn(from, to) {
    return ledgerState.entries
        .filter((entry) => entry.date >= from && entry.date <= to)
        .sort((a, b) => (a.date === b.date ? b.seq - a.seq : (a.date < b.date ? 1 : -1)));
}

const dashAccountLabel = (id) => {
    const account = accountById(id);
    if (!account) return 'Closed account';
    return account.name.trim() || 'Unnamed account';
};

/**
 * --------------------------------------------------------------------
 * The whole dashboard in one pass over the book
 * --------------------------------------------------------------------
 */
function dashCompute() {
    const range    = dashRange();
    const entries  = dashEntriesIn(range.from, range.to);
    const totals   = ledgerTotals(entries);
    const balances = accountBalances();

    // Balances are all-time by nature — an account holds what it holds, not
    // what it held during a fortnight — so they stay outside the period.
    let assetsSen = 0, owingSen = 0, savingsSen = 0, creditOwingSen = 0, creditCount = 0;
    ledgerState.accounts.forEach((account) => {
        const balance = balances[account.id] || 0;
        if (balance >= 0) assetsSen += balance; else owingSen -= balance;
        // An emergency fund is not savings in the sense this tile means it: it
        // is money standing by to be spent, and counting it made the figure
        // rise and fall with an expense the reader was braced for anyway. So
        // this is what is being *kept* — put away to grow, not to be reached
        // for. Purposes are the reader's own wording, so it reads the word
        // rather than the row: anything called savings or investment counts.
        if (/savings|investment/i.test(account.purpose || '')) savingsSen += balance;
        if (account.type === 'credit') {
            creditCount++;
            if (balance < 0) creditOwingSen -= balance;
        }
    });

    // Credit card outstanding. A ledger credit account carrying a balance is
    // the better record — it is built from real entries — so it wins. But a
    // *fresh* book seeds an empty "Credit card" account, and testing for the
    // account's existence meant the Card Payoff figure could never stand in:
    // the dashboard reported nothing owed while the card book said RM9,500.
    // So the test is whether anything is actually owed there.
    const cardBalanceSen = cardTotalDebtSen();
    const creditFromCard = creditOwingSen === 0 && cardBalanceSen > 0;

    // By dates, not by whatever the Planner is showing.
    const plannedSen = budgetPlannedSenIn(range.from, range.to);

    // The instalment tracker answers the same way: by this period's dates,
    // not by whichever plan happens to be open.
    const commitDue = commitDueBetween(range.from, range.to);
    const instalmentSen = commitOutstandingSen();

    return {
        range, entries, balances,
        days: rangeDays(range.from, range.to),

        incomeSen:  totals.incomeSen,
        expenseSen: totals.expenseSen,
        movedSen:   totals.movedSen,
        netSen:     totals.netSen,

        // Money set aside is money set aside wherever it is sitting: in an
        // account kept for it, or paid into a holding. What the holdings have
        // *earned* is deliberately not here — that is the other tile, and the
        // two are meant to add up rather than overlap. Nothing is counted
        // twice, because paying into a holding took the money out of the
        // account it came from.
        savingsSen: savingsSen + growTotalInvestedSen(),
        assetsSen, owingSen,
        cashSavingsSen: savingsSen,
        investedSen: growTotalInvestedSen(),
        totalSen: assetsSen - owingSen,
        accountCount: ledgerState.accounts.length,

        creditSen: creditFromCard ? cardBalanceSen : creditOwingSen,
        creditFromCard, creditCount,

        plannedSen,
        budgetLeftSen: plannedSen - totals.expenseSen,

        instalmentSen, commitDue,
        investmentSen: growTotalValueSen(),
        investGainSen: growTotalGainSen(),
    };
}

/**
 * --------------------------------------------------------------------
 * Expense breakdown
 * --------------------------------------------------------------------
 * Transfers never appear here. Moving RM500 from Maybank into savings is
 * not RM500 of shopping, and counting it once as spending is exactly how a
 * ledger starts disagreeing with the bank.
 */
function dashBreakdown(entries, dim) {
    const rows = new Map();

    entries.filter(isSpend).forEach((entry) => {
        const sen = spendSen(entry);
        if (!sen) return;

        let key, label, tone;
        if (dim === 'account') {
            key   = entry.account;
            label = dashAccountLabel(entry.account);
            tone  = 'jade';
        } else if (dim === 'bucket') {
            key   = categoryOf(entry).bucket;
            label = BUDGET_BUCKETS[key].label;
            tone  = BUDGET_BUCKETS[key].tone;
        } else {
            const cat = categoryOf(entry);
            key   = cat.id;
            label = cat.label;
            tone  = BUDGET_BUCKETS[cat.bucket].tone;
        }

        const row = rows.get(key) || { key, label, tone, sen: 0, count: 0 };
        row.sen += sen;
        row.count++;
        rows.set(key, row);
    });

    const list = Array.from(rows.values()).sort((a, b) => b.sen - a.sen);
    paintPalette(list);
    return list;
}

/** The daylight values, used only if the stylesheet cannot be read. */
const TONE_FALLBACK = { jade: '#0e7c66', amber: '#b8800f', indigo: '#4f46c9', red: '#cc3a34' };

/**
 * A bucket's colour, taken from the stylesheet rather than repeated here —
 * so switching to the dark theme moves the charts along with everything
 * else, instead of leaving eight daylight slices on a near-black card.
 */
function toneHex(tone) {
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--' + tone).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : (TONE_FALLBACK[tone] || TONE_FALLBACK.jade);
}

const hex2 = (v) => (v < 16 ? '0' : '') + v.toString(16);

/**
 * Later slices of the same bucket are mixed toward white. A donut can then
 * hold eight categories without inventing a ninth meaning for a colour —
 * jade is still "needs" whatever shade of it you are looking at, and red
 * stays reserved for being over budget.
 */
function toneShade(tone, index, count) {
    const hex = toneHex(tone);
    if (count <= 1 || index === 0) return hex;

    const t = Math.min(0.58, (index / count) * 0.78);
    const n = parseInt(hex.slice(1), 16);
    const mix = (channel) => Math.round(channel + (255 - channel) * t);
    return '#' + hex2(mix((n >> 16) & 255)) + hex2(mix((n >> 8) & 255)) + hex2(mix(n & 255));
}

function paintPalette(rows) {
    const total = {};
    rows.forEach((row) => { total[row.tone] = (total[row.tone] || 0) + 1; });

    const seen = {};
    rows.forEach((row) => {
        const index = seen[row.tone] || 0;
        seen[row.tone] = index + 1;
        row.color = toneShade(row.tone, index, total[row.tone]);
    });
}

/**
 * --------------------------------------------------------------------
 * Spending trend
 * --------------------------------------------------------------------
 * The trend runs backwards from the end of the selected period rather than
 * being cut to fit inside it — a period of "Today" holds one day, and one
 * point is not a trend. Moving the period still moves the whole chart.
 */
const dashGrain = () => (($('dashTrend') || {}).dataset || {}).value || 'monthly';

function dashTrend(grain, endIso) {
    const count = DASH_TREND_SPAN[grain] || DASH_TREND_SPAN.monthly;
    const [ey, em] = isoNums(endIso);
    const buckets = [];

    for (let step = count - 1; step >= 0; step--) {
        if (grain === 'daily') {
            const day = isoShift(endIso, -step);
            buckets.push({ from: day, to: day, label: dayShort(day) });
        } else if (grain === 'weekly') {
            const from = isoShift(weekStart(endIso), -step * 7);
            buckets.push({ from, to: isoShift(from, 6), label: dayShort(from) });
        } else if (grain === 'yearly') {
            const year = ey - step;
            buckets.push({ from: isoOf(year, 1, 1), to: isoOf(year, 12, 31), label: String(year) });
        } else {
            const walk = new Date(ey, em - 1 - step, 1);
            const y = walk.getFullYear(), m = walk.getMonth() + 1;
            buckets.push({
                from: monthFirst(y, m), to: monthLast(y, m),
                // The year is stamped on January and on the leftmost column, so
                // a twelve-month run reading Sep…Aug says which Sep it started.
                label: MONTH_NAMES[m - 1] + (m === 1 || step === count - 1 ? " '" + String(y).slice(2) : ''),
            });
        }
    }

    buckets.forEach((bucket) => {
        bucket.sen = ledgerState.entries.reduce((sum, entry) =>
            (isSpend(entry) && entry.date >= bucket.from && entry.date <= bucket.to)
                ? sum + entrySen(entry) : sum, 0);
    });

    return buckets;
}

/**
 * --------------------------------------------------------------------
 * Historical comparison
 * --------------------------------------------------------------------
 * Any two periods of the same grain: Aug vs Jul, Q3 vs Q2, 2026 vs 2025,
 * January vs December. Both dropdowns hold the same list, so nothing stops
 * you comparing a period with itself — the answer is then "no change",
 * which is honest and needs no special case.
 */
const dashCmpGrain = () => (($('dashCmpGrain') || {}).dataset || {}).value || 'month';

/** Every period of this grain the book could sensibly be asked about,
 *  newest first: back to the oldest entry, and never less than a year. */
function dashComparePeriods(grain) {
    const today = todayIso();
    const [ty, tm] = isoNums(today);

    const dates = ledgerState.entries.map((entry) => entry.date).filter(Boolean);
    const earliest = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today;
    const [oy, om] = isoNums(earliest);

    const list = [];

    if (grain === 'year') {
        for (let year = Math.min(oy, ty - 1); year <= ty; year++) {
            list.push({ key: String(year), label: String(year), from: isoOf(year, 1, 1), to: isoOf(year, 12, 31) });
        }
    } else if (grain === 'quarter') {
        let year = Math.min(oy, ty - 1);
        let quarter = year === oy ? quarterOf(om) : 1;
        const lastQuarter = quarterOf(tm);
        while (year < ty || (year === ty && quarter <= lastQuarter)) {
            const firstMonth = (quarter - 1) * 3 + 1;
            list.push({
                key:   year + '-Q' + quarter,
                label: 'Q' + quarter + ' ' + year,
                from:  monthFirst(year, firstMonth),
                to:    monthLast(year, firstMonth + 2),
            });
            if (++quarter > 4) { quarter = 1; year++; }
        }
    } else {
        // Months: from the oldest entry, but always at least the last twelve,
        // and capped at five years so the dropdown stays a dropdown.
        const oldest = new Date(oy, om - 1, 1);
        const floor  = new Date(ty - 5, tm - 1, 1);
        const twelve = new Date(ty, tm - 12, 1);
        let walk = new Date(Math.max(Math.min(oldest.getTime(), twelve.getTime()), floor.getTime()));
        walk = new Date(walk.getFullYear(), walk.getMonth(), 1);

        while (walk.getFullYear() < ty || (walk.getFullYear() === ty && walk.getMonth() + 1 <= tm)) {
            const y = walk.getFullYear(), m = walk.getMonth() + 1;
            list.push({
                key:   y + '-' + pad2(m),
                label: MONTH_NAMES[m - 1] + ' ' + y,
                from:  monthFirst(y, m), to: monthLast(y, m),
            });
            walk.setMonth(walk.getMonth() + 1);
        }
    }

    return list.reverse();
}

/** Income, expenses and net for one side of the comparison, by category. */
function dashSideTotals(period) {
    const entries = dashEntriesIn(period.from, period.to);
    const totals  = ledgerTotals(entries);

    const byCategory = {};
    entries.filter(isSpend).forEach((entry) => {
        const cat = categoryOf(entry);
        byCategory[cat.id] = (byCategory[cat.id] || 0) + spendSen(entry);
    });

    return {
        period, entries, byCategory,
        incomeSen: totals.incomeSen, expenseSen: totals.expenseSen,
        movedSen: totals.movedSen, netSen: totals.netSen,
    };
}

/** How far B moved from A, and whether that counts as a move at all. Under
 *  one percent either way — or under a ringgit — reads as unchanged; calling
 *  RM2,150 against RM2,148 an increase is technically true and useless. */
function dashDelta(fromSen_, toSen_) {
    const diffSen  = toSen_ - fromSen_;
    const pctMoved = fromSen_ > 0 ? (diffSen / fromSen_) * 100 : null;
    const flat = Math.abs(diffSen) < 100 || (pctMoved !== null && Math.abs(pctMoved) < 1);

    return {
        diffSen, pct: pctMoved,
        direction: flat ? 'same' : diffSen > 0 ? 'up' : 'down',
        word: flat ? 'about the same' : diffSen > 0 ? 'increased' : 'decreased',
        // Spending more is the bad direction, so up is red and down is green —
        // the opposite of what a share price would want.
        tone: flat ? 'is-muted' : diffSen > 0 ? 'is-minus' : 'is-plus',
    };
}

const signedMoney = (sen) => (sen < 0 ? '− ' : '') + money(Math.abs(fromSen(sen)));
const diffMoney   = (sen) => (sen > 0 ? '+ ' : sen < 0 ? '− ' : '') + money(Math.abs(fromSen(sen)));
const diffPct     = (value) => (value === null ? '—' : (value > 0 ? '+' : value < 0 ? '−' : '') + pct(Math.abs(value), 2));

/**
 * --------------------------------------------------------------------
 * Charts. Hand-written SVG, because the whole app is still a folder you
 * can copy — no bundler, no chart library, no CDN to outlive us. Every
 * segment and every point carries a <title>, which is the tooltip on a
 * mouse and the label to a screen reader.
 * --------------------------------------------------------------------
 */
const moneyTight = (sen) => 'RM ' + fmt(fromSen(sen), Math.abs(sen) >= 100000 ? 0 : 2);

function donutSvg(rows, totalSen) {
    const R = 52, CIRC = 2 * Math.PI * R;
    let offset = 0, arcs = '';

    rows.forEach((row) => {
        const len = (row.sen / totalSen) * CIRC;
        arcs +=
            '<circle cx="66" cy="66" r="' + R + '" fill="none" stroke="' + row.color + '" stroke-width="19"' +
            ' stroke-dasharray="' + len.toFixed(2) + ' ' + Math.max(0, CIRC - len).toFixed(2) + '"' +
            ' stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 66 66)">' +
            '<title>' + escapeHtml(row.label) + ' · ' + money(fromSen(row.sen)) +
            ' · ' + pct((row.sen / totalSen) * 100) + '</title></circle>';
        offset += len;
    });

    return '<svg class="donut" viewBox="0 0 132 132" role="img" aria-label="Spending by share">' +
        '<circle cx="66" cy="66" r="' + R + '" fill="none" stroke="var(--line-2)" stroke-width="19"></circle>' +
        arcs +
        '<text class="donut-value" x="66" y="63">' + moneyTight(totalSen) + '</text>' +
        '<text class="donut-note" x="66" y="80">spent</text>' +
        '</svg>';
}

function barsHtml(rows, totalSen) {
    const topSen = rows.reduce((max, row) => Math.max(max, row.sen), 0) || 1;

    return rows.map((row) =>
        '<div class="dash-bar">' +
            '<span class="dash-bar-label">' + escapeHtml(row.label) + '</span>' +
            '<span class="dash-bar-track">' +
                '<span class="dash-bar-fill" style="width:' + ((row.sen / topSen) * 100).toFixed(2) +
                '%;background:' + row.color + '"></span>' +
            '</span>' +
            '<b>' + money(fromSen(row.sen)) + '</b>' +
            '<small>' + pct((row.sen / totalSen) * 100) + '</small>' +
        '</div>'
    ).join('');
}

/**
 * The trend chart, as a line or as columns. Both are drawn against the same
 * scale and the same grid, so switching between them changes the shape on
 * screen and nothing about what is being claimed.
 */
function trendSvg(points, mode) {
    const W = 720, H = 230, L = 62, R = 14, T = 16, B = 30;
    const plotW = W - L - R, plotH = H - T - B;

    const peakSen = points.reduce((max, p) => Math.max(max, p.sen), 0);
    const scaleSen = peakSen || 100;
    const n = points.length;

    const yOf = (sen) => T + plotH - (sen / scaleSen) * plotH;
    const xLine = (i) => (n === 1 ? L + plotW / 2 : L + (i / (n - 1)) * plotW);
    const xBand = (i) => L + ((i + 0.5) / n) * plotW;
    const xOf = mode === 'bar' ? xBand : xLine;

    let svg = '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"' +
        ' role="img" aria-label="Spending trend">';

    // Grid and the ringgit scale down the left.
    [0, 0.25, 0.5, 0.75, 1].forEach((step) => {
        const y = T + plotH - step * plotH;
        svg += '<line class="trend-grid" x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) +
               '" y2="' + y.toFixed(1) + '"></line>' +
               '<text class="trend-axis" x="' + (L - 8) + '" y="' + (y + 3.5).toFixed(1) + '">' +
               fmt(fromSen(scaleSen * step), 0) + '</text>';
    });

    if (mode === 'bar') {
        const width = Math.max(4, (plotW / n) * 0.58);
        points.forEach((point, i) => {
            const y = yOf(point.sen);
            svg += '<rect class="trend-bar" x="' + (xBand(i) - width / 2).toFixed(1) + '" y="' + y.toFixed(1) +
                   '" width="' + width.toFixed(1) + '" height="' + Math.max(0, T + plotH - y).toFixed(1) + '" rx="3">' +
                   '<title>' + escapeHtml(point.label) + ' · ' + money(fromSen(point.sen)) + '</title></rect>';
        });
    } else {
        const line = points.map((point, i) => xOf(i).toFixed(1) + ',' + yOf(point.sen).toFixed(1)).join(' ');
        svg += '<polygon class="trend-area" points="' + xOf(0).toFixed(1) + ',' + (T + plotH) + ' ' + line +
               ' ' + xOf(n - 1).toFixed(1) + ',' + (T + plotH) + '"></polygon>' +
               '<polyline class="trend-line" points="' + line + '"></polyline>';

        points.forEach((point, i) => {
            svg += '<circle class="trend-dot" cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(point.sen).toFixed(1) +
                   '" r="4"><title>' + escapeHtml(point.label) + ' · ' + money(fromSen(point.sen)) +
                   '</title></circle>';
        });
    }

    // Crowded axes are unreadable, so labels thin out rather than overlap.
    const every = Math.ceil(n / 9);
    points.forEach((point, i) => {
        if (i % every && i !== n - 1) return;
        svg += '<text class="trend-tick" x="' + xOf(i).toFixed(1) + '" y="' + (H - 9) + '">' +
               escapeHtml(point.label) + '</text>';
    });

    return svg + '</svg>';
}

/**
 * --------------------------------------------------------------------
 * Painting
 * --------------------------------------------------------------------
 */
function paintDashHero(book) {
    set('dashPeriodLabel', book.range.label);
    set('dashRangeLabel', book.range.sub);

    set('dashTotal', signedMoney(book.totalSen));
    set('dashTotalFoot', book.accountCount
        ? book.accountCount + (book.accountCount === 1 ? ' account' : ' accounts') +
          (book.owingSen ? ' · ' + money(fromSen(book.owingSen)) + ' of it owed' : ' · nothing owed')
        : 'No accounts yet — add one under Expenses');

    set('dashIn', money(fromSen(book.incomeSen)));
    set('dashInFoot', book.incomeSen ? book.range.sub : 'Nothing came in');

    set('dashOut', money(fromSen(book.expenseSen)));
    set('dashOutFoot', book.expenseSen
        ? money(fromSen(Math.round(book.expenseSen / book.days))) + ' a day'
        : 'Nothing went out');
}

/**
 * The icon leads, in a tinted disc: ten figures in a grid are hard to scan by
 * their words alone, and the tint says which kind of figure this is before the
 * label is read. `badge` names the meaning, not the colour — money in is jade
 * wherever it appears, money owed amber, and a figure with no module behind it
 * yet stays grey rather than borrowing a meaning it has not earned.
 */
function kpiTile(kpi) {
    const tile = document.createElement('div');
    tile.className = 'kpi' + (kpi.pending ? ' is-pending' : '');
    tile.innerHTML =
        '<span class="kpi-badge is-' + (kpi.pending ? 'grey' : kpi.badge || 'jade') + '">' +
            '<i class="bi ' + kpi.icon + '"></i></span>' +
        '<span class="kpi-body">' +
            '<span class="kpi-label">' + escapeHtml(kpi.label) + '</span>' +
            '<b class="kpi-value ' + (kpi.tone || '') + '">' + kpi.value + '</b>' +
            '<small class="kpi-foot">' + escapeHtml(kpi.foot) + '</small>' +
        '</span>';
    return tile;
}

function paintDashKpis(book) {
    const host = $('dashKpis');
    if (!host) return;
    host.innerHTML = '';

    const kpis = [
        {
            band: 'stand',
            label: 'Total balance', icon: 'bi-wallet2', badge: 'jade',
            value: signedMoney(book.totalSen),
            tone: book.totalSen < 0 ? 'is-minus' : '',
            foot: 'Every account, all time',
        },
        {
            band: 'period',
            label: 'Total income', icon: 'bi-arrow-down-left-circle', badge: 'jade',
            value: money(fromSen(book.incomeSen)), tone: book.incomeSen ? 'is-plus' : '',
            foot: book.range.label.toLowerCase(),
        },
        {
            band: 'period',
            label: 'Total expenses', icon: 'bi-arrow-up-right-circle', badge: 'red',
            value: money(fromSen(book.expenseSen)), tone: book.expenseSen ? 'is-minus' : '',
            foot: book.range.label.toLowerCase(),
        },
        {
            band: 'period',
            label: 'Net cash flow', icon: 'bi-arrow-left-right', badge: 'indigo',
            value: signedMoney(book.netSen),
            tone: book.netSen < 0 ? 'is-minus' : book.netSen > 0 ? 'is-plus' : '',
            foot: book.incomeSen
                ? pct((book.netSen / book.incomeSen) * 100) + ' of what came in'
                : 'Income − expenses',
        },
        {
            band: 'stand',
            label: 'Total savings', icon: 'bi-piggy-bank', badge: 'indigo',
            value: money(fromSen(book.savingsSen)),
            foot: book.investedSen
                ? money(fromSen(book.cashSavingsSen)) + ' in accounts · ' +
                  money(fromSen(book.investedSen)) + ' put into investments'
                : 'Accounts kept for saving or investing',
        },
        {
            band: 'stand',
            label: 'Investment gain', icon: 'bi-graph-up-arrow', badge: 'indigo',
            value: book.investmentSen ? signedMoney(book.investGainSen) : '—',
            tone: book.investGainSen < 0 ? 'is-minus' : book.investGainSen > 0 ? 'is-plus' : '',
            pending: !book.investmentSen,
            foot: !book.investmentSen
                ? 'Nothing in Grow yet'
                : book.investGainSen
                    ? 'Dividends and growth on ' + money(fromSen(book.investedSen)) +
                      ' · worth ' + money(fromSen(book.investmentSen))
                    : 'Worth what went in so far — ' + money(fromSen(book.investmentSen)),
        },
        {
            band: 'owe',
            label: 'Outstanding instalments', icon: 'bi-calendar2-check', badge: 'indigo',
            value: book.instalmentSen ? money(fromSen(book.instalmentSen)) : '—',
            tone: book.instalmentSen ? 'is-minus' : '',
            pending: !book.instalmentSen,
            foot: book.instalmentSen
                ? 'Still to pay across every live plan'
                : 'Nothing on instalment',
        },
        {
            band: 'owe',
            label: 'Credit card outstanding', icon: 'bi-credit-card-2-front', badge: 'amber',
            value: money(fromSen(book.creditSen)),
            tone: book.creditSen ? 'is-minus' : '',
            foot: book.creditFromCard ? 'From your cards under Card Payoff'
                : book.creditCount ? book.creditCount + (book.creditCount === 1 ? ' credit account' : ' credit accounts')
                : 'No credit account recorded',
        },
        {
            band: 'owe',
            label: 'Upcoming payments', icon: 'bi-hourglass-split', badge: 'amber',
            value: book.commitDue.count ? money(fromSen(book.commitDue.sen)) : '—',
            pending: !book.commitDue.count,
            foot: book.commitDue.count
                ? book.commitDue.count + (book.commitDue.count === 1 ? ' payment due ' : ' payments due ') +
                  'this period · next ' + dayShort(book.commitDue.soonest)
                : 'Nothing due this period',
        },
        {
            band: 'period',
            label: 'Budget remaining', icon: 'bi-clipboard-check', badge: 'amber',
            value: book.plannedSen ? signedMoney(book.budgetLeftSen) : '—',
            tone: !book.plannedSen ? '' : book.budgetLeftSen < 0 ? 'is-minus' : 'is-plus',
            pending: !book.plannedSen,
            foot: !book.plannedSen
                ? 'No plan covers these dates'
                : 'of ' + money(fromSen(book.plannedSen)) + ' planned',
        },
    ];

    // Three questions, asked separately: what you have, what moved this
    // period, and what is owed. Nine tiles in one grid answered all three at
    // once and none of them clearly.
    const bands = [
        { id: 'stand',  title: 'Where you stand', note: 'All time' },
        { id: 'period', title: 'This period',     note: book.range.label },
        { id: 'owe',    title: 'What you owe',    note: '' },
    ];

    bands.forEach((band) => {
        const rows = kpis.filter((kpi) => kpi.band === band.id);
        if (!rows.length) return;

        const wrap = document.createElement('div');
        wrap.className = 'kpi-band';

        const head = document.createElement('div');
        head.className = 'kpi-band-head';
        head.innerHTML = '<h3>' + escapeHtml(band.title) + '</h3>' +
            (band.note ? '<span>' + escapeHtml(band.note) + '</span>' : '');
        wrap.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'kpi-grid';
        rows.forEach((kpi) => grid.appendChild(kpiTile(kpi)));
        wrap.appendChild(grid);

        host.appendChild(wrap);
    });
}

/** Income against expenses, with transfers named but kept out of both. */
function paintDashFlow(book) {
    set('dashFlowIn',  money(fromSen(book.incomeSen)));
    set('dashFlowOut', money(fromSen(book.expenseSen)));
    set('dashFlowNet', signedMoney(book.netSen));

    const net = $('dashFlowNet');
    if (net) net.className = book.netSen < 0 ? 'is-minus' : '';

    set('dashFlowNote', book.movedSen
        ? money(fromSen(book.movedSen)) + ' moved between accounts — not counted either side'
        : 'Transfers are excluded from both sides');

    const dist = $('dashFlowDist');
    if (!dist) return;
    dist.innerHTML = '';

    const base = Math.max(book.incomeSen, book.expenseSen);
    if (!base) {
        paintEmpty(dist, 'Nothing recorded in ' + book.range.sub,
            'Income and spending are measured against each other — this needs one of them.',
            'bi-arrow-left-right');
        set('dashFlowVerdict', '');
        return;
    }

    clearEmpty(dist);

    const spent = document.createElement('span');
    spent.className = book.expenseSen > book.incomeSen ? 'dist-red' : 'dist-jade';
    spent.style.width = ((book.expenseSen / base) * 100) + '%';
    spent.title = 'Spent · ' + money(fromSen(book.expenseSen));
    dist.appendChild(spent);

    const kept = document.createElement('span');
    kept.className = 'dist-left';
    kept.style.width = (100 - (book.expenseSen / base) * 100) + '%';
    dist.appendChild(kept);

    set('dashFlowVerdict',
        !book.incomeSen ? 'Spending only — no income recorded to measure it against.'
        : book.netSen < 0 ? 'Spent ' + money(fromSen(-book.netSen)) + ' more than came in.'
        : 'Kept ' + pct((book.netSen / book.incomeSen) * 100) + ' of what came in.');
}

/**
 * Accounts, grouped the way the ledger groups them, and each one a button:
 * clicking it opens that account's history for the selected period.
 */
function paintDashAccounts(book) {
    const host = $('dashAccounts');
    if (!host) return;
    host.innerHTML = '';

    if (!ledgerState.accounts.length) {
        host.innerHTML = '<p class="split-empty">No accounts yet. Add them under Expenses → Accounts.</p>';
        set('dashAccountsTotal', money(0));
        paintDashHistory(book);
        return;
    }

    ledgerState.types.forEach(({ id: key, label }) => {
        const inGroup = ledgerState.accounts.filter((account) => account.type === key);
        if (!inGroup.length) return;

        const groupSen = inGroup.reduce((sum, account) => sum + (book.balances[account.id] || 0), 0);

        const head = document.createElement('div');
        head.className = 'acct-group';
        head.innerHTML = '<span>' + label + '</span><b>' + signedMoney(groupSen) + '</b>';
        host.appendChild(head);

        inGroup.forEach((account, index) => {
            const balance = book.balances[account.id] || 0;
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'acct-pick' + (dashState.account === account.id ? ' is-on' : '');
            row.dataset.account = account.id;
            row.innerHTML = '<span></span><b class="' + (balance < 0 ? 'is-minus' : '') + '">' +
                signedMoney(balance) + '</b><i class="bi bi-chevron-right"></i>';
            row.querySelector('span').textContent = account.name.trim() || 'Account ' + (index + 1);
            host.appendChild(row);
        });
    });

    const total = document.createElement('div');
    total.className = 'acct-group is-total';
    total.innerHTML = '<span>Total</span><b>' + signedMoney(book.totalSen) + '</b>';
    host.appendChild(total);

    set('dashAccountsTotal', signedMoney(book.totalSen));
    paintDashHistory(book);
}

/** One account's entries inside the selected period, and what each did to it. */
function paintDashHistory(book) {
    const panel = $('dashHistory');
    const list  = $('dashHistoryList');
    if (!panel || !list) return;

    const account = dashState.account ? accountById(dashState.account) : null;
    if (!account) {
        panel.hidden = true;
        return;
    }

    panel.hidden = false;
    set('dashHistoryTitle', (account.name.trim() || 'Account') + ' — ' + book.range.sub);

    const touching = book.entries.filter((entry) =>
        entry.account === account.id || entry.toAccount === account.id);

    // What each entry did to *this* account, which is not the same as what it
    // did to the book: a transfer is a minus on one side and a plus on the other.
    const effect = (entry) => {
        const sen = entrySen(entry);
        if (entry.type === 'income' || entry.type === 'refund') return sen;
        if (entry.type === 'expense') return -sen;
        return entry.toAccount === account.id ? sen : -sen;
    };

    const movedSen = touching.reduce((sum, entry) => sum + effect(entry), 0);
    set('dashHistoryNote', touching.length
        ? touching.length + (touching.length === 1 ? ' entry' : ' entries') + ' · ' +
          diffMoney(movedSen) + ' over the period · balance now ' +
          signedMoney(book.balances[account.id] || 0)
        : 'Balance ' + signedMoney(book.balances[account.id] || 0));

    list.innerHTML = '';

    if (!touching.length) {
        list.innerHTML = '<p class="split-empty">Nothing touched this account in ' +
            escapeHtml(book.range.sub) + '.</p>';
        return;
    }

    touching.forEach((entry) => {
        const moved = effect(entry);
        const cat = categoryOf(entry);
        const label = entry.type === 'transfer'
            ? (entry.toAccount === account.id
                ? 'From ' + dashAccountLabel(entry.account)
                : 'To ' + dashAccountLabel(entry.toAccount))
            : cat.label;

        const row = document.createElement('div');
        row.className = 'hist-row';
        row.innerHTML =
            '<span class="hist-date">' + dayShort(entry.date) + '</span>' +
            '<span class="hist-what"><b></b><small></small></span>' +
            '<b class="hist-amount ' + (moved < 0 ? 'is-out' : 'is-in') + '">' + diffMoney(moved) + '</b>';
        row.querySelector('.hist-what b').textContent = label;
        row.querySelector('.hist-what small').textContent =
            (entry.note || '').trim() || (entry.type === 'transfer' ? 'Transfer' : cat.label);
        list.appendChild(row);
    });
}

function paintDashBreakdown(book) {
    const chart  = $('dashBreakdownChart');
    const legend = $('dashLegend');
    const body   = $('dashBreakdownBody');
    if (!chart || !legend || !body) return;

    const dim  = (($('dashDim') || {}).dataset || {}).value || 'category';
    const view = (($('dashDimChart') || {}).dataset || {}).value || 'donut';
    const rows = dashBreakdown(book.entries, dim);

    chart.innerHTML = '';
    legend.innerHTML = '';
    body.innerHTML = '';

    set('dashDimHead', DASH_DIMS[dim] || 'Category');

    const table = body.closest('.table-wrap');
    showWithData(!!rows.length, legend, table);

    if (!rows.length) {
        paintEmpty(chart, 'Nothing spent in ' + book.range.sub,
            'Record something in Expenses, or widen the period above.', 'bi-pie-chart');
        set('dashBreakdownNote', '—');
        return;
    }

    clearEmpty(chart);

    set('dashBreakdownNote', rows.length + ' ' +
        (rows.length === 1 ? (DASH_DIMS[dim] || 'Category').toLowerCase() : DASH_DIM_PLURAL[dim] || 'categories') +
        ' · biggest is ' + rows[0].label);

    chart.innerHTML = view === 'bar'
        ? '<div class="dash-bars">' + barsHtml(rows, book.expenseSen) + '</div>'
        : donutSvg(rows, book.expenseSen);

    rows.forEach((row) => {
        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML =
            '<i class="dot" style="background:' + row.color + '"></i>' +
            '<span>' + escapeHtml(row.label) + ' <b>' + money(fromSen(row.sen)) + '</b> ' +
            '<small>' + pct((row.sen / book.expenseSen) * 100) + '</small></span>';
        legend.appendChild(item);
    });

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.appendChild(cell('<strong><i class="dot" style="background:' + row.color + '"></i>' +
            escapeHtml(row.label) + '</strong>'));
        tr.appendChild(cell(fmt(fromSen(row.sen)), 'is-strong'));
        tr.appendChild(cell(pct((row.sen / book.expenseSen) * 100), 'is-muted'));
        tr.appendChild(cell(String(row.count), 'is-muted'));
        body.appendChild(tr);
    });

    const total = document.createElement('tr');
    total.className = 'total-row';
    total.appendChild(cell('Spent'));
    total.appendChild(cell(fmt(fromSen(book.expenseSen))));
    total.appendChild(cell('100.0%'));
    total.appendChild(cell(String(rows.reduce((sum, row) => sum + row.count, 0))));
    body.appendChild(total);
}

function paintDashTrend(book) {
    const host = $('dashTrendChart');
    if (!host) return;

    const grain = dashGrain();
    const view  = (($('dashTrendView') || {}).dataset || {}).value || 'line';

    // The current month runs past today, and a fortnight of days that have not
    // happened yet reads as a spending collapse. Periods that are wholly in the
    // past keep their own end.
    const today  = todayIso();
    const endIso = book.range.to > today ? today : book.range.to;
    const points = dashTrend(grain, endIso);

    const spent = points.filter((point) => point.sen > 0);

    // With no spending at all the scale falls back to a nominal RM1, and the
    // axis prints 1, 1, 1, 0, 0 down the side of an empty grid. A chart of
    // nothing is worse than saying there is nothing.
    if (!spent.length) {
        paintEmpty(host, 'No spending to plot',
            'The trend needs at least one entry in the last ' + points.length + ' periods.',
            'bi-graph-up');
        set('dashTrendNote', 'Nothing spent across these ' + points.length + ' periods');
        set('dashTrendFoot', '—');
        return;
    }

    clearEmpty(host);
    host.innerHTML = trendSvg(points, view);

    const peak = spent.reduce((top, point) => (point.sen > top.sen ? point : top), spent[0]);
    const low  = spent.reduce((bottom, point) => (point.sen < bottom.sen ? point : bottom), spent[0]);
    const meanSen = Math.round(points.reduce((sum, point) => sum + point.sen, 0) / points.length);

    set('dashTrendNote', points.length + ' periods ending ' + dayShort(endIso));
    set('dashTrendFoot', 'Highest ' + peak.label + ' · ' + money(fromSen(peak.sen)) +
        '  ·  Lowest ' + low.label + ' · ' + money(fromSen(low.sen)) +
        '  ·  Average ' + money(fromSen(meanSen)));
}

/**
 * The comparison. Both sides are recomputed from the ledger, never from
 * anything the dashboard has already drawn — the same figure derived twice
 * from the same records is the only way it stays one figure.
 */
function paintDashCompare() {
    const grain   = dashCmpGrain();
    const periods = dashComparePeriods(grain);
    const selA = $('dashCmpA'), selB = $('dashCmpB');
    if (!selA || !selB) return;

    // A grain change invalidates the keys, so the pair falls back to the two
    // most recent periods — B the later one, A the one before it.
    const known = periods.map((period) => period.key);
    if (!known.includes(dashState.cmpB)) dashState.cmpB = known[0] || '';
    if (!known.includes(dashState.cmpA)) dashState.cmpA = known[1] || known[0] || '';

    [[selA, dashState.cmpA], [selB, dashState.cmpB]].forEach(([select, chosen]) => {
        select.innerHTML = '';
        periods.forEach((period) => {
            const option = document.createElement('option');
            option.value = period.key;
            option.textContent = period.label;
            if (period.key === chosen) option.selected = true;
            select.appendChild(option);
        });
    });

    const findPeriod = (key) => periods.find((period) => period.key === key) || periods[0];
    const a = dashSideTotals(findPeriod(dashState.cmpA));
    const b = dashSideTotals(findPeriod(dashState.cmpB));
    const delta = dashDelta(a.expenseSen, b.expenseSen);

    set('dashCmpALabel', a.period.label);
    set('dashCmpBLabel', b.period.label);
    set('dashCmpAValue', money(fromSen(a.expenseSen)));
    set('dashCmpBValue', money(fromSen(b.expenseSen)));
    set('dashCmpDiff', diffMoney(delta.diffSen));
    set('dashCmpPct', diffPct(delta.pct));

    const diffCell = $('dashCmpDiff');
    if (diffCell) diffCell.className = delta.tone;
    const pctCell = $('dashCmpPct');
    if (pctCell) pctCell.className = delta.tone;

    set('dashCmpAHead', a.period.label);
    set('dashCmpBHead', b.period.label);

    const verdict = $('dashCmpVerdict');
    if (verdict) {
        const icon = delta.direction === 'up' ? 'bi-graph-up-arrow'
            : delta.direction === 'down' ? 'bi-graph-down-arrow' : 'bi-dash-circle';
        verdict.className = 'notice is-' + delta.direction;
        verdict.innerHTML = '<i class="bi ' + icon + '"></i><span></span>';
        verdict.querySelector('span').textContent =
            'Spending ' + delta.word + ' from ' + a.period.label + ' to ' + b.period.label +
            (delta.direction === 'same' ? '.' : ' — ' + money(fromSen(Math.abs(delta.diffSen))) +
            (delta.pct === null ? '' : ', ' + diffPct(delta.pct)) + '.');
    }

    set('dashCmpFlow',
        'Income ' + money(fromSen(a.incomeSen)) + ' → ' + money(fromSen(b.incomeSen)) +
        '  ·  Net ' + signedMoney(a.netSen) + ' → ' + signedMoney(b.netSen));

    // One row per category either side recorded — a category that stopped
    // being spent on is exactly the row worth seeing.
    const body = $('dashCmpBody');
    if (!body) return;
    body.innerHTML = '';

    const ids = Array.from(new Set(Object.keys(a.byCategory).concat(Object.keys(b.byCategory))));
    if (!ids.length) {
        body.appendChild(emptyRow('No spending recorded in either period.', 4));
        return;
    }

    ids.map((id) => {
        const cat = resolveCategory(id, 'expense');
        return {
            label: cat ? cat.label : 'Other',
            tone:  cat ? BUDGET_BUCKETS[cat.bucket].tone : 'jade',
            aSen:  a.byCategory[id] || 0,
            bSen:  b.byCategory[id] || 0,
        };
    })
    .sort((x, y) => (y.bSen - y.aSen === x.bSen - x.aSen
        ? y.bSen - x.bSen
        : Math.abs(y.bSen - y.aSen) - Math.abs(x.bSen - x.aSen)))
    .forEach((row) => {
        const moved = row.bSen - row.aSen;
        const tr = document.createElement('tr');
        tr.appendChild(cell('<strong><i class="dot dot-' + row.tone + '"></i>' + escapeHtml(row.label) + '</strong>'));
        tr.appendChild(cell(fmt(fromSen(row.aSen)), 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(row.bSen)), 'is-strong'));
        tr.appendChild(cell(moved === 0 ? 'RM 0.00' : diffMoney(moved),
            moved === 0 ? 'is-muted' : moved > 0 ? 'is-minus' : 'is-plus'));
        body.appendChild(tr);
    });

    const total = document.createElement('tr');
    total.className = 'total-row';
    total.appendChild(cell('Spent'));
    total.appendChild(cell(fmt(fromSen(a.expenseSen))));
    total.appendChild(cell(fmt(fromSen(b.expenseSen))));
    total.appendChild(cell(delta.diffSen === 0 ? 'RM 0.00' : diffMoney(delta.diffSen)));
    body.appendChild(total);
}

/** The custom date fields only mean anything on a custom range. */
function syncDashPeriod() {
    const custom = $('dashCustom');
    if (custom) custom.hidden = dashPeriod() !== 'custom';
}

function renderDash() {
    // Account rows are typed into directly under Expenses; read them back so a
    // rename made over there is already true by the time this paints.
    readLedgerAccounts();
    syncDashPeriod();

    const book = dashCompute();

    // An account deleted since it was opened must not leave a stale panel up.
    if (dashState.account && !accountById(dashState.account)) dashState.account = null;

    paintDashHero(book);
    paintDashKpis(book);
    paintDashFlow(book);
    paintDashAccounts(book);
    paintDashBreakdown(book);
    paintDashTrend(book);
    paintDashCompare();
}

function dashSummaryText() {
    const book = dashCompute();
    const rows = dashBreakdown(book.entries, (($('dashDim') || {}).dataset || {}).value || 'category');

    const lines = [
        'MoneyFlow — ' + book.range.label + ' (' + book.range.sub + ')',
        '',
        'Total balance     ' + signedMoney(book.totalSen),
        'Income            ' + money(fromSen(book.incomeSen)),
        'Expenses          ' + money(fromSen(book.expenseSen)),
        'Net cash flow     ' + signedMoney(book.netSen),
        'Savings           ' + money(fromSen(book.savingsSen)) +
            (book.investedSen
                ? ' (' + money(fromSen(book.cashSavingsSen)) + ' in accounts, ' +
                  money(fromSen(book.investedSen)) + ' invested)'
                : ''),
        'Card outstanding  ' + money(fromSen(book.creditSen)),
    ];

    if (book.plannedSen) lines.push('Budget remaining  ' + signedMoney(book.budgetLeftSen));
    if (book.movedSen)   lines.push('Moved between accounts ' + money(fromSen(book.movedSen)));

    if (rows.length) {
        lines.push('', 'Where it went');
        rows.forEach((row) => {
            lines.push('  ' + row.label.padEnd(18) + money(fromSen(row.sen)).padStart(12) +
                '  ' + pct((row.sen / book.expenseSen) * 100));
        });
    }

    return lines.join('\n');
}

/**
 * ====================================================================
 * THEME
 * ====================================================================
 * There is no theme code any more, and that is the whole design: MoneyFlow
 * is a dark app, the same one for everybody. `data-theme="dark"` is written
 * on <html> in the markup, so the palette is settled before the first byte
 * of this file is parsed — nothing to resolve, nothing to flash, and no
 * preference to lose when the browser is cleared.
 *
 * The light tokens still sit at the top of the stylesheet as the base layer
 * the dark ones are written against; nothing selects them.
 * ====================================================================
 */

/**
 * ====================================================================
 * NAVIGATION
 * ====================================================================
 * The same button does two different jobs, because it is answering the same
 * question in two shapes of window.
 *
 * On a phone the sidebar is a drawer: it is not on the page at all until it
 * is asked for, which is the only honest way to spend 264px on a 375px
 * screen. Choosing a module closes it, because on a phone choosing a module
 * is the reason it was opened.
 *
 * On a desktop there is room for the column, so the button collapses it to a
 * rail of icons instead — narrower, still always there, and remembered
 * between visits because it is a preference rather than a state.
 * ====================================================================
 */
const NAV_KEY = 'moneyflow.nav.v1';

/** Below this the sidebar is a drawer; above it, a column. Matches the CSS. */
const navIsDrawer = () => window.matchMedia('(max-width: 1000px)').matches;

function paintNav() {
    const app = document.querySelector('.app');
    const btn = $('navToggle');
    const scrim = $('navScrim');
    if (!app || !btn) return;

    const drawer = navIsDrawer();
    const open = app.classList.contains('is-open');
    const rail = app.classList.contains('is-rail');

    if (scrim) scrim.hidden = !(drawer && open);
    btn.setAttribute('aria-expanded', String(drawer ? open : !rail));

    // A drawer opens and shuts; a column slides one way or the other. On the
    // desktop the button is a 26px circle on the sidebar's edge with no room
    // for a word, so the chevron points where that edge is about to go and
    // the word survives as the accessible name and the tooltip.
    const icon = btn.querySelector('i');
    if (icon) {
        icon.className = 'bi ' + (drawer
            ? (open ? 'bi-x-lg' : 'bi-list')
            : (rail ? 'bi-chevron-double-right' : 'bi-chevron-double-left'));
    }

    const label = drawer ? (open ? 'Close' : 'Menu') : rail ? 'Expand' : 'Collapse';
    set('navToggleLabel', label);
    btn.title = drawer ? (open ? 'Close the menu' : 'Menu') : label + ' the sidebar';
}

function toggleNav() {
    const app = document.querySelector('.app');
    if (!app) return;

    if (navIsDrawer()) {
        app.classList.toggle('is-open');
    } else {
        app.classList.toggle('is-rail');
        try { localStorage.setItem(NAV_KEY, app.classList.contains('is-rail') ? 'rail' : 'full'); }
        catch (err) { /* storage unavailable — the session still works */ }
    }
    paintNav();
}

function closeDrawer() {
    const app = document.querySelector('.app');
    if (!app) return;
    app.classList.remove('is-open');
    paintNav();
}

function loadNav() {
    const app = document.querySelector('.app');
    if (!app) return;
    let saved = null;
    try { saved = localStorage.getItem(NAV_KEY); } catch (err) { saved = null; }
    app.classList.toggle('is-rail', saved === 'rail');
    paintNav();
}

/**
 * ====================================================================
 * WIRING
 * ====================================================================
 */
/** Each module owns a <section class="module"> of the same name and a render. */
const MODULES = {
    dash:   { render: renderDash },
    ledger: { render: renderLedger },
    split:  { render: renderSplit },
    budget: { render: renderBudget },
    commit: { render: renderCommit },
    card:   { render: renderCard },
    grow:   { render: renderGrow },
};

const FORM_DEFAULTS = {
    dash: {
        dashPeriod: 'month', dashFrom: '', dashTo: '',
        dashDim: 'category', dashDimChart: 'donut',
        dashTrend: 'monthly', dashTrendView: 'line',
        dashCmpGrain: 'month',
    },
    ledger: { ledgerType: 'expense', ledgerAmount: '', ledgerNote: '' },
    split:  {
        splitCharges: 'none', splitTitle: '',
        splitService: '0', splitTax: '0', splitDiscount: '',
    },
    budget: { budgetIncome: '', budgetExtra: '', budgetRule: '502030' },
    commit: {
        commitDirection: 'out', commitBasis: 'total', commitName: '', commitWho: '',
        commitTotal: '', commitMonthly: '', commitMonths: '', commitPaidCount: '',
    },
    card:   {
        cardTier: '18', cardName: '', cardLimit: '', cardBalance: '', cardRate: '18',
        cardMinPct: '5', cardMinFloor: '25', cardDueDay: '',
    },
    grow:   {
        growName: '', growType: 'asb', growValue: '', growNote: '',
        growFdRate: '', growFdMonths: '',
    },
};

function showModule(key) {
    if (!MODULES[key]) return;

    Object.keys(MODULES).forEach((id) => {
        const section = $('module-' + id);
        if (section) section.hidden = id !== key;
    });

    document.querySelectorAll('#tabs button').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.module === key);
    });

    MODULES[key].render();
}

function resetForm(which) {
    Object.entries(FORM_DEFAULTS[which] || {}).forEach(([id, value]) => {
        const el = $(id);
        if (!el) return;
        if (el.classList.contains('seg')) {
            setSegment(el, value);
        } else {
            el.value = value;
        }
    });

    // "Start over" clears the form, not the history: saved bills are records,
    // and a reset button is not what anyone expects to delete records with.
    if (which === 'split') {
        if ($('splitRound')) $('splitRound').checked = false;
        splitNewBill();
    }

    // The plan on screen is emptied; the saved budgets are records and stay.
    // Reset is not what anyone expects to delete history with.
    if (which === 'budget') {
        const plan = planDraft();
        planState.draft = Object.assign(blankPlan(), {
            period: plan.period, anchor: plan.anchor, from: plan.from, to: plan.to,
        });
        fillBudgetForm();
        renderBudget();
    }

    // "New plan", not "wipe the tracker": saved plans are records.
    if (which === 'commit') {
        commitNewPlan();
    }

    if (which === 'card') cardNewCard();

    if (which === 'grow') growNewInvestment();

    // The dashboard writes nothing, so "reset" is only ever about the view:
    // back to this month, and close whatever account was opened.
    if (which === 'dash') {
        dashState.account = null;
        renderDash();
    }

    // "Clear" empties the entry form and drops out of edit mode. It must never
    // touch what is already written down.
    if (which === 'ledger') {
        ledgerClearForm();
        syncLedgerForm();
        renderLedger();
    }
}

/**
 * ====================================================================
 * BACKUP — the only copy of this data you actually control
 * --------------------------------------------------------------------
 * Everything MoneyFlow remembers lives in this browser — IndexedDB where there
 * means it lives in one browser, on one address, on one machine. Clearing
 * browsing data wipes it. There is no server holding a second copy and nobody
 * to ask for one.
 *
 * So: a file. Export writes every store into one .json you can keep in Drive
 * or email to yourself; Import reads it back, here or on a different computer.
 * That file is the backup, the way to move to a new machine, and the way out
 * of this app if you ever want your figures somewhere else.
 *
 * Import replaces rather than merges. Merging two ledgers means deciding what
 * counts as the same entry, and getting that wrong quietly doubles a balance —
 * worse than the honest thing, which is to say plainly that the file wins and
 * everything here goes.
 * ====================================================================
 */

const BACKUP_FORMAT  = 'moneyflow.backup';
const BACKUP_VERSION = 1;

/** Every store the app persists. A new module adds its key here or it is not backed up. */
// Categories belong in here: they are records, not a display preference.
// A backup without them would restore a year of entries under names the
// reader never chose.
const BACKUP_STORES = [LEDGER_KEY, CATEGORY_KEY, BUDGET_KEY, GOALS_KEY, COMMIT_KEY, CARD_KEY, GROW_KEY, SPLIT_KEY];

/**
 * Reads the stores as they sit on disk. `storedRaw` is used rather than the
 * module state so an export copies what is written down, not what happens to
 * be on screen — those differ mid-edit, and the written one is the truth.
 */
function backupEnvelope() {
    const stores = {};
    BACKUP_STORES.forEach((key) => {
        const raw = storedRaw(key);
        if (!raw) return;
        try { stores[key] = JSON.parse(raw); } catch (err) { /* unreadable: leave it out */ }
    });

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        app: 'MoneyFlow',
        exportedAt: new Date().toISOString(),
        stores,
    };
}

/** "27 entries across 4 accounts", or "nothing recorded yet" — for the dialog. */
function backupSummary(envelope) {
    const ledger = (envelope.stores && envelope.stores[LEDGER_KEY]) || {};
    const split  = (envelope.stores && envelope.stores[SPLIT_KEY])  || {};
    const budget = (envelope.stores && envelope.stores[BUDGET_KEY]) || {};
    const goals  = (envelope.stores && envelope.stores[GOALS_KEY])  || {};
    const entries  = Array.isArray(ledger.entries)  ? ledger.entries.length  : 0;
    const accounts = Array.isArray(ledger.accounts) ? ledger.accounts.length : 0;
    const bills    = Array.isArray(split.bills)     ? split.bills.length     : 0;
    const plans    = Array.isArray(budget.budgets)  ? budget.budgets.length  : 0;
    const goalList = Array.isArray(goals.list)      ? goals.list.length      : 0;

    // Plans and goals are records too, so a dialog that only counts entries
    // understates what is about to be replaced.
    const also = [
        bills    ? bills    + (bills    === 1 ? ' shared bill' : ' shared bills')  : '',
        plans    ? plans    + (plans    === 1 ? ' budget'      : ' budgets')       : '',
        goalList ? goalList + (goalList === 1 ? ' savings goal': ' savings goals') : '',
    ].filter(Boolean);
    const tail = also.length ? ', ' + also.slice(0, -1).concat(
        (also.length > 1 ? 'and ' : '') + also[also.length - 1]).join(', ') : '';

    if (!entries) {
        return (accounts ? accounts + ' accounts and nothing recorded yet' : 'nothing recorded yet') + tail;
    }
    return entries + (entries === 1 ? ' entry' : ' entries')
        + ' across ' + accounts + (accounts === 1 ? ' account' : ' accounts') + tail;
}

/**
 * Does this browser hold any records at all?
 *
 * Categories and accounts are seeded on a first visit, so their presence says
 * nothing — only things the reader put there count. This is what tells the
 * Drive layer whether to offer to bring a copy down, which is the one moment
 * that offer is worth making: a browser that was cleared, or a machine seeing
 * the app for the first time.
 */
function storeIsEmpty() {
    const stores = backupEnvelope().stores;
    const some = (key, pick) => {
        const held = stores[key];
        if (!held) return false;
        const rows = pick(held);
        return Array.isArray(rows) && rows.length > 0;
    };

    return !some(LEDGER_KEY, (v) => v.entries)
        && !some(SPLIT_KEY,  (v) => v.bills)
        && !some(BUDGET_KEY, (v) => v.budgets)
        && !some(GOALS_KEY,  (v) => v.list)
        && !some(COMMIT_KEY, (v) => v.plans)
        && !some(CARD_KEY,   (v) => v.cards)
        && !some(GROW_KEY,   (v) => v.investments);
}

function backupFilename() {
    return 'moneyflow-' + todayIso() + '.json';
}

/* -------------------------------------------------------------------- */

function backupExport(btn) {
    try {
        const blob = new Blob([JSON.stringify(backupEnvelope(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = backupFilename();
        document.body.appendChild(link);
        link.click();
        link.remove();

        // Revoking immediately can cancel the download in some browsers; a
        // beat later is safe, and the object is tiny either way.
        setTimeout(() => URL.revokeObjectURL(url), 4000);

        flashButton(btn, '<i class="bi bi-check-lg"></i><span>Saved</span>');
    } catch (err) {
        backupSay('Could not save the file',
            'The browser refused to write the download. If this is a private window, '
            + 'try again in a normal one.');
    }
}

/**
 * The chosen file, checked before anything is destroyed. Everything that can
 * be wrong with it is named, because "invalid file" does not tell you whether
 * you picked the wrong file or the right one has gone bad.
 */
function backupRead(file) {
    return file.text().then((text) => {
        let data;
        try {
            data = JSON.parse(text);
        } catch (err) {
            throw new Error('That file is not readable as JSON. Pick the .json file MoneyFlow exported.');
        }

        if (!data || typeof data !== 'object' || data.format !== BACKUP_FORMAT) {
            throw new Error('That is not a MoneyFlow backup. The file should have come from Export, '
                + 'and its name starts with "moneyflow-".');
        }
        if (Number(data.version) > BACKUP_VERSION) {
            throw new Error('That backup was made by a newer version of MoneyFlow than this one. '
                + 'Update the app first, or it would read the file wrongly.');
        }
        if (!data.stores || typeof data.stores !== 'object') {
            throw new Error('That backup is empty — it carries no records at all.');
        }
        if (!Object.keys(data.stores).some((key) => BACKUP_STORES.includes(key))) {
            throw new Error('That backup holds nothing this version of MoneyFlow recognises.');
        }

        return data;
    });
}

/**
 * Writes the file in, then reloads. Reloading rather than re-rendering is
 * deliberate: every module reads its store once at start-up and then keeps
 * state in its own variables, so a reload is the one way to be certain nothing
 * survives from before the import.
 */
/**
 * Restoring is all-or-nothing, and it has to be.
 *
 * Writing store by store and giving up on the first failure leaves half the
 * new book and half the old one — the two blended together, which is the exact
 * outcome "replace, never merge" exists to prevent. Worse, the message said
 * "nothing was changed", which by then was untrue.
 *
 * So the old values are held first, every store is written, and any failure
 * puts all of them back before anyone is told. A restore either happened or it
 * did not.
 */
function backupApply(envelope) {
    const held = {};
    BACKUP_STORES.forEach((key) => { held[key] = storedRaw(key); });

    const rollback = () => {
        BACKUP_STORES.forEach((key) => {
            if (held[key] === null || held[key] === undefined) MFStore.remove(key);
            else MFStore.set(key, held[key]);
        });
    };

    const gaveUp = () => {
        rollback();
        MFStore.flush();
        storeBroken = false;
        storeBrokenWhy = '';
        paintStoreAlert();
        backupSay('Could not restore that backup',
            'It did not fit in this browser, so everything has been put back exactly as it was — '
            + 'nothing of yours was lost. Try it in a browser holding fewer records, or export what '
            + 'is here first and prune it.');
    };

    let failed = false;
    BACKUP_STORES.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(envelope.stores, key)) {
            if (!storeWrite(key, JSON.stringify(envelope.stores[key]))) failed = true;
        } else {
            // Absent from the backup means absent afterwards. Leaving the old
            // value would blend two books, which is the one thing replacing is
            // meant to prevent.
            MFStore.remove(key);
        }
    });

    if (failed) return gaveUp();

    // On IndexedDB the writes are still in flight, and reloading onto a
    // half-written book would be the very thing the rollback exists to
    // prevent — so the reload waits for the flush to say it landed.
    MFStore.flush().then((ok) => { if (ok) location.reload(); else gaveUp(); });
}

/* ------------------------------- dialog ------------------------------ */

/**
 * What the confirm button will do if it is pressed, or null when the dialog is
 * only carrying a message. Anything that can destroy records goes through here
 * — the backup import, and the Drive layer in drive.js — so there is exactly
 * one place in the app where "are you sure" is asked, and it is always asked.
 */
let dialogAction = null;

function backupShow() {
    const box = $('backupDialog');
    if (box) box.hidden = false;
}

function backupClose() {
    const box = $('backupDialog');
    if (box) box.hidden = true;
    dialogAction = null;
}

/** A message with nothing to confirm — the one button becomes the way out. */
function backupSay(title, body) {
    dialogAction = null;
    $('backupTitle').textContent = title;
    $('backupBody').textContent = body;
    $('backupConfirm').hidden = true;
    $('backupCancel').textContent = 'Close';
    backupShow();
}

/** A message that has to be agreed to before `action` runs. */
function askConfirm(title, body, label, action) {
    dialogAction = action;
    $('backupTitle').textContent = title;
    $('backupBody').textContent = body;
    $('backupConfirm').hidden = false;
    $('backupConfirm').textContent = label;
    $('backupCancel').textContent = 'Cancel';
    backupShow();
}

function backupAsk(envelope) {
    const when = envelope.exportedAt ? String(envelope.exportedAt).slice(0, 10) : 'an unknown date';

    askConfirm(
        'Replace everything with this backup?',
        'The file holds ' + backupSummary(envelope) + ', saved on ' + when + '. '
        + 'This browser currently holds ' + backupSummary(backupEnvelope()) + ', and all of it '
        + 'will be replaced. There is no undo — if you want to keep what is here, cancel and Export first.',
        'Replace everything',
        () => backupApply(envelope));
}

/** Brief label swap, the same way the copy buttons report themselves. */
function flashButton(btn, html) {
    if (!btn) return;
    const idle = btn.innerHTML;
    btn.innerHTML = html;
    setTimeout(() => { btn.innerHTML = idle; }, 1800);
}

/**
 * ====================================================================
 * THE DATA PANEL
 * ====================================================================
 * Behind the save stamp: where the records are, how much room is left, and
 * whether there is a second copy. All of it was already known — it was spread
 * across a tooltip, a warning bar that only speaks at 80% full, and a Drive
 * icon. None of that is somewhere you can go and look.
 */
function openData() {
    paintStorage();

    // drive.js paints the second block itself, and is allowed not to be here
    // at all — the app is complete without it.
    if (typeof window.MFDriveStamp === 'function') window.MFDriveStamp();
    else set('driveWhen', 'The Drive copy is not set up in this browser.');

    const box = $('dataBox');
    if (box) box.hidden = false;
}

function closeData() {
    const box = $('dataBox');
    if (box) box.hidden = true;
}

function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

async function paintStorage() {
    const used = storeUsedBytes();
    const budget = MFStore.measure ? await MFStore.measure() : storeBudgetBytes();
    const kept = MFStore.persisted ? await MFStore.persisted() : false;

    set('dataWhere', MFStore.backend() === 'indexedDB'
        ? 'In this browser, in IndexedDB.'
            + (kept ? ' Marked to be kept — the browser will not clear it to free space.' : '')
        : 'In this browser’s localStorage. IndexedDB was not available, so the ceiling is about '
            + '5 MB — receipts and photos are what will reach it.');

    // Against the ceiling rather than against itself: the question here is how
    // much room is left, and a bar that rescales to whatever is stored can
    // never answer it.
    const share = budget ? used / budget * 100 : 0;
    const fill = $('dataMeterFill');
    if (fill) {
        fill.style.width = Math.max(0.4, Math.min(100, share)).toFixed(2) + '%';
        fill.className = share > 90 ? 'is-over' : (share > 70 ? 'is-warn' : '');
    }
    set('dataUsed', fmtSize(used) + ' of ' + fmtSize(budget)
        + (share < 1 ? ' — barely a dent' : ' — ' + share.toFixed(1) + '%'));

    // And what is taking the room, where anything is taking enough of it to be
    // worth naming. "2.6 MB of saved bill splits" is something you can act on;
    // a percentage is only an alarm. Below half a megabyte there is nothing to
    // act on and every share rounds to 0.00 MB, so it says nothing instead.
    const big = $('dataBiggest');
    if (big) {
        const named = used >= 512 * 1024 ? storeBiggest(used) : [];
        big.textContent = named.length ? 'Mostly ' + named.join(', ') + '.' : '';
        big.hidden = !named.length;
    }
}

/**
 * ====================================================================
 * FOLDING A CARD AWAY
 * ====================================================================
 * Seven cards in a module is a long page, and most days a reader wants two
 * of them. So every card gets a chevron in its heading, and a card folded
 * away stays folded — the decision is about how somebody works, not about
 * this visit, and a fold that reopens on reload is one nobody uses twice.
 *
 * Nothing starts folded. A card that opens closed is a card you have to
 * discover, and the empty screen behind it looks like a bug.
 *
 * The state is keyed by where the card sits in its module rather than by its
 * heading, because two headings here say "Where it went" and one of them
 * changes its wording as you type. Moving a card in the markup therefore
 * moves the fold with the position, which is a fair trade for never
 * mismatching two cards that share a name.
 */
const FOLD_KEY = 'moneyflow.folds.v1';

function foldsHeld() {
    try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); }
    catch (err) { return new Set(); }
}

function rememberFolds(held) {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(Array.from(held))); }
    catch (err) { /* the fold is a convenience; losing it costs nothing */ }
}

/**
 * Open whatever fold this element is buried under, and hand it back.
 *
 * Every "edit this entry" and "add an account" in the app ends by scrolling to
 * the thing it just made ready. If the card holding it is folded away, that
 * scroll lands on a heading and the click looks like it did nothing — so the
 * fold gives way to the reader's own request. It is idempotent: an element
 * already in view walks out of here untouched.
 */
function reveal(el) {
    const card = el && el.closest ? el.closest('.card.is-folded') : null;
    if (card) {
        const btn = card.querySelector(':scope > .card-head > .card-fold');
        if (btn) btn.click();
    }
    return el;
}

function wireFolds() {
    const held = foldsHeld();

    document.querySelectorAll('.module').forEach((mod) => {
        mod.querySelectorAll('.card').forEach((card, index) => {
            // `:scope >` matters: the Dashboard's account history panel carries
            // a heading of its own inside a card, and it is not a card.
            const head = card.querySelector(':scope > .card-head');
            if (!head || card.classList.contains('is-bar')) return;

            const key = mod.id + '/' + index;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'card-fold';
            btn.innerHTML = '<i class="bi bi-chevron-up"></i>';

            head.classList.add('has-toggle');
            head.appendChild(btn);

            const paint = () => {
                const folded = card.classList.contains('is-folded');
                btn.setAttribute('aria-expanded', String(!folded));
                btn.title = folded ? 'Open this card' : 'Fold this card away';
            };

            if (held.has(key)) card.classList.add('is-folded');
            paint();

            btn.addEventListener('click', () => {
                const folded = card.classList.toggle('is-folded');

                // Re-read rather than close over the set: two modules are wired
                // in one pass and the panel is not the only thing writing here.
                const now = foldsHeld();
                if (folded) now.add(key); else now.delete(key);
                rememberFolds(now);
                paint();
            });
        });
    });
}

function wireBackup() {
    const exportBtn = $('backupExport');
    if (exportBtn) exportBtn.addEventListener('click', () => backupExport(exportBtn));

    const importBtn = $('backupImport');
    const picker = $('backupFile');

    if (importBtn && picker) {
        importBtn.addEventListener('click', () => picker.click());

        picker.addEventListener('change', () => {
            const file = picker.files && picker.files[0];
            // Clearing the input now means picking the same file twice in a row
            // still fires this handler the second time.
            picker.value = '';
            if (!file) return;

            backupRead(file)
                .then(backupAsk)
                .catch((err) => backupSay('That backup could not be read', err.message));
        });
    }

    const confirmBtn = $('backupConfirm');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const action = dialogAction;
            backupClose();          // closes first, so a failing action can reopen it with its own message
            if (action) action();
        });
    }

    const cancelBtn = $('backupCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', backupClose);

    // The backdrop and Escape both cancel. A dialog dismissable only by one
    // small button is a dialog people click through without reading.
    const box = $('backupDialog');
    if (box) box.addEventListener('click', (event) => { if (event.target === box) backupClose(); });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && box && !box.hidden) backupClose();
    });

    // The save stamp is the only way into the data panel, and it closes the
    // same three ways this one does.
    const stamp = $('saveStamp');
    if (stamp) stamp.addEventListener('click', openData);

    const dataClose = $('dataClose');
    if (dataClose) dataClose.addEventListener('click', closeData);

    const dataBox = $('dataBox');
    if (dataBox) dataBox.addEventListener('click', (event) => { if (event.target === dataBox) closeData(); });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dataBox && !dataBox.hidden) closeData();
    });
}

function setSegment(seg, value) {
    seg.dataset.value = value;
    seg.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.val === value);
    });
}

/**
 * Nothing below may run before the records are in memory, and reading them out
 * of IndexedDB is asynchronous. Where there is no database to wait for — the
 * localStorage fallback, which is what every test in this repo runs on — the
 * store hydrates in this same tick and the app starts exactly as it always
 * did. See store.js.
 */
/**
 * ====================================================================
 * DATE FIELDS — dd-mm-yyyy
 * ====================================================================
 * A native date input writes the date the way the *browser's* locale does:
 * 01/07/2026 here, 7/1/2026 on a machine set to the United States. Two of
 * those readings are a different day, and the app has no say in which one a
 * reader gets — the format is not ours to set.
 *
 * So the box a reader sees is a text field that always says dd-mm-yyyy, and
 * the real date input stays underneath it: invisible, out of the tab order,
 * and asked for nothing but its calendar when the icon is clicked.
 *
 * The date input keeps its id, its classes and its ISO value, so every piece
 * of code that reads or writes a date carries on as it was. Two things keep
 * the pair in step:
 *
 *   the date input's `change`  — the calendar, or the browser autofilling
 *   its `value` setter          — the app, setting a date in code
 *
 * The second is why the property is overridden per element: assigning to
 * `.value` fires no event, and without it every `field.value = todayIso()`
 * in the app would leave the visible box showing yesterday.
 */
const DATE_MASK = 'dd-mm-yyyy';

const isoToDmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '')
    ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4)
    : '');

/**
 * Typed dates, read generously: 1-7-26, 01/07/2026 and 01072026 are all the
 * first of July. A day that does not exist — 31-02 — is not a date, and comes
 * back empty rather than sliding into March.
 */
function dmyToIso(text) {
    const raw   = String(text || '').trim();
    const parts = raw.split(/[^\d]+/).filter(Boolean);
    let day, month, year;

    if (parts.length === 3) {
        [day, month, year] = parts.map(Number);
    } else {
        const digits = raw.replace(/\D/g, '');
        if (digits.length !== 8) return '';
        day   = Number(digits.slice(0, 2));
        month = Number(digits.slice(2, 4));
        year  = Number(digits.slice(4));
    }

    if (!day || !month || !year) return '';
    if (String(year).length <= 2) year += 2000;
    if (month < 1 || month > 12 || year < 1000 || year > 9999) return '';
    // Day 0 of the next month is the last day of this one.
    if (day < 1 || day > new Date(year, month, 0).getDate()) return '';

    return year + '-' + pad2(month) + '-' + pad2(day);
}

/** Dashes as the digits arrive, but only while typing at the end of the box —
 *  inserting them under a caret sitting mid-date would move it. */
function maskDate(input) {
    if (input.selectionStart !== input.value.length) return;

    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    let text = digits.slice(0, 2);
    if (digits.length > 2) text += '-' + digits.slice(2, 4);
    if (digits.length > 4) text += '-' + digits.slice(4);

    // Only ever adds the separators the reader was about to type themselves.
    if (text !== input.value) input.value = text;
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function enhanceDateInput(iso) {
    if (iso.dataset.dmy) return;
    iso.dataset.dmy = '1';

    const wrap = document.createElement('div');
    wrap.className = 'date-field';
    iso.parentNode.insertBefore(wrap, iso);
    wrap.appendChild(iso);

    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'date-text';
    text.inputMode = 'numeric';
    text.autocomplete = 'off';
    text.placeholder = DATE_MASK;
    text.setAttribute('aria-label', (iso.getAttribute('aria-label') || 'Date') + ', ' + DATE_MASK);
    wrap.appendChild(text);

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'date-pick';
    pick.tabIndex = -1;
    pick.setAttribute('aria-label', 'Open the calendar');
    pick.innerHTML = '<i class="bi bi-calendar3"></i>';
    wrap.appendChild(pick);

    // The label still points at the date input by id, and a click on it still
    // means "start typing here" — so the focus is passed along.
    //
    // Except while the calendar is being opened. A phone has no popup to put
    // a date picker in: it opens the picker *by focusing the date input*, the
    // same way any other field opens a keyboard. Passing that focus along to
    // the text box shuts the picker in the tick it appeared and puts a number
    // pad there instead — which is a calendar button that does nothing.
    let openingAt = 0;
    iso.tabIndex = -1;
    iso.addEventListener('focus', () => {
        if (Date.now() - openingAt < 700) return;
        text.focus();
    });

    const show = () => { text.value = isoToDmy(iso.value); };

    Object.defineProperty(iso, 'value', {
        configurable: true,
        get() { return nativeValue.get.call(this); },
        set(next) { nativeValue.set.call(this, next); show(); },
    });

    iso.addEventListener('change', show);
    show();

    /** Hand the app a real change, from the element it is listening to. */
    const commit = () => {
        const wanted = text.value.trim() ? dmyToIso(text.value) : '';

        // Unreadable: not a date, so the field goes back to the one it holds
        // rather than throwing it away on a typo.
        if (text.value.trim() && !wanted) { show(); return; }

        if (wanted === iso.value) { show(); return; }

        iso.value = wanted;
        iso.dispatchEvent(new Event('input',  { bubbles: true }));
        iso.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // The text box's own events stay in the box: half a typed date bubbling
    // up to a list that rebuilds on input would pull the field out from under
    // the caret. What the app hears is the date input, once, when it changes.
    text.addEventListener('input', (event) => { event.stopPropagation(); maskDate(text); });
    text.addEventListener('change', (event) => { event.stopPropagation(); commit(); });
    text.addEventListener('blur', commit);

    // Only a mouse has focus taken off the text box by pressing a button, so
    // only a mouse needs it held. Cancelling the touch equivalent costs the
    // tap the click that follows it in Safari, and then nothing opens at all.
    pick.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') event.preventDefault();
    });

    pick.addEventListener('click', (event) => {
        // Some of these fields sit inside a <label>, and a click anywhere in one
        // activates the control it names — which here is the invisible date
        // input. That is the one thing that must not happen on this button.
        event.preventDefault();
        openingAt = Date.now();

        if (typeof iso.showPicker === 'function') {
            try { iso.showPicker(); return; } catch (err) { /* not allowed here: fall through */ }
        }

        // No `showPicker`, or not allowed from here. Focusing the date input
        // is what opens the picker on a phone, and it is the last thing left
        // to try anywhere else — the text box only ever offers a number pad.
        try { iso.focus({ preventScroll: true }); } catch (err) { iso.focus(); }
        if (document.activeElement !== iso) text.focus();
    });
}

/** Every date box on the page, including any a rebuild has just put there. */
function enhanceDateInputs(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhanceDateInput);
}

document.addEventListener('DOMContentLoaded', () => {
    if (MFStore.initSync(storeReport)) startApp();
    else MFStore.init(storeReport).then(startApp);
});

function startApp() {

    // Before any of it: every date box on the page says dd-mm-yyyy, whatever
    // the browser's own locale would have written.
    enhanceDateInputs();

    // --- bill split: the saved bills first, then a blank form over them ---
    loadSplit();
    paintSplitForm();

    loadNav();
    loadRates();

    // --- categories: everything below names one, so they load first ---
    loadCategories();

    // --- financial planner: the plan first, then the rows it fills ---
    loadBudget();
    buildBudgetRows();
    fillBudgetForm();
    loadGoals();
    buildGoals();

    // --- daily ledger: accounts first, they are what entries point at ---
    buildStaticOptions();
    loadLedger();
    buildLedgerAccounts();
    buildCategoryManager();
    buildAccountOptions();
    syncLedgerForm();

    // --- instalment tracker and card payoff: strictly after the ledger. Both
    //     check their payments' entry links against the entries that actually
    //     exist, and against an empty book every link looks broken. ---
    loadCommit();
    fillCommitForm();
    loadCard();
    fillCardForm();

    // --- savings & investment: last, because it reads the ledger, the goals
    //     and its own contributions together ---
    loadGrow();
    fillGrowForm();
    ledgerClearForm();

    document.querySelectorAll('.seg').forEach((seg) => {
        seg.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-val]');
            if (!btn) return;
            setSegment(seg, btn.dataset.val);
            if (seg.id === 'splitCharges') { applyChargePreset(btn.dataset.val); renderSplit(); }
            if (seg.id === 'splitFilter') { splitState.filter = btn.dataset.val; saveSplit(); paintBills(); }
            if (['splitDiscountUnit', 'splitVoucherUnit', 'splitFeeSplit', 'splitSettleStyle']
                .includes(seg.id)) onSplitFormEdit();
            // The unit lives in each dish row's affix, so the rows are rebuilt.
            if (seg.id === 'splitItemOffUnit') {
                readSplitState();
                buildSplitPeople();
                buildSplitShared();
                commitBill();
                renderSplit();
            }
            if (seg.id === 'budgetRule') renderBudget();
            // Direction decides which category list the picker offers, so the
            // pickers are rebuilt rather than repainted.
            if (seg.id === 'commitDirection') {
                readCommitForm();
                // Money coming back from a loan is not income, so an incoming
                // plan starts with the link off. Only while it is still a
                // draft — flipping a saved plan must not undo its own setting.
                const fresh = commitDraft();
                if (!fresh.id) {
                    fresh.autoRecord = fresh.direction === 'out';
                    if ($('commitAuto')) $('commitAuto').checked = fresh.autoRecord;
                }
                buildCommitOptions();
                renderCommit();
            }
            if (seg.id === 'commitBasis') renderCommit();
            if (seg.id === 'commitFilter') { commitState.filter = btn.dataset.val; saveCommit(); renderCommit(); }
            // Switching the period is switching budgets: whatever is saved for
            // the new one opens, and an unsaved draft for the old one stays put
            // under its own key rather than following the reader across.
            if (seg.id === 'budgetPeriod') { readBudgetState(); loadPeriodIntoForm(); }
            if (seg.id === 'cardTier' && $('cardRate') && btn.dataset.val !== 'custom') {
                $('cardRate').value = btn.dataset.val;
            }
            if (seg.id === 'cardFilter') { cardState.filter = btn.dataset.val; saveCard(); }
            if (seg.id === 'growFilter') { growState.filter = btn.dataset.val; saveGrow(); }
            if (['growPeriod', 'growTargetUnit', 'growCUnit', 'growFilter'].includes(seg.id)) renderGrow();
            if (['cardTier', 'cardView', 'cardStrategy', 'cardFilter'].includes(seg.id)) renderCard();
            if (seg.id === 'ledgerType') { syncLedgerForm(); renderLedger(); }
            if (['dashPeriod', 'dashDim', 'dashDimChart', 'dashTrend', 'dashTrendView', 'dashCmpGrain']
                .includes(seg.id)) renderDash();
        });
    });

    document.querySelectorAll('#split-form input, #split-form select').forEach((el) => {
        el.addEventListener('input', onSplitFormEdit);
        el.addEventListener('change', onSplitFormEdit);
    });

    document.querySelectorAll('#budget-form input').forEach((el) => {
        el.addEventListener('input', renderBudget);
        el.addEventListener('change', renderBudget);
    });

    // The entry form is only read when it is submitted, so typing in it does
    // not repaint the month — but Enter anywhere in it files the entry.
    const ledgerForm = $('ledger-form');
    if (ledgerForm) {
        ledgerForm.addEventListener('keydown', (event) => {
            // Enter files the entry — except inside the notes box, where it is
            // what a new line is made of.
            if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA') return;
            event.preventDefault();
            ledgerSubmit();
        });
    }

    document.querySelectorAll('#card-form input, #card-form select').forEach((el) => {
        const paint = () => { syncCardTier(); renderCard(); };
        el.addEventListener('input', paint);
        el.addEventListener('change', paint);
    });

    // The budget and the strategy live above the form — they belong to the
    // plan across every card, not to whichever card is open.
    ['cardPayment', 'cardPayDate', 'cardPayAmount', 'cardPayNote'].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', renderCard);
        el.addEventListener('change', renderCard);
    });

    const cardSave = $('cardSave');
    if (cardSave) cardSave.addEventListener('click', cardSaveCard);

    const cardNew = $('cardNew');
    if (cardNew) cardNew.addEventListener('click', cardNewCard);

    const cardClose = $('cardClose');
    if (cardClose) cardClose.addEventListener('click', cardToggleClosed);

    // --- savings & investment ---
    document.querySelectorAll('#grow-form input, #grow-form select').forEach((el) => {
        el.addEventListener('input', renderGrow);
        el.addEventListener('change', renderGrow);
    });

    // The target and the contribution row sit outside the form — one belongs
    // to the period, the other to the investment that happens to be open.
    ['growTarget', 'growCDate', 'growCFigure', 'growCBase', 'growCNote',
     'growEDate', 'growEFigure', 'growERate'].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', renderGrow);
        el.addEventListener('change', renderGrow);
    });

    const growSave = $('growSave');
    if (growSave) growSave.addEventListener('click', growSaveInvestment);

    const growNew = $('growNew');
    if (growNew) growNew.addEventListener('click', growNewInvestment);

    const growClose = $('growClose');
    if (growClose) growClose.addEventListener('click', growToggleClosed);

    const growCopy = $('growCopy');
    if (growCopy) growCopy.addEventListener('click', () => copySummary(growCopy, growSummaryText(), 'Copy summary'));

    const growCAdd = $('growCAdd');
    if (growCAdd) growCAdd.addEventListener('click', growAddContribution);

    const growFdApply = $('growFdApply');
    if (growFdApply) growFdApply.addEventListener('click', growApplyFd);

    const growListHost = $('growListBody');
    if (growListHost) {
        growListHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-open-inv], button[data-drop-inv]');
            if (!btn) return;
            if (btn.dataset.openInv) growOpenInvestment(btn.dataset.openInv);
            else growDropInvestment(btn.dataset.dropInv);
        });
    }

    const growCListHost = $('growCList');
    if (growCListHost) {
        growCListHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-drop-contrib]');
            if (!btn) return;
            growDropContribution(btn.closest('.goal-c').dataset.contribution);
        });
    }

    const growTypeSelect = $('growType');
    if (growTypeSelect) growTypeSelect.addEventListener('change', onInvTypePick);

    const growEditTypes = $('growEditTypes');
    if (growEditTypes) growEditTypes.addEventListener('click', () => invTypeEditor());

    const growAddTypeBtn = $('growAddType');
    if (growAddTypeBtn) growAddTypeBtn.addEventListener('click', addInvType);

    const growTypeRows = $('growTypes');
    if (growTypeRows) {
        growTypeRows.addEventListener('click', (event) => {
            const row = event.target.closest('.purpose-row');
            if (!row) return;
            if (event.target.closest('[data-cycle-icon]')) { cycleInvTypeIcon(row); return; }
            if (event.target.closest('[data-drop-inv-type]')) dropInvType(row);
        });
        growTypeRows.addEventListener('change', (event) => {
            const input = event.target.closest('.inv-type-name');
            if (input) renameInvType(input);
        });
        growTypeRows.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.closest('.inv-type-name')) {
                event.preventDefault();
                event.target.blur();
            }
        });
    }

    const growProjApply = $('growProjApply');
    if (growProjApply) growProjApply.addEventListener('click', growApplyProjection);

    const growEAddBtn = $('growEAdd');
    if (growEAddBtn) growEAddBtn.addEventListener('click', growAddEarning);

    const growEListHost = $('growEList');
    if (growEListHost) {
        growEListHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-drop-earning]');
            if (!btn) return;
            growDropEarning(btn.closest('.goal-c').dataset.earning);
        });
    }

    const cardPayAddBtn = $('cardPayAddBtn');
    if (cardPayAddBtn) cardPayAddBtn.addEventListener('click', cardAddPayment);

    const cardListHost = $('cardListBody');
    if (cardListHost) {
        cardListHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-open-card], button[data-drop-card]');
            if (!btn) return;
            if (btn.dataset.openCard) cardOpenCard(btn.dataset.openCard);
            else cardDropCard(btn.dataset.dropCard);
        });
    }

    const cardPayHost = $('cardPayList');
    if (cardPayHost) {
        cardPayHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-drop-payment]');
            if (!btn) return;
            cardDropPayment(btn.closest('.goal-c').dataset.payment);
        });
    }

    // Rows are built on the fly, so their events are delegated to the host.
    ['splitPeople', 'splitShared'].forEach((id) => {
        const host = $(id);
        if (!host) return;
        host.addEventListener('input', onSplitFormEdit);
        host.addEventListener('click', onSplitEdit);
    });

    // Budget rows are built on the fly, so their events are delegated to the
    // host. The name and the bucket act on the shared category list; the money
    // input is read back by `readBudgetState` like every other field.
    const budgetRowsHost = $('budgetRows');
    if (budgetRowsHost) {
        budgetRowsHost.addEventListener('input', (event) => { onBudgetRowInput(event); renderBudget(); });
        budgetRowsHost.addEventListener('change', (event) => { onBudgetRowChange(event); renderBudget(); });
        budgetRowsHost.addEventListener('click', onBudgetRowClick);
    }

    const goalListHost = $('goalList');
    if (goalListHost) {
        goalListHost.addEventListener('input', onGoalInput);
        goalListHost.addEventListener('change', onGoalInput);
        goalListHost.addEventListener('click', onGoalClick);
    }

    const goalAdd = $('goalAdd');
    if (goalAdd) goalAdd.addEventListener('click', addGoal);

    // --- the plan's own controls ---
    const budgetSave = $('budgetSave');
    if (budgetSave) budgetSave.addEventListener('click', saveBudgetPlan);

    const budgetRevert = $('budgetRevert');
    if (budgetRevert) budgetRevert.addEventListener('click', revertBudgetPlan);

    const budgetCopyPrev = $('budgetCopyPrev');
    if (budgetCopyPrev) budgetCopyPrev.addEventListener('click', copyPreviousPlan);

    const budgetPrev = $('budgetPrev');
    if (budgetPrev) budgetPrev.addEventListener('click', () => stepBudgetPeriod(-1));

    const budgetNext = $('budgetNext');
    if (budgetNext) budgetNext.addEventListener('click', () => stepBudgetPeriod(1));

    const budgetPlansHost = $('budgetPlans');
    if (budgetPlansHost) {
        budgetPlansHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-open-plan], button[data-drop-plan]');
            if (!btn) return;
            if (btn.dataset.openPlan) openSavedPlan(btn.dataset.openPlan);
            else dropSavedPlan(btn.dataset.dropPlan);
        });
    }

    const addPerson = $('splitAddPerson');
    if (addPerson) {
        addPerson.addEventListener('click', () => {
            readSplitState();
            draft().people.push(newPerson());
            buildSplitPeople();
            // A new head means a new portion box on every dish that has them.
            buildSplitShared();
            commitBill();
            renderSplit();
        });
    }

    // A payment row is built on the fly like every other row here, so its
    // events are delegated to the card it lives in.
    const paymentsHost = $('splitPayments');
    if (paymentsHost) {
        paymentsHost.addEventListener('input', onSplitFormEdit);
        paymentsHost.addEventListener('change', onSplitFormEdit);
        paymentsHost.addEventListener('click', (event) => {
            const chip = event.target.closest('button[data-line]');
            const btn  = event.target.closest('button[data-remove-pay]');
            if (!chip && !btn) return;

            readSplitState();
            const bill = draft();

            if (chip) {
                const pay = bill.payments.find((one) => one.id === chip.closest('.split-pay-lines').dataset.pay);
                if (!pay) return;
                const id = chip.dataset.line;
                pay.items = pay.items || [];

                if (pay.items.includes(id)) {
                    pay.items = pay.items.filter((one) => one !== id);
                } else {
                    // A line is on one till. Tapping one another payment is
                    // holding moves it rather than doing nothing, which is the
                    // only way to correct a mis-tap without hunting for which
                    // other row has it.
                    bill.payments.forEach((other) => {
                        other.items = (other.items || []).filter((one) => one !== id);
                    });
                    pay.items.push(id);
                }
            } else {
                bill.payments = bill.payments.filter((pay) => pay.id !== btn.closest('.split-pay').dataset.pay);
            }

            buildSplitPayments();
            commitBill();
            renderSplit();
        });
    }

    const addPayment = $('splitAddPayment');
    if (addPayment) {
        addPayment.addEventListener('click', () => {
            readSplitState();
            const bill = draft();
            bill.payments.push(nextPaymentFor(bill));
            buildSplitPayments();
            commitBill();
            renderSplit();
        });
    }

    const multiPay = $('splitMultiPay');
    if (multiPay) {
        multiPay.addEventListener('change', () => {
            readSplitState();
            const bill = draft();
            // Turning it on with an empty list would say "nobody else paid",
            // which is the thing the reader has just said is untrue — so it
            // opens with a line ready for whoever paid the other till.
            if (bill.multiPay && !bill.payments.length) bill.payments.push(nextPaymentFor(bill));
            buildSplitPayments();
            commitBill();
            renderSplit();
        });
    }

    const addShared = $('splitAddShared');
    if (addShared) {
        addShared.addEventListener('click', () => {
            readSplitState();
            draft().shared.push(newItem());
            buildSplitShared();
            commitBill();
            renderSplit();
        });
    }

    // The per-dish column changes the shape of every item row, so the rows
    // are rebuilt rather than repainted.
    const itemOff = $('splitItemOff');
    if (itemOff) {
        itemOff.addEventListener('change', () => {
            readSplitState();
            buildSplitPeople();
            buildSplitShared();
            commitBill();
            renderSplit();
        });
    }

    // --- instalment tracker ---
    document.querySelectorAll('#commit-form input, #commit-form select').forEach((el) => {
        el.addEventListener('input', renderCommit);
        el.addEventListener('change', renderCommit);
    });

    const commitSave = $('commitSave');
    if (commitSave) commitSave.addEventListener('click', commitSavePlan);

    const commitNew = $('commitNew');
    if (commitNew) commitNew.addEventListener('click', commitNewPlan);

    const commitCancel = $('commitCancelPlan');
    if (commitCancel) commitCancel.addEventListener('click', commitCancelPlan);

    const commitCopy = $('commitCopy');
    if (commitCopy) commitCopy.addEventListener('click', () => copySummary(commitCopy, commitSummaryText(), 'Copy summary'));

    // The schedule is rebuilt on every paint, so its events are delegated.
    const commitMonths = $('commitMonthsList');
    if (commitMonths) {
        commitMonths.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-tick]');
            if (btn) commitTogglePayment(Number(btn.dataset.tick));
        });
        // `change`, not `input`: repainting mid-keystroke would take the caret.
        commitMonths.addEventListener('change', (event) => {
            const field = event.target.closest('.commit-amount');
            if (!field) return;
            commitSetAmount(Number(field.dataset.n), field.value);
            renderCommit();
        });
    }

    const commitPlansHost = $('commitPlans');
    if (commitPlansHost) {
        commitPlansHost.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-open-plan], button[data-drop-plan]');
            if (!btn) return;
            if (btn.dataset.openPlan) commitOpenPlan(btn.dataset.openPlan);
            else commitDropPlan(btn.dataset.dropPlan);
        });
    }

    const splitExpMode = $('splitExpMode');
    if (splitExpMode) {
        splitExpMode.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-val]');
            if (!btn) return;
            setSegment(splitExpMode, btn.dataset.val);
            renderSplit();
        });
    }

    const splitSave = $('splitSave');
    if (splitSave) splitSave.addEventListener('click', splitSaveBill);

    const splitCancel = $('splitCancel');
    if (splitCancel) splitCancel.addEventListener('click', splitNewBill);

    const settleList = $('splitSettleList');
    if (settleList) settleList.addEventListener('click', onSettleClick);

    const expense = $('splitExpense');
    if (expense) {
        expense.addEventListener('click', (event) => {
            if (event.target.closest('#splitExpAdd'))  splitRecordShare();
            if (event.target.closest('#splitExpUndo')) splitRemoveShare();
        });
    }

    const bills = $('splitBills');
    if (bills) {
        bills.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-open-bill], button[data-copy-bill], button[data-drop-bill]');
            if (!btn) return;
            if (btn.dataset.openBill) splitOpenBill(btn.dataset.openBill);
            else if (btn.dataset.copyBill) splitCopyBill(btn.dataset.copyBill);
            else splitDropBill(btn.dataset.dropBill);
        });
    }

    const addCat = $('budgetAddCat');
    if (addCat) addCat.addEventListener('click', addBudgetCategory);

    const splitCopy = $('splitCopy');
    if (splitCopy) splitCopy.addEventListener('click', () => copySummary(splitCopy, splitSummaryText(), 'Copy summary'));

    const budgetCopy = $('budgetCopy');
    if (budgetCopy) budgetCopy.addEventListener('click', () => copySummary(budgetCopy, budgetSummaryText(), 'Copy summary'));

    const ledgerList = $('ledgerList');
    if (ledgerList) ledgerList.addEventListener('click', onLedgerListClick);

    const ledgerCategories = $('ledgerCategories');
    const categoryList = $('categoryList');
    if (categoryList) {
        // Typing a name repaints what reads the list, never the rows — a
        // rebuild here would take the caret with it.
        categoryList.addEventListener('input', () => {
            readCategoryRows();
            saveCategories();
            buildCategoryOptions();
            buildAccountOptions();
            buildLedgerAccounts();
            renderLedger();
            renderBudget();
        });
        categoryList.addEventListener('change', (event) => {
            if (event.target.closest('.cat-bucket')) { readCategoryRows(); afterCategoryChange(true); }
        });
        categoryList.addEventListener('click', onCategoryClick);
    }

    const addCategoryCard = $('categoryAdd');
    if (addCategoryCard) addCategoryCard.addEventListener('click', addCategory);

    const ledgerAccounts = $('ledgerAccounts');
    if (ledgerAccounts) {
        // Ahead of the rebuild: the editor option is put back to the account's
        // own purpose before anything reads the row.
        ledgerAccounts.addEventListener('change', onAccountTypePick);
        ledgerAccounts.addEventListener('change', onAccountPurposePick);
        ledgerAccounts.addEventListener('input', renderLedger);
        ledgerAccounts.addEventListener('change', renderLedger);
        ledgerAccounts.addEventListener('click', onLedgerAccountsClick);
    }

    [['ledgerPrev', -1], ['ledgerNext', 1]].forEach(([id, delta]) => {
        const btn = $(id);
        if (btn) btn.addEventListener('click', () => {
            ledgerState.month = shiftMonthKey(ledgerState.month, delta);
            renderLedger();
        });
    });

    // Editing accounts is the rare visit; reading their balances is every
    // visit. Adding one opens the editor if it was closed, because the row it
    // creates is blank and lives in there.
    const editAccounts = $('ledgerEditAccounts');
    const accountEditor = (open) => {
        const panel = $('ledgerAccountEdit');
        if (!panel) return;
        const show = open === undefined ? panel.hidden : open;
        panel.hidden = !show;
        if (editAccounts) {
            editAccounts.setAttribute('aria-expanded', String(show));
            editAccounts.innerHTML = show
                ? '<i class="bi bi-check-lg"></i> Done'
                : '<i class="bi bi-pencil"></i> Edit';
        }
    };
    if (editAccounts) editAccounts.addEventListener('click', () => accountEditor());

    const addAccount = $('ledgerAddAccount');
    if (addAccount) {
        addAccount.addEventListener('click', () => {
            accountEditor(true);
            readLedgerAccounts();
            ledgerState.accounts.push({
                id: ledgerId('a'), name: '', type: defaultTypeId(), purpose: '',
                currency: BASE_CURRENCY, opening: '', status: 'active',
            });
            buildLedgerAccounts();
            renderLedger();
            const last = document.querySelector('#ledgerAccounts .bgt-row:last-child .bgt-label');
            if (last) last.focus();
        });
    }

    const editTypes = $('ledgerEditTypes');
    if (editTypes) editTypes.addEventListener('click', () => typeEditor());

    const addTypeBtn = $('ledgerAddType');
    if (addTypeBtn) addTypeBtn.addEventListener('click', addType);

    const typeRows = $('ledgerTypes');
    if (typeRows) {
        typeRows.addEventListener('click', (event) => {
            const drop = event.target.closest('[data-drop-type]');
            if (drop) dropType(drop.closest('.purpose-row'));
        });
        typeRows.addEventListener('change', (event) => {
            const input = event.target.closest('.type-name');
            if (input) renameType(input);
        });
        typeRows.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.closest('.type-name')) {
                event.preventDefault();
                event.target.blur();
            }
        });
    }

    const editPurposes = $('ledgerEditPurposes');
    if (editPurposes) editPurposes.addEventListener('click', () => purposeEditor());

    const addPurposeBtn = $('ledgerAddPurpose');
    if (addPurposeBtn) addPurposeBtn.addEventListener('click', addPurpose);

    const purposeRows = $('ledgerPurposes');
    if (purposeRows) {
        purposeRows.addEventListener('click', (event) => {
            const drop = event.target.closest('[data-drop-purpose]');
            if (drop) dropPurpose(drop.closest('.purpose-row'));
        });
        // On change rather than on input: renaming rewrites every account
        // holding the word, which is not a thing to do per keystroke.
        purposeRows.addEventListener('change', (event) => {
            const input = event.target.closest('.purpose-name');
            if (input) renamePurpose(input);
        });
        purposeRows.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.closest('.purpose-name')) {
                event.preventDefault();
                event.target.blur();
            }
        });
    }

    const categoryPicker = $('ledgerCategory');
    if (categoryPicker) categoryPicker.addEventListener('change', buildSubOptions);

    // Changing the amount reconverts; typing in the ringgit box says the
    // reader has the real figure, and the conversion stops arguing with them.
    const amountBox = $('ledgerAmount');
    if (amountBox) amountBox.addEventListener('input', convertLedgerAmount);

    const baseBox = $('ledgerBase');
    if (baseBox) {
        baseBox.addEventListener('input', () => {
            if (baseBox.value.trim()) baseBox.dataset.touched = '1';
            else delete baseBox.dataset.touched;
            paintRateState();
        });
    }

    const currencyBtn = $('ledgerCurrencyBtn');
    if (currencyBtn) {
        currencyBtn.addEventListener('click', () => openCurrencyPop($('ledgerCurrencyPop').hidden));
    }

    const currencySearch = $('ledgerCurrencySearch');
    if (currencySearch) {
        currencySearch.addEventListener('input', () => filterCurrencyList(currencySearch.value));
        currencySearch.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') { openCurrencyPop(false); currencyBtn.focus(); return; }
            if (event.key !== 'Enter') return;
            // Enter takes the first row still showing, which is what the
            // search was narrowing towards.
            event.preventDefault();
            event.stopPropagation();
            const first = document.querySelector('#ledgerCurrencyList .combo-row:not([hidden])');
            if (first) { setLedgerCurrency(first.dataset.code); openCurrencyPop(false); currencyBtn.focus(); }
        });
    }

    const currencyList = $('ledgerCurrencyList');
    if (currencyList) {
        currencyList.addEventListener('click', (event) => {
            const row = event.target.closest('.combo-row');
            if (!row) return;
            setLedgerCurrency(row.dataset.code);
            openCurrencyPop(false);
            currencyBtn.focus();
        });
    }

    // Anywhere else on the page closes it, the way a menu should.
    document.addEventListener('click', (event) => {
        if (!event.target.closest('#ledgerCurrencyCombo')) openCurrencyPop(false);
    });

    // The side switch is a view of the same list, not a filter on the data.
    const categorySide = $('categorySide');
    if (categorySide) categorySide.addEventListener('click', () => buildCategoryManager());

    const ledgerAdd = $('ledgerSubmit');
    if (ledgerAdd) ledgerAdd.addEventListener('click', ledgerSubmit);

    const ledgerCancel = $('ledgerCancel');
    if (ledgerCancel) ledgerCancel.addEventListener('click', () => { ledgerClearForm(); syncLedgerForm(); });

    const ledgerCopy = $('ledgerCopy');
    if (ledgerCopy) ledgerCopy.addEventListener('click', () => copySummary(ledgerCopy, ledgerSummaryText(), 'Copy summary'));

    const cardCopy = $('cardCopy');
    if (cardCopy) cardCopy.addEventListener('click', () => copySummary(cardCopy, cardSummaryText(), 'Copy summary'));

    document.querySelectorAll('[data-reset]').forEach((btn) => {
        btn.addEventListener('click', () => resetForm(btn.dataset.reset));
    });

    // The dashboard reads; its controls only ever change what is being asked.
    ['dashFrom', 'dashTo'].forEach((id) => {
        const el = $(id);
        if (el) el.addEventListener('change', renderDash);
    });

    ['dashCmpA', 'dashCmpB'].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('change', () => {
            dashState[id === 'dashCmpA' ? 'cmpA' : 'cmpB'] = el.value;
            renderDash();
        });
    });

    const dashAccounts = $('dashAccounts');
    if (dashAccounts) {
        dashAccounts.addEventListener('click', (event) => {
            const row = event.target.closest('button[data-account]');
            if (!row) return;
            // Clicking the account already open closes it, so the same row is
            // both the way in and the way out.
            dashState.account = dashState.account === row.dataset.account ? null : row.dataset.account;
            renderDash();
        });
    }

    const dashHistoryClose = $('dashHistoryClose');
    if (dashHistoryClose) dashHistoryClose.addEventListener('click', () => {
        dashState.account = null;
        renderDash();
    });

    const dashCopy = $('dashCopy');
    if (dashCopy) dashCopy.addEventListener('click', () => copySummary(dashCopy, dashSummaryText(), 'Copy summary'));

    const navToggle = $('navToggle');
    if (navToggle) navToggle.addEventListener('click', toggleNav);

    const navScrim = $('navScrim');
    if (navScrim) navScrim.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeDrawer();
    });

    // A drawer left open across a resize would sit over a page with room for
    // the column it was standing in for.
    window.addEventListener('resize', () => {
        if (!navIsDrawer()) closeDrawer(); else paintNav();
    });

    const tabs = $('tabs');
    if (tabs) {
        tabs.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-module]');
            if (!btn) return;
            showModule(btn.dataset.module);
            closeDrawer();
        });
    }

    wireBackup();

    // A chevron on every card heading, and whichever ones were folded away last
    // time folded again. Before the modules paint, so nothing flashes open.
    wireFolds();

    // What the last session left behind, before anything in this one writes.
    paintSaveStamp();

    // Says nothing at all until a write fails or the store fills up.
    const storeAlertExport = $('storeAlertExport');
    if (storeAlertExport) storeAlertExport.addEventListener('click', () => backupExport(storeAlertExport));
    paintStoreAlert();

    renderLedger();
    renderSplit();
    renderBudget();
    renderCommit();
    renderCard();
    renderGrow();

    // Last, because it reads what every other module has just put on screen.
    renderDash();

    // Ask the browser how much room it is actually offering, then repaint the
    // usage line with the real ceiling rather than the five-megabyte guess.
    if (MFStore.measure) MFStore.measure().then(paintStoreAlert);

    // And ask it not to throw the records away when the disk gets tight —
    // but only once there are records, since Firefox turns this into a
    // permission prompt and a prompt about an empty book is a prompt about
    // nothing.
    if (MFStore.persist && !storeIsEmpty()) MFStore.persist();

    // The records are in memory now. Anything that needs to ask about them —
    // the Drive layer's "this browser is empty" offer — waits for this, because
    // before it the store is legitimately empty and the answer would be a lie.
    window.MFReady = true;
    document.dispatchEvent(new Event('moneyflow:ready'));
}
