/**
 * ====================================================================
 * MoneyFlow — Understand Your Money. Manage Your Future.
 * --------------------------------------------------------------------
 * Four modules share one page, one stylesheet and one set of helpers:
 *
 *   Expenses        — the daily ledger the whole app is really for
 *   Bill Split      — a Malaysian restaurant bill, split by what you ate
 *   Budget Planner  — where a month's income actually goes
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
function storedRaw(key) {
    try {
        return localStorage.getItem(key)
            || localStorage.getItem(key.replace('moneyflow.', 'moneysplitor.'));
    } catch (err) {
        return null;
    }
}

const CHARGE_PRESETS = {
    none: { service: 0,  tax: 0 },
    tax:  { service: 0,  tax: 6 },
    svc:  { service: 10, tax: 0 },
    both: { service: 10, tax: 6 },
};

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
 * BILL SPLIT SIMULATION
 * ====================================================================
 * The people and their items are the only part of the module with a shape the
 * user controls, so they live in `splitState`. Values are still read back out
 * of the inputs on every keystroke — rebuilding the rows mid-typing would
 * throw away the caret, so the DOM is only rebuilt when a row is added or
 * removed.
 */
const newItem   = () => ({ id: nextId('i'), label: '', amount: '' });
const newPerson = () => ({ id: nextId('p'), name: '', items: [newItem()] });

let splitState = { people: [newPerson(), newPerson()], shared: [] };

const personName = (person, index) => person.name.trim() || 'Person ' + (index + 1);

function readItemRow(line, item) {
    if (!item) return;
    item.label  = line.querySelector('.split-item-label').value;
    item.amount = line.querySelector('.split-item-amount').value;
}

function readSplitState() {
    document.querySelectorAll('#splitPeople .split-person').forEach((card) => {
        const person = splitState.people.find((p) => p.id === card.dataset.person);
        if (!person) return;
        person.name = card.querySelector('.split-name').value;
        card.querySelectorAll('.split-item').forEach((line) => {
            readItemRow(line, person.items.find((item) => item.id === line.dataset.item));
        });
    });

    document.querySelectorAll('#splitShared .split-item').forEach((line) => {
        readItemRow(line, splitState.shared.find((item) => item.id === line.dataset.item));
    });
}

function splitItemRow(item, placeholder) {
    const line = document.createElement('div');
    line.className = 'split-item';
    line.dataset.item = item.id;
    line.innerHTML =
        '<input type="text" class="split-item-label">' +
        '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
        '<input type="number" class="split-item-amount" min="0" step="0.10" placeholder="0.00" inputmode="decimal"></div>' +
        '<button type="button" class="split-x" data-remove-item aria-label="Remove item">' +
        '<i class="bi bi-x-lg"></i></button>';

    // Assigned rather than interpolated — these are user-typed strings.
    const label = line.querySelector('.split-item-label');
    label.value = item.label;
    label.placeholder = placeholder;
    line.querySelector('.split-item-amount').value = item.amount;
    return line;
}

function buildSplitPeople() {
    const host = $('splitPeople');
    if (!host) return;
    host.innerHTML = '';

    splitState.people.forEach((person, index) => {
        const card = document.createElement('div');
        card.className = 'split-person';
        card.dataset.person = person.id;
        card.innerHTML =
            '<div class="split-person-head">' +
            '<input type="text" class="split-name">' +
            '<span class="split-person-sum" id="sum_' + person.id + '">RM 0.00</span>' +
            (splitState.people.length > 1
                ? '<button type="button" class="split-x" data-remove-person aria-label="Remove person">' +
                  '<i class="bi bi-x-lg"></i></button>'
                : '') +
            '</div>' +
            '<div class="split-items"></div>' +
            '<button type="button" class="split-add" data-add-item><i class="bi bi-plus-lg"></i> Add item</button>';

        const nameField = card.querySelector('.split-name');
        nameField.value = person.name;
        nameField.placeholder = 'Person ' + (index + 1);

        const items = card.querySelector('.split-items');
        person.items.forEach((item) => items.appendChild(splitItemRow(item, 'What they ate')));

        host.appendChild(card);
    });
}

function buildSplitShared() {
    const host = $('splitShared');
    if (!host) return;
    host.innerHTML = '';

    if (!splitState.shared.length) {
        host.innerHTML = '<p class="split-empty">Nothing shared yet &mdash; rice, a plate of fries, ' +
            'drinks for the table: anything everyone chips in for.</p>';
        return;
    }

    const items = document.createElement('div');
    items.className = 'split-items';
    splitState.shared.forEach((item) => items.appendChild(splitItemRow(item, 'Shared dish')));
    host.appendChild(items);
}

/** Runs the whole bill: what each person ordered, the charges, and who owes what. */
function splitCompute() {
    const serviceRate = Math.max(0, num('splitService'));
    const taxRate     = Math.max(0, num('splitTax'));
    const roundCash   = !!($('splitRound') || {}).checked;

    const itemSen = (item) => Math.max(0, toSen(parseFloat(item.amount) || 0));
    const ownSen  = splitState.people.map((p) => p.items.reduce((sum, item) => sum + itemSen(item), 0));

    const sharedSen   = splitState.shared.reduce((sum, item) => sum + itemSen(item), 0);
    const sharedParts = allocateSen(sharedSen, splitState.people.map(() => 1));
    const ateSen      = ownSen.map((own, i) => own + (sharedParts[i] || 0));

    // Shared items count towards the bill even before anyone is listed to carry them.
    const foodSen     = ownSen.reduce((sum, v) => sum + v, 0) + sharedSen;
    const discountSen = Math.min(Math.max(0, toSen(num('splitDiscount'))), foodSen);
    const netSen      = foodSen - discountSen;
    const serviceSen  = Math.round(netSen * serviceRate / 100);
    const taxSen      = Math.round((netSen + serviceSen) * taxRate / 100);

    let grandSen = netSen + serviceSen + taxSen;
    if (roundCash) grandSen = Math.round(grandSen / 5) * 5;

    return {
        ownSen, sharedSen, ateSen, foodSen, discountSen, serviceSen, taxSen, grandSen,
        serviceRate, taxRate,
        // Each head pays in proportion to what they ate, charges and all.
        paysSen: allocateSen(grandSen, ateSen),
    };
}

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

function paintSplit(bill) {
    const pax = splitState.people.length;

    set('splitTotal', money(fromSen(bill.grandSen)));
    set('splitPaxFoot', pax
        ? pax + (pax === 1 ? ' person' : ' people') + ' · ' +
          money(fromSen(Math.round(bill.grandSen / pax))) + ' each if split evenly'
        : 'Add someone to split with');

    set('splitFood', money(fromSen(bill.foodSen)));
    set('splitFoodFoot', bill.sharedSen > 0
        ? money(fromSen(bill.sharedSen)) + ' of that is shared'
        : 'Before any charges');

    const chargesSen = bill.serviceSen + bill.taxSen;
    set('splitChargeAdded', chargesSen ? '+ ' + money(fromSen(chargesSen)) : money(0));
    const rates = [
        bill.serviceRate ? 'service ' + pct(bill.serviceRate, 0) : '',
        bill.taxRate ? 'SST ' + pct(bill.taxRate, 0) : '',
    ].filter(Boolean);
    set('splitChargeFoot', rates.length
        ? rates.join(' + ') + ' · ' + pct(bill.foodSen ? chargesSen / bill.foodSen * 100 : 0) + ' of the food'
        : 'No service charge or SST');

    // --- side panel tally ---
    set('splitTallyFood', money(fromSen(bill.foodSen)));
    set('splitTallyDiscount', '− ' + money(fromSen(bill.discountSen)));
    set('splitTallyService', money(fromSen(bill.serviceSen)));
    set('splitTallyTax', money(fromSen(bill.taxSen)));
    set('splitTallyTotal', money(fromSen(bill.grandSen)));
    set('splitTallyServiceLabel', 'Service charge ' + pct(bill.serviceRate, 0));
    set('splitTallyTaxLabel', 'SST ' + pct(bill.taxRate, 0));

    const showRow = (id, show) => { const row = $(id); if (row) row.hidden = !show; };
    showRow('splitRowDiscount', bill.discountSen > 0);
    showRow('splitRowService', bill.serviceRate > 0);
    showRow('splitRowTax', bill.taxRate > 0);

    // --- per-person running totals ---
    splitState.people.forEach((person, index) => {
        set('sum_' + person.id, money(fromSen(bill.ateSen[index])));
    });
    set('splitOwnTotal', money(fromSen(bill.foodSen - bill.sharedSen)));
    set('splitSharedTotal', money(fromSen(bill.sharedSen)));
    set('splitEvenNote', bill.foodSen > 0 && splitState.people.length > 1
        ? 'Sorted by what each person owes'
        : '');

    // --- the answer table ---
    const body = $('splitBody');
    if (!body) return;
    body.innerHTML = '';

    if (bill.foodSen <= 0) {
        body.appendChild(emptyRow('Put in what everyone ate and the split works itself out.', 4));
        return;
    }

    splitState.people.forEach((person, index) => {
        const ate    = bill.ateSen[index];
        const pays   = bill.paysSen[index];
        const charge = pays - ate;
        const ordered = person.items.filter((item) => (parseFloat(item.amount) || 0) > 0).length;

        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong>' + escapeHtml(personName(person, index)) + '</strong>' +
            '<small>' + (ordered ? ordered + (ordered === 1 ? ' item' : ' items') : 'Nothing ordered') +
            (bill.sharedSen > 0 ? ' + a share of the table' : '') + '</small>'
        ));
        tr.appendChild(cell(fmt(fromSen(ate))));
        tr.appendChild(cell(
            (charge < 0 ? '− ' : charge > 0 ? '+ ' : '') + fmt(Math.abs(fromSen(charge))),
            charge < 0 ? 'is-minus' : 'is-muted'
        ));
        tr.appendChild(cell(fmt(fromSen(pays)), 'is-strong'));
        body.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Bill total'));
    totalRow.appendChild(cell(fmt(fromSen(bill.foodSen))));
    totalRow.appendChild(cell(fmt(fromSen(bill.grandSen - bill.foodSen))));
    totalRow.appendChild(cell(fmt(fromSen(bill.grandSen))));
    body.appendChild(totalRow);
}

function renderSplit() {
    readSplitState();
    syncChargePreset();
    paintSplit(splitCompute());
}

/** Plain-text recap, sized to paste straight into the group chat. */
function splitSummaryText() {
    const bill = splitCompute();
    const lines = ['Bill split — ' + money(fromSen(bill.grandSen)) + ' total'];

    splitState.people.forEach((person, index) => {
        lines.push(personName(person, index) + ': ' + money(fromSen(bill.paysSen[index])));
    });

    const parts = ['food ' + money(fromSen(bill.foodSen))];
    if (bill.discountSen) parts.push('less ' + money(fromSen(bill.discountSen)) + ' discount');
    if (bill.serviceSen)  parts.push('service ' + pct(bill.serviceRate, 0) + ' ' + money(fromSen(bill.serviceSen)));
    if (bill.taxSen)      parts.push('SST ' + pct(bill.taxRate, 0) + ' ' + money(fromSen(bill.taxSen)));
    lines.push('(' + parts.join(', ') + ')');

    return lines.join('\n');
}

/** Structural edits: read what is on screen first so nothing typed is lost. */
function onSplitEdit(event) {
    const btn = event.target.closest('button');
    if (!btn) return;

    readSplitState();
    const card = btn.closest('.split-person');
    const person = card && splitState.people.find((p) => p.id === card.dataset.person);

    if (btn.hasAttribute('data-add-item') && person) {
        person.items.push(newItem());
    } else if (btn.hasAttribute('data-remove-item')) {
        const itemId = btn.closest('.split-item').dataset.item;
        if (person) {
            person.items = person.items.filter((item) => item.id !== itemId);
            if (!person.items.length) person.items.push(newItem());
        } else {
            splitState.shared = splitState.shared.filter((item) => item.id !== itemId);
        }
    } else if (btn.hasAttribute('data-remove-person') && person) {
        splitState.people = splitState.people.filter((p) => p.id !== person.id);
    } else {
        return;
    }

    buildSplitPeople();
    buildSplitShared();
    renderSplit();
}

/**
 * ====================================================================
 * BUDGET PLANNER
 * ====================================================================
 * The eight categories below are fixed, so their inputs are built once and
 * read straight off the DOM — no rebuild while typing, no lost caret. Only the
 * user's own extra categories live in `budgetState`.
 *
 * Every category belongs to one of three buckets, which is what makes the
 * 50/30/20 comparison possible:
 *
 *   needs — the month happens whether you like it or not
 *   wants — the part you could cut this month if you had to
 *   save  — money that is still yours afterwards, or debt being cleared
 *
 * Debt sits in `save` rather than `needs` on purpose: paying down a card is
 * building net worth the same way a deposit does, and 50/30/20 treats it that
 * way too.
 */
const BUDGET_CATEGORIES = [
    { id: 'housing',       label: 'Housing',       bucket: 'needs', icon: 'bi-house-door',  hint: 'Rent, mortgage, maintenance fee' },
    { id: 'food',          label: 'Food',          bucket: 'needs', icon: 'bi-basket',      hint: 'Groceries, kopitiam, food delivery' },
    { id: 'transport',     label: 'Transport',     bucket: 'needs', icon: 'bi-car-front',   hint: 'Petrol, tolls, parking, Grab, car loan' },
    { id: 'bills',         label: 'Bills',         bucket: 'needs', icon: 'bi-receipt',     hint: 'TNB, water, Unifi, phone, subscriptions' },
    { id: 'insurance',     label: 'Insurance',     bucket: 'needs', icon: 'bi-shield-check',hint: 'Medical, life, motor, takaful' },
    { id: 'entertainment', label: 'Entertainment', bucket: 'wants', icon: 'bi-controller',  hint: 'Outings, hobbies, shopping, travel fund' },
    { id: 'savings',       label: 'Savings',       bucket: 'save',  icon: 'bi-piggy-bank',  hint: 'ASB, unit trust, emergency fund, gold' },
    { id: 'debt',          label: 'Debt',          bucket: 'save',  icon: 'bi-credit-card', hint: 'Credit card, PTPTN, personal loan' },
];

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

let budgetState = { custom: [] };

const newCategory = () => ({ id: nextId('c'), label: '', amount: '', bucket: 'wants' });

const budgetRule = () => BUDGET_RULES[(($('budgetRule') || {}).dataset || {}).value] || null;

/** Custom rows are user-shaped, so they are read back before any structural edit. */
function readBudgetState() {
    document.querySelectorAll('#budgetCustom .bgt-row').forEach((row) => {
        const cat = budgetState.custom.find((c) => c.id === row.dataset.cat);
        if (!cat) return;
        cat.label  = row.querySelector('.bgt-label').value;
        cat.amount = row.querySelector('.bgt-amount').value;
        cat.bucket = row.querySelector('.bgt-bucket').value;
    });
}

function buildBudgetRows() {
    const host = $('budgetRows');
    if (!host) return;
    host.innerHTML = '';

    BUDGET_CATEGORIES.forEach((cat) => {
        const row = document.createElement('div');
        row.className = 'bgt-row';
        row.dataset.cat = cat.id;
        row.dataset.bucket = cat.bucket;
        row.innerHTML =
            '<span class="bgt-icon"><i class="bi ' + cat.icon + '"></i></span>' +
            '<div class="bgt-meta">' +
                '<label for="bgt_' + cat.id + '">' + cat.label + '</label>' +
                '<small>' + cat.hint + '</small>' +
                '<div class="bgt-bar"><i id="bar_' + cat.id + '" style="width:0%"></i></div>' +
            '</div>' +
            '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                '<input type="number" class="bgt-amount" id="bgt_' + cat.id + '" ' +
                'min="0" step="10" placeholder="0" inputmode="decimal"></div>' +
            '<span class="bgt-pct" id="pct_' + cat.id + '">—</span>';
        host.appendChild(row);
    });
}

function buildBudgetCustom() {
    const host = $('budgetCustom');
    if (!host) return;
    host.innerHTML = '';

    budgetState.custom.forEach((cat) => {
        const row = document.createElement('div');
        row.className = 'bgt-row is-custom';
        row.dataset.cat = cat.id;
        row.dataset.bucket = cat.bucket;
        row.innerHTML =
            '<span class="bgt-icon"><i class="bi bi-tag"></i></span>' +
            '<div class="bgt-meta"><input type="text" class="bgt-label"></div>' +
            '<select class="bgt-bucket" aria-label="Bucket">' +
                Object.entries(BUDGET_BUCKETS).map(([key, b]) =>
                    '<option value="' + key + '">' + b.label + '</option>').join('') +
            '</select>' +
            '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                '<input type="number" class="bgt-amount" min="0" step="10" placeholder="0" inputmode="decimal"></div>' +
            '<button type="button" class="split-x" data-remove-cat aria-label="Remove category">' +
                '<i class="bi bi-x-lg"></i></button>';

        // Assigned rather than interpolated — these are user-typed strings.
        const label = row.querySelector('.bgt-label');
        label.value = cat.label;
        label.placeholder = 'Your own category';
        row.querySelector('.bgt-amount').value = cat.amount;
        row.querySelector('.bgt-bucket').value = cat.bucket;

        host.appendChild(row);
    });
}

/** The eight fixed categories plus whatever the user added, in one flat list. */
function budgetRowValues() {
    const rows = BUDGET_CATEGORIES.map((cat) => ({
        id: cat.id,
        label: cat.label,
        bucket: cat.bucket,
        sen: Math.max(0, toSen(num('bgt_' + cat.id))),
    }));

    budgetState.custom.forEach((cat) => rows.push({
        id: cat.id,
        label: cat.label.trim() || 'Other',
        bucket: BUDGET_BUCKETS[cat.bucket] ? cat.bucket : 'wants',
        sen: Math.max(0, toSen(parseFloat(cat.amount) || 0)),
        custom: true,
    }));

    return rows;
}

function budgetCompute() {
    const incomeSen = Math.max(0, toSen(num('budgetIncome'))) + Math.max(0, toSen(num('budgetExtra')));
    const rows = budgetRowValues();

    const bucketSen = { needs: 0, wants: 0, save: 0 };
    rows.forEach((row) => { bucketSen[row.bucket] += row.sen; });

    const plannedSen = bucketSen.needs + bucketSen.wants + bucketSen.save;
    const spendSen   = bucketSen.needs + bucketSen.wants;   // money that is gone once spent
    const leftSen    = incomeSen - plannedSen;

    const share = (sen) => (incomeSen > 0 ? sen / incomeSen * 100 : 0);

    return {
        incomeSen, rows, bucketSen, plannedSen, spendSen, leftSen,
        rule: budgetRule(),
        spendPct: share(spendSen),
        saveRate: share(bucketSen.save),
        leftPct:  share(leftSen),
        share,
    };
}

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
        legend.innerHTML = '<span class="legend-empty">Put in your income and what the month costs — ' +
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

    if (plan.leftSen < 0) {
        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML = '<i class="dot dot-red"></i><span>Over by ' +
            '<b class="is-minus">' + money(fromSen(-plan.leftSen)) + '</b></span>';
        legend.appendChild(item);
    }
}

/** Target vs planned, one row per bucket. Overshooting savings is a good miss,
 *  so only needs and wants are marked red when they run over. */
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

    const used = plan.rows.filter((row) => row.sen > 0).sort((a, b) => b.sen - a.sen);

    set('budgetTableNote', used.length
        ? used.length + (used.length === 1 ? ' category in play' : ' categories in play') +
          ' · biggest is ' + used[0].label
        : '');

    if (!used.length) {
        body.appendChild(emptyRow('Fill in a category or two — the breakdown builds as you go.', 4));
        return;
    }

    used.forEach((row) => {
        const bucket = BUDGET_BUCKETS[row.bucket];
        const tr = document.createElement('tr');
        tr.appendChild(cell(
            '<strong>' + escapeHtml(row.label) + '</strong>' +
            '<small>' + pct(row.sen / plan.plannedSen * 100) + ' of everything planned</small>'
        ));
        tr.appendChild(cell('<i class="dot dot-' + bucket.tone + '"></i>' + bucket.label, 'is-muted'));
        tr.appendChild(cell(fmt(fromSen(row.sen)), 'is-strong'));
        tr.appendChild(cell(plan.incomeSen ? pct(plan.share(row.sen)) : '—', 'is-muted'));
        body.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Planned'));
    totalRow.appendChild(cell(''));
    totalRow.appendChild(cell(fmt(fromSen(plan.plannedSen))));
    totalRow.appendChild(cell(plan.incomeSen ? pct(plan.share(plan.plannedSen)) : '—'));
    body.appendChild(totalRow);

    const leftRow = document.createElement('tr');
    leftRow.className = 'total-row is-quiet';
    leftRow.appendChild(cell(plan.leftSen < 0 ? 'Over budget' : 'Left over'));
    leftRow.appendChild(cell(''));
    leftRow.appendChild(cell(fmt(Math.abs(fromSen(plan.leftSen))), plan.leftSen < 0 ? 'is-minus' : 'is-plus'));
    leftRow.appendChild(cell(plan.incomeSen ? pct(Math.abs(plan.leftPct)) : '—'));
    body.appendChild(leftRow);
}

function paintBudget(plan) {
    // --- stat tiles ---
    set('budgetLeft', (plan.leftSen < 0 ? '− ' : '') + money(Math.abs(fromSen(plan.leftSen))));
    set('budgetLeftFoot', budgetVerdict(plan));

    set('budgetSpend', money(fromSen(plan.spendSen)));
    set('budgetSpendFoot', plan.incomeSen
        ? pct(plan.spendPct) + ' of income goes on living'
        : 'Needs + wants, before savings');

    set('budgetRate', plan.incomeSen ? pct(plan.saveRate) : '—');
    set('budgetRateFoot', plan.incomeSen
        ? money(fromSen(plan.bucketSen.save)) + ' a month · ' +
          money(fromSen(plan.bucketSen.save * 12)) + ' a year'
        : 'Savings + debt cleared, over income');

    // --- side panel tally ---
    set('budgetTallyIncome', money(fromSen(plan.incomeSen)));
    set('budgetTallySpend', '− ' + money(fromSen(plan.spendSen)));
    set('budgetTallySave', '− ' + money(fromSen(plan.bucketSen.save)));
    set('budgetTallyLeft', (plan.leftSen < 0 ? '− ' : '') + money(Math.abs(fromSen(plan.leftSen))));
    const leftTally = $('budgetTallyLeft');
    if (leftTally) leftTally.classList.toggle('is-minus', plan.leftSen < 0);

    set('budgetPlanned', money(fromSen(plan.plannedSen)));
    set('budgetDistNote', plan.incomeSen
        ? pct(plan.share(plan.plannedSen)) + ' of income assigned'
        : 'Nothing assigned yet');

    // --- per-row share bars ---
    const barBase = plan.incomeSen || plan.plannedSen;
    plan.rows.forEach((row) => {
        const bar = $('bar_' + row.id);
        if (bar) bar.style.width = (barBase ? row.sen / barBase * 100 : 0) + '%';
        set('pct_' + row.id, row.sen && barBase ? pct(row.sen / barBase * 100, 0) : '—');
    });

    paintBudgetDist(plan);
    paintBudgetGuide(plan);
    paintBudgetTable(plan);
}

/** The one line that says whether the month works. */
function budgetVerdict(plan) {
    if (!plan.incomeSen && !plan.plannedSen) return 'Start with your take-home pay';
    if (!plan.incomeSen) return 'Add your income to see if this fits';
    if (plan.leftSen < 0) return 'Overspent by ' + pct(Math.abs(plan.leftPct)) + ' — trim or earn more';
    if (plan.leftSen === 0) return 'Every ringgit has a job';

    const dailySen = Math.round(plan.leftSen / 30);
    return pct(plan.leftPct) + ' unassigned · about ' + money(fromSen(dailySen)) + ' a day';
}

function budgetSummaryText() {
    const plan = budgetCompute();
    const lines = ['Monthly budget — income ' + money(fromSen(plan.incomeSen))];

    plan.rows
        .filter((row) => row.sen > 0)
        .sort((a, b) => b.sen - a.sen)
        .forEach((row) => {
            lines.push(row.label + ': ' + money(fromSen(row.sen)) +
                (plan.incomeSen ? ' (' + pct(plan.share(row.sen), 0) + ')' : ''));
        });

    lines.push('Spending ' + money(fromSen(plan.spendSen)) +
        ', savings & debt ' + money(fromSen(plan.bucketSen.save)));
    lines.push(plan.leftSen < 0
        ? 'Over budget by ' + money(fromSen(-plan.leftSen))
        : 'Left over ' + money(fromSen(plan.leftSen)));

    return lines.join('\n');
}

function renderBudget() {
    readBudgetState();
    paintBudget(budgetCompute());
    saveBudget();
}

/** Add / remove a user category. Read first so nothing typed is lost. */
function onBudgetEdit(event) {
    const btn = event.target.closest('button[data-remove-cat]');
    if (!btn) return;

    readBudgetState();
    const id = btn.closest('.bgt-row').dataset.cat;
    budgetState.custom = budgetState.custom.filter((cat) => cat.id !== id);
    buildBudgetCustom();
    renderBudget();
}

/** Keep the icon tint in step with the bucket a custom row is set to. */
function onBudgetBucketChange(event) {
    const select = event.target.closest('.bgt-bucket');
    if (!select) return;
    select.closest('.bgt-row').dataset.bucket = select.value;
}

/**
 * --------------------------------------------------------------------
 * A budget you have to retype every visit is not a budget, so it is kept
 * in localStorage. Private mode and file:// in some browsers throw on
 * access — the app has to work either way, so every call is guarded.
 * --------------------------------------------------------------------
 */
function saveBudget() {
    const amounts = {};
    BUDGET_CATEGORIES.forEach((cat) => { amounts[cat.id] = ($('bgt_' + cat.id) || {}).value || ''; });

    try {
        localStorage.setItem(BUDGET_KEY, JSON.stringify({
            income: ($('budgetIncome') || {}).value || '',
            extra:  ($('budgetExtra')  || {}).value || '',
            rule:   (($('budgetRule')  || {}).dataset || {}).value || '502030',
            amounts,
            custom: budgetState.custom.map((c) => ({ label: c.label, amount: c.amount, bucket: c.bucket })),
        }));
    } catch (err) { /* storage unavailable — the session still works */ }
}

function loadBudget() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(BUDGET_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') return;

    if ($('budgetIncome')) $('budgetIncome').value = saved.income || '';
    if ($('budgetExtra'))  $('budgetExtra').value  = saved.extra  || '';
    if ($('budgetRule') && BUDGET_RULES[saved.rule]) setSegment($('budgetRule'), saved.rule);
    else if ($('budgetRule') && saved.rule === 'off') setSegment($('budgetRule'), 'off');

    Object.entries(saved.amounts || {}).forEach(([id, value]) => {
        const el = $('bgt_' + id);
        if (el) el.value = value;
    });

    budgetState.custom = (Array.isArray(saved.custom) ? saved.custom : []).map((c) => ({
        id: nextId('c'),
        label: String(c.label || ''),
        amount: String(c.amount || ''),
        bucket: BUDGET_BUCKETS[c.bucket] ? c.bucket : 'wants',
    }));
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

/** The minimum due: a percentage of the statement, never below the floor. */
const cardMinimumFn = (minPct, floorSen) => (bal, interest, statement) =>
    Math.max(Math.round(statement * minPct / 100), floorSen);

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

function cardCompute() {
    const balanceSen  = Math.max(0, toSen(num('cardBalance')));
    const annualRate  = Math.max(0, num('cardRate'));
    const monthlyRate = annualRate / 100 / 12;
    const minPct      = Math.max(0, num('cardMinPct'));
    const minFloorSen = Math.max(0, toSen(num('cardMinFloor')));
    const paymentSen  = Math.max(0, toSen(num('cardPayment')));

    const minimumFn      = cardMinimumFn(minPct, minFloorSen);
    const firstInterest  = Math.round(balanceSen * monthlyRate);
    const firstMinimum   = balanceSen > 0 ? minimumFn(balanceSen, firstInterest, balanceSen + firstInterest) : 0;

    // An empty payment field means "I only pay the minimum" — the default
    // behaviour the module exists to argue against.
    const onMinimum = paymentSen <= 0;
    const payFn     = onMinimum ? minimumFn : () => paymentSen;

    const plan    = cardRun(balanceSen, monthlyRate, payFn);
    const minPlan = onMinimum ? plan : cardRun(balanceSen, monthlyRate, minimumFn);

    return {
        balanceSen, annualRate, monthlyRate, minPct, minFloorSen, paymentSen,
        firstInterest, firstMinimum, onMinimum, plan, minPlan,
        payingSen: onMinimum ? firstMinimum : paymentSen,
        view: (($('cardView') || {}).dataset || {}).value || 'year',
    };
}

/** The plans shown side by side. Duplicates and pointless rows are dropped. */
function cardScenarios(card) {
    const { balanceSen, monthlyRate, paymentSen, onMinimum } = card;
    const list = [{ label: 'Minimum only', note: card.minPct + '% of the balance, falling every month', paySen: null, plan: card.minPlan }];

    const add = (label, note, paySen) => {
        if (paySen <= 0) return;
        if (list.some((s) => s.paySen === paySen)) return;
        list.push({ label, note, paySen, plan: cardRun(balanceSen, monthlyRate, () => paySen) });
    };

    if (!onMinimum) add('Your payment', 'What you typed in', paymentSen);

    // Step up from whatever the user is actually paying today.
    const base = onMinimum ? card.firstMinimum : paymentSen;
    add('+ RM100 a month', 'RM100 more than you pay now', base + toSen(100));
    add('+ RM300 a month', 'RM300 more than you pay now', base + toSen(300));
    add('Clear it in a year', 'Whatever 12 payments takes', cardPaymentFor(balanceSen, monthlyRate, 12));

    return list;
}

function paintCardDist(card) {
    const dist = $('cardDist');
    const legend = $('cardLegend');
    if (!dist || !legend) return;

    dist.innerHTML = '';
    legend.innerHTML = '';

    const { plan, balanceSen } = card;

    if (!balanceSen || plan.stalls) {
        dist.innerHTML = '<span class="dist-left" style="width:100%"></span>';
        legend.innerHTML = '<span class="legend-empty">' + (balanceSen
            ? 'At this payment the balance never comes down, so there is no total to split.'
            : 'Put in what is on the card and the cost works itself out.') + '</span>';
        return;
    }

    const parts = [
        { label: 'The balance itself', tone: 'jade', sen: balanceSen },
        { label: 'Interest on top',    tone: 'red',  sen: plan.interestSen },
    ];

    parts.forEach((part) => {
        const bar = document.createElement('span');
        bar.className = 'dist-' + part.tone;
        bar.style.width = (part.sen / plan.paidSen * 100) + '%';
        bar.title = part.label + ' · ' + money(fromSen(part.sen));
        dist.appendChild(bar);

        const item = document.createElement('span');
        item.className = 'legend-item';
        item.innerHTML =
            '<i class="dot dot-' + part.tone + '"></i>' +
            '<span>' + part.label + ' <b>' + money(fromSen(part.sen)) + '</b> ' +
            '<small>' + pct(part.sen / plan.paidSen * 100) + '</small></span>';
        legend.appendChild(item);
    });
}

function paintCardCompare(card) {
    const body = $('cardCompareBody');
    if (!body) return;
    body.innerHTML = '';

    if (!card.balanceSen) {
        set('cardCompareNote', '');
        body.appendChild(emptyRow('Add a balance to see what paying a bit more would do.', 5));
        return;
    }

    const scenarios = cardScenarios(card);
    const baseline  = card.minPlan;

    set('cardCompareNote', baseline.stalls
        ? 'The minimum never clears this card, so there is nothing to compare against'
        : 'Measured against paying only the minimum');

    scenarios.forEach((scenario) => {
        const plan = scenario.plan;
        const isNow = scenario.paySen === null ? card.onMinimum : scenario.paySen === card.paymentSen;
        const savedSen = (!plan.stalls && !baseline.stalls) ? baseline.interestSen - plan.interestSen : null;

        const tr = document.createElement('tr');
        if (isNow) tr.className = 'is-you';

        tr.appendChild(cell(
            '<strong>' + scenario.label + (isNow ? ' <em class="tag">you now</em>' : '') + '</strong>' +
            '<small>' + scenario.note + '</small>'
        ));
        tr.appendChild(cell(scenario.paySen === null
            ? money(fromSen(card.firstMinimum)) + ' falling'
            : money(fromSen(scenario.paySen))));
        tr.appendChild(cell(monthsText(plan.months), plan.stalls ? 'is-minus' : 'is-strong'));
        tr.appendChild(cell(plan.stalls ? '—' : fmt(fromSen(plan.interestSen)), plan.stalls ? 'is-muted' : ''));

        // A flat payment can cost *more* than the minimum: the minimum starts
        // high and only falls below a fixed amount years later. Say so rather
        // than leaving the column blank.
        tr.appendChild(cell(
            savedSen === null || savedSen === 0 ? '—'
                : (savedSen > 0 ? '+ ' : '− ') + fmt(Math.abs(fromSen(savedSen))),
            !savedSen ? 'is-muted' : savedSen > 0 ? 'is-plus' : 'is-minus'
        ));
        body.appendChild(tr);
    });
}

function paintCardPlan(card) {
    const body = $('cardPlanBody');
    if (!body) return;
    body.innerHTML = '';

    const byMonth = card.view === 'month';
    set('cardPlanHead', byMonth ? 'Month' : 'Year');

    if (!card.balanceSen) {
        set('cardPlanNote', '');
        body.appendChild(emptyRow('Nothing on the card — nothing to pay down.', 5));
        return;
    }

    if (card.plan.stalls) {
        set('cardPlanNote', '');
        body.appendChild(emptyRow(
            'At ' + money(fromSen(card.payingSen)) + ' a month the interest eats the payment, so the balance never falls.', 5));
        return;
    }

    set('cardPlanNote', card.plan.rows.length + ' payments · last one ' + monthLabel(card.plan.rows.length - 1));

    const rows = byMonth
        ? card.plan.rows.map((row) => ({
            label: monthLabel(row.month - 1),
            sub: 'Payment ' + row.month,
            paySen: row.paySen, interestSen: row.interestSen,
            principalSen: row.principalSen, balanceSen: row.balanceSen,
        }))
        : cardYearRows(card.plan.rows).map((row) => ({
            label: 'Year ' + row.year,
            sub: row.months + (row.months === 1 ? ' payment' : ' payments'),
            paySen: row.paySen, interestSen: row.interestSen,
            principalSen: row.principalSen, balanceSen: row.balanceSen,
        }));

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.appendChild(cell('<strong>' + row.label + '</strong><small>' + row.sub + '</small>'));
        tr.appendChild(cell(fmt(fromSen(row.paySen))));
        tr.appendChild(cell(fmt(fromSen(row.interestSen)), 'is-minus'));
        tr.appendChild(cell(fmt(fromSen(row.principalSen))));
        tr.appendChild(cell(row.balanceSen > 0 ? fmt(fromSen(row.balanceSen)) : 'Clear',
            row.balanceSen > 0 ? 'is-strong' : 'is-plus'));
        body.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Altogether'));
    totalRow.appendChild(cell(fmt(fromSen(card.plan.paidSen))));
    totalRow.appendChild(cell(fmt(fromSen(card.plan.interestSen))));
    totalRow.appendChild(cell(fmt(fromSen(card.balanceSen))));
    totalRow.appendChild(cell('Clear'));
    body.appendChild(totalRow);
}

function paintCard(card) {
    const { plan, balanceSen } = card;

    // --- hero ---
    set('cardMonths', balanceSen ? monthsText(plan.months) : '—');
    set('cardMonthsFoot', cardVerdict(card));

    set('cardInterest', plan.stalls ? '—' : money(fromSen(plan.interestSen)));
    set('cardInterestFoot', !balanceSen ? 'Nothing owing yet'
        : plan.stalls ? 'The balance never comes down'
        : pct(plan.interestSen / balanceSen * 100) + ' on top of what you owe');

    set('cardPaid', plan.stalls ? '—' : money(fromSen(plan.paidSen)));
    set('cardPaidFoot', !balanceSen ? '—'
        : plan.stalls ? 'Paying forever'
        : money(fromSen(balanceSen)) + ' of balance + ' + money(fromSen(plan.interestSen)) + ' of interest');

    // --- tally ---
    set('cardTallyBalance', money(fromSen(balanceSen)));
    set('cardTallyInterest', '+ ' + money(fromSen(card.firstInterest)));
    set('cardTallyMin', money(fromSen(card.firstMinimum)));
    set('cardTallyPay', money(fromSen(card.payingSen)));

    const payHint = $('cardPaymentHint');
    if (payHint) {
        payHint.textContent = card.onMinimum
            ? 'Empty — so this is the minimum, ' + money(fromSen(card.firstMinimum)) + ' to start, falling every month.'
            : 'Leave it empty to see what paying only the minimum does.';
    }

    const payInput = $('cardPayment');
    if (payInput) payInput.placeholder = card.firstMinimum ? fmt(fromSen(card.firstMinimum)) : '0';

    set('cardDistNote', !balanceSen || plan.stalls ? ''
        : 'Every RM100 owed costs ' + money(fromSen(Math.round(plan.interestSen / (balanceSen / 10000)))) + ' in interest');

    // --- the warning strip ---
    const notice = $('cardNotice');
    if (notice) {
        notice.hidden = !(balanceSen && plan.stalls);
        set('cardNoticeText', balanceSen && plan.stalls
            ? money(fromSen(card.payingSen)) + ' a month does not even cover the ' +
              money(fromSen(card.firstInterest)) + ' of interest, so the balance grows instead of falling. ' +
              'You need more than ' + money(fromSen(card.firstInterest)) + ' a month just to stand still.'
            : '');
    }

    paintCardDist(card);
    paintCardCompare(card);
    paintCardPlan(card);
}

function cardVerdict(card) {
    if (!card.balanceSen) return 'Put in what is on the card';
    if (card.plan.stalls) return 'This payment never clears the card';

    const when = monthLabel(card.plan.months - 1);
    return money(fromSen(card.payingSen)) + ' a month' + (card.onMinimum ? ' (the minimum)' : '') +
        ' · clear by ' + when;
}

function cardSummaryText() {
    const card = cardCompute();
    const lines = ['Credit card — ' + money(fromSen(card.balanceSen)) + ' at ' + pct(card.annualRate, 1) + ' a year'];

    if (!card.balanceSen) return lines[0];

    if (card.plan.stalls) {
        lines.push('At ' + money(fromSen(card.payingSen)) + ' a month the balance never comes down.');
        lines.push('Interest alone is ' + money(fromSen(card.firstInterest)) + ' this month.');
        return lines.join('\n');
    }

    lines.push('Paying ' + money(fromSen(card.payingSen)) + ' a month' + (card.onMinimum ? ' (minimum only)' : '') + ':');
    lines.push('  cleared in ' + monthsText(card.plan.months) + ' (' + monthLabel(card.plan.months - 1) + ')');
    lines.push('  interest ' + money(fromSen(card.plan.interestSen)) +
        ', paid altogether ' + money(fromSen(card.plan.paidSen)));

    cardScenarios(card).slice(1).forEach((scenario) => {
        if (scenario.paySen === card.paymentSen || scenario.plan.stalls) return;
        const saved = card.minPlan.stalls ? null : card.minPlan.interestSen - scenario.plan.interestSen;
        lines.push(scenario.label + ' (' + money(fromSen(scenario.paySen)) + '): ' +
            monthsText(scenario.plan.months) +
            (saved > 0 ? ', saves ' + money(fromSen(saved)) : ''));
    });

    return lines.join('\n');
}

function renderCard() {
    paintCard(cardCompute());
    saveCard();
}

/** Keep the rate preset in step with the rate field. */
function syncCardTier() {
    const seg = $('cardTier');
    if (!seg) return;
    const rate = String(num('cardRate'));
    setSegment(seg, ['15', '17', '18'].includes(rate) ? rate : 'custom');
}

function saveCard() {
    try {
        localStorage.setItem(CARD_KEY, JSON.stringify({
            balance:  ($('cardBalance')  || {}).value || '',
            rate:     ($('cardRate')     || {}).value || '',
            payment:  ($('cardPayment')  || {}).value || '',
            minPct:   ($('cardMinPct')   || {}).value || '',
            minFloor: ($('cardMinFloor') || {}).value || '',
            view:     (($('cardView')    || {}).dataset || {}).value || 'year',
        }));
    } catch (err) { /* storage unavailable — the session still works */ }
}

function loadCard() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(CARD_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') return;

    [['cardBalance', 'balance'], ['cardRate', 'rate'], ['cardPayment', 'payment'],
     ['cardMinPct', 'minPct'], ['cardMinFloor', 'minFloor']].forEach(([id, key]) => {
        if ($(id) && saved[key] !== undefined) $(id).value = saved[key];
    });

    if ($('cardView') && ['year', 'month'].includes(saved.view)) setSegment($('cardView'), saved.view);
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

const LEDGER_CATEGORIES = BUDGET_CATEGORIES.concat([
    { id: 'other', label: 'Other', bucket: 'wants', icon: 'bi-three-dots', hint: 'Anything that does not fit' },
]);

const INCOME_CATEGORIES = [
    { id: 'salary',   label: 'Salary',      icon: 'bi-cash-stack' },
    { id: 'bonus',    label: 'Bonus',       icon: 'bi-gift' },
    { id: 'side',     label: 'Side income', icon: 'bi-briefcase' },
    { id: 'refund',   label: 'Refund',      icon: 'bi-arrow-counterclockwise' },
    { id: 'gift',     label: 'Angpao',      icon: 'bi-envelope-heart' },
    { id: 'other-in', label: 'Other',       icon: 'bi-three-dots' },
];

const ACCOUNT_GROUPS = {
    cash:    'Cash',
    bank:    'Bank',
    ewallet: 'E-wallet',
    savings: 'Savings',
    credit:  'Credit card',
};

const DEFAULT_ACCOUNTS = [
    { name: 'Cash',        group: 'cash',    opening: '' },
    { name: 'Bank',        group: 'bank',    opening: '' },
    { name: "Touch 'n Go", group: 'ewallet', opening: '' },
    { name: 'Credit card', group: 'credit',  opening: '' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Ids have to survive a reload, so the counter is persisted with the data. */
let ledgerSeq = 0;
const ledgerId = (prefix) => prefix + (++ledgerSeq);

let ledgerState = { entries: [], accounts: [], month: '', editing: null };

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
    ledgerState.accounts = DEFAULT_ACCOUNTS.map((a) => ({ id: ledgerId('a'), name: a.name, group: a.group, opening: a.opening }));
}

/** Opening balance, then every entry that touched the account. */
function accountBalances() {
    const balances = {};
    ledgerState.accounts.forEach((a) => { balances[a.id] = toSen(parseFloat(a.opening) || 0); });

    ledgerState.entries.forEach((entry) => {
        const amount = entrySen(entry);
        if (!amount) return;

        if (entry.type === 'income') {
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
        account.name    = row.querySelector('.bgt-label').value;
        account.group   = row.querySelector('.bgt-bucket').value;
        account.opening = row.querySelector('.bgt-amount').value;
    });
}

function buildLedgerAccounts() {
    const host = $('ledgerAccounts');
    if (!host) return;
    host.innerHTML = '';

    ledgerState.accounts.forEach((account, index) => {
        const row = document.createElement('div');
        row.className = 'bgt-row is-custom';
        row.dataset.cat = account.id;
        row.innerHTML =
            '<span class="bgt-icon"><i class="bi bi-wallet2"></i></span>' +
            '<div class="bgt-meta"><input type="text" class="bgt-label"></div>' +
            '<select class="bgt-bucket" aria-label="Kind of account">' +
                Object.entries(ACCOUNT_GROUPS).map(([key, label]) =>
                    '<option value="' + key + '">' + label + '</option>').join('') +
            '</select>' +
            '<div class="money-input money-input-sm"><span class="affix">RM</span>' +
                '<input type="number" class="bgt-amount" step="10" placeholder="0" inputmode="decimal"></div>' +
            '<button type="button" class="split-x" data-remove-account aria-label="Remove account">' +
                '<i class="bi bi-x-lg"></i></button>';

        // Assigned rather than interpolated — these are user-typed strings.
        const label = row.querySelector('.bgt-label');
        label.value = account.name;
        label.placeholder = 'Account ' + (index + 1);
        row.querySelector('.bgt-amount').value = account.opening;
        row.querySelector('.bgt-bucket').value = ACCOUNT_GROUPS[account.group] ? account.group : 'bank';

        host.appendChild(row);
    });
}

/** Keep the two account pickers in step with the account list. */
function buildAccountOptions() {
    ['ledgerAccount', 'ledgerTo'].forEach((id) => {
        const select = $(id);
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '';
        ledgerState.accounts.forEach((account, index) => {
            const option = document.createElement('option');
            option.value = account.id;
            // Names are user-typed, so they are set as text rather than markup.
            option.textContent = account.name.trim() || 'Account ' + (index + 1);
            select.appendChild(option);
        });
        if (ledgerState.accounts.some((a) => a.id === previous)) select.value = previous;
    });
}

function buildCategoryOptions() {
    const select = $('ledgerCategory');
    if (!select) return;
    const list = ledgerFormType() === 'income' ? INCOME_CATEGORIES : LEDGER_CATEGORIES;
    const previous = select.value;

    select.innerHTML = '';
    list.forEach((category) => {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.label;
        select.appendChild(option);
    });
    if (list.some((c) => c.id === previous)) select.value = previous;
}

const categoryOf = (entry) => {
    const list = entry.type === 'income' ? INCOME_CATEGORIES : LEDGER_CATEGORIES;
    return list.find((c) => c.id === entry.category) || list[list.length - 1];
};

/**
 * --------------------------------------------------------------------
 * Reading the book
 * --------------------------------------------------------------------
 */
const entrySen = (entry) => Math.max(0, toSen(parseFloat(entry.amount) || 0));

/** Newest day first, and within a day the most recently added sits on top. */
function ledgerEntriesFor(monthKey) {
    return ledgerState.entries
        .filter((entry) => monthOf(entry.date) === monthKey)
        .sort((a, b) => (a.date === b.date ? b.seq - a.seq : (a.date < b.date ? 1 : -1)));
}

function ledgerTotals(entries) {
    let incomeSen = 0, expenseSen = 0, movedSen = 0;
    entries.forEach((entry) => {
        const amount = entrySen(entry);
        if (entry.type === 'income') incomeSen += amount;
        else if (entry.type === 'expense') expenseSen += amount;
        else movedSen += amount;
    });
    return { incomeSen, expenseSen, movedSen, netSen: incomeSen - expenseSen };
}

function ledgerCompute() {
    const month   = ledgerState.month || monthOf(todayIso());
    const entries = ledgerEntriesFor(month);
    const totals  = ledgerTotals(entries);

    const byCategory = {};
    entries.filter((entry) => entry.type === 'expense').forEach((entry) => {
        const cat = categoryOf(entry);
        byCategory[cat.id] = (byCategory[cat.id] || 0) + entrySen(entry);
    });

    const categories = Object.entries(byCategory)
        .map(([id, sen]) => ({ cat: LEDGER_CATEGORIES.find((c) => c.id === id), sen }))
        .filter((row) => row.cat)
        .sort((a, b) => b.sen - a.sen);

    return {
        month, entries, categories, balances: accountBalances(),
        incomeSen: totals.incomeSen, expenseSen: totals.expenseSen,
        movedSen: totals.movedSen, netSen: totals.netSen,
    };
}

/** What the Budget Planner set aside for a category, if anything. */
function budgetedSenFor(categoryId) {
    const input = $('bgt_' + categoryId);
    return input ? Math.max(0, toSen(parseFloat(input.value) || 0)) : 0;
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
    set('ledgerListNote', book.entries.length
        ? book.entries.length + (book.entries.length === 1 ? ' entry' : ' entries') +
          (book.movedSen ? ' · ' + money(fromSen(book.movedSen)) + ' moved between accounts' : '')
        : '');

    if (!book.entries.length) {
        const empty = document.createElement('p');
        empty.className = 'split-empty';
        empty.textContent = 'Nothing written down for ' + monthKeyLabel(book.month) +
            ' yet. Put in what you spent above — amount, what it was, done.';
        host.appendChild(empty);
        return;
    }

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
            row.className = 'led-entry';
            row.dataset.entry = entry.id;

            const sign = entry.type === 'income' ? '+ ' : entry.type === 'expense' ? '− ' : '';
            const tone = entry.type === 'income' ? 'is-in' : entry.type === 'expense' ? 'is-out' : 'is-move';

            row.innerHTML =
                '<span class="led-icon led-' + entry.type + '"><i class="bi ' +
                    (entry.type === 'transfer' ? 'bi-arrow-left-right' : cat.icon) + '"></i></span>' +
                '<button type="button" class="led-meta" data-edit-entry>' +
                    '<b></b><small></small></button>' +
                '<span class="led-amount ' + tone + '">' + sign + money(fromSen(entrySen(entry))) + '</span>' +
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

    if (!book.expenseSen) {
        dist.innerHTML = '<span class="dist-left" style="width:100%"></span>';
        legend.innerHTML = '<span class="legend-empty">Nothing spent this month yet.</span>';
        set('ledgerCatNote', '');
        body.appendChild(emptyRow('No spending recorded for ' + monthKeyLabel(book.month) + '.', 5));
        return;
    }

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

    Object.entries(ACCOUNT_GROUPS).forEach(([key, label]) => {
        const inGroup = ledgerState.accounts.filter((a) => a.group === key);
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
    buildAccountOptions();
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

/** A transfer swaps the category picker for a second account. */
function syncLedgerForm() {
    const type = ledgerFormType();
    const transfer = type === 'transfer';

    if ($('ledgerFieldCategory')) $('ledgerFieldCategory').hidden = transfer;
    if ($('ledgerFieldTo'))       $('ledgerFieldTo').hidden = !transfer;

    set('ledgerAccountLabel', transfer ? 'Out of' : type === 'income' ? 'Into' : 'Paid from');
    buildCategoryOptions();
}

function ledgerClearForm() {
    ledgerState.editing = null;
    if ($('ledgerAmount')) $('ledgerAmount').value = '';
    if ($('ledgerNote'))   $('ledgerNote').value = '';
    if ($('ledgerDate'))   $('ledgerDate').value = todayIso();

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

    const entry = {
        id:        ledgerState.editing || ledgerId('e'),
        seq:       ++ledgerSeq,
        type:      type,
        amount:    String(amount),
        date:      ($('ledgerDate') || {}).value || todayIso(),
        category:  type === 'transfer' ? '' : ($('ledgerCategory') || {}).value,
        account:   from,
        toAccount: type === 'transfer' ? into : '',
        note:      ($('ledgerNote') || {}).value || '',
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
    if ($('ledgerDate'))   $('ledgerDate').value = entry.date;
    if ($('ledgerNote'))   $('ledgerNote').value = entry.note;
    if ($('ledgerCategory') && entry.category) $('ledgerCategory').value = entry.category;
    if ($('ledgerAccount')) $('ledgerAccount').value = entry.account;
    if ($('ledgerTo') && entry.toAccount) $('ledgerTo').value = entry.toAccount;

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
        localStorage.setItem(LEDGER_KEY, JSON.stringify({
            seq: ledgerSeq,
            month: ledgerState.month,
            accounts: ledgerState.accounts,
            entries: ledgerState.entries,
        }));
    } catch (err) { /* storage unavailable — the session still works */ }
}

function loadLedger() {
    let saved = null;
    try { saved = JSON.parse(storedRaw(LEDGER_KEY) || 'null'); } catch (err) { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};

    ledgerSeq = Number(saved.seq) || 0;
    ledgerState.month = /^\d{4}-\d{2}$/.test(saved.month || '') ? saved.month : monthOf(todayIso());

    ledgerState.accounts = (Array.isArray(saved.accounts) ? saved.accounts : [])
        .filter((a) => a && a.id)
        .map((a) => ({
            id: String(a.id),
            name: String(a.name || ''),
            group: ACCOUNT_GROUPS[a.group] ? a.group : 'bank',
            opening: String(a.opening || ''),
        }));
    if (!ledgerState.accounts.length) seedAccounts();

    const known = new Set(ledgerState.accounts.map((a) => a.id));
    ledgerState.entries = (Array.isArray(saved.entries) ? saved.entries : [])
        .filter((e) => e && e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && known.has(e.account))
        .map((e, index) => ({
            id: String(e.id),
            seq: Number(e.seq) || index + 1,
            type: ['expense', 'income', 'transfer'].includes(e.type) ? e.type : 'expense',
            amount: String(e.amount || '0'),
            date: String(e.date),
            category: String(e.category || ''),
            account: String(e.account),
            toAccount: known.has(e.toAccount) ? String(e.toAccount) : '',
            note: String(e.note || ''),
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
        if (account.group === 'savings') savingsSen += balance;
        if (account.group === 'credit') {
            creditCount++;
            if (balance < 0) creditOwingSen -= balance;
        }
    });

    // Credit card outstanding: the ledger's own credit accounts are the record
    // of what is owed. With none on the books, the Card Payoff module's balance
    // is the only figure this app holds — so it stands in, and says so, rather
    // than the dashboard reporting nothing owed on a card being paid off.
    const cardBalanceSen = Math.max(0, toSen(num('cardBalance')));
    const creditFromCard = creditCount === 0 && cardBalanceSen > 0;

    const plan = budgetCompute();

    return {
        range, entries, balances,
        days: rangeDays(range.from, range.to),

        incomeSen:  totals.incomeSen,
        expenseSen: totals.expenseSen,
        movedSen:   totals.movedSen,
        netSen:     totals.netSen,

        assetsSen, owingSen, savingsSen,
        totalSen: assetsSen - owingSen,
        accountCount: ledgerState.accounts.length,

        creditSen: creditFromCard ? cardBalanceSen : creditOwingSen,
        creditFromCard, creditCount,

        plannedSen: plan.plannedSen,
        budgetLeftSen: plan.plannedSen - totals.expenseSen,
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

    entries.filter((entry) => entry.type === 'expense').forEach((entry) => {
        const sen = entrySen(entry);
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
            (entry.type === 'expense' && entry.date >= bucket.from && entry.date <= bucket.to)
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
    entries.filter((entry) => entry.type === 'expense').forEach((entry) => {
        const cat = categoryOf(entry);
        byCategory[cat.id] = (byCategory[cat.id] || 0) + entrySen(entry);
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

function kpiTile(kpi) {
    const tile = document.createElement('div');
    tile.className = 'kpi' + (kpi.pending ? ' is-pending' : '');
    tile.innerHTML =
        '<span class="kpi-label"><i class="bi ' + kpi.icon + '"></i>' + escapeHtml(kpi.label) + '</span>' +
        '<b class="kpi-value ' + (kpi.tone || '') + '">' + kpi.value + '</b>' +
        '<small class="kpi-foot">' + escapeHtml(kpi.foot) + '</small>';
    return tile;
}

function paintDashKpis(book) {
    const host = $('dashKpis');
    if (!host) return;
    host.innerHTML = '';

    const monthly = book.range.monthly;

    const kpis = [
        {
            label: 'Total balance', icon: 'bi-wallet2',
            value: signedMoney(book.totalSen),
            tone: book.totalSen < 0 ? 'is-minus' : '',
            foot: 'Every account, all time',
        },
        {
            label: 'Total income', icon: 'bi-arrow-down-left-circle',
            value: money(fromSen(book.incomeSen)), tone: book.incomeSen ? 'is-plus' : '',
            foot: book.range.label.toLowerCase(),
        },
        {
            label: 'Total expenses', icon: 'bi-arrow-up-right-circle',
            value: money(fromSen(book.expenseSen)), tone: book.expenseSen ? 'is-minus' : '',
            foot: book.range.label.toLowerCase(),
        },
        {
            label: 'Net cash flow', icon: 'bi-arrow-left-right',
            value: signedMoney(book.netSen),
            tone: book.netSen < 0 ? 'is-minus' : book.netSen > 0 ? 'is-plus' : '',
            foot: book.incomeSen
                ? pct((book.netSen / book.incomeSen) * 100) + ' of what came in'
                : 'Income − expenses',
        },
        {
            label: 'Total savings', icon: 'bi-piggy-bank',
            value: money(fromSen(book.savingsSen)),
            foot: 'Accounts marked Savings',
        },
        {
            label: 'Investment value', icon: 'bi-graph-up-arrow',
            value: '—', pending: true,
            foot: 'Arrives with Grow (M7)',
        },
        {
            label: 'Outstanding instalments', icon: 'bi-calendar2-check',
            value: '—', pending: true,
            foot: 'Arrives with Commit (M5)',
        },
        {
            label: 'Credit card outstanding', icon: 'bi-credit-card-2-front',
            value: money(fromSen(book.creditSen)),
            tone: book.creditSen ? 'is-minus' : '',
            foot: book.creditFromCard ? 'From Card Payoff — no credit account on the books'
                : book.creditCount ? book.creditCount + (book.creditCount === 1 ? ' credit account' : ' credit accounts')
                : 'No credit account recorded',
        },
        {
            label: 'Upcoming payments', icon: 'bi-hourglass-split',
            value: '—', pending: true,
            foot: 'Needs due dates — Commit (M5)',
        },
        {
            label: 'Budget remaining', icon: 'bi-clipboard-check',
            value: book.plannedSen ? signedMoney(book.budgetLeftSen) : '—',
            tone: !book.plannedSen ? '' : book.budgetLeftSen < 0 ? 'is-minus' : 'is-plus',
            pending: !book.plannedSen,
            foot: !book.plannedSen ? 'Nothing planned in Budget Planner yet'
                : monthly ? 'of ' + money(fromSen(book.plannedSen)) + ' planned'
                : 'monthly plan of ' + money(fromSen(book.plannedSen)) + ' vs this period',
        },
    ];

    kpis.forEach((kpi) => host.appendChild(kpiTile(kpi)));
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
        dist.innerHTML = '<span class="dist-left" style="width:100%"></span>';
        set('dashFlowVerdict', 'Nothing recorded in this period.');
        return;
    }

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

    Object.entries(ACCOUNT_GROUPS).forEach(([key, label]) => {
        const inGroup = ledgerState.accounts.filter((account) => account.group === key);
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
        if (entry.type === 'income')  return sen;
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

    if (!rows.length) {
        chart.innerHTML = '<p class="split-empty">Nothing spent in this period, so there is nothing to break down.</p>';
        legend.innerHTML = '<span class="legend-empty">No spending in ' + escapeHtml(book.range.sub) + '.</span>';
        set('dashBreakdownNote', '—');
        body.appendChild(emptyRow('No spending recorded.', 4));
        return;
    }

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

    host.innerHTML = trendSvg(points, view);

    const spent = points.filter((point) => point.sen > 0);
    if (!spent.length) {
        set('dashTrendNote', 'Nothing spent across these ' + points.length + ' periods');
        set('dashTrendFoot', '—');
        return;
    }

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
        const cat = LEDGER_CATEGORIES.find((c) => c.id === id);
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
        'Savings           ' + money(fromSen(book.savingsSen)),
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
 * Three settings, not two: light, dark, and whatever this device is set
 * to. The third is the default and the only one that can change while
 * you are looking at the page, so it is the only one that needs a
 * listener.
 *
 * The attribute is stamped on <html> by the inline script in the page
 * head, before the first paint — everything here only keeps it in step.
 * It is deliberately not in BACKUP_STORES: how this screen looks is a
 * property of the screen, not of your records, and restoring a backup
 * onto a different machine should not change its brightness.
 * ====================================================================
 */
const THEME_KEY = 'moneyflow.theme.v1';
const THEME_ORDER = ['system', 'light', 'dark'];

const THEME_FACE = {
    system: { icon: 'bi-circle-half',  label: 'System' },
    light:  { icon: 'bi-sun',          label: 'Light'  },
    dark:   { icon: 'bi-moon-stars',   label: 'Dark'   },
};

let themeChoice = 'system';

const prefersDark = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

const themeIsDark = () => themeChoice === 'dark' || (themeChoice === 'system' && prefersDark());

function applyTheme() {
    const dark = themeIsDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    const face = THEME_FACE[themeChoice] || THEME_FACE.system;
    const btn  = $('themeToggle');
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.className = 'bi ' + face.icon;
        // The label is hidden on a narrow topbar, so the title carries it.
        btn.title = face.label + (themeChoice === 'system' ? ' (' + (dark ? 'dark' : 'light') + ' right now)' : '') +
            ' — click for ' + THEME_FACE[THEME_ORDER[(THEME_ORDER.indexOf(themeChoice) + 1) % THEME_ORDER.length]].label.toLowerCase();
    }
    set('themeLabel', face.label);

    // The wordmark is a file, not markup, and its "Money" is set in near-black
    // — invisible on a dark topbar. The dark file is the same mark, lifted.
    const mark = document.querySelector('.brand img');
    if (mark) mark.setAttribute('src', dark ? 'logo-dark.svg' : 'logo.svg');
}

/** The charts take their colours from the stylesheet at paint time, so a
 *  theme change has to redraw whichever of them is on screen. */
function repaintTheme() {
    applyTheme();
    const dash = $('module-dash');
    if (dash && !dash.hidden) renderDash();
}

function loadTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { saved = null; }
    themeChoice = THEME_ORDER.includes(saved) ? saved : 'system';
    applyTheme();
}

function cycleTheme() {
    themeChoice = THEME_ORDER[(THEME_ORDER.indexOf(themeChoice) + 1) % THEME_ORDER.length];
    try { localStorage.setItem(THEME_KEY, themeChoice); } catch (err) { /* storage unavailable */ }
    repaintTheme();
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
    card:   { render: renderCard },
};

const FORM_DEFAULTS = {
    dash: {
        dashPeriod: 'month', dashFrom: '', dashTo: '',
        dashDim: 'category', dashDimChart: 'donut',
        dashTrend: 'monthly', dashTrendView: 'line',
        dashCmpGrain: 'month',
    },
    ledger: { ledgerType: 'expense', ledgerAmount: '', ledgerNote: '' },
    split:  { splitCharges: 'none', splitService: '0', splitTax: '0', splitDiscount: '' },
    budget: { budgetIncome: '', budgetExtra: '', budgetRule: '502030' },
    card:   {
        cardTier: '18', cardBalance: '', cardRate: '18', cardPayment: '',
        cardMinPct: '5', cardMinFloor: '25', cardView: 'year',
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

    if (which === 'split') {
        if ($('splitRound')) $('splitRound').checked = false;
        splitState = { people: [newPerson(), newPerson()], shared: [] };
        buildSplitPeople();
        buildSplitShared();
        renderSplit();
    }

    if (which === 'budget') {
        BUDGET_CATEGORIES.forEach((cat) => { if ($('bgt_' + cat.id)) $('bgt_' + cat.id).value = ''; });
        budgetState = { custom: [] };
        buildBudgetCustom();
        renderBudget();
    }

    if (which === 'card') renderCard();

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
 * Everything MoneyFlow remembers lives in this browser's localStorage, which
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
const BACKUP_STORES = [LEDGER_KEY, BUDGET_KEY, CARD_KEY];

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
    const entries  = Array.isArray(ledger.entries)  ? ledger.entries.length  : 0;
    const accounts = Array.isArray(ledger.accounts) ? ledger.accounts.length : 0;

    if (!entries) {
        return accounts ? accounts + ' accounts and nothing recorded yet' : 'nothing recorded yet';
    }
    return entries + (entries === 1 ? ' entry' : ' entries')
        + ' across ' + accounts + (accounts === 1 ? ' account' : ' accounts');
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
function backupApply(envelope) {
    try {
        BACKUP_STORES.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(envelope.stores, key)) {
                localStorage.setItem(key, JSON.stringify(envelope.stores[key]));
            } else {
                // Absent from the backup means absent afterwards. Leaving the
                // old value would blend two books, which is the one thing
                // replacing is meant to prevent.
                localStorage.removeItem(key);
            }
        });
        location.reload();
    } catch (err) {
        backupSay('Could not restore the backup',
            'The browser refused to write to storage, so nothing was changed. That usually '
            + 'means private browsing, or storage being full.');
    }
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
}

function setSegment(seg, value) {
    seg.dataset.value = value;
    seg.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.val === value);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // --- theme: first, so nothing paints in the wrong palette ---
    loadTheme();

    // --- bill split ---
    buildSplitPeople();
    buildSplitShared();

    // --- budget planner: build the fixed rows before restoring their values ---
    buildBudgetRows();
    loadBudget();
    buildBudgetCustom();

    // --- card payoff ---
    loadCard();
    syncCardTier();

    // --- daily ledger: accounts first, they are what entries point at ---
    loadLedger();
    buildLedgerAccounts();
    buildAccountOptions();
    syncLedgerForm();
    ledgerClearForm();

    document.querySelectorAll('.seg').forEach((seg) => {
        seg.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-val]');
            if (!btn) return;
            setSegment(seg, btn.dataset.val);
            if (seg.id === 'splitCharges') { applyChargePreset(btn.dataset.val); renderSplit(); }
            if (seg.id === 'budgetRule') renderBudget();
            if (seg.id === 'cardTier' && $('cardRate')) $('cardRate').value = btn.dataset.val;
            if (seg.id === 'cardTier' || seg.id === 'cardView') renderCard();
            if (seg.id === 'ledgerType') { syncLedgerForm(); renderLedger(); }
            if (['dashPeriod', 'dashDim', 'dashDimChart', 'dashTrend', 'dashTrendView', 'dashCmpGrain']
                .includes(seg.id)) renderDash();
        });
    });

    document.querySelectorAll('#split-form input').forEach((el) => {
        el.addEventListener('input', renderSplit);
        el.addEventListener('change', renderSplit);
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
            if (event.key === 'Enter') { event.preventDefault(); ledgerSubmit(); }
        });
    }

    document.querySelectorAll('#card-form input').forEach((el) => {
        const paint = () => { syncCardTier(); renderCard(); };
        el.addEventListener('input', paint);
        el.addEventListener('change', paint);
    });

    // Rows are built on the fly, so their events are delegated to the host.
    ['splitPeople', 'splitShared'].forEach((id) => {
        const host = $(id);
        if (!host) return;
        host.addEventListener('input', renderSplit);
        host.addEventListener('click', onSplitEdit);
    });

    ['budgetRows', 'budgetCustom'].forEach((id) => {
        const host = $(id);
        if (!host) return;
        host.addEventListener('input', renderBudget);
        host.addEventListener('change', (event) => { onBudgetBucketChange(event); renderBudget(); });
        host.addEventListener('click', onBudgetEdit);
    });

    const addPerson = $('splitAddPerson');
    if (addPerson) {
        addPerson.addEventListener('click', () => {
            readSplitState();
            splitState.people.push(newPerson());
            buildSplitPeople();
            renderSplit();
        });
    }

    const addShared = $('splitAddShared');
    if (addShared) {
        addShared.addEventListener('click', () => {
            readSplitState();
            splitState.shared.push(newItem());
            buildSplitShared();
            renderSplit();
        });
    }

    const addCat = $('budgetAddCat');
    if (addCat) {
        addCat.addEventListener('click', () => {
            readBudgetState();
            budgetState.custom.push(newCategory());
            buildBudgetCustom();
            renderBudget();
            const last = document.querySelector('#budgetCustom .bgt-row:last-child .bgt-label');
            if (last) last.focus();
        });
    }

    const splitCopy = $('splitCopy');
    if (splitCopy) splitCopy.addEventListener('click', () => copySummary(splitCopy, splitSummaryText(), 'Copy summary'));

    const budgetCopy = $('budgetCopy');
    if (budgetCopy) budgetCopy.addEventListener('click', () => copySummary(budgetCopy, budgetSummaryText(), 'Copy summary'));

    const ledgerList = $('ledgerList');
    if (ledgerList) ledgerList.addEventListener('click', onLedgerListClick);

    const ledgerAccounts = $('ledgerAccounts');
    if (ledgerAccounts) {
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

    const addAccount = $('ledgerAddAccount');
    if (addAccount) {
        addAccount.addEventListener('click', () => {
            readLedgerAccounts();
            ledgerState.accounts.push({ id: ledgerId('a'), name: '', group: 'bank', opening: '' });
            buildLedgerAccounts();
            renderLedger();
            const last = document.querySelector('#ledgerAccounts .bgt-row:last-child .bgt-label');
            if (last) last.focus();
        });
    }

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

    const themeToggle = $('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', cycleTheme);

    // On "System", the answer can change under us — at sunset, on a schedule,
    // or because someone flipped a switch in another window.
    if (window.matchMedia) {
        const watch = window.matchMedia('(prefers-color-scheme: dark)');
        const onSystemChange = () => { if (themeChoice === 'system') repaintTheme(); };
        if (watch.addEventListener) watch.addEventListener('change', onSystemChange);
        else if (watch.addListener) watch.addListener(onSystemChange);   // older Safari
    }

    const dashCopy = $('dashCopy');
    if (dashCopy) dashCopy.addEventListener('click', () => copySummary(dashCopy, dashSummaryText(), 'Copy summary'));

    const tabs = $('tabs');
    if (tabs) {
        tabs.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-module]');
            if (btn) showModule(btn.dataset.module);
        });
    }

    wireBackup();

    renderLedger();
    renderSplit();
    renderBudget();
    renderCard();

    // Last, because it reads what every other module has just put on screen.
    renderDash();
});
