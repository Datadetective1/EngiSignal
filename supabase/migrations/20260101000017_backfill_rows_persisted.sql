-- Imports finished by the synchronous path have every accepted row stored;
-- they simply predate the column that records it. Left at zero they display as
-- "0 of 67,267 rows written" beside an import that plainly completed, which is
-- the checkpoint contradicting the status -- and the checkpoint is the number
-- the customer is being asked to trust while an import is running.
update public.imports
set rows_persisted = accepted_rows
where status = 'complete' and rows_persisted = 0 and accepted_rows > 0;
