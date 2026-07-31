/* Expense Tracker configuration.
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
