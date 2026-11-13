-- Line items and notes of a copied FreshBooks invoice (JSON text), shown on the invoice page.
ALTER TABLE freshbooks_invoices ADD COLUMN details TEXT;
