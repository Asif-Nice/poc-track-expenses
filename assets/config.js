/* Wedding Budget Tracker configuration.
 *
 * owner/repo are named outright rather than detected. Detection only works on a
 * *.github.io address, so the moment this is served from anywhere else — a
 * pages.dev subdomain, a custom domain, a file:// URL — it would come back
 * empty, the GitHub mode would go unavailable, and saving would quietly stop.
 * Naming them keeps the app working wherever it is hosted.
 */
window.EXPENSE_CONFIG = {
  owner: 'Asif-Nice',
  repo: 'poc-track-expenses',
  branch: 'main',
  filePath: 'data/expenses.xlsx',

  // Two sheets: what things are budgeted to cost, and what has actually been paid.
  budgetSheet: 'Budget',
  paymentSheet: 'Payments',

  /* Where a browser that has not chosen yet should keep the budget:
   * 'github' | 'file' | 'browser'. Once you pick something in Settings, that
   * choice wins on that device and this is ignored.
   *
   * There is deliberately no token here. This file is served publicly from the
   * Pages site — as is any file in a repository published to Pages, private or
   * not — so a token written here would be readable by anyone, and one with
   * Contents: Read and write lets a stranger rewrite the repository. GitHub's
   * secret scanning also revokes tokens found in pushed code, so it would stop
   * working within minutes. Enter it once per browser in Settings instead; it
   * is kept in localStorage and never leaves for anywhere but api.github.com. */
  defaultMode: 'github',

  locale: 'en-IN',
  currency: 'INR',

  /* Groups a budget item can belong to. Charts and filters read these. */
  categories: [
    'Venue & Hall',
    'Food & Catering',
    'Decoration',
    'Clothing & Jewellery',
    'Photography & Video',
    'Music & Entertainment',
    'Rituals & Priest',
    'Invitations & Printing',
    'Transport',
    'Accommodation',
    'Beauty & Mehendi',
    'Gifts & Return Gifts',
    'Staff & Helpers',
    'Miscellaneous',
  ],

  /* Family members who pay. These only seed the suggestion list — any name typed
   * into the "Paid by" field is accepted and remembered from then on. */
  payers: [],

  methods: ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Credit Card', 'Debit Card', 'Other'],

  /* Offered once, from the empty state, as a starting skeleton. Every estimate
   * comes in at zero — you fill in your own numbers. */
  starterItems: [
    { name: 'Wedding hall',        category: 'Venue & Hall' },
    { name: 'Catering — dinner',   category: 'Food & Catering' },
    { name: 'Catering — breakfast', category: 'Food & Catering' },
    { name: 'Stage & floral decor', category: 'Decoration' },
    { name: 'Bride outfit',        category: 'Clothing & Jewellery' },
    { name: 'Groom outfit',        category: 'Clothing & Jewellery' },
    { name: 'Jewellery',           category: 'Clothing & Jewellery' },
    { name: 'Photography & video', category: 'Photography & Video' },
    { name: 'Music / DJ',          category: 'Music & Entertainment' },
    { name: 'Priest & rituals',    category: 'Rituals & Priest' },
    { name: 'Invitation cards',    category: 'Invitations & Printing' },
    { name: 'Guest transport',     category: 'Transport' },
    { name: 'Guest rooms',         category: 'Accommodation' },
    { name: 'Mehendi & makeup',    category: 'Beauty & Mehendi' },
    { name: 'Return gifts',        category: 'Gifts & Return Gifts' },
  ],
};
