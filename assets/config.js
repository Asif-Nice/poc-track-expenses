/* Expense Tracker configuration.
 *
 * owner/repo point at the repository holding the workbook — which is NOT this
 * repository. This app is published on GitHub Pages, and a Pages site is public,
 * so the expense data lives in a separate private repo and is read and written
 * through the GitHub API with your token. Nothing about your spending is served
 * from the public site.
 *
 * Leave owner/repo as null to fall back to auto-detection from the Pages URL
 * (https://<owner>.github.io/<repo>/) — only correct when the data sits in the
 * same repo as the app.
 */
window.EXPENSE_CONFIG = {
  owner: 'Asif-Nice',
  repo: 'poc-track-expenses-data',
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
