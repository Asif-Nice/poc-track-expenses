/* Wedding Budget Tracker configuration.
 *
 * The workbook lives in this same repository, so owner/repo are left null and
 * detected from the Pages URL (https://<owner>.github.io/<repo>/). Set them
 * explicitly only if you serve the app from a custom domain, open it over
 * file://, or want the data kept in a different repository.
 */
window.EXPENSE_CONFIG = {
  owner: null,
  repo: null,
  branch: 'main',
  filePath: 'data/expenses.xlsx',

  // Two sheets: what things are budgeted to cost, and what has actually been paid.
  budgetSheet: 'Budget',
  paymentSheet: 'Payments',

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
