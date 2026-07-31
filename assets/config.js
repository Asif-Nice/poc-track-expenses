/* Expense Tracker configuration.
 *
 * owner/repo are auto-detected from a GitHub Pages URL
 * (https://<owner>.github.io/<repo>/). Set them explicitly only if you serve the
 * app from somewhere else (a custom domain, or file:// during development).
 */
window.EXPENSE_CONFIG = {
  owner: null,
  repo: null,
  branch: 'main',
  filePath: 'data/expenses.xlsx',
  sheetName: 'Expenses',

  locale: 'en-IN',
  currency: 'INR',

  categories: [
    'Food & Dining',
    'Groceries',
    'Transport',
    'Housing & Rent',
    'Utilities',
    'Health',
    'Shopping',
    'Entertainment',
    'Travel',
    'Education',
    'Other',
  ],

  methods: ['UPI', 'Credit Card', 'Debit Card', 'Cash', 'Net Banking', 'Wallet', 'Other'],
};
