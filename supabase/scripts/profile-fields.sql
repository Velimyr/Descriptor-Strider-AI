-- Профільні поля користувача (PROD, префікс bot_).
-- Дзеркальний staging-скрипт: profile-fields-dev.sql (префікс botdev_).
--
-- city/region/photo_file_id — публічні (показуються в рейтингах/публічних профілях).
-- tg_username/phone_number/facebook_url — приватні (лише адмін).
-- photo_file_id — TG file_id (для повторного надсилання без перезавантаження).
-- photo_message_id — посилання на пост у приватному каналі профілів (адмінська навігація).
-- tg_username автозбирається з updates; інші поля — через UI бота / веб-форму.
--
-- Безпечно прогнати кілька разів (IF NOT EXISTS).

alter table bot_users add column if not exists city text;
alter table bot_users add column if not exists region text;
alter table bot_users add column if not exists tg_username text;
alter table bot_users add column if not exists phone_number text;
alter table bot_users add column if not exists facebook_url text;
alter table bot_users add column if not exists photo_file_id text;
alter table bot_users add column if not exists photo_message_id text;

-- Для пошуку юзера за username/телефоном в адмінці.
create index if not exists bot_users_tg_username_idx on bot_users (lower(tg_username));
create index if not exists bot_users_phone_idx on bot_users (phone_number);
