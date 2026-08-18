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
 * WIRING
 * ====================================================================
 */
/** Each module owns a <section class="module"> of the same name and a render. */
const MODULES = {
    ledger: { render: renderLedger },
    split:  { render: renderSplit },
    budget: { render: renderBudget },
    card:   { render: renderCard },
};

const FORM_DEFAULTS = {
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

    // "Clear" empties the entry form and drops out of edit mode. It must never
    // touch what is already written down.
    if (which === 'ledger') {
        ledgerClearForm();
        syncLedgerForm();
        renderLedger();
    }
}

function setSegment(seg, value) {
    seg.dataset.value = value;
    seg.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.val === value);
    });
}

document.addEventListener('DOMContentLoaded', () => {
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

    const tabs = $('tabs');
    if (tabs) {
        tabs.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-module]');
            if (btn) showModule(btn.dataset.module);
        });
    }

    renderLedger();
    renderSplit();
    renderBudget();
    renderCard();
});
