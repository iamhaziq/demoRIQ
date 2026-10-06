-- Malaysian holidays 2023-2027 for forecast features.
-- Fixed-date and first-Monday holidays are exact. Lunar/Islamic dates (kind = 'festival') are
-- best estimates and can shift by a day with moon sighting: VERIFY against the official
-- federal gazette before the pilot and correct in a new migration.
-- School holidays (kind = 'school') are not loaded yet: they vary by state group and year;
-- add them from the KPM calendar.

insert into public.holidays (date, name, kind) values
  -- Fixed dates
  ('2023-01-01', 'New Year', 'public'), ('2024-01-01', 'New Year', 'public'),
  ('2025-01-01', 'New Year', 'public'), ('2026-01-01', 'New Year', 'public'),
  ('2027-01-01', 'New Year', 'public'),
  ('2023-05-01', 'Labour Day', 'public'), ('2024-05-01', 'Labour Day', 'public'),
  ('2025-05-01', 'Labour Day', 'public'), ('2026-05-01', 'Labour Day', 'public'),
  ('2027-05-01', 'Labour Day', 'public'),
  ('2023-06-05', 'Agong''s Birthday', 'public'), ('2024-06-03', 'Agong''s Birthday', 'public'),
  ('2025-06-02', 'Agong''s Birthday', 'public'), ('2026-06-01', 'Agong''s Birthday', 'public'),
  ('2027-06-07', 'Agong''s Birthday', 'public'),
  ('2023-08-31', 'National Day', 'public'), ('2024-08-31', 'National Day', 'public'),
  ('2025-08-31', 'National Day', 'public'), ('2026-08-31', 'National Day', 'public'),
  ('2027-08-31', 'National Day', 'public'),
  ('2023-09-16', 'Malaysia Day', 'public'), ('2024-09-16', 'Malaysia Day', 'public'),
  ('2025-09-16', 'Malaysia Day', 'public'), ('2026-09-16', 'Malaysia Day', 'public'),
  ('2027-09-16', 'Malaysia Day', 'public'),
  ('2023-12-25', 'Christmas', 'public'), ('2024-12-25', 'Christmas', 'public'),
  ('2025-12-25', 'Christmas', 'public'), ('2026-12-25', 'Christmas', 'public'),
  ('2027-12-25', 'Christmas', 'public'),
  -- Chinese New Year (2 days)
  ('2023-01-22', 'Chinese New Year', 'festival'), ('2023-01-23', 'Chinese New Year', 'festival'),
  ('2024-02-10', 'Chinese New Year', 'festival'), ('2024-02-11', 'Chinese New Year', 'festival'),
  ('2025-01-29', 'Chinese New Year', 'festival'), ('2025-01-30', 'Chinese New Year', 'festival'),
  ('2026-02-17', 'Chinese New Year', 'festival'), ('2026-02-18', 'Chinese New Year', 'festival'),
  ('2027-02-06', 'Chinese New Year', 'festival'), ('2027-02-07', 'Chinese New Year', 'festival'),
  -- Hari Raya Aidilfitri (2 days)
  ('2023-04-22', 'Hari Raya Aidilfitri', 'festival'), ('2023-04-23', 'Hari Raya Aidilfitri', 'festival'),
  ('2024-04-10', 'Hari Raya Aidilfitri', 'festival'), ('2024-04-11', 'Hari Raya Aidilfitri', 'festival'),
  ('2025-03-31', 'Hari Raya Aidilfitri', 'festival'), ('2025-04-01', 'Hari Raya Aidilfitri', 'festival'),
  ('2026-03-21', 'Hari Raya Aidilfitri', 'festival'), ('2026-03-22', 'Hari Raya Aidilfitri', 'festival'),
  ('2027-03-10', 'Hari Raya Aidilfitri', 'festival'), ('2027-03-11', 'Hari Raya Aidilfitri', 'festival'),
  -- Hari Raya Haji
  ('2023-06-29', 'Hari Raya Haji', 'festival'), ('2024-06-17', 'Hari Raya Haji', 'festival'),
  ('2025-06-07', 'Hari Raya Haji', 'festival'), ('2026-05-27', 'Hari Raya Haji', 'festival'),
  ('2027-05-17', 'Hari Raya Haji', 'festival'),
  -- Awal Muharram
  ('2023-07-19', 'Awal Muharram', 'festival'), ('2024-07-07', 'Awal Muharram', 'festival'),
  ('2025-06-27', 'Awal Muharram', 'festival'), ('2026-06-17', 'Awal Muharram', 'festival'),
  ('2027-06-06', 'Awal Muharram', 'festival'),
  -- Maulidur Rasul
  ('2023-09-28', 'Maulidur Rasul', 'festival'), ('2024-09-16', 'Maulidur Rasul', 'festival'),
  ('2025-09-05', 'Maulidur Rasul', 'festival'), ('2026-08-26', 'Maulidur Rasul', 'festival'),
  ('2027-08-15', 'Maulidur Rasul', 'festival'),
  -- Wesak
  ('2023-05-04', 'Wesak Day', 'festival'), ('2024-05-22', 'Wesak Day', 'festival'),
  ('2025-05-12', 'Wesak Day', 'festival'), ('2026-05-31', 'Wesak Day', 'festival'),
  ('2027-05-20', 'Wesak Day', 'festival'),
  -- Deepavali
  ('2023-11-12', 'Deepavali', 'festival'), ('2024-10-31', 'Deepavali', 'festival'),
  ('2025-10-20', 'Deepavali', 'festival'), ('2026-11-08', 'Deepavali', 'festival'),
  ('2027-10-28', 'Deepavali', 'festival')
on conflict do nothing;
